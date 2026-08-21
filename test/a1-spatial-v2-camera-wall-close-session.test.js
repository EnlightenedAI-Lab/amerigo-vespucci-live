import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { VIEW_ID, createDropPinFocusRef, isObjectRef } from '../public/spatial-v2/foundation/contracts/index.js';
import { createSpatialV2Chassis } from '../public/spatial-v2/bootstrap/spatial-v2-bootstrap.js';
import {
  CREATION_MODE,
  configureAuthoredCameraPersistence,
  hydrateAuthoredCameras,
  listAuthoredCameras,
  placeAuthoredCamera,
  resetAuthoredCameras
} from '../public/spatial-v2/map/authored-cameras.js';
import { CAMERA_REF_AUTHORITY, createCameraRef, isCameraRef } from '../public/spatial-v2/camera/camera-ref.js';
import {
  queryRelevantCameras,
  resetCameraQuerySnapshot
} from '../public/spatial-v2/camera/spatial-camera-adapter.js';
import { HEAVY_VIEWER_LIMIT, TRI_VIEW_HEAVY_BUDGET } from '../public/spatial-v2/camera/engine/view-slot.js';
import {
  buildRelevantCameraWall,
  closeCameraWall,
  getCameraWallSnapshot,
  resetCameraWall
} from '../public/spatial-v2/camera/engine/camera-wall.js';
import {
  generateCameraCoverage,
  resetCoveragePlanState
} from '../public/spatial-v2/camera/engine/coverage-plan.js';
import { destinationAlongHeading } from '../public/spatial-v2/camera/engine/geodesy.js';
import { CAMERA_QUERY_CAPABILITY } from '../public/spatial-v2/camera/engine/relevance-constants.js';
import { renderCameraWallSurface } from '../public/spatial-v2/shell/CameraWallSurface.js';
import { renderCameraRelevanceSurface } from '../public/spatial-v2/shell/CameraRelevanceSurface.js';
import { getLiveHeavyViewerCount } from '../public/spatial-v2/camera/provider/heavy-viewer.js';
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
  resetCoveragePlanState();
  clearHydrantRecords();
}

