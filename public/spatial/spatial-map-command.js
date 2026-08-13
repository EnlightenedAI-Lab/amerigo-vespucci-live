/**
 * Render deterministic MAP results on the existing Montreal 1 MapView.
 */
import {
  clearRuntimeLayers,
  addRuntimeLayer,
  zoomTo,
  getMapView,
  getWebMap,
  importArc
} from './spatial-arcgis-runtime.js';
import { describePopupTemplate } from './agol-feature-details.js';
import {
  markMapDiagStage,
  captureMapCommandFailure,
  snapshotFirstFeature,
  wrapMapCommandError,
  getCurrentMapDiagStage
} from './map-command-diagnostics.js';
import { clearPresentationFidelityRecords, getSourcePresentation, getOsmNaAmenitiesSourceDef, findWebMapLayerByServiceUrl, hydratePresentationRenderer, isAuthoritativeAmenitiesMapResult, describeAmenitiesSourceEligibility, normalizeRendererClassValue } from './source-presentation.js';
import { buildSafeResultRenderer } from './iqai-result-renderer.js';
import { buildCleanOsmPopupTemplate } from './iqai-osm-presentation.js';
import { getResultSymbol } from './result-symbol-registry.js';
import { findLayerByIdRecursive } from './runtime-layer-groups.js';
import { findRuntimeLayerByCatalogId } from './webmap-layer-catalog.js';
import { recordAuthNativeProvenance } from './a1-runtime-provenance.js';
import { SPVM_LAYER_ID } from './spvm-recent-crime-config.js';
import { guardRendererWrite, getActiveCommandId } from './deterministic-command-transaction.js';
import {
  publishRendererDisplayState,
  resetRendererDisplayState,
  resolveRendererBadgeMode
} from './spatial-renderer-telemetry.js';

function writeResultRenderer(partial, commandId = getActiveCommandId()) {
  if (typeof window === 'undefined') return false;
  if (!guardRendererWrite(commandId, 'result_renderer')) return false;
  window.__IQAI_RESULT_RENDERER__ = {
    ...(window.__IQAI_RESULT_RENDERER__ || {}),
    ...partial,
    commandId
  };
  return true;
}

function mutateResultRenderer(mutator, commandId = getActiveCommandId()) {
  if (typeof window === 'undefined' || !window.__IQAI_RESULT_RENDERER__) return false;
  if (!guardRendererWrite(commandId, 'result_renderer_mutate')) return false;
  mutator(window.__IQAI_RESULT_RENDERER__);
  window.__IQAI_RESULT_RENDERER__.commandId = commandId;
  return true;
}
import {
  beginAuthNativeDiagnostic,
  recordAuthNativeStage,
  failAuthNativeDiagnostic,
  succeedAuthNativeDiagnostic,
  compareSourceIdentity,
  listWebMapLayerCandidates
} from './spatial-auth-native-diagnostic.js';

const RUNTIME_GROUP_ID = 'iqai-map-result';
export const DETERMINISTIC_RESULTS_LAYER_ID = 'iqai-deterministic-results';

/** @type {import('@arcgis/core/layers/FeatureLayer').default | null} */
let deterministicResultsLayer = null;
let deterministicRendererField = 'amenity';
let deterministicBaseDefinitionExpression = null;
/** @type {number[] | null} */
let deterministicBaseObjectIds = null;
let deterministicUsesLayerViewFilter = false;
let authNativeActive = false;
/** @type {import('@arcgis/core/layers/FeatureLayer').default | null} */
let authoritativeDisplayLayer = null;
/** @type {Map<string, number[]>} */
let categoryObjectIdMap = new Map();
/** @type {{ layer: object, visible: boolean }[]} */
let authNativeVisibilityRestoreStack = [];

function buildAuthNativeVisibilityRestoreStack(layer) {
  const stack = [];
  let current = layer;
  while (current) {
    stack.push({ layer: current, visible: Boolean(current.visible) });
    current = current.parent;
  }
  return stack;
}

function beginAuthNativeVisibilityOverride(sourceLayer) {
  authNativeVisibilityRestoreStack = buildAuthNativeVisibilityRestoreStack(sourceLayer);
  for (const entry of authNativeVisibilityRestoreStack) {
    entry.layer.visible = true;
  }
}

function ensureAuthNativeLayersVisible(sourceLayer) {
  if (!sourceLayer) return;
  if (!authNativeVisibilityRestoreStack.length) {
    beginAuthNativeVisibilityOverride(sourceLayer);
    return;
  }
  let current = sourceLayer;
  while (current) {
    if (!current.visible) current.visible = true;
    current = current.parent;
  }
}

function restoreAuthNativeVisibilityState() {
  for (const entry of authNativeVisibilityRestoreStack) {
    entry.layer.visible = entry.visible;
  }
  authNativeVisibilityRestoreStack = [];
}

function resolveCategoryObjectIds(categoryValue) {
  if (!categoryValue) return deterministicBaseObjectIds || [];
  const direct = categoryObjectIdMap.get(categoryValue);
  if (direct?.length) return direct;
  const needle = normalizeRendererClassValue(categoryValue);
  for (const [key, ids] of categoryObjectIdMap.entries()) {
    if (normalizeRendererClassValue(key) === needle) return ids;
  }
  return [];
}

const MONTREAL_BBOX = {
  minLat: 45.41,
  maxLat: 45.70,
  minLon: -73.98,
  maxLon: -73.47
};

/** @type {import('@arcgis/core/core/Handles').Handle[]} */
let popupWatchHandles = [];
/** @type {import('@arcgis/core/core/Handles').Handle | null} */
let clickHandle = null;
/** @type {boolean} */
let pointIntelligenceModeEnabled = false;
/** @type {((point: { longitude: number, latitude: number, event: object }) => (void|Promise<void>)) | null} */
let pointIntelligenceClickHandler = null;
/** @type {object | null} */
let lastClickDiagnostic = null;
/** @type {object | null} */
let webMapLayerInspect = null;
/** @type {import('@arcgis/core/layers/FeatureLayer').default[]} */
let iqaiResultFeatureLayers = [];
/** @type {{ action?: string, radiusMeters?: number, originLon?: number, originLat?: number, isLocate?: boolean, searchCircleGeometry?: object } | null} */
let lastScopedQueryContext = null;
/** @type {import('@arcgis/core/core/Handles').Handle[]} */
let highlightHandles = [];

function clearSelectionHighlight() {
  for (const handle of highlightHandles) {
    try {
      handle.remove();
    } catch {
      // ignore
    }
  }
  highlightHandles = [];
}

async function highlightIqaiFeature(view, layer, graphic) {
  clearSelectionHighlight();
  if (!view || !layer || !graphic) return;
  try {
    const layerView = await view.whenLayerView(layer);
    if (!layerView?.highlight) return;
    const objectId = graphic.attributes?.OBJECTID ?? graphic.attributes?.ObjectID;
    let handle = null;
    if (objectId != null && objectId !== '') {
      handle = layerView.highlight(Number(objectId));
    }
    if (!handle) {
      handle = layerView.highlight(graphic);
    }
    if (handle) highlightHandles.push(handle);
  } catch {
    // ignore highlight failures
  }
}

function isIqaiRuntimeFeatureLayer(layer) {
  if (!layer?.id?.startsWith('iqai-')) return false;
  if (
    layer.id === 'iqai-search-location'
    || layer.id === 'iqai-search-area'
    || layer.id === 'iqai-map-result'
    || layer.id === 'iqai-features'
  ) {
    return false;
  }
  return layer.type === 'feature';
}

function isInMontrealArea(longitude, latitude) {
  if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) return false;
  return latitude >= MONTREAL_BBOX.minLat
    && latitude <= MONTREAL_BBOX.maxLat
    && longitude >= MONTREAL_BBOX.minLon
    && longitude <= MONTREAL_BBOX.maxLon;
}

function geometrySampleForFeature(feature, Point, fromJSON) {
  const coords = featureCoordinates(feature);
  if (coords) {
    return {
      x: coords.longitude,
      y: coords.latitude,
      spatialReference: 4326,
      coordinateKind: 'geographic_lon_lat',
      inMontreal: isInMontrealArea(coords.longitude, coords.latitude)
    };
  }
  if (!feature.geometry || !fromJSON) return null;
  try {
    const geometry = fromJSON(feature.geometry);
    const wkid = geometry.spatialReference?.wkid ?? geometry.spatialReference?.latestWkid ?? null;
    const x = geometry.longitude ?? geometry.x;
    const y = geometry.latitude ?? geometry.y;
    const geographic = Number.isFinite(geometry.longitude) && Number.isFinite(geometry.latitude);
    return {
      x,
      y,
      spatialReference: wkid,
      coordinateKind: geographic ? 'geographic_lon_lat' : 'projected_xy',
      inMontreal: geographic ? isInMontrealArea(x, y) : null
    };
  } catch {
    return null;
  }
}

function graphicForDeterministicFeature(feature, result, fallbackObjectId, Graphic, Point, fromJSON) {
  const coords = featureCoordinates(feature);
  let geometry = null;
  if (coords) {
    geometry = new Point({
      longitude: coords.longitude,
      latitude: coords.latitude,
      spatialReference: { wkid: 4326 }
    });
  } else if (feature.geometry && fromJSON) {
    try {
      geometry = fromJSON(feature.geometry);
    } catch {
      geometry = null;
    }
  }
  if (!geometry) return null;

  const dataset = {
    datasetId: result?.datasetId || feature.datasetId,
    displayName: result?.displayName || feature.sourceName,
    iqaiType: result?.iqaiType || feature.iqaiType
  };
  const raw = feature.rawAttributes || {};
  const categoryValue = raw.amenity ?? raw.category ?? result?.renderMeta?.semanticValue ?? feature.iqaiType ?? null;
  const sourceObjectId = feature.objectId ?? raw.OBJECTID ?? raw.ObjectID ?? fallbackObjectId;

  return new Graphic({
    geometry,
    attributes: {
      ...raw,
      OBJECTID: sourceObjectId,
      ...featureAttributes(feature, dataset),
      name: feature.name ?? raw.name ?? raw.name_en ?? raw.name_fr ?? '—',
      amenity: categoryValue,
      category: categoryValue,
      address: feature.address ?? raw.addr_street ?? raw.address ?? '—',
      conceptId: feature.conceptId || result?.conceptId || null,
      datasetId: dataset.datasetId || null
    }
  });
}

/**
 * Collect all deterministic point features into one graphics array.
 * @param {object} mapResult
 * @param {{ Graphic: typeof import('@arcgis/core/Graphic'), Point: typeof import('@arcgis/core/geometry/Point'), fromJSON: Function }} modules
 */
async function collectDeterministicGraphics(mapResult, modules) {
  const { Graphic, Point, fromJSON } = modules;
  const graphics = [];
  const geometrySamples = [];
  let objectId = 1;
  const datasetResults = mapResult.datasetResults || [];

  const pushFeature = (feature, result) => {
    if (geometrySamples.length < 10) {
      const sample = geometrySampleForFeature(feature, Point, fromJSON);
      if (sample) geometrySamples.push(sample);
    }
    const graphic = graphicForDeterministicFeature(feature, result, objectId, Graphic, Point, fromJSON);
    if (!graphic) return;
    graphics.push(graphic);
    objectId += 1;
  };

  if (datasetResults.length) {
    for (const result of datasetResults) {
      for (const feature of featuresForDatasetResult(result, mapResult)) {
        pushFeature(feature, result);
      }
    }
  } else {
    for (const feature of mapResult.features || []) {
      pushFeature(feature, {
        datasetId: feature.datasetId,
        displayName: mapResult.summary?.dataset
      });
    }
  }

  if (typeof window !== 'undefined') {
    window.__IQAI_GEOMETRY_SAMPLES__ = geometrySamples;
  }
  console.log('[IQAI Deterministic Results] First geometry samples', geometrySamples);

  return { graphics, geometrySamples };
}

function recordScopedLayerAttempt(partial) {
  if (typeof window === 'undefined') return;
  window.__IQAI_SCOPED_LAYER_ATTEMPT__ = {
    ...(window.__IQAI_SCOPED_LAYER_ATTEMPT__ || {}),
    ...partial,
    at: new Date().toISOString()
  };
}

