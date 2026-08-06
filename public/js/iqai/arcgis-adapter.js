/**
 * ArcGIS MapAdapter for IQAI Spatial V2.
 */
import { parseWmtsTimeFrames, selectGibsDayCandidates } from './wmts-utils.js';
import { createVesselGraphics } from './vessel-graphics.js';

const OCEAN_BASE_URL = 'https://services.arcgisonline.com/ArcGIS/rest/services/Ocean/World_Ocean_Base/MapServer';
const OCEAN_REF_URL = 'https://basemaps.arcgis.com/arcgis/rest/services/World_Basemap_v2/VectorTileServer';

async function importArc(path) {
  const mod = await $arcgis.import(path);
  return mod?.default || mod;
}

export class ArcGISAdapter {
  constructor(containerElement) {
    this.container = containerElement;
    this.view = null;
    this.map = null;
    this.layers = new Map();
    this.graphicsLayer = null;
    this.trackerLayerIds = new Set(['vespucci-tracker']);
    this.lastHeading = null;
    this._abort = null;
  }

  async init(options) {
    const cdnUrl = options.cdnUrl || 'https://js.arcgis.com/5.1/';
    await this._loadCdn(cdnUrl);

    const Map = await importArc('@arcgis/core/Map.js');
    const MapView = await importArc('@arcgis/core/views/MapView.js');
    const TileLayer = await importArc('@arcgis/core/layers/TileLayer.js');
    const VectorTileLayer = await importArc('@arcgis/core/layers/VectorTileLayer.js');
    const GraphicsLayer = await importArc('@arcgis/core/layers/GraphicsLayer.js');
    const Basemap = await importArc('@arcgis/core/Basemap.js');

    const baseLayer = new TileLayer({ url: OCEAN_BASE_URL, title: 'World Ocean Base' });
    const refLayer = new VectorTileLayer({ url: OCEAN_REF_URL, title: 'World Ocean Reference' });
    const basemap = new Basemap({ baseLayers: [baseLayer], referenceLayers: [refLayer] });
    this.map = new Map({ basemap });
    this.graphicsLayer = new GraphicsLayer({ id: 'vespucci-tracker', listMode: 'hide' });
    this.map.add(this.graphicsLayer);
    this.layers.set('vespucci-tracker', this.graphicsLayer);

    this.view = new MapView({
      container: this.container,
      map: this.map,
      center: [-30, 38.5],
      zoom: 5,
      constraints: { snapToZoom: false }
    });
    await this.view.when();

    if (!options.preview && options.featureServiceUrl) {
      await this._addHostedFeatureLayers(options.featureServiceUrl, options.layerIds);
    }
    return this.view;
  }

