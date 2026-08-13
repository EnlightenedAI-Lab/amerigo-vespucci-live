/**
 * Point Intelligence orchestration — query lifecycle, stale-response guard.
 */
import {
  DEFAULT_RADIUS_METERS,
  POINT_INTELLIGENCE_FAMILIES,
  isVerifiedPointIntelligenceFamily
} from './point-intelligence-config.js';
import {
  queryPointIntelligence,
  queryPointIntelligenceBundle
} from './point-intelligence-request.js';
import {
  formatPointIntelligenceStatus,
  summarizePointIntelligenceResponse
} from './point-intelligence-status.js';
import {
  adaptBundleResponse,
  isBundleResponse
} from './point-intelligence-bundle.js';
import {
  isMultiFamilyPointIntelligenceResponse
} from './point-intelligence-multifamily.js';
import {
  replacePointIntelligencePresentation,
  clearPointIntelligenceLayers
} from './point-intelligence-layer.js';
import { setPointIntelligenceBundleContext } from './point-intelligence-focus-controller.js';
import {
  getActiveTemporalGeneration,
  getPointIntelligenceTemporalState
} from './point-intelligence-temporal-state.js';
import {
  canExecutePointIntelligenceTemporalRequest,
  buildPointIntelligenceTemporalIntentPayload,
  getUnsupportedTemporalMessage
} from './point-intelligence-temporal-gate.js';
import { buildProofStationRecords, isProofSourceFamily } from './point-intelligence-station-model.js';
import { getObservationId } from './point-intelligence-map-presentation.js';
import {
  queryPlanFromAoi,
  selectConstellationStations,
  stampResultsWithAoi,
  summarizeAoiConstellation
} from './point-intelligence-aoi-geometry.js';

let queryGeneration = 0;
let activeQueryGeneration = 0;
let requestCount = 0;
let unsupportedTemporalAttempts = 0;
let modeEnabled = false;
let lastResponse = null;
let lastClickedPoint = null;
let queryPhase = 'IDLE';
let acquisitionMode = 'POINT';

/** @type {Set<(state: object) => void>} */
const listeners = new Set();

function emit() {
  const snapshot = getPointIntelligenceState();
  for (const listener of listeners) {
    try {
      listener(snapshot);
    } catch (error) {
      console.warn('[IQAI PI] listener failed', error?.message || error);
    }
  }
}

export function getPointIntelligenceState() {
  return {
    modeEnabled,
    queryGeneration: activeQueryGeneration,
    requestCount,
    unsupportedTemporalAttempts,
    queryPhase,
    temporal: getPointIntelligenceTemporalState(),
    lastResponse,
    lastClickedPoint,
    acquisitionMode,
    summary: lastResponse ? summarizePointIntelligenceResponse(lastResponse) : null
  };
}

export function subscribePointIntelligenceState(listener) {
  listeners.add(listener);
  listener(getPointIntelligenceState());
  return () => listeners.delete(listener);
}

export function setPointIntelligenceModeEnabled(enabled) {
  modeEnabled = Boolean(enabled);
  if (!modeEnabled) {
    activeQueryGeneration += 1;
    lastResponse = null;
    lastClickedPoint = null;
    queryPhase = 'IDLE';
    acquisitionMode = 'POINT';
    void clearPointIntelligenceLayers();
    void import('./point-intelligence-area-controller.js')
      .then((mod) => mod.cancelAreaSketch())
      .catch(() => {});
  }
  emit();
  return modeEnabled;
}

export function isPointIntelligenceModeEnabled() {
  return modeEnabled;
}

export function getPointIntelligenceAcquisitionMode() {
  return acquisitionMode;
}

export function setPointIntelligenceAcquisitionMode(mode) {
  const next = mode === 'AREA' ? 'AREA' : 'POINT';
  if (next === acquisitionMode) {
    emit();
    return acquisitionMode;
  }
  acquisitionMode = next;
  if (next === 'POINT') {
    void import('./point-intelligence-area-controller.js')
      .then((mod) => mod.cancelAreaSketch())
      .catch(() => {});
    void import('./point-intelligence-aoi-layer.js')
      .then((mod) => mod.clearAcquisitionMesh())
      .catch(() => {});
  } else {
    void import('./point-intelligence-aoi-layer.js')
      .then((mod) => mod.clearQuickPointFootprint())
      .catch(() => {});
  }
  emit();
  return acquisitionMode;
}

export function resetPointIntelligenceAcquisitionResults() {
  lastResponse = null;
  lastClickedPoint = null;
  queryPhase = 'IDLE';
  emit();
}

/** @deprecated V1 single-family selector — bundle uses AUTO by default. */
export function setPointIntelligenceFamily(family) {
  if (!isVerifiedPointIntelligenceFamily(family)) return;
  emit();
}

export function getPointIntelligenceRequestCount() {
  return requestCount;
}

export function resetPointIntelligenceRequestCount() {
  requestCount = 0;
  unsupportedTemporalAttempts = 0;
}

export function getPointIntelligenceUnsupportedTemporalAttempts() {
  return unsupportedTemporalAttempts;
}

