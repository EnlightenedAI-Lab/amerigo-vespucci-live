/**
 * Balanced 2D camera coverage proposal around FocusRef POINT.
 * Planning candidates only. Not installation siting. Not LOS.
 * Reuses authored-cameras store. Does not invent CameraModel specs.
 */

import { createCameraRef } from '../camera-ref.js';
import {
  CREATION_MODE,
  deleteAuthoredCamera,
  listAuthoredCameras,
  placeAuthoredCamera
} from '../../map/authored-cameras.js';
import { destinationAlongHeading, geodesicMeters, headingFromPoints, wrapHeading } from './geodesy.js';
import { pointInHorizontalFov, targetBearingDeg, headingDeltaToPoint } from './incident-relevance.js';
import { PIXEL_DENSITY_UNKNOWN, DESIGN_BAND_UNKNOWN } from './dori.js';
import { HEAVY_VIEWER_LIMIT } from './view-slot.js';

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

export function generateCameraCoverage(focusRef, options = {}) {
  const target = focusPointFromFocusRef(focusRef);
  if (!target) {
    return Object.freeze({
      ok: false,
      reason: 'FOCUSREF_POINT_REQUIRED',
      cameras: [],
      visibilityTested: false,
      observationClaim: false
    });
  }
  const replaced = listAutoPlanCameras().map((item) => item.cameraId);
  for (const cameraId of replaced) deleteAuthoredCamera(cameraId);

  const planId = coveragePlanIdForTarget(target);
  const generatedAt = options.now || new Date().toISOString();
  const proposals = proposeBalancedCoverage(target, options);
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
    planningAlgorithm: COVERAGE_PLAN_ALGORITHM,
    generatedAt,
    pitchQualification: PITCH_UNQUALIFIED,
    opticalZoomQualification: OPTICAL_ZOOM_UNQUALIFIED,
    cameraModelQualification: CAMERA_MODEL_UNKNOWN,
    planningLabel: AUTO_PLAN_LABEL,
    targetFocus: target
  }, { activate: proposal.index === 0 }));

  lastPlan = Object.freeze({
    ok: true,
    reason: null,
    planId,
    algorithm: COVERAGE_PLAN_ALGORITHM,
    version: COVERAGE_PLAN_VERSION,
    generatedAt,
    target,
    standoffM: COVERAGE_STANDOFF_M,
    planViewHfov: PLAN_VIEW_HFOV,
    cameraCount: cameras.length,
    replacedCameraIds: Object.freeze(replaced),
    cameras: Object.freeze(cameras),
    cameraRefs: Object.freeze(cameras.map((camera) => createCameraRef(camera.cameraId))),
    honesty: COVERAGE_HONESTY,
    pitchQualification: PITCH_UNQUALIFIED,
    verticalAim: VERTICAL_AIM_NOT_QUALIFIED,
    cameraModelQualification: CAMERA_MODEL_UNKNOWN,
    opticalZoomQualification: OPTICAL_ZOOM_UNQUALIFIED,
    pixelDensity: PIXEL_DENSITY_UNKNOWN,
    designBand: DESIGN_BAND_UNKNOWN,
    visibilityTested: false,
    observationClaim: false,
    mutatesSelectionSet: false,
    maxHeavyViewers: HEAVY_VIEWER_LIMIT
  });
  return lastPlan;
}

export function getLastCoveragePlan() {
  return lastPlan;
}

export function resetCoveragePlanState() {
  lastPlan = null;
}
