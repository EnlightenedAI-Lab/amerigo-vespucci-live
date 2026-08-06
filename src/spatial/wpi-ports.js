import { logger } from '../logger.js';

const WPI_URL = 'https://msi.nga.mil/api/publications/world-port-index?output=csv';
const DAILY_MS = 24 * 60 * 60 * 1000;

const COLUMN_ALIASES = {
  name: ['PORT_NAME', 'portName'],
  country: ['COUNTRY', 'countryName', 'countryCode'],
  latitude: ['LATITUDE', 'latitude'],
  longitude: ['LONGITUDE', 'longitude'],
  harbourSize: ['HARBOR_SIZE', 'HARBOUR_SIZE', 'harborSize'],
  harbourType: ['HARBOR_TYPE', 'HARBOUR_TYPE', 'harborType'],
  waterDepth: ['WATER_DEPTH', 'chDepth', 'anDepth', 'waterDepth']
};

/**
 * Parse NGA WPI DMS coordinate strings (e.g. 30°20'00"N) or decimal degrees.
 * @param {string|number} value
 * @param {'lat'|'lon'} axis
 */
export function parseWpiCoordinate(value, axis) {
  if (value == null || value === '') return null;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const raw = String(value).trim().replace(/^"|"$/g, '');
  const decimal = Number(raw);
  if (Number.isFinite(decimal) && !/[°'"]/.test(raw)) return decimal;

  const match = raw.match(/^(\d{1,3})°(\d{1,2})'(\d{1,2}(?:\.\d+)?)"?\s*([NSEW])$/i);
  if (!match) return null;
  const [, deg, min, sec, hemi] = match;
  let out = Number(deg) + Number(min) / 60 + Number(sec) / 3600;
  const upper = hemi.toUpperCase();
  if ((axis === 'lat' && upper === 'S') || (axis === 'lon' && upper === 'W')) out *= -1;
  return out;
}

function resolveColumn(headers, aliases) {
  for (const name of aliases) {
    const hit = headers.find((h) => h.toLowerCase() === name.toLowerCase());
    if (hit) return hit;
  }
  return null;
}

/**
 * Cached World Port Index with conditional refresh and viewport filtering.
 */
export class WpiPortService {
  constructor(options = {}) {
    this.fetchImpl = options.fetchImpl || fetch;
    this.cache = {
      ports: [],
      fetchedAt: 0,
      etag: null,
      lastModified: null,
      lastGood: null,
      schemaVersion: 2
    };
    this.maxAgeMs = options.maxAgeMs || DAILY_MS;
  }

  async refresh(force = false) {
    const age = Date.now() - this.cache.fetchedAt;
    if (!force && this.cache.ports.length && age < this.maxAgeMs) {
      return { fromCache: true, count: this.cache.ports.length };
    }

    const headers = {};
    if (this.cache.etag) headers['if-none-match'] = this.cache.etag;
    if (this.cache.lastModified) headers['if-modified-since'] = this.cache.lastModified;

    try {
      const res = await this.fetchImpl(WPI_URL, { headers });
      if (res.status === 304 && this.cache.lastGood) {
        this.cache.fetchedAt = Date.now();
        return { fromCache: true, notModified: true, count: this.cache.ports.length };
      }
      if (!res.ok) throw new Error(`WPI HTTP ${res.status}`);
      const text = await res.text();
      const ports = this.parseCsv(text);
      this.cache.ports = ports;
      this.cache.fetchedAt = Date.now();
      this.cache.lastGood = ports;
      this.cache.etag = res.headers.get('etag');
      this.cache.lastModified = res.headers.get('last-modified');
      return { fromCache: false, count: ports.length };
    } catch (err) {
      logger.warn('WPI refresh failed', { error: err.message });
      if (this.cache.lastGood?.length) {
        this.cache.ports = this.cache.lastGood;
        return { fromCache: true, degraded: true, count: this.cache.ports.length, error: err.message };
      }
      throw err;
    }
  }

  parseCsv(text) {
    const lines = text.split(/\r?\n/).filter(Boolean);
    if (lines.length < 2) throw new Error('WPI CSV empty');
    const headers = lines[0].split(',').map((h) => h.trim().replace(/^"|"$/g, ''));
    const colName = resolveColumn(headers, COLUMN_ALIASES.name);
    const colCountry = resolveColumn(headers, COLUMN_ALIASES.country);
    const colLat = resolveColumn(headers, COLUMN_ALIASES.latitude);
    const colLon = resolveColumn(headers, COLUMN_ALIASES.longitude);
    if (!colName || !colLat || !colLon) {
      throw new Error('WPI schema missing required columns (port name, latitude, longitude)');
    }
    const colHarbourSize = resolveColumn(headers, COLUMN_ALIASES.harbourSize);
    const colHarbourType = resolveColumn(headers, COLUMN_ALIASES.harbourType);
    const colDepth = resolveColumn(headers, COLUMN_ALIASES.waterDepth);

    const ports = [];
    for (let i = 1; i < lines.length; i++) {
      const row = this._parseCsvLine(lines[i]);
      if (row.length < headers.length) continue;
      const rec = Object.fromEntries(headers.map((h, idx) => [h, row[idx]?.replace(/^"|"$/g, '')]));
      const lat = parseWpiCoordinate(rec[colLat], 'lat');
      const lon = parseWpiCoordinate(rec[colLon], 'lon');
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
      ports.push({
        name: rec[colName],
        country: colCountry ? rec[colCountry] : null,
        latitude: lat,
        longitude: lon,
        harbourSize: colHarbourSize ? rec[colHarbourSize] : null,
        harbourType: colHarbourType ? rec[colHarbourType] : null,
        waterDepth: colDepth ? rec[colDepth] : null,
        provider: 'NGA World Port Index',
        retrievalTime: new Date().toISOString()
      });
    }
    return ports;
  }

  _parseCsvLine(line) {
    const out = [];
    let cur = '';
    let inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') { inQ = !inQ; continue; }
      if (ch === ',' && !inQ) { out.push(cur); cur = ''; continue; }
      cur += ch;
    }
    out.push(cur);
    return out;
  }

  queryViewport(bbox) {
    const { west, south, east, north } = bbox;
    return this.cache.ports.filter((p) =>
      p.longitude >= west && p.longitude <= east
      && p.latitude >= south && p.latitude <= north
    );
  }

  toGeoJson(ports) {
    return {
      type: 'FeatureCollection',
      features: ports.map((p, i) => ({
        type: 'Feature',
        id: i,
        geometry: { type: 'Point', coordinates: [p.longitude, p.latitude] },
        properties: { ...p }
      })),
      meta: {
        provider: 'NGA World Port Index',
        retrievalTime: this.cache.fetchedAt ? new Date(this.cache.fetchedAt).toISOString() : null,
        count: ports.length,
        notForNavigation: 'Situational awareness only — not for navigation.'
      }
    };
  }
}
