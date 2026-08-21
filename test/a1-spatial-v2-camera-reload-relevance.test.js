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
  rememberedCoverageFocusRef,
  rememberedCoverageTarget,
  resetCoveragePlanState
} from '../public/spatial-v2/camera/engine/coverage-plan.js';
import { CAMERA_QUERY_CAPABILITY } from '../public/spatial-v2/camera/engine/relevance-constants.js';
import {
  GUIDED_CONTROL,
  GUIDED_STATE,
  deriveGuidedNext,
  resetGuidedNextState
} from '../public/spatial-v2/camera/guided-next.js';
import { clearHydrantRecords } from '../public/spatial-v2/map/woa/hydrant-object.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const V2 = path.join(ROOT, 'public', 'spatial-v2');
const COMMUNE_PIN = Object.freeze({
  longitude: -73.553221995734,
  latitude: 45.494180980834
});

function isolate() {
  configureAuthoredCameraPersistence({ storage, enabled: false });
  resetAuthoredCameras({ persist: false });
  resetCameraQuerySnapshot();
  resetCameraWall({ emit: false });
  resetCoveragePlanState();
  resetGuidedNextState({ emit: false });
  clearHydrantRecords();
}

const storage = {
  data: {},
  getItem(key) { return this.data[key] || null; },
  setItem(key, value) { this.data[key] = String(value); }
};

