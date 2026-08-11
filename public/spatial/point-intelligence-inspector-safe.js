/**
 * Safe provenance boundary — structural allowlist + secret redaction.
 */

const FORBIDDEN_KEY_PATTERN = /^(authorization|api[_-]?key|password|secret|token|cookie|bearer|connection[_-]?string|database[_-]?url|access[_-]?token|session|credentials?)$/i;
const FORBIDDEN_PATH_SEGMENTS = new Set([
  'headers', 'authorization', 'cookies', 'credentials', 'apiKey', 'api_key',
  'password', 'secret', 'token', 'accessToken', 'connectionString', 'databaseUrl'
]);

const EVIDENCE_ALLOWLIST = new Set([
  'resultId', 'queryRequestId', 'queryReceiptId', 'capabilityId', 'discoveryCandidateId',
  'candidateKey', 'providerName', 'protocolFamily', 'nativeCollectionId', 'nativeRecordId',
  'category', 'resultKind', 'temporalClassification', 'geometry', 'spatialPrecision',
  'clickDistanceMeters', 'temporal', 'observation', 'properties', 'retrievedAt',
  'provenance', 'schemaVersion'
]);

const RECEIPT_TOP_ALLOWLIST = new Set([
  'queryReceiptId', 'queryRequestId', 'informationFamily', 'queryState', 'resultCount',
  'providerName', 'capabilityId', 'nativeId', 'nativeCollectionId', 'temporalClassification',
  'temporalIntent', 'selectionMode', 'queryAnchor', 'radiusMeters', 'executionStatus',
  'resultStatus', 'timing', 'spatialAccounting', 'sourceTrace', 'bundleId',
  'orchestrationId', 'error', 'retrievalEnvelope'
]);

const PROVENANCE_ALLOWLIST = new Set([
  'queryReceiptId', 'spatialOperation', 'bbox', 'source', 'selectionSemantics'
]);

const PROPERTY_DENYLIST = new Set([
  'authorization', 'api_key', 'apiKey', 'password', 'secret', 'token', 'cookie'
]);

/**
 * @param {string} key
 */
export function isForbiddenKey(key) {
  return FORBIDDEN_KEY_PATTERN.test(String(key || ''));
}

/**
 * @param {unknown} value
 * @param {Set<string>} [allowlist]
 * @param {number} [depth]
 */
export function sanitizeForInspector(value, allowlist = null, depth = 0) {
  if (value == null) return null;
  if (depth > 6) return '[truncated]';
  if (typeof value === 'string') {
    if (/bearer\s+/i.test(value)) return '[redacted]';
    if (/api[_-]?key=/i.test(value)) return '[redacted]';
    return value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeForInspector(entry, allowlist, depth + 1));
  }
  if (typeof value !== 'object') return String(value);

  /** @type {Record<string, unknown>} */
  const out = {};
  for (const [key, entry] of Object.entries(value)) {
    if (isForbiddenKey(key) || FORBIDDEN_PATH_SEGMENTS.has(key)) continue;
    if (allowlist && !allowlist.has(key)) continue;
    if (PROPERTY_DENYLIST.has(key)) continue;
    out[key] = sanitizeForInspector(entry, null, depth + 1);
  }
  return out;
}

/**
 * @param {object} result
 */
export function sanitizeEvidenceRecord(result) {
  if (!result || typeof result !== 'object') return null;
  const base = sanitizeForInspector(result, EVIDENCE_ALLOWLIST);
  if (base?.provenance) {
    base.provenance = sanitizeForInspector(base.provenance, PROVENANCE_ALLOWLIST);
  }
  if (base?.properties && typeof base.properties === 'object') {
    const props = {};
    for (const [key, val] of Object.entries(base.properties)) {
      if (isForbiddenKey(key) || PROPERTY_DENYLIST.has(key)) continue;
      if (val == null || val === '') continue;
      props[key] = val;
    }
    base.properties = props;
  }
  return base;
}

/**
 * @param {object} receiptModel
 */
export function sanitizeReceiptModel(receiptModel) {
  if (!receiptModel || typeof receiptModel !== 'object') return null;
  return sanitizeForInspector(receiptModel, RECEIPT_TOP_ALLOWLIST);
}

/**
 * @param {unknown} value
 */
export function toSafeRawJson(value) {
  return JSON.stringify(sanitizeForInspector(value, null), null, 2);
}

/**
 * @param {object} fixture
 */
export function assertNoSecretsExposed(fixture) {
  const text = JSON.stringify(fixture);
  const forbidden = [
    /bearer\s+[a-z0-9._-]+/i,
    /api[_-]?key["']?\s*:\s*["'][^"']+["']/i,
    /password["']?\s*:\s*["'][^"']+["']/i,
    /secret["']?\s*:\s*["'][^"']+["']/i,
    /token["']?\s*:\s*["'][^"']+["']/i
  ];
  return !forbidden.some((pattern) => pattern.test(text));
}
