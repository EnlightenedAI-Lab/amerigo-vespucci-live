/**
 * Open-world intelligence query lifecycle — separate from Agent 5 PI plane.
 */
import { queryOpenWorldIntelligence } from './open-world-intelligence-request.js';
import { normalizeOpenWorldSearchResponse } from './open-world-intelligence-model.js';
import { buildAgent2SearchQueryPlan, isAgent2TemporalQuerySupported } from './open-world-intelligence-temporal-mapping.js';
import { getPointIntelligenceTemporalState } from './point-intelligence-temporal-state.js';
import { DEFAULT_OPEN_WORLD_RADIUS_METERS } from './open-world-intelligence-config.js';
import { resetOpenWorldMapPresentation, clearOpenWorldMapLayers } from './open-world-intelligence-map-layer.js';
import { resetOpenWorldFocusState } from './open-world-intelligence-map-state.js';
import { closeOpenWorldInspector } from './open-world-intelligence-inspector-controller.js';

let queryGeneration = 0;
let temporalInvalidationEpoch = 0;
let activeSearchRequestId = 0;
let requestCount = 0;
let lastKeyword = '';
let lastResponse = null;
let lastAnchor = null;

/** @type {Set<(state: object) => void>} */
const listeners = new Set();

function emit() {
  const snapshot = getOpenWorldIntelligenceState();
  for (const listener of listeners) {
    try { listener(snapshot); } catch { /* ignore */ }
  }
}

export function getOpenWorldIntelligenceState() {
  return {
    queryGeneration,
    requestCount,
    lastKeyword,
    lastResponse,
    lastAnchor,
    temporal: getPointIntelligenceTemporalState()
  };
}

export function subscribeOpenWorldIntelligenceState(listener) {
  listeners.add(listener);
  listener(getOpenWorldIntelligenceState());
  return () => listeners.delete(listener);
}

export function getOpenWorldIntelligenceRequestCount() {
  return requestCount;
}

export function resetOpenWorldIntelligenceRequestCount() {
  requestCount = 0;
}

export function invalidateOpenWorldIntelligenceForTemporalChangeSync() {
  temporalInvalidationEpoch += 1;
  queryGeneration += 1;
  lastResponse = null;
  resetOpenWorldFocusState(queryGeneration);
  closeOpenWorldInspector();
  emit();
}

export async function invalidateOpenWorldIntelligenceForTemporalChange() {
  invalidateOpenWorldIntelligenceForTemporalChangeSync();
  await clearOpenWorldMapLayers();
}

/**
 * @param {{ keyword?: string, point?: { latitude: number, longitude: number }, radiusMeters?: number, interpretation?: string }} input
 */
export async function runOpenWorldIntelligenceSearch(input = {}, options = {}) {
  const temporal = getPointIntelligenceTemporalState();
  const interpretation = input.interpretation || temporal.interpretationMode;

  const support = isAgent2TemporalQuerySupported({
    timeMode: temporal.mode,
    interpretation
  });
  if (support.status !== 'SUPPORTED') {
    return {
      searchState: 'UNSUPPORTED',
      error: support.message,
      temporalBlocked: true
    };
  }

  const requestId = ++activeSearchRequestId;
  const invalidationEpochAtStart = temporalInvalidationEpoch;
  const generation = ++queryGeneration;
  const keyword = String(input.keyword || '').trim();
  lastKeyword = keyword;

  const point = input.point || lastAnchor;
  const radiusMeters = input.radiusMeters ?? DEFAULT_OPEN_WORLD_RADIUS_METERS;
  if (point) lastAnchor = { ...point, radiusMeters };

  emit();

  const plan = buildAgent2SearchQueryPlan({
    keyword,
    temporal,
    interpretation,
    spatial: point ? {
      geometry: { type: 'Point', coordinates: [point.longitude, point.latitude] },
      radiusMeters,
      province: 'QC'
    } : { province: 'QC' }
  });
  if (!plan.ok) {
    return { searchState: 'INVALID_REQUEST', error: plan.message || plan.error };
  }

  requestCount += 1;
  const raw = await queryOpenWorldIntelligence({
    keyword: keyword || null,
    interpretation,
    temporal,
    geometry: point ? { type: 'Point', coordinates: [point.longitude, point.latitude] } : undefined,
    radiusMeters,
    province: 'QC'
  }, options);

  if (
    requestId !== activeSearchRequestId
    || invalidationEpochAtStart !== temporalInvalidationEpoch
  ) {
    return { searchState: 'STALE', stale: true };
  }

  const normalized = normalizeOpenWorldSearchResponse(raw, point ? {
    latitude: point.latitude,
    longitude: point.longitude,
    radiusMeters
  } : null);

  lastResponse = { ...raw, normalized, searchState: raw.searchState || 'SUCCESS' };
  await resetOpenWorldMapPresentation(normalized, generation);
  emit();
  return lastResponse;
}
