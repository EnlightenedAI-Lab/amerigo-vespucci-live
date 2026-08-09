import {
  MTL_FIRE_STATIONS_GEOJSON_URL,
  MTL_FIRE_STATIONS_FETCH_TIMEOUT_MS,
  MTL_FIRE_STATIONS_CACHE_TTL_MS,
  MTL_FIRE_STATIONS_SOURCE_ID
} from './fire-station-config.js';
import { getCuratedSource } from './source-registry.js';
import { haversineDistanceMeters } from './public-safety-geometry.js';

/** @type {{ at: number, features: object[], totalSourceRecords: number, closedExcluded: number, ambiguousExcluded: number } | null} */
let cache = null;

export function clearFireStationDataCache() {
  cache = null;
}

const EMPTY_DATE_VALUES = new Set(['', 'nat', 'null', 'none', 'undefined']);

function normalizeDateField(value) {
  if (value == null) return null;
  const trimmed = String(value).trim();
  if (!trimmed) return null;
  if (EMPTY_DATE_VALUES.has(trimmed.toLowerCase())) return null;
  return trimmed;
}

export function isValidDateDebut(value) {
  const normalized = normalizeDateField(value);
  if (!normalized) return false;
  return !Number.isNaN(Date.parse(normalized));
}

export function isEmptyDateFin(value) {
  return normalizeDateField(value) == null;
}

/**
 * @param {object} props
 */
export function classifyOperationalStatus(props = {}) {
  const dateDebut = normalizeDateField(props.DATE_DEBUT);
  const dateFin = normalizeDateField(props.DATE_FIN);

  if (!isValidDateDebut(props.DATE_DEBUT)) {
    return {
      operationalStatus: 'ambiguous',
      isActive: false,
      dateDebut: dateDebut,
      dateFin: dateFin
    };
  }

  if (!isEmptyDateFin(props.DATE_FIN)) {
    return {
      operationalStatus: 'closed',
      isActive: false,
      dateDebut: dateDebut,
      dateFin: dateFin
    };
  }

  return {
    operationalStatus: 'Active',
    isActive: true,
    dateDebut: dateDebut,
    dateFin: null
  };
}

function buildAddress(props) {
  const civic = String(props.NO_CIVIQUE || '').trim();
  const street = String(props.RUE || '').trim();
  const parts = [civic, street].filter(Boolean);
  return parts.join(' ') || String(props.CASERNE || '').trim() || '—';
}

/**
 * @param {object} feature
 */
export function normalizeFireStationFeature(feature, receivedAt = new Date().toISOString()) {
  const props = feature.properties || feature.attributes || {};
  const lat = Number(props.LATITUDE ?? feature.geometry?.coordinates?.[1]);
  const lon = Number(props.LONGITUDE ?? feature.geometry?.coordinates?.[0]);
  const source = getCuratedSource(MTL_FIRE_STATIONS_SOURCE_ID);
  const status = classifyOperationalStatus(props);

  return {
    id: String(props.CASERNE || props.OBJECTID || props.id || `${lat},${lon}`),
    stationNumber: String(props.CASERNE || '').trim() || null,
    address: buildAddress(props),
    borough: String(props.ARRONDISSEMENT || '').trim() || null,
    city: String(props.VILLE || 'Montréal').trim(),
    latitude: lat,
    longitude: lon,
    dateDebut: status.dateDebut,
    dateFin: status.dateFin,
    operationalStatus: status.operationalStatus,
    isActive: status.isActive,
    sourceId: MTL_FIRE_STATIONS_SOURCE_ID,
    sourceName: source?.name || 'Ville de Montréal — Fire Stations',
    authority: source?.authority || 'Ville de Montréal',
    receivedAt
  };
}

/**
 * @param {object} geojson
 */
export function normalizeFireStationCollection(geojson, receivedAt) {
  const features = geojson?.features || [];
  return features
    .map((f) => normalizeFireStationFeature(f, receivedAt))
    .filter((f) => Number.isFinite(f.latitude) && Number.isFinite(f.longitude));
}

/**
 * @param {object[]} stations
 */
export function filterActiveFireStations(stations) {
  return stations.filter((station) => station.isActive && station.operationalStatus === 'Active');
}

/**
 * @param {object[]} stations
 */
export function summarizeOperationalExclusions(stations) {
  let closedExcluded = 0;
  let ambiguousExcluded = 0;
  for (const station of stations) {
    if (station.operationalStatus === 'closed') closedExcluded += 1;
    if (station.operationalStatus === 'ambiguous') ambiguousExcluded += 1;
  }
  return { closedExcluded, ambiguousExcluded };
}

/**
 * @param {object[]} stations
 * @param {{ latitude: number, longitude: number, radiusMeters: number }} origin
 */
export function filterStationsWithinRadius(stations, origin) {
  const { latitude, longitude, radiusMeters } = origin;
  return stations
    .map((station) => {
      const distanceMeters = haversineDistanceMeters(
        latitude,
        longitude,
        station.latitude,
        station.longitude
      );
      return { ...station, distanceMeters };
    })
    .filter((station) => station.distanceMeters <= radiusMeters)
    .sort((a, b) => a.distanceMeters - b.distanceMeters);
}

/**
 * @param {{ fetchFn?: typeof fetch, forceRefresh?: boolean }} [options]
 */
export async function fetchMontrealFireStations(options = {}) {
  const fetchFn = options.fetchFn || fetch;
  const now = Date.now();
  if (!options.forceRefresh && cache && now - cache.at < MTL_FIRE_STATIONS_CACHE_TTL_MS) {
    return {
      features: cache.features,
      totalSourceRecords: cache.totalSourceRecords,
      closedExcluded: cache.closedExcluded,
      ambiguousExcluded: cache.ambiguousExcluded,
      cached: true
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), MTL_FIRE_STATIONS_FETCH_TIMEOUT_MS);
  let response;
  try {
    response = await fetchFn(MTL_FIRE_STATIONS_GEOJSON_URL, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    throw new Error(`Fire station source fetch failed (${response.status})`);
  }

  const geojson = await response.json();
  const receivedAt = new Date().toISOString();
  const normalized = normalizeFireStationCollection(geojson, receivedAt);
  const { closedExcluded, ambiguousExcluded } = summarizeOperationalExclusions(normalized);
  const active = filterActiveFireStations(normalized);

  cache = {
    at: now,
    features: active,
    totalSourceRecords: normalized.length,
    closedExcluded,
    ambiguousExcluded
  };

  return {
    features: active,
    totalSourceRecords: normalized.length,
    closedExcluded,
    ambiguousExcluded,
    cached: false
  };
}

/**
 * @param {{ latitude: number, longitude: number, radiusMeters: number, fetchFn?: typeof fetch }} params
 */
export async function queryFireStationsWithinRadius(params) {
  const { latitude, longitude, radiusMeters, fetchFn } = params;
  const {
    features: activeStations,
    totalSourceRecords,
    closedExcluded,
    ambiguousExcluded
  } = await fetchMontrealFireStations({ fetchFn });
  const within = filterStationsWithinRadius(activeStations, { latitude, longitude, radiusMeters });
  return {
    features: within,
    totalSourceRecords,
    closedExcluded,
    ambiguousExcluded
  };
}
