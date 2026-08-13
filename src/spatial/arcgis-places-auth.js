/**
 * Server-side ArcGIS Places authentication.
 * Never logs token, password, or API key values.
 */

const TOKEN_TTL_MS = 50 * 60 * 1000;
const GENERATE_TOKEN_MINUTES = 60;

let cachedToken = null;
let cachedExpiresAt = 0;

export function isArcGisPlacesEnabled() {
  const flag = process.env.IQAI_ARCGIS_PLACES_ENABLED;
  if (flag != null && flag !== '' && !/^true$/i.test(flag)) return false;
  return true;
}

function classifyTokenError(status, errorCode) {
  if (status === 429 || errorCode === 429) return 'RATE_LIMITED';
  if (status === 401 || status === 403 || errorCode === 498 || errorCode === 499) {
    return 'AUTH_REQUIRED';
  }
  return 'AUTH_REQUIRED';
}

/**
 * @param {object} [options]
 * @returns {Promise<{ ok: boolean, token?: string, source?: string, status?: string, message?: string }>}
 */
export async function getPlacesAccessToken(options = {}) {
  if (!isArcGisPlacesEnabled()) {
    return { ok: false, status: 'PROVIDER_UNAVAILABLE', message: 'ArcGIS Places is disabled.' };
  }

  const fetchFn = options.fetchFn || globalThis.fetch;
  const apiKey = String(process.env.ARCGIS_API_KEY || '').trim();
  if (apiKey) {
    return { ok: true, token: apiKey, source: 'API_KEY' };
  }

  if (cachedToken && Date.now() < cachedExpiresAt) {
    return { ok: true, token: cachedToken, source: 'CACHE' };
  }

  const existing = String(process.env.ARCGIS_TOKEN || '').trim();
  const username = String(process.env.ARCGIS_USERNAME || '').trim();
  const password = String(process.env.ARCGIS_PASSWORD || '').trim();
  if (!username || !password) {
    if (existing) return { ok: true, token: existing, source: 'ARCGIS_TOKEN' };
    return {
      ok: false,
      status: 'AUTH_REQUIRED',
      message: 'ArcGIS Places requires an API key or portal credentials.'
    };
  }

  const portal = String(process.env.ARCGIS_PORTAL_URL || 'https://www.arcgis.com').replace(/\/$/, '');
  const body = new URLSearchParams({
    f: 'json',
    username,
    password,
    client: 'referer',
    referer: 'http://localhost:3000/spatial/',
    expiration: String(GENERATE_TOKEN_MINUTES)
  });

  try {
    const response = await fetchFn(`${portal}/sharing/rest/generateToken`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      signal: AbortSignal.timeout(15000)
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data?.token) {
      const errorCode = data?.error?.code;
      return {
        ok: false,
        status: classifyTokenError(response.status, errorCode),
        message: 'ArcGIS Places token generation failed.'
      };
    }
    cachedToken = data.token;
    cachedExpiresAt = Date.now() + TOKEN_TTL_MS;
    return { ok: true, token: cachedToken, source: 'GENERATE_TOKEN' };
  } catch {
    return {
      ok: false,
      status: 'PROVIDER_UNAVAILABLE',
      message: 'ArcGIS Places token request failed.'
    };
  }
}

export function clearPlacesTokenCache() {
  cachedToken = null;
  cachedExpiresAt = 0;
}
