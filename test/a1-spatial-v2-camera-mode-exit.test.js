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
import { resetCameraQuerySnapshot } from '../public/spatial-v2/camera/spatial-camera-adapter.js';
import { CAMERA_QUERY_CAPABILITY } from '../public/spatial-v2/camera/engine/relevance-constants.js';
import {
  enlargeWallSlot,
  getCameraWallSnapshot,
  resetCameraWall,
  restoreWallTriView
} from '../public/spatial-v2/camera/engine/camera-wall.js';
import {
  generateCameraCoverage,
  resetCoveragePlanState
} from '../public/spatial-v2/camera/engine/coverage-plan.js';
import { applyWallHeavyVirtualView } from '../public/spatial-v2/camera/provider/heavy-viewer.js';
import { renderCameraWallSurface } from '../public/spatial-v2/shell/CameraWallSurface.js';
import { clearHydrantRecords } from '../public/spatial-v2/map/woa/hydrant-object.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const V2 = path.join(ROOT, 'public', 'spatial-v2');
const COMMUNE = Object.freeze({ longitude: -73.553221995734, latitude: 45.494180980834 });

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

function focus(point = COMMUNE) {
  return createDropPinFocusRef({ ...point, sourceView: VIEW_ID.MAP });
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

test('1-2 CAMERA MODE indicator and BACK TO MAIN VIEW only in visualization', () => {
  isolate();
  const host = fs.readFileSync(path.join(V2, 'hosts', 'view-host.js'), 'utf8');
  const frame = fs.readFileSync(path.join(V2, 'shell', 'WorldViewFrame.js'), 'utf8');
  assert.match(host, /data-iqai-camera-mode-indicator>CAMERA MODE/);
  assert.match(host, /data-iqai-camera-back-main>← BACK TO MAIN VIEW/);
  assert.match(host, /data-iqai-camera-mode-bar hidden/);
  assert.match(frame, /modeBar.hidden = !cameraViz/);
  assert.match(frame, /async function backToMainView/);
  restore();
});

test('3-6 BACK restores workspace and preserves cameras, target, AUTO_PLAN', async () => {
  isolate();
  const frame = fs.readFileSync(path.join(V2, 'shell', 'WorldViewFrame.js'), 'utf8');
  const session = fs.readFileSync(path.join(V2, 'bootstrap', 'worldview-map-session.js'), 'utf8');
  assert.match(frame, /await applyLayout\(saved.layout, saved.pairView\)/);
  assert.match(session, /backToMainView: async/);
  assert.match(session, /await cameraWall.close/);
  const chassis = createSpatialV2Chassis();
  await chassis.executeChassis(CAMERA_QUERY_CAPABILITY, { focusRef: focus() });
  const plan = generateCameraCoverage(focus());
  assert.equal(plan.ok, true);
  const before = listAuthoredCameras().map(poseOf);
  assert.equal(before.length, 3);
  assert.ok(before.every((item) => item.cameraId));
  applyWallHeavyVirtualView({ heading: 20, pitch: 4, zoom: 1.2 });
  assert.deepEqual(listAuthoredCameras().map(poseOf), before);
  assert.ok(listAuthoredCameras().every((item) => item.creationMode === CREATION_MODE.AUTO_PLAN));
  const world = chassis.stateStore.getSnapshot();
  assert.equal((world.selection?.objectRefs || []).some((ref) => isObjectRef(ref) && ref.authority === CAMERA_REF_AUTHORITY), false);
  restore();
});

test('7-8 1/2/3/4 disabled in Camera Mode and re-enabled after exit', () => {
  isolate();
  const frame = fs.readFileSync(path.join(V2, 'shell', 'WorldViewFrame.js'), 'utf8');
  const host = fs.readFileSync(path.join(V2, 'hosts', 'view-host.js'), 'utf8');
  const css = fs.readFileSync(path.join(V2, 'iqai-spatial-v2.css'), 'utf8');
  assert.match(host, /data-iqai-layout="1"/);
  assert.match(host, /data-iqai-layout="4"/);
  assert.match(frame, /button.disabled = cameraViz/);
  assert.match(frame, /CAMERA MODE ACTIVE — USE BACK TO MAIN VIEW/);
  assert.match(frame, /if \(cameraViz\) return snapshot\(\);/);
  assert.match(frame, /async function applyLayout/);
  assert.match(css, /is-camera-mode-locked/);
  restore();
});

test('9-10 Esc restores 3-UP when enlarged, otherwise BACK TO MAIN VIEW', () => {
  isolate();
  const wall = fs.readFileSync(path.join(V2, 'shell', 'CameraWallSurface.js'), 'utf8');
  const frame = fs.readFileSync(path.join(V2, 'shell', 'WorldViewFrame.js'), 'utf8');
  assert.match(wall, /if \(wall\?\.enlargedSlotId\)/);
  assert.match(wall, /restoreTri\(\)/);
  assert.match(wall, /if \(wall\?\.open === true\)/);
  assert.match(wall, /void close\(\)/);
  assert.match(frame, /if \(cameraViz\) \{/);
  assert.match(frame, /void backToMainView\(\)/);
  generateCameraCoverage(focus());
  assert.equal(typeof enlargeWallSlot, 'function');
  assert.equal(typeof restoreWallTriView, 'function');
  restoreWallTriView();
  assert.equal(getCameraWallSnapshot().enlargedSlotId, null);
  restore();
});

test('11-16 directional camera glyph, FOV, exact pose, distinct 360 ring', () => {
  isolate();
  const overlay = fs.readFileSync(path.join(V2, 'map', 'place-camera-overlay.js'), 'utf8');
  const visual = fs.readFileSync(path.join(V2, 'map', 'visual-coverage-overlay.js'), 'utf8');
  assert.match(overlay, /data-iqai-planned-camera-glyph': 'cctv'/);
  assert.match(overlay, /data-iqai-planned-heading-deg/);
  assert.match(overlay, /rotate\(\$\{heading\}/);
  assert.match(overlay, /data-iqai-planned-fov/);
  assert.match(overlay, /PLANNED FOV · NOT LOS/);
  assert.match(visual, /data-iqai-360-ring/);
  assert.match(visual, /VIEW DIRECTION/);
  assert.doesNotMatch(visual, /data-iqai-planned-camera-glyph/);
  const plan = generateCameraCoverage(focus());
  const camera = listAuthoredCameras()[0];
  assert.equal(camera.longitude, plan.cameras[0].longitude);
  assert.equal(camera.latitude, plan.cameras[0].latitude);
  restore();
});

test('17-19 CameraPose, one MapView, wall chrome, Camera suites still present', async () => {
  isolate();
  generateCameraCoverage(focus());
  const poses = listAuthoredCameras().map(poseOf);
  applyWallHeavyVirtualView({ heading: 40, pitch: 8, zoom: 2 });
  assert.deepEqual(listAuthoredCameras().map(poseOf), poses);
  const foundation = fs.readFileSync(path.join(V2, 'map', 'map-foundation.js'), 'utf8');
  assert.equal((foundation.match(/new MapView\(/g) || []).length, 1);
  const html = renderCameraWallSurface();
  assert.match(html, /RESTORE 3-UP/);
  assert.ok(isCameraRef(createCameraRef(poses[0].cameraId)));
  restore();
});

test('20-24 Camera Mode lock, labeled recovery, BACK always exits, overlay contrast', () => {
  isolate();
  const frame = fs.readFileSync(path.join(V2, 'shell', 'WorldViewFrame.js'), 'utf8');
  const host = fs.readFileSync(path.join(V2, 'hosts', 'view-host.js'), 'utf8');
  const session = fs.readFileSync(path.join(V2, 'bootstrap', 'worldview-map-session.js'), 'utf8');
  const wall = fs.readFileSync(path.join(V2, 'shell', 'CameraWallSurface.js'), 'utf8');
  const overlay = fs.readFileSync(path.join(V2, 'map', 'place-camera-overlay.js'), 'utf8');
  const css = fs.readFileSync(path.join(V2, 'iqai-spatial-v2.css'), 'utf8');
  const switcher = fs.readFileSync(path.join(V2, 'shell', 'ViewSwitcher.js'), 'utf8');
  assert.match(frame, /CAMERA_MODE_LOCK_TITLE = 'CAMERA MODE ACTIVE — USE BACK TO MAIN VIEW'/);
  assert.match(frame, /if \(cameraViz\) return snapshot\(\);/);
  assert.match(frame, /paintCameraPaneRecovery/);
  assert.match(frame, /NO CAMERA VIEW ACTIVE/);
  assert.match(frame, /RETURN TO MAIN VIEW/);
  assert.match(host, /data-iqai-camera-pane-recovery/);
  assert.match(host, /NO CAMERA VIEW ACTIVE/);
  assert.match(host, /CAMERA MODE READY/);
  assert.match(host, /RETURN TO MAIN VIEW/);
  assert.match(wall, /LOADING CAMERA VIEW/);
  assert.match(wall, /await options.exitCameraVisualization/);
  assert.match(session, /worldViewFrame\?\.snapshot\?\.\(\)\?\.cameraViz === true/);
  assert.match(session, /if \(snap.cameraViz === true\) return snap;/);
  assert.match(switcher, /options.isCameraMode\?\.\(\) === true/);
  assert.match(overlay, /data-iqai-planned-camera-anchor/);
  assert.match(overlay, /data-iqai-plan-boundary-node/);
  assert.match(overlay, /#00e5ff/);
  assert.match(overlay, /#ff9f1c/);
  assert.match(css, /is-camera-mode-locked/);
  assert.match(css, /iqai-v2-camera-pane-recovery/);
  const beforeClose = wall.indexOf('await options.exitCameraVisualization');
  const park = wall.indexOf('await parkAllWallHeavyViewers');
  const lastPark = wall.lastIndexOf('await parkAllWallHeavyViewers');
  assert.ok(beforeClose > -1 && lastPark > beforeClose);
  restore();
});
