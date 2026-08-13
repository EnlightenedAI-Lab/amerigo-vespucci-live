/**
 * Temporary Point Intelligence map presentation — click marker + thinned evidence.
 */
import {
  addRuntimeLayer,
  getMapView,
  importArc
} from './spatial-arcgis-runtime.js';
import {
  buildPointIntelligenceMapPresentation,
  getObservationId
} from './point-intelligence-map-presentation.js';
import { getPointIntelligenceFocusState } from './point-intelligence-focus-state.js';
import { isProofSourceFamily } from './point-intelligence-station-model.js';
import {
  POINT_INTEL_SELECTION_LAYER_ID,
  POINT_INTEL_STATION_LAYER_ID,
  applyStationSelection,
  clearPointIntelligenceStationLayer,
  findStationRecordByObservationId,
  hitTestPointIntelligenceStation,
  renderPointIntelligenceStationLayer
} from './point-intelligence-station-layer.js';
import {
  clearAcquisitionMesh,
  clearQuickPointFootprint,
  hideDistanceConnector,
  renderQuickPointFootprint
} from './point-intelligence-aoi-layer.js';
import { DEFAULT_RADIUS_METERS } from './point-intelligence-config.js';

export const POINT_INTEL_CLICK_LAYER_ID = 'iqai-point-intel-click';
export const POINT_INTEL_RESULTS_LAYER_ID = 'iqai-point-intel-results';
export { POINT_INTEL_STATION_LAYER_ID };

const FAMILY_COLORS = Object.freeze({
  hydrometric: [46, 125, 210, 0.92],
  'hydrometric-measurement': [0, 92, 175, 0.92],
  climate: [139, 69, 19, 0.92],
  'climate-hourly': [160, 82, 45, 0.92],
  weather: [76, 175, 80, 0.92],
  'weather-current': [56, 142, 60, 0.92],
  'air-quality': [156, 39, 176, 0.92]
});

/** @type {import('@arcgis/core/layers/GraphicsLayer').default | null} */
let clickLayer = null;
/** @type {import('@arcgis/core/layers/GraphicsLayer').default | null} */
let resultsLayer = null;
/** @type {import('./point-intelligence-map-presentation.js').MapPresentationModel | null} */
let currentPresentation = null;

async function ensureGraphicsLayer(layerId, title) {
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
  return null;
}

function markerSymbol(family, { emphasized = false, deemphasized = false } = {}) {
  const base = FAMILY_COLORS[family] || [46, 125, 210, 0.92];
  const alpha = deemphasized ? 0.28 : emphasized ? 1 : 0.82;
  const size = emphasized ? 14 : deemphasized ? 8 : 10;
  const color = [base[0], base[1], base[2], alpha];
  return {
    style: 'circle',
    color,
    size,
    outline: {
      color: emphasized ? [255, 255, 255, 1] : [255, 255, 255, 0.9],
      width: emphasized ? 2.5 : 1.5
    }
  };
}

export async function clearPointIntelligenceQueryPresentation() {
  const view = getMapView();
  const webMap = view?.map;
  if (webMap) {
    for (const layerId of [POINT_INTEL_CLICK_LAYER_ID, POINT_INTEL_RESULTS_LAYER_ID]) {
      const layer = webMap.findLayerById(layerId);
      if (layer) layer.removeAll?.();
    }
  }
  await clearPointIntelligenceStationLayer();
  await clearQuickPointFootprint();
  await hideDistanceConnector();
  clickLayer = null;
  resultsLayer = null;
  currentPresentation = null;
}

export async function clearPointIntelligenceLayers() {
  await clearPointIntelligenceQueryPresentation();
  await clearAcquisitionMesh();
}

/**
 * @param {{ longitude: number, latitude: number }} point
 */