export function resetPointIntelligenceUnsupportedTemporalAttempts() {
  unsupportedTemporalAttempts = 0;
}

export async function invalidatePointIntelligenceEvidenceForTemporalChange(temporalState) {
  activeQueryGeneration += 1;
  lastResponse = null;
  try {
    await clearPointIntelligenceLayers();
  } catch (error) {
    console.warn('[IQAI PI] temporal clear skipped:', error?.message || error);
  }
  emit();
  return {
    queryState: 'TEMPORAL_UNSUPPORTED',
    temporalBlocked: true,
    temporalMode: temporalState?.mode || null,
    message: getUnsupportedTemporalMessage()
  };
}

function isSingleFamilyRequest(input, options = {}) {
  return Boolean(input.informationFamily || options.singleFamily);
}

function responseHasRenderableGeometry(response) {
  return Array.isArray(response?.results)
    && response.results.some((result) => result?.geometry?.type);
}

const PRESENTABLE_STATES = new Set([
  'SUCCESS',
  'PARTIAL_RESULTS',
  'PARTIAL_FAILURE',
  'NO_RESULTS'
]);

async function applyPresentation(point, response) {
  const state = String(response?.bundleState || response?.queryState || 'ERROR');
  if (!PRESENTABLE_STATES.has(state)) return;
  try {
    await setPointIntelligenceBundleContext(point, response);
  } catch (error) {
    console.warn('[IQAI PI] map presentation skipped:', error?.message || error);
  }
}

/**
 * @param {{ longitude: number, latitude: number, informationFamily?: string, radiusMeters?: number }} input
 * @param {object} [options]
 */
export async function runPointIntelligenceQuery(input, options = {}) {
  if (!modeEnabled && !options.force) {
    return { queryState: 'IDLE', skipped: true };
  }

  const temporalState = getPointIntelligenceTemporalState();
  const temporalGenerationAtStart = getActiveTemporalGeneration();
  const gate = canExecutePointIntelligenceTemporalRequest(temporalState);
  if (gate.status !== 'EXECUTABLE') {
    unsupportedTemporalAttempts += 1;
    queryPhase = 'READY';
    const blocked = await invalidatePointIntelligenceEvidenceForTemporalChange(temporalState);
    lastResponse = {
      queryState: 'TEMPORAL_UNSUPPORTED',
      bundleState: 'TEMPORAL_UNSUPPORTED',
      multiFamily: true,
      families: {},
      familiesWithEvidence: 0,
      results: [],
      resultCount: 0,
      message: getUnsupportedTemporalMessage(),
      ...blocked
    };
    emit();
    return lastResponse;
  }

  const generation = ++queryGeneration;
  activeQueryGeneration = generation;
  requestCount += 1;
  queryPhase = 'QUERYING';

  const point = {
    longitude: Number(input.longitude),
    latitude: Number(input.latitude)
  };
  lastClickedPoint = point;
  lastResponse = {
    queryState: 'QUERYING',
    bundleState: 'QUERYING',
    multiFamily: true,
    families: {},
    familiesWithEvidence: 0,
    results: [],
    resultCount: 0,
    request: {
      geometry: { type: 'Point', coordinates: [point.longitude, point.latitude] }
    }
  };

  emit();

  if (!options.skipPresentation) {
    try {
      await replacePointIntelligencePresentation(point, []);
    } catch (error) {
      console.warn('[IQAI PI] map presentation skipped:', error?.message || error);
    }
  }

  const radiusMeters = input.radiusMeters ?? DEFAULT_RADIUS_METERS;
  const geometry = { type: 'Point', coordinates: [point.longitude, point.latitude] };
  const temporalPayload = buildPointIntelligenceTemporalIntentPayload(temporalState);

  let response;
  try {
    if (isSingleFamilyRequest(input, options)) {
      response = await queryPointIntelligence({
        geometry,
        radiusMeters,
        informationFamily: input.informationFamily
      }, options);
      response = {
        ...response,
        request: {
          geometry,
          informationFamily: input.informationFamily,
          radiusMeters,
          temporalIntent: temporalPayload.ok ? temporalPayload.temporalIntent : undefined
        }
      };
    } else {
      const bundle = await queryPointIntelligenceBundle({
        geometry,
        radiusMeters,
        temporalIntent: temporalPayload.ok ? temporalPayload.temporalIntent : undefined
      }, options);
      if (generation !== queryGeneration || temporalGenerationAtStart !== getActiveTemporalGeneration()) {
        return { stale: true, queryState: 'STALE' };
      }
      response = adaptBundleResponse(bundle, point, generation);
      response = {
        ...response,
        request: {
          ...response.request,
          geometry: { type: 'Point', coordinates: [point.longitude, point.latitude] },
          radiusMeters,
          temporalIntent: temporalPayload.ok ? temporalPayload.temporalIntent : response.request?.temporalIntent
        }
      };
    }
  } catch (error) {
    response = {
      queryState: 'ERROR',
      bundleState: 'ERROR',
      multiFamily: true,
      families: {},
      familiesWithEvidence: 0,
      results: [],
      resultCount: 0,
      error: error?.message || 'Point Intelligence request failed',
      request: { geometry, radiusMeters }
    };
  }

  if (generation !== queryGeneration || temporalGenerationAtStart !== getActiveTemporalGeneration()) {
    return { stale: true, queryState: 'STALE' };
  }

  lastResponse = response;
  queryPhase = 'READY';
  if (!options.skipPresentation) {
    if (lastResponse && !lastResponse.acquisition) {
      lastResponse = { ...lastResponse, acquisition: { mode: 'POINT' } };
    }
    await applyPresentation(point, lastResponse);
    emit();
  }
  return lastResponse;
}

