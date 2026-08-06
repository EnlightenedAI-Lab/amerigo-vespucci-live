const SENSITIVE_KEYS = new Set([
  'token', 'password', 'apikey', 'api_key', 'x-api-key',
  'arcgis_token', 'arcgis_admin_token', 'arcgis_username', 'arcgis_password',
  'aisstream_api_key', 'datadocked_api_key', 'open_meteo_api_key'
]);

const SENSITIVE_PATTERNS = [
  /token/i, /password/i, /api[_-]?key/i, /secret/i, /credential/i
];

/**
 * Strip sensitive fields from an object before sending to the browser.
 * @param {unknown} value
 * @returns {unknown}
 */
export function stripSensitiveFields(value) {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map(stripSensitiveFields);
  if (typeof value !== 'object') return value;
  const result = {};
  for (const [key, val] of Object.entries(value)) {
    const lower = key.toLowerCase();
    if (SENSITIVE_KEYS.has(lower) || SENSITIVE_PATTERNS.some((p) => p.test(key))) continue;
    result[key] = stripSensitiveFields(val);
  }
  return result;
}

/**
 * Convert an upstream error into a safe client-facing message.
 * @param {Error|unknown} error
 * @returns {{ error: string }}
 */
export function sanitizeError(error) {
  const message = error instanceof Error ? error.message : String(error);
  if (/token|password|api[_-]?key|credential|secret/i.test(message)) {
    return { error: 'An upstream data request failed.' };
  }
  if (message.length > 200) {
    return { error: 'An upstream data request failed.' };
  }
  return { error: message };
}

/** Express middleware adding basic HTTP security headers. */
export function securityHeaders(_req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-XSS-Protection', '0');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  next();
}
