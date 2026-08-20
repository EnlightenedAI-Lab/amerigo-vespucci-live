/**
 * Montréal Operational Layers V1.5 — Spatial V2 session overlay routes.
 * Adapters promoted from Data Master checkpoint 6b7974dd01cad618dd582b39bd071d1941d1eef1.
 * Does not write Portal. Does not consume uncommitted Solar / Port work.
 */
import { URLS, USER_AGENT, LAYERS } from './catalog.mjs';
import { buildCatalog, fetchLayer, sunStatePayload } from './layers.mjs';
import { fetchStillBuffer, probeStill, MAX_IN_VIEW } from './cameras.mjs';
import { fwiWmsUpstream, fetchFwiInfo } from './cwfis.mjs';

function json(res, status, body) {
  res.set('Cache-Control', 'no-store');
  return res.status(status).json(body);
}

function rewritePayload(payload) {
  if (!payload || typeof payload !== 'object') return payload;
  if (payload.fwi?.wms) payload.fwi.wms = '/api/spatial-v2/ops-layers/cwfis/fwi/wms';
  if (payload.fwi?.info) payload.fwi.info = '/api/spatial-v2/ops-layers/cwfis/fwi/info';
  if (payload.radar) {
    payload.radar.proxy = '/api/spatial-v2/ops-layers/radar/wms';
  }
  return payload;
}

async function proxyUpstream(res, upstream, { timeoutMs = 25000, accept = 'image/png, application/json, */*' } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(upstream, {
      headers: { 'User-Agent': USER_AGENT, Accept: accept },
      signal: controller.signal
    });
    const buffer = Buffer.from(await response.arrayBuffer());
    const type = response.headers.get('content-type') || 'image/png';
    res.set('Cache-Control', 'no-store');
    res.set('Content-Type', type);
    return res.status(response.status).end(buffer);
  } catch (error) {
    return json(res, 502, { ok: false, status: 'FAILED', message: error?.message || 'upstream proxy failed' });
  } finally {
    clearTimeout(timer);
  }
}

function villeStillUrl(id) {
  if (!/^\d{1,6}$/.test(String(id || ''))) return null;
  return `https://ville.montreal.qc.ca/Circulation-Cameras/GEN${id}.jpeg`;
}

