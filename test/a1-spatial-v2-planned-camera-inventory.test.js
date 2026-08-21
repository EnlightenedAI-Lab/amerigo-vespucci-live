import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  VIEW_ID,
  createDropPinFocusRef,
  isObjectRef
} from '../public/spatial-v2/foundation/contracts/index.js';
import { createSpatialV2Chassis } from '../public/spatial-v2/bootstrap/spatial-v2-bootstrap.js';
import {
  PLANNING_LABEL,
  PLANNING_QUALIFICATION,
  PLANNING_STATE,
  PERSISTENCE_KIND,
  PLANNED_INVENTORY_SCHEMA_ID,
  PLANNED_INVENTORY_SCHEMA_VERSION,
  PLANNED_INVENTORY_STORAGE_KEY,
  configureAuthoredCameraPersistence,
  deleteAuthoredCamera,
  getAuthoredCameraPersistenceError,
  hydrateAuthoredCameras,
  listAuthoredCameras,
  placeAuthoredCamera,
  resetAuthoredCameras,
  updateAuthoredCamera
} from '../public/spatial-v2/map/authored-cameras.js';
import {
  CAMERA_REF_AUTHORITY,
  createCameraRef,
  isCameraRef
} from '../public/spatial-v2/camera/camera-ref.js';
import {
  getLastCameraQuerySnapshot,
  queryRelevantCameras,
  resetCameraQuerySnapshot
} from '../public/spatial-v2/camera/spatial-camera-adapter.js';
import { PIXEL_DENSITY_UNKNOWN } from '../public/spatial-v2/camera/engine/dori.js';
import { CAMERA_POPULATION_SOURCE, CAMERA_QUERY_CAPABILITY } from '../public/spatial-v2/camera/engine/relevance-constants.js';
import { destinationAlongHeading } from '../public/spatial-v2/camera/engine/geodesy.js';
import { listDonorFederatedCameras } from '../public/spatial-v2/camera/donor-population.js';
import { clearHydrantRecords } from '../public/spatial-v2/map/woa/hydrant-object.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const V2 = path.join(ROOT, 'public', 'spatial-v2');
const COMMUNE_PIN = Object.freeze({
  longitude: -73.553221995734,
  latitude: 45.494180980834
});

function createMemoryStorage(seed = {}) {
  const data = { ...seed };
  return {
    getItem(key) {
      return Object.prototype.hasOwnProperty.call(data, key) ? data[key] : null;
    },
    setItem(key, value) {
      data[key] = String(value);
    },
    removeItem(key) {
      delete data[key];
    },
    dump() {
      return { ...data };
    }
  };
}

function isolate() {
  configureAuthoredCameraPersistence({ storage: createMemoryStorage(), enabled: true });
  resetAuthoredCameras();
  resetCameraQuerySnapshot();
  clearHydrantRecords();
}

function restore() {
  resetAuthoredCameras({ persist: false });
  configureAuthoredCameraPersistence({ storage: null, enabled: true });
  resetCameraQuerySnapshot();
  clearHydrantRecords();
}

function parseStored(storage) {
  return JSON.parse(storage.getItem(PLANNED_INVENTORY_STORAGE_KEY));
}

test('1 Place Camera creates a persistent planned camera', () => {
  isolate();
  const storage = createMemoryStorage();
  configureAuthoredCameraPersistence({ storage, enabled: true });
  const camera = placeAuthoredCamera({
    longitude: COMMUNE_PIN.longitude,
    latitude: COMMUNE_PIN.latitude,
    heading: 40,
    pitch: -8,
    heightAboveGround: 6,
    horizontalFov: 70
  });
  const stored = parseStored(storage);
  assert.equal(stored.schemaId, PLANNED_INVENTORY_SCHEMA_ID);
  assert.equal(stored.schemaVersion, PLANNED_INVENTORY_SCHEMA_VERSION);
  assert.equal(stored.persistenceKind, PERSISTENCE_KIND);
  assert.equal(stored.cameras.length, 1);
  assert.equal(stored.cameras[0].cameraId, camera.cameraId);
  assert.equal(camera.planningState, PLANNING_STATE.PLANNED);
  assert.equal(camera.installed, false);
  restore();
});

