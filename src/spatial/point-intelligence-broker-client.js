/**
 * Agent 1 server-side client for the governed Agent 5 Point Intelligence broker.
 * Serializes allowlisted spatial intent only — no provider/capability authority.
 */

import {
  isVerifiedPointIntelligenceFamily
} from '../../public/spatial/point-intelligence-config.js';

const ALLOWED_REQUEST_KEYS = new Set([
  'geometry',
  'radiusMeters',
  'domains',
  'informationFamily'
]);

const ALLOWED_BUNDLE_REQUEST_KEYS = new Set([
  'geometry',
  'radiusMeters',
  'domains',
  'informationFamilies',
  'temporalIntent',
  'purpose',
  'tenant'
]);

const FORBIDDEN_KEYS = new Set([
  'url',
  'endpoint',
  'providerUrl',
  'provider_url',
  'provider',
  'candidateId',
  'capabilityId',
  'verified',
  'forceCapabilityId',
  'fetch',
  'target',
  'href',
  'link'
]);

/**
 * @param {unknown} body
 * @returns {{ ok: true, value: object } | { ok: false, error: string }}
 */
export function buildPointIntelligenceBrokerRequest(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, error: 'Request body must be a JSON object' };
  }

  for (const key of Object.keys(body)) {
    if (FORBIDDEN_KEYS.has(key)) {
      return { ok: false, error: `Arbitrary authority field not permitted: ${key}` };
    }
    if (!ALLOWED_REQUEST_KEYS.has(key)) {
      return { ok: false, error: `Unsupported request field: ${key}` };
    }
  }

  const geometry = body.geometry;
  if (!geometry || geometry.type !== 'Point' || !Array.isArray(geometry.coordinates)) {
    return { ok: false, error: 'geometry.type must be Point with coordinates [longitude, latitude]' };
  }

  const [longitude, latitude] = geometry.coordinates;
  if (typeof longitude !== 'number' || typeof latitude !== 'number') {
    return { ok: false, error: 'coordinates must be numeric [longitude, latitude]' };
  }
  if (longitude < -180 || longitude > 180 || latitude < -90 || latitude > 90) {
    return { ok: false, error: 'coordinates out of valid WGS84 range' };
  }

  const radiusMeters = body.radiusMeters ?? 3000;
  if (typeof radiusMeters !== 'number' || radiusMeters <= 0 || radiusMeters > 50000) {
    return { ok: false, error: 'radiusMeters must be a positive number <= 50000' };
  }

  const domains = body.domains ?? [];
  if (!Array.isArray(domains) || domains.some((d) => typeof d !== 'string')) {
    return { ok: false, error: 'domains must be an array of strings' };
  }

  const informationFamily = body.informationFamily ?? null;
  if (informationFamily != null && !isVerifiedPointIntelligenceFamily(informationFamily)) {
    return { ok: false, error: 'informationFamily is not a verified Point Intelligence family' };
  }

  return {
    ok: true,
    value: {
      geometry: { type: 'Point', coordinates: [longitude, latitude] },
      radiusMeters,
      domains,
      ...(informationFamily ? { informationFamily } : {})
    }
  };
}

/**
 * @param {unknown} body
 * @returns {{ ok: true, value: object } | { ok: false, error: string }}
 */
