import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  SCHEMA_IDS,
  SENSOR_POSE_SOURCE,
  createSensorPose,
  createWorldState,
  validateSensorPose,
  VIEW_ID
} from '../public/spatial-v2/foundation/contracts/index.js';
import { ContractError } from '../public/spatial-v2/foundation/contracts/validate.js';
import {
  AUTHORED_CAMERA_PROVENANCE,
  deleteAuthoredCamera,
  getAuthoredCamerasSnapshot,
  placeAuthoredCamera,
  resetAuthoredCameras,
  selectAuthoredCamera,
  sensorPoseFromAuthoredCamera,
  updateAuthoredCamera,
  verticalFovFromHorizontal
} from '../public/spatial-v2/map/authored-cameras.js';
import { createSpatialV2Chassis } from '../public/spatial-v2/bootstrap/spatial-v2-bootstrap.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const V2 = path.join(ROOT, 'public', 'spatial-v2');

function read(...parts) {
  return fs.readFileSync(path.join(V2, ...parts), 'utf8');
}

test('PLACE CAMERA is a MAP operator control and does not create a second MapView', () => {
  const host = read('hosts', 'view-host.js');
  const control = read('shell', 'PlaceCameraControl.js');
  const session = read('bootstrap', 'worldview-map-session.js');
  const foundation = read('map', 'map-foundation.js');
  const overlay = read('map', 'place-camera-overlay.js');
  const store = read('map', 'authored-cameras.js');
  const pose = read('foundation', 'contracts', 'sensor-pose.js');

  assert.match(host, />PLACE CAMERA</);
  assert.match(host, /data-iqai-place-camera/);
  assert.match(host, /data-iqai-place-camera-editor/);
  assert.match(host, /FOV direction/);
  assert.match(control, /OPERATOR_AUTHORED|placeAuthoredCamera/);
  assert.match(control, /disarmDropPin/);
  assert.doesNotMatch(control, /google-maps-js-3d/);
  assert.match(control, /Does not write WorldState\.cameras/);
  assert.doesNotMatch(control, /cameras\.byViewId/);
  assert.match(session, /bindPlaceCameraControl/);
  assert.match(session, /api\.placeCamera/);
  assert.equal((foundation.match(/new MapView\(/g) || []).length, 1);
  assert.doesNotMatch(overlay, /new MapView\(/);
  assert.doesNotMatch(overlay, /new GraphicsLayer\(/);
  assert.match(overlay, /FOV DIRECTION — NOT LOS/);
  assert.doesNotMatch(overlay, /new SceneView\(/);
  assert.doesNotMatch(overlay, /hitTest\(|Viewshed|LineOfSight/);
  assert.match(overlay, /not Building_Montreal/);
  assert.doesNotMatch(store, /google-maps-js-3d|arcgis-scene-analyze/);
  assert.match(store, /Not Building_Montreal \/ LOS \/ roof snap/);
  assert.match(store, /Not WorldState\.cameras/);
  assert.match(pose, /OPERATOR_AUTHORED/);
  assert.match(read('map', 'focus', 'instrument.js'), /isPlaceCameraArmed/);
  assert.match(read('shell', 'DropPinControl.js'), /isPlaceCameraArmed/);
});

test('operator-authored SensorPose stays on the accepted contract and is not WorldState.cameras', () => {
  resetAuthoredCameras();
  const camera = placeAuthoredCamera({
    longitude: -73.56726,
    latitude: 45.50173,
    heading: 42,
    pitch: -12,
    heightAboveGround: 8,
    horizontalFov: 55
  });
  const pose = validateSensorPose(camera.pose);
  assert.equal(pose.schemaId, SCHEMA_IDS.SENSOR_POSE);
  assert.equal(pose.schemaVersion, '1.0.0');
  assert.equal(pose.source, SENSOR_POSE_SOURCE.OPERATOR_AUTHORED);
  assert.equal(pose.cameraId, camera.cameraId);
  assert.equal(pose.longitude, -73.56726);
  assert.equal(pose.latitude, 45.50173);
  assert.equal(pose.z, null);
  assert.equal(pose.heightAboveGround, 8);
  assert.equal(pose.heading, 42);
  assert.equal(pose.pitch, -12);
  assert.equal(pose.horizontalFov, 55);
  assert.ok(Math.abs(pose.verticalFov - verticalFovFromHorizontal(55)) < 1e-9);
  assert.match(pose.provenance, /Not WorldState\.cameras/);
  assert.match(pose.provenance, /not LOS/i);
  assert.match(AUTHORED_CAMERA_PROVENANCE, /Not Google 3D/);

  const world = createWorldState({});
  assert.deepEqual(Object.keys(world.cameras.byViewId), [VIEW_ID.MAP]);
  assert.equal(world.cameras.byViewId.MAP.viewId, VIEW_ID.MAP);
  assert.equal(getAuthoredCamerasSnapshot().worldStateCameras, false);
  assert.equal(getAuthoredCamerasSnapshot().google3dCamera, false);
});

test('PLACE CAMERA keeps independent poses and does not fabricate missing Z', () => {
  resetAuthoredCameras();
  const one = placeAuthoredCamera({ longitude: -73.5673, latitude: 45.5017, heading: 10 });
  const two = placeAuthoredCamera({ longitude: -73.5668, latitude: 45.5021, heading: 90, pitch: -5 });
  const three = placeAuthoredCamera({ longitude: -73.5662, latitude: 45.5014, heading: 180, horizontalFov: 80 });
  assert.equal(getAuthoredCamerasSnapshot().count, 3);
  assert.equal(getAuthoredCamerasSnapshot().activeCameraId, three.cameraId);
  selectAuthoredCamera(one.cameraId);
  updateAuthoredCamera(one.cameraId, { heading: 33, pitch: -8, heightAboveGround: 12, horizontalFov: 40, verticalFov: null });
  const after = getAuthoredCamerasSnapshot();
  assert.equal(after.active.heading, 33);
  assert.equal(after.active.z, null);
  assert.ok(Math.abs(after.active.verticalFov - verticalFovFromHorizontal(40)) < 1e-9);
  assert.equal(after.cameras.find((item) => item.cameraId === two.cameraId).heading, 90);
  assert.equal(after.cameras.find((item) => item.cameraId === three.cameraId).horizontalFov, 80);
  deleteAuthoredCamera(two.cameraId);
  assert.equal(getAuthoredCamerasSnapshot().count, 2);
  assert.equal(getAuthoredCamerasSnapshot().cameras.some((item) => item.cameraId === two.cameraId), false);
});

test('SCENE_CAMERA_SAMPLE remains valid and WORLDSTATE_CAMERA stays rejected', () => {
  const sample = createSensorPose({
    x: -73.56726,
    y: 45.50173,
    z: 450,
    longitude: -73.56726,
    latitude: 45.50173,
    heading: 38,
    pitch: -20,
    roll: null,
    crs: { horizontalCrsId: 'EPSG:4326', verticalUnits: 'meters' },
    source: SENSOR_POSE_SOURCE.SCENE_CAMERA_SAMPLE,
    provenance: 'SceneView camera sample. Not PLACE CAMERA. Not WorldState.cameras.'
  });
  assert.equal(sample.cameraId, null);
  assert.equal(sample.heightAboveGround, null);
  assert.equal(sample.source, 'SCENE_CAMERA_SAMPLE');
  assert.throws(
    () => createSensorPose({
      longitude: -73.56,
      latitude: 45.50,
      source: 'WORLDSTATE_CAMERA',
      provenance: 'no'
    }),
    (error) => error instanceof ContractError && error.code === 'UNKNOWN_ENUM'
  );
  assert.throws(
    () => createSensorPose({
      longitude: -73.56,
      latitude: 45.50,
      source: SENSOR_POSE_SOURCE.OPERATOR_AUTHORED,
      provenance: AUTHORED_CAMERA_PROVENANCE
    }),
    (error) => error instanceof ContractError && error.code === 'INVALID_STRING'
  );
  const moved = sensorPoseFromAuthoredCamera({
    cameraId: 'camera-live',
    poseId: 'sensor-pose-camera-live',
    longitude: -73.57,
    latitude: 45.50,
    heading: 400,
    pitch: 0,
    roll: 0,
    heightAboveGround: 3,
    horizontalFov: 60,
    updatedAt: '2026-08-19T20:00:00.000Z'
  });
  assert.equal(moved.heading, 40);
  assert.equal(moved.z, null);
});

test('chassis World State cameras remain view retention after PLACE CAMERA source exists', () => {
  let n = 0;
  const chassis = createSpatialV2Chassis({
    now: () => '2026-08-19T20:00:00.000Z',
    idFactory: () => `pc-${++n}`
  });
  const world = chassis.stateStore.getSnapshot();
  assert.equal(world.cameras.byViewId.MAP.retained, true);
  assert.equal(world.cameras.byViewId.MAP.viewId, VIEW_ID.MAP);
  assert.equal(Object.keys(world.cameras.byViewId).every((key) => key === VIEW_ID.MAP || key === 'STREET 360' || key === '3D VISUAL' || key === '3D ANALYZE'), true);
  resetAuthoredCameras();
});
