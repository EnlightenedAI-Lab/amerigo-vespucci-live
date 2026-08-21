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
  configureAuthoredCameraPersistence,
  getAuthoredCamera,
  hydrateAuthoredCameras,
  listAuthoredCameras,
  placeAuthoredCamera,
  resetAuthoredCameras
} from '../public/spatial-v2/map/authored-cameras.js';
import {
  CAMERA_REF_AUTHORITY,
  createCameraRef,
  isCameraRef
} from '../public/spatial-v2/camera/camera-ref.js';
import {
  queryRelevantCameras,
  resetCameraQuerySnapshot
} from '../public/spatial-v2/camera/spatial-camera-adapter.js';
import {
  VIEW_SLOT_KIND,
  WALL_SLOT_CAP,
  createViewSlot
} from '../public/spatial-v2/camera/engine/view-slot.js';
import {
  buildRelevantCameraWall,
  closeCameraWall,
  getCameraWallSnapshot,
  relevantCameraIdsFromQuery,
  resetCameraWall,
  setActiveSlot
} from '../public/spatial-v2/camera/engine/camera-wall.js';
import { PIXEL_DENSITY_UNKNOWN } from '../public/spatial-v2/camera/engine/dori.js';
import { destinationAlongHeading } from '../public/spatial-v2/camera/engine/geodesy.js';
import { CAMERA_QUERY_CAPABILITY } from '../public/spatial-v2/camera/engine/relevance-constants.js';
import { renderCameraWallSurface } from '../public/spatial-v2/shell/CameraWallSurface.js';
import { renderCameraRelevanceSurface } from '../public/spatial-v2/shell/CameraRelevanceSurface.js';
import { clearHydrantRecords } from '../public/spatial-v2/map/woa/hydrant-object.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const V2 = path.join(ROOT, 'public', 'spatial-v2');
const COMMUNE_PIN = Object.freeze({
  longitude: -73.553221995734,
  latitude: 45.494180980834
});

function isolate() {
  configureAuthoredCameraPersistence({ storage: null, enabled: false });
  resetAuthoredCameras({ persist: false });
  resetCameraQuerySnapshot();
  resetCameraWall({ emit: false });
  clearHydrantRecords();
}

function restore() {
  resetCameraWall({ emit: false });
  resetAuthoredCameras({ persist: false });
  configureAuthoredCameraPersistence({ storage: null, enabled: true });
  resetCameraQuerySnapshot();
  clearHydrantRecords();
}

function poseOf(camera) {
  return {
    cameraId: camera.cameraId,
    longitude: camera.longitude,
    latitude: camera.latitude,
    heading: camera.heading,
    pitch: camera.pitch,
    heightAboveGround: camera.heightAboveGround,
    horizontalFov: camera.horizontalFov
  };
}

function placeFacing(count) {
  const headings = [0, 90, 180, 270];
  const cameras = [];
  for (let i = 0; i < count; i += 1) {
    const originHeading = headings[i % headings.length];
    const point = destinationAlongHeading(COMMUNE_PIN, originHeading, 40 + i * 6);
    cameras.push(placeAuthoredCamera({
      cameraId: `camera-wall-${i + 1}`,
      ...point,
      heading: (originHeading + 180) % 360,
      pitch: -8,
      heightAboveGround: 4 + i,
      horizontalFov: 70 + i * 5
    }));
  }
  return cameras;
}

function queryTarget() {
  return queryRelevantCameras({
    focusRef: createDropPinFocusRef({ ...COMMUNE_PIN, sourceView: VIEW_ID.MAP })
  });
}

test('1 BUILD RELEVANT WALL consumes camera.query-relevant results', () => {
  isolate();
  placeFacing(3);
  const query = queryTarget();
  const wall = buildRelevantCameraWall(query);
  assert.deepEqual(wall.cameraRefs.map((ref) => ref.cameraId), relevantCameraIdsFromQuery(query));
  assert.equal(wall.slotCount, 3);
  assert.equal(wall.open, true);
  restore();
});

test('2-3 CameraRef preserved; ViewSlot identity is separate', () => {
  isolate();
  const [camera] = placeFacing(1);
  const query = queryTarget();
  const wall = buildRelevantCameraWall(query);
  const slot = wall.slots[0];
  assert.equal(slot.kind, VIEW_SLOT_KIND);
  assert.match(slot.slotId, /^view-slot-/);
  assert.notEqual(slot.slotId, camera.cameraId);
  assert.equal(slot.cameraRef, camera.cameraId);
  assert.equal(isCameraRef(createCameraRef(slot.cameraRef)), true);
  assert.equal(createCameraRef(slot.cameraRef).authority, CAMERA_REF_AUTHORITY);
  restore();
});

test('4-6 wall supports 1, 2, and caps at 3 relevant cameras', () => {
  isolate();
  placeFacing(1);
  assert.equal(buildRelevantCameraWall(queryTarget()).slotCount, 1);
  resetAuthoredCameras({ persist: false });
  placeFacing(2);
  assert.equal(buildRelevantCameraWall(queryTarget()).slotCount, 2);
  resetAuthoredCameras({ persist: false });
  placeFacing(4);
  const query = queryTarget();
  assert.ok(query.relevantCount >= 3);
  const wall = buildRelevantCameraWall(query);
  assert.equal(wall.slotCount, 3);
  assert.equal(WALL_SLOT_CAP, 3);
  assert.equal(relevantCameraIdsFromQuery(query).length, 3);
  restore();
});