export async function renderPointIntelligenceClickMarker(point) {
  const [SimpleMarkerSymbol, Graphic, Point] = await Promise.all([
    importArc('@arcgis/core/symbols/SimpleMarkerSymbol.js'),
    importArc('@arcgis/core/Graphic.js'),
    importArc('@arcgis/core/geometry/Point.js')
  ]);

  clickLayer = await ensureGraphicsLayer(POINT_INTEL_CLICK_LAYER_ID, 'Point Intelligence query');
  if (!clickLayer) return;

  clickLayer.removeAll();
  const geometry = new Point({ longitude: point.longitude, latitude: point.latitude });
  const symbol = new SimpleMarkerSymbol({
    style: 'cross',
    color: [255, 140, 0, 0.95],
    size: 14,
    outline: { color: [255, 255, 255, 0.95], width: 2 }
  });
  clickLayer.add(new Graphic({ geometry, symbol, attributes: { role: 'pi-click' } }));
}

/**
 * @param {object[]} results
 * @param {object} [focusState]
 */
export async function renderPointIntelligenceMapPresentation(results = [], focusState = null, options = {}) {
  const resolvedFocus = focusState || getPointIntelligenceFocusState();
  const presentation = buildPointIntelligenceMapPresentation(results, resolvedFocus);
  const stationRecords = await renderPointIntelligenceStationLayer(results, resolvedFocus, options);

  const [SimpleMarkerSymbol, Graphic, Point, Polyline, Polygon] = await Promise.all([
    importArc('@arcgis/core/symbols/SimpleMarkerSymbol.js'),
    importArc('@arcgis/core/Graphic.js'),
    importArc('@arcgis/core/geometry/Point.js'),
    importArc('@arcgis/core/geometry/Polyline.js'),
    importArc('@arcgis/core/geometry/Polygon.js')
  ]);

  resultsLayer = await ensureGraphicsLayer(POINT_INTEL_RESULTS_LAYER_ID, 'Point Intelligence sources');
  const graphics = [];
  if (resultsLayer) {
    resultsLayer.removeAll();
    for (const asset of presentation.renderedMarkers) {
      if (isProofSourceFamily(asset.family)) continue;
      const arcGeometry = geometryToArc(asset.geometry, Point, Polyline, Polygon);
      if (!arcGeometry) continue;
      const symbol = arcGeometry.type === 'point'
        ? new SimpleMarkerSymbol(markerSymbol(asset.family, asset))
        : undefined;
      graphics.push(new Graphic({
        geometry: arcGeometry,
        symbol,
        attributes: {
          role: 'pi-evidence',
          category: asset.family,
          assetKey: asset.assetKey,
          observationId: asset.representativeObservationId,
          observationIds: asset.observationIds.join('|'),
          observationCount: asset.observationCount,
          emphasized: asset.emphasized ? 1 : 0,
          deemphasized: asset.deemphasized ? 1 : 0,
          nativeRecordId: asset.result?.nativeRecordId || null,
          providerName: asset.result?.providerName || null
        }
      }));
    }
    if (graphics.length) resultsLayer.addMany(graphics);
  }

  currentPresentation = {
    ...presentation,
    stationRecords,
    accounting: {
      ...presentation.accounting,
      stationObjects: stationRecords.length,
      renderedMapLocations: stationRecords.length + graphics.length
    }
  };
  raisePointIntelligenceStationLayers();
  await applyStationSelection(resolvedFocus);
  return currentPresentation;
}

function raisePointIntelligenceStationLayers() {
  const view = getMapView();
  const map = view?.map;
  if (!map) return;
  const aoi = map.findLayerById('iqai-point-intel-aoi');
  const footprint = map.findLayerById('iqai-point-intel-footprint');
  const connector = map.findLayerById('iqai-point-intel-aoi-link');
  const stations = map.findLayerById(POINT_INTEL_STATION_LAYER_ID);
  const selection = map.findLayerById(POINT_INTEL_SELECTION_LAYER_ID);
  const last = map.layers.length - 1;
  if (footprint) map.reorder(footprint, Math.max(0, last - 4));
  if (aoi) map.reorder(aoi, Math.max(0, last - 3));
  if (stations) map.reorder(stations, last - 1);
  if (connector) map.reorder(connector, last);
  if (selection) map.reorder(selection, last);
}

