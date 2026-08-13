/**
 * Cartographic acquisition mesh, Quick Point footprint, and ephemeral AOI-distance connector.
 * Hatch is presentation only — not an analytical fishnet or coverage surface.
 */
import {
  addRuntimeLayer,
  getMapView,
  importArc
} from './spatial-arcgis-runtime.js';
import {
  CONNECTOR_MEANING,
  FOOTPRINT_MEANING,
  ACQUISITION_CARTOGRAPHIC_BUFFER_METERS,
  buildEvidenceAcquisitionFootprint,
  circlePolygon,
  formatAoiDistanceLabel,
  polygonRingSets,
  toGeoJsonPolygon
} from './point-intelligence-aoi-geometry.js';

export { CONNECTOR_MEANING };

export const POINT_INTEL_AOI_LAYER_ID = 'iqai-point-intel-aoi';
export const POINT_INTEL_CONNECTOR_LAYER_ID = 'iqai-point-intel-aoi-link';
export const POINT_INTEL_FOOTPRINT_LAYER_ID = 'iqai-point-intel-footprint';

/** @type {import('@arcgis/core/layers/GraphicsLayer').default | null} */
let aoiLayer = null;
/** @type {import('@arcgis/core/layers/GraphicsLayer').default | null} */
let connectorLayer = null;
/** @type {import('@arcgis/core/layers/GraphicsLayer').default | null} */
let footprintLayer = null;
/** @type {object | null} */
let currentAoiPolygon = null;

export function buildAcquisitionMeshSymbol() {
  return {
    type: 'simple-fill',
    color: [196, 214, 72, 0.32],
    style: 'diagonal-cross',
    outline: {
      color: [118, 136, 28, 0.98],
      width: 3.15
    }
  };
}

export function buildAcquisitionMeshCimData() {
  return {
    type: 'CIMSymbolReference',
    symbol: {
      type: 'CIMPolygonSymbol',
      symbolLayers: [
        {
          type: 'CIMSolidFill',
          enable: true,
          color: [196, 214, 72, 72]
        },
        {
          type: 'CIMHatchFill',
          enable: true,
          rotation: 0,
          separation: 7,
          lineSymbol: {
            type: 'CIMLineSymbol',
            symbolLayers: [{
              type: 'CIMSolidStroke',
              enable: true,
              color: [168, 186, 48, 185],
              width: 1.05
            }]
          }
        },
        {
          type: 'CIMHatchFill',
          enable: true,
          rotation: 90,
          separation: 7,
          lineSymbol: {
            type: 'CIMLineSymbol',
            symbolLayers: [{
              type: 'CIMSolidStroke',
              enable: true,
              color: [168, 186, 48, 160],
              width: 0.9
            }]
          }
        },
        {
          type: 'CIMSolidStroke',
          enable: true,
          color: [118, 136, 28, 255],
          width: 3.15
        }
      ]
    }
  };
}

function footprintSymbol() {
  return {
    type: 'simple-fill',
    color: [196, 214, 72, 0.03],
    style: 'solid',
    outline: {
      color: [210, 224, 96, 0.55],
      width: 0.9
    }
  };
}

function connectorSymbol() {
  return {
    type: 'simple-line',
    color: [186, 196, 120, 0.85],
    width: 0.9,
    style: 'short-dot'
  };
}

async function ensureLayer(layerId, title) {
  const view = getMapView();
  const webMap = view?.map;
  if (!webMap) return null;
  const existing = webMap.findLayerById(layerId);
  if (existing) return existing;
  const GraphicsLayer = await importArc('@arcgis/core/layers/GraphicsLayer.js');
  const layer = new GraphicsLayer({
    id: layerId,
    title,
    listMode: 'hide',
    popupEnabled: false
  });
  addRuntimeLayer(layer);
  return layer;
}

