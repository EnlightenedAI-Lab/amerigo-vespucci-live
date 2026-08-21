/**
 * WGS84 spherical helpers for Camera federation relevance math.
 * Same mean radius as Spatial V2 analytical-measure (6371000 m).
 */

export const EARTH_RADIUS_M = 6371000;

export function wrapHeading(value) {
  const heading = Number(value);
  if (!Number.isFinite(heading)) return 0;
  return ((heading % 360) + 360) % 360;
}

export function clamp(value, min, max, fallback = min) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

export function toRad(degrees) {
  return Number(degrees) * Math.PI / 180;
}

export function toDeg(radians) {
  return Number(radians) * 180 / Math.PI;
}

export function destinationAlongHeading(origin, headingDeg, meters) {
  const lat1 = toRad(origin?.latitude);
  const lon1 = toRad(origin?.longitude);
  const bearing = toRad(headingDeg);
  const angular = Number(meters) / EARTH_RADIUS_M;
  if (![lat1, lon1, bearing, angular].every(Number.isFinite)) return null;
  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(angular)
    + Math.cos(lat1) * Math.sin(angular) * Math.cos(bearing)
  );
  const lon2 = lon1 + Math.atan2(
    Math.sin(bearing) * Math.sin(angular) * Math.cos(lat1),
    Math.cos(angular) - Math.sin(lat1) * Math.sin(lat2)
  );
  return {
    latitude: toDeg(lat2),
    longitude: ((toDeg(lon2) + 540) % 360) - 180
  };
}

export function headingFromPoints(origin, target) {
  const lat1 = toRad(origin.latitude);
  const lat2 = toRad(target.latitude);
  const dLon = toRad(Number(target.longitude) - Number(origin.longitude));
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  return wrapHeading(toDeg(Math.atan2(y, x)));
}

export function geodesicMeters(a, b) {
  const lon1 = Number(a?.longitude);
  const lat1 = Number(a?.latitude);
  const lon2 = Number(b?.longitude);
  const lat2 = Number(b?.latitude);
  if (![lon1, lat1, lon2, lat2].every(Number.isFinite)) return null;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function lonLatToWorld(longitude, latitude, zoom) {
  const scale = 256 * 2 ** Number(zoom);
  const x = ((Number(longitude) + 180) / 360) * scale;
  const sinLat = Math.sin(toRad(latitude));
  const y = (0.5 - Math.log((1 + sinLat) / (1 - sinLat)) / (4 * Math.PI)) * scale;
  return { x, y, scale };
}

export function worldToLonLat(x, y, zoom) {
  const scale = 256 * 2 ** Number(zoom);
  const longitude = (Number(x) / scale) * 360 - 180;
  const n = Math.PI - (2 * Math.PI * Number(y)) / scale;
  const latitude = toDeg(Math.atan(Math.sinh(n)));
  return { longitude, latitude };
}