  async _loadCdn(cdnUrl) {
    if (window.$arcgis) return;
    await new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.type = 'module';
      s.src = cdnUrl;
      s.onload = resolve;
      s.onerror = reject;
      document.head.appendChild(s);
    });
  }

  async _addHostedFeatureLayers(featureServiceUrl, layerIds = {}) {
    const FeatureLayer = await importArc('@arcgis/core/layers/FeatureLayer.js');
    const entries = [
      { id: 0, key: 'current' },
      { id: 1, key: 'history' },
      { id: 2, key: 'travelled' },
      { id: 3, key: 'destination' },
      { id: 4, key: 'estimated' },
      { id: 5, key: 'conditions' }
    ];
    for (const entry of entries) {
      const layerId = layerIds[entry.key] ?? entry.id;
      const layer = new FeatureLayer({
        url: `${featureServiceUrl.replace(/\/$/, '')}/${layerId}`,
        outFields: ['*']
      });
      layer.id = `vespucci-layer-${entry.key}`;
      this.map.add(layer);
      this.layers.set(layer.id, layer);
      this.trackerLayerIds.add(layer.id);
    }
  }

  async setTrackerGraphics(mapData) {
    if (!this.graphicsLayer || !this.view) return;
    const modules = await this._graphicModules();
    const { graphics, heading } = await createVesselGraphics(modules, mapData, {}, this.lastHeading);
    this.lastHeading = heading;
    this.graphicsLayer.removeAll();
    this.graphicsLayer.addMany(graphics);
  }

  async _graphicModules() {
    return {
      Graphic: await importArc('@arcgis/core/Graphic.js'),
      Point: await importArc('@arcgis/core/geometry/Point.js'),
      Polyline: await importArc('@arcgis/core/geometry/Polyline.js'),
      SimpleMarkerSymbol: await importArc('@arcgis/core/symbols/SimpleMarkerSymbol.js'),
      SimpleLineSymbol: await importArc('@arcgis/core/symbols/SimpleLineSymbol.js'),
      PictureMarkerSymbol: await importArc('@arcgis/core/symbols/PictureMarkerSymbol.js')
    };
  }

  async addLayer(layerConfig, layerInstance) {
    if (layerInstance) {
      layerInstance.id = layerConfig.id;
      this.map.add(layerInstance);
      this.layers.set(layerConfig.id, layerInstance);
      return layerInstance;
    }
    return null;
  }

  async ensureLayerFromCatalog(layer, timeController) {
    if (this.layers.has(layer.id)) return this.layers.get(layer.id);
    if (this._abort) this._abort.abort();
    this._abort = new AbortController();

    let instance = null;
    if (layer.sourceType === 'ImageryTileLayer' && layer.style === 'flow-renderer') {
      instance = await createImageryTileFlowLayer(layer.endpoint, layer.title);
    } else if (layer.sourceType === 'ImageryTileLayer') {
      const ImageryTileLayer = await importArc('@arcgis/core/layers/ImageryTileLayer.js');
      instance = new ImageryTileLayer({ url: layer.endpoint, title: layer.title, opacity: layer.defaultOpacity });
    } else if (layer.sourceType === 'WebTileLayer') {
      instance = await createWebTileLayer(layer.endpoint, layer.title, layer);
    } else if (layer.sourceType === 'WMSLayer') {
      instance = await createWmsLayer(layer.endpoint, layer.layerName);
    } else if (layer.sourceType === 'WMTSLayer') {
      instance = await createCopernicusWmtsLayer(layer, timeController, this._abort.signal);
    } else if (layer.sourceType === 'WFS') {
      instance = await createWfsGeoJsonLayer(layer);
    } else if (layer.sourceType === 'FeatureLayer' && layer.endpoint?.startsWith('/api/')) {
      instance = await createPortsLayer(layer);
    }
    if (instance) {
      instance.opacity = layer.defaultOpacity ?? instance.opacity ?? 1;
      await this.addLayer(layer, instance);
    }
    return instance;
  }

  async removeLayer(layerId) {
    const layer = this.layers.get(layerId);
    if (layer && !this.trackerLayerIds.has(layerId)) {
      this.map.remove(layer);
      this.layers.delete(layerId);
    }
  }

  setVisible(layerId, visible) {
    const layer = this.layers.get(layerId);
    if (layer) layer.visible = visible;
  }

  setOpacity(layerId, opacity) {
    const layer = this.layers.get(layerId);
    if (layer) layer.opacity = opacity;
  }

  async setTime(layerId, validTime) {
    const layer = this.layers.get(layerId);
    if (!layer) return;
    if (layer.type === 'wmts' && layer.activeLayer) {
      layer.activeLayer = { ...layer.activeLayer, dimensionValue: validTime };
      await layer.refresh();
    }
    if (layer.urlTemplate && layer.urlTemplate.includes('{Time}')) {
      layer.urlTemplate = layer.urlTemplate.replace(/\{Time\}/g, validTime.slice(0, 10));
      await layer.refresh();
    }
  }

  async identify(screenPoint) {
    if (!this.view) return null;
    const hit = await this.view.hitTest(screenPoint);
    return hit?.results?.[0] || null;
  }

  async fitGeometry(extent) {
    if (!this.view || !extent) return;
    await this.view.goTo(extent, { duration: 800 });
  }

  toMapCoordinates(mapPoint) {
    return { longitude: mapPoint.longitude, latitude: mapPoint.latitude };
  }

  fromMapCoordinates(lon, lat) {
    return { x: lon, y: lat };
  }

  async upsertGraphic(graphic) {
    if (this.graphicsLayer) this.graphicsLayer.add(graphic);
  }

  async removeGraphic(graphicId) {
    const g = this.graphicsLayer?.graphics?.find((gr) => gr.id === graphicId);
    if (g) this.graphicsLayer.remove(g);
  }

  hideContextualLayers(activeIds) {
    for (const [id, layer] of this.layers) {
      if (this.trackerLayerIds.has(id)) continue;
      layer.visible = activeIds.has(id);
    }
  }
}

