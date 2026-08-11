/**
 * ArcGIS runtime layer for intelligence research events.
 */
import { addRuntimeLayer, getMapView, importArc } from './spatial-arcgis-runtime.js';
import { eventToFeatureAttributes, buildIntelligencePopupHtml } from './intelligence-layer-popup.js';
import { isIntelligenceLayerId } from './intelligence-layer-registry.js';

/** @type {Map<string, import('@arcgis/core/layers/GraphicsLayer').default>} */
const layerById = new Map();
/** @type {Map<string, Map<string, import('@arcgis/core/Graphic').default>>} */
const graphicByLayerId = new Map();

function geometryToArc(geometry, Point, Polyline, Polygon) {
  if (!geometry?.type) return null;
  if (geometry.type === 'Point' && Array.isArray(geometry.coordinates)) {
    return new Point({ longitude: geometry.coordinates[0], latitude: geometry.coordinates[1] });
  }
  if (geometry.type === 'LineString' && Array.isArray(geometry.coordinates)) {
    return new Polyline({ paths: [geometry.coordinates.map(([lng, lat]) => [lng, lat])] });
  }
  if (geometry.type === 'Polygon' && Array.isArray(geometry.coordinates)) {
    return new Polygon({ rings: geometry.coordinates });
  }
  if (geometry.type === 'MultiPolygon' && Array.isArray(geometry.coordinates)) {
    return new Polygon({ rings: geometry.coordinates.flatMap((poly) => poly) });
  }
  return null;
}

function buildMarkerSymbol(SimpleMarkerSymbol, emphasized = false) {
  return new SimpleMarkerSymbol({
    style: 'diamond',
    color: emphasized ? [220, 53, 69, 0.95] : [178, 34, 34, 0.82],
    size: emphasized ? 14 : 11,
    outline: { color: [255, 255, 255, 1], width: emphasized ? 2 : 1.5 }
  });
}

/**
 * @param {string} layerId
 * @param {object} normalized
 * @param {object} [options]
 */
export async function renderIntelligenceLayer(layerId, normalized, options = {}) {
  const trace = options.trace || null;
  const view = getMapView();
  const webMap = view?.map;
  if (!webMap || !layerId) return { rendered: 0 };

  const [GraphicsLayer, Graphic, Point, Polyline, Polygon, SimpleMarkerSymbol, PopupTemplate] = await Promise.all([
    importArc('@arcgis/core/layers/GraphicsLayer.js'),
    importArc('@arcgis/core/Graphic.js'),
    importArc('@arcgis/core/geometry/Point.js'),
    importArc('@arcgis/core/geometry/Polyline.js'),
    importArc('@arcgis/core/geometry/Polygon.js'),
    importArc('@arcgis/core/symbols/SimpleMarkerSymbol.js'),
    importArc('@arcgis/core/PopupTemplate.js')
  ]);

  let layer = webMap.findLayerById(layerId) || layerById.get(layerId);
  if (!layer) {
    layer = new GraphicsLayer({
      id: layerId,
      title: normalized.layerTitle || 'Intelligence layer',
      listMode: 'show',
      popupEnabled: true
    });
    addRuntimeLayer(layer);
    layerById.set(layerId, layer);
  } else {
    layer.title = normalized.layerTitle || layer.title;
    layer.removeAll();
  }

  const graphicMap = new Map();
  const events = normalized.mappableEvents || [];
  let firstGraphicAdded = false;
  for (const event of events) {
    const arcGeometry = geometryToArc(event.geometry, Point, Polyline, Polygon);
    if (!arcGeometry) continue;
    const attrs = eventToFeatureAttributes(event, normalized.request);
    const graphic = new Graphic({
      geometry: arcGeometry,
      symbol: buildMarkerSymbol(SimpleMarkerSymbol),
      attributes: attrs,
      popupTemplate: new PopupTemplate({
        title: '{title}',
        content: buildIntelligencePopupHtml(attrs)
      })
    });
    layer.add(graphic);
    if (!firstGraphicAdded) {
      firstGraphicAdded = true;
      trace?.mark('graphicsLayerInsert');
      await waitForFirstRenderedFeature(view, layer, trace);
    }
    if (attrs.eventId) graphicMap.set(attrs.eventId, graphic);
  }

  graphicByLayerId.set(layerId, graphicMap);

  if (events.length) {
    trace?.mark('initialLayerStart');
    await fitToIntelligenceLayer(layerId);
    trace?.mark('initialLayerReady');
  }

  return { rendered: events.length, layer };
}

