/**
 * Operator-selectable coverage patterns for planned cameras.
 * Geometric candidates only. Not LOS. Not road-network aware. Not installation siting.
 * Writes into the existing authored planned-camera store. No second inventory.
 */

import { destinationAlongHeading, geodesicMeters, headingFromPoints, wrapHeading } from './geodesy.js';
import { pointInHorizontalFov, targetBearingDeg, headingDeltaToPoint } from './incident-relevance.js';
import { PIXEL_DENSITY_UNKNOWN, DESIGN_BAND_UNKNOWN } from './dori.js';

const POINT_CAMERA_COUNT = 3;
const PLAN_VIEW_HFOV = 70;
const STANDOFF_M = 48;
const PITCH_UNQUALIFIED = 'UNQUALIFIED';
const CAMERA_MODEL_UNKNOWN = 'CAMERA MODEL UNKNOWN';
const OPTICAL_ZOOM_UNQUALIFIED = 'OPTICAL ZOOM UNQUALIFIED';

function autoPlanCameraId(index) {
  return `camera-autoplan-${String(index + 1).padStart(2, '0')}`;
}

export const COVERAGE_INTENT_VERSION = 'coverage-intent/1.0.0';

export const TARGET_GEOMETRY = Object.freeze({
  POINT: 'POINT',
  FOUR_DIRECTION: 'FOUR_DIRECTION',
  PERIMETER: 'PERIMETER'
});

export const COVERAGE_PATTERN = TARGET_GEOMETRY;

export const ORIENTATION_INTENT = Object.freeze({
  INWARD: 'INWARD',
  OUTWARD: 'OUTWARD'
});

export const FOUR_DIRECTION_AZIMUTHS_DEG = Object.freeze([0, 90, 180, 270]);
export const FOUR_DIRECTION_CAMERA_COUNT = 4;
export const PERIMETER_CAMERA_COUNT = 4;
export const FOUR_DIRECTION_SPACING = 'EQUAL_AZIMUTH_90';
export const POINT_SPACING = 'EQUAL_AZIMUTH_120';
export const PERIMETER_SPACING = 'QUARTER_PERIMETER_PATH';

export const POINT_HONESTY = [
  '3-CAMERA POINT PLAN',
  'PLANNED · NOT INSTALLED',
  '2D CANDIDATE PLACEMENT',
  'NOT LOS',
  'NOT INSTALLATION SITING'
].join(' · ');

export const FOUR_DIRECTION_HONESTY = [
  'FOUR-DIRECTION GEOMETRIC PLAN',
  'NOT ROAD-NETWORK AWARE',
  '2D CANDIDATE PLACEMENT',
  'NOT INSTALLATION SITING',
  'NOT LOS'
].join(' · ');

export const PERIMETER_HONESTY = [
  'GEOMETRIC PERIMETER CAMERA PLAN',
  'NOT INSTALLATION SITING',
  'NOT LOS',
  'NOT TERRAIN OPTIMIZED',
  'NOT ROAD-AWARE'
].join(' · ');

const listeners = new Set();

let pattern = TARGET_GEOMETRY.POINT;
let orientation = ORIENTATION_INTENT.INWARD;
let vertices = [];
let drawing = false;

function emit() {
  const snapshot = getCoverageIntentSnapshot();
  for (const listener of listeners) {
    try { listener(snapshot); } catch { /* ignore */ }
  }
}

export function headingDeltaAbs(a, b) {
  const delta = Math.abs(wrapHeading(Number(a) - Number(b)));
  return Math.min(delta, 360 - delta);
}

export function cameraLooksInward(camera, target) {
  if (!camera || !target) return false;
  const expected = wrapHeading(headingFromPoints(camera, target));
  return headingDeltaAbs(camera.heading, expected) <= 2;
}