function reportDeterministicDisplayState(layer) {
  const commandId = getActiveCommandId();
  if (authNativeActive && authoritativeDisplayLayer) {
    publishRendererDisplayState({
      commandId,
      rendererMode: 'AUTH-NATIVE',
      displayLayerId: authoritativeDisplayLayer.id || null,
      displayLayerTitle: authoritativeDisplayLayer.title || null,
      usesLayerViewFilter: true,
      usesObjectIdFilter: true,
      runtimeFallbackActive: false,
      iqaiDeterministicResultsActive: false,
      authoritativeWebMapLayerActive: true,
      baseResultObjectIdCount: deterministicBaseObjectIds?.length ?? null,
      activeObjectIdCount: window.__IQAI_RESULT_RENDERER__?.activeObjectIdCount
        ?? deterministicBaseObjectIds?.length
        ?? null,
      activeCategory: window.__IQAI_RESULT_RENDERER__?.activeCategory ?? null,
      sourceLayerVisible: Boolean(authoritativeDisplayLayer.visible),
      layerViewSuspended: window.__IQAI_AUTH_NATIVE_VISIBILITY__?.layerViewSuspended ?? null
    });
    return;
  }
  if (!layer) {
    resetRendererDisplayState();
    return;
  }
  const scoped = typeof window !== 'undefined' ? window.__IQAI_SCOPED_LAYER_ATTEMPT__ : null;
  const renderer = typeof window !== 'undefined' ? window.__IQAI_RESULT_RENDERER__ : null;
  const rendererMode = resolveRendererBadgeMode(renderer?.mode, scoped);
  const sourceDef = getOsmNaAmenitiesSourceDef();
  const webMap = getWebMap();
  const authLayer = webMap ? findWebMapLayerByServiceUrl(webMap, sourceDef.serviceUrl) : null;

  publishRendererDisplayState({
    commandId,
    rendererMode,
    displayLayerId: layer.id || null,
    displayLayerTitle: layer.title || null,
    usesLayerViewFilter: Boolean(deterministicUsesLayerViewFilter),
    usesObjectIdFilter: Boolean(deterministicUsesLayerViewFilter),
    runtimeFallbackActive: rendererMode === 'RUNTIME-FALLBACK',
    iqaiDeterministicResultsActive: layer.id === DETERMINISTIC_RESULTS_LAYER_ID,
    authoritativeWebMapLayerActive: Boolean(authLayer?.visible),
    fallbackReason: renderer?.fallbackReason || scoped?.reason || null,
    authNativeShortReason: typeof window !== 'undefined'
      ? window.__IQAI_AUTH_NATIVE_DIAGNOSTIC__?.shortCode || null
      : null
  });
}

function buildCategoryObjectIdMap(mapResult, semanticField = 'amenity') {
  const map = new Map();
  for (const result of mapResult.datasetResults || []) {
    for (const feature of featuresForDatasetResult(result, mapResult)) {
      const raw = feature.rawAttributes || {};
      const category = raw[semanticField] ?? raw.amenity ?? raw.category ?? feature.iqaiType ?? null;
      const id = feature.objectId ?? raw.OBJECTID ?? raw.ObjectID;
      const numericId = Number(id);
      if (!category || !Number.isFinite(numericId)) continue;
      const key = String(category);
      if (!map.has(key)) map.set(key, []);
      const bucket = map.get(key);
      if (!bucket.includes(numericId)) bucket.push(numericId);
    }
  }
  return map;
}

async function verifyObjectIdProvenance(sourceLayer, objectIds, sourceDef) {
  const objectIdField = sourceLayer.objectIdField || 'OBJECTID';
  const sampleObjectIds = objectIds.slice(0, 10);
  const identity = compareSourceIdentity(sourceDef, sourceLayer);
  const provenance = {
    ...identity,
    objectIdField,
    deterministicObjectIdCount: objectIds.length,
    sampleObjectIds,
    sampleExistsOnAuthoritative: null,
    sampleQueryError: null,
    sampleFoundCount: null
  };
  if (!sampleObjectIds.length) return provenance;
  try {
    const result = await sourceLayer.queryFeatures({
      objectIds: sampleObjectIds,
      outFields: [objectIdField],
      returnGeometry: false
    });
    const found = new Set();
    for (const feature of result.features || []) {
      const attrs = feature.attributes || {};
      for (const key of [objectIdField, 'OBJECTID', 'ObjectID', 'objectid', 'FID', 'OID']) {
        if (!key) continue;
        const id = Number(attrs[key]);
        if (Number.isFinite(id)) found.add(id);
      }
    }
    provenance.sampleFoundCount = found.size;
    provenance.sampleExistsOnAuthoritative = sampleObjectIds.some((id) => found.has(Number(id)));
  } catch (error) {
    provenance.sampleExistsOnAuthoritative = false;
    provenance.sampleQueryError = {
      name: error?.name || 'Error',
      message: error?.message || String(error)
    };
  }
  if (typeof window !== 'undefined') {
    window.__IQAI_OBJECTID_PROVENANCE__ = provenance;
  }
  return provenance;
}

async function clearAuthNativeDisplayFilter() {
  const view = getMapView();
  const layer = authoritativeDisplayLayer;
  if (layer && view) {
    try {
      const layerView = await view.whenLayerView(layer);
      layerView.filter = null;
    } catch {
      // layer view may already be destroyed
    }
  }
  restoreAuthNativeVisibilityState();
  authoritativeDisplayLayer = null;
  authNativeActive = false;
  categoryObjectIdMap = new Map();
  if (typeof window !== 'undefined') {
    window.__IQAI_AUTH_NATIVE_VISIBILITY__ = {
      cleared: true,
      at: new Date().toISOString()
    };
  }
}

function resolveAuthoritativeLayerUrl(sourceLayer, sourceDef) {
  const direct = String(sourceLayer?.url || '').replace(/\/$/, '');
  if (direct && /\/\d+$/.test(direct)) return direct;
  const serviceUrl = String(sourceLayer?.url || sourceDef.serviceUrl || '').replace(/\/$/, '');
  return `${serviceUrl}/${sourceDef.layerId ?? 0}`;
}

/**
 * Apply OBJECTID filter via LayerView on the authoritative WebMap layer or fallback layer.
 * @param {string | null} categoryValue
 */
async function applyDeterministicObjectIdFilter(categoryValue = null) {
  const layer = authNativeActive ? authoritativeDisplayLayer : deterministicResultsLayer;
  const filterDiag = {
    authNativeActive,
    hasLayer: Boolean(layer),
    usesLayerViewFilter: deterministicUsesLayerViewFilter,
    baseObjectIdCount: deterministicBaseObjectIds?.length || 0,
    categoryValue: categoryValue || null
  };
  recordAuthNativeStage('filter_enter', filterDiag);

  if (!deterministicUsesLayerViewFilter || !deterministicBaseObjectIds?.length || !layer) {
    recordAuthNativeStage('filter_precondition_failed', filterDiag);
    return false;
  }
  const view = getMapView();
  if (!view) {
    recordAuthNativeStage('filter_map_view_missing', filterDiag);
    return false;
  }
  recordAuthNativeStage('map_view_available', { mapViewReady: true });

  ensureAuthNativeLayersVisible(layer);

  let objectIds = categoryValue ? resolveCategoryObjectIds(categoryValue) : deterministicBaseObjectIds;
  if (categoryValue && !objectIds.length) {
    recordAuthNativeStage('category_object_ids_missing', {
      categoryValue,
      knownCategories: [...categoryObjectIdMap.keys()]
    });
    objectIds = deterministicBaseObjectIds;
  }

  let layerView;
  try {
    layerView = await view.whenLayerView(layer);
    recordAuthNativeStage('when_layer_view', {
      ok: true,
      layerId: layer.id || null,
      layerTitle: layer.title || null
    });
  } catch (error) {
    recordAuthNativeStage('when_layer_view', {
      ok: false,
      layerId: layer.id || null,
      exception: { name: error?.name, message: error?.message, stack: error?.stack }
    });
    throw error;
  }

  let FeatureFilter;
  try {
    FeatureFilter = await importArc('@arcgis/core/layers/support/FeatureFilter.js');
    recordAuthNativeStage('feature_filter_module', { ok: true });
  } catch (error) {
    recordAuthNativeStage('feature_filter_module', {
      ok: false,
      exception: { name: error?.name, message: error?.message }
    });
    throw error;
  }

  let filter;
  try {
    filter = new FeatureFilter({ objectIds });
    recordAuthNativeStage('feature_filter_create', {
      ok: true,
      objectIdCount: objectIds.length
    });
  } catch (error) {
    recordAuthNativeStage('feature_filter_create', {
      ok: false,
      exception: { name: error?.name, message: error?.message }
    });
    throw error;
  }

  try {
    layerView.filter = filter;
    const assignedCount = layerView.filter?.objectIds?.length ?? objectIds.length;
    recordAuthNativeStage('filter_assign', {
      ok: true,
      assignedObjectIdCount: assignedCount,
      sourceLayerVisible: layer.visible,
      layerViewVisible: layerView.visible,
      layerViewSuspended: layerView.suspended,
      activeCategory: categoryValue || null
    });
  } catch (error) {
    recordAuthNativeStage('filter_assign', {
      ok: false,
      exception: { name: error?.name, message: error?.message, stack: error?.stack }
    });
    throw error;
  }

  mutateResultRenderer((renderer) => {
    renderer.usesLayerViewFilter = true;
    renderer.usesObjectIdFilter = true;
    renderer.activeCategory = categoryValue || null;
    renderer.activeObjectIdCount = objectIds.length;
    renderer.baseResultObjectIdCount = deterministicBaseObjectIds?.length ?? null;
    renderer.sourceLayerVisible = layer.visible;
    renderer.layerViewSuspended = layerView.suspended;
  });
  if (typeof window !== 'undefined') {
    window.__IQAI_AUTH_NATIVE_VISIBILITY__ = {
      sourceLayerVisible: layer.visible,
      layerViewVisible: layerView.visible,
      layerViewSuspended: layerView.suspended,
      filterObjectIdCount: objectIds.length,
      activeCategory: categoryValue || null,
      baseResultObjectIdCount: deterministicBaseObjectIds?.length ?? null,
      visibilityRestoreStackDepth: authNativeVisibilityRestoreStack.length
    };
  }
  return true;
}

