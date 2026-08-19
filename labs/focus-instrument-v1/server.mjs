/**
 * IQAI Focus Instrument Lab — standalone HTTP server.
 * Does not start or touch Spatial V2 production.
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(__dirname, 'public');
const PORT = Number(process.env.FOCUS_INSTRUMENT_PORT || 8767);
const UA = 'IQAI-Focus-Instrument-Lab/1.0 (spatial-lab; localhost)';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.geojson': 'application/geo+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon'
};

const catalog = JSON.parse(fs.readFileSync(path.join(PUBLIC, 'data', 'features.json'), 'utf8'));
const reverseCache = new Map();
const elevationCache = new Map();

function send(res, status, body, headers = {}) {
  const payload = typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  res.writeHead(status, {
    'Cache-Control': 'no-store',
    ...headers,
    'Content-Length': Buffer.byteLength(payload)
  });
  res.end(payload);
}

function sendJson(res, status, body) {
  send(res, status, body, { 'Content-Type': 'application/json; charset=utf-8' });
}

function finite(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function cacheKey(lat, lon) {
  return `${Number(lat).toFixed(4)},${Number(lon).toFixed(4)}`;
}

function haversineMeters(aLat, aLon, bLat, bLon) {
  const toRad = (v) => v * Math.PI / 180;
  const φ1 = toRad(aLat);
  const φ2 = toRad(bLat);
  const Δφ = toRad(bLat - aLat);
  const Δλ = toRad(bLon - aLon);
  const s = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
  return 2 * 6378137 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
}

function demoElevation(lat, lon) {
  let weightSum = 0;
  let valueSum = 0;
  for (const sample of catalog.elevationSamples) {
    const d = haversineMeters(lat, lon, sample.lat, sample.lng);
    if (d < 1) return { meters: sample.z, source: 'demo-surface' };
    const w = 1 / (d * d);
    weightSum += w;
    valueSum += w * sample.z;
  }
  return { meters: valueSum / weightSum, source: 'demo-surface' };
}

function formatArcGisAddress(payload) {
  const address = payload?.address;
  if (!address || typeof address !== 'object') return null;
  const match = String(
    address.LongLabel
    || address.Match_addr
    || address.ShortLabel
    || address.Address
    || ''
  ).trim();
  if (match) return match;
  const parts = [
    address.PlaceName,
    address.Neighborhood,
    address.City,
    address.RegionAbbr || address.Region
  ].filter((part) => String(part || '').trim());
  return parts.join(', ').trim() || null;
}

async function fetchJson(url, headers = {}) {
  const response = await fetch(url, {
    headers,
    signal: AbortSignal.timeout(6500)
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

async function reverseGeocode(lat, lon) {
  const key = cacheKey(lat, lon);
  if (reverseCache.has(key)) return reverseCache.get(key);

  const attempts = [
    'PointAddress,StreetAddress',
    'StreetName,POI'
  ];
  for (const featureTypes of attempts) {
    try {
      const params = new URLSearchParams({
        f: 'json',
        location: `${lon},${lat}`,
        langCode: 'en',
        featureTypes
      });
      const data = await fetchJson(`https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer/reverseGeocode?${params}`);
      const place = formatArcGisAddress(data);
      if (place) {
        const result = { ok: true, place, source: 'arcgis-world-geocoder' };
        reverseCache.set(key, result);
        return result;
      }
    } catch {
      /* try next */
    }
  }
  try {
    const params = new URLSearchParams({
      format: 'jsonv2',
      lat: String(lat),
      lon: String(lon),
      zoom: '18',
      addressdetails: '1'
    });
    const data = await fetchJson(
      `https://nominatim.openstreetmap.org/reverse?${params}`,
      { 'User-Agent': UA, Accept: 'application/json' }
    );
    const place = String(data?.display_name || '').trim() || null;
    const result = { ok: Boolean(place), place, source: 'nominatim' };
    reverseCache.set(key, result);
    return result;
  } catch {
    const result = { ok: false, place: null, source: null };
    reverseCache.set(key, result);
    return result;
  }
}

async function elevation(lat, lon) {
  const key = cacheKey(lat, lon);
  if (elevationCache.has(key)) return elevationCache.get(key);
  try {
    const params = new URLSearchParams({
      latitude: String(lat),
      longitude: String(lon)
    });
    const data = await fetchJson(`https://api.open-meteo.com/v1/elevation?${params}`);
    const meters = finite(data?.elevation?.[0]);
    if (meters != null) {
      const result = { ok: true, meters, source: 'open-meteo' };
      elevationCache.set(key, result);
      return result;
    }
  } catch {
    /* fall through */
  }
  const demo = demoElevation(lat, lon);
  const result = { ok: true, ...demo };
  elevationCache.set(key, result);
  return result;
}

function safePath(urlPath) {
  const decoded = decodeURIComponent(urlPath.split('?')[0]);
  const relative = decoded === '/' ? '/index.html' : decoded;
  const resolved = path.normalize(path.join(PUBLIC, relative));
  if (!resolved.startsWith(PUBLIC)) return null;
  return resolved;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://127.0.0.1:${PORT}`);

  if (url.pathname === '/health') {
    sendJson(res, 200, { ok: true, service: 'iqai-focus-instrument-lab', port: PORT });
    return;
  }

  if (url.pathname === '/api/reverse') {
    const lat = finite(url.searchParams.get('lat'));
    const lon = finite(url.searchParams.get('lon'));
    if (lat == null || lon == null) {
      sendJson(res, 400, { ok: false, error: 'lat/lon required' });
      return;
    }
    sendJson(res, 200, await reverseGeocode(lat, lon));
    return;
  }

  if (url.pathname === '/api/elevation') {
    const lat = finite(url.searchParams.get('lat'));
    const lon = finite(url.searchParams.get('lon'));
    if (lat == null || lon == null) {
      sendJson(res, 400, { ok: false, error: 'lat/lon required' });
      return;
    }
    sendJson(res, 200, await elevation(lat, lon));
    return;
  }

  const file = safePath(url.pathname);
  if (!file) {
    send(res, 403, 'Forbidden', { 'Content-Type': 'text/plain; charset=utf-8' });
    return;
  }
  fs.readFile(file, (error, data) => {
    if (error) {
      send(res, 404, 'Not found', { 'Content-Type': 'text/plain; charset=utf-8' });
      return;
    }
    send(res, 200, data, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
  });
});

server.listen(PORT, '127.0.0.1', () => {
  process.stdout.write(`IQAI Focus Instrument Lab  http://localhost:${PORT}/\n`);
});