test('7 no fake camera is created', () => {
  isolate();
  const before = listAuthoredCameras().map((item) => item.cameraId);
  buildRelevantCameraWall(queryTarget());
  assert.deepEqual(listAuthoredCameras().map((item) => item.cameraId), before);
  placeFacing(2);
  const ids = listAuthoredCameras().map((item) => item.cameraId);
  buildRelevantCameraWall(queryTarget());
  assert.deepEqual(listAuthoredCameras().map((item) => item.cameraId), ids);
  restore();
});

test('8-10 wall assignment does not modify CameraPose, heading, or FOV', () => {
  isolate();
  const cameras = placeFacing(3);
  const before = cameras.map((camera) => poseOf(camera));
  buildRelevantCameraWall(queryTarget());
  setActiveSlot(getCameraWallSnapshot().slots[1].slotId);
  const after = cameras.map((camera) => poseOf(getAuthoredCamera(camera.cameraId)));
  assert.deepEqual(after, before);
  restore();
});

test('11 wall assignment does not modify SelectionSet', async () => {
  isolate();
  const chassis = createSpatialV2Chassis({
    now: () => '2026-08-21T13:00:00.000Z',
    idFactory: () => 'wall-sel'
  });
  placeFacing(2);
  await chassis.executeChassis(CAMERA_QUERY_CAPABILITY, {
    focusRef: createDropPinFocusRef({ ...COMMUNE_PIN, sourceView: VIEW_ID.MAP })
  });
  const before = chassis.stateStore.getSnapshot().selection;
  buildRelevantCameraWall(queryTarget());
  const after = chassis.stateStore.getSnapshot().selection;
  assert.deepEqual(after.objectRefs, before.objectRefs);
  assert.equal(after.objectRefs.some((ref) => isCameraRef(ref)), false);
  assert.equal(after.objectRefs.every((ref) => !ref || isObjectRef(ref)), true);
  restore();
});

test('12-15 planned truth, unknown optics, visibility, and observation remain honest', () => {
  isolate();
  placeFacing(2);
  const query = queryTarget();
  const wall = buildRelevantCameraWall(query);
  assert.equal(wall.slots.length, 2);
  for (const item of query.relevant.slice(0, 2)) {
    assert.equal(item.qualification, 'PLANNED · NOT INSTALLED');
    assert.equal(item.pixelDensityLabel, PIXEL_DENSITY_UNKNOWN);
    assert.equal(item.visibilityTested, false);
    assert.equal(item.observationClaim, false);
  }
  assert.equal(query.visibilityTested, false);
  assert.equal(query.observationClaim, false);
  restore();
});

test('16 closing wall does not delete cameras', () => {
  isolate();
  placeFacing(2);
  const ids = listAuthoredCameras().map((item) => item.cameraId);
  buildRelevantCameraWall(queryTarget());
  const closed = closeCameraWall();
  assert.equal(closed.open, false);
  assert.equal(closed.slotCount, 0);
  assert.deepEqual(listAuthoredCameras().map((item) => item.cameraId), ids);
  restore();
});

test('17-18 persistent CameraRefs survive independently of session wall', () => {
  isolate();
  const storage = {
    data: {},
    getItem(key) { return this.data[key] || null; },
    setItem(key, value) { this.data[key] = String(value); }
  };
  configureAuthoredCameraPersistence({ storage, enabled: true });
  placeFacing(2);
  const ids = listAuthoredCameras().map((item) => item.cameraId);
  buildRelevantCameraWall(queryTarget());
  assert.equal(getCameraWallSnapshot().open, true);
  resetAuthoredCameras({ persist: false });
  resetCameraWall({ emit: false });
  assert.equal(getCameraWallSnapshot().open, false);
  assert.equal(getCameraWallSnapshot().slotCount, 0);
  hydrateAuthoredCameras();
  assert.deepEqual(listAuthoredCameras().map((item) => item.cameraId), ids);
  assert.equal(getCameraWallSnapshot().open, false);
  restore();
});

test('19 one MapView remains', () => {
  const foundation = fs.readFileSync(path.join(V2, 'map', 'map-foundation.js'), 'utf8');
  const wall = fs.readFileSync(path.join(V2, 'shell', 'CameraWallSurface.js'), 'utf8');
  const engine = fs.readFileSync(path.join(V2, 'camera', 'engine', 'camera-wall.js'), 'utf8');
  assert.equal((foundation.match(/new MapView\(/g) || []).length, 1);
  assert.doesNotMatch(wall, /new MapView\(/);
  assert.doesNotMatch(engine, /new MapView\(/);
  assert.doesNotMatch(wall, /camera-planner-lab|sensor-remote|Road511/);
  assert.doesNotMatch(engine, /camera-planner-lab|google-street360-temporal|temporal-observation|sensor-remote/);
  const html = renderCameraWallSurface();
  assert.match(html, /CLOSE WALL/);
  assert.match(html, /CAMERA WALL/);
  assert.match(html, /data-iqai-camera-wall-layout="tri-view"/);
  assert.match(html, /data-iqai-camera-wall-heavy-stage/);
  assert.match(html, /VIRTUAL VIEW/);
  assert.match(renderCameraRelevanceSurface(), /BUILD RELEVANT WALL/);
  assert.match(renderCameraRelevanceSurface(), /GENERATE CAMERA COVERAGE/);
  assert.equal(createViewSlot({ slotId: 'view-slot-x' }).kind, VIEW_SLOT_KIND);
});