function restore() {
  isolate();
  configureAuthoredCameraPersistence({ storage: null, enabled: true });
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

function focus() {
  return createDropPinFocusRef({ ...COMMUNE_PIN, sourceView: VIEW_ID.MAP });
}

function queryTarget() {
  return queryRelevantCameras({ focusRef: focus() });
}

test('1-4 CLOSE WALL closes presentation and preserves cameras / AUTO_PLAN / CameraRefs', () => {
  isolate();
  const plan = generateCameraCoverage(focus());
  assert.equal(plan.ok, true);
  assert.equal(plan.cameraCount, 3);
  const ids = listAuthoredCameras().map((item) => item.cameraId);
  const refs = ids.map((id) => createCameraRef(id));
  const poses = listAuthoredCameras().map(poseOf);
  const wall = buildRelevantCameraWall(queryTarget());
  assert.equal(wall.open, true);
  assert.equal(wall.slotCount, 3);
  const closed = closeCameraWall();
  assert.equal(closed.open, false);
  assert.equal(closed.slotCount, 0);
  assert.equal(closed.maxHeavyViewers, 0);
  assert.deepEqual(listAuthoredCameras().map((item) => item.cameraId), ids);
  assert.equal(listAuthoredCameras().every((item) => item.creationMode === CREATION_MODE.AUTO_PLAN), true);
  assert.deepEqual(ids.map((id) => createCameraRef(id)), refs);
  assert.deepEqual(listAuthoredCameras().map(poseOf), poses);
  restore();
});

test('5-7 reload/session init starts wall closed while persisted cameras remain queryable', () => {
  isolate();
  const storage = {
    data: {},
    getItem(key) { return this.data[key] || null; },
    setItem(key, value) { this.data[key] = String(value); }
  };
  configureAuthoredCameraPersistence({ storage, enabled: true });
  generateCameraCoverage(focus());
  const ids = listAuthoredCameras().map((item) => item.cameraId);
  buildRelevantCameraWall(queryTarget());
  assert.equal(getCameraWallSnapshot().open, true);
  resetAuthoredCameras({ persist: false });
  resetCameraWall({ emit: false });
  assert.equal(getCameraWallSnapshot().open, false);
  hydrateAuthoredCameras();
  assert.deepEqual(listAuthoredCameras().map((item) => item.cameraId), ids);
  assert.equal(getCameraWallSnapshot().open, false);
  assert.equal(getCameraWallSnapshot().slotCount, 0);
  const query = queryTarget();
  assert.equal(query.cameraCount, 3);
  assert.equal(query.relevantCount, 3);
  restore();
});

test('8-9 BUILD RELEVANT WALL reopens after close; close/reopen repeats', () => {
  isolate();
  generateCameraCoverage(focus());
  buildRelevantCameraWall(queryTarget());
  closeCameraWall();
  const reopened = buildRelevantCameraWall(queryTarget());
  assert.equal(reopened.open, true);
  assert.equal(reopened.slotCount, 3);
  assert.equal(reopened.maxHeavyViewers, TRI_VIEW_HEAVY_BUDGET);
  closeCameraWall();
  assert.equal(getCameraWallSnapshot().open, false);
  const again = buildRelevantCameraWall(queryTarget());
  assert.equal(again.open, true);
  assert.equal(again.maxHeavyViewers, TRI_VIEW_HEAVY_BUDGET);
  restore();
});

test('BUILD after session reset uses remembered AUTO_PLAN target without auto-opening on hydrate', () => {
  isolate();
  const storage = {
    data: {},
    getItem(key) { return this.data[key] || null; },
    setItem(key, value) { this.data[key] = String(value); }
  };
  configureAuthoredCameraPersistence({ storage, enabled: true });
  generateCameraCoverage(focus());
  buildRelevantCameraWall(queryTarget());
  resetCameraQuerySnapshot();
  resetCameraWall({ emit: false });
  resetAuthoredCameras({ persist: false });
  hydrateAuthoredCameras();
  assert.equal(getCameraWallSnapshot().open, false);
  const remembered = listAuthoredCameras().find((item) => item.targetFocus)?.targetFocus;
  assert.equal(Boolean(remembered?.longitude), true);
  const query = queryRelevantCameras({
    focusRef: createDropPinFocusRef({
      longitude: Number(remembered.longitude),
      latitude: Number(remembered.latitude),
      sourceView: VIEW_ID.MAP
    })
  });
  assert.equal(query.relevantCount, 3);
  const wall = buildRelevantCameraWall(query);
  assert.equal(wall.open, true);
  assert.equal(wall.slotCount, 3);
  restore();
});

test('10 Guided Next / relevance query does not auto-open wall', () => {
  const relevance = fs.readFileSync(path.join(V2, 'shell', 'CameraRelevanceSurface.js'), 'utf8');
  const guided = fs.readFileSync(path.join(V2, 'shell', 'guided-next-action.js'), 'utf8');
  const session = fs.readFileSync(path.join(V2, 'bootstrap', 'worldview-map-session.js'), 'utf8');
  assert.match(relevance, /BUILD RELEVANT WALL/);
  assert.doesNotMatch(relevance, /await options\.buildWall\?\.\(\)/);
  assert.doesNotMatch(guided, /buildRelevantCameraWall|cameraWall\.build/);
  assert.match(session, /await cameraWall\?\.build\?\.\(cameraRelevance\?\.snapshot\?\.\(\)\)/);
  isolate();
  generateCameraCoverage(focus());
  queryTarget();
  assert.equal(getCameraWallSnapshot().open, false);
  restore();
});

test('11-13 closed wall has no live heavy viewer; pose unchanged; reopen budget is tri-view', () => {
  isolate();
  generateCameraCoverage(focus());
  const before = listAuthoredCameras().map(poseOf);
  const open = buildRelevantCameraWall(queryTarget());
  assert.equal(open.maxHeavyViewers, TRI_VIEW_HEAVY_BUDGET);
  closeCameraWall();
  assert.equal(getCameraWallSnapshot().maxHeavyViewers, 0);
  assert.equal(getLiveHeavyViewerCount(), 0);
  assert.deepEqual(listAuthoredCameras().map(poseOf), before);
  const reopened = buildRelevantCameraWall(queryTarget());
  assert.ok(reopened.maxHeavyViewers <= TRI_VIEW_HEAVY_BUDGET);
  assert.equal(reopened.maxHeavyViewers, TRI_VIEW_HEAVY_BUDGET);
  restore();
});

test('14-16 SelectionSet unchanged; hidden CSS honors close; one MapView', () => {
  isolate();
  const chassis = createSpatialV2Chassis({
    now: () => '2026-08-21T15:00:00.000Z',
    idFactory: () => 'wall-close-sel'
  });
  const selectionBefore = chassis.stateStore.getSnapshot().selection;
  generateCameraCoverage(focus());
  buildRelevantCameraWall(queryTarget());
  closeCameraWall();
  void chassis.executeChassis(CAMERA_QUERY_CAPABILITY, { focusRef: focus() });
  const selectionAfter = chassis.stateStore.getSnapshot().selection;
  assert.deepEqual(selectionAfter.objectRefs, selectionBefore.objectRefs);
  assert.equal(selectionAfter.objectRefs.some((ref) => isCameraRef(ref)), false);
  assert.equal(selectionAfter.objectRefs.every((ref) => !ref || isObjectRef(ref)), true);
  const html = renderCameraWallSurface();
  assert.match(html, /hidden/);
  assert.match(html, /CLOSE WALL/);
  assert.match(renderCameraRelevanceSurface(), /BUILD RELEVANT WALL/);
  const css = fs.readFileSync(path.join(V2, 'iqai-spatial-v2.css'), 'utf8');
  assert.match(css, /\.iqai-v2-camera-wall\[hidden\]/);
  assert.match(css, /display: none !important/);
  const surface = fs.readFileSync(path.join(V2, 'shell', 'CameraWallSurface.js'), 'utf8');
  assert.match(surface, /closed = true/);
  assert.match(surface, /buildGeneration/);
  const foundation = fs.readFileSync(path.join(V2, 'map', 'map-foundation.js'), 'utf8');
  assert.equal((foundation.match(/new MapView\(/g) || []).length, 1);
  assert.equal(createCameraRef('camera-autoplan-01').authority, CAMERA_REF_AUTHORITY);
  restore();
});
