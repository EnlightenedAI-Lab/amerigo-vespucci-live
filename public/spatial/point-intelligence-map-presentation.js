/**
 * Deterministic Point Intelligence map presentation / thinning model.
 * Presentation only — canonical bundle evidence unchanged.
 */
import { PI_MAP_MODE } from './point-intelligence-focus-state.js';

const DEFAULT_PER_FAMILY_ASSET_LIMIT = 3;

/**
 * @param {object} result
 */
export function getObservationId(result) {
  return result?.resultId
    || result?.nativeRecordId
    || `${result?.category || 'unknown'}:${result?.providerName || 'src'}:${JSON.stringify(result?.geometry?.coordinates || [])}`;
}

/**
 * @param {object} result
 */
export function getAuthoritativeAssetKey(result) {
  const props = result?.properties || {};
  const stationId = props.STATION_NUMBER
    || props.IDENTIFIER
    || props.CLIMATE_IDENTIFIER
    || props.station_id
    || props.location_id
    || null;
  if (stationId) {
    return `station:${String(stationId).trim()}`;
  }
  if (result?.nativeRecordId && /station|registry/i.test(String(result?.resultKind || ''))) {
    return `native:${result.nativeRecordId}`;
  }
  const geom = result?.geometry;
  if (geom?.type === 'Point' && Array.isArray(geom.coordinates)) {
    const [lon, lat] = geom.coordinates;
    if (Number.isFinite(lon) && Number.isFinite(lat)) {
      return `geom:${lon.toFixed(6)}:${lat.toFixed(6)}`;
    }
  }
  return `obs:${getObservationId(result)}`;
}

/**
 * @param {object} result
 */
export function observationHasSpatialGeometry(result) {
  return Boolean(result?.geometry?.type);
}

/**
 * @param {object[]} results
 */
export function indexSpatialEvidence(results = []) {
  /** @type {import('./point-intelligence-map-presentation.js').SpatialEvidenceIndex} */
  const index = {
    observations: [],
    spatialObservations: [],
    byFamily: new Map(),
    byAssetKey: new Map(),
    byObservationId: new Map()
  };

  for (const result of results) {
    const observationId = getObservationId(result);
    const family = result.category || result.nativeCollectionId || 'unknown';
    const hasGeometry = observationHasSpatialGeometry(result);
    const assetKey = getAuthoritativeAssetKey(result);
    const entry = {
      observationId,
      family,
      assetKey,
      hasGeometry,
      distanceMeters: result.clickDistanceMeters ?? null,
      observedAt: result?.observation?.observedAt
        || result?.temporal?.LOCAL_DATE
        || result?.temporal?.['date_tm-value']
        || result?.properties?.LOCAL_DATE
        || null,
      result
    };
    index.observations.push(entry);
    index.byObservationId.set(observationId, entry);
    if (!index.byFamily.has(family)) index.byFamily.set(family, []);
    index.byFamily.get(family).push(entry);
    if (hasGeometry) {
      index.spatialObservations.push(entry);
      if (!index.byAssetKey.has(assetKey)) index.byAssetKey.set(assetKey, []);
      index.byAssetKey.get(assetKey).push(entry);
    }
  }
  return index;
}

/**
 * @param {object[]} entries
 */
function sortByRecencyThenDistance(entries) {
  return [...entries].sort((a, b) => {
    const ta = Date.parse(a.observedAt || '') || 0;
    const tb = Date.parse(b.observedAt || '') || 0;
    if (ta !== tb) return tb - ta;
    const da = Number.isFinite(a.distanceMeters) ? a.distanceMeters : Number.POSITIVE_INFINITY;
    const db = Number.isFinite(b.distanceMeters) ? b.distanceMeters : Number.POSITIVE_INFINITY;
    if (da !== db) return da - db;
    return String(a.observationId).localeCompare(String(b.observationId));
  });
}