export function cameraLooksOutward(camera, target) {
  if (!camera || !target) return false;
  const expected = wrapHeading(headingFromPoints(camera, target) + 180);
  return headingDeltaAbs(camera.heading, expected) <= 2;
}

export function sectorFromTarget(target, camera) {
  const azimuth = wrapHeading(headingFromPoints(target, camera));
  if (azimuth >= 315 || azimuth < 45) return 'N';
  if (azimuth >= 45 && azimuth < 135) return 'E';
  if (azimuth >= 135 && azimuth < 225) return 'S';
  return 'W';
}

export function closePolygonRing(points = []) {
  const clean = (Array.isArray(points) ? points : [])
    .map((point) => ({
      longitude: Number(point?.longitude),
      latitude: Number(point?.latitude)
    }))
    .filter((point) => Number.isFinite(point.longitude) && Number.isFinite(point.latitude));
  if (clean.length < 3) return null;
  const first = clean[0];
  const last = clean[clean.length - 1];
  const closed = geodesicMeters(first, last) < 0.75 ? clean : [...clean, first];
  return Object.freeze(closed.map((point) => Object.freeze(point)));
}

export function polygonCentroid(ring) {
  const closed = closePolygonRing(ring);
  if (!closed) return null;
  const verts = closed.slice(0, closed.length - 1);
  let longitude = 0;
  let latitude = 0;
  for (const point of verts) {
    longitude += point.longitude;
    latitude += point.latitude;
  }
  return Object.freeze({
    longitude: longitude / verts.length,
    latitude: latitude / verts.length
  });
}

export function polygonPathLength(ring) {
  const closed = closePolygonRing(ring);
  if (!closed) return null;
  const segs = [];
  let total = 0;
  for (let i = 0; i < closed.length - 1; i += 1) {
    const length = geodesicMeters(closed[i], closed[i + 1]) || 0;
    segs.push(Object.freeze({
      a: closed[i],
      b: closed[i + 1],
      length,
      start: total
    }));
    total += length;
  }
  return Object.freeze({ total, segs: Object.freeze(segs), ring: closed });
}

export function pointAlongPolygonPath(ring, distanceM) {
  const path = polygonPathLength(ring);
  if (!path || !(path.total > 0)) return null;
  let remain = ((Number(distanceM) % path.total) + path.total) % path.total;
  for (const seg of path.segs) {
    if (remain <= seg.length || seg === path.segs[path.segs.length - 1]) {
      const heading = headingFromPoints(seg.a, seg.b);
      const along = Math.min(seg.length, remain);
      return destinationAlongHeading(seg.a, heading, along);
    }
    remain -= seg.length;
  }
  return path.ring[0];
}

export function distanceToPolygonPath(point, ring) {
  const path = polygonPathLength(ring);
  if (!path) return null;
  let best = Infinity;
  for (const seg of path.segs) {
    const samples = Math.max(2, Math.ceil(seg.length / 4));
    for (let i = 0; i <= samples; i += 1) {
      const heading = headingFromPoints(seg.a, seg.b);
      const sample = destinationAlongHeading(seg.a, heading, (seg.length * i) / samples);
      const meters = geodesicMeters(point, sample);
      if (Number.isFinite(meters) && meters < best) best = meters;
    }
  }
  return best;
}

function qualifyProposal(index, pose, aimAt, hfov) {
  const heading = wrapHeading(headingFromPoints(pose, aimAt));
  const distanceM = geodesicMeters(pose, aimAt);
  const delta = headingDeltaToPoint(heading, targetBearingDeg(pose, aimAt));
  return Object.freeze({
    index,
    cameraId: autoPlanCameraId(index),
    azimuthDeg: wrapHeading(headingFromPoints(aimAt, pose)),
    longitude: pose.longitude,
    latitude: pose.latitude,
    heading,
    pitch: 0,
    pitchQualification: PITCH_UNQUALIFIED,
    horizontalFov: hfov,
    distanceM,
    fovIntersects: pointInHorizontalFov(delta, hfov),
    cameraModelQualification: CAMERA_MODEL_UNKNOWN,
    opticalZoomQualification: OPTICAL_ZOOM_UNQUALIFIED,
    pixelDensity: PIXEL_DENSITY_UNKNOWN,
    designBand: DESIGN_BAND_UNKNOWN
  });
}