export async function ensureAcquisitionLayers() {
  aoiLayer = await ensureLayer(POINT_INTEL_AOI_LAYER_ID, 'Point Intelligence acquisition');
  connectorLayer = await ensureLayer(POINT_INTEL_CONNECTOR_LAYER_ID, 'Point Intelligence AOI distance');
  footprintLayer = await ensureLayer(POINT_INTEL_FOOTPRINT_LAYER_ID, 'Point Intelligence search footprint');
  return { aoiLayer, connectorLayer, footprintLayer };
}

export function getCurrentAoiPolygon() {
  return currentAoiPolygon;
}

export async function renderAcquisitionMesh(polygon) {
  const layers = await ensureAcquisitionLayers();
  if (!layers.aoiLayer) return false;
  const [Graphic, Polygon, SimpleFillSymbol, CIMSymbol] = await Promise.all([
    importArc('@arcgis/core/Graphic.js'),
    importArc('@arcgis/core/geometry/Polygon.js'),
    importArc('@arcgis/core/symbols/SimpleFillSymbol.js'),
    importArc('@arcgis/core/symbols/CIMSymbol.js')
  ]);
  const ringSets = polygonRingSets(polygon);
  if (!ringSets.length) return false;
  layers.aoiLayer.removeAll();
  let symbol;
  try {
    symbol = new CIMSymbol({ data: buildAcquisitionMeshCimData() });
  } catch {
    symbol = new SimpleFillSymbol(buildAcquisitionMeshSymbol());
  }
  const meshAttributes = {
    role: 'pi-aoi-mesh',
    meaning: FOOTPRINT_MEANING,
    analytical: 0,
    coverage: 0,
    influence: 0,
    interpolation: 0,
    impact: 0,
    searchRadius: 0,
    drapeReady: 1,
    hasZ: 0
  };
  for (const partRings of ringSets) {
    if (!partRings?.length) continue;
    layers.aoiLayer.add(new Graphic({
      geometry: new Polygon({ rings: partRings, spatialReference: { wkid: 4326 } }),
      symbol,
      attributes: { ...meshAttributes }
    }));
  }
  currentAoiPolygon = polygon.type ? polygon : toGeoJsonPolygon(ringSets[0]);
  reorderAcquisitionLayers();
  return true;
}

function reorderAcquisitionLayers() {
  const view = getMapView();
  const map = view?.map;
  if (!map) return;
  const aoi = map.findLayerById(POINT_INTEL_AOI_LAYER_ID);
  const footprint = map.findLayerById(POINT_INTEL_FOOTPRINT_LAYER_ID);
  const click = map.findLayerById('iqai-point-intel-click');
  const stations = map.findLayerById('iqai-point-intel-stations');
  const selection = map.findLayerById('iqai-point-intel-selection');
  const last = map.layers.length - 1;
  if (footprint) map.reorder(footprint, Math.max(0, last - 6));
  if (aoi) map.reorder(aoi, Math.max(0, last - 5));
  if (click) map.reorder(click, last - 2);
  if (stations) map.reorder(stations, last - 1);
  if (selection) map.reorder(selection, last);
}

function arcPolygonToGeoJson(geometry) {
  if (!geometry?.rings?.length) return null;
  const rings = geometry.rings.map((ring) => ring.map((pt) => [pt[0], pt[1]]));
  return toGeoJsonPolygon(rings);
}

