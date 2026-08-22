/**
 * Camera Wall provider HTTP seam.
 * Mapillary token stays on the server except the MapillaryJS viewer config.
 * Responses never include Road511. Secrets are not logged.
 */
import {
  MAPILLARY_WALL_RADIUS_M,
  buildMapillaryNearbyRequest,
  selectNearestMapillary
} from '../../public/spatial-v2/camera/provider/mapillary-provider.js';
import { PROVIDER_CREDENTIAL_REQUIRED } from '../../public/spatial-v2/camera/provider/provider-representation.js';
import {
  cameraProviderCredentialStatus,
  getMapillaryAccessToken
} from './camera-provider-env.js';

const FETCH_MS = 12000;

async function fetchJson(url, headers, timeoutMs = FETCH_MS) {
  const response = await fetch(url, {
    headers,
    signal: AbortSignal.timeout(timeoutMs)
  });
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { parseError: true, length: text.length };
  }
  return { ok: response.ok, status: response.status, body };
}

function resolveCameraCoordinate(query = {}) {
  const longitude = Number(query.lng ?? query.longitude);
  const latitude = Number(query.lat ?? query.latitude);
  if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) return null;
  return { longitude, latitude };
}

async function queryMapillaryNearby(cameraCoordinate, radiusM) {
  const token = getMapillaryAccessToken();
  const request = buildMapillaryNearbyRequest({
    latitude: cameraCoordinate.latitude,
    longitude: cameraCoordinate.longitude,
    radiusM
  });
  if (!token) {
    return {
      provider: 'MAPILLARY',
      status: PROVIDER_CREDENTIAL_REQUIRED.MAPILLARY,
      credentialPresent: false,
      cameraCoordinate,
      searchRadiusM: request.bbox.radiusM,
      selected: null,
      count: 0
    };
  }
  const url = new URL(request.url);
  url.searchParams.set('access_token', token);
  const result = await fetchJson(url.toString(), { Authorization: `OAuth ${token}` });
  if (!result.ok) {
    return {
      provider: 'MAPILLARY',
      status: `MAPILLARY_HTTP_${result.status}`,
      credentialPresent: true,
      cameraCoordinate,
      searchRadiusM: request.bbox.radiusM,
      selected: null,
      count: 0,
      httpStatus: result.status
    };
  }
  const images = Array.isArray(result.body?.data) ? result.body.data : [];
  const picked = selectNearestMapillary(images, cameraCoordinate);
  return {
    provider: 'MAPILLARY',
    status: 'OK',
    credentialPresent: true,
    cameraCoordinate,
    searchRadiusM: request.bbox.radiusM,
    selected: picked.selected,
    ranked: picked.ranked,
    count: images.length,
    retrievedAt: new Date().toISOString()
  };
}

export async function queryMapillaryForCamera(cameraCoordinate) {
  let last = null;
  for (const radiusM of MAPILLARY_WALL_RADIUS_M) {
    last = await queryMapillaryNearby(cameraCoordinate, radiusM);
    if (last.status !== 'OK') return last;
    if (last.count > 0) return last;
  }
  return last;
}

export function registerCameraProviderRoutes(app) {
  app.get('/spatial-v2/api/camera-providers/status', (_req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json({
      ok: true,
      credentials: cameraProviderCredentialStatus(),
      maxHeavyViewers: 1
    });
  });

  app.get('/spatial-v2/api/camera-providers/mapillary-viewer-config', (_req, res) => {
    res.set('Cache-Control', 'no-store');
    const token = getMapillaryAccessToken();
    res.json({
      configured: Boolean(token),
      accessToken: token || null,
      viewer: 'MAPILLARY_JS'
    });
  });

  app.get('/spatial-v2/api/camera-providers/mapillary', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    const cameraCoordinate = resolveCameraCoordinate(req.query);
    if (!cameraCoordinate) {
      res.status(400).json({
        provider: 'MAPILLARY',
        status: 'CAMERA_COORDINATE_REQUIRED',
        selected: null
      });
      return;
    }
    const radiusM = Number(req.query.radiusM ?? req.query.radius);
    try {
      const pack = Number.isFinite(radiusM) && radiusM > 0
        ? await queryMapillaryNearby(cameraCoordinate, Math.min(radiusM, 400))
        : await queryMapillaryForCamera(cameraCoordinate);
      res.json(pack);
    } catch (error) {
      res.status(502).json({
        provider: 'MAPILLARY',
        status: 'MAPILLARY_FETCH_FAILED',
        error: String(error?.message || error),
        selected: null
      });
    }
  });
}
