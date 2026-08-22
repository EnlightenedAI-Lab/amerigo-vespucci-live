/**
 * Accepted Camera donor population adapter.
 * Federates only qualified persistent georeferenced Camera records.
 * Does not invent cameras, optics, heading, or resolution.
 * Does not load session lab seeds, fixtures, or provider views.
 */

import { createCameraRef } from './camera-ref.js';

export const DONOR_RECORD_CLASS = Object.freeze({
  AUTHORED_CAMERA: 'AUTHORED_CAMERA',
  PLANNED_CAMERA: 'PLANNED_CAMERA',
  INSTALLED_KNOWN: 'INSTALLED_KNOWN',
  PROVIDER_VIEW: 'PROVIDER_VIEW',
  FIXTURE_TEST_ONLY: 'FIXTURE_TEST_ONLY',
  SESSION_ONLY: 'SESSION_ONLY',
  UNKNOWN: 'UNKNOWN'
});

export const PLANNING_STATE = Object.freeze({
  AUTHORED_NOT_INSTALLED: 'AUTHORED_NOT_INSTALLED',
  PLANNED: 'PLANNED',
  SIMULATED_VIEWPOINT: 'SIMULATED_VIEWPOINT',
  INSTALLED_KNOWN: 'INSTALLED_KNOWN'
});

export const QUALIFIED_PERSISTENT_CLASSES = Object.freeze([
  DONOR_RECORD_CLASS.AUTHORED_CAMERA,
  DONOR_RECORD_CLASS.PLANNED_CAMERA,
  DONOR_RECORD_CLASS.INSTALLED_KNOWN
]);

export const NO_QUALIFIED_PERSISTENT_CAMERA_POPULATION = 'NO QUALIFIED PERSISTENT CAMERA POPULATION';

/**
 * Frozen scan of accepted Camera donor freeze eda067e.
 * Evidence: in-memory session store (ownership SESSION_AUTHORED_CAMERA),
 * lab seed buttons with generated ids, fixture scenes, and provider-view catalogs.
 * No persistent camera JSON / GeoJSON population file exists in the donor.
 */
export const DONOR_SCAN = Object.freeze({
  freeze: 'eda067efd14241ed04a677fc65ba5773aec4b4a0',
  qualifiedPersistent: 0,
  plannedPersistent: 0,
  authoredNotInstalledPersistent: 0,
  installedKnownPersistent: 0,
  excludedProviderViewRecords: 0,
  excludedProviderViewAdapters: 1,
  excludedFixtureScenes: 7,
  excludedNamedTestCameraIds: 4,
  excludedSessionPlaceCallSites: 29,
  catalogModelsNotInstances: 4,
  persistentPopulationFile: false,
  installedKnownEnumOnly: true
});

export const QUALIFIED_PERSISTENT_CAMERAS = Object.freeze([]);

function finiteCoord(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function knownOrUnknown(value) {
  if (value == null || value === '') return { value: null, known: false };
  if (typeof value === 'number' && !Number.isFinite(value)) return { value: null, known: false };
  return { value, known: true };
}

export function classifyDonorCandidate(record = {}) {
  if (!record || typeof record !== 'object') {
    return DONOR_RECORD_CLASS.UNKNOWN;
  }
  if (record.providerView === true || record.representationKind === 'PROVIDER_VIEW') {
    return DONOR_RECORD_CLASS.PROVIDER_VIEW;
  }
  if (record.fixture === true || record.class === DONOR_RECORD_CLASS.FIXTURE_TEST_ONLY) {
    return DONOR_RECORD_CLASS.FIXTURE_TEST_ONLY;
  }
  if (record.sessionOnly === true || record.persistent !== true) {
    return DONOR_RECORD_CLASS.SESSION_ONLY;
  }
  if (record.planningState === PLANNING_STATE.INSTALLED_KNOWN) {
    return DONOR_RECORD_CLASS.INSTALLED_KNOWN;
  }
  if (record.planningState === PLANNING_STATE.PLANNED) {
    return DONOR_RECORD_CLASS.PLANNED_CAMERA;
  }
  if (record.planningState === PLANNING_STATE.AUTHORED_NOT_INSTALLED) {
    return DONOR_RECORD_CLASS.AUTHORED_CAMERA;
  }
  return DONOR_RECORD_CLASS.UNKNOWN;
}

export function isQualifiedPersistentCameraRecord(record) {
  if (!record || record.persistent !== true) return false;
  if (record.fixture === true || record.sessionOnly === true || record.providerView === true) return false;
  const classified = classifyDonorCandidate(record);
  if (!QUALIFIED_PERSISTENT_CLASSES.includes(classified)) return false;
  if (!String(record.cameraId || '').trim()) return false;
  if (finiteCoord(record.longitude) == null || finiteCoord(record.latitude) == null) return false;
  return true;
}

function planningQualification(record) {
  if (record.planningState === PLANNING_STATE.PLANNED) return PLANNING_STATE.PLANNED;
  if (record.planningState === PLANNING_STATE.INSTALLED_KNOWN) return PLANNING_STATE.INSTALLED_KNOWN;
  if (record.planningState === PLANNING_STATE.AUTHORED_NOT_INSTALLED) {
    return PLANNING_STATE.AUTHORED_NOT_INSTALLED;
  }
  return null;
}

export function mapQualifiedDonorRecordToFederationCamera(record) {
  if (!isQualifiedPersistentCameraRecord(record)) return null;
  const longitude = finiteCoord(record.longitude);
  const latitude = finiteCoord(record.latitude);
  const heading = knownOrUnknown(record.heading);
  const horizontalFov = knownOrUnknown(record.horizontalFov);
  const resolutionWidth = knownOrUnknown(record.resolutionWidth);
  const modelId = knownOrUnknown(record.modelId);
  const qualification = planningQualification(record);
  const cameraId = String(record.cameraId).trim();
  const cameraRef = createCameraRef(cameraId);
  const unknown = [];
  if (!heading.known) unknown.push('heading');
  if (!horizontalFov.known) unknown.push('horizontalFov');
  if (!resolutionWidth.known) unknown.push('resolutionWidth');
  if (!modelId.known) unknown.push('modelId');
  return Object.freeze({
    cameraId,
    cameraRef,
    longitude,
    latitude,
    heading: heading.known ? Number(heading.value) : null,
    horizontalFov: horizontalFov.known ? Number(horizontalFov.value) : null,
    resolution: resolutionWidth.known
      ? Object.freeze({ width: Number(resolutionWidth.value) })
      : null,
    modelId: modelId.known ? String(modelId.value) : null,
    planningState: qualification,
    qualification,
    installed: qualification === PLANNING_STATE.INSTALLED_KNOWN,
    planned: qualification === PLANNING_STATE.PLANNED,
    provenance: Object.freeze({
      source: record.sourceFile || null,
      locationSource: record.locationSource || null,
      opticsSource: record.opticsSource || null,
      planningState: qualification,
      unknownFields: Object.freeze(unknown)
    })
  });
}

export function listDonorFederatedCameras() {
  return QUALIFIED_PERSISTENT_CAMERAS
    .map(mapQualifiedDonorRecordToFederationCamera)
    .filter(Boolean);
}

export function donorPopulationEmptyReason() {
  if (listDonorFederatedCameras().length) return null;
  return NO_QUALIFIED_PERSISTENT_CAMERA_POPULATION;
}
