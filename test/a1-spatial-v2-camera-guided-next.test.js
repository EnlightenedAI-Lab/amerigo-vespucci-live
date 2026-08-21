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
  COVERAGE_CAMERA_COUNT,
  COVERAGE_PLAN_ALGORITHM,
  COVERAGE_STANDOFF_M,
  PLAN_VIEW_HFOV,
  generateCameraCoverage,
  resetCoveragePlanState
} from '../public/spatial-v2/camera/engine/coverage-plan.js';
import { CAMERA_QUERY_CAPABILITY } from '../public/spatial-v2/camera/engine/relevance-constants.js';
import { PROVIDER_REPRESENTATION_REF_AUTHORITY } from '../public/spatial-v2/camera/provider/provider-representation.js';
import {
  GUIDED_CONTROL,
  GUIDED_STATE,
  GUIDED_STATUS,
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
  configureAuthoredCameraPersistence({ storage: null, enabled: false });
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

function pack(slotId, providerId) {
  return {
    slotId,
    representation: providerId ? { providerId } : null,
    google: providerId ? { providerId } : null
  };
}

function wallFromPlan() {
  return buildRelevantCameraWall(queryTarget());
}

test('1 no FocusRef → LOOK AROUND only green', () => {
  isolate();
  const next = deriveGuidedNext({
    enabled: true,
    focusRef: null,
    autoPlanCameras: [],
    lastPlan: null,
    wall: { open: false, slots: [] }
  });
  assert.equal(next.state, GUIDED_STATE.TARGET_READY);
  assert.equal(next.targetControl, GUIDED_CONTROL.LOOK_AROUND);
  assert.equal(next.status, GUIDED_STATUS.NEXT);
  assert.equal(next.greenCount, 1);
  assert.match(next.label, /LOOK AROUND A LOCATION/);
  restore();
});

test('2 FocusRef → LOOK AROUND still the first choice', () => {
  isolate();
  const next = deriveGuidedNext({
    enabled: true,
    focusRef: focus(),
    autoPlanCameras: [],
    lastPlan: null,
    wall: { open: false, slots: [] }
  });
  assert.equal(next.state, GUIDED_STATE.TARGET_READY);
  assert.equal(next.targetControl, GUIDED_CONTROL.LOOK_AROUND);
  assert.equal(next.greenCount, 1);
  assert.match(next.label, /LOOK AROUND A LOCATION/);
  restore();
});

test('3 click does not advance before valid AUTO_PLAN exists', () => {
  isolate();
  const clicked = deriveGuidedNext({
    enabled: true,
    focusRef: focus(),
    autoPlanCameras: [],
    lastPlan: { ok: false },
    wall: { open: false, slots: [] }
  });
  assert.equal(clicked.targetControl, GUIDED_CONTROL.LOOK_AROUND);
  assert.equal(clicked.state, GUIDED_STATE.TARGET_READY);
  const generated = generateCameraCoverage(focus());
  assert.equal(generated.ok, true);
  assert.equal(generated.cameraCount, COVERAGE_CAMERA_COUNT);
  const after = deriveGuidedNext({
    enabled: true,
    focusRef: focus(),
    autoPlanCameras: listAuthoredCameras(),
    lastPlan: generated,
    query: { relevantCount: 3 },
    wall: { open: false, slots: [] }
  });
  assert.equal(after.targetControl, GUIDED_CONTROL.BUILD_RELEVANT_WALL);
  restore();
});

test('4 plan + wall open → BUILD not highlighted', () => {
  isolate();
  generateCameraCoverage(focus());
  const wall = wallFromPlan();
  const next = deriveGuidedNext({
    enabled: true,
    focusRef: focus(),
    autoPlanCameras: listAuthoredCameras(),
    lastPlan: { ok: true, cameraCount: 3 },
    wall,
    attachInFlight: true,
    representations: { slots: [] }
  });
  assert.notEqual(next.targetControl, GUIDED_CONTROL.BUILD_RELEVANT_WALL);
  assert.equal(next.state, GUIDED_STATE.PROVIDER_LOADING);
  restore();
});

test('5 plan + wall closed → BUILD green', () => {
  isolate();
  generateCameraCoverage(focus());
  buildRelevantCameraWall(queryTarget());
  closeCameraWall();
  const next = deriveGuidedNext({
    enabled: true,
    focusRef: focus(),
    autoPlanCameras: listAuthoredCameras(),
    lastPlan: { ok: true, cameraCount: 3 },
    query: { relevantCount: 3 },
    wall: getCameraWallSnapshot()
  });
  assert.equal(next.state, GUIDED_STATE.WALL_CLOSED);
  assert.equal(next.targetControl, GUIDED_CONTROL.BUILD_RELEVANT_WALL);
  assert.equal(next.greenCount, 1);
  restore();
});

test('6 provider loading is not red', () => {
  isolate();
  generateCameraCoverage(focus());
  const wall = wallFromPlan();
  const next = deriveGuidedNext({
    enabled: true,
    focusRef: focus(),
    autoPlanCameras: listAuthoredCameras(),
    lastPlan: { ok: true, cameraCount: 3 },
    wall,
    attachInFlight: true,
    representations: { slots: [] }
  });
  assert.equal(next.status, GUIDED_STATUS.LOADING);
  assert.notEqual(next.status, GUIDED_STATUS.BLOCKED);
  assert.equal(next.greenCount, 0);
  assert.match(next.label, /LOADING CAMERA VIEW/);
  restore();
});

test('7 first usable camera becomes green', () => {
  isolate();
  generateCameraCoverage(focus());
  const wall = wallFromPlan();
  const next = deriveGuidedNext({
    enabled: true,
    focusRef: focus(),
    autoPlanCameras: listAuthoredCameras(),
    lastPlan: { ok: true, cameraCount: 3 },
    wall,
    attachInFlight: false,
    representations: { slots: wall.slots.map((slot) => pack(slot.slotId, 'GOOGLE_STREET360')) }
  });
  assert.equal(next.state, GUIDED_STATE.TOUR_COMPLETE);
  assert.equal(next.targetControl, null);
  assert.equal(next.greenCount, 0);
  assert.match(next.label, /CAMERA WALL READY/);
  restore();
});

test('8 unavailable first camera skips to next valid camera', () => {
  isolate();
  generateCameraCoverage(focus());
  const wall = wallFromPlan();
  const next = deriveGuidedNext({
    enabled: true,
    focusRef: focus(),
    autoPlanCameras: listAuthoredCameras(),
    lastPlan: { ok: true, cameraCount: 3 },
    wall,
    representations: {
      slots: [
        pack(wall.slots[0].slotId, null),
        pack(wall.slots[1].slotId, 'MAPILLARY_360'),
        pack(wall.slots[2].slotId, 'GOOGLE_STREET360')
      ]
    }
  });
  assert.equal(next.targetControl, GUIDED_CONTROL.CAMERA_01);
  assert.match(next.label, /CAMERA 01 UNAVAILABLE/);
  restore();
});

test('9 Camera 01 active → Camera 02 green', () => {
  isolate();
  generateCameraCoverage(focus());
  const wall = wallFromPlan();
  const next = deriveGuidedNext({
    enabled: true,
    focusRef: focus(),
    autoPlanCameras: listAuthoredCameras(),
    lastPlan: { ok: true, cameraCount: 3 },
    wall,
    inspectedSlotIds: [wall.slots[0].slotId],
    representations: { slots: wall.slots.map((slot) => pack(slot.slotId, 'GOOGLE_STREET360')) }
  });
  assert.equal(next.targetControl, null);
  assert.match(next.label, /CAMERA WALL READY/);
  restore();
});

test('10 Camera 02 active → Camera 03 green', () => {
  isolate();
  generateCameraCoverage(focus());
  const wall = wallFromPlan();
  const next = deriveGuidedNext({
    enabled: true,
    focusRef: focus(),
    autoPlanCameras: listAuthoredCameras(),
    lastPlan: { ok: true, cameraCount: 3 },
    wall,
    inspectedSlotIds: [wall.slots[0].slotId, wall.slots[1].slotId],
    representations: { slots: wall.slots.map((slot) => pack(slot.slotId, 'GOOGLE_STREET360')) }
  });
  assert.equal(next.targetControl, null);
  assert.match(next.label, /CAMERA WALL READY/);
  restore();
});

test('11 Camera 03 active → complete', () => {
  isolate();
  generateCameraCoverage(focus());
  const wall = wallFromPlan();
  const next = deriveGuidedNext({
    enabled: true,
    focusRef: focus(),
    autoPlanCameras: listAuthoredCameras(),
    lastPlan: { ok: true, cameraCount: 3 },
    wall,
    inspectedSlotIds: wall.slots.map((slot) => slot.slotId),
    representations: { slots: wall.slots.map((slot) => pack(slot.slotId, 'GOOGLE_STREET360')) }
  });
  assert.equal(next.state, GUIDED_STATE.TOUR_COMPLETE);
  assert.equal(next.status, GUIDED_STATUS.READY);
  assert.equal(next.greenCount, 0);
  assert.equal(next.targetControl, null);
  assert.match(next.label, /CAMERA WALL READY/);
  restore();
});

test('12 maximum one dominant green action', () => {
  isolate();
  const cases = [
    deriveGuidedNext({ enabled: true, focusRef: null, autoPlanCameras: [], wall: { open: false, slots: [] } }),
    deriveGuidedNext({ enabled: true, focusRef: focus(), autoPlanCameras: [], wall: { open: false, slots: [] } })
  ];
  generateCameraCoverage(focus());
  const wall = wallFromPlan();
  cases.push(deriveGuidedNext({
    enabled: true,
    focusRef: focus(),
    autoPlanCameras: listAuthoredCameras(),
    lastPlan: { ok: true, cameraCount: 3 },
    wall: { open: false, slots: [] }
  }));
  cases.push(deriveGuidedNext({
    enabled: true,
    focusRef: focus(),
    autoPlanCameras: listAuthoredCameras(),
    lastPlan: { ok: true, cameraCount: 3 },
    wall,
    representations: { slots: wall.slots.map((slot) => pack(slot.slotId, 'GOOGLE_STREET360')) }
  }));
  for (const next of cases) {
    assert.ok(next.greenCount <= 1);
    if (next.greenCount === 1) assert.ok(next.targetControl);
  }
  restore();
});

test('13 genuine blocked state produces red + reason', () => {
  isolate();
  const generateBlocked = deriveGuidedNext({
    enabled: true,
    focusRef: focus(),
    autoPlanCameras: [],
    lastPlan: null,
    lastGenerateReason: 'FOCUSREF_POINT_REQUIRED',
    wall: { open: false, slots: [] }
  });
  assert.equal(generateBlocked.status, GUIDED_STATUS.BLOCKED);
  assert.equal(generateBlocked.targetControl, GUIDED_CONTROL.GENERATE_CAMERA_COVERAGE);
  assert.equal(generateBlocked.blockedReason, 'FOCUSREF_POINT_REQUIRED');
  assert.equal(generateBlocked.greenCount, 0);

  generateCameraCoverage(focus());
  const wall = wallFromPlan();
  const noRep = deriveGuidedNext({
    enabled: true,
    focusRef: focus(),
    autoPlanCameras: listAuthoredCameras(),
    lastPlan: { ok: true, cameraCount: 3 },
    wall,
    attachInFlight: false,
    representations: { slots: wall.slots.map((slot) => pack(slot.slotId, null)) }
  });
  assert.equal(noRep.status, GUIDED_STATUS.BLOCKED);
  assert.equal(noRep.blockedReason, 'NO CAMERA REPRESENTATION AVAILABLE');
  restore();
});

test('14 CLOSE WALL still works', () => {
  isolate();
  const plan = generateCameraCoverage(focus());
  const ids = listAuthoredCameras().map((item) => item.cameraId);
  const poses = listAuthoredCameras().map(poseOf);
  buildRelevantCameraWall(queryTarget());
  const closed = closeCameraWall();
  assert.equal(closed.open, false);
  assert.equal(closed.maxHeavyViewers, 0);
  assert.deepEqual(listAuthoredCameras().map((item) => item.cameraId), ids);
  assert.deepEqual(listAuthoredCameras().map(poseOf), poses);
  assert.equal(plan.ok, true);
  restore();
});

test('15 reload still leaves wall closed', () => {
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
  resetAuthoredCameras({ persist: false });
  resetCameraWall({ emit: false });
  hydrateAuthoredCameras();
  assert.equal(getCameraWallSnapshot().open, false);
  assert.deepEqual(listAuthoredCameras().map((item) => item.cameraId), ids);
  restore();
});

test('16 reload with cameras → BUILD green only after reconstructed relevance', () => {
  isolate();
  const storage = {
    data: {},
    getItem(key) { return this.data[key] || null; },
    setItem(key, value) { this.data[key] = String(value); }
  };
  configureAuthoredCameraPersistence({ storage, enabled: true });
  generateCameraCoverage(focus());
  buildRelevantCameraWall(queryTarget());
  resetAuthoredCameras({ persist: false });
  resetCameraWall({ emit: false });
  hydrateAuthoredCameras();
  const beforeQuery = deriveGuidedNext({
    enabled: true,
    focusRef: null,
    autoPlanCameras: listAuthoredCameras(),
    lastPlan: null,
    wall: getCameraWallSnapshot()
  });
  assert.equal(getCameraWallSnapshot().open, false);
  assert.notEqual(beforeQuery.targetControl, GUIDED_CONTROL.BUILD_RELEVANT_WALL);
  assert.equal(beforeQuery.opensWall, false);
  const remembered = listAuthoredCameras().find((item) => item.targetFocus)?.targetFocus;
  const query = queryRelevantCameras({
    focusRef: createDropPinFocusRef({
      longitude: Number(remembered.longitude),
      latitude: Number(remembered.latitude),
      sourceView: VIEW_ID.MAP
    })
  });
  const next = deriveGuidedNext({
    enabled: true,
    focusRef: null,
    autoPlanCameras: listAuthoredCameras(),
    lastPlan: null,
    query,
    wall: getCameraWallSnapshot()
  });
  assert.equal(query.relevantCount, 3);
  assert.equal(next.targetControl, GUIDED_CONTROL.BUILD_RELEVANT_WALL);
  assert.equal(next.opensWall, false);
  restore();
});

test('17 guidance never auto-opens wall', () => {
  isolate();
  const engine = fs.readFileSync(path.join(V2, 'camera', 'guided-next.js'), 'utf8');
  const surface = fs.readFileSync(path.join(V2, 'shell', 'GuidedNextSurface.js'), 'utf8');
  assert.doesNotMatch(engine, /buildRelevantCameraWall/);
  assert.doesNotMatch(engine, /cameraWall\.build/);
  assert.doesNotMatch(surface, /buildRelevantCameraWall/);
  assert.doesNotMatch(surface, /cameraWall\.build/);
  const next = deriveGuidedNext({
    enabled: true,
    focusRef: focus(),
    autoPlanCameras: [{ cameraId: 'camera-autoplan-01' }, { cameraId: 'camera-autoplan-02' }, { cameraId: 'camera-autoplan-03' }],
    lastPlan: { ok: true, cameraCount: 3 },
    wall: { open: false, slots: [] }
  });
  assert.equal(next.opensWall, false);
  restore();
});

test('18-21 CameraPose / CameraRef / ProviderRepresentationRef / SelectionSet unchanged', async () => {
  isolate();
  const plan = generateCameraCoverage(focus());
  const cameras = listAuthoredCameras();
  const poses = cameras.map(poseOf);
  const refs = cameras.map((item) => createCameraRef(item.cameraId));
  const chassis = createSpatialV2Chassis();
  await chassis.executeChassis(CAMERA_QUERY_CAPABILITY, { focusRef: focus() });
  const world = chassis.stateStore.getSnapshot();
  assert.equal((world.selection?.objectRefs || []).some((ref) => isObjectRef(ref) && ref.authority === CAMERA_REF_AUTHORITY), false);
  assert.equal(refs.every((ref) => isCameraRef(ref)), true);
  buildRelevantCameraWall(queryTarget());
  closeCameraWall();
  deriveGuidedNext({
    enabled: true,
    focusRef: focus(),
    autoPlanCameras: listAuthoredCameras(),
    lastPlan: plan,
    wall: getCameraWallSnapshot()
  });
  assert.deepEqual(listAuthoredCameras().map(poseOf), poses);
  assert.deepEqual(listAuthoredCameras().map((item) => createCameraRef(item.cameraId)), refs);
  const providerSrc = fs.readFileSync(path.join(V2, 'camera', 'provider', 'provider-representation.js'), 'utf8');
  assert.match(providerSrc, /iqai\.camera\.provider/);
  restore();
});

test('22 maxHeavyViewers closed/open remains 0/tri-view budget', () => {
  isolate();
  generateCameraCoverage(focus());
  assert.equal(getCameraWallSnapshot().maxHeavyViewers, 0);
  const open = wallFromPlan();
  assert.equal(open.maxHeavyViewers, TRI_VIEW_HEAVY_BUDGET);
  assert.equal(open.maxHeavyViewers, 3);
  closeCameraWall();
  assert.equal(getCameraWallSnapshot().maxHeavyViewers, 0);
  restore();
});

test('23 Large Active Viewer remains functional', () => {
  isolate();
  const wallSurface = fs.readFileSync(path.join(V2, 'shell', 'CameraWallSurface.js'), 'utf8');
  const css = fs.readFileSync(path.join(V2, 'iqai-spatial-v2.css'), 'utf8');
  assert.match(wallSurface, /data-iqai-camera-wall-heavy-stage/);
  assert.match(wallSurface, /applyWallHeavyVirtualView/);
  assert.match(css, /iqai-v2-camera-wall__heavy-stage/);
  restore();
});

test('24 AUTO_PLAN regression green', () => {
  isolate();
  const plan = generateCameraCoverage(focus());
  assert.equal(plan.ok, true);
  assert.equal(plan.algorithm, COVERAGE_PLAN_ALGORITHM);
  assert.equal(plan.cameraCount, 3);
  assert.equal(listAuthoredCameras().length, 3);
  assert.ok(listAuthoredCameras().every((item) => item.creationMode === CREATION_MODE.AUTO_PLAN));
  assert.ok(listAuthoredCameras().every((item) => item.horizontalFov === PLAN_VIEW_HFOV));
  assert.equal(COVERAGE_STANDOFF_M, 48);
  restore();
});

test('25 Camera Wall / provider regressions remain in source', () => {
  isolate();
  const wall = fs.readFileSync(path.join(V2, 'camera', 'engine', 'camera-wall.js'), 'utf8');
  const css = fs.readFileSync(path.join(V2, 'iqai-spatial-v2.css'), 'utf8');
  const surface = fs.readFileSync(path.join(V2, 'shell', 'CameraWallSurface.js'), 'utf8');
  assert.match(wall, /maxHeavyViewers: budget/);
  assert.match(css, /\.iqai-v2-camera-wall\[hidden\]/);
  assert.match(css, /display: none !important/);
  assert.match(surface, /buildGeneration/);
  assert.match(surface, /data-iqai-camera-wall-selector/);
  restore();
});

test('26 mapViewCreateCount=1', () => {
  isolate();
  const source = fs.readFileSync(path.join(V2, 'map', 'map-foundation.js'), 'utf8');
  const matches = source.match(/new MapView\(/g) || [];
  assert.equal(matches.length, 1);
  restore();
});

test('GUIDED OFF removes next without disabling Camera', () => {
  isolate();
  const off = deriveGuidedNext({
    enabled: false,
    focusRef: focus(),
    autoPlanCameras: [],
    wall: { open: false, slots: [] }
  });
  assert.equal(off.state, GUIDED_STATE.GUIDED_OFF);
  assert.equal(off.greenCount, 0);
  assert.equal(off.targetControl, null);
  generateCameraCoverage(focus());
  assert.equal(listAuthoredCameras().length, 3);
  restore();
});