test('2-8 stable identity and authored fields survive hydrate/reload', () => {
  isolate();
  const storage = createMemoryStorage();
  configureAuthoredCameraPersistence({ storage, enabled: true });
  const camera = placeAuthoredCamera({
    cameraId: 'camera-planned-stable',
    longitude: -73.553221995734,
    latitude: 45.494180980834,
    heading: 218,
    pitch: -12,
    heightAboveGround: 8.5,
    horizontalFov: 55
  });
  const beforeId = camera.cameraId;
  const beforeRef = createCameraRef(beforeId);
  resetAuthoredCameras({ persist: false });
  assert.equal(listAuthoredCameras().length, 0);
  const restored = hydrateAuthoredCameras();
  const after = restored.cameras[0];
  assert.equal(after.cameraId, beforeId);
  assert.equal(after.cameraId, 'camera-planned-stable');
  assert.equal(createCameraRef(after.cameraId).authority, CAMERA_REF_AUTHORITY);
  assert.deepEqual(createCameraRef(after.cameraId), beforeRef);
  assert.equal(after.longitude, -73.553221995734);
  assert.equal(after.latitude, 45.494180980834);
  assert.equal(after.heading, 218);
  assert.equal(after.pitch, -12);
  assert.equal(after.heightAboveGround, 8.5);
  assert.equal(after.horizontalFov, 55);
  restore();
});

test('9 planning qualification remains PLANNED / NOT INSTALLED', () => {
  isolate();
  const storage = createMemoryStorage();
  configureAuthoredCameraPersistence({ storage, enabled: true });
  placeAuthoredCamera({
    longitude: COMMUNE_PIN.longitude,
    latitude: COMMUNE_PIN.latitude,
    installed: true,
    planningState: 'INSTALLED_KNOWN'
  });
  resetAuthoredCameras({ persist: false });
  const after = hydrateAuthoredCameras().cameras[0];
  assert.equal(after.planningState, PLANNING_STATE.PLANNED);
  assert.equal(after.planned, true);
  assert.equal(after.installed, false);
  assert.equal(after.qualification, PLANNING_QUALIFICATION);
  assert.equal(after.planningLabel, PLANNING_LABEL);
  restore();
});

test('10 unknown optics remain unknown', () => {
  isolate();
  const camera = placeAuthoredCamera({
    longitude: COMMUNE_PIN.longitude,
    latitude: COMMUNE_PIN.latitude,
    heading: 10,
    horizontalFov: 60
  });
  assert.equal(camera.modelId, null);
  assert.equal(camera.resolution, null);
  assert.equal(camera.resolutionWidth, null);
  resetAuthoredCameras({ persist: false });
  const after = hydrateAuthoredCameras().cameras[0];
  assert.equal(after.modelId, null);
  assert.equal(after.resolution, null);
  const snapshot = queryRelevantCameras({
    focusRef: createDropPinFocusRef({ ...COMMUNE_PIN, sourceView: VIEW_ID.MAP })
  });
  assert.equal(snapshot.results[0].pixelDensityLabel, PIXEL_DENSITY_UNKNOWN);
  restore();
});

test('11 edit persists', () => {
  isolate();
  const storage = createMemoryStorage();
  configureAuthoredCameraPersistence({ storage, enabled: true });
  const camera = placeAuthoredCamera({
    longitude: COMMUNE_PIN.longitude,
    latitude: COMMUNE_PIN.latitude,
    heading: 10,
    pitch: 0,
    heightAboveGround: 3,
    horizontalFov: 60
  });
  updateAuthoredCamera(camera.cameraId, {
    heading: 95,
    pitch: -6,
    heightAboveGround: 12,
    horizontalFov: 40
  });
  resetAuthoredCameras({ persist: false });
  const after = hydrateAuthoredCameras().cameras[0];
  assert.equal(after.heading, 95);
  assert.equal(after.pitch, -6);
  assert.equal(after.heightAboveGround, 12);
  assert.equal(after.horizontalFov, 40);
  restore();
});