async function waitForFirstRenderedFeature(view, layer, trace) {
  if (!view || !layer) {
    trace?.mark('firstRenderedFeature');
    return;
  }
  try {
    const layerView = await view.whenLayerView(layer);
    await layerView.when();
    await new Promise((resolve) => {
      const finish = () => {
        trace?.mark('firstRenderedFeature');
        resolve();
      };
      if (!layerView.updating) {
        requestAnimationFrame(() => requestAnimationFrame(finish));
        return;
      }
      const handle = layerView.watch('updating', (updating) => {
        if (!updating) {
          handle.remove();
          requestAnimationFrame(() => requestAnimationFrame(finish));
        }
      });
      setTimeout(() => {
        handle.remove();
        finish();
      }, 5000);
    });
  } catch {
    trace?.mark('firstRenderedFeature');
  }
}

export async function fitToIntelligenceLayer(layerId) {
  const view = getMapView();
  const layer = view?.map?.findLayerById(layerId);
  if (!view || !layer) return;
  await layer.when?.();
  const extent = layer.fullExtent;
  if (extent) await view.goTo(extent.expand(1.25));
}

export async function removeIntelligenceLayerFromMap(layerId) {
  const view = getMapView();
  const layer = view?.map?.findLayerById(layerId) || layerById.get(layerId);
  if (layer) {
    view?.map?.remove(layer);
    layer.removeAll?.();
  }
  layerById.delete(layerId);
  graphicByLayerId.delete(layerId);
}

export async function setIntelligenceLayerVisible(layerId, visible) {
  const layer = getMapView()?.map?.findLayerById(layerId);
  if (layer) layer.visible = Boolean(visible);
}

/**
 * @param {import('@arcgis/core/views/MapView').default} mapEvent
 */
export async function hitTestIntelligenceFeature(mapEvent) {
  const view = getMapView();
  if (!view) return null;
  const response = await view.hitTest(mapEvent);
  const hit = response.results.find((r) => {
    const layerId = r.graphic?.layer?.id;
    return isIntelligenceLayerId(layerId);
  });
  if (!hit?.graphic) return null;
  return {
    layerId: hit.graphic.layer?.id,
    eventId: hit.graphic.attributes?.eventId || null,
    attributes: hit.graphic.attributes || null,
    graphic: hit.graphic
  };
}

export function getIntelligenceLayerState(layerId) {
  const layer = getMapView()?.map?.findLayerById(layerId);
  return {
    layerId,
    visible: Boolean(layer?.visible),
    graphicCount: layer?.graphics?.length || 0
  };
}

/**
 * DATA_VERSION patch — update existing graphic by governed eventId.
 * @param {string} layerId
 * @param {object} event
 * @param {object} [options]
 */
export async function upsertIntelligenceEventGraphic(layerId, event, options = {}) {
  const view = getMapView();
  const webMap = view?.map;
  if (!webMap || !layerId || !event) return { updated: false };

  const [Graphic, Point, Polyline, Polygon, SimpleMarkerSymbol, PopupTemplate] = await Promise.all([
    importArc('@arcgis/core/Graphic.js'),
    importArc('@arcgis/core/geometry/Point.js'),
    importArc('@arcgis/core/geometry/Polyline.js'),
    importArc('@arcgis/core/geometry/Polygon.js'),
    importArc('@arcgis/core/symbols/SimpleMarkerSymbol.js'),
    importArc('@arcgis/core/PopupTemplate.js')
  ]);

  let layer = webMap.findLayerById(layerId) || layerById.get(layerId);
  if (!layer) return { updated: false };

  const graphicMap = graphicByLayerId.get(layerId) || new Map();
  const eventId = event.eventId;
  const existing = eventId ? graphicMap.get(eventId) : null;
  const arcGeometry = geometryToArc(event.geometry, Point, Polyline, Polygon);
  if (!arcGeometry) return { updated: false };

  const attrs = eventToFeatureAttributes(event, options.request || {});
  attrs.governedEventVersion = options.governedEventVersion || attrs.governedEventVersion || 1;
  if (options.patchType) attrs.patchType = options.patchType;

  if (existing) {
    existing.geometry = arcGeometry;
    existing.attributes = { ...existing.attributes, ...attrs };
    existing.symbol = buildMarkerSymbol(SimpleMarkerSymbol, options.emphasized);
    return { updated: true, graphic: existing };
  }

  const graphic = new Graphic({
    geometry: arcGeometry,
    symbol: buildMarkerSymbol(SimpleMarkerSymbol),
    attributes: attrs,
    popupTemplate: new PopupTemplate({
      title: '{title}',
      content: buildIntelligencePopupHtml(attrs)
    })
  });
  layer.add(graphic);
  if (eventId) graphicMap.set(eventId, graphic);
  graphicByLayerId.set(layerId, graphicMap);
  options.trace?.mark('graphicsLayerInsert');
  return { updated: true, graphic, created: true };
}
