import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  deleteAuthoredCamera,
  placeAuthoredCamera,
  resetAuthoredCameras,
  selectAuthoredCamera,
  updateAuthoredCamera,
  getAuthoredCamerasSnapshot
} from '../public/spatial-v2/map/authored-cameras.js';
import {
  CAMERA_VIEW_MODE,
  STREET360_FOV_LIMITATION,
  STREET360_HEIGHT_LIMITATION,
  STREET360_NOT_OPTICALLY_MATCHED,
  STREET360_UNAVAILABLE,
  poseKey,
  selectionMustNotMutate,
  street360SyncPlan,
  street360Truth
} from '../public/spatial-v2/map/view-camera-bind.js';
import {
  GEOMETRIC_NOT_LOS,
  GEOMETRIC_NOT_PHOTOGRAPHIC,
  GEOMETRIC_VIEW_TITLE
} from '../public/spatial-v2/map/view-camera-geometric.js';
import { povFromSensorPose } from '../public/spatial-v2/map/google-street-view.js';
import { isAisSpatialStreamEnabled } from '../src/spatial/aisstream-config.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const V2 = path.join(ROOT, 'public', 'spatial-v2');

function read(...parts) {
  return fs.readFileSync(path.join(V2, ...parts), 'utf8');
}

test('VIEW CAMERA is a compact active-camera control on production PLACE CAMERA', () => {
  const host = read('hosts', 'view-host.js');
  const session = read('bootstrap', 'worldview-map-session.js');
  const control = read('shell', 'ViewCameraControl.js');
  const street = read('shell', 'Street360Control.js');
  const geometric = read('map', 'view-camera-geometric.js');
  const bind = read('map', 'view-camera-bind.js');
  assert.match(host, />VIEW</);
  assert.match(host, /data-iqai-view-camera/);
  assert.match(host, />GEOMETRIC</);
  assert.match(host, />STREET360</);
  assert.match(host, /CAMERA LOCATION/);
  assert.match(host, /STREET360 CAPTURE LOCATION/);
  assert.match(host, /CAPTURE OFFSET/);
  assert.match(host, /CAMERA HFOV/);
  assert.match(host, /STREET360 PROVIDER POV/);
  assert.match(host, /NOT OPTICALLY MATCHED/);
  assert.match(session, /bindViewCameraControl/);
  assert.match(session, /api\.viewCamera/);
  assert.match(control, /openForCamera/);
  assert.match(control, /applyCameraPov/);
  assert.doesNotMatch(control, /new StreetViewPanorama/);
  assert.doesNotMatch(control, /camera-planner-lab/);
  assert.doesNotMatch(control, /IQAI-Camera/);
  assert.match(street, /authored-camera/);
  assert.match(street, /beginCameraBind/);
  assert.match(geometric, /GEOMETRIC CAMERA VIEW/);
  assert.match(geometric, /NOT PHOTOGRAPHIC IMAGERY/);
  assert.match(geometric, /NOT LOS/);
  assert.doesNotMatch(geometric, /LOS claimed|photographic imagery of the camera/i);
  assert.match(geometric, /Does not claim obstructions/);
  assert.match(bind, /ONE SENSORPOSE|many representations/i);
  assert.equal((read('map', 'map-foundation.js').match(/new MapView\(/g) || []).length, 1);
  assert.equal(isAisSpatialStreamEnabled({}), false);
});

test('Street360 bind plan resolves on camera switch and location, POV on heading/pitch only', () => {
  resetAuthoredCameras();
  const one = placeAuthoredCamera({
    longitude: -73.5673,
    latitude: 45.5017,
    heading: 20,
    pitch: -8,
    heightAboveGround: 4,
    horizontalFov: 70
  });
  const two = placeAuthoredCamera({
    longitude: -73.5667,
    latitude: 45.5019,
    heading: 140,
    pitch: -6,
    heightAboveGround: 6,
    horizontalFov: 55
  });
  const three = placeAuthoredCamera({
    longitude: -73.5678,
    latitude: 45.5014,
    heading: 260,
    pitch: -10,
    heightAboveGround: 8,
    horizontalFov: 40
  });
  const first = poseKey(one);
  assert.equal(street360SyncPlan(null, first).action, 'resolve');
  assert.equal(street360SyncPlan(first, poseKey(two)).action, 'resolve');
  assert.equal(street360SyncPlan(poseKey(two), poseKey(three)).action, 'resolve');

  const turned = poseKey(updateAuthoredCamera(one.cameraId, { heading: 44 }));
  assert.equal(street360SyncPlan(first, turned).action, 'pov');
  assert.equal(turned.longitude, first.longitude);
  assert.equal(turned.latitude, first.latitude);

  const pitched = poseKey(updateAuthoredCamera(one.cameraId, { pitch: -18 }));
  assert.equal(street360SyncPlan(turned, pitched).action, 'pov');
  assert.equal(pitched.longitude, first.longitude);

  const moved = poseKey(updateAuthoredCamera(one.cameraId, {
    longitude: -73.5684,
    latitude: 45.5022
  }));
  assert.equal(street360SyncPlan(pitched, moved).action, 'resolve');
  resetAuthoredCameras();
});

test('selecting cameras does not mutate pose or FOV', () => {
  resetAuthoredCameras();
  const one = placeAuthoredCamera({
    longitude: -73.5673,
    latitude: 45.5017,
    heading: 20,
    pitch: -8,
    heightAboveGround: 4,
    horizontalFov: 70
  });
  const two = placeAuthoredCamera({
    longitude: -73.5667,
    latitude: 45.5019,
    heading: 140,
    pitch: -6,
    heightAboveGround: 6,
    horizontalFov: 55
  });
  const beforeOne = poseKey(one);
  const beforeTwo = poseKey(two);
  selectAuthoredCamera(one.cameraId);
  const afterOne = poseKey(getAuthoredCamerasSnapshot().cameras.find((item) => item.cameraId === one.cameraId));
  const afterTwo = poseKey(getAuthoredCamerasSnapshot().cameras.find((item) => item.cameraId === two.cameraId));
  assert.equal(selectionMustNotMutate(beforeOne, afterOne), true);
  assert.equal(selectionMustNotMutate(beforeTwo, afterTwo), true);
  deleteAuthoredCamera(two.cameraId);
  resetAuthoredCameras();
});

test('Street360 truth labels stay honest about offset, FOV, and height', () => {
  const camera = {
    longitude: -73.5673,
    latitude: 45.5017,
    heading: 20,
    pitch: -8,
    horizontalFov: 70
  };
  const truth = street360Truth(camera, {
    available: true,
    panoramaPosition: { longitude: -73.5671, latitude: 45.5016 },
    offsetMeters: 18.4
  }, 'AVAILABLE');
  assert.equal(truth.status, 'AVAILABLE');
  assert.equal(truth.fovLimitation, STREET360_FOV_LIMITATION);
  assert.equal(truth.notOpticallyMatched, STREET360_NOT_OPTICALLY_MATCHED);
  assert.equal(truth.heightLimitation, STREET360_HEIGHT_LIMITATION);
  assert.equal(truth.opticallyMatched, false);
  assert.equal(truth.heightMatched, false);
  assert.equal(truth.fakeImagery, false);
  assert.equal(truth.losClaim, false);
  assert.ok(truth.captureOffsetMeters > 0);
  const missing = street360Truth(camera, {}, 'UNAVAILABLE');
  assert.equal(missing.status, 'UNAVAILABLE');
  assert.equal(missing.unavailableLabel, STREET360_UNAVAILABLE);
  assert.equal(missing.captureOffsetMeters, null);
  assert.equal(CAMERA_VIEW_MODE.GEOMETRIC, 'geometric');
  assert.equal(GEOMETRIC_VIEW_TITLE, 'GEOMETRIC CAMERA VIEW');
  assert.equal(GEOMETRIC_NOT_PHOTOGRAPHIC, 'NOT PHOTOGRAPHIC IMAGERY');
  assert.equal(GEOMETRIC_NOT_LOS, 'NOT LOS');
});

test('provider POV helper consumes SensorPose heading and pitch without a second key path', () => {
  const pov = povFromSensorPose({ heading: 260, pitch: -10 });
  assert.equal(pov.heading, 260);
  assert.equal(pov.pitch, -10);
  assert.equal(pov.specified, true);
  const unset = povFromSensorPose({});
  assert.equal(unset.specified, false);
  const engine = read('map', 'google-street-view.js');
  assert.match(engine, /export function setGoogleStreetViewPov/);
  assert.match(engine, /requestedPov\.specified/);
  assert.match(engine, /googleMapsBrowserApiKey/);
  assert.doesNotMatch(engine, /GOOGLE_MAP_TILES_API_KEY/);
  assert.doesNotMatch(engine, /AIza[0-9A-Za-z_-]{10,}/);
  const control = read('shell', 'ViewCameraControl.js');
  assert.match(control, /openGoogleStreetView|openForCamera/);
  assert.doesNotMatch(control, /new StreetViewPanorama/);
  assert.doesNotMatch(read('shell', 'Street360Control.js'), /new StreetViewPanorama/);
});

test('VIEW CAMERA does not take over WorldState cameras, WOA, or 3D diagnostics', () => {
  const control = read('shell', 'ViewCameraControl.js');
  const session = read('bootstrap', 'worldview-map-session.js');
  assert.doesNotMatch(control, /cameras\.byViewId/);
  assert.doesNotMatch(control, /hitTest\(|Viewshed|LineOfSight/);
  assert.doesNotMatch(control, /analyze-3d-worker|scenelayer-qualify/);
  assert.match(session, /bindFocusInstrument/);
  assert.match(session, /bindPlaceCameraControl/);
  assert.match(session, /opsLayers/);
  assert.match(session, /bindGooglePhotorealistic3dControl/);
  const diagnostics = [
    'analyze-3d-scenelayer-qualify.html',
    'analyze-3d-worker-smoke.html'
  ];
  for (const file of diagnostics) {
    assert.equal(fs.existsSync(path.join(V2, file)), true);
  }
});
