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
  resetAuthoredCameras,
  updateAuthoredCamera
} from '../public/spatial-v2/map/authored-cameras.js';
import { CAMERA_REF_AUTHORITY, createCameraRef, isCameraRef } from '../public/spatial-v2/camera/camera-ref.js';
import { queryRelevantCameras, resetCameraQuerySnapshot } from '../public/spatial-v2/camera/spatial-camera-adapter.js';
import { CAMERA_QUERY_CAPABILITY } from '../public/spatial-v2/camera/engine/relevance-constants.js';
import { buildRelevantCameraWall, resetCameraWall } from '../public/spatial-v2/camera/engine/camera-wall.js';
import {
  COVERAGE_CAMERA_COUNT,
  COVERAGE_PLAN_ALGORITHM,
  clearAllCameras,
  generateCameraCoverage,
  getLastCoveragePlan,
  resetCoveragePlanState
} from '../public/spatial-v2/camera/engine/coverage-plan.js';
import {
  FOUR_DIRECTION_HONESTY,
  ORIENTATION_INTENT,
  PERIMETER_HONESTY,
  POINT_HONESTY,
  TARGET_GEOMETRY,
  cameraLooksInward,
  cameraLooksOutward,
  closePolygonRing,
  distanceToPolygonPath,
  getCoverageIntentSnapshot,
  resetCoverageIntent,
  sectorFromTarget,
  setCoverageOrientation,
  setCoveragePattern,
  setCoveragePolygon
} from '../public/spatial-v2/camera/engine/coverage-intent.js';
import { headingFromPoints, wrapHeading } from '../public/spatial-v2/camera/engine/geodesy.js';
import { CAMERA_OPERATOR_MODE, resetCameraOperatorMode } from '../public/spatial-v2/camera/operator-mode.js';
import { renderCameraRelevanceSurface } from '../public/spatial-v2/shell/CameraRelevanceSurface.js';
import { clearHydrantRecords } from '../public/spatial-v2/map/woa/hydrant-object.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const V2 = path.join(ROOT, 'public', 'spatial-v2');
const COMMUNE = Object.freeze({ longitude: -73.553221995734, latitude: 45.494180980834 });
const BLOCK = Object.freeze([
  { longitude: -73.55380, latitude: 45.49462 },
  { longitude: -73.55255, latitude: 45.49462 },
  { longitude: -73.55255, latitude: 45.49378 },
  { longitude: -73.55380, latitude: 45.49378 }
]);

function isolate() {
  configureAuthoredCameraPersistence({ storage: null, enabled: false });
  resetAuthoredCameras({ persist: false });
  resetCameraQuerySnapshot();
  resetCameraWall({ emit: false });
  resetCoveragePlanState();
  resetCoverageIntent({ emit: false });
  resetCameraOperatorMode({ emit: false });
  clearHydrantRecords();
}

function restore() {
  isolate();
  configureAuthoredCameraPersistence({ storage: null, enabled: true });
}

function focus() {
  return createDropPinFocusRef({ ...COMMUNE, sourceView: VIEW_ID.MAP });
}

test('1-3 POINT plan remains 3 inward AUTO_PLAN cameras', () => {
  isolate();
  const plan = generateCameraCoverage(focus());
  assert.equal(plan.ok, true);
  assert.equal(plan.cameraCount, COVERAGE_CAMERA_COUNT);
  assert.equal(plan.algorithm, COVERAGE_PLAN_ALGORITHM);
  assert.equal(plan.coverageIntent.pattern, TARGET_GEOMETRY.POINT);
  assert.equal(listAuthoredCameras().length, 3);
  for (const camera of listAuthoredCameras()) {
    assert.equal(camera.creationMode, CREATION_MODE.AUTO_PLAN);
    assert.equal(cameraLooksInward(camera, COMMUNE), true);
    assert.equal(isCameraRef(createCameraRef(camera.cameraId)), true);
  }
  assert.match(plan.honesty, /3-CAMERA POINT PLAN/);
  assert.match(POINT_HONESTY, /NOT LOS/);
  restore();
});

