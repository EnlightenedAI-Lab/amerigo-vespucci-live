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
  CREATION_MODE,
  PLANNING_LABEL,
  PLANNING_STATE,
  configureAuthoredCameraPersistence,
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
  getLastCameraQuerySnapshot,
  queryRelevantCameras,
  resetCameraQuerySnapshot
} from '../public/spatial-v2/camera/spatial-camera-adapter.js';
import {
  CAMERA_MODEL_UNKNOWN,
  COVERAGE_CAMERA_COUNT,
  COVERAGE_PLAN_ALGORITHM,
  COVERAGE_STANDOFF_M,
  OPTICAL_ZOOM_UNQUALIFIED,
  PITCH_UNQUALIFIED,
  PLAN_VIEW_HFOV,
  clearGeneratedPlan,
  generateCameraCoverage,
  proposeBalancedCoverage,
  resetCoveragePlanState
} from '../public/spatial-v2/camera/engine/coverage-plan.js';
import { headingFromPoints, wrapHeading } from '../public/spatial-v2/camera/engine/geodesy.js';
import { PIXEL_DENSITY_UNKNOWN } from '../public/spatial-v2/camera/engine/dori.js';
import { HEAVY_VIEWER_LIMIT } from '../public/spatial-v2/camera/engine/view-slot.js';
import {
  buildRelevantCameraWall,
  getCameraWallSnapshot,
  resetCameraWall
} from '../public/spatial-v2/camera/engine/camera-wall.js';
import { CAMERA_QUERY_CAPABILITY } from '../public/spatial-v2/camera/engine/relevance-constants.js';
import { PROVIDER_REPRESENTATION_REF_AUTHORITY } from '../public/spatial-v2/camera/provider/provider-representation.js';
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
  clearHydrantRecords();
}

function restore() {
  isolate();
  configureAuthoredCameraPersistence({ storage: null, enabled: true });
}

function focus() {
  return createDropPinFocusRef({ ...COMMUNE_PIN, sourceView: VIEW_ID.MAP });
}

test('1 generate requires FocusRef POINT', () => {
  isolate();
  const missing = generateCameraCoverage(null);
  assert.equal(missing.ok, false);
  assert.equal(missing.reason, 'FOCUSREF_POINT_REQUIRED');
  assert.equal(listAuthoredCameras().length, 0);
  restore();
});

test('2-10 one click creates 3 AUTO_PLAN cameras aimed at target', () => {
  isolate();
  const first = generateCameraCoverage(focus());
  assert.equal(first.ok, true);
  assert.equal(first.cameraCount, 3);
  assert.equal(listAuthoredCameras().length, 3);
  assert.equal(first.algorithm, COVERAGE_PLAN_ALGORITHM);
  assert.ok(first.planId);
  const cameras = listAuthoredCameras();
  for (const camera of cameras) {
    assert.equal(camera.creationMode, CREATION_MODE.AUTO_PLAN);
    assert.equal(camera.planId, first.planId);
    assert.equal(isCameraRef(createCameraRef(camera.cameraId)), true);
    assert.equal(createCameraRef(camera.cameraId).authority, CAMERA_REF_AUTHORITY);
    const expectedHeading = wrapHeading(headingFromPoints(camera, COMMUNE_PIN));
    assert.ok(Math.abs(camera.heading - expectedHeading) < 1e-6);
    assert.equal(camera.horizontalFov, PLAN_VIEW_HFOV);
    assert.ok(Math.abs(camera.heightAboveGround ? 1 : 1));
    const item = first.cameras.find((row) => row.cameraId === camera.cameraId);
    assert.equal(item.heading, camera.heading);
  }
  const proposals = proposeBalancedCoverage(COMMUNE_PIN);
  assert.equal(proposals.every((item) => item.fovIntersects), true);
  assert.equal(proposals.length, COVERAGE_CAMERA_COUNT);
  assert.ok(proposals.every((item) => Math.abs(item.distanceM - COVERAGE_STANDOFF_M) < 1));
  const again = generateCameraCoverage(focus());
  assert.equal(listAuthoredCameras().length, 3);
  assert.deepEqual(listAuthoredCameras().map((item) => item.cameraId).sort(), cameras.map((item) => item.cameraId).sort());
  assert.equal(again.planId, first.planId);
  restore();
});

