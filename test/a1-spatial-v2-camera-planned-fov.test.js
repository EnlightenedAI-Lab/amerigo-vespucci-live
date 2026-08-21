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
  placeAuthoredCamera,
  resetAuthoredCameras
} from '../public/spatial-v2/map/authored-cameras.js';
import { CAMERA_REF_AUTHORITY, createCameraRef, isCameraRef } from '../public/spatial-v2/camera/camera-ref.js';
import { resetCameraQuerySnapshot } from '../public/spatial-v2/camera/spatial-camera-adapter.js';
import { CAMERA_QUERY_CAPABILITY } from '../public/spatial-v2/camera/engine/relevance-constants.js';
import {
  buildRelevantCameraWall,
  buildVisualCoverageWall,
  getCameraWallSnapshot,
  resetCameraWall
} from '../public/spatial-v2/camera/engine/camera-wall.js';
import {
  generateCameraCoverage,
  resetCoveragePlanState
} from '../public/spatial-v2/camera/engine/coverage-plan.js';
import { destinationAlongHeading, geodesicMeters, headingFromPoints, wrapHeading } from '../public/spatial-v2/camera/engine/geodesy.js';
import {
  approachQuadrant,
  angularSeparationDeg,
  configureVisualCoverageLookups,
  resetVisualCoverageLookups,
  resetVisualCoverageState,
  searchVisualCoverage,
  selectDiverseViewpoints,
  summarizeApproaches
} from '../public/spatial-v2/camera/engine/visual-coverage.js';
import { applyWallHeavyVirtualView } from '../public/spatial-v2/camera/provider/heavy-viewer.js';
import {
  CAMERA_OPERATOR_MODE,
  resetCameraOperatorMode
} from '../public/spatial-v2/camera/operator-mode.js';
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
    heightAboveGround: camera.heightAboveGround,
    horizontalFov: camera.horizontalFov
  };
}

function viewpoint(id, longitude, latitude, extras = {}) {
  const target = extras.target || COMMUNE;
  return {
    provider: extras.provider || 'GOOGLE_STREET360',
    providerId: id,
    captureCoordinate: { longitude, latitude },
    distanceM: extras.distanceM ?? geodesicMeters(target, { longitude, latitude }),
    bearingFromTargetDeg: wrapHeading(headingFromPoints(target, { longitude, latitude }))
  };
}

test('1-6 PLAN CAMERAS keeps planned position, heading, FOV, PLACE, and AUTO_PLAN', () => {
  isolate();
  const planned = fs.readFileSync(path.join(V2, 'map', 'place-camera-overlay.js'), 'utf8');
  assert.match(planned, /data-iqai-planned-camera-symbol/);
  assert.match(planned, /data-iqai-planned-fov/);
  assert.match(planned, /PLANNED FOV · NOT LOS/);
  assert.match(planned, /data-iqai-planned-heading/);
  assert.match(planned, /LOOK_AROUND/);
  const plan = generateCameraCoverage(focus());
  assert.equal(plan.ok, true);
  assert.equal(plan.cameraCount, 3);
  const cameras = listAuthoredCameras();
  assert.equal(cameras.length, 3);
  assert.ok(cameras.every((item) => item.creationMode === CREATION_MODE.AUTO_PLAN));
  const headings = cameras.map((item) => wrapHeading(item.heading));
  const expected = cameras.map((item) => wrapHeading(headingFromPoints(item, COMMUNE)));
  expected.forEach((want, index) => {
    const delta = Math.abs(headings[index] - want);
    assert.ok(Math.min(delta, 360 - delta) < 1, `heading ${headings[index]} toward target`);
  });
  assert.ok(cameras.every((item) => Number(item.horizontalFov) === 70));
  const placed = placeAuthoredCamera({
    longitude: -73.55405,
    latitude: 45.49485,
    heading: 210,
    horizontalFov: 70
  });
  assert.equal(placed.longitude, -73.55405);
  assert.equal(placed.latitude, 45.49485);
  restore();
});

test('7-10 provider 360 symbol is distinct and never replaces planned camera', async () => {
  isolate();
  const overlay = fs.readFileSync(path.join(V2, 'map', 'visual-coverage-overlay.js'), 'utf8');
  assert.match(overlay, /data-iqai-360-ring/);
  assert.match(overlay, /textContent = '360'/);
  assert.match(overlay, /VIEW DIRECTION/);
  assert.doesNotMatch(overlay, /CAMERA FOV/);
  assert.doesNotMatch(overlay, /data-iqai-camera-wedge/);
  assert.match(overlay, /FROM PLANNED POSITION/);
  generateCameraCoverage(focus());
  const before = listAuthoredCameras().map(poseOf);
  configureVisualCoverageLookups({
    google: async () => ({
      available: true,
      panoId: 'pano-road',
      captureCoordinate: { longitude: -73.55322, latitude: 45.49382 },
      imageDate: '2024-05',
      heading: 0,
      offsetMeters: 32
    }),
    mapillary: async () => ({ status: 'OK', selected: null, ranked: [], count: 0 })
  });
  const result = await searchVisualCoverage(focus());
  assert.equal(result.ok, true);
  assert.deepEqual(result.selected[0].captureCoordinate, { longitude: -73.55322, latitude: 45.49382 });
  assert.deepEqual(listAuthoredCameras().map(poseOf), before);
  assert.equal(result.mintsCameraRef, false);
  restore();
});