function escapeSqlLiteral(value) {
  return String(value || '').replace(/'/g, "''");
}

function cloneArcgisJson(value) {
  if (value == null) return null;
  if (typeof value.clone === 'function') return value.clone();
  if (typeof value.toJSON === 'function') return value.toJSON();
  return value;
}

function collectSourceObjectIds(mapResult) {
  const ids = [];
  const seen = new Set();
  const pushId = (id) => {
    const numericId = Number(id);
    if (!Number.isFinite(numericId) || seen.has(numericId)) return;
    seen.add(numericId);
    ids.push(numericId);
  };
  for (const result of mapResult.datasetResults || []) {
    if (Array.isArray(result.completeObjectIds) && result.completeObjectIds.length) {
      for (const id of result.completeObjectIds) pushId(id);
      continue;
    }
    const accountingIds = result.resultAccounting?.objectIds;
    if (Array.isArray(accountingIds) && accountingIds.length) {
      for (const id of accountingIds) pushId(id);
      continue;
    }
    for (const feature of featuresForDatasetResult(result, mapResult)) {
      const raw = feature.rawAttributes || {};
      const id = feature.objectId ?? raw.OBJECTID ?? raw.ObjectID ?? raw.objectid;
      pushId(id);
    }
  }
  if (!ids.length) {
    const globalIds = mapResult.resultAccounting?.objectIds;
    if (Array.isArray(globalIds)) {
      for (const id of globalIds) pushId(id);
    }
  }
  return ids;
}

async function resolvePresentationForMapResult(mapResult) {
  const primary = mapResult.datasetResults?.[0] || null;
  if (!primary) return null;
  if (primary.renderMeta?.sourcePresentation) {
    if (primary.sourceType === 'TRUSTED_EXTERNAL' || primary.sourceId === 'OSM_NA_AMENITIES') {
      return hydratePresentationRenderer(
        primary.renderMeta.sourcePresentation,
        getOsmNaAmenitiesSourceDef()
      );
    }
    return primary.renderMeta.sourcePresentation;
  }
  if (primary.sourceType === 'TRUSTED_EXTERNAL' || primary.sourceId === 'OSM_NA_AMENITIES') {
    return getSourcePresentation(getOsmNaAmenitiesSourceDef());
  }
  return null;
}

/**
 * AUTH-NATIVE: filter the existing WebMap Amenities FeatureLayer via LayerView.objectIds.
 * Does not clone layers, renderers, or create iqai-deterministic-results.
 * @param {object} mapResult
 */
async function tryActivateAuthNativeAmenitiesDisplay(mapResult) {
  beginAuthNativeDiagnostic({ path: 'tryActivateAuthNativeAmenitiesDisplay' });

  const sourceDef = getOsmNaAmenitiesSourceDef();
  const eligibility = describeAmenitiesSourceEligibility(mapResult, sourceDef);
  recordAuthNativeStage('source_identity_check', {
    canonicalSourceUrl: sourceDef.serviceUrl,
    canonicalLayerId: sourceDef.layerId ?? 0,
    datasetResults: eligibility
  });

  if (!isAuthoritativeAmenitiesMapResult(mapResult, sourceDef)) {
    failAuthNativeDiagnostic('source_identity_mismatch', {
      failureStage: 'source_identity_check',
      datasetResultEligibility: eligibility,
      canonicalSourceUrl: sourceDef.serviceUrl,
      canonicalLayerId: sourceDef.layerId ?? 0
    });
    recordScopedLayerAttempt({
      attempted: true,
      success: false,
      reason: 'source_identity_mismatch',
      datasetResultEligibility: eligibility
    });
    return false;
  }
  recordAuthNativeStage('source_identity_check', { ok: true });

  const objectIds = collectSourceObjectIds(mapResult);
  recordAuthNativeStage('collect_object_ids', {
    objectIdCount: objectIds.length,
    sampleObjectIds: objectIds.slice(0, 10)
  });
  if (!objectIds.length) {
    failAuthNativeDiagnostic('no_source_object_ids', {
      failureStage: 'collect_object_ids',
      featureCount: mapResult.summary?.matchedFeatures ?? null
    });
    recordScopedLayerAttempt({
      attempted: true,
      success: false,
      reason: 'no_source_object_ids',
      featureCount: mapResult.summary?.matchedFeatures ?? null
    });
    return false;
  }

  recordAuthNativeStage('deterministic_source', {
    serviceUrl: sourceDef.serviceUrl,
    layerId: sourceDef.layerId ?? 0,
    objectIdField: 'OBJECTID',
    objectIdCount: objectIds.length
  });

  const webMap = getWebMap();
  recordAuthNativeStage('webmap_ready', { ok: Boolean(webMap) });
  const view = getMapView();
  recordAuthNativeStage('map_view_ready', { ok: Boolean(view) });

  if (!webMap) {
    failAuthNativeDiagnostic('webmap_not_ready', {
      failureStage: 'webmap_ready',
      objectIdCount: objectIds.length
    });
    recordScopedLayerAttempt({
      attempted: true,
      success: false,
      reason: 'webmap_not_ready',
      objectIdCount: objectIds.length
    });
    return false;
  }
  if (!view) {
    failAuthNativeDiagnostic('map_view_not_ready', {
      failureStage: 'map_view_ready',
      objectIdCount: objectIds.length
    });
    recordScopedLayerAttempt({
      attempted: true,
      success: false,
      reason: 'map_view_not_ready',
      objectIdCount: objectIds.length
    });
    return false;
  }

  const sourceLayer = findWebMapLayerByServiceUrl(webMap, sourceDef.serviceUrl);
  if (!sourceLayer) {
    const candidates = listWebMapLayerCandidates(webMap);
    failAuthNativeDiagnostic('authoritative_webmap_layer_not_found', {
      failureStage: 'find_webmap_layer',
      objectIdCount: objectIds.length,
      targetServiceUrl: sourceDef.serviceUrl,
      webMapLayerCandidates: candidates
    });
    recordScopedLayerAttempt({
      attempted: true,
      success: false,
      reason: 'authoritative_webmap_layer_not_found',
      objectIdCount: objectIds.length,
      targetServiceUrl: sourceDef.serviceUrl
    });
    return false;
  }

  recordAuthNativeStage('authoritative_layer_found', {
    layerId: sourceLayer.id || null,
    layerTitle: sourceLayer.title || null,
    layerUrl: sourceLayer.url || sourceLayer.parsedUrl?.path || null,
    layerType: sourceLayer.type || null
  });

  try {
    if (!sourceLayer.loaded) await sourceLayer.load();
    recordAuthNativeStage('source_layer_loaded', {
      ok: true,
      objectIdField: sourceLayer.objectIdField || 'OBJECTID',
      loaded: sourceLayer.loaded
    });
  } catch (error) {
    failAuthNativeDiagnostic('source_layer_load_failed', {
      failureStage: 'source_layer_load',
      objectIdCount: objectIds.length,
      layerId: sourceLayer.id || null,
      layerTitle: sourceLayer.title || null
    }, error);
    recordScopedLayerAttempt({
      attempted: true,
      success: false,
      reason: 'source_layer_load_failed',
      message: error?.message || String(error),
      objectIdCount: objectIds.length
    });
    return false;
  }

  const identity = compareSourceIdentity(sourceDef, sourceLayer);
  recordAuthNativeStage('source_identity_compare', identity);

  return finalizeAuthNativeLayerViewActivation(mapResult, sourceLayer, sourceDef, objectIds, {
    semanticField: sourceDef.semanticField || 'amenity',
    buildCategoryMap: true
  });
}

function resolvePrimaryWebMapDatasetResult(mapResult) {
  return (mapResult.datasetResults || []).find((result) => (
    result.sourceType === 'CURRENT_WEBMAP'
    && (result.webmapLayer?.catalogId || result.dataUrl || result.catalogueUrl)
  )) || null;
}

/**
 * AUTH-NATIVE for non-amenities WebMap FeatureLayers (e.g. Fire Stations).
 * @param {object} mapResult
 * @param {object} primary
 */
async function tryActivateAuthNativeWebMapLayerDisplay(mapResult, primary) {
  beginAuthNativeDiagnostic({
    path: 'tryActivateAuthNativeWebMapLayerDisplay',
    dataset: primary.displayName || primary.webmapLayer?.title || null
  });

  const webmapLayer = primary.webmapLayer || {};
  const sourceDef = {
    serviceUrl: webmapLayer.url || primary.dataUrl || primary.catalogueUrl || null,
    layerId: webmapLayer.layerId ?? 0,
    semanticField: primary.renderMeta?.semanticField || primary.provenance?.semanticField || null
  };

  recordAuthNativeStage('webmap_source_identity', {
    catalogId: webmapLayer.catalogId || null,
    serviceUrl: sourceDef.serviceUrl,
    layerId: sourceDef.layerId
  });

  const objectIds = collectSourceObjectIds(mapResult);
  recordAuthNativeStage('collect_object_ids', {
    objectIdCount: objectIds.length,
    sampleObjectIds: objectIds.slice(0, 10)
  });
  recordAuthNativeProvenance({
    dataset: primary.displayName || primary.webmapLayer?.title || null,
    catalogId: webmapLayer.catalogId || null,
    layerTitle: webmapLayer.title || null,
    serviceUrl: sourceDef.serviceUrl,
    layerId: sourceDef.layerId,
    rowDerivedObjectIdCount: objectIds.length,
    activationResult: null
  });
  if (!objectIds.length) {
    recordAuthNativeProvenance({
      dataset: primary.displayName || primary.webmapLayer?.title || null,
      catalogId: webmapLayer.catalogId || null,
      activationResult: false,
      failureReason: 'no_source_object_ids',
      rowDerivedObjectIdCount: 0
    });
    failAuthNativeDiagnostic('no_source_object_ids', {
      failureStage: 'collect_object_ids',
      featureCount: mapResult.summary?.matchedFeatures ?? null
    });
    recordScopedLayerAttempt({
      attempted: true,
      success: false,
      reason: 'no_source_object_ids',
      featureCount: mapResult.summary?.matchedFeatures ?? null
    });
    return false;
  }

  const webMap = getWebMap();
  const view = getMapView();
  if (!webMap) {
    failAuthNativeDiagnostic('webmap_not_ready', { failureStage: 'webmap_ready', objectIdCount: objectIds.length });
    return false;
  }
  if (!view) {
    failAuthNativeDiagnostic('map_view_not_ready', { failureStage: 'map_view_ready', objectIdCount: objectIds.length });
    return false;
  }

  let sourceLayer = webmapLayer.catalogId
    ? findRuntimeLayerByCatalogId(webmapLayer.catalogId)
    : null;
  if (!sourceLayer && sourceDef.serviceUrl) {
    sourceLayer = findWebMapLayerByServiceUrl(webMap, sourceDef.serviceUrl);
  }
  if (!sourceLayer) {
    failAuthNativeDiagnostic('authoritative_webmap_layer_not_found', {
      failureStage: 'find_webmap_layer',
      objectIdCount: objectIds.length,
      targetServiceUrl: sourceDef.serviceUrl,
      catalogId: webmapLayer.catalogId || null,
      webMapLayerCandidates: listWebMapLayerCandidates(webMap)
    });
    return false;
  }

  recordAuthNativeStage('authoritative_layer_found', {
    layerId: sourceLayer.id || null,
    layerTitle: sourceLayer.title || null,
    layerUrl: sourceLayer.url || sourceLayer.parsedUrl?.path || null,
    layerType: sourceLayer.type || null
  });

  try {
    if (!sourceLayer.loaded) await sourceLayer.load();
    sourceDef.serviceUrl = sourceLayer.url || sourceLayer.parsedUrl?.path || sourceDef.serviceUrl;
    sourceDef.layerId = sourceLayer.layerId ?? sourceDef.layerId ?? 0;
    recordAuthNativeStage('source_layer_loaded', {
      ok: true,
      objectIdField: sourceLayer.objectIdField || 'OBJECTID',
      loaded: sourceLayer.loaded
    });
    recordAuthNativeProvenance({
      dataset: primary.displayName || primary.webmapLayer?.title || null,
      catalogId: webmapLayer.catalogId || null,
      layerTitle: sourceLayer.title || webmapLayer.title || null,
      serviceUrl: sourceLayer.url || sourceLayer.parsedUrl?.path || sourceDef.serviceUrl,
      objectIdField: sourceLayer.objectIdField || 'OBJECTID',
      rowDerivedObjectIdCount: objectIds.length
    });
  } catch (error) {
    failAuthNativeDiagnostic('source_layer_load_failed', {
      failureStage: 'source_layer_load',
      objectIdCount: objectIds.length,
      layerId: sourceLayer.id || null,
      layerTitle: sourceLayer.title || null
    }, error);
    return false;
  }

  const identity = compareSourceIdentity(sourceDef, sourceLayer);
  recordAuthNativeStage('source_identity_compare', identity);

  const semanticField = sourceDef.semanticField || sourceLayer.displayField || 'OBJECTID';
  return finalizeAuthNativeLayerViewActivation(mapResult, sourceLayer, sourceDef, objectIds, {
    semanticField,
    buildCategoryMap: Boolean(mapResult.categorySummary?.categories?.length)
  });
}

async function resolveRendererClassCount(layer, sourceDef = null) {
  const infos = layer?.renderer?.uniqueValueInfos;
  if (Array.isArray(infos) && infos.length) return infos.length;
  if (infos?.length > 0) return infos.length;
  if (layer?.renderer?.type === 'simple') return 1;

  const serviceUrl = sourceDef?.serviceUrl || layer?.url || layer?.parsedUrl?.path || null;
  if (!serviceUrl) return 0;
  try {
    const layerId = sourceDef?.layerId ?? layer?.layerId ?? 0;
    const normalized = String(serviceUrl).replace(/\/$/, '');
    const metadataUrl = /\/\d+$/.test(normalized)
      ? `${normalized}?f=json`
      : `${normalized}/${layerId}?f=json`;
    const response = await fetch(metadataUrl);
    if (!response.ok) return 0;
    const data = await response.json();
    const renderer = data?.drawingInfo?.renderer;
    return renderer?.uniqueValueInfos?.length ?? (renderer?.type === 'simple' ? 1 : 0);
  } catch {
    return 0;
  }
}

async function seedCategorySummaryFromLayerRenderer(mapResult, layer, sourceDef = null, semanticField = 'amenity') {
  const classCount = await resolveRendererClassCount(layer, sourceDef);
  if (!classCount) return;
  mapResult.categorySummary = {
    ...(mapResult.categorySummary || {}),
    field: semanticField,
    rawDistinctCategoryCount: classCount,
    categories: mapResult.categorySummary?.categories || [],
    totalCount: mapResult.categorySummary?.totalCount
      ?? mapResult.summary?.matchedFeatures
      ?? mapResult.resultAccounting?.totalMatchingObjectIds
      ?? null
  };
}

/**
 * Shared AUTH-NATIVE LayerView.objectIds activation after source layer is resolved.
 * @param {object} mapResult
 * @param {object} sourceLayer
 * @param {object} sourceDef
 * @param {number[]} objectIds
 * @param {{ semanticField?: string, buildCategoryMap?: boolean }} options
 */
async function finalizeAuthNativeLayerViewActivation(mapResult, sourceLayer, sourceDef, objectIds, options = {}) {
  const semanticField = options.semanticField || sourceDef.semanticField || 'amenity';
  await seedCategorySummaryFromLayerRenderer(mapResult, sourceLayer, sourceDef, semanticField);
  const provenance = await verifyObjectIdProvenance(sourceLayer, objectIds, sourceDef);
  recordAuthNativeStage('objectid_provenance', provenance);
  if (provenance.sampleExistsOnAuthoritative === false) {
    failAuthNativeDiagnostic('result_objectids_not_from_source_layer', {
      failureStage: 'objectid_provenance',
      objectIdCount: objectIds.length,
      sampleObjectIds: provenance.sampleObjectIds,
      sampleQueryError: provenance.sampleQueryError || null,
      identityMatch: provenance.identityMatch
    });
    recordScopedLayerAttempt({
      attempted: true,
      success: false,
      reason: 'result_objectids_not_from_source_layer',
      objectIdCount: objectIds.length,
      sampleObjectIds: provenance.sampleObjectIds
    });
    return false;
  }

  categoryObjectIdMap = options.buildCategoryMap
    ? buildCategoryObjectIdMap(mapResult, semanticField)
    : new Map();
  deterministicBaseObjectIds = objectIds;
  deterministicBaseDefinitionExpression = null;
  deterministicUsesLayerViewFilter = true;
  deterministicRendererField = semanticField;
  authNativeActive = true;
  authoritativeDisplayLayer = sourceLayer;

  beginAuthNativeVisibilityOverride(sourceLayer);
  recordAuthNativeStage('auth_native_state_armed', {
    authNativeActive: true,
    layerVisible: sourceLayer.visible,
    visibilityRestoreStackDepth: authNativeVisibilityRestoreStack.length,
    previousSourceLayerVisible: authNativeVisibilityRestoreStack[0]?.visible ?? null
  });

  try {
    const filterOk = await applyDeterministicObjectIdFilter(null);
    if (!filterOk) {
      authNativeActive = false;
      authoritativeDisplayLayer = null;
      deterministicBaseObjectIds = null;
      deterministicUsesLayerViewFilter = false;
      failAuthNativeDiagnostic('filter_apply_returned_false', {
        failureStage: 'apply_filter',
        objectIdCount: objectIds.length
      });
      recordScopedLayerAttempt({
        attempted: true,
        success: false,
        reason: 'layer_view_filter_failed',
        message: 'applyDeterministicObjectIdFilter returned false',
        objectIdCount: objectIds.length
      });
      return false;
    }
  } catch (error) {
    authNativeActive = false;
    authoritativeDisplayLayer = null;
    deterministicBaseObjectIds = null;
    deterministicUsesLayerViewFilter = false;
    const stage = String(error?.message || '').includes('filter')
      ? 'filter_assign_failed'
      : 'when_layer_view_failed';
    failAuthNativeDiagnostic('layer_view_filter_failed', {
      failureStage: stage,
      objectIdCount: objectIds.length,
      sourceLayerId: sourceLayer.id || null,
      sourceLayerTitle: sourceLayer.title || null
    }, error);
    recordScopedLayerAttempt({
      attempted: true,
      success: false,
      reason: 'layer_view_filter_failed',
      message: error?.message || String(error),
      objectIdCount: objectIds.length,
      sourceLayerId: sourceLayer.id || null,
      sourceLayerTitle: sourceLayer.title || null
    });
    return false;
  }

  const identity = compareSourceIdentity(sourceDef, sourceLayer);
  succeedAuthNativeDiagnostic({
    objectIdCount: objectIds.length,
    sourceLayerId: sourceLayer.id || null,
    sourceLayerTitle: sourceLayer.title || null,
    filterMethod: 'layerView.objectIds',
    identityMatch: identity.identityMatch
  });

  recordScopedLayerAttempt({
    attempted: true,
    success: true,
    reason: 'auth_native_layer_view',
    objectIdCount: objectIds.length,
    filterMethod: 'layerView.objectIds',
    sourceLayerId: sourceLayer.id || null,
    sourceLayerTitle: sourceLayer.title || null,
    objectIdProvenanceMatch: provenance.sampleExistsOnAuthoritative
  });

  writeResultRenderer({
    mode: 'auth_native',
    field: deterministicRendererField,
    usesLayerViewFilter: true,
    usesObjectIdFilter: true,
    rendererCloned: false,
    rendererReconstructed: false,
    rendererMutated: false,
    sourceLayerTitle: sourceLayer.title || null,
    sourceLayerId: sourceLayer.id || null,
    sourceLayerUrl: sourceLayer.url || sourceDef.serviceUrl,
    displayLayerId: sourceLayer.id || null,
    displayLayerTitle: sourceLayer.title || null,
    baseResultObjectIdCount: objectIds.length,
    activeObjectIdCount: objectIds.length,
    activeCategory: null,
    runtimeFallbackActive: false,
    iqaiDeterministicResultsActive: false
  });

  markMapDiagStage('auth_native_layer_view_active', {
    layerId: sourceLayer.id,
    layerTitle: sourceLayer.title,
    objectIdCount: objectIds.length,
    filterMethod: 'layerView.objectIds'
  });

  reportDeterministicDisplayState(null);
  return true;
}

function curatedSymbolForDatasetResult(result) {
  if (result?.renderMeta?.symbol) return result.renderMeta.symbol;
  const datasetId = result?.datasetId;
  if (!datasetId || String(datasetId).startsWith('concept:')) return null;
  try {
    return getResultSymbol(datasetId);
  } catch {
    return null;
  }
}

function isOsmMapResult(mapResult) {
  return (mapResult.datasetResults || []).some((result) => (
    result.sourceType === 'TRUSTED_EXTERNAL' || result.sourceId === 'OSM_NA_AMENITIES'
  ));
}

/**
 * One dedicated client-side FeatureLayer for all deterministic point query results.
 */
async function buildDeterministicResultsLayer(mapResult, modules) {
  deterministicBaseDefinitionExpression = null;
  deterministicBaseObjectIds = null;
  deterministicUsesLayerViewFilter = false;
  authNativeActive = false;
  authoritativeDisplayLayer = null;
  categoryObjectIdMap = new Map();
  authNativeVisibilityRestoreStack = [];
  deterministicResultsLayer = null;
  recordScopedLayerAttempt({ attempted: false, success: null, reason: 'pending' });

  const osmAmenitiesSourceDef = getOsmNaAmenitiesSourceDef();
  let authNativeReady = false;
  if (isAuthoritativeAmenitiesMapResult(mapResult, osmAmenitiesSourceDef)) {
    authNativeReady = await tryActivateAuthNativeAmenitiesDisplay(mapResult);
  } else {
    const webmapPrimary = resolvePrimaryWebMapDatasetResult(mapResult);
    if (webmapPrimary) {
      authNativeReady = await tryActivateAuthNativeWebMapLayerDisplay(mapResult, webmapPrimary);
    }
  }
  if (authNativeReady) {
    return null;
  }

  const attempt = typeof window !== 'undefined' ? window.__IQAI_SCOPED_LAYER_ATTEMPT__ : null;
  const { FeatureLayer } = modules;
  const { graphics, geometrySamples } = await collectDeterministicGraphics(mapResult, modules);
  if (!graphics.length) return null;

  const primary = mapResult.datasetResults?.[0] || null;
  const presentation = await resolvePresentationForMapResult(mapResult);
  const semanticField = primary?.renderMeta?.semanticField
    || primary?.provenance?.semanticField
    || presentation?.semanticField
    || 'amenity';
  const curatedSymbol = primary ? curatedSymbolForDatasetResult(primary) : null;

  const rendererResolution = buildSafeResultRenderer({
    presentation,
    graphics,
    semanticField,
    curatedSymbol
  });
  deterministicRendererField = rendererResolution.field || semanticField;

  markMapDiagStage('deterministic_graphics_built', {
    graphicsCount: graphics.length,
    inputFeatureCount: mapResult.summary?.matchedFeatures ?? graphics.length,
    geometrySamples,
    rendererMode: rendererResolution.mode,
    rendererField: deterministicRendererField,
    rendererValidation: rendererResolution.validation
  });

  if (typeof window !== 'undefined') {
    const diag = window.__IQAI_AUTH_NATIVE_DIAGNOSTIC__;
    writeResultRenderer({
      ...rendererResolution,
      mode: 'runtime-fallback',
      fallbackReason: attempt?.reason || diag?.failureReason || 'auth_native_unavailable',
      authNativeShortReason: diag?.shortCode || null,
      fallbackMessage: attempt?.message || diag?.exception?.message || null,
      rendererCloned: false,
      rendererReconstructed: true,
      rendererMutated: true,
      runtimeFallbackActive: true,
      iqaiDeterministicResultsActive: true,
      activeObjectIdCount: mapResult.summary?.matchedFeatures ?? graphics.length,
      baseResultObjectIdCount: mapResult.summary?.matchedFeatures ?? graphics.length
    });
  }

  const popupTemplate = isOsmMapResult(mapResult)
    ? buildCleanOsmPopupTemplate()
    : {
      title: '{name}',
      outFields: ['*'],
      content: [{
        type: 'fields',
        fieldInfos: [
          { fieldName: 'name', label: 'Name' },
          { fieldName: 'address', label: 'Address' },
          { fieldName: 'distanceLabel', label: 'Distance' },
          { fieldName: 'sourceName', label: 'Source' },
          { fieldName: 'provider', label: 'Provider' }
        ]
      }]
    };

  const layer = new FeatureLayer({
    id: DETERMINISTIC_RESULTS_LAYER_ID,
    title: mapResult.layerTitle || 'IQAI Deterministic Results',
    source: graphics,
    objectIdField: 'OBJECTID',
    fields: featureLayerFields(),
    geometryType: 'point',
    spatialReference: { wkid: 4326 },
    renderer: rendererResolution.renderer,
    visible: true,
    opacity: 1,
    minScale: 0,
    maxScale: 0,
    listMode: 'hide',
    popupEnabled: true,
    popupTemplate
  });

  await layer.load();
  deterministicResultsLayer = layer;
  markMapDiagStage('deterministic_layer_loaded', {
    layerId: layer.id,
    sourceFeatureCount: graphics.length,
    loadStatus: layer.loadStatus,
    rendererType: layer.renderer?.type,
    rendererMode: rendererResolution.mode
  });
  reportDeterministicDisplayState(layer);
  return layer;
}

/**
 * Client-side category filter on the deterministic results layer (presentation only).
 * @param {string | null} categoryValue
 */
export async function setDeterministicResultsCategoryFilter(categoryValue) {
  if (authNativeActive && authoritativeDisplayLayer) {
    await applyDeterministicObjectIdFilter(categoryValue || null);
    reportDeterministicDisplayState(null);
    return;
  }

  const layer = deterministicResultsLayer || getWebMap()?.findLayerById(DETERMINISTIC_RESULTS_LAYER_ID);
  if (!layer) return;

  if (deterministicUsesLayerViewFilter && deterministicBaseObjectIds?.length) {
    await applyDeterministicObjectIdFilter(categoryValue || null);
    return;
  }

  const field = deterministicRendererField || 'amenity';
  if (!categoryValue) {
    layer.definitionExpression = deterministicBaseDefinitionExpression || null;
    mutateResultRenderer((renderer) => {
      renderer.activeCategory = null;
      renderer.activeObjectIdCount = renderer.baseResultObjectIdCount ?? null;
    });
    return;
  }
  const categoryExpr = `${field} = '${escapeSqlLiteral(categoryValue)}'`;
  layer.definitionExpression = deterministicBaseDefinitionExpression
    ? `(${deterministicBaseDefinitionExpression}) AND (${categoryExpr})`
    : categoryExpr;
  mutateResultRenderer((renderer) => {
    renderer.activeCategory = categoryValue;
  });
}

function layerSourceFeatureCount(layer) {
  if (!layer?.source) return 0;
  if (typeof layer.source.length === 'number') return layer.source.length;
  if (typeof layer.source?.items?.length === 'number') return layer.source.items.length;
  return 0;
}

export function getLastClickDiagnostic() {
  return lastClickDiagnostic;
}

export function getWebMapLayerInspect() {
  return webMapLayerInspect;
}

function logClickDiagnostic(diagnostic) {
  lastClickDiagnostic = diagnostic;
  if (typeof window !== 'undefined') {
    window.__IQAI_CLICK_DIAGNOSTIC__ = diagnostic;
  }
}

function collectMapLayers(layerCollection) {
  const layers = [];
  const items = layerCollection?.items || layerCollection || [];
  for (const layer of items) {
    layers.push(layer);
    if (layer.type === 'group' && layer.layers) {
      layers.push(...collectMapLayers(layer.layers));
    }
  }
  return layers;
}

async function inspectLayerEntry(layer, view) {
  const entry = {
    title: layer.title || null,
    id: layer.id || null,
    type: layer.type || null,
    url: layer.url || layer.parsedUrl?.path || null,
    popupEnabled: layer.popupEnabled,
    popupTemplateExists: Boolean(layer.popupTemplate),
    geometryType: layer.geometryType || null,
    visible: layer.visible,
    loaded: layer.loaded
  };
  try {
    if (!layer.loaded) await layer.load();
    entry.loaded = true;
    entry.popupEnabled = layer.popupEnabled;
    entry.popupTemplateExists = Boolean(layer.popupTemplate);
    if (layer.capabilities?.operations) {
      entry.queryable = layer.capabilities.operations.supportsQuery ?? null;
    }
    if (view && layer.type === 'feature') {
      try {
        const layerView = await view.whenLayerView(layer);
        entry.layerViewExists = Boolean(layerView);
      } catch (error) {
        entry.layerViewExists = false;
        entry.layerViewError = String(error?.message || error);
      }
    }
  } catch (error) {
    entry.loadError = String(error?.message || error);
  }
  return entry;
}

/**
 * Runtime inspect Montreal 1 WebMap layers (Cameras + one other FeatureLayer).
 */
export async function inspectWebMapFeatureLayers() {
  const webMap = getWebMap();
  const view = getMapView();
  const report = {
    viewPopupEnabled: view?.popupEnabled ?? null,
    viewPopupNull: view?.popup == null,
    cameras: null,
    otherFeatureLayer: null,
    featureLayerTitles: []
  };
  if (!webMap) {
    webMapLayerInspect = report;
    window.__IQAI_LAYER_INSPECT__ = report;
    return report;
  }

  const allLayers = collectMapLayers(webMap.layers);
  report.featureLayerTitles = allLayers
    .filter((layer) => layer.type === 'feature')
    .map((layer) => layer.title || layer.id);

  const camerasLayer = allLayers.find(
    (layer) => /camera/i.test(layer.title || '') || /camera/i.test(layer.id || '')
  );
  const otherFeatureLayer = allLayers.find(
    (layer) => layer.type === 'feature'
      && layer !== camerasLayer
      && !/camera/i.test(layer.title || '')
  );

  if (camerasLayer) {
    report.cameras = await inspectLayerEntry(camerasLayer, view);
    report.cameras.popupSchema = describePopupTemplate(camerasLayer.popupTemplate);
    if (typeof window !== 'undefined') {
      window.__IQAI_CAMERAS_LAYER__ = report.cameras;
    }
  }
  if (otherFeatureLayer) {
    report.otherFeatureLayer = await inspectLayerEntry(otherFeatureLayer, view);
  }

  webMapLayerInspect = report;
  window.__IQAI_LAYER_INSPECT__ = report;
  console.log('[IQAI Feature Picking] WebMap layer inspect', report);
  return report;
}

async function inspectIqaiRuntimeLayer(layer, view) {
  const webMap = getWebMap();
  const entry = {
    layerId: layer.id,
    popupEnabled: layer.popupEnabled,
    popupTemplateExists: Boolean(layer.popupTemplate),
    objectIdField: layer.objectIdField,
    sourceFeatureCount: layerSourceFeatureCount(layer),
    loaded: layer.loaded,
    visible: layer.visible,
    opacity: layer.opacity,
    minScale: layer.minScale,
    maxScale: layer.maxScale,
    rendererType: layer.renderer?.type || null,
    featureReductionType: layer.featureReduction?.type || null,
    loadError: layer.loadError?.message || null,
    mapLayersIncludes: Boolean(webMap?.layers?.includes?.(layer))
  };
  if (view) {
    try {
      const layerView = await view.whenLayerView(layer);
      entry.layerViewExists = Boolean(layerView);
      entry.suspended = layerView?.suspended;
      entry.updating = layerView?.updating;
      entry.visibleAtCurrentScale = layerView?.visibleAtCurrentScale;
      entry.layerViewVisible = layerView?.visible;
      if (typeof layerView?.queryFeatureCount === 'function') {
        try {
          entry.queryFeatureCount = await layerView.queryFeatureCount();
        } catch (error) {
          entry.queryFeatureCountError = String(error?.message || error);
        }
      }
      if (typeof layer.queryFeatureCount === 'function') {
        try {
          entry.layerQueryFeatureCount = await layer.queryFeatureCount();
        } catch (error) {
          entry.layerQueryFeatureCountError = String(error?.message || error);
        }
      }
    } catch (error) {
      entry.layerViewExists = false;
      entry.layerViewError = String(error?.message || error);
    }
  }
  return entry;
}

export function getIqaiRuntimeLayerInspect() {
  const view = getMapView();
  const inspect = {};
  for (const layer of iqaiResultFeatureLayers) {
    inspect[layer.id] = {
      popupEnabled: layer.popupEnabled,
      popupTemplateExists: Boolean(layer.popupTemplate),
      objectIdField: layer.objectIdField,
      sourceFeatureCount: layerSourceFeatureCount(layer),
      visible: layer.visible,
      loaded: layer.loaded
    };
  }
  return inspect;
}

export function setIqaiResultFeatureLayers(layers = []) {
  iqaiResultFeatureLayers = layers.filter(Boolean);
}

export function getIqaiResultLayerIds() {
  const ids = iqaiResultFeatureLayers.map((layer) => layer.id).filter(Boolean);
  const webMap = getWebMap();
  if (webMap?.findLayerById(RUNTIME_GROUP_ID)) {
    ids.push(RUNTIME_GROUP_ID);
  }
  return [...new Set(ids)];
}

function findSearchAreaCircleGeometry() {
  const webMap = getWebMap();
  const group = webMap?.findLayerById(RUNTIME_GROUP_ID);
  if (!group || group.type !== 'group') return null;
  const searchArea = group.findLayerById('iqai-search-area');
  if (!searchArea) return null;
  const graphics = searchArea.graphics?.items || searchArea.graphics || [];
  for (const graphic of graphics) {
    const geom = graphic?.geometry;
    if (geom && (geom.type === 'polygon' || geom.type === 'extent' || geom.extent)) {
      return geom;
    }
  }
  return null;
}

function snapshotViewState(view) {
  if (!view) return null;
  const extent = view.extent;
  const center = view.center;
  return {
    scale: view.scale,
    zoom: view.zoom,
    extent: extent ? {
      xmin: extent.xmin,
      ymin: extent.ymin,
      xmax: extent.xmax,
      ymax: extent.ymax,
      width: extent.width,
      height: extent.height,
      spatialReference: extent.spatialReference?.wkid ?? extent.spatialReference?.latestWkid
    } : null,
    center: center ? {
      x: center.x,
      y: center.y,
      longitude: center.longitude,
      latitude: center.latitude,
      spatialReference: center.spatialReference?.wkid ?? center.spatialReference?.latestWkid
    } : null,
    spatialReference: view.spatialReference?.wkid ?? view.spatialReference?.latestWkid
  };
}

async function projectExtentToView(extent, view, projectionModule) {
  if (!extent || !view?.spatialReference) return extent;
  const viewWkid = view.spatialReference.wkid ?? view.spatialReference.latestWkid;
  const extentWkid = extent.spatialReference?.wkid ?? extent.spatialReference?.latestWkid;
  if (!extentWkid || extentWkid === viewWkid) {
    return extent;
  }
  if (!projectionModule.isLoaded()) {
    await projectionModule.load();
  }
  return projectionModule.project(extent, view.spatialReference);
}

async function resolveScopedFeatureTargetExtent(featureLayers, Extent, geometryEngine) {
  const extents = [];
  let totalFeatures = 0;
  const featureCounts = {};

  for (const layer of featureLayers) {
    if (!layer.loaded) await layer.load();

    let count = 0;
    let extent = null;

    if (layer.queryExtent) {
      const queryResult = await layer.queryExtent();
      count = queryResult?.count ?? 0;
      extent = queryResult?.extent || null;
    }

    if (!extent || count === 0) {
      const sourceItems = layer.source;
      const points = [];
      const iterable = sourceItems?.items || sourceItems || [];
      for (const graphic of iterable) {
        const geom = graphic?.geometry;
        if (!geom) continue;
        if (geom.longitude != null && geom.latitude != null) {
          points.push([geom.longitude, geom.latitude]);
        } else if (geom.x != null && geom.y != null) {
          points.push([geom.x, geom.y]);
        } else if (geom.extent) {
          extents.push(geom.extent);
        }
      }
      count = points.length || layerSourceFeatureCount(layer);
      if (points.length) {
        const extentObj = extentFromPoints(points);
        if (extentObj) extent = new Extent(extentObj);
      }
    }

    featureCounts[layer.id] = count;
    totalFeatures += count;
    if (extent) extents.push(extent);
  }

  if (!extents.length) return null;

  const merged = extents.length === 1 ? extents[0].clone() : geometryEngine.union(extents);
  return {
    extent: merged,
    featureCounts,
    scopedFeatureCount: totalFeatures,
    featureSR: merged.spatialReference?.wkid ?? merged.spatialReference?.latestWkid
  };
}

async function resolveScopedQueryAoiExtent(Point, Circle) {
  const ctx = lastScopedQueryContext;
  let circleGeom = ctx?.searchCircleGeometry || findSearchAreaCircleGeometry();

  if (!circleGeom && ctx?.radiusMeters && ctx.originLon != null && ctx.originLat != null) {
    circleGeom = new Circle({
      center: new Point({
        longitude: ctx.originLon,
        latitude: ctx.originLat,
        spatialReference: { wkid: 4326 }
      }),
      radius: ctx.radiusMeters,
      radiusUnit: 'meters',
      geodesic: true
    });
  }

  if (!circleGeom?.extent) return null;
  return {
    extent: circleGeom.extent,
    aoiSR: circleGeom.extent.spatialReference?.wkid ?? circleGeom.extent.spatialReference?.latestWkid,
    radiusMeters: ctx?.radiusMeters
  };
}

function calculateCenterAndScaleForExtent(projectedExtent, view, fillRatio = 0.825) {
  const center = projectedExtent.center;
  const viewWidth = view.width;
  const viewHeight = view.height;

  if (!viewWidth || !viewHeight || !view.extent || !Number.isFinite(view.scale)) {
    return { center, targetScale: view.scale };
  }

  const currentMapUnitsPerPixel = Math.max(
    view.extent.width / viewWidth,
    view.extent.height / viewHeight
  );

  const targetMapUnitsPerPixel = Math.max(
    projectedExtent.width / (viewWidth * fillRatio),
    projectedExtent.height / (viewHeight * fillRatio)
  );

  const targetScale = view.scale * (targetMapUnitsPerPixel / currentMapUnitsPerPixel);
  return { center, targetScale };
}

function findScopedResultFeatureLayers(layerIds = []) {
  const tracked = iqaiResultFeatureLayers.filter(
    (layer) => layer?.type === 'feature' && isIqaiRuntimeFeatureLayer(layer)
  );
  if (tracked.length) return tracked;

  const webMap = getWebMap();
  if (!webMap) return [];

  const scopedIds = new Set(
    layerIds.filter((id) => id?.startsWith('iqai-webmap-'))
  );
  const allLayers = collectMapLayers(webMap.layers);
  const scoped = allLayers.filter((layer) => isIqaiRuntimeFeatureLayer(layer));
  if (scopedIds.size) {
    return scoped.filter((layer) => scopedIds.has(layer.id));
  }
  return scoped;
}

/**
 * Zoom to extent of scoped IQAI result feature layers (not full WebMap).
 * @param {string[]} [layerIds]
 */
export async function zoomToScopedResults(layerIds = []) {
  const view = getMapView();
  if (!view) throw new Error('MapView is not ready');

  const featureLayers = findScopedResultFeatureLayers(layerIds);
  const scaleBefore = view.scale;

  const diag = {
    receivedLayerIds: [...layerIds],
    resolvedLayerIds: featureLayers.map((layer) => layer.id),
    visibleScopedLayers: featureLayers.filter((layer) => layer.visible).map((layer) => layer.id),
    featureCounts: {},
    scopedFeatureCount: 0,
    extentSource: null,
    featureSR: null,
    aoiSR: null,
    viewSR: view.spatialReference?.wkid ?? view.spatialReference?.latestWkid,
    method: 'center-scale',
    scaleBefore,
    calculatedTargetScale: null,
    scaleAfter: null,
    scaleMatchedTarget: false,
    visibleZoom: 'UNKNOWN',
    goToExecuted: false,
    before: snapshotViewState(view),
    target: null,
    after: null,
    queryRadiusMeters: lastScopedQueryContext?.radiusMeters ?? null
  };

  const [
    Extent,
    geometryEngine,
    projection,
    Point,
    Circle
  ] = await Promise.all([
    importArc('@arcgis/core/geometry/Extent.js'),
    importArc('@arcgis/core/geometry/geometryEngine.js'),
    importArc('@arcgis/core/geometry/projection.js'),
    importArc('@arcgis/core/geometry/Point.js'),
    importArc('@arcgis/core/geometry/Circle.js')
  ]);

  const ctx = lastScopedQueryContext;
  const useAoi = Boolean(
    ctx?.radiusMeters
    && !ctx?.isLocate
    && (ctx?.action === 'WITHIN' || ctx?.action === 'COUNT' || ctx?.radiusMeters)
  );

  let rawExtent = null;

  if (useAoi) {
    const aoi = await resolveScopedQueryAoiExtent(Point, Circle);
    if (aoi?.extent) {
      rawExtent = aoi.extent;
      diag.extentSource = 'query-aoi';
      diag.aoiSR = aoi.aoiSR;
      diag.queryRadiusMeters = aoi.radiusMeters;
    }
  }

  if (!rawExtent && featureLayers.length) {
    const featureTarget = await resolveScopedFeatureTargetExtent(featureLayers, Extent, geometryEngine);
    if (featureTarget) {
      rawExtent = featureTarget.extent;
      diag.extentSource = 'scoped-features';
      diag.featureCounts = featureTarget.featureCounts;
      diag.scopedFeatureCount = featureTarget.scopedFeatureCount;
      diag.featureSR = featureTarget.featureSR;
    }
  }

  if (!rawExtent) {
    if (typeof window !== 'undefined') window.__IQAI_SCOPED_ZOOM_DIAG__ = diag;
    throw new Error('No scoped result zoom target available.');
  }

  const projected = await projectExtentToView(rawExtent, view, projection);
  const paddedExtent = typeof projected.clone === 'function'
    ? projected.clone().expand(1.05)
    : projected;

  const { center, targetScale } = calculateCenterAndScaleForExtent(paddedExtent, view, 0.825);

  diag.calculatedTargetScale = targetScale;
  diag.target = {
    center: {
      x: center.x,
      y: center.y,
      longitude: center.longitude,
      latitude: center.latitude,
      spatialReference: center.spatialReference?.wkid ?? center.spatialReference?.latestWkid
    },
    scale: targetScale,
    extentWidth: paddedExtent.width,
    extentHeight: paddedExtent.height,
    spatialReference: paddedExtent.spatialReference?.wkid ?? paddedExtent.spatialReference?.latestWkid
  };

  await view.goTo({ center, scale: targetScale }, { animate: false });
  await view.when();

  diag.goToExecuted = true;
  diag.scaleAfter = view.scale;
  diag.after = snapshotViewState(view);

  if (Number.isFinite(targetScale) && Number.isFinite(diag.scaleAfter)) {
    diag.scaleMatchedTarget = Math.abs(diag.scaleAfter - targetScale) / targetScale < 0.10;
    diag.visibleZoom = diag.scaleMatchedTarget ? 'PASS' : 'FAIL';
    if (Number.isFinite(scaleBefore)) {
      diag.actualScaleChanged = diag.scaleAfter < scaleBefore * 0.9;
    }
  }

  if (typeof window !== 'undefined') {
    window.__IQAI_SCOPED_ZOOM_DIAG__ = diag;
    const history = window.__IQAI_SCOPED_ZOOM_HISTORY__ || [];
    history.push({
      queryRadiusMeters: diag.queryRadiusMeters,
      scaleBefore: diag.scaleBefore,
      calculatedTargetScale: diag.calculatedTargetScale,
      scaleAfter: diag.scaleAfter,
      scaleMatchedTarget: diag.scaleMatchedTarget,
      visibleZoom: diag.visibleZoom,
      at: Date.now()
    });
    window.__IQAI_SCOPED_ZOOM_HISTORY__ = history;
  }

  return diag;
}

export function clearIqaiSelection(closePopup = false) {
  clearSelectionHighlight();
  if (closePopup) {
    const view = getMapView();
    if (view?.popup?.visible) {
      view.closePopup();
    }
  }
}

function findGraphicInLayer(layer, datasetId, mapObjectId) {
  if (!layer?.source) return null;
  const items = layer.source.items || layer.source;
  for (const graphic of items) {
    const attrs = graphic?.attributes || {};
    const objectId = attrs.OBJECTID ?? attrs.ObjectID;
    if (Number(objectId) !== Number(mapObjectId)) continue;
    if (datasetId && attrs.datasetId && attrs.datasetId !== datasetId) continue;
    return graphic;
  }
  return null;
}

/**
 * Select a scoped IQAI result feature from the results table.
 * @param {{ layerId?: string, datasetId?: string, mapObjectId: number|string }} identity
 * @returns {Promise<{ ok: boolean, graphic?: object, layer?: object }>}
 */
export async function selectIqaiResultFeature(identity) {
  const view = getMapView();
  if (!view || !identity?.mapObjectId) return { ok: false };

  let layer = null;
  if (identity.layerId) {
    layer = iqaiResultFeatureLayers.find((entry) => entry.id === identity.layerId);
  }
  if (!layer && identity.datasetId) {
    layer = iqaiResultFeatureLayers.find((entry) => {
      const graphic = findGraphicInLayer(entry, identity.datasetId, identity.mapObjectId);
      return Boolean(graphic);
    });
  }
  if (!layer) {
    for (const entry of iqaiResultFeatureLayers) {
      const graphic = findGraphicInLayer(entry, identity.datasetId, identity.mapObjectId);
      if (graphic) {
        layer = entry;
        break;
      }
    }
  }
  if (!layer) return { ok: false };

  let graphic = findGraphicInLayer(layer, identity.datasetId, identity.mapObjectId);
  if (!graphic && layer.url && identity.mapObjectId) {
    try {
      const query = layer.createQuery();
      const oidField = layer.objectIdField || 'OBJECTID';
      query.where = `${oidField} = ${Number(identity.mapObjectId)}`;
      query.outFields = ['*'];
      query.returnGeometry = true;
      if (layer.filter?.geometry) {
        query.geometry = layer.filter.geometry;
        query.distance = layer.filter.distance;
        query.units = layer.filter.units;
        query.spatialRelationship = layer.filter.spatialRelationship || 'intersects';
      }
      const result = await layer.queryFeatures(query);
      graphic = result.features?.[0] || null;
    } catch {
      graphic = null;
    }
  }
  if (!graphic) return { ok: false };

  try {
    if (graphic.geometry) {
      await view.goTo({
        center: graphic.geometry,
        zoom: Math.max(view.zoom || 14, 15)
      }, { duration: 400 });
    }
    await highlightIqaiFeature(view, layer, graphic);
    if (view.popup) {
      view.openPopup({
        features: [graphic],
        location: graphic.geometry
      });
    }
    return { ok: true, graphic, layer };
  } catch {
    return { ok: false };
  }
}

/**
 * Select a runtime WebMap layer feature (live feeds).
 * @param {{ layerId?: string, mapObjectId: number|string }} identity
 */
export async function selectRuntimeLayerFeature(identity) {
  const view = getMapView();
  const webMap = getWebMap();
  if (!view || !webMap || !identity?.layerId || !identity?.mapObjectId) return { ok: false };

  const entry = findLayerByIdRecursive(webMap, identity.layerId);
  const layer = entry?.layer;
  if (!layer || layer.type !== 'feature') return { ok: false };

  if (!layer.loaded) await layer.load();

  let graphic = null;
  try {
    const query = layer.createQuery();
    const oidField = layer.objectIdField || 'OBJECTID';
    query.where = `${oidField} = ${Number(identity.mapObjectId)}`;
    query.outFields = ['*'];
    query.returnGeometry = true;
    const result = await layer.queryFeatures(query);
    graphic = result.features?.[0] || null;
  } catch {
    graphic = null;
  }
  if (!graphic) return { ok: false };

  try {
    if (graphic.geometry) {
      await view.goTo({
        center: graphic.geometry,
        zoom: Math.max(view.zoom || 14, 12)
      }, { duration: 400 });
    }
    if (view.popup) {
      view.openPopup({
        features: [graphic],
        location: graphic.geometry
      });
    }
    return { ok: true, graphic, layer };
  } catch {
    return { ok: false };
  }
}

function radiusKmLabel(radiusMeters) {
  if (!radiusMeters) return null;
  const km = radiusMeters / 1000;
  return Number.isInteger(km) ? String(km) : km.toFixed(1);
}

export function formatDistanceMeters(meters) {
  if (!Number.isFinite(meters)) return '—';
  if (meters >= 1000) return `${(meters / 1000).toFixed(2)} km`;
  return `${Math.round(meters)} m`;
}

function extentFromPoints(points, paddingDegrees = 0) {
  let xmin = Infinity;
  let ymin = Infinity;
  let xmax = -Infinity;
  let ymax = -Infinity;
  for (const [lon, lat] of points) {
    xmin = Math.min(xmin, lon);
    ymin = Math.min(ymin, lat);
    xmax = Math.max(xmax, lon);
    ymax = Math.max(ymax, lat);
  }
  if (!Number.isFinite(xmin)) return null;
  return {
    xmin: xmin - paddingDegrees,
    ymin: ymin - paddingDegrees,
    xmax: xmax + paddingDegrees,
    ymax: ymax + paddingDegrees,
    spatialReference: { wkid: 4326 }
  };
}

async function zoomToQueryResult({
  originLon,
  originLat,
  radiusMeters,
  isLocate,
  points,
  searchCircleGeometry
}) {
  markMapDiagStage('zoomToQueryResult_entered', {
    pointCount: points?.length || 0,
    radiusMeters,
    isLocate
  });
  const view = getMapView();
  if (!view) {
    markMapDiagStage('zoomToQueryResult_no_view');
    return;
  }

  const Extent = await importArc('@arcgis/core/geometry/Extent.js');
  const goToPadding = { top: 48, bottom: 48, left: 48, right: 48 };
  let target = null;

  if (radiusMeters && !isLocate && searchCircleGeometry?.extent) {
    const circleExtent = searchCircleGeometry.extent;
    target = typeof circleExtent.clone === 'function'
      ? circleExtent.clone().expand(1.08)
      : circleExtent;
  } else if (points.length > 0) {
    const extentObj = extentFromPoints(points);
    if (extentObj) {
      target = new Extent(extentObj).expand(1.15);
    }
  }

  if (target) {
    try {
      await view.goTo(target, { duration: 800, padding: goToPadding });
      markMapDiagStage('zoomToQueryResult_goTo_completed');
    } catch (goToError) {
      captureMapCommandFailure('zoomToQueryResult_goTo', goToError, {
        hasTarget: Boolean(target),
        pointCount: points?.length || 0
      });
    }
    return;
  }

  if (isLocate) {
    await zoomTo({ center: [originLon, originLat], zoom: 17 }, { duration: 800 });
    markMapDiagStage('zoomToQueryResult_locate_zoom_completed');
    return;
  }

  await zoomTo({ center: [originLon, originLat], zoom: 14 }, { duration: 800 });
  markMapDiagStage('zoomToQueryResult_center_zoom_completed');
}

function featuresForDatasetResult(result, mapResult) {
  if (result.features?.length) return result.features;
  return (mapResult.features || []).filter((feature) => feature.datasetId === result.datasetId);
}

function featureCoordinates(feature) {
  const longitude = Number(feature.longitude ?? feature.LONGITUDE);
  const latitude = Number(feature.latitude ?? feature.LATITUDE);
  if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) return null;
  return { longitude, latitude };
}