async function handleCameraProbe(req, res) {
  const tokens = String(req.query.ids || '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .slice(0, MAX_IN_VIEW);
  if (!tokens.length) return json(res, 400, { ok: false, status: 'FAILED', message: 'ids required' });
  const cameras = [];
  for (const token of tokens) {
    const [famRaw, idRaw] = token.includes(':') ? token.split(':') : ['ville', token];
    const family = famRaw === 'mtmd' ? 'mtmd' : 'ville';
    const id = idRaw || famRaw;
    if (family === 'mtmd') {
      cameras.push({
        id,
        family: 'mtmd',
        imageStatus: 'RESTRICTED',
        retrievedAt: new Date().toISOString(),
        message: 'Québec 511 FenetreVideo.html is not a still. Product does not scrape quebec511.info.'
      });
      continue;
    }
    const still = villeStillUrl(id);
    if (!still) {
      cameras.push({ id, family: 'ville', imageStatus: 'UNAVAILABLE', retrievedAt: new Date().toISOString() });
      continue;
    }
    const probed = await probeStill(still);
    cameras.push({ id, family: 'ville', stillUrl: still, ...probed });
  }
  return json(res, 200, { ok: true, cameras, retrievedAt: new Date().toISOString() });
}

async function handleCameraFrame(req, res) {
  const still = villeStillUrl(req.query.id);
  if (!still) return json(res, 404, { ok: false, status: 'UNAVAILABLE', message: 'Invalid camera id' });
  try {
    const frame = await fetchStillBuffer(still);
    if (!frame.ok) {
      const code = frame.status === 404 ? 404 : (frame.status === 403 ? 403 : 502);
      return json(res, code, {
        ok: false,
        status: frame.imageStatus,
        http: frame.status,
        lastModified: frame.lastModified,
        retrievedAt: frame.retrievedAt,
        message: 'Still did not return an image'
      });
    }
    res.set({
      'Content-Type': frame.contentType || 'image/jpeg',
      'Cache-Control': 'no-store, no-cache, must-revalidate',
      'X-Image-Status': frame.imageStatus,
      'X-Source-Last-Modified': frame.lastModified || '',
      'X-Retrieved-At': frame.retrievedAt
    });
    return res.status(200).end(frame.buffer);
  } catch (error) {
    return json(res, 502, { ok: false, status: error.status || 'FAILED', message: error.message || 'frame proxy failed' });
  }
}

export function registerOperationalLayerRoutes(app) {
  app.get('/api/spatial-v2/ops-layers/catalog', async (_req, res) => {
    try {
      const catalog = await buildCatalog();
      catalog.title = 'IQAI Spatial V2 operational layers V1.5';
      catalog.port = Number(process.env.PORT || 3047);
      catalog.sourceCheckpoint = '6b7974dd01cad618dd582b39bd071d1941d1eef1';
      catalog.visibilityOwner = 'layers-discover';
      catalog.acquisitionOwner = 'world-object-acquisition';
      catalog.hydrantSignalRule = 'WOA sources remain visibility-owned by Layers. Do not duplicate hydrant or traffic-signal catalog rows.';
      return json(res, 200, catalog);
    } catch (error) {
      return json(res, 500, { ok: false, status: 'FAILED', message: error?.message || 'catalog failed' });
    }
  });

  app.get('/api/spatial-v2/ops-layers/meta', (_req, res) => {
    return json(res, 200, {
      ok: true,
      layerIds: LAYERS.map((layer) => layer.id),
      groups: [...new Set(LAYERS.map((layer) => layer.group))],
      visibilityOwner: 'layers-discover'
    });
  });

  app.get('/api/spatial-v2/ops-layers/layers/:id', async (req, res) => {
    try {
      const payload = rewritePayload(await fetchLayer(req.params.id, {
        window: req.query.window,
        category: req.query.category,
        route: req.query.route,
        lat: req.query.lat,
        lon: req.query.lon,
        at: req.query.at,
        area: req.query.area,
        minLat: req.query.minLat,
        maxLat: req.query.maxLat,
        minLon: req.query.minLon,
        maxLon: req.query.maxLon
      }));
      const code = payload?.ok || payload?.geojson
        ? 200
        : (payload?.status === 'AUTH_REQUIRED' || payload?.status === 'UNAVAILABLE' ? 200 : 502);
      return json(res, code, payload);
    } catch (error) {
      return json(res, 500, { ok: false, status: 'FAILED', message: error?.message || 'layer failed' });
    }
  });

  app.get('/api/spatial-v2/ops-layers/sun/state', async (req, res) => {
    try {
      const payload = await sunStatePayload({
        lat: req.query.lat,
        lon: req.query.lon,
        at: req.query.at,
        includeDa: true
      });
      return json(res, 200, {
        ok: true,
        status: 'COMPUTED',
        ...payload
      });
    } catch (error) {
      return json(res, 500, {
        ok: false,
        status: 'FAILED',
        message: error?.message || 'solar point calculation failed'
      });
    }
  });

  app.get('/api/spatial-v2/ops-layers/radar/wms', async (req, res) => {
    const upstream = new URL(URLS.geometWms);
    for (const [key, value] of Object.entries(req.query || {})) {
      if (value == null) continue;
      upstream.searchParams.set(key, String(value));
    }
    if (!upstream.searchParams.get('SERVICE')) upstream.searchParams.set('SERVICE', 'WMS');
    if (!upstream.searchParams.get('LAYERS')) upstream.searchParams.set('LAYERS', URLS.geometRadarLayer);
    return proxyUpstream(res, upstream);
  });

  app.get('/api/spatial-v2/ops-layers/cwfis/fwi/wms', async (req, res) => {
    try {
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(req.query || {})) {
        if (value == null) continue;
        params.set(key, String(value));
      }
      const upstream = fwiWmsUpstream(params);
      return proxyUpstream(res, upstream);
    } catch (error) {
      return json(res, 400, { ok: false, status: 'FAILED', message: error?.message || 'CWFIS FWI proxy rejected' });
    }
  });

  app.get('/api/spatial-v2/ops-layers/cwfis/fwi/info', async (req, res) => {
    const lat = Number(req.query.lat);
    const lon = Number(req.query.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      return json(res, 400, { ok: false, status: 'FAILED', message: 'lat and lon required' });
    }
    try {
      const info = await fetchFwiInfo(lat, lon);
      return json(res, info.ok ? 200 : 502, info);
    } catch (error) {
      return json(res, 502, { ok: false, status: 'FAILED', message: error?.message || 'CWFIS GetFeatureInfo failed' });
    }
  });

  app.get('/api/spatial-v2/ops-layers/cameras/probe', handleCameraProbe);
  app.get('/api/spatial-v2/ops-layers/cameras/frame', handleCameraFrame);
}
