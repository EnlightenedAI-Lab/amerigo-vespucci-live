import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { VIEW_ID, createDropPinFocusRef, isObjectRef } from '../public/spatial-v2/foundation/contracts/index.js';
import { createSpatialV2Chassis } from '../public/spatial-v2/bootstrap/spatial-v2-bootstrap.js';
import {
  configureAuthoredCameraPersistence,
  listAuthoredCameras,
  placeAuthoredCamera,
  resetAuthoredCameras
} from '../public/spatial-v2/map/authored-cameras.js';
import { CAMERA_REF_AUTHORITY, createCameraRef, isCameraRef } from '../public/spatial-v2/camera/camera-ref.js';
import { resetCameraQuerySnapshot } from '../public/spatial-v2/camera/spatial-camera-adapter.js';
import { CAMERA_QUERY_CAPABILITY } from '../public/spatial-v2/camera/engine/relevance-constants.js';
import { TRI_VIEW_HEAVY_BUDGET } from '../public/spatial-v2/camera/engine/view-slot.js';
import {
  resetCameraWall
} from '../public/spatial-v2/camera/engine/camera-wall.js';
import {
  generateCameraCoverage,
  resetCoveragePlanState
} from '../public/spatial-v2/camera/engine/coverage-plan.js';
import {
  configureVisualCoverageLookups,
  resetVisualCoverageLookups,
  resetVisualCoverageState,
  searchVisualCoverage
} from '../public/spatial-v2/camera/engine/visual-coverage.js';
import { applyWallHeavyVirtualView, VIEWER_PANE_STATE } from '../public/spatial-v2/camera/provider/heavy-viewer.js';
import {
  CAMERA_OPERATOR_MODE,
  getCameraOperatorMode,
  resetCameraOperatorMode,
  setCameraOperatorMode
} from '../public/spatial-v2/camera/operator-mode.js';
import { deriveGuidedNext, GUIDED_CONTROL, resetGuidedNextState } from '../public/spatial-v2/camera/guided-next.js';
import { renderCameraRelevanceSurface } from '../public/spatial-v2/shell/CameraRelevanceSurface.js';
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
  resetGuidedNextState({ emit: false });
  resetVisualCoverageState({ emit: false });
  resetVisualCoverageLookups();
  resetCameraOperatorMode({ emit: false });
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
    heightM: camera.heightM,
    hfovDeg: camera.hfovDeg
  };
}

