/**
 * Browser-side Point Intelligence request builder.
 * Emits only spatial intent fields accepted by Agent 5.
 */
import {
  POINT_INTELLIGENCE_BUNDLE_AUTO,
  POINT_INTELLIGENCE_TEMPORAL_LATEST
} from './point-intelligence-config.js';

const ALLOWED_KEYS = new Set(['geometry', 'radiusMeters', 'domains', 'informationFamily']);
const ALLOWED_BUNDLE_KEYS = new Set([
  'geometry',
  'radiusMeters',
  'domains',
  'informationFamilies',
  'temporalIntent'
]);
const FORBIDDEN_KEYS = new Set([
  'url', 'endpoint', 'providerUrl', 'provider_url', 'provider', 'candidateId', 'capabilityId',
  'verified', 'forceCapabilityId', 'fetch', 'target', 'href', 'link'
]);

/**
 * @param {unknown} input
 * @returns {{ ok: true, payload: object } | { ok: false, error: string }}
 */
export function buildPointIntelligenceRequest(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, error: 'Request must be an object' };
  }

  for (const key of Object.keys(input)) {
    if (FORBIDDEN_KEYS.has(key)) {
      return { ok: false, error: `Forbidden authority field: ${key}` };
    }
    if (!ALLOWED_KEYS.has(key)) {
      return { ok: false, error: `Unsupported field: ${key}` };
    }
  }

  const longitude = Number(input.geometry?.coordinates?.[0]);
  const latitude = Number(input.geometry?.coordinates?.[1]);
  if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) {
    return { ok: false, error: 'WGS84 point required' };
  }

  const payload = {
    geometry: { type: 'Point', coordinates: [longitude, latitude] }
  };

  if (input.radiusMeters != null) payload.radiusMeters = Number(input.radiusMeters);
  if (Array.isArray(input.domains)) payload.domains = input.domains;
  if (input.informationFamily) payload.informationFamily = input.informationFamily;

  return { ok: true, payload };
}

/**
 * @param {object} payload
 * @param {object} [options]
 */
export async function queryPointIntelligence(payload, options = {}) {
  const built = buildPointIntelligenceRequest(payload);
  if (!built.ok) {
    return {
      queryState: 'INVALID_REQUEST',
      error: built.error,
      resultCount: 0,
      results: []
    };
  }

  const fetchImpl = options.fetchImpl || fetch;
  const response = await fetchImpl('/api/spatial/point-intelligence/query', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(built.payload),
    signal: options.signal
  });
  const body = await response.json().catch(() => ({}));
  return body;
}

/**
 * Governed request-model builder — represents LATEST / AT / RANGE without network execution.
 * @param {unknown} input
 */
export function buildPointIntelligenceBundleRequestModel(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, error: 'Request must be an object' };
  }

  for (const key of Object.keys(input)) {
    if (FORBIDDEN_KEYS.has(key)) {
      return { ok: false, error: `Forbidden authority field: ${key}` };
    }
    if (!ALLOWED_BUNDLE_KEYS.has(key)) {
      return { ok: false, error: `Unsupported field: ${key}` };
    }
  }

  const longitude = Number(input.geometry?.coordinates?.[0]);
  const latitude = Number(input.geometry?.coordinates?.[1]);
  if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) {
    return { ok: false, error: 'WGS84 point required' };
  }

  const informationFamilies = input.informationFamilies ?? POINT_INTELLIGENCE_BUNDLE_AUTO;
  if (informationFamilies !== POINT_INTELLIGENCE_BUNDLE_AUTO) {
    return { ok: false, error: 'informationFamilies must be AUTO' };
  }

  const temporalIntent = input.temporalIntent ?? POINT_INTELLIGENCE_TEMPORAL_LATEST;
  if (!temporalIntent?.mode) {
    return { ok: false, error: 'temporalIntent.mode required' };
  }

  const payload = {
    geometry: { type: 'Point', coordinates: [longitude, latitude] },
    informationFamilies: POINT_INTELLIGENCE_BUNDLE_AUTO,
    temporalIntent
  };

  if (input.radiusMeters != null) payload.radiusMeters = Number(input.radiusMeters);
  if (Array.isArray(input.domains)) payload.domains = input.domains;

  return { ok: true, payload };
}

/**
 * @param {unknown} input
 */
export function buildPointIntelligenceBundleRequest(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, error: 'Request must be an object' };
  }

  for (const key of Object.keys(input)) {
    if (FORBIDDEN_KEYS.has(key)) {
      return { ok: false, error: `Forbidden authority field: ${key}` };
    }
    if (!ALLOWED_BUNDLE_KEYS.has(key)) {
      return { ok: false, error: `Unsupported field: ${key}` };
    }
  }

  const longitude = Number(input.geometry?.coordinates?.[0]);
  const latitude = Number(input.geometry?.coordinates?.[1]);
  if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) {
    return { ok: false, error: 'WGS84 point required' };
  }

  const informationFamilies = input.informationFamilies ?? POINT_INTELLIGENCE_BUNDLE_AUTO;
  if (informationFamilies !== POINT_INTELLIGENCE_BUNDLE_AUTO) {
    return { ok: false, error: 'informationFamilies must be AUTO' };
  }

  const temporalIntent = input.temporalIntent ?? POINT_INTELLIGENCE_TEMPORAL_LATEST;
  if (!temporalIntent || temporalIntent.mode !== 'LATEST') {
    return { ok: false, error: 'temporalIntent.mode must be LATEST' };
  }

  const payload = {
    geometry: { type: 'Point', coordinates: [longitude, latitude] },
    informationFamilies: POINT_INTELLIGENCE_BUNDLE_AUTO,
    temporalIntent: POINT_INTELLIGENCE_TEMPORAL_LATEST
  };

  if (input.radiusMeters != null) payload.radiusMeters = Number(input.radiusMeters);
  if (Array.isArray(input.domains)) payload.domains = input.domains;

  return { ok: true, payload };
}

/**
 * @param {object} payload
 * @param {object} [options]
 */
export async function queryPointIntelligenceBundle(payload, options = {}) {
  const built = buildPointIntelligenceBundleRequest(payload);
  if (!built.ok) {
    return {
      bundleState: 'INVALID_REQUEST',
      error: built.error,
      families: [],
      queryReceipts: []
    };
  }

  const fetchImpl = options.fetchImpl || fetch;
  const response = await fetchImpl('/api/spatial/point-intelligence/query-bundle', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(built.payload),
    signal: options.signal
  });
  const body = await response.json().catch(() => ({}));
  return body;
}