export function buildPointIntelligenceBrokerBundleRequest(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, error: 'Request body must be a JSON object' };
  }

  for (const key of Object.keys(body)) {
    if (FORBIDDEN_KEYS.has(key)) {
      return { ok: false, error: `Arbitrary authority field not permitted: ${key}` };
    }
    if (!ALLOWED_BUNDLE_REQUEST_KEYS.has(key)) {
      return { ok: false, error: `Unsupported request field: ${key}` };
    }
  }

  const geometry = body.geometry;
  if (!geometry || geometry.type !== 'Point' || !Array.isArray(geometry.coordinates)) {
    return { ok: false, error: 'geometry.type must be Point with coordinates [longitude, latitude]' };
  }

  const [longitude, latitude] = geometry.coordinates;
  if (typeof longitude !== 'number' || typeof latitude !== 'number') {
    return { ok: false, error: 'coordinates must be numeric [longitude, latitude]' };
  }
  if (longitude < -180 || longitude > 180 || latitude < -90 || latitude > 90) {
    return { ok: false, error: 'coordinates out of valid WGS84 range' };
  }

  const radiusMeters = body.radiusMeters ?? 3000;
  if (typeof radiusMeters !== 'number' || radiusMeters <= 0 || radiusMeters > 50000) {
    return { ok: false, error: 'radiusMeters must be a positive number <= 50000' };
  }

  const domains = body.domains ?? [];
  if (!Array.isArray(domains) || domains.some((d) => typeof d !== 'string')) {
    return { ok: false, error: 'domains must be an array of strings' };
  }

  const informationFamilies = body.informationFamilies ?? 'AUTO';
  if (informationFamilies !== 'AUTO') {
    return { ok: false, error: 'informationFamilies must be AUTO for product bundle execution' };
  }

  const temporalIntent = body.temporalIntent ?? { mode: 'LATEST' };
  if (!temporalIntent || typeof temporalIntent !== 'object' || temporalIntent.mode !== 'LATEST') {
    return { ok: false, error: 'temporalIntent.mode must be LATEST for product bundle execution' };
  }

  return {
    ok: true,
    value: {
      geometry: { type: 'Point', coordinates: [longitude, latitude] },
      radiusMeters,
      domains,
      informationFamilies: 'AUTO',
      temporalIntent: { mode: 'LATEST' }
    }
  };
}

/**
 * @param {object} request
 * @param {object} [options]
 */
export async function queryPointIntelligenceBundleBroker(request, options = {}) {
  const brokerBase = String(
    options.brokerUrl
    || process.env.POINT_INTELLIGENCE_BROKER_URL
    || 'http://127.0.0.1:3015'
  ).replace(/\/$/, '');

  const timeoutMs = Number(options.timeoutMs || process.env.POINT_INTELLIGENCE_TIMEOUT_MS || 60000);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${brokerBase}/v1/point-intelligence/query-bundle`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(request),
      signal: controller.signal
    });
    const body = await response.json().catch(() => ({}));
    return {
      ok: response.ok,
      status: response.status,
      body
    };
  } catch (error) {
    if (error?.name === 'AbortError') {
      return {
        ok: false,
        status: 504,
        body: {
          bundleState: 'PARTIAL_FAILURE',
          error: 'Point Intelligence bundle request timed out'
        }
      };
    }
    return {
      ok: false,
      status: 503,
      body: {
        bundleState: 'PARTIAL_FAILURE',
        error: error?.message || 'Point Intelligence broker unavailable'
      }
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * @param {object} request
 * @param {object} [options]
 */
export async function queryPointIntelligenceBroker(request, options = {}) {
  const brokerBase = String(
    options.brokerUrl
    || process.env.POINT_INTELLIGENCE_BROKER_URL
    || 'http://127.0.0.1:3015'
  ).replace(/\/$/, '');

  const timeoutMs = Number(options.timeoutMs || process.env.POINT_INTELLIGENCE_TIMEOUT_MS || 30000);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${brokerBase}/v1/point-intelligence/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(request),
      signal: controller.signal
    });
    const body = await response.json().catch(() => ({}));
    return {
      ok: response.ok,
      status: response.status,
      body
    };
  } catch (error) {
    if (error?.name === 'AbortError') {
      return {
        ok: false,
        status: 504,
        body: {
          queryState: 'QUERY_TIMEOUT',
          error: 'Point Intelligence broker request timed out'
        }
      };
    }
    return {
      ok: false,
      status: 503,
      body: {
        queryState: 'PROVIDER_UNAVAILABLE',
        error: error?.message || 'Point Intelligence broker unavailable'
      }
    };
  } finally {
    clearTimeout(timer);
  }
}