function buildGroupTitle(mapResult) {
  if (mapResult.layerTitle) return mapResult.layerTitle;
  const action = mapResult.request?.action || mapResult.summary?.action;
  const datasetLabel = mapResult.summary?.dataset || 'Results';
  if (action === 'LOCATE') return 'IQAI — Locate';
  if (action === 'COUNT') {
    const radius = radiusKmLabel(mapResult.summary?.radiusMeters);
    return radius
      ? `IQAI — Count ${datasetLabel} within ${radius} km`
      : `IQAI — Count ${datasetLabel}`;
  }
  if (action === 'NEAREST') {
    return `IQAI — ${mapResult.summary?.limit || ''} nearest ${datasetLabel}`.trim();
  }
  const radius = radiusKmLabel(mapResult.summary?.radiusMeters);
  if (radius) return `IQAI — ${datasetLabel} within ${radius} km`;
  return `IQAI — ${datasetLabel}`;
}

function featureLayerFields() {
  return [
    { name: 'OBJECTID', type: 'oid' },
    { name: 'iqaiType', type: 'string' },
    { name: 'datasetId', type: 'string' },
    { name: 'name', type: 'string' },
    { name: 'amenity', type: 'string' },
    { name: 'category', type: 'string' },
    { name: 'address', type: 'string' },
    { name: 'distanceMeters', type: 'double', nullable: true },
    { name: 'distanceLabel', type: 'string' },
    { name: 'sourceName', type: 'string' },
    { name: 'provider', type: 'string' },
    { name: 'providerId', type: 'string' },
    { name: 'authority', type: 'string' },
    { name: 'spatialPrecision', type: 'string' },
    { name: 'stationNumber', type: 'string' },
    { name: 'operationalStatus', type: 'string' },
    { name: 'pdq', type: 'string' },
    { name: 'schoolType', type: 'string' },
    { name: 'facilityType', type: 'string' },
    { name: 'transitMode', type: 'string' }
  ];
}