export async function renderEvidenceDrivenFootprint({
  origin,
  evidence = [],
  fallbackPolygon = null,
  method = null,
  meaning = FOOTPRINT_MEANING,
  bufferMeters = ACQUISITION_CARTOGRAPHIC_BUFFER_METERS
} = {}) {
  const hybrid = fallbackPolygon?.type === 'MultiPolygon'
    || method === 'LOCAL_BODY_PLUS_REMOTE_CORRIDOR';
  if (hybrid && fallbackPolygon) {
    const ok = await renderAcquisitionMesh(fallbackPolygon);
    const graphic = aoiLayer?.graphics?.getItemAt?.(0) || aoiLayer?.graphics?.items?.[0];
    if (graphic?.attributes) {
      graphic.attributes.method = method || 'LOCAL_BODY_PLUS_REMOTE_CORRIDOR';
      graphic.attributes.meaning = meaning;
    }
    return ok;
  }
  let polygon = fallbackPolygon;
  let resolvedMethod = method;
  try {
    const engine = await importArc('@arcgis/core/geometry/geometryEngine.js');
    const Point = await importArc('@arcgis/core/geometry/Point.js');
    const Polyline = await importArc('@arcgis/core/geometry/Polyline.js');
    const Multipoint = await importArc('@arcgis/core/geometry/Multipoint.js');
    const engineApi = engine?.geodesicBuffer ? engine : (engine?.default || engine);
    const points = [origin, ...evidence].filter((pt) => (
      Number.isFinite(pt?.longitude) && Number.isFinite(pt?.latitude)
    ));
    const sr = { wkid: 4326 };
    let geometry = null;
    if (points.length === 1) {
      geometry = new Point({ longitude: points[0].longitude, latitude: points[0].latitude, spatialReference: sr });
      resolvedMethod = 'GEODESIC_BUFFER_POINT';
    } else if (points.length === 2) {
      geometry = new Polyline({
        paths: [[[points[0].longitude, points[0].latitude], [points[1].longitude, points[1].latitude]]],
        spatialReference: sr
      });
      resolvedMethod = 'GEODESIC_BUFFER_CORRIDOR';
    } else if (points.length > 2) {
      const hullSource = new Multipoint({
        points: points.map((pt) => [pt.longitude, pt.latitude]),
        spatialReference: sr
      });
      geometry = engineApi.convexHull(hullSource);
      resolvedMethod = 'GEODESIC_BUFFER_CONVEX_HULL';
    }
    if (geometry) {
      const buffered = engineApi.geodesicBuffer(geometry, bufferMeters, 'meters');
      let candidate = Array.isArray(buffered) ? buffered[0] : buffered;
      if (candidate?.spatialReference?.isWebMercator || candidate?.spatialReference?.wkid === 3857) {
        const webMercatorUtils = await importArc('@arcgis/core/geometry/support/webMercatorUtils.js');
        candidate = webMercatorUtils.webMercatorToGeographic(candidate);
      }
      const converted = arcPolygonToGeoJson(candidate);
      const firstLon = converted?.coordinates?.[0]?.[0]?.[0];
      if (converted && Math.abs(Number(firstLon)) <= 180) polygon = converted;
    }
  } catch {
    if (!polygon) {
      const built = buildEvidenceAcquisitionFootprint({ origin, evidence, bufferMeters });
      polygon = built.polygon;
      resolvedMethod = built.method;
    }
  }
  if (!polygon) return false;
  const ok = await renderAcquisitionMesh(polygon);
  const graphic = aoiLayer?.graphics?.getItemAt?.(0) || aoiLayer?.graphics?.items?.[0];
  if (graphic?.attributes) {
    graphic.attributes.method = resolvedMethod;
    graphic.attributes.meaning = meaning;
  }
  return ok;
}

export async function clearAcquisitionMesh() {
  currentAoiPolygon = null;
  const view = getMapView();
  aoiLayer = aoiLayer || view?.map?.findLayerById(POINT_INTEL_AOI_LAYER_ID) || null;
  aoiLayer?.removeAll?.();
  await hideDistanceConnector();
}

export async function renderQuickPointFootprint(point, radiusMeters) {
  const layers = await ensureAcquisitionLayers();
  if (!layers.footprintLayer || !point) return false;
  const polygon = circlePolygon(point.longitude, point.latitude, radiusMeters);
  if (!polygon) return false;
  const [Graphic, Polygon, SimpleFillSymbol] = await Promise.all([
    importArc('@arcgis/core/Graphic.js'),
    importArc('@arcgis/core/geometry/Polygon.js'),
    importArc('@arcgis/core/symbols/SimpleFillSymbol.js')
  ]);
  layers.footprintLayer.removeAll();
  layers.footprintLayer.add(new Graphic({
    geometry: new Polygon({ rings: polygon.coordinates, spatialReference: { wkid: 4326 } }),
    symbol: new SimpleFillSymbol(footprintSymbol()),
    attributes: { role: 'pi-quick-point-footprint', radiusMeters }
  }));
  return true;
}

