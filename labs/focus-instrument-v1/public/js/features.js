import { haversineMeters } from './geodesy.js';

export function nearestFeature(features, lat, lng, radiusMeters) {
  let best = null;
  for (const feature of features) {
    const range = haversineMeters(lat, lng, feature.lat, feature.lng);
    if (!Number.isFinite(range)) continue;
    if (range > radiusMeters) continue;
    if (!best || range < best.range) best = { feature, range };
  }
  return best;
}

export function interpolateElevation(samples, lat, lng) {
  if (!Array.isArray(samples) || !samples.length) return null;
  let weightSum = 0;
  let valueSum = 0;
  for (const sample of samples) {
    const d = haversineMeters(lat, lng, sample.lat, sample.lng);
    if (d < 1) return { meters: sample.z, source: 'demo-surface' };
    const w = 1 / (d * d);
    weightSum += w;
    valueSum += w * sample.z;
  }
  if (weightSum <= 0) return null;
  return { meters: valueSum / weightSum, source: 'demo-surface' };
}
