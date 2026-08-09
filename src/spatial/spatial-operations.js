import { haversineDistanceMeters } from './public-safety-geometry.js';
import { MONTREAL_BBOX } from './dataset-registry.js';

/**
 * @param {object[]} features
 * @param {{ latitude: number, longitude: number, radiusMeters: number }} origin
 */
export function filterWithinRadius(features, origin) {
  const { latitude, longitude, radiusMeters } = origin;
  return features
    .map((feature) => {
      const distanceMeters = haversineDistanceMeters(
        latitude,
        longitude,
        feature.latitude,
        feature.longitude
      );
      return { ...feature, distanceMeters };
    })
    .filter((feature) => feature.distanceMeters <= radiusMeters)
    .sort((a, b) => a.distanceMeters - b.distanceMeters);
}

/**
 * @param {object[]} features
 * @param {{ latitude: number, longitude: number }} origin
 * @param {number} limit
 */
export function selectNearest(features, origin, limit) {
  const { latitude, longitude } = origin;
  const ranked = features
    .map((feature) => {
      const distanceMeters = haversineDistanceMeters(
        latitude,
        longitude,
        feature.latitude,
        feature.longitude
      );
      return { ...feature, distanceMeters };
    })
    .sort((a, b) => a.distanceMeters - b.distanceMeters);
  return ranked.slice(0, Math.max(0, limit));
}

/**
 * @param {object[]} features
 */
export function filterWithinMontrealBbox(features) {
  return features.filter((feature) => {
    const lat = feature.latitude;
    const lon = feature.longitude;
    return lat >= MONTREAL_BBOX.minLat
      && lat <= MONTREAL_BBOX.maxLat
      && lon >= MONTREAL_BBOX.minLon
      && lon <= MONTREAL_BBOX.maxLon;
  });
}

export function formatDistanceLabel(meters) {
  if (!Number.isFinite(meters)) return '—';
  if (meters >= 1000) return `${(meters / 1000).toFixed(2)} km`;
  return `${Math.round(meters)} m`;
}

export function attachDistanceLabels(features) {
  return features.map((feature) => ({
    ...feature,
    distanceLabel: formatDistanceLabel(feature.distanceMeters)
  }));
}

export function formatRadiusKm(radiusMeters) {
  const km = radiusMeters / 1000;
  return Number.isInteger(km) ? String(km) : km.toFixed(1);
}
