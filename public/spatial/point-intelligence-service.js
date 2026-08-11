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

let queryGeneration = 0;
let activeQueryGeneration = 0;
let requestCount = 0;
let unsupportedTemporalAttempts = 0;
let modeEnabled = false;
let lastResponse = null;
let lastClickedPoint = null;

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
    temporal: getPointIntelligenceTemporalState(),
    lastResponse,
    lastClickedPoint,
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
    void clearPointIntelligenceLayers();
  }
  emit();
  return modeEnabled;
}

export function isPointIntelligenceModeEnabled() {
  return modeEnabled;
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
    return invalidatePointIntelligenceEvidenceForTemporalChange(temporalState);
  }

  const generation = ++queryGeneration;
  activeQueryGeneration = generation;
  requestCount += 1;

  const point = {
    longitude: Number(input.longitude),
    latitude: Number(input.latitude)
  };
  lastClickedPoint = point;

  emit();

  const querying = { queryState: 'QUERYING' };
  listeners.forEach((listener) => {
    try { listener({ ...getPointIntelligenceState(), pending: querying }); } catch { /* ignore */ }
  });

  try {
    await replacePointIntelligencePresentation(point, []);
  } catch (error) {
    console.warn('[IQAI PI] map presentation skipped:', error?.message || error);
  }

  const radiusMeters = input.radiusMeters ?? DEFAULT_RADIUS_METERS;
  const geometry = { type: 'Point', coordinates: [point.longitude, point.latitude] };
  const temporalPayload = buildPointIntelligenceTemporalIntentPayload(temporalState);

  let response;
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

  if (generation !== queryGeneration || temporalGenerationAtStart !== getActiveTemporalGeneration()) {
    return { stale: true, queryState: 'STALE' };
  }

  lastResponse = response;
  await applyPresentation(point, response);
  emit();
  return response;
}

export function getPointIntelligencePresentation(response = lastResponse) {
  if (!response) {
    return formatPointIntelligenceStatus('IDLE');
  }
  if (isBundleResponse(response) || isMultiFamilyPointIntelligenceResponse(response)) {
    const count = response.familiesWithEvidence || 0;
    const total = response.familiesQueried
      || response.relationships?.familyAvailability?.requested
      || Object.keys(response.families || {}).length;
    if (count > 0) {
      const bundleState = response.bundleState || response.queryState;
      const severity = ['SUCCESS', 'PARTIAL_RESULTS'].includes(bundleState) ? 'success' : 'info';
      return {
        state: bundleState,
        message: `${count} of ${total} information families returned local evidence.`,
        severity
      };
    }
  }
  return formatPointIntelligenceStatus(response.bundleState || response.queryState, response);
}

export { POINT_INTELLIGENCE_FAMILIES };