export async function createCopernicusWmtsLayer(layer, timeController, signal) {
  const WMTSLayer = await importArc('@arcgis/core/layers/WMTSLayer.js');
  const capUrl = layer.wmtsCapabilities || `${layer.endpoint}?SERVICE=WMTS&version=1.0.0&REQUEST=GetCapabilities`;
  const xml = await fetch(capUrl, { signal }).then((r) => r.text());
  const frames = parseWmtsTimeFrames(xml, layer.layerName?.split('/').pop());
  if (timeController) timeController.setFrames(frames);
  const validTime = timeController?.validTime || frames[frames.length - 1];
  return new WMTSLayer({
    url: capUrl,
    activeLayer: {
      id: layer.layerName,
      tileMatrixSetId: 'EPSG:3857',
      dimensionParamName: 'time',
      dimensionValue: validTime
    },
    customParameters: layer.depthDefault != null ? { depth: String(layer.depthDefault) } : undefined,
    title: layer.title,
    opacity: layer.defaultOpacity
  });
}

export async function createImageryTileFlowLayer(url, title) {
  const ImageryTileLayer = await importArc('@arcgis/core/layers/ImageryTileLayer.js');
  const FlowRenderer = await importArc('@arcgis/core/renderers/FlowRenderer.js');
  const layer = new ImageryTileLayer({ url, title });
  layer.renderer = new FlowRenderer({
    flowRepresentation: 'flow-from',
    density: 0.8,
    colorRamp: { type: 'algorithmic', fromColor: [0, 180, 220, 200], toColor: [0, 80, 140, 220] }
  });
  return layer;
}

export async function createWebTileLayer(urlTemplate, title, layer) {
  const WebTileLayer = await importArc('@arcgis/core/layers/WebTileLayer.js');
  let tpl = urlTemplate.replace(/\{z\}/g, '{level}').replace(/\{x\}/g, '{col}').replace(/\{y\}/g, '{row}');
  if (tpl.includes('{Time}')) {
    const day = selectGibsDayCandidates(3)[0];
    tpl = tpl.replace(/\{Time\}/g, day);
    layer._gibsDay = day;
  }
  return new WebTileLayer({ urlTemplate: tpl, title });
}

export async function createWmsLayer(url, layers) {
  const WMSLayer = await importArc('@arcgis/core/layers/WMSLayer.js');
  return new WMSLayer({ url, sublayers: [{ name: layers }] });
}

async function createWfsGeoJsonLayer(layer) {
  const GeoJSONLayer = await importArc('@arcgis/core/layers/GeoJSONLayer.js');
  const params = new URLSearchParams({
    service: 'WFS',
    version: '2.0.0',
    request: 'GetFeature',
    typeName: `MarineRegions:${layer.layerName}`,
    outputFormat: 'application/json',
    count: '2000'
  });
  const blob = new Blob([JSON.stringify({ type: 'FeatureCollection', features: [] })], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const geo = new GeoJSONLayer({
    url,
    title: layer.title,
    renderer: {
      type: 'simple',
      symbol: { type: 'simple-line', color: [100, 180, 255, 0.7], width: 1.2 }
    }
  });
  try {
    const res = await fetch(`${layer.endpoint}?${params}`);
    if (res.ok) {
      const data = await res.json();
      const dataUrl = URL.createObjectURL(new Blob([JSON.stringify(data)], { type: 'application/json' }));
      geo.url = dataUrl;
    }
  } catch {
    /* optional layer — leave empty */
  }
  return geo;
}

async function createPortsLayer(layer) {
  const GraphicsLayer = await importArc('@arcgis/core/layers/GraphicsLayer.js');
  const Graphic = await importArc('@arcgis/core/Graphic.js');
  const Point = await importArc('@arcgis/core/geometry/Point.js');
  const SimpleMarkerSymbol = await importArc('@arcgis/core/symbols/SimpleMarkerSymbol.js');
  const gl = new GraphicsLayer({ title: layer.title, minScale: layer.minScale || 500000 });
  try {
    const res = await fetch(layer.endpoint);
    const data = await res.json();
    const features = data.features || [];
    const graphics = features.slice(0, 300).map((f, i) => new Graphic({
      geometry: new Point({ longitude: f.geometry.coordinates[0], latitude: f.geometry.coordinates[1] }),
      attributes: f.properties,
      symbol: new SimpleMarkerSymbol({ style: 'circle', color: [180, 200, 220, 0.85], size: 6, outline: { width: 0.5, color: [20, 30, 48, 0.8] } })
    }));
    gl.addMany(graphics);
  } catch {
    /* ports optional */
  }
  return gl;
}
