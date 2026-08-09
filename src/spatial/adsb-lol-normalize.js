import {
  ADSB_LOL_SOURCE_ID,
  ADSB_LOL_SOURCE_NAME,
  ADSB_LOL_SOURCE_LICENSE,
  ADSB_LOL_SOURCE_URL,
  ADSB_MAX_AGE_SECONDS
} from './adsb-lol-config.js';
import { LIVE_SOURCE_CLASS } from './live-object-types.js';

const BUSINESS_JET_TYPE_PREFIXES = [
  'BE4', 'BE5', 'C25', 'C55', 'C56', 'C68', 'E35', 'E50', 'E55', 'GLF', 'G150', 'G280', 'FA7', 'FA8', 'LJ', 'CL60', 'H25'
];

const CATEGORY_LABELS = {
  A1: 'Light',
  A2: 'Small',
  A3: 'Large',
  A4: 'High vortex large',
  A5: 'Heavy',
  A6: 'High performance',
  A7: 'Rotorcraft'
};

export function normalizeHeadingDegrees(track) {
  const value = Number(track);
  if (!Number.isFinite(value)) return null;
  let heading = value % 360;
  if (heading < 0) heading += 360;
  return heading;
}

export function classifyAircraft(raw = {}) {
  const category = String(raw.category || '').trim().toUpperCase();
  const typeCode = String(raw.t || '').trim().toUpperCase();

  if (category === 'A7') {
    return { aircraftClass: 'HELICOPTER', aircraftClassLabel: 'Helicopter' };
  }
  if (category === 'A1') {
    return { aircraftClass: 'LIGHT_AIRCRAFT', aircraftClassLabel: 'Light aircraft' };
  }
  if (category === 'A5') {
    return { aircraftClass: 'AIRLINER', aircraftClassLabel: 'Airliner' };
  }
  if (category === 'A2' && isBusinessJetType(typeCode)) {
    return { aircraftClass: 'BUSINESS_JET', aircraftClassLabel: 'Business jet' };
  }
  if (category && /^A[1-6]$/.test(category)) {
    return { aircraftClass: 'FIXED_WING', aircraftClassLabel: 'Fixed wing' };
  }
  if (typeCode) {
    return { aircraftClass: 'FIXED_WING', aircraftClassLabel: 'Fixed wing' };
  }
  return { aircraftClass: 'UNKNOWN', aircraftClassLabel: 'Unknown' };
}

function isBusinessJetType(typeCode) {
  if (!typeCode) return false;
  return BUSINESS_JET_TYPE_PREFIXES.some((prefix) => typeCode.startsWith(prefix));
}

function parseAgeSeconds(raw) {
  const seen = Number(raw.seen_pos ?? raw.seen);
  return Number.isFinite(seen) ? seen : null;
}

function isTooStale(raw) {
  const age = parseAgeSeconds(raw);
  return age != null && age > ADSB_MAX_AGE_SECONDS;
}

function formatCallsign(flight) {
  const text = String(flight || '').trim();
  return text || null;
}

function feedTimestampFromRaw(raw) {
  const now = raw?.now;
  if (Number.isFinite(now)) {
    try {
      return new Date(now).toISOString();
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * @param {object} raw
 * @param {{ receivedAt?: string, feedTimestamp?: string|null, query?: object }} [meta]
 */
export function normalizeAdsbAircraftRow(raw, meta = {}) {
  if (!raw || typeof raw !== 'object') return null;
  if (isTooStale(raw)) return null;

  const latitude = Number(raw.lat);
  const longitude = Number(raw.lon);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return null;

  const hex = String(raw.hex || '').trim().toLowerCase();
  if (!hex) return null;

  const classification = classifyAircraft(raw);
  const ageSeconds = parseAgeSeconds(raw);
  const altitudeBaro = Number(raw.alt_baro);
  const altitudeGeom = Number(raw.alt_geom);
  const altitude = Number.isFinite(altitudeBaro) ? altitudeBaro : (Number.isFinite(altitudeGeom) ? altitudeGeom : null);
  const speed = Number(raw.gs);
  const heading = normalizeHeadingDegrees(raw.track);
  const verticalRate = Number(raw.baro_rate);

  const observedAt = meta.feedTimestamp || feedTimestampFromRaw(meta.rawEnvelope || {});
  const callsign = formatCallsign(raw.flight);
  const registration = String(raw.r || '').trim() || null;
  const typeCode = String(raw.t || '').trim() || null;
  const categoryCode = String(raw.category || '').trim() || null;

  const liveObjectId = `adsb:${hex}`;
  const displayName = callsign || registration || typeCode || hex;

  return {
    liveObjectId,
    sourceObjectId: hex,
    objectType: 'AIRCRAFT',
    objectSubtype: classification.aircraftClass,
    latitude,
    longitude,
    headingDegrees: heading,
    speed: Number.isFinite(speed) ? speed : null,
    speedUnit: Number.isFinite(speed) ? 'knots' : null,
    altitude,
    altitudeUnit: altitude != null ? 'feet' : null,
    verticalRate: Number.isFinite(verticalRate) ? verticalRate : null,
    callsign,
    registration,
    typeCode,
    displayName,
    route: null,
    origin: null,
    destination: null,
    status: String(raw.emergency || '').trim() && raw.emergency !== 'none' ? raw.emergency : null,
    observedAt,
    receivedAt: meta.receivedAt || null,
    ageSeconds,
    sourceId: ADSB_LOL_SOURCE_ID,
    sourceName: ADSB_LOL_SOURCE_NAME,
    sourceClass: LIVE_SOURCE_CLASS.OPEN_COMMUNITY_LIVE,
    sourceUrl: ADSB_LOL_SOURCE_URL,
    sourceLicense: ADSB_LOL_SOURCE_LICENSE,
    freshness: 'CURRENT',
    spatialPrecision: 'Live reported aircraft position',
    rawSourceType: String(raw.type || '').trim() || null,
    aircraftClass: classification.aircraftClass,
    aircraftClassLabel: classification.aircraftClassLabel,
    categoryCode,
    categoryLabel: CATEGORY_LABELS[categoryCode] || null,
    squawk: String(raw.squawk || '').trim() || null,
    iqaiType: 'live_aircraft'
  };
}

/**
 * @param {object} payload ADSB.lol envelope { ac, now, ... }
 * @param {{ receivedAt?: string, query?: object }} [meta]
 */
export function normalizeAdsbAircraftPayload(payload, meta = {}) {
  const feedTimestamp = feedTimestampFromRaw(payload);
  const receivedAt = meta.receivedAt || new Date().toISOString();
  const rows = Array.isArray(payload?.ac) ? payload.ac : [];
  const objects = [];
  const seen = new Set();

  for (const row of rows) {
    const object = normalizeAdsbAircraftRow(row, {
      receivedAt,
      feedTimestamp,
      query: meta.query,
      rawEnvelope: payload
    });
    if (!object || seen.has(object.liveObjectId)) continue;
    seen.add(object.liveObjectId);
    objects.push(object);
  }

  return {
    feedTimestamp,
    receivedAt,
    objects
  };
}

export function getAdsbStableId(object) {
  return String(object?.liveObjectId || object?.sourceObjectId || '').trim();
}