function featureAttributes(feature, dataset) {
  const attrs = {
    iqaiType: feature.iqaiType || dataset?.iqaiType || 'feature',
    datasetId: feature.datasetId,
    name: feature.name || '—',
    address: feature.address || '—',
    distanceMeters: feature.distanceMeters,
    distanceLabel: feature.distanceLabel || formatDistanceMeters(feature.distanceMeters),
    sourceName: feature.sourceName || dataset?.displayName || '—',
    provider: feature.provider || '',
    providerId: feature.providerId || '',
    authority: feature.authority || dataset?.authority || '',
    spatialPrecision: feature.spatialPrecision || 'Deterministic GIS',
    stationNumber: feature.stationNumber || '',
    operationalStatus: feature.operationalStatus || '',
    pdq: feature.pdq || '',
    schoolType: feature.schoolType || '',
    facilityType: feature.facilityType || '',
    transitMode: feature.transitMode || ''
  };
  return attrs;
}

/**
 * Gate map clicks for Point Intelligence mode without a second click handler.
 * @param {boolean} enabled
 * @param {(point: { longitude: number, latitude: number, event: object }) => (void|Promise<void>)} [handler]
 */
export function setPointIntelligenceClickMode(enabled, handler = null) {
  pointIntelligenceModeEnabled = Boolean(enabled);
  pointIntelligenceClickHandler = pointIntelligenceModeEnabled ? handler : null;
}

