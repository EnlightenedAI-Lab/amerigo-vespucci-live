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
  generateCameraCoverage,
  resetCoveragePlanState
} from '../public/spatial-v2/camera/engine/coverage-plan.js';
import { CAMERA_QUERY_CAPABILITY } from '../public/spatial-v2/camera/engine/relevance-constants.js';
import { applyWallHeavyVirtualView, getLiveHeavyViewerCount } from '../public/spatial-v2/camera/provider/heavy-viewer.js';
import { deriveGuidedNext, GUIDED_CONTROL, resetGuidedNextState } from '../public/spatial-v2/camera/guided-next.js';
import { renderCameraWallSurface } from '../public/spatial-v2/shell/CameraWallSurface.js';
import { renderCameraRelevanceSurface } from '../public/spatial-v2/shell/CameraRelevanceSurface.js';
import { renderGuidedNextSurface } from '../public/spatial-v2/shell/GuidedNextSurface.js';
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

test('1-2 compact selector strip matches wall slots and concise fields', () => {
  isolate();
  generateCameraCoverage(focus());
  const wall = buildRelevantCameraWall(queryRelevantCameras({ focusRef: focus() }));
  const html = renderCameraWallSurface();
  assert.equal(wall.slotCount, 3);
  assert.match(html, /data-iqai-camera-wall-slots/);
  assert.match(html, /data-iqai-camera-wall-contained="true"/);
  const surface = fs.readFileSync(path.join(V2, 'shell', 'CameraWallSurface.js'), 'utf8');
  assert.match(surface, /selector-label/);
  assert.match(surface, /selector-distance/);
  assert.match(surface, /selector-provider/);
  assert.match(surface, /selector-captured/);
  assert.doesNotMatch(surface, /fovLabel/);
  assert.doesNotMatch(surface, /PIXEL DENSITY/);
  restore();
});

test('3-7 contained large viewer; CameraRef and provider identity; virtual view; maxHeavy=1', () => {
  isolate();
  const html = renderCameraWallSurface();
  const css = fs.readFileSync(path.join(V2, 'iqai-spatial-v2.css'), 'utf8');
  const wallJs = fs.readFileSync(path.join(V2, 'shell', 'CameraWallSurface.js'), 'utf8');
  assert.match(html, /data-iqai-camera-wall-heavy-stage/);
  assert.match(css, /inset: 0/);
  assert.match(css, /overflow: hidden/);
  assert.match(wallJs, /data-iqai-pane="STREET 360"/);
  assert.doesNotMatch(css, /left: 0\.7rem;\s*right: 14\.6rem;\s*bottom: 0\.7rem/);
  generateCameraCoverage(focus());
  const cameras = listAuthoredCameras();
  const refs = cameras.map((item) => createCameraRef(item.cameraId));
  const wall = buildRelevantCameraWall(queryRelevantCameras({ focusRef: focus() }));
  assert.equal(wall.maxHeavyViewers, TRI_VIEW_HEAVY_BUDGET);
  assert.equal(getLiveHeavyViewerCount() <= 1, true);
  applyWallHeavyVirtualView({ heading: 20, pitch: 4, zoom: 1.5 });
  assert.deepEqual(listAuthoredCameras().map((item) => createCameraRef(item.cameraId)), refs);
  restore();
});

test('8-10 DETAILS keeps engineering truth; right panel is command; editor collapses', () => {
  const command = renderCameraRelevanceSurface();
  const wall = renderCameraWallSurface();
  const host = fs.readFileSync(path.join(V2, 'hosts', 'view-host.js'), 'utf8');
  const place = fs.readFileSync(path.join(V2, 'shell', 'PlaceCameraControl.js'), 'utf8');
  assert.match(command, /data-iqai-camera-command-details/);
  assert.match(command, /PLAN GEOMETRY · VISIBILITY NOT TESTED/);
  assert.match(command, /WAITING FOR FOCUS OR SELECTION/);
  assert.match(command, /GENERATE CAMERA COVERAGE/);
  assert.match(command, /PLAN CAMERAS/);
  assert.match(command, /LOOK AROUND A LOCATION/);
  assert.doesNotMatch(command, /iqai-v2-camera-relevance__row[\s\S]*CAMERA 01[\s\S]*CAMERA 02[\s\S]*CAMERA 03/);
  assert.match(wall, /data-iqai-camera-wall-active-camera/);
  assert.match(wall, /data-iqai-camera-wall-pose-truth/);
  assert.match(host, /data-iqai-camera-manual/);
  assert.match(host, /data-iqai-place-camera-edit/);
  assert.match(host, /data-iqai-place-camera-fields/);
  assert.match(place, /editing = !editing/);
  restore();
});

