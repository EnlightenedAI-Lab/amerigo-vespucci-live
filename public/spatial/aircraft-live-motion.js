/**
 * Client-side interpolation between real ADSB snapshots (no prediction).
 */

export const MOTION_MIN_MS = 2000;
export const MOTION_MAX_MS = 4000;

/** @type {number | null} */
let rafId = null;
/** @type {boolean} */
let running = false;
/** @type {boolean} */
let paused = false;
/** @type {import('@arcgis/core/layers/FeatureLayer').default | null} */
let activeLayer = null;

/** @type {Map<string, {
 *   graphic: object,
 *   fromLat: number,
 *   fromLon: number,
 *   toLat: number,
 *   toLon: number,
 *   startMs: number,
 *   durationMs: number,
 *   PointCtor: Function
 * }>} */
const tracks = new Map();

function haversineMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = (v) => v * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function computeDurationMs(fromLat, fromLon, toLat, toLon) {
  const distance = haversineMeters(fromLat, fromLon, toLat, toLon);
  if (distance < 5) return MOTION_MIN_MS;
  const scaled = MOTION_MIN_MS + (distance / 2000) * 1000;
  return Math.min(MOTION_MAX_MS, Math.max(MOTION_MIN_MS, scaled));
}

function bindVisibilityPause() {
  if (typeof document === 'undefined' || document.__iqaiAircraftMotionPauseBound) return;
  document.__iqaiAircraftMotionPauseBound = true;
  document.addEventListener('visibilitychange', () => {
    paused = document.hidden;
    if (!paused && tracks.size && !running) {
      running = true;
      rafId = requestAnimationFrame(step);
    }
  });
}

function step(now) {
  if (!running || !activeLayer) {
    rafId = null;
    return;
  }
  if (paused) {
    rafId = requestAnimationFrame(step);
    return;
  }

  let anyActive = false;
  for (const [id, track] of tracks) {
    const elapsed = now - track.startMs;
    const t = Math.min(1, elapsed / track.durationMs);
    const lat = track.fromLat + (track.toLat - track.fromLat) * t;
    const lon = track.fromLon + (track.toLon - track.fromLon) * t;
    track.graphic.geometry = new track.PointCtor({
      longitude: lon,
      latitude: lat,
      spatialReference: { wkid: 4326 }
    });
    if (t < 1) anyActive = true;
    else tracks.delete(id);
  }

  if (anyActive) {
    rafId = requestAnimationFrame(step);
  } else {
    running = false;
    rafId = null;
  }
}

/**
 * Animate graphics from current displayed positions toward new snapshot coordinates.
 * @param {import('@arcgis/core/layers/FeatureLayer').default} layer
 * @param {object[]} objects
 * @param {Function} PointCtor
 */
export function queueAircraftMotion(layer, objects, PointCtor) {
  if (!layer || !PointCtor) return;
  bindVisibilityPause();
  activeLayer = layer;

  const objectById = new Map();
  for (const object of objects || []) {
    const id = String(object?.liveObjectId || '').trim();
    if (id) objectById.set(id, object);
  }

  for (const id of tracks.keys()) {
    if (!objectById.has(id)) tracks.delete(id);
  }

  const items = layer.source?.items || layer.source || [];
  for (const graphic of items) {
    const id = String(graphic.attributes?.liveObjectId || '').trim();
    const object = objectById.get(id);
    if (!object) continue;

    const targetLat = object.latitude;
    const targetLon = object.longitude;
    if (!Number.isFinite(targetLat) || !Number.isFinite(targetLon)) continue;

    const curLat = graphic.geometry?.latitude;
    const curLon = graphic.geometry?.longitude;
    if (!Number.isFinite(curLat) || !Number.isFinite(curLon)) continue;

    if (Math.abs(curLat - targetLat) < 1e-7 && Math.abs(curLon - targetLon) < 1e-7) {
      tracks.delete(id);
      continue;
    }

    const fromLat = curLat;
    const fromLon = curLon;

    tracks.set(id, {
      graphic,
      fromLat,
      fromLon,
      toLat: targetLat,
      toLon: targetLon,
      startMs: performance.now(),
      durationMs: computeDurationMs(fromLat, fromLon, targetLat, targetLon),
      PointCtor
    });
  }

  if (tracks.size && !running) {
    running = true;
    rafId = requestAnimationFrame(step);
  }
}

export function stopAircraftMotion() {
  running = false;
  paused = false;
  if (rafId != null) {
    cancelAnimationFrame(rafId);
    rafId = null;
  }
  tracks.clear();
  activeLayer = null;
}

export function isAircraftMotionActive() {
  return running || tracks.size > 0;
}
