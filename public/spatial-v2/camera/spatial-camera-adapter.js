/**
 * camera.query-relevant — typed read-only Camera federation seam.
 * Reads Spatial authored cameras plus qualified donor records.
 * Does not write WorldState.cameras.
 * Does not mint coordinates. Does not use viewport / Google 3D / Street pano as truth.
 */

import {
  GEOMETRY_KIND,
  SCHEMA_IDS,
  TRUTH_CLASS,
  createId,
  failClosed,
  isFocusRef,
  isObjectRef,
  objectRefKey
} from '../foundation/contracts/index.js';
import {
  getHydrantRecord,
  HYDRANT_INVENTORY_POSITION_LABEL,
  HYDRANT_KIND,
  HYDRANT_NAMESPACE
} from '../map/woa/hydrant-object.js';
import { listAuthoredCameras } from '../map/authored-cameras.js';
import { createCameraRef, isCameraRef } from './camera-ref.js';
import {
  listDonorFederatedCameras,
  donorPopulationEmptyReason,
  NO_QUALIFIED_PERSISTENT_CAMERA_POPULATION
} from './donor-population.js';
import {
  evaluateIncidentRelevance
} from './engine/incident-relevance.js';
import {
  CAMERA_POPULATION_SOURCE,
  CAMERA_QUERY_CAPABILITY,
  DEFAULT_QUERY_RADIUS_M,
  PLAN_GEOMETRY_HONESTY,
  RELEVANCE_FILTER,
  RELEVANCE_SORT,
  VISIBILITY_NOT_TESTED_LABEL,
  resolveQueryRadiusM
} from './engine/relevance-constants.js';

const listeners = new Set();
let lastSnapshot = emptySnapshot({ reason: 'NO_QUERY' });

function emptySnapshot(extra = {}) {
  const donorCount = extra.donorQualifiedCount ?? listDonorFederatedCameras().length;
  const cameraCount = extra.cameraCount ?? 0;
  const emptyReason = extra.emptyReason
    || extra.reason
    || (cameraCount === 0 && donorCount === 0
      ? NO_QUALIFIED_PERSISTENT_CAMERA_POPULATION
      : 'NO AUTHORED CAMERAS IN QUERY AREA');
  return Object.freeze({
    capabilityId: CAMERA_QUERY_CAPABILITY,
    radiusM: extra.radiusM ?? DEFAULT_QUERY_RADIUS_M,
    filter: extra.filter || RELEVANCE_FILTER.ALL,
    sort: extra.sort || RELEVANCE_SORT.DISTANCE,
    cameraPopulationSource: CAMERA_POPULATION_SOURCE,
    cameraCount,
    donorQualifiedCount: donorCount,
    donorEmptyReason: extra.donorEmptyReason ?? donorPopulationEmptyReason(),
    relevantCount: 0,
    target: extra.target || null,
    results: Object.freeze([]),
    relevant: Object.freeze([]),
    honesty: PLAN_GEOMETRY_HONESTY,
    visibilityTested: false,
    observationClaim: false,
    worldStateCamerasWritten: false,
    empty: true,
    emptyReason,
    selectionCleared: false
  });
}

function listQueryCameras(options = {}) {
  if (Array.isArray(options.cameras)) return options.cameras;
  const merged = [];
  const seen = new Set();
  for (const camera of [...listDonorFederatedCameras(), ...listAuthoredCameras()]) {
    const id = camera?.cameraId;
    if (!id || seen.has(id)) continue;
    seen.add(id);
    merged.push(camera);
  }
  return merged;
}

function emit(snapshot) {
  lastSnapshot = snapshot;
  for (const listener of listeners) {
    try { listener(snapshot); } catch (error) {
      console.warn('[IQAI CAMERA] query listener failed', error);
    }
  }
  return snapshot;
}

function primaryObjectRef(selection) {
  const refs = Array.isArray(selection?.objectRefs) ? selection.objectRefs : [];
  const primaryId = selection?.primaryObjectRefId || null;
  if (!refs.length) return null;
  return refs.find((ref) => objectRefKey(ref) === primaryId) || refs[0] || null;
}

function pointFromFocusRef(focusRef) {
  if (!isFocusRef(focusRef)) return null;
  if (focusRef.geometry?.kind !== GEOMETRY_KIND.POINT) return null;
  const longitude = Number(focusRef.geometry?.coordinates?.[0]);
  const latitude = Number(focusRef.geometry?.coordinates?.[1]);
  if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) return null;
  return Object.freeze({
    longitude,
    latitude,
    source: 'FOCUS_POINT',
    focusId: focusRef.focusId || null,
    coordinateSource: 'FocusRef POINT'
  });
}

function pointFromObjectRef(objectRef) {
  if (!isObjectRef(objectRef)) return null;
  if (objectRef.namespace === HYDRANT_NAMESPACE && objectRef.kind === HYDRANT_KIND) {
    const record = getHydrantRecord(objectRef.id);
    const longitude = Number(record?.longitude);
    const latitude = Number(record?.latitude);
    if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) {
      return Object.freeze({
        missing: true,
        reason: 'NO_REMEMBERED_COORDINATES',
        objectRef,
        coordinateSource: HYDRANT_INVENTORY_POSITION_LABEL
      });
    }
    return Object.freeze({
      longitude,
      latitude,
      source: 'OBJECT_REMEMBERED',
      objectRef,
      objectId: objectRef.id,
      coordinateSource: record.coordinateSource || HYDRANT_INVENTORY_POSITION_LABEL
    });
  }
  return Object.freeze({
    missing: true,
    reason: 'NO_REMEMBERED_COORDINATES',
    objectRef
  });
}

