/**
 * Operator-authored cameras for PLACE CAMERA.
 * Session overlay only. Not WorldState.cameras (view retention).
 * Not Google 3D visual camera. Not Building_Montreal / LOS / roof snap.
 */

import {
  SENSOR_POSE_SOURCE,
  createId,
  createSensorPose,
  validateSensorPose
} from '../foundation/contracts/index.js';

export const AUTHORED_CAMERA_SOURCE = 'OPERATOR_AUTHORED';
export const AUTHORED_CAMERA_PROVENANCE = [
  'Operator-authored camera pose.',
  'Not WorldState.cameras.',
  'Not Google 3D visual camera.',
  'Z unknown unless independently known.',
  'FOV wedge is camera orientation / field-of-view direction, not LOS.'
].join(' ');

export const DEFAULT_AUTHORED_CAMERA = Object.freeze({
  heading: 0,
  pitch: 0,
  roll: 0,
  heightAboveGround: 3,
  horizontalFov: 60
});

const listeners = new Set();
const cameras = new Map();
let activeCameraId = null;

function wrapHeading(value) {
  const heading = Number(value);
  if (!Number.isFinite(heading)) return DEFAULT_AUTHORED_CAMERA.heading;
  return ((heading % 360) + 360) % 360;
}

function knownFinite(value, fallback = null) {
  if (value == null || value === '') return fallback;
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value, min, max, fallback) {
  const number = knownFinite(value);
  if (number == null) return fallback;
  return Math.min(max, Math.max(min, number));
}

export function verticalFovFromHorizontal(horizontalFov, aspect = 16 / 9) {
  const h = Number(horizontalFov) * Math.PI / 180;
  if (!Number.isFinite(h) || aspect <= 0) return null;
  return (2 * Math.atan(Math.tan(h / 2) / aspect)) * 180 / Math.PI;
}

export function frustumRangeMeters(heightAboveGround) {
  return clamp(40 + Number(heightAboveGround || 0) * 4, 40, 120, 70);
}

function emit() {
  const snapshot = getAuthoredCamerasSnapshot();
  for (const listener of listeners) {
    try {
      listener(snapshot);
    } catch (error) {
      console.warn('[IQAI V2] authored camera listener failed', error);
    }
  }
}

export function sensorPoseFromAuthoredCamera(camera, options = {}) {
  if (!camera) return null;
  const longitude = Number(camera.longitude);
  const latitude = Number(camera.latitude);
  const horizontalFov = clamp(camera.horizontalFov, 10, 120, DEFAULT_AUTHORED_CAMERA.horizontalFov);
  const verticalFov = knownFinite(camera.verticalFov, verticalFovFromHorizontal(horizontalFov));
  return createSensorPose({
    poseId: camera.poseId,
    cameraId: camera.cameraId,
    x: longitude,
    y: latitude,
    z: knownFinite(camera.z),
    longitude,
    latitude,
    heading: wrapHeading(camera.heading),
    pitch: clamp(camera.pitch, -90, 90, DEFAULT_AUTHORED_CAMERA.pitch),
    roll: clamp(camera.roll, -180, 180, DEFAULT_AUTHORED_CAMERA.roll),
    heightAboveGround: clamp(camera.heightAboveGround, 0.5, 200, DEFAULT_AUTHORED_CAMERA.heightAboveGround),
    horizontalFov,
    verticalFov,
    crs: { horizontalCrsId: 'EPSG:4326', verticalUnits: 'meters' },
    source: SENSOR_POSE_SOURCE.OPERATOR_AUTHORED,
    provenance: camera.provenance || AUTHORED_CAMERA_PROVENANCE,
    createdAt: camera.updatedAt
  }, options);
}

function freezeCamera(camera) {
  const pose = sensorPoseFromAuthoredCamera(camera);
  return Object.freeze({
    cameraId: camera.cameraId,
    poseId: pose.poseId,
    longitude: pose.longitude,
    latitude: pose.latitude,
    z: pose.z,
    zKnown: pose.z != null,
    heightAboveGround: pose.heightAboveGround,
    heading: pose.heading,
    pitch: pose.pitch,
    roll: pose.roll,
    horizontalFov: pose.horizontalFov,
    verticalFov: pose.verticalFov,
    source: pose.source,
    provenance: pose.provenance,
    updatedAt: pose.createdAt,
    schemaId: pose.schemaId,
    schemaVersion: pose.schemaVersion,
    pose
  });
}

