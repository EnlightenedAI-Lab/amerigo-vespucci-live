/**
 * Agent 2 open-world intelligence map graphics — distinct from Agent 5 PI layers.
 */
import { addRuntimeLayer, getMapView, importArc } from './spatial-arcgis-runtime.js';
import { getOpenWorldMapState } from './open-world-intelligence-map-state.js';

export const OPEN_WORLD_INTEL_LAYER_ID = 'iqai-open-world-intel';

const FAMILY_COLORS = Object.freeze({
  ECCC: [220, 53, 69, 0.72],
  NEWS: [0, 102, 204, 0.78],
  PUBLIC_SAFETY: [128, 0, 128, 0.78],
  INFRASTRUCTURE: [96, 96, 96, 0.78],
  SOCIAL: [29, 161, 242, 0.78],
  X: [15, 20, 25, 0.82],
  VIDEO: [255, 0, 0, 0.78]
});

/** @type {import('@arcgis/core/layers/GraphicsLayer').default | null} */
let intelLayer = null;
/** @type {Map<string, import('@arcgis/core/Graphic').default>} */
let graphicByResultId = new Map();

async function ensureIntelLayer() {
  const view = getMapView();
  const webMap = view?.map;
  if (!webMap) return null;

  const existing = webMap.findLayerById(OPEN_WORLD_INTEL_LAYER_ID);
  if (existing) {
    intelLayer = existing;
    return existing;
  }

  const GraphicsLayer = await importArc('@arcgis/core/layers/GraphicsLayer.js');
  const layer = new GraphicsLayer({
    id: OPEN_WORLD_INTEL_LAYER_ID,
    title: 'Open-world intelligence',
    listMode: 'hide',
    popupEnabled: false
  });
  addRuntimeLayer(layer);
  intelLayer = layer;
  return layer;
}

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
    const rings = geometry.coordinates.flatMap((poly) => poly);
    return new Polygon({ rings });
  }
  return null;
}

function familyColor(sourceFamily, { emphasized = false, deemphasized = false } = {}) {
  const key = String(sourceFamily || '').toUpperCase();
  const base = FAMILY_COLORS[key] || [255, 107, 0, 0.82];
  const alpha = deemphasized ? 0.22 : emphasized ? 0.95 : base[3];
  return [base[0], base[1], base[2], alpha];
}

function buildSymbols(family, geometryType, { emphasized = false, deemphasized = false } = {}) {
  const color = familyColor(family, { emphasized, deemphasized });
  if (geometryType === 'polygon' || geometryType === 'polyline') {
    return {
      fill: {
        style: 'solid',
        color,
        outline: {
          color: emphasized ? [255, 255, 255, 1] : [40, 40, 40, 0.85],
          width: emphasized ? 2.5 : 1.25
        }
      },
      marker: null
    };
  }
  return {
    fill: null,
    marker: {
      style: 'diamond',
      color,
      size: emphasized ? 16 : deemphasized ? 9 : 12,
      outline: {
        color: emphasized ? [255, 255, 255, 1] : [255, 255, 255, 0.95],
        width: emphasized ? 2.5 : 1.5
      }
    }
  };
}

export async function clearOpenWorldIntelligenceLayer() {
  const view = getMapView();
  const webMap = view?.map;
  if (!webMap) {
    graphicByResultId = new Map();
    return;
  }
  const layer = webMap.findLayerById(OPEN_WORLD_INTEL_LAYER_ID);
  layer?.removeAll?.();
  intelLayer = layer || null;
  graphicByResultId = new Map();
}

/**
 * @param {object[]} spatialItems normalized spatial results
 * @param {string | null} [focusedResultId]
 */
export async function renderOpenWorldIntelligenceMap(spatialItems = [], focusedResultId = null) {
  const [
    SimpleMarkerSymbol,
    SimpleFillSymbol,
    SimpleLineSymbol,
    Graphic,
    Point,
    Polyline,
    Polygon
  ] = await Promise.all([
    importArc('@arcgis/core/symbols/SimpleMarkerSymbol.js'),
    importArc('@arcgis/core/symbols/SimpleFillSymbol.js'),
    importArc('@arcgis/core/symbols/SimpleLineSymbol.js'),
    importArc('@arcgis/core/Graphic.js'),
    importArc('@arcgis/core/geometry/Point.js'),
    importArc('@arcgis/core/geometry/Polyline.js'),
    importArc('@arcgis/core/geometry/Polygon.js')
  ]);

  const layer = await ensureIntelLayer();
  if (!layer) return { rendered: 0, skipped: spatialItems.length };

  layer.removeAll();
  graphicByResultId = new Map();

  const graphics = [];
  let skipped = 0;
  for (const item of spatialItems) {
    const arcGeometry = geometryToArc(item.geometry, Point, Polyline, Polygon);
    if (!arcGeometry) {
      skipped += 1;
      continue;
    }
    const geomType = String(arcGeometry.type || '').toLowerCase();
    const emphasized = focusedResultId && item.id === focusedResultId;
    const deemphasized = Boolean(focusedResultId && item.id !== focusedResultId);
    const symbols = buildSymbols(item.sourceFamily, geomType, { emphasized, deemphasized });

    let symbol = null;
    if (geomType === 'polygon' && symbols.fill) {
      symbol = new SimpleFillSymbol(symbols.fill);
    } else if (geomType === 'polyline') {
      symbol = new SimpleLineSymbol({
        color: familyColor(item.sourceFamily, { emphasized, deemphasized }),
        width: emphasized ? 3 : 2
      });
    } else if (symbols.marker) {
      symbol = new SimpleMarkerSymbol(symbols.marker);
    }

    const graphic = new Graphic({
      geometry: arcGeometry,
      symbol,
      attributes: {
        role: 'owi-event',
        resultId: item.id,
        kind: item.kind,
        title: item.title,
        sourceFamily: item.sourceFamily || null
      }
    });
    graphics.push(graphic);
    graphicByResultId.set(item.id, graphic);
  }

  if (graphics.length) layer.addMany(graphics);
  return { rendered: graphics.length, skipped };
}

/**
 * @param {string} resultId
 */
export async function emphasizeOpenWorldMapResult(resultId) {
  const mapState = getOpenWorldMapState();
  const spatial = mapState.presentation?.spatialItems || [];
  await renderOpenWorldIntelligenceMap(spatial, resultId);
  const graphic = graphicByResultId.get(resultId);
  const view = getMapView();
  if (graphic?.geometry && view) {
    await view.goTo({ target: graphic, padding: 48 }, { duration: 350 }).catch(() => {});
  }
}

/**
 * @param {object} mapEvent
 */
export async function hitTestOpenWorldIntelligenceFeature(mapEvent) {
  const view = getMapView();
  if (!view?.hitTest) return null;
  const response = await view.hitTest(mapEvent);
  const hit = (response?.results || []).find((entry) => {
    const layerId = entry?.graphic?.layer?.id || entry?.layer?.id;
    return layerId === OPEN_WORLD_INTEL_LAYER_ID
      && entry?.graphic?.attributes?.role === 'owi-event';
  });
  if (!hit?.graphic) return null;
  const attrs = hit.graphic.attributes || {};
  return {
    resultId: attrs.resultId,
    kind: attrs.kind,
    title: attrs.title,
    graphic: hit.graphic
  };
}

export function getOpenWorldIntelligenceLayerState() {
  const view = getMapView();
  const webMap = view?.map;
  const layer = webMap?.findLayerById(OPEN_WORLD_INTEL_LAYER_ID);
  return {
    graphics: layer?.graphics?.length ?? 0,
    trackedResults: graphicByResultId.size
  };
}