test('12 delete persists', () => {
  isolate();
  const storage = createMemoryStorage();
  configureAuthoredCameraPersistence({ storage, enabled: true });
  const keep = placeAuthoredCamera({
    cameraId: 'camera-keep',
    longitude: COMMUNE_PIN.longitude,
    latitude: COMMUNE_PIN.latitude,
    heading: 0
  });
  const gone = placeAuthoredCamera({
    cameraId: 'camera-gone',
    longitude: COMMUNE_PIN.longitude + 0.001,
    latitude: COMMUNE_PIN.latitude,
    heading: 90
  });
  deleteAuthoredCamera(gone.cameraId);
  resetAuthoredCameras({ persist: false });
  const after = hydrateAuthoredCameras();
  assert.equal(after.count, 1);
  assert.equal(after.cameras[0].cameraId, keep.cameraId);
  assert.equal(after.cameras.some((item) => item.cameraId === gone.cameraId), false);
  restore();
});

test('13 corrupt persistence fails safely', () => {
  isolate();
  const storage = createMemoryStorage({
    [PLANNED_INVENTORY_STORAGE_KEY]: '{not-json'
  });
  configureAuthoredCameraPersistence({ storage, enabled: true });
  const snapshot = hydrateAuthoredCameras();
  assert.equal(snapshot.count, 0);
  assert.equal(getAuthoredCameraPersistenceError()?.code, 'CORRUPT_PERSISTENCE');
  restore();
});

test('14 schema/version mismatch fails closed with no implicit migration', () => {
  isolate();
  const storage = createMemoryStorage({
    [PLANNED_INVENTORY_STORAGE_KEY]: JSON.stringify({
      schemaId: 'iqai.camera.planned-inventory/9.0.0',
      schemaVersion: '9.0.0',
      cameras: [{
        cameraId: 'should-not-load',
        longitude: COMMUNE_PIN.longitude,
        latitude: COMMUNE_PIN.latitude
      }]
    })
  });
  configureAuthoredCameraPersistence({ storage, enabled: true });
  const snapshot = hydrateAuthoredCameras();
  assert.equal(snapshot.count, 0);
  assert.equal(getAuthoredCameraPersistenceError()?.code, 'SCHEMA_MISMATCH');

  storage.setItem(PLANNED_INVENTORY_STORAGE_KEY, JSON.stringify({
    schemaId: PLANNED_INVENTORY_SCHEMA_ID,
    schemaVersion: '0.0.1',
    cameras: [{
      cameraId: 'still-should-not-load',
      longitude: COMMUNE_PIN.longitude,
      latitude: COMMUNE_PIN.latitude
    }]
  }));
  const version = hydrateAuthoredCameras();
  assert.equal(version.count, 0);
  assert.equal(getAuthoredCameraPersistenceError()?.code, 'SCHEMA_VERSION_MISMATCH');
  restore();
});

test('15-16 query uses the same authored camera store; no second store', () => {
  isolate();
  const camera = placeAuthoredCamera({
    longitude: COMMUNE_PIN.longitude,
    latitude: COMMUNE_PIN.latitude,
    heading: 180,
    horizontalFov: 80
  });
  const snapshot = queryRelevantCameras({
    focusRef: createDropPinFocusRef({ ...COMMUNE_PIN, sourceView: VIEW_ID.MAP })
  });
  assert.equal(snapshot.cameraPopulationSource, CAMERA_POPULATION_SOURCE);
  assert.equal(snapshot.cameraCount, listAuthoredCameras().length);
  assert.equal(snapshot.results[0].cameraId, camera.cameraId);
  assert.deepEqual(listDonorFederatedCameras(), []);
  const adapter = fs.readFileSync(path.join(V2, 'camera', 'spatial-camera-adapter.js'), 'utf8');
  const store = fs.readFileSync(path.join(V2, 'map', 'authored-cameras.js'), 'utf8');
  assert.match(adapter, /listAuthoredCameras/);
  assert.doesNotMatch(adapter, /new Map\(\)/);
  assert.match(store, /const cameras = new Map\(\)/);
  assert.equal((store.match(/new Map\(\)/g) || []).length, 1);
  restore();
});