function sortByDistanceThenRecency(entries) {
  return [...entries].sort((a, b) => {
    const da = Number.isFinite(a.distanceMeters) ? a.distanceMeters : Number.POSITIVE_INFINITY;
    const db = Number.isFinite(b.distanceMeters) ? b.distanceMeters : Number.POSITIVE_INFINITY;
    if (da !== db) return da - db;
    const ta = Date.parse(a.observedAt || '') || 0;
    const tb = Date.parse(b.observedAt || '') || 0;
    if (ta !== tb) return tb - ta;
    return String(a.observationId).localeCompare(String(b.observationId));
  });
}

/**
 * @param {Map<string, object[]>} byFamily
 * @param {number} [limitPerFamily]
 */
function selectRepresentativeAssets(byFamily, limitPerFamily = 1) {
  /** @type {Map<string, object>} */
  const selected = new Map();
  for (const [family, entries] of byFamily.entries()) {
    const spatial = entries.filter((e) => e.hasGeometry);
    if (!spatial.length) continue;
    const byAsset = new Map();
    for (const entry of spatial) {
      if (!byAsset.has(entry.assetKey)) byAsset.set(entry.assetKey, []);
      byAsset.get(entry.assetKey).push(entry);
    }
    const assetGroups = sortByDistanceThenRecency(
      [...byAsset.entries()].map(([assetKey, obs]) => ({
        assetKey,
        observations: obs,
        distanceMeters: sortByDistanceThenRecency(obs)[0]?.distanceMeters ?? null,
        observedAt: sortByDistanceThenRecency(obs)[0]?.observedAt ?? null,
        observationId: sortByDistanceThenRecency(obs)[0]?.observationId
      }))
    );
    for (const group of assetGroups.slice(0, limitPerFamily)) {
      selected.set(`${family}:${group.assetKey}`, {
        assetKey: group.assetKey,
        family,
        observationIds: group.observations.map((o) => o.observationId),
        representativeObservationId: group.observationId,
        observationCount: group.observations.length,
        distanceMeters: group.distanceMeters,
        geometry: group.observations[0]?.result?.geometry || null,
        result: group.observations[0]?.result
      });
    }
  }
  return selected;
}

/**
 * @param {object} focusState
 * @param {ReturnType<typeof indexSpatialEvidence>} index
 */
function resolveMode(focusState, index) {
  if (focusState?.mode === PI_MAP_MODE.FOCUSED_OBSERVATION && focusState.focusedObservationId) {
    return PI_MAP_MODE.FOCUSED_OBSERVATION;
  }
  if (focusState?.mode === PI_MAP_MODE.FOCUSED_FAMILY && focusState.focusedFamily) {
    return PI_MAP_MODE.FOCUSED_FAMILY;
  }
  const spatialCount = index.spatialObservations.length;
  const uniqueAssets = index.byAssetKey.size;
  if (spatialCount <= 12 && uniqueAssets <= 12) {
    return PI_MAP_MODE.ALL_RELEVANT;
  }
  return PI_MAP_MODE.REPRESENTATIVE;
}

/**
 * @param {object[]} results
 * @param {object} [focusState]
 * @param {object} [options]
 */
