/**
 * Browser-side governed open-world intelligence request builder.
 */
import { OPEN_WORLD_SEARCH_PATH } from './open-world-intelligence-config.js';
import { buildAgent2SearchQueryPlan } from './open-world-intelligence-temporal-mapping.js';

const FORBIDDEN_KEYS = new Set([
  'url', 'endpoint', 'providerUrl', 'sourceUrl', 'connectorUrl', 'feedUrl',
  'sourceId', 'capabilityId', 'verified', 'sql', 'where', 'fetch'
]);

const ALLOWED_KEYS = new Set([
  'keyword', 'geometry', 'radiusMeters', 'temporal', 'interpretation', 'province'
]);

/**
 * @param {unknown} input
 */
export function buildOpenWorldIntelligenceRequest(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, error: 'Request must be an object' };
  }
  for (const key of Object.keys(input)) {
    if (FORBIDDEN_KEYS.has(key)) return { ok: false, error: `Forbidden field: ${key}` };
    if (!ALLOWED_KEYS.has(key)) return { ok: false, error: `Unsupported field: ${key}` };
  }

  const plan = buildAgent2SearchQueryPlan({
    keyword: input.keyword,
    temporal: input.temporal,
    interpretation: input.interpretation,
    spatial: {
      geometry: input.geometry,
      radiusMeters: input.radiusMeters,
      province: input.province
    }
  });
  if (!plan.ok) return plan;

  const lon = Number(input.geometry?.coordinates?.[0]);
  const lat = Number(input.geometry?.coordinates?.[1]);
  const payload = {
    keyword: input.keyword || null,
    interpretation: input.interpretation,
    temporal: input.temporal,
    plan: plan.plan
  };
  if (Number.isFinite(lon) && Number.isFinite(lat)) {
    payload.geometry = { type: 'Point', coordinates: [lon, lat] };
  }
  if (input.radiusMeters != null) payload.radiusMeters = Number(input.radiusMeters);
  if (input.province) payload.province = input.province;

  return { ok: true, payload };
}

/**
 * @param {object} payload
 * @param {object} [options]
 */
export async function queryOpenWorldIntelligence(payload, options = {}) {
  const built = buildOpenWorldIntelligenceRequest(payload);
  if (!built.ok) {
    return { searchState: 'INVALID_REQUEST', error: built.message || built.error, results: [] };
  }
  const fetchImpl = options.fetchImpl || fetch;
  const response = await fetchImpl(OPEN_WORLD_SEARCH_PATH, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(built.payload),
    signal: options.signal
  });
  const body = await response.json().catch(() => ({}));
  return body;
}
