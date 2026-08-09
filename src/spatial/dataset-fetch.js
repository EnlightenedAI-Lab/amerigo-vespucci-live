import { extractZipEntry } from './zip-utils.js';
import { parseCsv } from './csv-utils.js';
import { CACHE_TTL_MS, FETCH_TIMEOUT_MS } from './dataset-registry.js';

/** @type {Map<string, { at: number, data: unknown }>} */
const cache = new Map();

export function clearDatasetCache(datasetId = null) {
  if (!datasetId) {
    cache.clear();
    return;
  }
  for (const key of cache.keys()) {
    if (key.startsWith(`${datasetId}:`)) cache.delete(key);
  }
}

/**
 * @param {object} dataset
 * @param {{ fetchFn?: typeof fetch, forceRefresh?: boolean }} [options]
 */
export async function fetchDatasetRecords(dataset, options = {}) {
  const fetchFn = options.fetchFn || fetch;
  const cacheKey = `${dataset.id}:${dataset.dataUrl}`;
  const now = Date.now();
  const cached = cache.get(cacheKey);
  if (!options.forceRefresh && cached && now - cached.at < CACHE_TTL_MS) {
    return { records: cached.data, cached: true };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  let response;
  try {
    response = await fetchFn(dataset.dataUrl, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
  if (!response.ok) {
    throw new Error(`${dataset.displayName} source fetch failed (${response.status})`);
  }

  let records;
  if (dataset.dataFormat === 'geojson') {
    const geojson = await response.json();
    records = geojson?.features || [];
  } else if (dataset.dataFormat === 'csv') {
    const buffer = Buffer.from(await response.arrayBuffer());
    const contentType = response.headers?.get?.('content-type') || '';
    const text = decodeCsvBuffer(buffer, contentType);
    records = parseCsv(text).rows;
  } else if (dataset.dataFormat === 'gtfs_zip') {
    const buffer = Buffer.from(await response.arrayBuffer());
    const entry = extractZipEntry(buffer, dataset.zipEntry || 'stops.txt');
    if (!entry) {
      throw new Error(`${dataset.displayName} GTFS entry missing: ${dataset.zipEntry}`);
    }
    records = parseCsv(entry.toString('utf8')).rows;
  } else {
    throw new Error(`Unsupported data format: ${dataset.dataFormat}`);
  }

  cache.set(cacheKey, { at: now, data: records });
  return { records, cached: false };
}

/**
 * Decode CSV bytes with UTF-8 first; fall back to Latin-1 when replacement chars appear.
 * @param {Buffer} buffer
 * @param {string} [contentType]
 */
function decodeCsvBuffer(buffer, contentType = '') {
  const ct = String(contentType).toLowerCase();
  if (ct.includes('charset=windows-1252') || ct.includes('charset=cp1252') || ct.includes('charset=iso-8859-1') || ct.includes('charset=latin1')) {
    return buffer.toString('latin1');
  }
  const utf8 = buffer.toString('utf8');
  if (utf8.includes('\uFFFD')) {
    const latin1 = buffer.toString('latin1');
    if (!latin1.includes('\uFFFD')) return latin1;
  }
  return utf8;
}