function writeCamera(input, { activate = true } = {}) {
  const cameraId = String(input.cameraId || createId('camera'));
  const existing = cameras.get(cameraId);
  const next = {
    cameraId,
    poseId: existing?.poseId || `sensor-pose-${cameraId}`,
    longitude: Number(input.longitude),
    latitude: Number(input.latitude),
    z: knownFinite(input.z),
    heightAboveGround: input.heightAboveGround ?? existing?.heightAboveGround ?? DEFAULT_AUTHORED_CAMERA.heightAboveGround,
    heading: input.heading ?? existing?.heading ?? DEFAULT_AUTHORED_CAMERA.heading,
    pitch: input.pitch ?? existing?.pitch ?? DEFAULT_AUTHORED_CAMERA.pitch,
    roll: input.roll ?? existing?.roll ?? DEFAULT_AUTHORED_CAMERA.roll,
    horizontalFov: input.horizontalFov ?? existing?.horizontalFov ?? DEFAULT_AUTHORED_CAMERA.horizontalFov,
    verticalFov: Object.prototype.hasOwnProperty.call(input, 'verticalFov')
      ? input.verticalFov
      : (existing?.verticalFov ?? null),
    provenance: AUTHORED_CAMERA_PROVENANCE,
    updatedAt: input.updatedAt || new Date().toISOString()
  };
  if (!Number.isFinite(next.longitude) || !Number.isFinite(next.latitude)) {
    throw new Error('Authored camera requires finite longitude and latitude.');
  }
  const frozen = freezeCamera(next);
  cameras.set(cameraId, frozen);
  if (activate) activeCameraId = cameraId;
  emit();
  return frozen;
}

export function placeAuthoredCamera(input = {}, options = {}) {
  return writeCamera(input, { activate: options.activate !== false });
}

export function updateAuthoredCamera(cameraId, fields = {}) {
  const current = cameras.get(cameraId);
  if (!current) return null;
  return writeCamera({ ...current, ...fields, cameraId }, { activate: true });
}

export function selectAuthoredCamera(cameraId) {
  if (!cameraId || !cameras.has(cameraId)) {
    activeCameraId = cameraId ? null : activeCameraId;
    if (!cameraId) activeCameraId = null;
    emit();
    return getActiveAuthoredCamera();
  }
  activeCameraId = cameraId;
  emit();
  return getActiveAuthoredCamera();
}

export function deleteAuthoredCamera(cameraId) {
  const id = cameraId || activeCameraId;
  if (!id || !cameras.has(id)) return getAuthoredCamerasSnapshot();
  cameras.delete(id);
  if (activeCameraId === id) {
    activeCameraId = cameras.size ? Array.from(cameras.keys()).at(-1) : null;
  }
  emit();
  return getAuthoredCamerasSnapshot();
}

export function getAuthoredCamera(cameraId) {
  return cameras.get(cameraId) || null;
}

export function getActiveAuthoredCamera() {
  return activeCameraId ? cameras.get(activeCameraId) || null : null;
}

export function getActiveAuthoredSensorPose() {
  const camera = getActiveAuthoredCamera();
  return camera ? validateSensorPose(camera.pose) : null;
}

export function listAuthoredCameras() {
  return Array.from(cameras.values());
}

export function getAuthoredCamerasSnapshot() {
  const items = listAuthoredCameras();
  const active = getActiveAuthoredCamera();
  return Object.freeze({
    count: items.length,
    activeCameraId,
    cameras: items,
    active: active || null,
    sensorPose: active?.pose || null,
    ownership: 'SESSION_AUTHORED_CAMERA',
    worldStateCameras: false,
    google3dCamera: false
  });
}

export function subscribeAuthoredCameras(listener) {
  if (typeof listener !== 'function') return () => {};
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function resetAuthoredCameras() {
  cameras.clear();
  activeCameraId = null;
  emit();
  return getAuthoredCamerasSnapshot();
}