export function buildPointIntelligenceMapPresentation(results = [], focusState = {}, options = {}) {
  const index = indexSpatialEvidence(results);
  const mode = resolveMode(focusState, index);
  const perFamilyLimit = mode === PI_MAP_MODE.FOCUSED_FAMILY
    ? DEFAULT_PER_FAMILY_ASSET_LIMIT
    : 1;

  /** @type {Map<string, object>} */
  let renderedAssets = new Map();

  if (mode === PI_MAP_MODE.FOCUSED_OBSERVATION && focusState.focusedObservationId) {
    const focused = index.byObservationId.get(focusState.focusedObservationId);
    if (focused?.hasGeometry) {
      const key = `${focused.family}:${focused.assetKey}`;
      renderedAssets.set(key, {
        assetKey: focused.assetKey,
        family: focused.family,
        observationIds: index.byAssetKey.get(focused.assetKey)?.map((o) => o.observationId) || [focused.observationId],
        representativeObservationId: focused.observationId,
        observationCount: index.byAssetKey.get(focused.assetKey)?.length || 1,
        distanceMeters: focused.distanceMeters,
        geometry: focused.result.geometry,
        result: focused.result,
        emphasized: true
      });
    }
    const familyEntries = focusState.focusedFamily
      ? index.byFamily.get(focusState.focusedFamily) || []
      : [];
    const reps = selectRepresentativeAssets(
      new Map([[focused?.family || 'unknown', familyEntries]]),
      1
    );
    for (const [key, asset] of reps) {
      if (!renderedAssets.has(key)) renderedAssets.set(key, { ...asset, emphasized: false });
    }
  } else if (mode === PI_MAP_MODE.FOCUSED_FAMILY && focusState.focusedFamily) {
    const familyEntries = index.byFamily.get(focusState.focusedFamily) || [];
    renderedAssets = selectRepresentativeAssets(
      new Map([[focusState.focusedFamily, familyEntries]]),
      perFamilyLimit
    );
    for (const asset of renderedAssets.values()) asset.emphasized = true;
    const otherFamilies = new Map(
      [...index.byFamily.entries()].filter(([family]) => family !== focusState.focusedFamily)
    );
    const context = selectRepresentativeAssets(otherFamilies, 1);
    for (const [key, asset] of context) {
      if (!renderedAssets.has(key)) renderedAssets.set(key, { ...asset, emphasized: false, deemphasized: true });
    }
  } else if (mode === PI_MAP_MODE.ALL_RELEVANT) {
    renderedAssets = selectRepresentativeAssets(index.byFamily, DEFAULT_PER_FAMILY_ASSET_LIMIT);
  } else {
    renderedAssets = selectRepresentativeAssets(index.byFamily, 1);
  }

  if (focusState.focusedObservationId) {
    const focused = index.byObservationId.get(focusState.focusedObservationId);
    if (focused?.hasGeometry) {
      const key = `${focused.family}:${focused.assetKey}`;
      const existing = renderedAssets.get(key);
      if (existing) {
        existing.emphasized = true;
        existing.representativeObservationId = focused.observationId;
      } else {
        renderedAssets.set(key, {
          assetKey: focused.assetKey,
          family: focused.family,
          observationIds: index.byAssetKey.get(focused.assetKey)?.map((o) => o.observationId) || [focused.observationId],
          representativeObservationId: focused.observationId,
          observationCount: index.byAssetKey.get(focused.assetKey)?.length || 1,
          distanceMeters: focused.distanceMeters,
          geometry: focused.result.geometry,
          result: focused.result,
          emphasized: true
        });
      }
    }
  }

  const renderedMarkers = [...renderedAssets.values()];
  const uniqueSpatialAssets = index.byAssetKey.size;
  const renderedMapLocations = renderedMarkers.length;
  const totalObservations = index.observations.length;
  const spatialObservations = index.spatialObservations.length;

  return {
    mode,
    index,
    renderedMarkers,
    accounting: {
      totalObservations,
      spatialObservations,
      uniqueSpatialAssets,
      renderedMapLocations,
      thinned: renderedMapLocations < uniqueSpatialAssets || renderedMapLocations < spatialObservations
    },
    focusState: {
      focusedFamily: focusState.focusedFamily || null,
      focusedObservationId: focusState.focusedObservationId || null
    }
  };
}

/**
 * Resolve observation target from deterministic location fact text metadata.
 * @param {object} fact
 * @param {ReturnType<typeof indexSpatialEvidence>} index
 * @param {Record<string, string>} familyLabelToKey
 */
export function resolveFactObservationTarget(fact, index, familyLabelToKey = {}) {
  if (!fact?.familyKey && !fact?.label) return null;
  const family = fact.familyKey || familyLabelToKey[fact.label] || null;
  if (!family) return null;
  if (fact.kind === 'nearest') {
    const entries = sortByDistanceThenRecency((index.byFamily.get(family) || []).filter((e) => e.hasGeometry));
    return entries[0]?.observationId || null;
  }
  if (fact.kind === 'newest') {
    const entries = sortByRecencyThenDistance(
      (index.byFamily.get(family) || []).filter((e) => e.hasGeometry)
    );
    return entries[0]?.observationId || null;
  }
  return null;
}
