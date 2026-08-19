/**
 * Precision spatial cursor: live formats on move, dwell geocode/elevation.
 * Does not reverse-geocode on every pointer-move. World State remains focus authority.
 */

import { describeCoordinates } from './coordinate-formats.js';
import { reverseGeocodeFocus } from './spatial-focus.js';

const DWELL_MS = 450;
const CACHE_DECIMALS = 4;
const ELEVATION_URL = 'https://elevation3d.arcgis.com/arcgis/rest/services/WorldElevation3D/Terrain3D/ImageServer/identify';

const cache = new Map();
let dwellTimer = null;
let lastKey = '';

function cacheKey(latitude, longitude) {
  return `${Number(latitude).toFixed(CACHE_DECIMALS)},${Number(longitude).toFixed(CACHE_DECIMALS)}`;
}

async function fetchElevationMeters(longitude, latitude) {
  const params = new URLSearchParams({
    f: 'json',
    geometry: JSON.stringify({ x: longitude, y: latitude, spatialReference: { wkid: 4326 } }),
    geometryType: 'esriGeometryPoint',
    returnGeometry: 'false'
  });
  try {
    const response = await fetch(`${ELEVATION_URL}?${params}`, { signal: AbortSignal.timeout(6000) });
    const data = await response.json().catch(() => ({}));
    const value = Number(data?.value);
    return Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

export function liveCursorReadout(latitude, longitude) {
  return describeCoordinates(latitude, longitude);
}

export function cancelCursorDwell() {
  if (dwellTimer) {
    clearTimeout(dwellTimer);
    dwellTimer = null;
  }
}

export function scheduleCursorDwell(longitude, latitude, onResolved) {
  const key = cacheKey(latitude, longitude);
  if (cache.has(key)) {
    onResolved?.(cache.get(key));
    return;
  }
  if (key === lastKey && dwellTimer) return;
  lastKey = key;
  cancelCursorDwell();
  dwellTimer = setTimeout(async () => {
    dwellTimer = null;
    const [place, elevationMeters] = await Promise.all([
      reverseGeocodeFocus(longitude, latitude),
      fetchElevationMeters(longitude, latitude)
    ]);
    const resolved = describeCoordinates(latitude, longitude, {
      place: place?.ok ? place.resolvedAddress : null,
      elevationMeters
    });
    if (resolved) cache.set(key, resolved);
    onResolved?.(resolved);
  }, DWELL_MS);
}

export const CURSOR_DWELL_MS = DWELL_MS;