export async function clearQuickPointFootprint() {
  const view = getMapView();
  footprintLayer = footprintLayer || view?.map?.findLayerById(POINT_INTEL_FOOTPRINT_LAYER_ID) || null;
  footprintLayer?.removeAll?.();
}

export async function showDistanceConnector(record) {
  await hideDistanceConnector();
  if (!record?.aoiNearestBoundary || record.aoiClassification !== 'SUPPORTING_EXTERNAL') return false;
  const layers = await ensureAcquisitionLayers();
  if (!layers.connectorLayer) return false;
  const [Graphic, Polyline, Point, SimpleLineSymbol, TextSymbol] = await Promise.all([
    importArc('@arcgis/core/Graphic.js'),
    importArc('@arcgis/core/geometry/Polyline.js'),
    importArc('@arcgis/core/geometry/Point.js'),
    importArc('@arcgis/core/symbols/SimpleLineSymbol.js'),
    importArc('@arcgis/core/symbols/TextSymbol.js')
  ]);
  layers.connectorLayer.add(new Graphic({
    geometry: new Polyline({
      paths: [[
        [record.longitude, record.latitude],
        [record.aoiNearestBoundary.longitude, record.aoiNearestBoundary.latitude]
      ]],
      spatialReference: { wkid: 4326 }
    }),
    symbol: new SimpleLineSymbol(connectorSymbol()),
    attributes: {
      role: 'pi-aoi-distance',
      meaning: CONNECTOR_MEANING,
      dependency: 0,
      flow: 0,
      coverage: 0
    }
  }));
  const distance = formatAoiDistanceLabel(record.aoiBoundaryDistanceMeters);
  if (distance) {
    const along = 0.18;
    layers.connectorLayer.add(new Graphic({
      geometry: new Point({
        longitude: record.longitude + (record.aoiNearestBoundary.longitude - record.longitude) * along,
        latitude: record.latitude + (record.aoiNearestBoundary.latitude - record.latitude) * along
      }),
      symbol: new TextSymbol({
        text: `${distance} OUTSIDE AOI`,
        color: [214, 222, 150, 0.95],
        haloColor: [18, 24, 16, 0.88],
        haloSize: 1.1,
        font: { family: 'Arial', size: 8, weight: 'normal' },
        horizontalAlignment: 'center',
        verticalAlignment: 'middle'
      }),
      attributes: {
        role: 'pi-aoi-distance-label',
        meaning: CONNECTOR_MEANING,
        dependency: 0,
        flow: 0
      }
    }));
  }
  return true;
}

export async function hideDistanceConnector() {
  const view = getMapView();
  connectorLayer = connectorLayer || view?.map?.findLayerById(POINT_INTEL_CONNECTOR_LAYER_ID) || null;
  connectorLayer?.removeAll?.();
}

export function getAcquisitionLayerState() {
  const view = getMapView();
  const webMap = view?.map;
  const aoi = aoiLayer || webMap?.findLayerById(POINT_INTEL_AOI_LAYER_ID);
  const connector = connectorLayer || webMap?.findLayerById(POINT_INTEL_CONNECTOR_LAYER_ID);
  const footprint = footprintLayer || webMap?.findLayerById(POINT_INTEL_FOOTPRINT_LAYER_ID);
  return {
    aoiGraphics: aoi?.graphics?.length ?? 0,
    connectorGraphics: connector?.graphics?.length ?? 0,
    footprintGraphics: footprint?.graphics?.length ?? 0,
    hasAoi: Boolean(currentAoiPolygon),
    connectorMeaning: CONNECTOR_MEANING
  };
}