export function isPointIntelligenceClickModeEnabled() {
  return pointIntelligenceModeEnabled;
}

/**
 * fetchPopupFeatures + openPopup click path; IQAI Details follows popup selection.
 * @param {(attributes: object, graphic: object) => void} onFeatureSelect
 * @param {() => void} onClearSelection
 */
export async function wireFeaturePicking(onFeatureSelect, onClearSelection) {
  const view = getMapView();
  if (!view) return;

  for (const handle of popupWatchHandles) {
    handle.remove();
  }
  popupWatchHandles = [];
  if (clickHandle) {
    clickHandle.remove();
    clickHandle = null;
  }

  view.popupEnabled = true;

  const reactiveUtils = await importArc('@arcgis/core/core/reactiveUtils.js');

  popupWatchHandles.push(
    reactiveUtils.watch(
      () => {
        const popup = view.popup;
        if (!popup?.visible) return null;
        return popup.selectedFeature ?? popup.features?.[0] ?? null;
      },
      async (graphic) => {
        if (!graphic?.attributes) return;
        const layer = graphic.layer || graphic.sourceLayer;
        if (isIqaiRuntimeFeatureLayer(layer) || layer?.id === SPVM_LAYER_ID) {
          await highlightIqaiFeature(view, layer, graphic);
        }
        onFeatureSelect(graphic.attributes, graphic);
      }
    ),
    reactiveUtils.watch(
      () => view.popup?.visible,
      (visible) => {
        if (!visible) {
          clearSelectionHighlight();
          onClearSelection();
        }
      }
    )
  );

  clickHandle = view.on('click', async (event) => {
    const diagnostic = {
      mapClickReceived: true,
      screenX: event.x,
      screenY: event.y,
      mapLongitude: null,
      mapLatitude: null,
      mapPoint: event.mapPoint ? {
        x: event.mapPoint.x,
        y: event.mapPoint.y,
        spatialReference: event.mapPoint.spatialReference?.wkid ?? null
      } : null,
      popupFeatureCount: 0,
      features: [],
      openPopupCalled: false,
      popupVisible: false,
      viewPopupEnabled: view.popupEnabled,
      popupExists: view.popup != null,
      popupFeaturesCount: view.popup?.features?.length ?? 0,
      selectedFeature: null,
      message: null,
      error: null
    };

    if (event.mapPoint) {
      if (Number.isFinite(event.mapPoint.longitude) && Number.isFinite(event.mapPoint.latitude)) {
        diagnostic.mapLongitude = event.mapPoint.longitude;
        diagnostic.mapLatitude = event.mapPoint.latitude;
      } else {
        try {
          const webMercatorUtils = await importArc(
            '@arcgis/core/geometry/support/webMercatorUtils.js'
          );
          const geo = webMercatorUtils.webMercatorToGeographic(event.mapPoint);
          diagnostic.mapLongitude = geo?.longitude ?? null;
          diagnostic.mapLatitude = geo?.latitude ?? null;
        } catch {
          diagnostic.mapLongitude = event.mapPoint.x ?? null;
          diagnostic.mapLatitude = event.mapPoint.y ?? null;
        }
      }
    }

    try {
      const { isPointIntelligenceAreaSketchActive } = await import('./point-intelligence-area-controller.js');
      if (isPointIntelligenceAreaSketchActive()) {
        diagnostic.pointIntelligence = true;
        diagnostic.message = 'POINT_INTELLIGENCE_AREA_SKETCH';
        logClickDiagnostic(diagnostic);
        return;
      }
    } catch (error) {
      diagnostic.error = String(error?.message || error);
    }

    try {
      const { hitTestPointIntelligenceEvidence } = await import('./point-intelligence-layer.js');
      const {
        focusEvidenceFromMap,
        scrollObservationIntoView,
        applyPanelFocusClasses
      } = await import('./point-intelligence-focus-controller.js');
      const piEvidenceHit = await hitTestPointIntelligenceEvidence(event);
      if (piEvidenceHit?.observationId) {
        diagnostic.pointIntelligence = true;
        diagnostic.message = 'POINT_INTELLIGENCE_EVIDENCE_FOCUS';
        const focused = await focusEvidenceFromMap(piEvidenceHit);
        if (focused) {
          scrollObservationIntoView(focused.observationId);
          applyPanelFocusClasses();
        }
        logClickDiagnostic(diagnostic);
        return;
      }
    } catch (error) {
      diagnostic.error = String(error?.message || error);
    }

    try {
      const { focusOpenWorldResultFromMap } = await import('./open-world-intelligence-focus-controller.js');
      const owiHit = await focusOpenWorldResultFromMap(event);
      if (owiHit) {
        diagnostic.openWorldIntelligence = true;
        diagnostic.message = 'OPEN_WORLD_INTELLIGENCE_EVENT_FOCUS';
        logClickDiagnostic(diagnostic);
        return;
      }
    } catch (error) {
      diagnostic.error = String(error?.message || error);
    }

    try {
      const { hitTestIntelligenceFeature } = await import('./intelligence-layer-map.js');
      const intelHit = await hitTestIntelligenceFeature(event);
      if (intelHit?.graphic) {
        diagnostic.intelligenceLayer = true;
        diagnostic.message = 'INTELLIGENCE_LAYER_EVENT_FOCUS';
        const view = (await import('./spatial-arcgis-runtime.js')).getMapView();
        if (view?.popup && intelHit.graphic) {
          view.openPopup({
            features: [intelHit.graphic],
            location: intelHit.graphic.geometry
          });
        }
        onFeatureSelect?.(intelHit.graphic.attributes || {}, intelHit.graphic);
        logClickDiagnostic(diagnostic);
        return;
      }
    } catch (error) {
      diagnostic.error = String(error?.message || error);
    }

    let acquisitionMode = 'POINT';
    try {
      const service = await import('./point-intelligence-service.js');
      acquisitionMode = service.getPointIntelligenceAcquisitionMode() || 'POINT';
    } catch {
      acquisitionMode = 'POINT';
    }

    if (pointIntelligenceModeEnabled && pointIntelligenceClickHandler && acquisitionMode !== 'AREA') {
      if (Number.isFinite(diagnostic.mapLongitude) && Number.isFinite(diagnostic.mapLatitude)) {
        diagnostic.pointIntelligence = true;
        diagnostic.message = 'POINT_INTELLIGENCE_CLICK';
        try {
          await pointIntelligenceClickHandler({
            longitude: diagnostic.mapLongitude,
            latitude: diagnostic.mapLatitude,
            event
          });
        } catch (error) {
          diagnostic.error = String(error?.message || error);
        }
        logClickDiagnostic(diagnostic);
        return;
      }
    }

    try {
      if (!view.fetchPopupFeatures) {
        diagnostic.message = 'fetchPopupFeatures unavailable on MapView';
        logClickDiagnostic(diagnostic);
        return;
      }

      const features = [];
      for await (const feature of view.fetchPopupFeatures(
        { x: event.x, y: event.y },
        { pointerType: event.pointerType }
      )) {
        const layer = feature.layer || feature.sourceLayer;
        const objectId = feature.attributes?.OBJECTID ?? feature.attributes?.ObjectID ?? null;
        features.push(feature);
        diagnostic.features.push({
          layerTitle: layer?.title || layer?.id || 'unknown',
          layerId: layer?.id || null,
          layerType: layer?.type || null,
          objectId,
          popupEnabled: layer?.popupEnabled ?? null,
          popupTemplateExists: Boolean(layer?.popupTemplate),
          datasetId: feature.attributes?.datasetId || null,
          origin: isIqaiRuntimeFeatureLayer(layer) ? 'IQAI' : 'Montreal 1'
        });
      }

      diagnostic.popupFeatureCount = features.length;

      if (!features.length) {
        diagnostic.message = 'NO POPUP FEATURES RETURNED';
        clearSelectionHighlight();
        diagnostic.popupFeaturesCount = view.popup?.features?.length ?? 0;
        diagnostic.selectedFeature = formatSelectedFeatureLabel(view.popup?.selectedFeature);
        logClickDiagnostic(diagnostic);
        return;
      }

      await view.openPopup({
        features,
        location: event.mapPoint
      });
      diagnostic.openPopupCalled = true;
      diagnostic.popupVisible = Boolean(view.popup?.visible);
      diagnostic.popupFeaturesCount = view.popup?.features?.length ?? features.length;
      diagnostic.selectedFeature = formatSelectedFeatureLabel(view.popup?.selectedFeature);
    } catch (error) {
      diagnostic.error = String(error?.message || error);
      console.error('[IQAI Feature Picking] click handler error', error);
    }

    diagnostic.viewPopupEnabled = view.popupEnabled;
    diagnostic.popupExists = view.popup != null;
    if (!diagnostic.selectedFeature) {
      diagnostic.selectedFeature = formatSelectedFeatureLabel(view.popup?.selectedFeature);
    }
    if (!diagnostic.popupFeaturesCount) {
      diagnostic.popupFeaturesCount = view.popup?.features?.length ?? 0;
    }

    logClickDiagnostic(diagnostic);
  });
}

