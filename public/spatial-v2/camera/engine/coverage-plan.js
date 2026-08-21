/**
 * Balanced 2D camera coverage proposal around FocusRef POINT.
 * Planning candidates only. Not installation siting. Not LOS.
 * Reuses authored-cameras store. Does not invent CameraModel specs.
 */

import { VIEW_ID, createDropPinFocusRef } from '../../foundation/contracts/index.js';
import { createCameraRef } from '../camera-ref.js';
import {
  CREATION_MODE,
  deleteAuthoredCamera,
  listAuthoredCameras,
  placeAuthoredCamera,
  resetAuthoredCameras
} from '../../map/authored-cameras.js';
import { destinationAlongHeading, geodesicMeters, headingFromPoints, wrapHeading } from './geodesy.js';
import { pointInHorizontalFov, targetBearingDeg, headingDeltaToPoint } from './incident-relevance.js';
import { PIXEL_DENSITY_UNKNOWN, DESIGN_BAND_UNKNOWN } from './dori.js';
import { HEAVY_VIEWER_LIMIT } from './view-slot.js';
import {
  COVERAGE_INTENT_VERSION,
  FOUR_DIRECTION_HONESTY,
  ORIENTATION_INTENT,
  PERIMETER_HONESTY,
  POINT_HONESTY,
  TARGET_GEOMETRY,
  FOUR_DIRECTION_SPACING,
  PERIMETER_SPACING,
  POINT_SPACING,
  closePolygonRing,
  polygonCentroid,
  proposeFourDirectionCoverage,
  proposePerimeterCoverage,
  resetCoverageIntent
} from './coverage-intent.js';

export const COVERAGE_PLAN_ALGORITHM = 'iqai.camera.balanced-2d-coverage/1.0.0';
export const COVERAGE_PLAN_VERSION = '1.0.0';
export const COVERAGE_CAMERA_COUNT = 3;
export const COVERAGE_STANDOFF_M = 48;
export const COVERAGE_PLACEMENT_AZIMUTHS_DEG = Object.freeze([0, 120, 240]);
export const PLAN_VIEW_HFOV = 70;
export const PITCH_UNQUALIFIED = 'UNQUALIFIED';
export const VERTICAL_AIM_NOT_QUALIFIED = 'VERTICAL AIM NOT QUALIFIED';
export const CAMERA_MODEL_UNKNOWN = 'CAMERA MODEL UNKNOWN';
export const OPTICAL_ZOOM_UNQUALIFIED = 'OPTICAL ZOOM UNQUALIFIED';
export const AUTO_PLAN_LABEL = 'PLANNED · NOT INSTALLED · AUTO-PLANNED';
export const COVERAGE_HONESTY = [
  '2D CANDIDATE PLACEMENT',
  'NOT INSTALLATION SITING',
  'NOT LOS',
  'VISIBILITY NOT TESTED'
].join(' · ');

let lastPlan = null;

export function focusPointFromFocusRef(focus = null) {
  if (!focus) return null;
  const longitude = Number(focus.longitude ?? focus.geometry?.coordinates?.[0]);
  const latitude = Number(focus.latitude ?? focus.geometry?.coordinates?.[1]);
  if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) return null;
  const kind = String(focus.geometry?.kind || focus.geometry?.type || 'POINT').toUpperCase();
  if (kind && kind !== 'POINT') return null;
  return Object.freeze({
    longitude,
    latitude,
    focusId: focus.focusId || null,
    sourceType: focus.sourceType || focus.source || null
  });
}

export function coveragePlanIdForTarget(target) {
  return `coverage-v1:${Number(target.longitude).toFixed(6)},${Number(target.latitude).toFixed(6)}`;
}

function coveragePlanIdForIntent(pattern, orientation, target, ring) {
  if (pattern === TARGET_GEOMETRY.FOUR_DIRECTION && target) {
    return `coverage-v1:four-direction:${orientation}:${Number(target.longitude).toFixed(6)},${Number(target.latitude).toFixed(6)}`;
  }
  if (pattern === TARGET_GEOMETRY.PERIMETER && ring) {
    const key = ring.slice(0, -1).map((point) => `${Number(point.longitude).toFixed(5)},${Number(point.latitude).toFixed(5)}`).join(';');
    return `coverage-v1:perimeter:${orientation}:${key.slice(0, 72)}`;
  }
  return coveragePlanIdForTarget(target);
}

function resolveIntent(options = {}) {
  const snapshot = options.intent || options;
  const rawPattern = snapshot.pattern || snapshot.targetGeometry || TARGET_GEOMETRY.POINT;
  const pattern = Object.values(TARGET_GEOMETRY).includes(rawPattern) ? rawPattern : TARGET_GEOMETRY.POINT;
  const orientation = pattern === TARGET_GEOMETRY.POINT
    ? ORIENTATION_INTENT.INWARD
    : (snapshot.orientationIntent || snapshot.orientation || ORIENTATION_INTENT.INWARD);
  return {
    pattern,
    orientation: orientation === ORIENTATION_INTENT.OUTWARD ? ORIENTATION_INTENT.OUTWARD : ORIENTATION_INTENT.INWARD,
    polygon: snapshot.polygon || null
  };
}

