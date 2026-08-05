export const ESTIMATED_ROUTE_BASIS = 'Straight-line geographic estimate; not an official navigational route.';
const EARTH_RADIUS_NM = 3440.065;

export function createPositionKey(position, source) {
  const mmsi = position?.mmsi;
  const timestamp = position?.lastAIS instanceof Date ? position.lastAIS.toISOString() : new Date(position?.lastAIS).toISOString();
  return `${mmsi}:${source}:${timestamp}`;
}

export function haversineDistanceNM(from, to) {
  const lat1 = toRadians(Number(from.latitude));
  const lat2 = toRadians(Number(to.latitude));
  const deltaLat = toRadians(Number(to.latitude) - Number(from.latitude));
  const deltaLon = toRadians(Number(to.longitude) - Number(from.longitude));
  const a = Math.sin(deltaLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLon / 2) ** 2;
  return 2 * EARTH_RADIUS_NM * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function calculateEstimatedETA(positionTimestamp, distanceNM, speedKnots, minSpeedKnots) {
  const speed = Number(speedKnots);
  if (!Number.isFinite(speed) || speed < Number(minSpeedKnots)) return null;
  const timestamp = positionTimestamp instanceof Date ? positionTimestamp : new Date(positionTimestamp);
  if (Number.isNaN(timestamp.getTime())) return null;
  return new Date(timestamp.getTime() + (Number(distanceNM) / speed) * 60 * 60 * 1000);
}

export function parseDestinationConfig(config) {
  const latitude = Number(config.destinationLatitude);
  const longitude = Number(config.destinationLongitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    throw new Error('DESTINATION_LATITUDE and DESTINATION_LONGITUDE must be finite numbers.');
  }
  return {
    name: config.destinationName,
    portCode: config.destinationPortCode,
    latitude,
    longitude
  };
}

export function buildPolyline(points) {
  return {
    paths: [points.map((point) => [point.longitude, point.latitude])],
    spatialReference: { wkid: 4326 }
  };
}

function toRadians(degrees) {
  return degrees * Math.PI / 180;
}
