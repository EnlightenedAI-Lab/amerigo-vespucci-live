import { sanitizeError } from '../security.js';
import {
  PROVIDER_READINESS_STATE,
  isoDateOnly
} from '../../public/spatial-v2/imagery/imagery-contract.js';
import { nearmapWmsStatus, proxyNearmapWms } from './nearmap-wms.js';

const WAYBACK_CONFIG_URL = 'https://s3-us-west-2.amazonaws.com/config.maptiles.arcgis.com/waybackconfig.json';
const WAYBACK_METADATA_HOST = 'https://metadata.maptiles.arcgis.com/';
const NEARMAP_COVERAGE_BASE = 'https://api.nearmap.com/coverage/v2';
const NEARMAP_TILE_BASE = 'https://api.nearmap.com/tiles/v3/surveys';
const GOOGLE_MAP_TILES_SESSION_URL = 'https://tile.googleapis.com/v1/createSession';
const MONTREAL_READINESS_POINT = Object.freeze({
  longitude: -73.5673,
  latitude: 45.5017
});

function envKey(env) {
  return String(env?.NEARMAP_API_KEY || '').trim();
}

function googleMapTilesKey(env) {
  return String(env?.GOOGLE_MAP_TILES_API_KEY || '').trim();
}

function json(res, status, body) {
  res.set('Cache-Control', 'no-store');
  return res.status(status).json(body);
}

function mercatorToLonLat(x, y) {
  const lon = (Number(x) / 20037508.34) * 180;
  let lat = (Number(y) / 20037508.34) * 180;
  lat = (180 / Math.PI) * (2 * Math.atan(Math.exp((lat * Math.PI) / 180)) - Math.PI / 2);
  return { lon, lat };
}

function extentToWgs84(query) {
  const wkid = Number(query.wkid || 4326);
  const xmin = Number(query.xmin);
  const ymin = Number(query.ymin);
  const xmax = Number(query.xmax);
  const ymax = Number(query.ymax);
  if (![xmin, ymin, xmax, ymax].every(Number.isFinite)) return null;
  if (wkid === 4326 || wkid === 4326.0) {
    return { xmin, ymin, xmax, ymax };
  }
  const sw = mercatorToLonLat(xmin, ymin);
  const ne = mercatorToLonLat(xmax, ymax);
  return { xmin: sw.lon, ymin: sw.lat, xmax: ne.lon, ymax: ne.lat };
}

function polygonWkt(extent) {
  const { xmin, ymin, xmax, ymax } = extent;
  return `POLYGON((${xmin} ${ymin}, ${xmax} ${ymin}, ${xmax} ${ymax}, ${xmin} ${ymax}, ${xmin} ${ymin}))`;
}

function mapNearmapSurvey(survey) {
  return {
    id: survey?.id || null,
    captureDate: isoDateOnly(survey?.captureDate),
    acquisitionDate: isoDateOnly(survey?.captureDate),
    firstPublicDate: isoDateOnly(survey?.onlineTime),
    pixelSize: survey?.pixelSize ?? null,
    firstPhotoTime: survey?.firstPhotoTime || null,
    lastPhotoTime: survey?.lastPhotoTime || null
  };
}