function applyOrientation(proposal, target, orientationIntent) {
  if (orientationIntent !== ORIENTATION_INTENT.OUTWARD) return proposal;
  const heading = wrapHeading(proposal.heading + 180);
  return Object.freeze({
    ...proposal,
    heading,
    fovIntersects: false
  });
}

export function proposeFourDirectionCoverage(target, options = {}) {
  const standoff = Number(options.standoffM) > 0 ? Number(options.standoffM) : STANDOFF_M;
  const hfov = Number(options.horizontalFov) > 0 ? Number(options.horizontalFov) : PLAN_VIEW_HFOV;
  const orientationIntent = options.orientation === ORIENTATION_INTENT.OUTWARD
    ? ORIENTATION_INTENT.OUTWARD
    : ORIENTATION_INTENT.INWARD;
  return Object.freeze(FOUR_DIRECTION_AZIMUTHS_DEG.map((azimuth, index) => {
    const pose = destinationAlongHeading(target, azimuth, standoff);
    return applyOrientation(qualifyProposal(index, pose, target, hfov), target, orientationIntent);
  }));
}

export function proposePerimeterCoverage(ring, options = {}) {
  const closed = closePolygonRing(ring);
  const centroid = polygonCentroid(closed);
  const path = polygonPathLength(closed);
  if (!centroid || !path || !(path.total > 0)) return Object.freeze([]);
  const hfov = Number(options.horizontalFov) > 0 ? Number(options.horizontalFov) : PLAN_VIEW_HFOV;
  const orientationIntent = options.orientation === ORIENTATION_INTENT.OUTWARD
    ? ORIENTATION_INTENT.OUTWARD
    : ORIENTATION_INTENT.INWARD;
  return Object.freeze(Array.from({ length: PERIMETER_CAMERA_COUNT }, (_, index) => {
    const pose = pointAlongPolygonPath(closed, (path.total * index) / PERIMETER_CAMERA_COUNT);
    return applyOrientation(qualifyProposal(index, pose, centroid, hfov), centroid, orientationIntent);
  }));
}

export function expectedCameraCount(nextPattern = pattern) {
  if (nextPattern === TARGET_GEOMETRY.FOUR_DIRECTION) return FOUR_DIRECTION_CAMERA_COUNT;
  if (nextPattern === TARGET_GEOMETRY.PERIMETER) return PERIMETER_CAMERA_COUNT;
  return POINT_CAMERA_COUNT;
}

export function honestyForPattern(nextPattern = pattern) {
  if (nextPattern === TARGET_GEOMETRY.FOUR_DIRECTION) return FOUR_DIRECTION_HONESTY;
  if (nextPattern === TARGET_GEOMETRY.PERIMETER) return PERIMETER_HONESTY;
  return POINT_HONESTY;
}

export function coverageSummaryLabel(intent = getCoverageIntentSnapshot()) {
  const look = intent.orientationIntent === ORIENTATION_INTENT.OUTWARD ? 'OUTWARD' : 'INWARD';
  if (intent.pattern === TARGET_GEOMETRY.FOUR_DIRECTION) {
    return `FOUR-DIRECTION · ${intent.cameraCount} CAMERAS · ${look}`;
  }
  if (intent.pattern === TARGET_GEOMETRY.PERIMETER) {
    return `PERIMETER · ${intent.cameraCount} CAMERAS · ${look}`;
  }
  return `POINT COVERAGE · ${POINT_CAMERA_COUNT} CAMERAS · INWARD`;
}