test('4-8 FOUR_DIRECTION creates 4 geometric sector cameras', () => {
  isolate();
  const inward = generateCameraCoverage(focus(), {
    pattern: TARGET_GEOMETRY.FOUR_DIRECTION,
    orientation: ORIENTATION_INTENT.INWARD
  });
  assert.equal(inward.ok, true);
  assert.equal(inward.cameraCount, 4);
  assert.equal(listAuthoredCameras().length, 4);
  const sectors = new Set(listAuthoredCameras().map((camera) => sectorFromTarget(COMMUNE, camera)));
  assert.deepEqual([...sectors].sort(), ['E', 'N', 'S', 'W']);
  assert.equal(listAuthoredCameras().every((camera) => cameraLooksInward(camera, COMMUNE)), true);
  assert.match(inward.honesty, /NOT ROAD-NETWORK AWARE/);
  assert.match(FOUR_DIRECTION_HONESTY, /FOUR-DIRECTION GEOMETRIC PLAN/);

  const outward = generateCameraCoverage(focus(), {
    pattern: TARGET_GEOMETRY.FOUR_DIRECTION,
    orientation: ORIENTATION_INTENT.OUTWARD
  });
  assert.equal(outward.cameraCount, 4);
  assert.equal(listAuthoredCameras().every((camera) => cameraLooksOutward(camera, COMMUNE)), true);
  assert.equal(listAuthoredCameras().every((camera) => cameraLooksInward(camera, COMMUNE)), false);
  restore();
});

test('9-15 PERIMETER polygon target places 4 cameras on the path', () => {
  isolate();
  const missing = generateCameraCoverage(focus(), { pattern: TARGET_GEOMETRY.PERIMETER });
  assert.equal(missing.ok, false);
  assert.equal(missing.reason, 'POLYGON_TARGET_REQUIRED');

  setCoveragePolygon(BLOCK);
  const intent = getCoverageIntentSnapshot();
  assert.equal(intent.pattern, TARGET_GEOMETRY.POINT);
  const ring = closePolygonRing(BLOCK);
  const inward = generateCameraCoverage(null, {
    pattern: TARGET_GEOMETRY.PERIMETER,
    orientation: ORIENTATION_INTENT.INWARD,
    polygon: BLOCK
  });
  assert.equal(inward.ok, true);
  assert.equal(inward.cameraCount, 4);
  const centroid = inward.target;
  assert.ok(centroid);
  for (const camera of listAuthoredCameras()) {
    assert.ok(distanceToPolygonPath(camera, ring) < 8);
    assert.equal(cameraLooksInward(camera, centroid), true);
  }
  assert.match(inward.honesty, /GEOMETRIC PERIMETER CAMERA PLAN/);
  assert.match(PERIMETER_HONESTY, /NOT TERRAIN OPTIMIZED/);
  assert.match(PERIMETER_HONESTY, /NOT ROAD-AWARE/);
  assert.ok(inward.polygon);
  assert.notEqual(inward.polygon, inward.cameras);

  const outward = generateCameraCoverage(null, {
    pattern: TARGET_GEOMETRY.PERIMETER,
    orientation: ORIENTATION_INTENT.OUTWARD,
    polygon: BLOCK
  });
  assert.equal(outward.cameraCount, 4);
  assert.equal(listAuthoredCameras().every((camera) => cameraLooksOutward(camera, outward.target)), true);
  restore();
});

test('PERIMETER / FOUR SIDES wall opens all 4 cameras live', () => {
  isolate();
  const plan = generateCameraCoverage(focus(), {
    pattern: TARGET_GEOMETRY.FOUR_DIRECTION,
    orientation: ORIENTATION_INTENT.INWARD
  });
  assert.equal(plan.cameraCount, 4);
  const query = queryRelevantCameras({ focusRef: focus() });
  const wall = buildRelevantCameraWall(query);
  assert.equal(wall.slotCount, 4);
  assert.equal(wall.layout, 4);
  assert.equal(wall.maxHeavyViewers, 4);
  restore();
});