export function autoPlanCameraId(index) {
  return `camera-autoplan-${String(index + 1).padStart(2, '0')}`;
}

export function proposeBalancedCoverage(target, options = {}) {
  const standoff = Number(options.standoffM) > 0 ? Number(options.standoffM) : COVERAGE_STANDOFF_M;
  const hfov = Number(options.horizontalFov) > 0 ? Number(options.horizontalFov) : PLAN_VIEW_HFOV;
  return Object.freeze(COVERAGE_PLACEMENT_AZIMUTHS_DEG.map((azimuth, index) => {
    const pose = destinationAlongHeading(target, azimuth, standoff);
    const heading = wrapHeading(headingFromPoints(pose, target));
    const distanceM = geodesicMeters(pose, target);
    const delta = headingDeltaToPoint(heading, targetBearingDeg(pose, target));
    return Object.freeze({
      index,
      cameraId: autoPlanCameraId(index),
      azimuthDeg: azimuth,
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
  }));
}

export function listAutoPlanCameras(planId = null) {
  return listAuthoredCameras().filter((camera) => {
    if (camera.creationMode !== CREATION_MODE.AUTO_PLAN) return false;
    if (!planId) return true;
    return camera.planId === planId;
  });
}

export function coverageTargetPoint(value) {
  if (!value) return null;
  const longitude = Number(value.longitude ?? value.geometry?.coordinates?.[0]);
  const latitude = Number(value.latitude ?? value.geometry?.coordinates?.[1]);
  if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) return null;
  return Object.freeze({ longitude, latitude });
}

export function rememberedCoverageTarget() {
  for (const camera of listAutoPlanCameras()) {
    const point = coverageTargetPoint(camera?.targetFocus);
    if (!point) continue;
    const ring = closePolygonRing(camera.targetFocus?.ring || camera.targetRing || null);
    return Object.freeze({
      ...point,
      planId: camera.planId || null,
      cameraId: camera.cameraId || null,
      pattern: camera.coveragePattern || TARGET_GEOMETRY.POINT,
      orientation: camera.coverageOrientation || ORIENTATION_INTENT.INWARD,
      geometryKind: ring ? 'POLYGON' : 'POINT',
      ring,
      operatorAdjusted: camera.operatorAdjusted === true
    });
  }
  return null;
}

export function rememberedCoverageFocusRef() {
  const target = rememberedCoverageTarget();
  if (!target) return null;
  return createDropPinFocusRef({
    longitude: target.longitude,
    latitude: target.latitude,
    sourceView: VIEW_ID.MAP
  });
}

export function clearGeneratedPlan(planId = lastPlan?.planId) {
  const removed = [];
  for (const camera of listAutoPlanCameras(planId)) {
    removed.push(camera.cameraId);
    deleteAuthoredCamera(camera.cameraId);
  }
  if (lastPlan && (!planId || lastPlan.planId === planId)) lastPlan = null;
  return Object.freeze({
    ok: true,
    removedCount: removed.length,
    removedCameraIds: Object.freeze(removed),
    remaining: Object.freeze(listAuthoredCameras().map((item) => item.cameraId))
  });
}

export function clearAllCameras() {
  const removed = listAuthoredCameras().map((item) => item.cameraId);
  resetAuthoredCameras({ persist: true });
  lastPlan = null;
  resetCoverageIntent({ emit: true });
  return Object.freeze({
    ok: true,
    removedCount: removed.length,
    removedCameraIds: Object.freeze(removed),
    remaining: Object.freeze([])
  });
}

export function generateCameraCoverage(focusRef, options = {}) {
  const intent = resolveIntent(options);
  let target = focusPointFromFocusRef(focusRef);
  let ring = closePolygonRing(intent.polygon);
  let proposals;
  let honesty = COVERAGE_HONESTY;
  let algorithm = COVERAGE_PLAN_ALGORITHM;
  let pattern = TARGET_GEOMETRY.POINT;
  let orientation = ORIENTATION_INTENT.INWARD;

  if (intent.pattern === TARGET_GEOMETRY.PERIMETER) {
    ring = closePolygonRing(intent.polygon);
    target = polygonCentroid(ring);
    if (!target || !ring) {
      return Object.freeze({
        ok: false,
        reason: 'POLYGON_TARGET_REQUIRED',
        cameras: [],
        visibilityTested: false,
        observationClaim: false
      });
    }
    proposals = proposePerimeterCoverage(ring, { ...options, orientation: intent.orientation });
    honesty = PERIMETER_HONESTY;
    algorithm = 'iqai.camera.perimeter-2d/1.0.0';
    pattern = TARGET_GEOMETRY.PERIMETER;
    orientation = intent.orientation;
  } else if (intent.pattern === TARGET_GEOMETRY.FOUR_DIRECTION) {
    if (!target) {
      return Object.freeze({
        ok: false,
        reason: 'FOCUSREF_POINT_REQUIRED',
        cameras: [],
        visibilityTested: false,
        observationClaim: false
      });
    }
    proposals = proposeFourDirectionCoverage(target, { ...options, orientation: intent.orientation });
    honesty = FOUR_DIRECTION_HONESTY;
    algorithm = 'iqai.camera.four-direction-2d/1.0.0';
    pattern = TARGET_GEOMETRY.FOUR_DIRECTION;
    orientation = intent.orientation;
  } else if (!target) {
    return Object.freeze({
      ok: false,
      reason: 'FOCUSREF_POINT_REQUIRED',
      cameras: [],
      visibilityTested: false,
      observationClaim: false
    });
  } else {
    proposals = proposeBalancedCoverage(target, options);
    honesty = POINT_HONESTY;
    pattern = TARGET_GEOMETRY.POINT;
    orientation = ORIENTATION_INTENT.INWARD;
  }

  const replaced = listAutoPlanCameras().map((item) => item.cameraId);
  for (const cameraId of replaced) deleteAuthoredCamera(cameraId);

  const planId = coveragePlanIdForIntent(pattern, orientation, target, ring);
  const generatedAt = options.now || new Date().toISOString();
  const targetFocus = Object.freeze({
    ...target,
    geometryKind: ring ? 'POLYGON' : 'POINT',
    ring: ring || null
  });
  const cameras = proposals.map((proposal) => placeAuthoredCamera({
    cameraId: proposal.cameraId,
    longitude: proposal.longitude,
    latitude: proposal.latitude,
    heading: proposal.heading,
    pitch: 0,
    heightAboveGround: 3,
    horizontalFov: proposal.horizontalFov,
    modelId: null,
    resolutionWidth: null,
    resolutionHeight: null,
    creationMode: CREATION_MODE.AUTO_PLAN,
    planId,
    planVersion: COVERAGE_PLAN_VERSION,
    planningAlgorithm: algorithm,
    generatedAt,
    pitchQualification: PITCH_UNQUALIFIED,
    opticalZoomQualification: OPTICAL_ZOOM_UNQUALIFIED,
    cameraModelQualification: CAMERA_MODEL_UNKNOWN,
    planningLabel: AUTO_PLAN_LABEL,
    operatorAdjusted: false,
    coveragePattern: pattern,
    coverageOrientation: orientation,
    targetRing: ring,
    targetFocus
  }, { activate: proposal.index === 0 }));

  lastPlan = Object.freeze({
    ok: true,
    reason: null,
    planId,
    algorithm,
    version: COVERAGE_PLAN_VERSION,
    generatedAt,
    target,
    polygon: ring,
    coverageIntent: Object.freeze({
      targetGeometry: pattern,
      pattern,
      orientationIntent: orientation,
      cameraCount: cameras.length,
      spacing: pattern === TARGET_GEOMETRY.FOUR_DIRECTION
        ? FOUR_DIRECTION_SPACING
        : (pattern === TARGET_GEOMETRY.PERIMETER ? PERIMETER_SPACING : POINT_SPACING),
      planVersion: COVERAGE_INTENT_VERSION
    }),
    standoffM: COVERAGE_STANDOFF_M,
    planViewHfov: PLAN_VIEW_HFOV,
    cameraCount: cameras.length,
    replacedCameraIds: Object.freeze(replaced),
    cameras: Object.freeze(cameras),
    cameraRefs: Object.freeze(cameras.map((camera) => createCameraRef(camera.cameraId))),
    honesty,
    pitchQualification: PITCH_UNQUALIFIED,
    verticalAim: VERTICAL_AIM_NOT_QUALIFIED,
    cameraModelQualification: CAMERA_MODEL_UNKNOWN,
    opticalZoomQualification: OPTICAL_ZOOM_UNQUALIFIED,
    pixelDensity: PIXEL_DENSITY_UNKNOWN,
    designBand: DESIGN_BAND_UNKNOWN,
    visibilityTested: false,
    observationClaim: false,
    mutatesSelectionSet: false,
    maxHeavyViewers: HEAVY_VIEWER_LIMIT,
    operatorAdjusted: false,
    planStatus: 'GENERATED'
  });
  return lastPlan;
}

export function getLastCoveragePlan() {
  if (!lastPlan) return null;
  const adjusted = listAutoPlanCameras(lastPlan.planId).some((camera) => camera.operatorAdjusted === true);
  if (!adjusted) return lastPlan;
  return Object.freeze({
    ...lastPlan,
    operatorAdjusted: true,
    planStatus: 'OPERATOR ADJUSTED'
  });
}

export function resetCoveragePlanState() {
  lastPlan = null;
  resetCoverageIntent({ emit: false });
}
