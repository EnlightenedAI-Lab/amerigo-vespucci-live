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
  listAuthoredCameras,
  resetAuthoredCameras
} from '../public/spatial-v2/map/authored-cameras.js';
import { CAMERA_REF_AUTHORITY, createCameraRef, isCameraRef } from '../public/spatial-v2/camera/camera-ref.js';
import {
  queryRelevantCameras,
  resetCameraQuerySnapshot
} from '../public/spatial-v2/camera/spatial-camera-adapter.js';
import {
  HEAVY_VIEWER_LIMIT,
  TRI_VIEW_HEAVY_BUDGET,
  WALL_MODE,
  resolveHeavyBudget
} from '../public/spatial-v2/camera/engine/view-slot.js';
import {
  buildRelevantCameraWall,
  closeCameraWall,
  enlargeWallSlot,
  getCameraWallSnapshot,
  resetCameraWall,
  restoreWallTriView
} from '../public/spatial-v2/camera/engine/camera-wall.js';
import {
  generateCameraCoverage,
  resetCoveragePlanState
} from '../public/spatial-v2/camera/engine/coverage-plan.js';
import { CAMERA_QUERY_CAPABILITY } from '../public/spatial-v2/camera/engine/relevance-constants.js';
import { applyWallHeavyVirtualView } from '../public/spatial-v2/camera/provider/heavy-viewer.js';
import { deriveGuidedNext, GUIDED_CONTROL, GUIDED_STATE, resetGuidedNextState } from '../public/spatial-v2/camera/guided-next.js';
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

function pack(slotId, providerId) {
  return {
    slotId,
    representation: providerId ? { providerId, provider: 'GOOGLE_STREET360' } : null,
    google: providerId ? { providerId } : null
  };
}

test('1 guided visualization workflow is one TARGET then BUILD 360; PLAN CAMERAS stays visible', () => {
  isolate();
  const host = fs.readFileSync(path.join(V2, 'hosts', 'view-host.js'), 'utf8');
  const guided = fs.readFileSync(path.join(V2, 'camera', 'guided-next.js'), 'utf8');
  const command = renderCameraRelevanceSurface();
  assert.match(host, /data-iqai-drop-pin/);
  assert.match(host, /data-iqai-camera-manual/);
  assert.match(host, /hidden title="Place an authored camera pose"/);
  assert.match(command, /PLAN CAMERAS/);
  assert.match(command, /LOOK AROUND A LOCATION/);
  assert.match(command, /GENERATE CAMERA COVERAGE/);
  assert.match(guided, /GUIDED_CONTROL\.FOCUS/);
  assert.match(guided, /VIEW_EXISTING_360/);
  const next = deriveGuidedNext({
    enabled: true,
    focusRef: focus(),
    autoPlanCameras: [],
    wall: { open: false, slots: [] }
  });
  assert.equal(next.targetControl, GUIDED_CONTROL.LOOK_AROUND);
  assert.notEqual(next.targetControl, 'PLACE_CAMERA');
  restore();
});

test('2 manual PLACE CAMERA is behind MANUAL/EXPERT', () => {
  const host = fs.readFileSync(path.join(V2, 'hosts', 'view-host.js'), 'utf8');
  const place = fs.readFileSync(path.join(V2, 'shell', 'PlaceCameraControl.js'), 'utf8');
  assert.match(host, /data-iqai-camera-manual/);
  assert.match(host, />MANUAL</);
  assert.match(host, /PLACE CAMERA · EXPERT/);
  assert.match(place, /let expert = false/);
  assert.match(place, /editor\.hidden = !expert \|\| !current/);
  restore();
});

test('3 generate coverage produces valid 3-camera AUTO_PLAN', () => {
  isolate();
  const plan = generateCameraCoverage(focus());
  assert.equal(plan.ok, true);
  assert.equal(plan.cameraCount, 3);
  assert.equal(listAuthoredCameras().length, 3);
  assert.ok(listAuthoredCameras().every((item) => item.creationMode === CREATION_MODE.AUTO_PLAN));
  restore();
});

test('4-9 visualization-first 3-UP wall composition and pane bindings', () => {
  isolate();
  const html = renderCameraWallSurface();
  const css = fs.readFileSync(path.join(V2, 'iqai-spatial-v2.css'), 'utf8');
  const frame = fs.readFileSync(path.join(V2, 'shell', 'WorldViewFrame.js'), 'utf8');
  assert.match(html, /data-iqai-camera-wall-layout="tri-view"/);
  assert.match(html, /RESTORE 3-UP/);
  assert.match(html, /PLANNED · NOT INSTALLED · PROVIDER REPRESENTATION · NOT CAMERA FEED/);
  assert.match(css, /data-iqai-camera-viz="true"/);
  assert.match(css, /minmax\(7rem, 28%\)/);
  assert.match(css, /minmax\(12rem, 1fr\)/);
  assert.match(frame, /enterCameraVisualization/);
  assert.match(frame, /exitCameraVisualization/);
  generateCameraCoverage(focus());
  const query = queryRelevantCameras({ focusRef: focus() });
  const wall = buildRelevantCameraWall(query);
  assert.equal(wall.open, true);
  assert.equal(wall.mode, WALL_MODE.TRI_VIEW);
  assert.equal(wall.slotCount, 3);
  assert.deepEqual(
    [...wall.slots.map((slot) => slot.cameraRef)].sort(),
    ['camera-autoplan-01', 'camera-autoplan-02', 'camera-autoplan-03']
  );
  restore();
});