async function googleMapTilesStatus(env, fetchImpl) {
  const key = googleMapTilesKey(env);
  if (!key) {
    return {
      ok: false,
      providerId: 'google-map-tiles',
      readinessState: PROVIDER_READINESS_STATE.NOT_CONFIGURED,
      entitlement: 'entitlement-missing',
      configured: false,
      credentialUsable: false,
      runtimeIntegrated: false,
      limitation: 'GOOGLE_MAP_TILES_API_KEY is not configured on the server. The Street View browser key is not an authorized substitute.'
    };
  }
  try {
    const response = await fetchImpl(
      `${GOOGLE_MAP_TILES_SESSION_URL}?key=${encodeURIComponent(key)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mapType: 'satellite',
          language: 'en-US',
          region: 'CA'
        }),
        cache: 'no-store'
      }
    );
    if (response.status === 401 || response.status === 403) {
      return {
        ok: false,
        providerId: 'google-map-tiles',
        readinessState: PROVIDER_READINESS_STATE.ENTITLEMENT_REQUIRED,
        entitlement: 'denied',
        configured: true,
        credentialUsable: false,
        runtimeIntegrated: false,
        limitation: 'Google Map Tiles API denied the configured server credential or project entitlement.'
      };
    }
    if (!response.ok) {
      return {
        ok: false,
        providerId: 'google-map-tiles',
        readinessState: PROVIDER_READINESS_STATE.UNAVAILABLE,
        entitlement: 'failed',
        configured: true,
        credentialUsable: false,
        runtimeIntegrated: false,
        limitation: `Google Map Tiles createSession HTTP ${response.status}.`
      };
    }
    const payload = await response.json().catch(() => ({}));
    const credentialUsable = Boolean(payload.session);
    return {
      ok: false,
      providerId: 'google-map-tiles',
      readinessState: PROVIDER_READINESS_STATE.UNAVAILABLE,
      entitlement: credentialUsable ? 'ready' : 'failed',
      configured: true,
      credentialUsable,
      runtimeIntegrated: false,
      limitation: credentialUsable
        ? 'Official Google credentials were accepted, but the ArcGIS tile proxy and dynamic viewport attribution runtime are not implemented. Ground activation remains disabled.'
        : 'Google Map Tiles createSession returned no session token.'
    };
  } catch (error) {
    return {
      ok: false,
      providerId: 'google-map-tiles',
      readinessState: PROVIDER_READINESS_STATE.UNAVAILABLE,
      entitlement: 'failed',
      configured: true,
      credentialUsable: false,
      runtimeIntegrated: false,
      limitation: sanitizeError(error).error
    };
  }
}

function pickMetadataLayerId(layers, scale) {
  const list = Array.isArray(layers) ? layers : [];
  if (!list.length) return 0;
  const numericScale = Number(scale);
  if (!Number.isFinite(numericScale)) return list[list.length - 1]?.id ?? 0;
  const match = list.find((layer) => {
    const minScale = Number(layer.minScale) || 0;
    const maxScale = Number(layer.maxScale) || 0;
    const withinMin = minScale === 0 || numericScale <= minScale;
    const withinMax = maxScale === 0 || numericScale > maxScale;
    return withinMin && withinMax;
  });
  return match?.id ?? list[list.length - 1]?.id ?? 0;
}

export function registerImageryV2Routes(app, options = {}) {
  const env = options.env || process.env;
  const fetchImpl = options.fetchImpl || fetch;

  app.get('/api/spatial-v2/imagery/wayback/config', async (_req, res) => {
    try {
      const response = await fetchImpl(WAYBACK_CONFIG_URL, { cache: 'no-store' });
      if (!response.ok) {
        return json(res, 502, { ok: false, error: `Wayback config HTTP ${response.status}` });
      }
      const payload = await response.json();
      return json(res, 200, payload);
    } catch (error) {
      return json(res, 502, { ok: false, error: sanitizeError(error).error });
    }
  });

  app.get('/api/spatial-v2/imagery/wayback/metadata', async (req, res) => {
    try {
      const metadataLayerUrl = String(req.query.metadataLayerUrl || '');
      if (!metadataLayerUrl.startsWith(WAYBACK_METADATA_HOST)) {
        return json(res, 400, { ok: false, error: 'metadataLayerUrl is not an allowed Wayback metadata host.' });
      }
      const longitude = Number(req.query.longitude);
      const latitude = Number(req.query.latitude);
      const scale = Number(req.query.scale);
      if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) {
        return json(res, 400, { ok: false, error: 'longitude and latitude are required.' });
      }
      const serviceUrl = metadataLayerUrl.replace(/\/+$/, '');
      const serviceInfo = await fetchImpl(`${serviceUrl}?f=json`, { cache: 'no-store' });
      if (!serviceInfo.ok) {
        return json(res, 502, { ok: false, attributes: null, error: `Metadata service HTTP ${serviceInfo.status}` });
      }
      const info = await serviceInfo.json();
      const layerId = pickMetadataLayerId(info.layers, scale);
      const query = new URLSearchParams({
        f: 'json',
        geometry: `${longitude},${latitude}`,
        geometryType: 'esriGeometryPoint',
        inSR: '4326',
        spatialRel: 'esriSpatialRelIntersects',
        outFields: 'SRC_DATE,SRC_DATE2,SRC_RES,NICE_NAME,SRC_DESC',
        returnGeometry: 'false',
        resultRecordCount: '1'
      });
      const queryRes = await fetchImpl(`${serviceUrl}/${layerId}/query?${query}`, { cache: 'no-store' });
      if (!queryRes.ok) {
        return json(res, 502, { ok: false, attributes: null, error: `Metadata query HTTP ${queryRes.status}` });
      }
      const payload = await queryRes.json();
      const attributes = payload.features?.[0]?.attributes || null;
      return json(res, 200, { ok: true, attributes, layerId });
    } catch (error) {
      return json(res, 502, { ok: false, attributes: null, error: sanitizeError(error).error });
    }
  });

  app.get('/api/spatial-v2/imagery/google/status', async (_req, res) => {
    const status = await googleMapTilesStatus(env, fetchImpl);
    return json(res, 200, status);
  });

  app.get('/api/spatial-v2/imagery/nearmap/wms/status', (req, res) => {
    return nearmapWmsStatus(req, res, { env, fetchImpl });
  });
  app.get('/api/spatial-v2/imagery/nearmap/wms', (req, res) => {
    return proxyNearmapWms(req, res, { env, fetchImpl });
  });

  app.get('/api/spatial-v2/imagery/nearmap/coverage', async (req, res) => {
    const key = envKey(env);
    if (!key) {
      return json(res, 200, {
        ok: false,
        entitlement: 'entitlement-missing',
        readinessState: PROVIDER_READINESS_STATE.NOT_CONFIGURED,
        surveys: [],
        limitation: 'NEARMAP_API_KEY is not configured on the server.'
      });
    }
    try {
      const probe = String(req.query.probe || '') === '1';
      const aoi = probe ? 'point' : String(req.query.aoi || 'point');
      let url;
      if (aoi === 'viewport') {
        const extent = extentToWgs84(req.query);
        if (!extent) {
          return json(res, 400, {
            ok: false,
            entitlement: 'failed',
            readinessState: PROVIDER_READINESS_STATE.UNAVAILABLE,
            surveys: [],
            error: 'Viewport extent is invalid.'
          });
        }
        url = `${NEARMAP_COVERAGE_BASE}/poly/${encodeURIComponent(polygonWkt(extent))}?limit=100`;
      } else {
        const longitude = probe
          ? MONTREAL_READINESS_POINT.longitude
          : Number(req.query.longitude);
        const latitude = probe
          ? MONTREAL_READINESS_POINT.latitude
          : Number(req.query.latitude);
        if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) {
          return json(res, 400, {
            ok: false,
            entitlement: 'failed',
            readinessState: PROVIDER_READINESS_STATE.UNAVAILABLE,
            surveys: [],
            error: 'Point longitude and latitude are required.'
          });
        }
        url = `${NEARMAP_COVERAGE_BASE}/point/${longitude},${latitude}?limit=100`;
      }
      const response = await fetchImpl(url, {
        headers: { Authorization: `Apikey ${key}` }
      });
      if (response.status === 401 || response.status === 403) {
        return json(res, 403, {
          ok: false,
          entitlement: 'denied',
          readinessState: PROVIDER_READINESS_STATE.ENTITLEMENT_REQUIRED,
          surveys: [],
          limitation: 'Nearmap denied this credential.'
        });
      }
      if (!response.ok) {
        return json(res, 502, {
          ok: false,
          entitlement: 'failed',
          readinessState: PROVIDER_READINESS_STATE.UNAVAILABLE,
          surveys: [],
          error: `Nearmap coverage HTTP ${response.status}`
        });
      }
      const payload = await response.json();
      const surveys = Array.isArray(payload.surveys) ? payload.surveys.map(mapNearmapSurvey) : [];
      return json(res, 200, {
        ok: true,
        entitlement: 'ready',
        readinessState: surveys.length
          ? PROVIDER_READINESS_STATE.READY
          : PROVIDER_READINESS_STATE.NO_COVERAGE,
        surveys,
        total: payload.total ?? surveys.length
      });
    } catch (error) {
      return json(res, 502, {
        ok: false,
        entitlement: 'failed',
        readinessState: PROVIDER_READINESS_STATE.UNAVAILABLE,
        surveys: [],
        error: sanitizeError(error).error
      });
    }
  });

  app.get('/api/spatial-v2/imagery/nearmap/tiles/:surveyId/:level/:col/:row.jpg', async (req, res) => {
    const key = envKey(env);
    if (!key) {
      return json(res, 403, { ok: false, entitlement: 'entitlement-missing' });
    }
    const surveyId = String(req.params.surveyId || '');
    const level = Number(req.params.level);
    const col = Number(req.params.col);
    const row = Number(req.params.row);
    if (!/^[A-Za-z0-9_-]+$/.test(surveyId) || ![level, col, row].every(Number.isInteger)) {
      return json(res, 400, { ok: false, error: 'Invalid Nearmap tile coordinates.' });
    }
    try {
      const url = `${NEARMAP_TILE_BASE}/${encodeURIComponent(surveyId)}/Vert/${level}/${col}/${row}.jpg`;
      const response = await fetchImpl(url, {
        headers: { Authorization: `Apikey ${key}` }
      });
      if (response.status === 401 || response.status === 403) {
        return json(res, 403, { ok: false, entitlement: 'denied' });
      }
      if (!response.ok) {
        return json(res, response.status === 404 ? 404 : 502, { ok: false, error: `Nearmap tile HTTP ${response.status}` });
      }
      const buffer = Buffer.from(await response.arrayBuffer());
      res.set('Cache-Control', 'private, max-age=300');
      res.type(response.headers.get('content-type') || 'image/jpeg');
      return res.send(buffer);
    } catch (error) {
      return json(res, 502, { ok: false, error: sanitizeError(error).error });
    }
  });
}