function compactReason(item) {
  if (item?.fovIntersects) return 'FOV INTERSECTS';
  if (item?.headingToward) return 'HEADING TOWARD TARGET';
  if (item?.nearby) return 'NEARBY';
  return null;
}

function enrichResult(item, index) {
  const cameraRef = createCameraRef(item?.cameraRef);
  const ordinal = String(index + 1).padStart(2, '0');
  return Object.freeze({
    ...item,
    cameraRef,
    cameraId: cameraRef?.cameraId || item?.cameraRef || null,
    displayLabel: `CAMERA ${ordinal}`,
    compactReason: compactReason(item),
    visibilityTested: false,
    observationClaim: false
  });
}

function resultOf({ idFactory, resultType, truthClass }) {
  return {
    result: {
      resultId: createId('result', idFactory),
      resultType,
      truthClass: truthClass || TRUTH_CLASS.CALCULATED,
      statePatch: null,
      receiptRef: null
    }
  };
}

export function resolveCameraQueryTarget({ focusRef, objectRef } = {}) {
  const fromObject = objectRef ? pointFromObjectRef(objectRef) : null;
  if (fromObject && !fromObject.missing) return fromObject;
  const fromFocus = pointFromFocusRef(focusRef);
  if (fromFocus) return fromFocus;
  if (fromObject?.missing) return fromObject;
  return null;
}

export function queryRelevantCameras(input = {}, options = {}) {
  const radiusM = resolveQueryRadiusM(input.radiusM ?? options.radiusM);
  const filter = Object.values(RELEVANCE_FILTER).includes(input.filter) ? input.filter : RELEVANCE_FILTER.ALL;
  const sort = Object.values(RELEVANCE_SORT).includes(input.sort) ? input.sort : RELEVANCE_SORT.DISTANCE;
  const cameras = listQueryCameras(options);
  const donorQualifiedCount = listDonorFederatedCameras().length;
  const target = resolveCameraQueryTarget({
    focusRef: input.focusRef,
    objectRef: input.objectRef
  });

  if (!target || target.missing) {
    return emit(emptySnapshot({
      radiusM,
      filter,
      sort,
      cameraCount: cameras.length,
      donorQualifiedCount,
      target,
      reason: target?.missing
        ? 'NO REMEMBERED OBJECT COORDINATES'
        : 'NO FOCUS OR SELECTED OBJECT TARGET',
      emptyReason: cameras.length
        ? (target?.missing ? 'NO REMEMBERED OBJECT COORDINATES' : 'NO FOCUS OR SELECTED OBJECT TARGET')
        : NO_QUALIFIED_PERSISTENT_CAMERA_POPULATION
    }));
  }

  const evaluated = evaluateIncidentRelevance(cameras, { point: target }, {
    radiusM,
    filter,
    sort
  });
  const results = Object.freeze(evaluated.results.map((item, index) => enrichResult(item, index)));
  const relevant = Object.freeze(results.filter((item) => item.relevant));
  const empty = cameras.length === 0;
  return emit(Object.freeze({
    capabilityId: CAMERA_QUERY_CAPABILITY,
    radiusM,
    filter: evaluated.filter,
    sort: evaluated.sort,
    cameraPopulationSource: CAMERA_POPULATION_SOURCE,
    cameraCount: cameras.length,
    donorQualifiedCount,
    donorEmptyReason: donorPopulationEmptyReason(),
    relevantCount: relevant.length,
    target,
    results,
    relevant,
    honesty: evaluated.honesty || PLAN_GEOMETRY_HONESTY,
    limitation: evaluated.limitation || VISIBILITY_NOT_TESTED_LABEL,
    visibilityTested: false,
    observationClaim: false,
    worldStateCamerasWritten: false,
    empty,
    emptyReason: empty ? NO_QUALIFIED_PERSISTENT_CAMERA_POPULATION : null,
    selectionCleared: false
  }));
}

export function getLastCameraQuerySnapshot() {
  return lastSnapshot;
}

export function subscribeCameraQuery(listener) {
  if (typeof listener !== 'function') return () => {};
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function resetCameraQuerySnapshot() {
  return emit(emptySnapshot({ reason: 'NO_QUERY' }));
}

export function bindCameraQueryAdapter({ capabilityRegistry, idFactory } = {}) {
  if (!capabilityRegistry || typeof capabilityRegistry.bindAdapter !== 'function') {
    failClosed('ADAPTER_REGISTRY_REQUIRED', 'Camera query adapter requires the public capability registry.');
  }
  capabilityRegistry.bindAdapter(CAMERA_QUERY_CAPABILITY, '1.0.0', {
    execute(action, { world }) {
      const input = action.input || {};
      const objectRef = isObjectRef(input.objectRef)
        ? input.objectRef
        : (input.objectRef == null ? primaryObjectRef(world?.selection) : null);
      const focusRef = isFocusRef(input.focusRef)
        ? input.focusRef
        : (input.focusRef == null ? world?.activeFocus : null);
      if (objectRef && cameraRefIsNotAllowed(objectRef)) {
        failClosed('CAMERA_REF_NOT_OBJECT_REF', 'CameraRef cannot enter Spatial ObjectRef query identity.', {
          schemaId: objectRef.schemaId || null
        });
      }
      queryRelevantCameras({
        focusRef,
        objectRef,
        radiusM: input.radiusM,
        filter: input.filter,
        sort: input.sort
      });
      return resultOf({
        idFactory,
        resultType: 'camera-relevance',
        truthClass: TRUTH_CLASS.CALCULATED
      });
    }
  });
  return { getLastCameraQuerySnapshot, queryRelevantCameras };
}

function cameraRefIsNotAllowed(value) {
  return isCameraRef(value) || (value && value.authority === 'iqai.camera' && value.schemaId !== SCHEMA_IDS.OBJECT_REF);
}