function persistIsolate() {
  storage.data = {};
  configureAuthoredCameraPersistence({ storage, enabled: true });
  resetAuthoredCameras({ persist: false });
  resetCameraQuerySnapshot();
  resetCameraWall({ emit: false });
  resetCoveragePlanState();
  resetGuidedNextState({ emit: false });
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

function persistPlan() {
  persistIsolate();
  const plan = generateCameraCoverage(focus());
  const ids = listAuthoredCameras().map((item) => item.cameraId);
  const refs = ids.map((id) => createCameraRef(id));
  const poses = listAuthoredCameras().map(poseOf);
  buildRelevantCameraWall(queryTarget());
  resetAuthoredCameras({ persist: false });
  resetCameraWall({ emit: false });
  resetCoveragePlanState();
  resetCameraQuerySnapshot();
  hydrateAuthoredCameras();
  return { plan, ids, refs, poses };
}

test('1-6 persisted AUTO_PLAN reload reconstructs relevance and BUILD opens wall', () => {
  const { ids } = persistPlan();
  assert.equal(getCameraWallSnapshot().open, false);
  assert.deepEqual(listAuthoredCameras().map((item) => item.cameraId), ids);
  const beforeBuild = deriveGuidedNext({
    enabled: true,
    focusRef: null,
    autoPlanCameras: listAuthoredCameras(),
    lastPlan: null,
    wall: getCameraWallSnapshot()
  });
  assert.notEqual(beforeBuild.targetControl, GUIDED_CONTROL.BUILD_RELEVANT_WALL);
  const remembered = rememberedCoverageTarget();
  assert.equal(Number.isFinite(remembered?.longitude), true);
  const query = queryRelevantCameras({ focusRef: rememberedCoverageFocusRef() });
  assert.ok(query.relevantCount > 0);
  assert.equal(query.relevantCount, 3);
  const next = deriveGuidedNext({
    enabled: true,
    focusRef: null,
    autoPlanCameras: listAuthoredCameras(),
    lastPlan: null,
    query,
    wall: getCameraWallSnapshot()
  });
  assert.equal(getCameraWallSnapshot().open, false);
  assert.equal(next.targetControl, GUIDED_CONTROL.BUILD_RELEVANT_WALL);
  assert.equal(next.greenCount, 1);
  assert.equal(next.opensWall, false);
  const opened = buildRelevantCameraWall(query);
  assert.equal(opened.open, true);
  assert.equal(opened.slotCount, 3);
  restore();
});

test('7-8 no recoverable targetFocus → FOCUS, BUILD not green', () => {
  isolate();
  const next = deriveGuidedNext({
    enabled: true,
    focusRef: null,
    autoPlanCameras: [
      { cameraId: 'camera-autoplan-01' },
      { cameraId: 'camera-autoplan-02' },
      { cameraId: 'camera-autoplan-03' }
    ],
    lastPlan: { ok: true, cameraCount: 3 },
    query: { relevantCount: 0, emptyReason: 'NO FOCUS OR SELECTED OBJECT TARGET' },
    wall: { open: false, slots: [] }
  });
  assert.notEqual(next.targetControl, GUIDED_CONTROL.BUILD_RELEVANT_WALL);
  assert.equal(next.targetControl, GUIDED_CONTROL.FOCUS);
  assert.equal(next.nextAction, 'CHOOSE TARGET');
  assert.equal(next.state, GUIDED_STATE.TARGET_REQUIRED);
  restore();
});

test('9-12 valid target + zero relevant → honest blocked, empty wall stays closed', () => {
  isolate();
  generateCameraCoverage(focus());
  const far = createDropPinFocusRef({
    longitude: 0,
    latitude: 0,
    sourceView: VIEW_ID.MAP
  });
  const query = queryRelevantCameras({ focusRef: far });
  assert.equal(query.relevantCount, 0);
  const next = deriveGuidedNext({
    enabled: true,
    focusRef: far,
    autoPlanCameras: listAuthoredCameras(),
    lastPlan: { ok: true, cameraCount: 3 },
    query,
    wall: { open: false, slots: [] }
  });
  assert.notEqual(next.targetControl, GUIDED_CONTROL.BUILD_RELEVANT_WALL);
  assert.equal(next.targetControl, GUIDED_CONTROL.FOCUS);
  assert.equal(next.nextAction, 'CHOOSE NEW TARGET');
  assert.equal(next.blockedReason, 'NO RELEVANT CAMERAS FOR TARGET');
  const empty = buildRelevantCameraWall(query);
  assert.equal(empty.open, false);
  assert.equal(empty.slotCount, 0);
  const impossible = deriveGuidedNext({
    enabled: true,
    focusRef: null,
    autoPlanCameras: listAuthoredCameras(),
    lastPlan: null,
    query: { relevantCount: 0, emptyReason: 'NO_QUERY' },
    wall: { open: false, slots: [] }
  });
  assert.notEqual(impossible.targetControl, GUIDED_CONTROL.BUILD_RELEVANT_WALL);
  restore();
});

test('13-18 CameraRefs / AUTO_PLAN / pose / SelectionSet / close / second reload', () => {
  const { ids, refs, poses, plan } = persistPlan();
  assert.equal(plan.ok, true);
  assert.equal(listAuthoredCameras().every((item) => item.creationMode === CREATION_MODE.AUTO_PLAN), true);
  assert.deepEqual(ids.map((id) => createCameraRef(id)), refs);
  assert.deepEqual(listAuthoredCameras().map(poseOf), poses);
  const chassis = createSpatialV2Chassis({
    now: () => '2026-08-21T16:00:00.000Z',
    idFactory: () => 'reload-relevance-sel'
  });
  const selectionBefore = chassis.stateStore.getSnapshot().selection;
  const query = queryRelevantCameras({ focusRef: rememberedCoverageFocusRef() });
  void chassis.executeChassis(CAMERA_QUERY_CAPABILITY, { focusRef: rememberedCoverageFocusRef() });
  const selectionAfter = chassis.stateStore.getSnapshot().selection;
  assert.deepEqual(selectionAfter.objectRefs, selectionBefore.objectRefs);
  assert.equal(selectionAfter.objectRefs.some((ref) => isCameraRef(ref)), false);
  assert.equal(selectionAfter.objectRefs.every((ref) => !ref || isObjectRef(ref)), true);
  const opened = buildRelevantCameraWall(query);
  assert.equal(opened.open, true);
  const closed = closeCameraWall();
  assert.equal(closed.open, false);
  assert.equal(closed.maxHeavyViewers, 0);
  assert.deepEqual(listAuthoredCameras().map((item) => item.cameraId), ids);
  assert.deepEqual(listAuthoredCameras().map(poseOf), poses);
  resetAuthoredCameras({ persist: false });
  resetCameraWall({ emit: false });
  resetCameraQuerySnapshot();
  hydrateAuthoredCameras();
  assert.equal(getCameraWallSnapshot().open, false);
  assert.deepEqual(listAuthoredCameras().map((item) => item.cameraId), ids);
  const again = queryRelevantCameras({ focusRef: rememberedCoverageFocusRef() });
  assert.equal(again.relevantCount, 3);
  const next = deriveGuidedNext({
    enabled: true,
    focusRef: null,
    autoPlanCameras: listAuthoredCameras(),
    query: again,
    wall: getCameraWallSnapshot()
  });
  assert.equal(next.targetControl, GUIDED_CONTROL.BUILD_RELEVANT_WALL);
  restore();
});

test('19-23 contained workspace, maximize/restore, heavy budget, one MapView, leftover camera', () => {
  isolate();
  const wall = fs.readFileSync(path.join(V2, 'shell', 'CameraWallSurface.js'), 'utf8');
  const css = fs.readFileSync(path.join(V2, 'iqai-spatial-v2.css'), 'utf8');
  const frame = fs.readFileSync(path.join(V2, 'shell', 'WorldViewFrame.js'), 'utf8');
  const session = fs.readFileSync(path.join(V2, 'bootstrap', 'worldview-map-session.js'), 'utf8');
  const relevance = fs.readFileSync(path.join(V2, 'shell', 'CameraRelevanceSurface.js'), 'utf8');
  const guided = fs.readFileSync(path.join(V2, 'camera', 'guided-next.js'), 'utf8');
  const engine = fs.readFileSync(path.join(V2, 'camera', 'engine', 'camera-wall.js'), 'utf8');
  const foundation = fs.readFileSync(path.join(V2, 'map', 'map-foundation.js'), 'utf8');
  assert.match(wall, /data-iqai-pane="STREET 360"/);
  assert.match(wall, /data-iqai-camera-wall-contained="true"/);
  assert.match(session, /ensureCameraPane/);
  assert.match(session, /openSupporting\('STREET 360'\)/);
  assert.match(frame, /iqaiWorldviewMaximized/);
  assert.match(css, /data-iqai-worldview-maximized/);
  assert.match(relevance, /rememberedCoverageFocusRef/);
  assert.match(guided, /relevantCount > 0 && hasRecoverableTarget/);
  assert.match(engine, /if \(!cameraIds\.length\) \{\s*open = false/s);
  assert.match(engine, /maxHeavyViewers: budget/);
  assert.equal((foundation.match(/new MapView\(/g) || []).length, 1);
  persistPlan();
  placeAuthoredCamera({
    cameraId: 'camera-operator-leftover',
    longitude: 0,
    latitude: 0,
    heading: 0,
    pitch: 0,
    heightAboveGround: 3,
    horizontalFov: 70
  });
  const query = queryRelevantCameras({ focusRef: rememberedCoverageFocusRef() });
  assert.equal(query.cameraCount, 4);
  assert.equal(query.relevantCount, 3);
  const opened = buildRelevantCameraWall(query);
  assert.ok(opened.maxHeavyViewers <= TRI_VIEW_HEAVY_BUDGET);
  assert.equal(opened.maxHeavyViewers, TRI_VIEW_HEAVY_BUDGET);
  assert.equal(createCameraRef('camera-autoplan-01').authority, CAMERA_REF_AUTHORITY);
  restore();
});