test('17 CameraRef does not enter SelectionSet', async () => {
  isolate();
  const chassis = createSpatialV2Chassis({
    now: () => '2026-08-21T12:00:00.000Z',
    idFactory: () => 'plan-sel'
  });
  placeAuthoredCamera({
    longitude: COMMUNE_PIN.longitude,
    latitude: COMMUNE_PIN.latitude,
    heading: 0,
    horizontalFov: 60
  });
  await chassis.executeChassis(CAMERA_QUERY_CAPABILITY, {
    focusRef: createDropPinFocusRef({ ...COMMUNE_PIN, sourceView: VIEW_ID.MAP })
  });
  const world = chassis.stateStore.getSnapshot();
  assert.equal(world.selection.objectRefs.some((ref) => isCameraRef(ref)), false);
  assert.equal(world.selection.objectRefs.every((ref) => isObjectRef(ref) || ref == null), true);
  const snap = getLastCameraQuerySnapshot();
  assert.equal(isCameraRef(snap.results[0].cameraRef), true);
  restore();
});

test('18 reload returns non-empty federation', () => {
  isolate();
  const storage = createMemoryStorage();
  configureAuthoredCameraPersistence({ storage, enabled: true });
  const facing = destinationAlongHeading(COMMUNE_PIN, 0, 40);
  placeAuthoredCamera({
    ...facing,
    heading: 180,
    horizontalFov: 70,
    cameraId: 'camera-reload-a'
  });
  resetAuthoredCameras({ persist: false });
  hydrateAuthoredCameras();
  const snapshot = queryRelevantCameras({
    focusRef: createDropPinFocusRef({ ...COMMUNE_PIN, sourceView: VIEW_ID.MAP })
  });
  assert.equal(snapshot.cameraCount, 1);
  assert.equal(snapshot.empty, false);
  assert.ok(snapshot.relevantCount >= 1);
  assert.equal(snapshot.results[0].cameraId, 'camera-reload-a');
  restore();
});

test('19-20 visibility remains untested and observationClaim stays false', () => {
  isolate();
  placeAuthoredCamera({
    longitude: COMMUNE_PIN.longitude,
    latitude: COMMUNE_PIN.latitude,
    heading: 0,
    horizontalFov: 60
  });
  const snapshot = queryRelevantCameras({
    focusRef: createDropPinFocusRef({ ...COMMUNE_PIN, sourceView: VIEW_ID.MAP })
  });
  assert.equal(snapshot.visibilityTested, false);
  assert.equal(snapshot.observationClaim, false);
  assert.equal(snapshot.results[0].visibilityTested, false);
  assert.equal(snapshot.results[0].observationClaim, false);
  assert.equal(snapshot.results[0].qualification, PLANNING_LABEL);
  restore();
});

test('21 one MapView remains', () => {
  const foundation = fs.readFileSync(path.join(V2, 'map', 'map-foundation.js'), 'utf8');
  const overlay = fs.readFileSync(path.join(V2, 'map', 'place-camera-overlay.js'), 'utf8');
  const store = fs.readFileSync(path.join(V2, 'map', 'authored-cameras.js'), 'utf8');
  assert.equal((foundation.match(/new MapView\(/g) || []).length, 1);
  assert.doesNotMatch(overlay, /new MapView\(/);
  assert.doesNotMatch(store, /new MapView\(/);
});
