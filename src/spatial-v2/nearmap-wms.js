import { sanitizeError } from '../security.js';

const NEARMAP_WMS_HOST_PREFIX = 'https://api.nearmap.com/wms/';
const DEFAULT_LAYER = 'Nearmap';
const PROXY_PATH = '/api/spatial-v2/imagery/nearmap/wms';

export function redactNearmapSecrets(text) {
  return String(text || '')
    .replace(/apikey\/[A-Za-z0-9-]+/gi, 'apikey/[redacted]')
    .replace(/apikey=[^&\s"'<>]+/gi, 'apikey=[redacted]');
}

export function resolveNearmapWmsUrl(env = process.env) {
  const explicit = String(env.NEARMAP_WMS_URL || '').trim().replace(/[?].*$/, '');
  if (explicit) return explicit;
  const key = String(env.NEARMAP_API_KEY || '').trim();
  if (key) return `https://api.nearmap.com/wms/v1/latest/apikey/${key}`;
  return null;
}

export function assertAllowedNearmapWmsUrl(url) {
  if (!url || !url.startsWith(NEARMAP_WMS_HOST_PREFIX)) {
    throw new Error('Nearmap WMS URL is not an allowed Nearmap WMS host.');
  }
}

export function rewriteWmsCapabilities(xml, publicUrl) {
  const rewritten = String(xml || '').replace(
    /https:\/\/api\.nearmap\.com\/wms\/[^"'<\s?]+/gi,
    publicUrl
  );
  return redactNearmapSecrets(rewritten);
}

export function parseWmsLayerNames(xml) {
  const names = [];
  const re = /<Name>([^<]+)<\/Name>/g;
  let match;
  while ((match = re.exec(String(xml || '')))) {
    const name = match[1].trim();
    if (name && name !== 'OGC:WMS' && name !== 'Nearmap WMS') names.push(name);
  }
  return [...new Set(names)];
}

export function parseWmsSrs(xml) {
  const found = [];
  const re = /<(?:SRS|CRS)>([^<]+)<\/(?:SRS|CRS)>/gi;
  let match;
  while ((match = re.exec(String(xml || '')))) {
    const value = match[1].trim();
    if (value && !found.includes(value)) found.push(value);
  }
  return found;
}

export function inspectWmsCapabilities(xml) {
  const text = String(xml || '');
  const layers = parseWmsLayerNames(text);
  const titles = [...text.matchAll(/<Title>([^<]+)<\/Title>/g)].map((item) => item[1].trim());
  return {
    serviceType: /TileMatrixSet/i.test(text) ? 'WMTS' : 'WMS',
    version: /WMT_MS_Capabilities[^>]*version="([^"]+)"/i.exec(text)?.[1]
      || /WMS_Capabilities[^>]*version="([^"]+)"/i.exec(text)?.[1]
      || null,
    layers,
    titles,
    srs: parseWmsSrs(text),
    timeDimension: /<Dimension\b[^>]*name=["']time["']/i.test(text)
      || /<Extent\b[^>]*name=["']time["']/i.test(text),
    tileMatrixSet: /TileMatrixSet/i.test(text),
    datedLayerNames: layers.filter((name) => /\d{4}-\d{2}-\d{2}|\bvintage\b|\bsurvey\b/i.test(name)),
    latestTitles: titles.filter((title) => /\blatest\b/i.test(title)),
    attribution: /<AccessConstraints>([^<]*)<\/AccessConstraints>/i.exec(text)?.[1] || null
  };
}

export function publicWmsProxyUrl(req) {
  const host = req.get('host') || '127.0.0.1';
  const proto = req.protocol || 'http';
  return `${proto}://${host}${PROXY_PATH}`;
}

export async function proxyNearmapWms(req, res, options = {}) {
  const env = options.env || process.env;
  const fetchImpl = options.fetchImpl || fetch;
  const upstream = resolveNearmapWmsUrl(env);
  if (!upstream) {
    res.set('Cache-Control', 'no-store');
    return res.status(503).json({
      ok: false,
      entitlement: 'entitlement-missing',
      error: 'Nearmap latest WMS is not configured on the server.'
    });
  }
  try {
    assertAllowedNearmapWmsUrl(upstream);
  } catch (error) {
    res.set('Cache-Control', 'no-store');
    return res.status(400).json({ ok: false, entitlement: 'denied', error: error.message });
  }

  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(req.query || {})) {
    if (/apikey|token|password|secret/i.test(key)) continue;
    params.set(key, String(value));
  }
  if (!params.get('SERVICE')) params.set('SERVICE', 'WMS');
  if (!params.get('REQUEST')) params.set('REQUEST', 'GetCapabilities');
  const formatKey = [...params.keys()].find((key) => key.toLowerCase() === 'format');
  if (formatKey && /^image\/jpg$/i.test(params.get(formatKey))) {
    params.set(formatKey, 'image/jpeg');
  }

  const requestName = String(params.get('REQUEST') || '').toLowerCase();
  const separator = upstream.includes('?') ? '&' : '?';
  const target = `${upstream}${separator}${params.toString()}`;

  try {
    const response = await fetchImpl(target, { cache: 'no-store' });
    if (response.status === 401 || response.status === 403) {
      res.set('Cache-Control', 'no-store');
      return res.status(403).json({ ok: false, entitlement: 'denied' });
    }
    if (!response.ok) {
      res.set('Cache-Control', 'no-store');
      return res.status(502).json({
        ok: false,
        entitlement: 'failed',
        error: `Nearmap WMS HTTP ${response.status}`
      });
    }
    const contentType = response.headers.get('content-type') || '';
    if (requestName === 'getcapabilities' || contentType.includes('xml')) {
      const xml = await response.text();
      const rewritten = rewriteWmsCapabilities(xml, publicWmsProxyUrl(req));
      res.set('Cache-Control', 'no-store');
      res.type('application/vnd.ogc.wms_xml');
      return res.send(rewritten);
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    res.set('Cache-Control', 'private, max-age=60');
    res.type(contentType || 'image/jpeg');
    return res.send(buffer);
  } catch (error) {
    res.set('Cache-Control', 'no-store');
    return res.status(502).json({
      ok: false,
      entitlement: 'failed',
      error: sanitizeError(error).error
    });
  }
}

export async function nearmapWmsStatus(req, res, options = {}) {
  const env = options.env || process.env;
  const fetchImpl = options.fetchImpl || fetch;
  const upstream = resolveNearmapWmsUrl(env);
  if (!upstream) {
    res.set('Cache-Control', 'no-store');
    return res.status(200).json({
      ok: false,
      entitlement: 'entitlement-missing',
      serviceType: 'WMS',
      historical: false,
      layers: [],
      defaultLayer: DEFAULT_LAYER
    });
  }
  try {
    assertAllowedNearmapWmsUrl(upstream);
    const response = await fetchImpl(`${upstream}?SERVICE=WMS&REQUEST=GetCapabilities&VERSION=1.1.1`, {
      cache: 'no-store'
    });
    if (response.status === 401 || response.status === 403) {
      res.set('Cache-Control', 'no-store');
      return res.status(403).json({
        ok: false,
        entitlement: 'denied',
        serviceType: 'WMS',
        historical: false,
        layers: []
      });
    }
    if (!response.ok) {
      res.set('Cache-Control', 'no-store');
      return res.status(502).json({
        ok: false,
        entitlement: 'failed',
        serviceType: 'WMS',
        historical: false,
        layers: []
      });
    }
    const xml = await response.text();
    const inspected = inspectWmsCapabilities(xml);
    const historical = Boolean(inspected.timeDimension || inspected.datedLayerNames.length);
    res.set('Cache-Control', 'no-store');
    return res.status(200).json({
      ok: true,
      entitlement: 'ready',
      serviceType: inspected.serviceType,
      version: inspected.version,
      historical,
      timeDimension: inspected.timeDimension,
      defaultLayer: inspected.layers.includes(DEFAULT_LAYER)
        ? DEFAULT_LAYER
        : (inspected.layers[0] || DEFAULT_LAYER),
      layers: inspected.layers,
      crs: inspected.srs.includes('EPSG:3857')
        ? ['EPSG:3857', ...inspected.srs.filter((code) => code !== 'EPSG:3857')]
        : inspected.srs,
      latestTitles: inspected.latestTitles,
      attribution: inspected.attribution || 'Nearmap'
    });
  } catch (error) {
    res.set('Cache-Control', 'no-store');
    return res.status(502).json({
      ok: false,
      entitlement: 'failed',
      serviceType: 'WMS',
      historical: false,
      layers: [],
      error: sanitizeError(error).error
    });
  }
}
