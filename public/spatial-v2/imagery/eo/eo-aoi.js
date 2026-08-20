/** Operator AOI helpers. Never invent a city-wide default. */

export const MAX_AOI_SPAN_DEG = 0.08;
export const MIN_AOI_SPAN_DEG = 0.00035;
export const PIN_NEIGHBORHOOD_M = 250;

/** Original EO mixed-proof box. Pre-drawn on the map. Analysis still waits for ANALYZE. */
export const DEFAULT_PROOF_AOI = Object.freeze({
  id: 'DEFAULT_MONTREAL',
  label: 'DEFAULT AREA',
  bbox: Object.freeze([-73.575, 45.498, -73.548, 45.515])
});

export function sortBbox(bbox) {
  if (!Array.isArray(bbox) || bbox.length !== 4) return null;
  const nums = bbox.map(Number);
  if (!nums.every(Number.isFinite)) return null;
  const west = Math.min(nums[0], nums[2]);
  const south = Math.min(nums[1], nums[3]);
  const east = Math.max(nums[0], nums[2]);
  const north = Math.max(nums[1], nums[3]);
  if (east === west || north === south) return null;
  return [west, south, east, north];
}

export function validateAoi(bbox) {
  const sorted = sortBbox(bbox);
  if (!sorted) {
    return { ok: false, error: 'AOI is required. Draw a box or choose selection / current view.' };
  }
  const spanX = sorted[2] - sorted[0];
  const spanY = sorted[3] - sorted[1];
  if (spanX < MIN_AOI_SPAN_DEG || spanY < MIN_AOI_SPAN_DEG) {
    return { ok: false, error: 'AOI is too small to analyze.' };
  }
  if (spanX > MAX_AOI_SPAN_DEG || spanY > MAX_AOI_SPAN_DEG) {
    return { ok: false, error: 'AOI is too large. Zoom in or draw a smaller box. Remote sensing does not run over all Montréal.' };
  }
  return { ok: true, bbox: sorted };
}

export function bboxAroundPoint(longitude, latitude, meters = PIN_NEIGHBORHOOD_M) {
  const lon = Number(longitude);
  const lat = Number(latitude);
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
  const dLat = meters / 111320;
  const dLon = meters / (111320 * Math.cos((lat * Math.PI) / 180) || 1);
  return sortBbox([lon - dLon, lat - dLat, lon + dLon, lat + dLat]);
}

export function bboxFromRings(rings) {
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  for (const ring of rings || []) {
    for (const vertex of ring || []) {
      const x = Number(Array.isArray(vertex) ? vertex[0] : vertex?.x ?? vertex?.longitude);
      const y = Number(Array.isArray(vertex) ? vertex[1] : vertex?.y ?? vertex?.latitude);
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      if (x < west) west = x;
      if (y < south) south = y;
      if (x > east) east = x;
      if (y > north) north = y;
    }
  }
  return sortBbox([west, south, east, north]);
}

export function formatAoiLabel(bbox) {
  const sorted = sortBbox(bbox);
  if (!sorted) return 'AOI NOT SET';
  const widthM = haversineM(sorted[0], (sorted[1] + sorted[3]) / 2, sorted[2], (sorted[1] + sorted[3]) / 2);
  const heightM = haversineM((sorted[0] + sorted[2]) / 2, sorted[1], (sorted[0] + sorted[2]) / 2, sorted[3]);
  return `${formatMeters(widthM)} × ${formatMeters(heightM)}`;
}

function haversineM(lon1, lat1, lon2, lat2) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371008.8 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function formatMeters(meters) {
  if (!Number.isFinite(meters)) return 'UNKNOWN';
  if (meters >= 1000) return `${(meters / 1000).toFixed(2)} km`;
  return `${Math.round(meters)} m`;
}