/**
 * @param {{ longitude: number, latitude: number }} point
 * @param {object[]} results
 * @param {object} [focusState]
 */
export async function replacePointIntelligencePresentation(point, results = [], focusState = null, options = {}) {
  if (options.preserveAoi) {
    await clearPointIntelligenceQueryPresentation();
  } else {
    await clearPointIntelligenceLayers();
  }
  if (!options.skipClickMarker && point) {
    await renderPointIntelligenceClickMarker(point);
    const radius = Number.isFinite(options.radiusMeters) ? options.radiusMeters : DEFAULT_RADIUS_METERS;
    await renderQuickPointFootprint(point, radius);
  }
  return renderPointIntelligenceMapPresentation(results, focusState, options);
}

/**
 * @param {object} mapEvent
 */
export async function hitTestPointIntelligenceEvidence(mapEvent) {
  const stationHit = await hitTestPointIntelligenceStation(mapEvent);
  if (stationHit?.observationId) return stationHit;

  const view = getMapView();
  if (!view?.hitTest) return null;
  const response = await view.hitTest(mapEvent);
  const hit = (response?.results || []).find((entry) => {
    const layerId = entry?.graphic?.layer?.id || entry?.layer?.id;
    return layerId === POINT_INTEL_RESULTS_LAYER_ID
      && entry?.graphic?.attributes?.role === 'pi-evidence';
  });
  if (!hit?.graphic) return null;
  const attrs = hit.graphic.attributes || {};
  return {
    observationId: attrs.observationId,
    family: attrs.category,
    assetKey: attrs.assetKey,
    observationIds: String(attrs.observationIds || '').split('|').filter(Boolean),
    graphic: hit.graphic
  };
}

/**
 * @param {string} observationId
 */
export async function ensureObservationVisible(observationId) {
  const view = getMapView();
  if (!view || !observationId) return;

  const graphic = resultsLayer?.graphics?.find?.(
    (g) => g.attributes?.observationId === observationId
      || String(g.attributes?.observationIds || '').split('|').includes(observationId)
  );
  if (graphic?.geometry) {
    try {
      if (view.extent?.contains?.(graphic.geometry)) return;
      await view.goTo({ target: graphic, scale: view.scale }, { duration: 250 });
    } catch {
      // extent adjustment is best-effort
    }
    return;
  }

  const station = findStationRecordByObservationId(observationId);
  if (!station) return;
  try {
    const Point = await importArc('@arcgis/core/geometry/Point.js');
    const target = new Point({ longitude: station.longitude, latitude: station.latitude });
    if (view.extent?.contains?.(target)) return;
    await view.goTo({ target, scale: view.scale }, { duration: 250 });
  } catch {
    // best-effort
  }
}

export function getPointIntelligenceLayerState() {
  const view = getMapView();
  const webMap = view?.map;
  if (!webMap) {
    return { clickGraphics: 0, resultGraphics: 0, mapPresentation: null };
  }
  const click = webMap.findLayerById(POINT_INTEL_CLICK_LAYER_ID);
  const results = webMap.findLayerById(POINT_INTEL_RESULTS_LAYER_ID);
  const stations = webMap.findLayerById(POINT_INTEL_STATION_LAYER_ID);
  return {
    clickGraphics: click?.graphics?.length ?? 0,
    resultGraphics: results?.graphics?.length ?? 0,
    stationFeatures: currentPresentation?.stationRecords?.length ?? 0,
    stationLayerPresent: Boolean(stations),
    mapPresentation: currentPresentation
  };
}

export function getCurrentMapPresentation() {
  return currentPresentation;
}

export { getObservationId };