test('16-20 map overlays keep target, plan boundary, CCTV, FOV, and 360 distinct', () => {
  isolate();
  const overlay = fs.readFileSync(path.join(V2, 'map', 'place-camera-overlay.js'), 'utf8');
  const visual = fs.readFileSync(path.join(V2, 'map', 'visual-coverage-overlay.js'), 'utf8');
  const html = renderCameraRelevanceSurface();
  assert.match(overlay, /data-iqai-plan-boundary/);
  assert.match(overlay, /data-iqai-coverage-target/);
  assert.match(overlay, /TARGET AREA/);
  assert.match(overlay, /data-iqai-planned-camera-glyph': 'cctv'/);
  assert.match(overlay, /data-iqai-planned-fov/);
  assert.match(overlay, /#00e5ff/);
  assert.match(overlay, /#ff9f1c/);
  assert.match(visual, /data-iqai-360-ring/);
  assert.doesNotMatch(visual, /data-iqai-planned-camera-glyph/);
  assert.match(html, /WHAT ARE YOU COVERING\?/);
  assert.match(html, />POINT</);
  assert.match(html, />FOUR SIDES</);
  assert.match(html, />PERIMETER</);
  assert.match(html, />INWARD</);
  assert.match(html, />OUTWARD</);
  restore();
});

test('21-25 CameraRef, CameraPose, PLACE CAMERA, manual edit, and reload remain', () => {
  isolate();
  const storage = new Map();
  const mem = {
    getItem: (key) => (storage.has(key) ? storage.get(key) : null),
    setItem: (key, value) => storage.set(key, value)
  };
  configureAuthoredCameraPersistence({ storage: mem, enabled: true });
  const plan = generateCameraCoverage(focus(), {
    pattern: TARGET_GEOMETRY.FOUR_DIRECTION,
    orientation: ORIENTATION_INTENT.INWARD
  });
  const ids = plan.cameras.map((camera) => camera.cameraId);
  const first = plan.cameras[0];
  const poseBefore = {
    longitude: first.longitude,
    latitude: first.latitude,
    heading: first.heading,
    horizontalFov: first.horizontalFov
  };
  const moved = updateAuthoredCamera(first.cameraId, {
    longitude: first.longitude + 0.0002,
    latitude: first.latitude
  });
  assert.equal(moved.operatorAdjusted, true);
  assert.match(moved.planningLabel, /OPERATOR ADJUSTED/);
  assert.equal(getLastCoveragePlan().planStatus, 'OPERATOR ADJUSTED');
  assert.equal(listAuthoredCameras().length, 4);
  assert.notEqual(moved.longitude, poseBefore.longitude);
  const others = listAuthoredCameras().filter((camera) => camera.cameraId !== first.cameraId);
  assert.equal(others.length, 3);
  const placed = placeAuthoredCamera({
    longitude: COMMUNE.longitude,
    latitude: COMMUNE.latitude,
    heading: 40,
    horizontalFov: 55
  });
  assert.equal(placed.creationMode, CREATION_MODE.OPERATOR_AUTHORED);
  assert.equal(listAuthoredCameras().length, 5);
  resetAuthoredCameras({ persist: false });
  hydrateAuthoredCameras();
  assert.equal(listAuthoredCameras().some((camera) => camera.cameraId === first.cameraId), true);
  assert.ok(ids.every((id) => createCameraRef(id).authority === CAMERA_REF_AUTHORITY));
  restore();
});

test('26-31 LOOK AROUND, Camera Mode, pose, SelectionSet, MapView, and regressions stay intact', async () => {
  isolate();
  const command = renderCameraRelevanceSurface();
  const overlay = fs.readFileSync(path.join(V2, 'map', 'place-camera-overlay.js'), 'utf8');
  const frame = fs.readFileSync(path.join(V2, 'shell', 'WorldViewFrame.js'), 'utf8');
  const host = fs.readFileSync(path.join(V2, 'hosts', 'view-host.js'), 'utf8');
  const session = fs.readFileSync(path.join(V2, 'bootstrap', 'worldview-map-session.js'), 'utf8');
  const foundation = fs.readFileSync(path.join(V2, 'map', 'map-foundation.js'), 'utf8');
  assert.match(command, /LOOK AROUND A LOCATION/);
  assert.match(command, /Show real street imagery around here\./);
  assert.match(command, /PLAN CAMERAS/);
  assert.match(frame, /BACK TO MAIN VIEW/);
  assert.match(host, /data-iqai-camera-mode-bar/);
  assert.match(host, /data-iqai-layout="1"/);
  assert.match(host, /data-iqai-layout="4"/);
  assert.match(frame, /CAMERA MODE ACTIVE — USE BACK TO MAIN VIEW/);
  assert.match(overlay, /data-iqai-planned-camera-glyph/);
  assert.match(session, /getCoverageIntentSnapshot/);
  assert.equal((foundation.match(/new MapView\(/g) || []).length, 1);
  assert.doesNotMatch(session, /new MapView\(/);
  const chassis = createSpatialV2Chassis({
    now: () => '2026-08-21T20:00:00.000Z',
    idFactory: () => 'coverage-intent-sel'
  });
  const plan = generateCameraCoverage(focus());
  const poses = listAuthoredCameras().map((camera) => ({
    cameraId: camera.cameraId,
    heading: camera.heading,
    longitude: camera.longitude,
    latitude: camera.latitude
  }));
  await chassis.executeChassis(CAMERA_QUERY_CAPABILITY, { focusRef: focus() });
  const selection = chassis.stateStore.getSnapshot().selection;
  assert.equal((selection.objectRefs || []).some((ref) => isCameraRef(ref)), false);
  assert.equal((selection.objectRefs || []).every((ref) => !ref || isObjectRef(ref)), true);
  assert.deepEqual(listAuthoredCameras().map((camera) => ({
    cameraId: camera.cameraId,
    heading: camera.heading,
    longitude: camera.longitude,
    latitude: camera.latitude
  })), poses);
  assert.equal(plan.visibilityTested, false);
  assert.equal(CAMERA_OPERATOR_MODE.LOOK_AROUND, 'LOOK_AROUND');
  setCoveragePattern(TARGET_GEOMETRY.FOUR_DIRECTION);
  setCoverageOrientation(ORIENTATION_INTENT.OUTWARD);
  resetCoverageIntent({ emit: false });
  assert.equal(getCoverageIntentSnapshot().pattern, TARGET_GEOMETRY.POINT);
  restore();
});

test('DELETE ALL CAMERAS wipes auto-plan and manual cameras from the workspace', () => {
  isolate();
  generateCameraCoverage(focus());
  placeAuthoredCamera({
    longitude: COMMUNE.longitude,
    latitude: COMMUNE.latitude,
    heading: 90,
    pitch: 0,
    heightAboveGround: 3,
    horizontalFov: 90,
    creationMode: CREATION_MODE.OPERATOR_AUTHORED
  });
  assert.ok(listAuthoredCameras().length >= 4);
  const html = renderCameraRelevanceSurface();
  const session = fs.readFileSync(path.join(V2, 'bootstrap', 'worldview-map-session.js'), 'utf8');
  assert.match(html, /DELETE ALL CAMERAS/);
  assert.match(html, /data-iqai-camera-clear-all/);
  assert.match(session, /clearAllCameras/);
  const result = clearAllCameras();
  assert.equal(result.ok, true);
  assert.equal(listAuthoredCameras().length, 0);
  assert.equal(getLastCoveragePlan(), null);
  assert.equal(getCoverageIntentSnapshot().pattern, TARGET_GEOMETRY.POINT);
  restore();
});