export function getCoverageIntentSnapshot() {
  const closed = closePolygonRing(vertices);
  return Object.freeze({
    targetGeometry: pattern,
    pattern,
    orientationIntent: pattern === TARGET_GEOMETRY.POINT ? ORIENTATION_INTENT.INWARD : orientation,
    cameraCount: expectedCameraCount(pattern),
    spacing: pattern === TARGET_GEOMETRY.FOUR_DIRECTION
      ? FOUR_DIRECTION_SPACING
      : (pattern === TARGET_GEOMETRY.PERIMETER ? PERIMETER_SPACING : POINT_SPACING),
    planVersion: COVERAGE_INTENT_VERSION,
    polygon: closed,
    vertices: Object.freeze(vertices.map((point) => Object.freeze({ ...point }))),
    vertexCount: vertices.length,
    drawing: drawing && pattern === TARGET_GEOMETRY.PERIMETER,
    honesty: honestyForPattern(pattern)
  });
}

export function setCoveragePattern(next) {
  const value = Object.values(TARGET_GEOMETRY).includes(next) ? next : TARGET_GEOMETRY.POINT;
  pattern = value;
  if (pattern === TARGET_GEOMETRY.POINT) orientation = ORIENTATION_INTENT.INWARD;
  drawing = pattern === TARGET_GEOMETRY.PERIMETER;
  emit();
  return getCoverageIntentSnapshot();
}

export function setCoverageOrientation(next) {
  if (pattern === TARGET_GEOMETRY.POINT) {
    orientation = ORIENTATION_INTENT.INWARD;
    emit();
    return getCoverageIntentSnapshot();
  }
  orientation = next === ORIENTATION_INTENT.OUTWARD
    ? ORIENTATION_INTENT.OUTWARD
    : ORIENTATION_INTENT.INWARD;
  emit();
  return getCoverageIntentSnapshot();
}

export function addCoveragePolygonVertex(point) {
  const longitude = Number(point?.longitude);
  const latitude = Number(point?.latitude);
  if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) return getCoverageIntentSnapshot();
  vertices = [...vertices, Object.freeze({ longitude, latitude })];
  drawing = true;
  emit();
  return getCoverageIntentSnapshot();
}

export function undoCoveragePolygonVertex() {
  vertices = vertices.slice(0, -1);
  emit();
  return getCoverageIntentSnapshot();
}

export function closeCoveragePolygon() {
  const closed = closePolygonRing(vertices);
  if (!closed) return getCoverageIntentSnapshot();
  vertices = closed.slice(0, closed.length - 1);
  drawing = false;
  emit();
  return getCoverageIntentSnapshot();
}

export function clearCoveragePolygon() {
  vertices = [];
  drawing = pattern === TARGET_GEOMETRY.PERIMETER;
  emit();
  return getCoverageIntentSnapshot();
}

export function setCoveragePolygon(points) {
  vertices = (Array.isArray(points) ? points : [])
    .map((point) => Object.freeze({
      longitude: Number(point.longitude),
      latitude: Number(point.latitude)
    }))
    .filter((point) => Number.isFinite(point.longitude) && Number.isFinite(point.latitude));
  drawing = false;
  emit();
  return getCoverageIntentSnapshot();
}

export function resetCoverageIntent({ emit: shouldEmit = true } = {}) {
  pattern = TARGET_GEOMETRY.POINT;
  orientation = ORIENTATION_INTENT.INWARD;
  vertices = [];
  drawing = false;
  if (shouldEmit) emit();
  return getCoverageIntentSnapshot();
}

export function subscribeCoverageIntent(listener) {
  if (typeof listener !== 'function') return () => {};
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function operatorPatternLabel(nextPattern = pattern) {
  if (nextPattern === TARGET_GEOMETRY.FOUR_DIRECTION) return 'FOUR SIDES';
  if (nextPattern === TARGET_GEOMETRY.PERIMETER) return 'PERIMETER';
  return 'POINT';
}