function retainSelectedProofResults(response, selectedStations) {
  const keep = new Set();
  for (const station of selectedStations) {
    for (const id of station.observationIds || []) keep.add(id);
    if (station.observationId) keep.add(station.observationId);
  }
  const keepResult = (result) => {
    const family = result?.category || result?.nativeCollectionId;
    if (!isProofSourceFamily(family)) return true;
    return keep.has(getObservationId(result))
      || keep.has(result?.resultId)
      || keep.has(result?.nativeRecordId);
  };
  const results = (response.results || []).filter(keepResult);
  const families = {};
  for (const [key, entry] of Object.entries(response.families || {})) {
    if (!entry || typeof entry !== 'object') {
      families[key] = entry;
      continue;
    }
    const familyResults = Array.isArray(entry.results) ? entry.results.filter(keepResult) : [];
    families[key] = {
      ...entry,
      results: familyResults,
      resultCount: familyResults.length,
      hasEvidence: familyResults.length > 0 || entry.hasEvidence
    };
  }
  return {
    ...response,
    results,
    resultCount: results.length,
    families
  };
}

export async function runPointIntelligenceAreaQuery(polygon, options = {}) {
  if (!modeEnabled && !options.force) {
    return { queryState: 'IDLE', skipped: true };
  }
  const plan = queryPlanFromAoi(polygon);
  if (!plan) {
    return { queryState: 'ERROR', error: 'Invalid acquisition geometry', acquisition: { mode: 'AREA' } };
  }
  acquisitionMode = 'AREA';
  const started = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
  const point = plan.centroid;
  const radiusMeters = plan.radiusMeters;
  const response = await runPointIntelligenceQuery({
    longitude: point.longitude,
    latitude: point.latitude,
    radiusMeters
  }, { ...options, force: true, skipPresentation: true });
  if (response?.stale || response?.skipped) return response;

  const queryMs = Math.round(
    ((typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now()) - started
  );
  const proofRecords = buildProofStationRecords(response.results || [], {
    retrievedAt: response.retrievedAt
  });
  const stations = selectConstellationStations(proofRecords, polygon);
  const stamped = stampResultsWithAoi(response.results || [], stations);
  const classified = retainSelectedProofResults({ ...response, results: stamped }, stations);
  const summary = summarizeAoiConstellation(stations);
  const classifiedFamilies = {};
  for (const [key, entry] of Object.entries(classified.families || {})) {
    if (!entry?.results) {
      classifiedFamilies[key] = entry;
      continue;
    }
    classifiedFamilies[key] = {
      ...entry,
      results: stampResultsWithAoi(entry.results, stations)
    };
  }

  lastResponse = {
    ...classified,
    families: classifiedFamilies,
    results: stampResultsWithAoi(classified.results || [], stations),
    acquisition: {
      mode: 'AREA',
      polygon,
      plan: {
        centroid: plan.centroid,
        radiusMeters: plan.radiusMeters,
        bbox: plan.bbox,
        aoiBbox: plan.aoiBbox
      },
      summary,
      stations,
      performance: {
        queryMs,
        stationCount: stations.length,
        insideCount: summary.insideCount,
        supportingCount: summary.supportingCount
      }
    }
  };
  lastClickedPoint = point;
  queryPhase = 'READY';
  await applyPresentation(point, lastResponse);
  emit();
  return lastResponse;
}

export function getPointIntelligencePresentation(response = lastResponse) {
  if (!response) {
    return formatPointIntelligenceStatus('IDLE');
  }
  if (response.queryState === 'QUERYING' || response.bundleState === 'QUERYING') {
    return formatPointIntelligenceStatus('QUERYING');
  }
  if (isBundleResponse(response) || isMultiFamilyPointIntelligenceResponse(response)) {
    const count = response.familiesWithEvidence || 0;
    const total = response.familiesQueried
      || response.relationships?.familyAvailability?.requested
      || Object.keys(response.families || {}).length;
    if (count > 0) {
      const bundleState = response.bundleState || response.queryState;
      return formatPointIntelligenceStatus(
        ['SUCCESS', 'PARTIAL_RESULTS', 'PARTIAL_FAILURE'].includes(bundleState)
          ? (count === total ? 'SUCCESS' : 'PARTIAL_RESULTS')
          : bundleState,
        {
          ...response,
          familiesWithEvidence: count,
          message: `${count} of ${total} information families returned local evidence.`
        }
      );
    }
  }
  return formatPointIntelligenceStatus(response.bundleState || response.queryState, response);
}

export { POINT_INTELLIGENCE_FAMILIES };