test('11-13 Guided Next presentation compact; logic unchanged; one green', () => {
  isolate();
  const chip = renderGuidedNextSurface();
  const engine = fs.readFileSync(path.join(V2, 'camera', 'guided-next.js'), 'utf8');
  assert.match(chip, /data-iqai-guided-action/);
  assert.doesNotMatch(chip, /GUIDED NEXT<\/p>/);
  assert.match(engine, /GUIDED_STATE/);
  assert.doesNotMatch(engine, /buildRelevantCameraWall/);
  const next = deriveGuidedNext({
    enabled: true,
    focusRef: focus(),
    autoPlanCameras: [],
    wall: { open: false, slots: [] }
  });
  assert.equal(next.targetControl, GUIDED_CONTROL.LOOK_AROUND);
  assert.equal(next.greenCount, 1);
  restore();
});

test('14-16 CLOSE / reload / BUILD preserved', () => {
  isolate();
  const storage = {
    data: {},
    getItem(key) { return this.data[key] || null; },
    setItem(key, value) { this.data[key] = String(value); }
  };
  configureAuthoredCameraPersistence({ storage, enabled: true });
  generateCameraCoverage(focus());
  const ids = listAuthoredCameras().map((item) => item.cameraId);
  buildRelevantCameraWall(queryRelevantCameras({ focusRef: focus() }));
  closeCameraWall();
  assert.equal(getCameraWallSnapshot().open, false);
  assert.deepEqual(listAuthoredCameras().map((item) => item.cameraId), ids);
  resetAuthoredCameras({ persist: false });
  resetCameraWall({ emit: false });
  hydrateAuthoredCameras();
  assert.equal(getCameraWallSnapshot().open, false);
  const reopened = buildRelevantCameraWall(queryRelevantCameras({ focusRef: focus() }));
  assert.equal(reopened.open, true);
  assert.equal(reopened.slotCount, 3);
  restore();
});

test('17-20 AUTO_PLAN, pose, SelectionSet, one MapView; maximize/restore is expanded pane state', async () => {
  isolate();
  const plan = generateCameraCoverage(focus());
  const poses = listAuthoredCameras().map(poseOf);
  const chassis = createSpatialV2Chassis();
  await chassis.executeChassis(CAMERA_QUERY_CAPABILITY, { focusRef: focus() });
  const world = chassis.stateStore.getSnapshot();
  assert.equal(plan.ok, true);
  assert.equal(plan.cameraCount, 3);
  assert.ok(listAuthoredCameras().every((item) => item.creationMode === CREATION_MODE.AUTO_PLAN));
  applyWallHeavyVirtualView({ heading: 11, pitch: 3, zoom: 2 });
  assert.deepEqual(listAuthoredCameras().map(poseOf), poses);
  assert.equal((world.selection?.objectRefs || []).some((ref) => isObjectRef(ref) && ref.authority === CAMERA_REF_AUTHORITY), false);
  assert.equal(listAuthoredCameras().every((item) => isCameraRef(createCameraRef(item.cameraId))), true);
  const frame = fs.readFileSync(path.join(V2, 'shell', 'WorldViewFrame.js'), 'utf8');
  const host = fs.readFileSync(path.join(V2, 'hosts', 'view-host.js'), 'utf8');
  const foundation = fs.readFileSync(path.join(V2, 'map', 'map-foundation.js'), 'utf8');
  assert.match(frame, /async function maximize/);
  assert.match(frame, /async function restore/);
  assert.match(frame, /Escape/);
  assert.match(frame, /LAYOUT_PANES/);
  assert.doesNotMatch(frame, /new MapView\(/);
  assert.match(host, /data-iqai-layout="1"/);
  assert.match(host, /data-iqai-layout="4"/);
  assert.match(host, /data-iqai-pane-maximize="STREET 360"/);
  assert.match(host, /data-iqai-camera-pane-host/);
  assert.equal((foundation.match(/new MapView\(/g) || []).length, 1);
  restore();
});