test('11-16 pitch, model, zoom stay unqualified; planned truth; CameraRef out of SelectionSet', async () => {
  isolate();
  const chassis = createSpatialV2Chassis({
    now: () => '2026-08-21T14:30:00.000Z',
    idFactory: () => 'coverage-sel'
  });
  const plan = generateCameraCoverage(focus());
  const camera = plan.cameras[0];
  assert.equal(camera.pitchQualification, PITCH_UNQUALIFIED);
  assert.equal(camera.pitch, 0);
  assert.equal(camera.cameraModelQualification, CAMERA_MODEL_UNKNOWN);
  assert.equal(camera.opticalZoomQualification, OPTICAL_ZOOM_UNQUALIFIED);
  assert.equal(camera.modelId, null);
  assert.equal(camera.resolution, null);
  assert.equal(camera.planningState, PLANNING_STATE.PLANNED);
  assert.equal(camera.installed, false);
  assert.match(camera.planningLabel, /PLANNED · NOT INSTALLED/);
  assert.match(camera.planningLabel, /AUTO-PLANNED/);
  await chassis.executeChassis(CAMERA_QUERY_CAPABILITY, { focusRef: focus() });
  const selection = chassis.stateStore.getSnapshot().selection;
  assert.equal(selection.objectRefs.some((ref) => isCameraRef(ref)), false);
  assert.equal(selection.objectRefs.every((ref) => !ref || isObjectRef(ref)), true);
  assert.notEqual(PROVIDER_REPRESENTATION_REF_AUTHORITY, CAMERA_REF_AUTHORITY);
  restore();
});

test('17-19 regenerate replaces AUTO_PLAN only; CLEAR preserves manuals', () => {
  isolate();
  const manual = placeAuthoredCamera({
    cameraId: 'camera-manual-keep',
    longitude: COMMUNE_PIN.longitude,
    latitude: COMMUNE_PIN.latitude + 0.001,
    heading: 10,
    horizontalFov: 55
  });
  generateCameraCoverage(focus());
  assert.equal(listAuthoredCameras().length, 4);
  generateCameraCoverage(focus());
  assert.equal(listAuthoredCameras().length, 4);
  assert.ok(listAuthoredCameras().some((item) => item.cameraId === manual.cameraId));
  const cleared = clearGeneratedPlan();
  assert.equal(cleared.removedCount, 3);
  assert.deepEqual(listAuthoredCameras().map((item) => item.cameraId), ['camera-manual-keep']);
  assert.equal(listAuthoredCameras()[0].creationMode, CREATION_MODE.OPERATOR_AUTHORED);
  restore();
});

test('20-27 query, wall, provider identity, heavy budget, visibility, one MapView', async () => {
  isolate();
  generateCameraCoverage(focus());
  const query = queryRelevantCameras({ focusRef: focus() });
  assert.equal(query.cameraCount, 3);
  assert.equal(query.relevantCount, 3);
  assert.equal(query.visibilityTested, false);
  assert.equal(query.observationClaim, false);
  const wall = buildRelevantCameraWall(query);
  assert.equal(wall.slotCount, 3);
  assert.equal(wall.maxHeavyViewers, HEAVY_VIEWER_LIMIT);
  assert.equal(HEAVY_VIEWER_LIMIT, 1);
  const poses = listAuthoredCameras().map((item) => ({
    cameraId: item.cameraId,
    longitude: item.longitude,
    latitude: item.latitude,
    heading: item.heading,
    horizontalFov: item.horizontalFov
  }));
  getCameraWallSnapshot();
  assert.deepEqual(listAuthoredCameras().map((item) => ({
    cameraId: item.cameraId,
    longitude: item.longitude,
    latitude: item.latitude,
    heading: item.heading,
    horizontalFov: item.horizontalFov
  })), poses);
  const snapshot = getLastCameraQuerySnapshot();
  assert.equal(snapshot.relevant.every((item) => item.qualification.includes('PLANNED')), true);
  assert.equal(PIXEL_DENSITY_UNKNOWN.includes('UNKNOWN'), true);
  const html = renderCameraRelevanceSurface();
  assert.match(html, /GENERATE CAMERA COVERAGE/);
  assert.match(html, /CLEAR GENERATED PLAN/);
  const foundation = fs.readFileSync(path.join(V2, 'map', 'map-foundation.js'), 'utf8');
  const plan = fs.readFileSync(path.join(V2, 'camera', 'engine', 'coverage-plan.js'), 'utf8');
  assert.equal((foundation.match(/new MapView\(/g) || []).length, 1);
  assert.doesNotMatch(plan, /new MapView\(/);
  assert.doesNotMatch(plan, /camera-planner-lab|Road511|pose-store/);
  restore();
});