function formatSelectedFeatureLabel(graphic) {
  if (!graphic?.attributes) return '—';
  const objectId = graphic.attributes.OBJECTID ?? graphic.attributes.ObjectID;
  const datasetId = graphic.attributes.datasetId;
  const layer = graphic.layer || graphic.sourceLayer;
  const layerTitle = layer?.title || layer?.id || 'feature';
  if (datasetId) return `${layerTitle} · ${datasetId} · OBJECTID ${objectId ?? '—'}`;
  return `${layerTitle} · OBJECTID ${objectId ?? '—'}`;
}

/** @deprecated Use wireFeaturePicking */
export async function wirePopupFeatureSync(onFeatureSelect, onClearSelection) {
  return wireFeaturePicking(onFeatureSelect, onClearSelection);
}

/**
 * @param {object} mapResult
 */
export async function renderMapResultOnRuntime(mapResult) {
  if (!mapResult?.supported) return;

  if (mapResult.action === 'CLEAR') {
    await clearAuthNativeDisplayFilter();
    await clearRuntimeLayers();
    setIqaiResultFeatureLayers([]);
    deterministicResultsLayer = null;
    deterministicBaseDefinitionExpression = null;
    clearIqaiSelection(true);
    resetRendererDisplayState();
    return;
  }

  try {
    markMapDiagStage('renderMapResultOnRuntime_entered', {
      action: mapResult.action,
      datasetResultCount: mapResult.datasetResults?.length,
      matchedFeatures: mapResult.summary?.matchedFeatures
    });

    await clearRuntimeLayers();
    await clearAuthNativeDisplayFilter();
    setIqaiResultFeatureLayers([]);
    deterministicResultsLayer = null;
    deterministicBaseDefinitionExpression = null;
    clearIqaiSelection(true);
    clearPresentationFidelityRecords();
    markMapDiagStage('clearRuntimeLayers_completed');

    const [
      GroupLayer,
      GraphicsLayer,
      FeatureLayer,
      Graphic,
      Point,
      Circle,
      SimpleMarkerSymbol,
      SimpleFillSymbol,
      Color
    ] = await Promise.all([
      importArc('@arcgis/core/layers/GroupLayer.js'),
      importArc('@arcgis/core/layers/GraphicsLayer.js'),
      importArc('@arcgis/core/layers/FeatureLayer.js'),
      importArc('@arcgis/core/Graphic.js'),
      importArc('@arcgis/core/geometry/Point.js'),
      importArc('@arcgis/core/geometry/Circle.js'),
      importArc('@arcgis/core/symbols/SimpleMarkerSymbol.js'),
      importArc('@arcgis/core/symbols/SimpleFillSymbol.js'),
      importArc('@arcgis/core/Color.js')
    ]);

    const originLon = mapResult.origin.longitude;
    const originLat = mapResult.origin.latitude;
    const radiusMeters = mapResult.summary?.radiusMeters;
    const radiusKm = radiusKmLabel(radiusMeters);
    const isLocate = mapResult.request?.action === 'LOCATE' || mapResult.summary?.displayMode === 'locate';
    const isCategoryCounts = mapResult.action === 'CATEGORY_COUNTS_WITHIN'
      || mapResult.summary?.displayMode === 'category_counts';

    const searchLocationLayer = new GraphicsLayer({
      id: 'iqai-search-location',
      title: 'Search Location',
      listMode: 'hide',
      popupEnabled: false
    });

    const searchAreaLayer = new GraphicsLayer({
      id: 'iqai-search-area',
      title: 'Search Area',
      listMode: 'hide',
      popupEnabled: false
    });

    const originPoint = new Point({
      longitude: originLon,
      latitude: originLat
    });

    searchLocationLayer.add(new Graphic({
      geometry: originPoint,
      symbol: new SimpleMarkerSymbol({
        style: 'circle',
        color: [0, 112, 255, 0.9],
        size: isLocate ? 12 : 10,
        outline: { color: [255, 255, 255, 1], width: 1.5 }
      }),
      attributes: {
        iqaiType: 'search_location',
        matchedAddress: mapResult.origin.matchedAddress || 'Query location'
      }
    }));

    let searchCircleGeometry = null;

    if (radiusMeters && !isLocate) {
      const radiusCircle = new Circle({
        center: originPoint,
        radius: radiusMeters,
        radiusUnit: 'meters',
        geodesic: true
      });
      searchCircleGeometry = radiusCircle;
      lastScopedQueryContext = {
        action: mapResult.request?.action || mapResult.summary?.action,
        radiusMeters,
        originLon,
        originLat,
        isLocate,
        searchCircleGeometry
      };
      searchAreaLayer.add(new Graphic({
        geometry: radiusCircle,
        symbol: new SimpleFillSymbol({
          color: [0, 112, 255, 0.08],
          outline: { color: [0, 112, 255, 0.55], width: 1.5 }
        }),
        attributes: {
          iqaiType: 'search_area',
          radiusMeters,
          radiusLabel: `${radiusKm} km`
        }
      }));
    } else {
      lastScopedQueryContext = {
        action: mapResult.request?.action || mapResult.summary?.action,
        radiusMeters: radiusMeters || null,
        originLon,
        originLat,
        isLocate,
        searchCircleGeometry: null
      };
    }

    let deterministicLayer = null;
    if (!isCategoryCounts && ((mapResult.datasetResults?.length || 0) > 0 || (mapResult.features?.length || 0) > 0)) {
      const geometryJsonUtils = await importArc('@arcgis/core/geometry/support/jsonUtils.js');
      deterministicLayer = await buildDeterministicResultsLayer(mapResult, {
        FeatureLayer,
        Graphic,
        Point,
        fromJSON: geometryJsonUtils.fromJSON
      });
    }

    const overlayLayers = [];
    if (radiusMeters && !isLocate) overlayLayers.push(searchAreaLayer);
    overlayLayers.push(searchLocationLayer);

    markMapDiagStage('runtime_group_created', {
      groupId: RUNTIME_GROUP_ID,
      overlayLayerCount: overlayLayers.length,
      deterministicLayerId: deterministicLayer?.id || (authNativeActive ? authoritativeDisplayLayer?.id : null),
      authNativeActive,
      deterministicFeatureCount: deterministicLayer
        ? layerSourceFeatureCount(deterministicLayer)
        : (authNativeActive ? (deterministicBaseObjectIds?.length || 0) : 0)
    });

    const group = new GroupLayer({
      id: RUNTIME_GROUP_ID,
      title: buildGroupTitle(mapResult),
      listMode: 'show',
      visible: true,
      layers: overlayLayers
    });

    await addRuntimeLayer(group);
    if (deterministicLayer) {
      await addRuntimeLayer(deterministicLayer);
    }
    markMapDiagStage('webMap_add_completed', {
      groupId: RUNTIME_GROUP_ID,
      groupTitle: group.title,
      overlayLayerCount: overlayLayers.length,
      deterministicLayerOnMap: Boolean(deterministicLayer)
    });

    const featureLayers = deterministicLayer
      ? [deterministicLayer]
      : (authNativeActive && authoritativeDisplayLayer ? [authoritativeDisplayLayer] : []);
    setIqaiResultFeatureLayers(featureLayers);

    const view = getMapView();
    if (view && authNativeActive && authoritativeDisplayLayer) {
      try {
        await view.whenLayerView(authoritativeDisplayLayer);
        await applyDeterministicObjectIdFilter(null);
      } catch {
        // layer view may still initialize asynchronously
      }
      const inspect = await inspectIqaiRuntimeLayer(authoritativeDisplayLayer, view);
      window.__IQAI_RUNTIME_LAYER_INSPECT__ = { [authoritativeDisplayLayer.id]: inspect };
      window.__IQAI_DETERMINISTIC_LAYER__ = null;
      window.__IQAI_AUTH_NATIVE_LAYER__ = authoritativeDisplayLayer;
      window.__IQAI_MAP_VIEW__ = view;
      console.log('[IQAI Auth Native] Runtime layer inspect', inspect);
      reportDeterministicDisplayState(null);
    } else if (view && deterministicLayer) {
      try {
        await view.whenLayerView(deterministicLayer);
        if (deterministicUsesLayerViewFilter) {
          await applyDeterministicObjectIdFilter(null);
        }
      } catch {
        // layer view may still initialize asynchronously
      }
      const inspect = await inspectIqaiRuntimeLayer(deterministicLayer, view);
      const iqaiInspect = { [deterministicLayer.id]: inspect };
      window.__IQAI_RUNTIME_LAYER_INSPECT__ = iqaiInspect;
      window.__IQAI_DETERMINISTIC_LAYER__ = deterministicLayer;
      window.__IQAI_AUTH_NATIVE_LAYER__ = null;
      window.__IQAI_MAP_VIEW__ = view;
      console.log('[IQAI Deterministic Results] Runtime layer inspect', inspect);
      reportDeterministicDisplayState(deterministicLayer);
    } else if (view) {
      window.__IQAI_RUNTIME_LAYER_INSPECT__ = {};
      window.__IQAI_AUTH_NATIVE_LAYER__ = null;
      window.__IQAI_MAP_VIEW__ = view;
    }

    const points = [[originLon, originLat]];
    const datasetResults = mapResult.datasetResults || [];
    if (datasetResults.length) {
      for (const result of datasetResults) {
        for (const feature of featuresForDatasetResult(result, mapResult)) {
          const coords = featureCoordinates(feature);
          if (coords) points.push([coords.longitude, coords.latitude]);
        }
      }
    } else {
      for (const feature of mapResult.features || []) {
        const coords = featureCoordinates(feature);
        if (coords) points.push([coords.longitude, coords.latitude]);
      }
    }

    await zoomToQueryResult({
      originLon,
      originLat,
      radiusMeters,
      isLocate,
      points,
      searchCircleGeometry
    });
    markMapDiagStage('renderMapResultOnRuntime_success', {
      featureLayerCount: featureLayers.length,
      matchedFeatures: mapResult.summary?.matchedFeatures
    });
  } catch (error) {
    publishRendererDisplayState({ rendererMode: 'ERROR' });
    if (error?.iqaiMapDiagnostic) throw error;
    throw wrapMapCommandError(
      error?.iqaiMapStage || getCurrentMapDiagStage() || 'renderMapResultOnRuntime',
      error,
      {
        firstFeature: snapshotFirstFeature(mapResult),
        featureCount: mapResult.summary?.matchedFeatures,
        layerId: mapResult.datasetResults?.[0]?.conceptId
          ? `iqai-concept-${mapResult.datasetResults[0].conceptId}`
          : mapResult.datasetResults?.[0]?.datasetId
      }
    );
  }
}

export async function clearMapResultsOnRuntime() {
  await clearAuthNativeDisplayFilter();
  await clearRuntimeLayers();
  setIqaiResultFeatureLayers([]);
  lastScopedQueryContext = null;
  clearIqaiSelection(true);
  deterministicResultsLayer = null;
  if (typeof window !== 'undefined') {
    window.__IQAI_DETERMINISTIC_LAYER__ = null;
  }
  resetRendererDisplayState();
}