test('11-15 overlays, labels, coexistence, and capture offset remain honest', () => {
  isolate();
  const planned = fs.readFileSync(path.join(V2, 'map', 'place-camera-overlay.js'), 'utf8');
  const overlay = fs.readFileSync(path.join(V2, 'map', 'visual-coverage-overlay.js'), 'utf8');
  const wall = fs.readFileSync(path.join(V2, 'shell', 'CameraWallSurface.js'), 'utf8');
  const command = renderCameraRelevanceSurface();
  assert.match(planned, /NOT LOS/);
  assert.match(overlay, /data-iqai-view-direction-kind': 'VIRTUAL'/);
  assert.doesNotMatch(overlay, /CAMERA FOV/);
  assert.match(planned, /LOOK_AROUND/);
  assert.match(overlay, /LOOK_AROUND/);
  assert.match(wall, /360 VIEW/);
  assert.match(wall, /PLANNED CAMERA/);
  assert.match(wall, /CAPTURE OFFSET:/);
  assert.match(overlay, /data-iqai-representation-offset/);
  assert.match(command, /Show real street imagery around here\./);
  assert.match(command, /Engineer camera positions and fields of view\./);
  restore();
});

test('16-19 angular and spatial approach diversity, same-path fallback, honest summary', () => {
  isolate();
  const southA = destinationAlongHeading(COMMUNE, 180, 32);
  const southB = destinationAlongHeading(COMMUNE, 178, 48);
  const southC = destinationAlongHeading(COMMUNE, 182, 70);
  const east = destinationAlongHeading(COMMUNE, 90, 40);
  const west = destinationAlongHeading(COMMUNE, 270, 42);
  const mixed = [
    viewpoint('south-a', southA.longitude, southA.latitude),
    viewpoint('south-b', southB.longitude, southB.latitude),
    viewpoint('south-c', southC.longitude, southC.latitude),
    viewpoint('east', east.longitude, east.latitude),
    viewpoint('west', west.longitude, west.latitude)
  ];
  const selected = selectDiverseViewpoints(mixed, 3);
  assert.equal(selected.length, 3);
  const approaches = new Set(selected.map((item) => approachQuadrant(item.bearingFromTargetDeg)));
  assert.ok(approaches.size >= 2, `expected multiple approaches, got ${[...approaches]}`);
  assert.ok(selected.some((item) => item.providerId === 'east' || item.providerId === 'west'));
  const summary = summarizeApproaches(selected);
  assert.match(summary.coverageSummary, /\d VIEWS · \d APPROACH/);
  if (summary.approachCount === 1) {
    assert.match(summary.coverageLimitation, /LIMITED STREET COVERAGE/);
  }

  const samePath = [
    viewpoint('s1', southA.longitude, southA.latitude),
    viewpoint('s2', southB.longitude, southB.latitude),
    viewpoint('s3', southC.longitude, southC.latitude)
  ];
  const onlySouth = selectDiverseViewpoints(samePath, 3);
  assert.equal(onlySouth.length, 3);
  const limited = summarizeApproaches(onlySouth);
  assert.equal(limited.approachCount, 1);
  assert.match(limited.coverageSummary, /LIMITED STREET COVERAGE/);
  assert.match(limited.coverageSummary, /SOUTH APPROACH ONLY/);

  const bearings = selected.map((item) => item.bearingFromTargetDeg);
  if (selected.length === 3 && approaches.size === 3) {
    const seps = [
      angularSeparationDeg(bearings[0], bearings[1]),
      angularSeparationDeg(bearings[0], bearings[2]),
      angularSeparationDeg(bearings[1], bearings[2])
    ];
    assert.ok(Math.min(...seps) >= 35);
  }
  restore();
});

test('20-25 3-UP, CameraPose immutable, viewer reliability, SelectionSet, MapView, wall labels', async () => {
  isolate();
  generateCameraCoverage(focus());
  const poses = listAuthoredCameras().map(poseOf);
  const plannedWall = buildRelevantCameraWall({
    relevant: listAuthoredCameras().map((camera) => ({ cameraId: camera.cameraId, cameraRef: createCameraRef(camera.cameraId) }))
  });
  assert.equal(plannedWall.slotCount, 3);
  const wallHtml = renderCameraWallSurface();
  assert.match(wallHtml, /RESTORE 3-UP/);
  assert.match(fs.readFileSync(path.join(V2, 'shell', 'CameraWallSurface.js'), 'utf8'), /PLANNED CAMERA/);
  const visualWall = buildVisualCoverageWall([
    { viewpointId: 'view-360-01', providerId: 'a', captureCoordinate: COMMUNE },
    { viewpointId: 'view-360-02', providerId: 'b', captureCoordinate: COMMUNE },
    { viewpointId: 'view-360-03', providerId: 'c', captureCoordinate: COMMUNE }
  ]);
  assert.equal(visualWall.slotCount, 3);
  assert.equal(getCameraWallSnapshot().layout, 3);
  applyWallHeavyVirtualView({ heading: 12, pitch: 4, zoom: 1.5 });
  assert.deepEqual(listAuthoredCameras().map(poseOf), poses);
  const heavy = fs.readFileSync(path.join(V2, 'camera', 'provider', 'heavy-viewer.js'), 'utf8');
  assert.match(heavy, /VIEWER_PANE_STATE/);
  assert.match(heavy, /waitForMeasurableBox/);
  const chassis = createSpatialV2Chassis();
  await chassis.executeChassis(CAMERA_QUERY_CAPABILITY, { focusRef: focus() });
  const world = chassis.stateStore.getSnapshot();
  assert.equal((world.selection?.objectRefs || []).some((ref) => isObjectRef(ref) && ref.authority === CAMERA_REF_AUTHORITY), false);
  const foundation = fs.readFileSync(path.join(V2, 'map', 'map-foundation.js'), 'utf8');
  assert.equal((foundation.match(/new MapView\(/g) || []).length, 1);
  assert.ok(isCameraRef(createCameraRef(poses[0].cameraId)));
  restore();
});
