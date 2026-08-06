import { haversineDistanceNM, calculateEstimatedETA } from '../navigation.js';

export const FRESHNESS_LIVE_SECONDS = 300;
export const FRESHNESS_DELAYED_SECONDS = 1800;
export const INVALID_HEADING = 511;

/**
 * @typedef {'LIVE'|'DELAYED'|'STALE'|'LAST_KNOWN'|'UNVERIFIED'} FreshnessState
 */

export function classifyVesselFreshness(lastAis, now = Date.now(), options = {}) {
  if (options.lastKnown) return 'LAST_KNOWN';
  if (!lastAis) return 'UNVERIFIED';
  const ageSec = Math.floor((now - new Date(lastAis).getTime()) / 1000);
  if (!Number.isFinite(ageSec) || ageSec < 0) return 'UNVERIFIED';
  if (ageSec <= FRESHNESS_LIVE_SECONDS) return 'LIVE';
  if (ageSec <= FRESHNESS_DELAYED_SECONDS) return 'DELAYED';
  return 'STALE';
}

export function resolveHeading(position, lastValidHeading = null) {
  const heading = Number(position?.heading);
  const course = Number(position?.course);
  if (Number.isFinite(heading) && heading !== INVALID_HEADING && heading >= 0 && heading <= 360) {
    return { heading, source: 'heading', unknown: false };
  }
  if (Number.isFinite(course) && course >= 0 && course <= 360) {
    return { heading: course, source: 'cog', unknown: false };
  }
  if (Number.isFinite(lastValidHeading)) {
    return { heading: lastValidHeading, source: 'last-valid', unknown: true };
  }
  return { heading: 0, source: 'none', unknown: true };
}

export function normalizeAisPosition(raw, config) {
  const lat = Number(raw?.latitude ?? raw?.Latitude);
  const lon = Number(raw?.longitude ?? raw?.Longitude);
  const validCoords = Number.isFinite(lat) && Number.isFinite(lon)
    && Math.abs(lat) <= 90 && Math.abs(lon) <= 180;
  const lastAIS = raw?.lastAIS instanceof Date ? raw.lastAIS : new Date(raw?.lastAIS || raw?.LastAIS);
  const validTime = !Number.isNaN(lastAIS.getTime());
  return {
    mmsi: Number(raw?.mmsi || raw?.MMSI || config?.targetMmsi),
    vesselName: raw?.vesselName || raw?.VesselName || 'Amerigo Vespucci',
    latitude: lat,
    longitude: lon,
    speedKnots: raw?.speedKnots ?? raw?.SpeedKnots ?? null,
    course: raw?.course ?? raw?.Course ?? null,
    heading: raw?.heading ?? raw?.Heading ?? null,
    lastAIS,
    source: raw?.source || raw?.Source || null,
    coordinateValid: validCoords,
    timestampValid: validTime,
    freshness: validCoords && validTime
      ? classifyVesselFreshness(lastAIS)
      : 'UNVERIFIED'
  };
}

export function confidenceExplanation(position) {
  return {
    source: position.source || 'unknown',
    ageSeconds: position.lastAIS ? Math.floor((Date.now() - position.lastAIS.getTime()) / 1000) : null,
    coordinateValid: position.coordinateValid,
    headingValid: Number.isFinite(position.heading) && position.heading !== INVALID_HEADING,
    continuity: position.freshness !== 'UNVERIFIED',
    note: 'Deterministic inputs only — not an AIS confidence percentage.'
  };
}

/**
 * Project COG vector endpoint from SOG (knots) over minutes.
 */
export function projectCogEndpoint(lat, lon, courseDeg, speedKnots, minutes = 15) {
  if (![lat, lon, courseDeg, speedKnots].every(Number.isFinite) || speedKnots <= 0) return null;
  const distanceNM = speedKnots * (minutes / 60);
  const R = 3440.065;
  const br = courseDeg * Math.PI / 180;
  const lat1 = lat * Math.PI / 180;
  const lon1 = lon * Math.PI / 180;
  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(distanceNM / R)
    + Math.cos(lat1) * Math.sin(distanceNM / R) * Math.cos(br));
  const lon2 = lon1 + Math.atan2(
    Math.sin(br) * Math.sin(distanceNM / R) * Math.cos(lat1),
    Math.cos(distanceNM / R) - Math.sin(lat1) * Math.sin(lat2)
  );
  return { latitude: lat2 * 180 / Math.PI, longitude: lon2 * 180 / Math.PI };
}

export function bearingToDestination(from, to) {
  const lat1 = from.latitude * Math.PI / 180;
  const lat2 = to.latitude * Math.PI / 180;
  const dLon = (to.longitude - from.longitude) * Math.PI / 180;
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  const brng = Math.atan2(y, x) * 180 / Math.PI;
  return (brng + 360) % 360;
}

export function routeMetrics(vessel, destination, config) {
  const distanceNM = haversineDistanceNM(vessel, destination);
  const bearing = bearingToDestination(vessel, destination);
  const eta = calculateEstimatedETA(
    vessel.lastAIS,
    distanceNM,
    vessel.speedKnots,
    config?.etaMinSpeedKnots ?? 1
  );
  return {
    distanceNM,
    bearingDeg: bearing,
    eta,
    estimated: true,
    speedAssumptionKnots: vessel.speedKnots
  };
}