test('10-14 tri-view heavy budget, enlarge, restore, pose immutability', () => {
  isolate();
  generateCameraCoverage(focus());
  const poses = listAuthoredCameras().map(poseOf);
  const refs = listAuthoredCameras().map((item) => createCameraRef(item.cameraId));
  const wall = buildRelevantCameraWall(queryRelevantCameras({ focusRef: focus() }));
  assert.equal(wall.maxHeavyViewers, TRI_VIEW_HEAVY_BUDGET);
  assert.equal(resolveHeavyBudget({ open: true, mode: WALL_MODE.TRI_VIEW }), TRI_VIEW_HEAVY_BUDGET);
  assert.equal(resolveHeavyBudget({ open: false }), 0);
  assert.equal(resolveHeavyBudget({ open: true, enlargedSlotId: wall.slots[1].slotId }), HEAVY_VIEWER_LIMIT);
  const enlarged = enlargeWallSlot(wall.slots[1].slotId);
  assert.equal(enlarged.enlargedSlotId, wall.slots[1].slotId);
  assert.equal(enlarged.activeSlotId, wall.slots[1].slotId);
  assert.equal(enlarged.maxHeavyViewers, HEAVY_VIEWER_LIMIT);
  assert.equal(enlarged.slotCount, 3);
  const restored = restoreWallTriView();
  assert.equal(restored.enlargedSlotId, null);
  assert.equal(restored.mode, WALL_MODE.TRI_VIEW);
  assert.equal(restored.maxHeavyViewers, TRI_VIEW_HEAVY_BUDGET);
  applyWallHeavyVirtualView({ heading: 33, pitch: 6, zoom: 2 });
  assert.deepEqual(listAuthoredCameras().map(poseOf), poses);
  assert.deepEqual(listAuthoredCameras().map((item) => createCameraRef(item.cameraId)), refs);
  restore();
});

test('15-18 close restores session wall closed; AUTO_PLAN and SelectionSet unchanged', () => {
  isolate();
  const chassis = createSpatialV2Chassis({
    now: () => '2026-08-21T17:00:00.000Z',
    idFactory: () => 'tri-view-sel'
  });
  const selectionBefore = chassis.stateStore.getSnapshot().selection;
  generateCameraCoverage(focus());
  const poses = listAuthoredCameras().map(poseOf);
  buildRelevantCameraWall(queryRelevantCameras({ focusRef: focus() }));
  enlargeWallSlot(getCameraWallSnapshot().slots[0].slotId);
  const closed = closeCameraWall();
  assert.equal(closed.open, false);
  assert.equal(closed.maxHeavyViewers, 0);
  assert.equal(closed.enlargedSlotId, null);
  assert.deepEqual(listAuthoredCameras().map(poseOf), poses);
  void chassis.executeChassis(CAMERA_QUERY_CAPABILITY, { focusRef: focus() });
  const selectionAfter = chassis.stateStore.getSnapshot().selection;
  assert.deepEqual(selectionAfter.objectRefs, selectionBefore.objectRefs);
  assert.equal(selectionAfter.objectRefs.some((ref) => isCameraRef(ref)), false);
  assert.equal(selectionAfter.objectRefs.every((ref) => !ref || isObjectRef(ref)), true);
  restore();
});

test('19-23 Guided Next CAMERA WALL READY; one MapView; chrome compact', () => {
  isolate();
  generateCameraCoverage(focus());
  const wall = buildRelevantCameraWall(queryRelevantCameras({ focusRef: focus() }));
  const next = deriveGuidedNext({
    enabled: true,
    focusRef: focus(),
    autoPlanCameras: listAuthoredCameras(),
    lastPlan: { ok: true, cameraCount: 3 },
    wall,
    representations: { slots: wall.slots.map((slot) => pack(slot.slotId, `pano-${slot.slotId}`)) }
  });
  assert.equal(next.state, GUIDED_STATE.TOUR_COMPLETE);
  assert.match(next.label, /CAMERA WALL READY/);
  assert.equal(next.greenCount, 0);
  const foundation = fs.readFileSync(path.join(V2, 'map', 'map-foundation.js'), 'utf8');
  const html = renderCameraWallSurface();
  const surface = fs.readFileSync(path.join(V2, 'shell', 'CameraWallSurface.js'), 'utf8');
  assert.equal((foundation.match(/new MapView\(/g) || []).length, 1);
  assert.match(html, /RESTORE 3-UP/);
  assert.match(surface, /data-iqai-camera-wall-enlarge/);
  assert.doesNotMatch(html, /PIXEL DENSITY/);
  assert.equal(createCameraRef('camera-autoplan-01').authority, CAMERA_REF_AUTHORITY);
  restore();
});
