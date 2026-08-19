const EARTH_M = 6378137;

function toRad(value) {
  return Number(value) * Math.PI / 180;
}

function toDeg(value) {
  return Number(value) * 180 / Math.PI;
}

export function haversineMeters(aLat, aLon, bLat, bLon) {
  const φ1 = toRad(aLat);
  const φ2 = toRad(bLat);
  const Δφ = toRad(bLat - aLat);
  const Δλ = toRad(bLon - aLon);
  const s = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
  return 2 * EARTH_M * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
}

/** Initial true bearing from A to B, degrees clockwise from north, 0–360. */
export function initialBearing(aLat, aLon, bLat, bLon) {
  const φ1 = toRad(aLat);
  const φ2 = toRad(bLat);
  const Δλ = toRad(bLon - aLon);
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

export function formatBearing(degrees) {
  if (!Number.isFinite(degrees)) return null;
  return `${degrees.toFixed(1)}° T`;
}

export function formatRange(meters) {
  if (!Number.isFinite(meters)) return null;
  if (meters >= 10000) return `${(meters / 1000).toFixed(2)} km`;
  if (meters >= 1000) return `${(meters / 1000).toFixed(3)} km`;
  return `${meters.toFixed(1)} m`;
}

export function mapScaleDenominator(latitude, zoom) {
  const lat = Number(latitude);
  const z = Number(zoom);
  if (!Number.isFinite(lat) || !Number.isFinite(z)) return null;
  const metersPerPixel = (40075016.686 * Math.cos(lat * Math.PI / 180)) / (256 * 2 ** z);
  return metersPerPixel * (96 / 0.0254);
}

export function ddDigitsForZoom(zoom) {
  if (zoom >= 18) return 6;
  if (zoom >= 15) return 5;
  if (zoom >= 12) return 5;
  return 4;
}

export function snapRadiusMeters(zoom) {
  if (zoom >= 18) return 14;
  if (zoom >= 16) return 32;
  if (zoom >= 14) return 70;
  return 140;
}

export function pointerMetrics(zoom) {
  if (zoom >= 18) {
    return { gap: 12.4, arm: 8.4, pip: 1.2 };
  }
  if (zoom >= 16) {
    return { gap: 13.4, arm: 8.0, pip: 1.2 };
  }
  if (zoom >= 13) {
    return { gap: 14.6, arm: 7.4, pip: 1.25 };
  }
  return { gap: 15.6, arm: 7.0, pip: 1.3 };
}
