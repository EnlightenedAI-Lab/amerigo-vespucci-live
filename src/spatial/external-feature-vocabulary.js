import {
  APPROVED_EXTERNAL_SOURCES,
  getApprovedExternalSource
} from './approved-external-source-registry.js';

export const VOCABULARY_CACHE_TTL_MS = 60 * 60 * 1000;
export const VOCABULARY_QUERY_TIMEOUT_MS = 30_000;

/** @type {Map<string, { at: number, values: string[] }>} */
const vocabularyCache = new Map();

export function clearVocabularyCache() {
  vocabularyCache.clear();
}

/**
 * @param {string} sourceId
 * @param {string} semanticField
 */
export function getCachedVocabulary(sourceId, semanticField) {
  const entry = vocabularyCache.get(`${sourceId}:${semanticField}`);
  if (!entry) return null;
  return [...entry.values];
}

/**
 * Sources approved for dynamic vocabulary discovery.
 */
export function listVocabularyEnabledSources() {
  return APPROVED_EXTERNAL_SOURCES.filter((source) => {
    const caps = source.capabilities || {};
    return Boolean(
      caps.DISTINCT_VALUES
      || caps.distinctValues
      || source.semanticField
    );
  });
}

function layerQueryUrl(source) {
  const base = String(source.serviceUrl || '').replace(/\/$/, '');
  return `${base}/${source.layerId}/query`;
}

function semanticFieldForSource(source) {
  return source.semanticField || source.categoryField || null;
}

/**
 * @param {object} source
 * @param {typeof fetch} fetchFn
 * @param {{ forceRefresh?: boolean, ttlMs?: number }} [options]
 */
export async function fetchDistinctValues(source, fetchFn, options = {}) {
  const semanticField = semanticFieldForSource(source);
  if (!semanticField) {
    return { ok: false, message: 'Source has no semantic field configured' };
  }

  const cacheKey = `${source.id}:${semanticField}`;
  const ttlMs = options.ttlMs ?? VOCABULARY_CACHE_TTL_MS;
  const forceRefresh = options.forceRefresh ?? false;

  if (!forceRefresh) {
    const cached = vocabularyCache.get(cacheKey);
    if (cached && Date.now() - cached.at < ttlMs) {
      return { ok: true, values: [...cached.values], fromCache: true, semanticField };
    }
  }

  const params = new URLSearchParams({
    where: '1=1',
    outFields: semanticField,
    returnGeometry: 'false',
    returnDistinctValues: 'true',
    orderByFields: semanticField,
    f: 'json'
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), VOCABULARY_QUERY_TIMEOUT_MS);
  try {
    const response = await fetchFn(`${layerQueryUrl(source)}?${params.toString()}`, {
      signal: controller.signal
    });
    if (!response.ok) {
      return { ok: false, message: `Distinct values query failed: HTTP ${response.status}` };
    }
    const data = await response.json();
    if (data?.error) {
      return { ok: false, message: data.error.message || 'ArcGIS distinct-values error' };
    }

    const values = (data.features || [])
      .map((feature) => feature?.attributes?.[semanticField])
      .filter((value) => value != null && String(value).trim() !== '')
      .map((value) => String(value).trim());

    const unique = [...new Set(values)].sort((a, b) => a.localeCompare(b));
    vocabularyCache.set(cacheKey, { at: Date.now(), values: unique });

    return { ok: true, values: unique, fromCache: false, semanticField };
  } catch (err) {
    return { ok: false, message: err?.message || 'Distinct values request failed' };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Preload vocabulary for all approved sources (for sync planning).
 * @param {{ fetchFn?: typeof fetch, forceRefresh?: boolean, ttlMs?: number }} [deps]
 */
export async function loadVocabularyContextForPlanning(deps = {}) {
  const fetchFn = deps.fetchFn || globalThis.fetch;
  const contexts = [];
  for (const source of listVocabularyEnabledSources()) {
    const vocab = await fetchDistinctValues(source, fetchFn, {
      forceRefresh: deps.forceRefresh,
      ttlMs: deps.ttlMs
    });
    if (vocab.ok) {
      contexts.push({
        source,
        semanticField: vocab.semanticField,
        values: vocab.values,
        fromCache: vocab.fromCache
      });
    }
  }
  return contexts;
}

/**
 * @param {string} sourceId
 * @param {typeof fetch} [fetchFn]
 */
export async function fetchDistinctValuesForSourceId(sourceId, fetchFn = globalThis.fetch) {
  const source = getApprovedExternalSource(sourceId);
  if (!source) return { ok: false, message: 'Approved external source not registered' };
  return fetchDistinctValues(source, fetchFn);
}
