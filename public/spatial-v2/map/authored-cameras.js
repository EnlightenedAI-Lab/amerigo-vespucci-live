/**
 * Operator-authored cameras for PLACE CAMERA.
 * Local planned-camera inventory. Not WorldState.cameras (view retention).
 * Not Google 3D visual camera. Not Building_Montreal / LOS / roof snap.
 * Not installed CCTV. Not Camera Discovery. Not an external sensor registry.
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
  'Planned. Not installed.',
  'Local operator-authored persistence only.',
  'Not WorldState.cameras.',
  'Not Google 3D visual camera.',
  'Z unknown unless independently known.',
  'FOV wedge is camera orientation / field-of-view direction, not LOS.',
  'Not police camera inventory. Not Camera Discovery. Not an external sensor registry.'
].join(' ');

export const DEFAULT_AUTHORED_CAMERA = Object.freeze({
  heading: 0,
  pitch: 0,
  roll: 0,
  heightAboveGround: 3,
  horizontalFov: 60
});

export const PLANNING_STATE = Object.freeze({
  PLANNED: 'PLANNED'
});

export const PLANNING_QUALIFICATION = 'PLANNED_NOT_INSTALLED';
export const PLANNING_LABEL = 'PLANNED · NOT INSTALLED';
export const PERSISTENCE_KIND = 'LOCAL_OPERATOR_AUTHORED';
export const PLANNED_INVENTORY_SCHEMA_ID = 'iqai.camera.planned-inventory/1.0.0';
export const PLANNED_INVENTORY_SCHEMA_VERSION = '1.0.0';
export const PLANNED_INVENTORY_STORAGE_KEY = 'iqai-v2-planned-camera-inventory-v1';

const listeners = new Set();
const cameras = new Map();
let activeCameraId = null;
let persistConfig = {
  storage: null,
  enabled: true
};
let lastPersistenceError = null;
let hydrating = false;

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

function resolveStorage() {
  if (persistConfig.storage) return persistConfig.storage;
  try {
    if (typeof localStorage !== 'undefined' && localStorage) return localStorage;
  } catch {
    return null;
  }
  return null;
}

function knownOptics(value) {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
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
  const modelId = camera.modelId ? String(camera.modelId) : null;
  const resolutionWidth = knownOptics(camera.resolutionWidth ?? camera.resolution?.width);
  const resolutionHeight = knownOptics(camera.resolutionHeight ?? camera.resolution?.height);
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
    modelId,
    resolution: resolutionWidth
      ? Object.freeze({
        width: resolutionWidth,
        height: resolutionHeight
      })
      : null,
    resolutionWidth: resolutionWidth,
    resolutionHeight: resolutionHeight,
    planningState: PLANNING_STATE.PLANNED,
    planned: true,
    installed: false,
    qualification: PLANNING_QUALIFICATION,
    planningLabel: PLANNING_LABEL,
    persistenceKind: PERSISTENCE_KIND,
    source: pose.source,
    provenance: pose.provenance,
    updatedAt: pose.createdAt,
    schemaId: pose.schemaId,
    schemaVersion: pose.schemaVersion,
    pose
  });
}

function serializeCamera(camera) {
  return {
    cameraId: camera.cameraId,
    poseId: camera.poseId,
    longitude: camera.longitude,
    latitude: camera.latitude,
    z: camera.z,
    heightAboveGround: camera.heightAboveGround,
    heading: camera.heading,
    pitch: camera.pitch,
    roll: camera.roll,
    horizontalFov: camera.horizontalFov,
    verticalFov: camera.verticalFov,
    modelId: camera.modelId || null,
    resolutionWidth: camera.resolutionWidth || null,
    resolutionHeight: camera.resolutionHeight || null,
    planningState: PLANNING_STATE.PLANNED,
    planned: true,
    installed: false,
    qualification: PLANNING_QUALIFICATION,
    planningLabel: PLANNING_LABEL,
    provenance: camera.provenance,
    schemaId: camera.schemaId,
    schemaVersion: camera.schemaVersion,
    updatedAt: camera.updatedAt
  };
}

function persistNow() {
  if (!persistConfig.enabled || hydrating) return { ok: true, skipped: true };
  const storage = resolveStorage();
  if (!storage || typeof storage.setItem !== 'function') return { ok: true, skipped: true };
  try {
    const envelope = {
      schemaId: PLANNED_INVENTORY_SCHEMA_ID,
      schemaVersion: PLANNED_INVENTORY_SCHEMA_VERSION,
      persistenceKind: PERSISTENCE_KIND,
      qualification: PLANNING_QUALIFICATION,
      honesty: [
        'LOCAL OPERATOR-AUTHORED PLANNED CAMERA INVENTORY.',
        'Not installed cameras.',
        'Not police CCTV.',
        'Not Camera Discovery.',
        'Not an authoritative external sensor registry.'
      ].join(' '),
      activeCameraId,
      savedAt: new Date().toISOString(),
      cameras: listAuthoredCameras().map(serializeCamera)
    };
    storage.setItem(PLANNED_INVENTORY_STORAGE_KEY, JSON.stringify(envelope));
    lastPersistenceError = null;
    return { ok: true };
  } catch (error) {
    lastPersistenceError = Object.freeze({
      code: 'PERSIST_FAILED',
      message: String(error?.message || error)
    });
    return { ok: false, error: lastPersistenceError };
  }
}

function parseInventoryEnvelope(raw) {
  if (raw == null || raw === '') {
    return { ok: true, cameras: [], activeCameraId: null, empty: true };
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {
      ok: false,
      error: Object.freeze({
        code: 'CORRUPT_PERSISTENCE',
        message: 'Planned camera inventory JSON is unreadable.'
      })
    };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return {
      ok: false,
      error: Object.freeze({
        code: 'CORRUPT_PERSISTENCE',
        message: 'Planned camera inventory envelope is not an object.'
      })
    };
  }
  if (parsed.schemaId !== PLANNED_INVENTORY_SCHEMA_ID) {
    return {
      ok: false,
      error: Object.freeze({
        code: 'SCHEMA_MISMATCH',
        message: 'Planned camera inventory schema is unsupported.',
        schemaId: parsed.schemaId || null
      })
    };
  }
  if (parsed.schemaVersion !== PLANNED_INVENTORY_SCHEMA_VERSION) {
    return {
      ok: false,
      error: Object.freeze({
        code: 'SCHEMA_VERSION_MISMATCH',
        message: 'Planned camera inventory version is unsupported. No implicit migration.',
        schemaVersion: parsed.schemaVersion || null
      })
    };
  }
  if (!Array.isArray(parsed.cameras)) {
    return {
      ok: false,
      error: Object.freeze({
        code: 'CORRUPT_PERSISTENCE',
        message: 'Planned camera inventory cameras must be an array.'
      })
    };
  }
  const camerasToLoad = [];
  for (const record of parsed.cameras) {
    if (!record || typeof record !== 'object') continue;
    const cameraId = String(record.cameraId || '').trim();
    const longitude = Number(record.longitude);
    const latitude = Number(record.latitude);
    if (!cameraId || !Number.isFinite(longitude) || !Number.isFinite(latitude)) continue;
    camerasToLoad.push({
      ...record,
      cameraId,
      longitude,
      latitude,
      planningState: PLANNING_STATE.PLANNED,
      planned: true,
      installed: false
    });
  }
  return {
    ok: true,
    cameras: camerasToLoad,
    activeCameraId: parsed.activeCameraId ? String(parsed.activeCameraId) : null
  };
}

function writeCamera(input, { activate = true, persist = true } = {}) {
  const cameraId = String(input.cameraId || createId('camera'));
  const existing = cameras.get(cameraId);
  const next = {
    cameraId,
    poseId: existing?.poseId || input.poseId || `sensor-pose-${cameraId}`,
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
    modelId: Object.prototype.hasOwnProperty.call(input, 'modelId')
      ? input.modelId
      : (existing?.modelId ?? null),
    resolutionWidth: Object.prototype.hasOwnProperty.call(input, 'resolutionWidth')
      ? input.resolutionWidth
      : (existing?.resolutionWidth ?? null),
    resolutionHeight: Object.prototype.hasOwnProperty.call(input, 'resolutionHeight')
      ? input.resolutionHeight
      : (existing?.resolutionHeight ?? null),
    provenance: AUTHORED_CAMERA_PROVENANCE,
    updatedAt: input.updatedAt || new Date().toISOString()
  };
  if (!Number.isFinite(next.longitude) || !Number.isFinite(next.latitude)) {
    throw new Error('Authored camera requires finite longitude and latitude.');
  }
  const frozen = freezeCamera(next);
  cameras.set(cameraId, frozen);
  if (activate) activeCameraId = cameraId;
  if (persist) persistNow();
  if (!hydrating) emit();
  return frozen;
}

export function placeAuthoredCamera(input = {}, options = {}) {
  return writeCamera(input, { activate: options.activate !== false, persist: options.persist !== false });
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
    persistNow();
    emit();
    return getActiveAuthoredCamera();
  }
  activeCameraId = cameraId;
  persistNow();
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
  persistNow();
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
    ownership: 'LOCAL_OPERATOR_AUTHORED_PLANNED_CAMERA',
    persistenceKind: PERSISTENCE_KIND,
    planningQualification: PLANNING_LABEL,
    worldStateCameras: false,
    google3dCamera: false,
    persistenceError: lastPersistenceError
  });
}

export function subscribeAuthoredCameras(listener) {
  if (typeof listener !== 'function') return () => {};
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function configureAuthoredCameraPersistence(options = {}) {
  if (Object.prototype.hasOwnProperty.call(options, 'storage')) {
    persistConfig.storage = options.storage || null;
  }
  if (options.enabled != null) persistConfig.enabled = Boolean(options.enabled);
  return Object.freeze({
    enabled: persistConfig.enabled,
    hasStorage: Boolean(resolveStorage())
  });
}

export function getAuthoredCameraPersistenceError() {
  return lastPersistenceError;
}

export function readAuthoredCameraPersistence() {
  const storage = resolveStorage();
  if (!storage || typeof storage.getItem !== 'function') {
    return { ok: true, cameras: [], activeCameraId: null, empty: true, unavailable: true };
  }
  try {
    return parseInventoryEnvelope(storage.getItem(PLANNED_INVENTORY_STORAGE_KEY));
  } catch (error) {
    return {
      ok: false,
      error: Object.freeze({
        code: 'CORRUPT_PERSISTENCE',
        message: String(error?.message || error)
      })
    };
  }
}

export function hydrateAuthoredCameras() {
  lastPersistenceError = null;
  const loaded = readAuthoredCameraPersistence();
  if (!loaded.ok) {
    lastPersistenceError = loaded.error;
    cameras.clear();
    activeCameraId = null;
    emit();
    return getAuthoredCamerasSnapshot();
  }
  hydrating = true;
  cameras.clear();
  activeCameraId = null;
  try {
    for (const record of loaded.cameras || []) {
      writeCamera(record, { activate: false, persist: false });
    }
    if (loaded.activeCameraId && cameras.has(loaded.activeCameraId)) {
      activeCameraId = loaded.activeCameraId;
    } else {
      activeCameraId = cameras.size ? Array.from(cameras.keys()).at(-1) : null;
    }
  } finally {
    hydrating = false;
  }
  emit();
  return getAuthoredCamerasSnapshot();
}

export function resetAuthoredCameras(options = {}) {
  cameras.clear();
  activeCameraId = null;
  lastPersistenceError = null;
  if (options.persist !== false) persistNow();
  emit();
  return getAuthoredCamerasSnapshot();
}