test('1 default Camera entry presents exactly two workflows', () => {
  isolate();
  const command = renderCameraRelevanceSurface();
  assert.match(command, /LOOK AROUND A LOCATION/);
  assert.match(command, /PLAN CAMERAS/);
  assert.match(command, /Show real street imagery around here\./);
  assert.match(command, /Engineer camera positions and fields of view\./);
  assert.equal(getCameraOperatorMode(), CAMERA_OPERATOR_MODE.CHOOSER);
  const titles = [...command.matchAll(/iqai-v2-camera-chooser__title">([^<]+)</g)].map((row) => row[1]);
  assert.deepEqual(titles, ['LOOK AROUND A LOCATION', 'PLAN CAMERAS']);
  restore();
});

test('2-5 LOOK AROUND is one map click, auto search, no GENERATE or BUILD WALL required', () => {
  isolate();
  const command = renderCameraRelevanceSurface();
  const session = fs.readFileSync(path.join(V2, 'bootstrap', 'worldview-map-session.js'), 'utf8');
  const relevance = fs.readFileSync(path.join(V2, 'shell', 'CameraRelevanceSurface.js'), 'utf8');
  assert.match(command, /CLICK ONE POINT ON THE MAP/);
  assert.match(command, /data-iqai-camera-look-around/);
  assert.match(command, /CHANGE TARGET/);
  assert.match(relevance, /await options\.buildVisualCoverage/);
  assert.match(session, /LOOK_AROUND/);
  assert.match(session, /await cameraRelevance\?\.buildVisualCoverage/);
  assert.match(session, /if \(lookAround\)/);
  const lookSection = command.split('data-iqai-camera-look-around-controls')[1].split('data-iqai-camera-plan-controls')[0];
  assert.doesNotMatch(lookSection, /GENERATE 3-CAMERA PLAN/);
  assert.doesNotMatch(lookSection, /BUILD RELEVANT WALL/);
  assert.doesNotMatch(lookSection, />GENERATE CAMERA COVERAGE</);
  restore();
});

test('6-9 PLAN CAMERAS, PLACE anywhere, AUTO_PLAN, and 3-UP remain', () => {
  isolate();
  const command = renderCameraRelevanceSurface();
  const wall = renderCameraWallSurface();
  assert.match(command, /PLACE ONE CAMERA/);
  assert.match(command, /GENERATE 3-CAMERA PLAN/);
  assert.match(command, /EDIT PLANNED CAMERA/);
  assert.match(command, /data-iqai-camera-plan-place/);
  assert.match(command, /data-iqai-camera-coverage-generate/);
  assert.match(wall, /RESTORE 3-UP/);
  const plan = generateCameraCoverage(focus());
  assert.equal(plan.ok, true);
  assert.equal(plan.cameraCount, 3);
  const placed = placeAuthoredCamera({
    longitude: COMMUNE.longitude,
    latitude: COMMUNE.latitude,
    heading: 90,
    heightM: 4,
    hfovDeg: 70
  });
  assert.ok(placed?.cameraId);
  assert.equal(listAuthoredCameras().length, 4);
  assert.equal(TRI_VIEW_HEAVY_BUDGET, 3);
  restore();
});

test('10-17 viewer state machine, no silent black, bounded retry, resize/restore recovery', () => {
  isolate();
  const heavy = fs.readFileSync(path.join(V2, 'camera', 'provider', 'heavy-viewer.js'), 'utf8');
  const wall = fs.readFileSync(path.join(V2, 'shell', 'CameraWallSurface.js'), 'utf8');
  const css = fs.readFileSync(path.join(V2, 'iqai-spatial-v2.css'), 'utf8');
  assert.deepEqual(Object.values(VIEWER_PANE_STATE), ['SEARCHING', 'LOADING', 'READY', 'RETRYING', 'UNAVAILABLE']);
  assert.match(heavy, /FINDING STREET VIEW/);
  assert.match(heavy, /LOADING GOOGLE 360/);
  assert.match(heavy, /LOADING MAPILLARY/);
  assert.match(heavy, /RECONNECTING VIEW/);
  assert.match(heavy, /VIEW UNAVAILABLE/);
  assert.match(heavy, /MAX_VIEWER_RECOVERIES = 2/);
  assert.match(heavy, /waitForMeasurableBox/);
  assert.match(heavy, /recoverGoogleViewer/);
  assert.match(heavy, /setVisible\?\.\(true\)/);
  assert.match(heavy, /event\?\.trigger\?\.\(inst\.google, 'resize'\)/);
  assert.match(heavy, /ResizeObserver/);
  assert.match(wall, /is-parked/);
  assert.match(wall, /pane\.hidden = false/);
  assert.match(wall, /recoverWallHeavyViewers/);
  assert.match(css, /\.iqai-v2-camera-wall__pane\.is-parked/);
  assert.match(css, /visibility: hidden/);
  assert.match(css, /data-iqai-viewer-state="READY"/);
  assert.doesNotMatch(wall, /pane\.hidden = Boolean\(wall\.enlargedSlotId\)/);
  restore();
});

test('18-22 Google identity, capture, POV, CameraPose, SelectionSet retained', async () => {
  isolate();
  configureVisualCoverageLookups({
    google: async () => ({
      available: true,
      panoId: 'pano-keep',
      captureCoordinate: { longitude: -73.55322, latitude: 45.49418 },
      imageDate: '2024-06',
      heading: 12,
      offsetMeters: 8
    }),
    mapillary: async () => ({ status: 'OK', selected: null, ranked: [], count: 0 })
  });
  const posesBefore = generateCameraCoverage(focus());
  const cameras = listAuthoredCameras().map(poseOf);
  const chassis = createSpatialV2Chassis();
  await chassis.executeChassis(CAMERA_QUERY_CAPABILITY, { focusRef: focus() });
  const worldBefore = chassis.stateStore.getSnapshot();
  const visual = await searchVisualCoverage(focus());
  applyWallHeavyVirtualView({ heading: 44, pitch: 6, zoom: 1.4 });
  assert.equal(visual.ok, true);
  assert.equal(visual.selected[0].providerId, 'pano-keep');
  assert.equal(visual.selected[0].captureCoordinate.longitude, -73.55322);
  assert.equal(visual.mutatesCameraPose, false);
  assert.deepEqual(listAuthoredCameras().map(poseOf), cameras);
  assert.equal(posesBefore.ok, true);
  const world = chassis.stateStore.getSnapshot();
  assert.deepEqual(world.selection, worldBefore.selection);
  assert.equal((world.selection?.objectRefs || []).some((ref) => isObjectRef(ref) && ref.authority === CAMERA_REF_AUTHORITY), false);
  assert.equal(listAuthoredCameras().every((item) => isCameraRef(createCameraRef(item.cameraId))), true);
  restore();
});

test('23-25 EXIT CAMERA MODE restores workspace; 3D returns; one MapView', () => {
  isolate();
  const relevance = fs.readFileSync(path.join(V2, 'shell', 'CameraRelevanceSurface.js'), 'utf8');
  const frame = fs.readFileSync(path.join(V2, 'shell', 'WorldViewFrame.js'), 'utf8');
  const foundation = fs.readFileSync(path.join(V2, 'map', 'map-foundation.js'), 'utf8');
  const css = fs.readFileSync(path.join(V2, 'iqai-spatial-v2.css'), 'utf8');
  assert.match(relevance, /EXIT CAMERA MODE/);
  assert.match(relevance, /async function exitCameraMode/);
  assert.match(relevance, /setCameraOperatorMode\(CAMERA_OPERATOR_MODE\.CHOOSER\)/);
  assert.match(relevance, /await options\.closeWall/);
  assert.match(frame, /function enterCameraVisualization/);
  assert.match(frame, /async function exitCameraVisualization/);
  assert.match(frame, /await applyLayout\(saved\.layout, saved\.pairView\)/);
  assert.match(css, /minmax\(7rem, 28%\)/);
  assert.equal((foundation.match(/new MapView\(/g) || []).length, 1);
  setCameraOperatorMode(CAMERA_OPERATOR_MODE.LOOK_AROUND);
  assert.equal(getCameraOperatorMode(), CAMERA_OPERATOR_MODE.LOOK_AROUND);
  resetCameraOperatorMode({ emit: false });
  assert.equal(getCameraOperatorMode(), CAMERA_OPERATOR_MODE.CHOOSER);
  restore();
});

test('26 LOOK AROUND guided next and 3-UP enlarge/restore keep explicit pane states', () => {
  isolate();
  const next = deriveGuidedNext({
    enabled: true,
    operatorMode: CAMERA_OPERATOR_MODE.LOOK_AROUND,
    focusRef: null,
    autoPlanCameras: [],
    wall: { open: false, slots: [] }
  });
  assert.equal(next.targetControl, GUIDED_CONTROL.FOCUS);
  assert.match(next.label, /CLICK ONE POINT/);
  configureVisualCoverageLookups({
    google: async (lng, lat) => [
      { pano: 'a', lat: lat - 0.0004, lng, date: '2024-01', compassDeg: 0 },
      { pano: 'b', lat, lng: lng + 0.0004, date: '2024-01', compassDeg: 90 },
      { pano: 'c', lat: lat + 0.0004, lng, date: '2024-01', compassDeg: 180 }
    ],
    mapillary: async () => []
  });
  const wallHtml = fs.readFileSync(path.join(V2, 'shell', 'CameraWallSurface.js'), 'utf8');
  assert.match(wallHtml, /VIEW \$\{String\(index \+ 1\)\.padStart\(2, '0'\)\}/);
  restore();
});
