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
  circlePolygon,
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
    color: [196, 214, 72, 0.2],
    style: 'diagonal-cross',
    outline: {
      color: [168, 186, 52, 0.95],
      width: 1.35
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
          color: [196, 214, 72, 28]
        },
        {
          type: 'CIMHatchFill',
          enable: true,
          rotation: 0,
          separation: 12,
          lineSymbol: {
            type: 'CIMLineSymbol',
            symbolLayers: [{
              type: 'CIMSolidStroke',
              enable: true,
              color: [176, 196, 72, 88],
              width: 0.45
            }]
          }
        },
        {
          type: 'CIMHatchFill',
          enable: true,
          rotation: 90,
          separation: 12,
          lineSymbol: {
            type: 'CIMLineSymbol',
            symbolLayers: [{
              type: 'CIMSolidStroke',
              enable: true,
              color: [176, 196, 72, 70],
              width: 0.4
            }]
          }
        },
        {
          type: 'CIMSolidStroke',
          enable: true,
          color: [168, 186, 52, 230],
          width: 1.35
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
  const rings = polygon?.coordinates || polygon?.rings;
  if (!rings?.length) return false;
  layers.aoiLayer.removeAll();
  let symbol;
  try {
    symbol = new CIMSymbol({ data: buildAcquisitionMeshCimData() });
  } catch {
    symbol = new SimpleFillSymbol(buildAcquisitionMeshSymbol());
  }
  layers.aoiLayer.add(new Graphic({
    geometry: new Polygon({ rings, spatialReference: { wkid: 4326 } }),
    symbol,
    attributes: {
      role: 'pi-aoi-mesh',
      meaning: 'ACQUISITION_ZONE',
      analytical: 0
    }
  }));
  currentAoiPolygon = polygon.type ? polygon : toGeoJsonPolygon(rings);
  return true;
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
  const [Graphic, Polyline, SimpleLineSymbol] = await Promise.all([
    importArc('@arcgis/core/Graphic.js'),
    importArc('@arcgis/core/geometry/Polyline.js'),
    importArc('@arcgis/core/symbols/SimpleLineSymbol.js')
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
