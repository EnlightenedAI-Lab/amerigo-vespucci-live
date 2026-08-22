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
import {
  queryRelevantCameras,
  resetCameraQuerySnapshot
} from '../public/spatial-v2/camera/spatial-camera-adapter.js';
import { CAMERA_QUERY_CAPABILITY } from '../public/spatial-v2/camera/engine/relevance-constants.js';
import {
  buildRelevantCameraWall,
  buildVisualCoverageWall,
  closeCameraWall,
  getCameraWallSnapshot,
  resetCameraWall
} from '../public/spatial-v2/camera/engine/camera-wall.js';
import {
  generateCameraCoverage,
  resetCoveragePlanState
} from '../public/spatial-v2/camera/engine/coverage-plan.js';
import { headingFromPoints, wrapHeading } from '../public/spatial-v2/camera/engine/geodesy.js';
import {
  VISUAL_COVERAGE_RADII_M,
  angularSeparationDeg,
  approachQuadrant,
  configureVisualCoverageLookups,
  isNearDuplicate,
  resetVisualCoverageLookups,
  resetVisualCoverageState,
  searchVisualCoverage,
  selectDiverseViewpoints,
  summarizeApproaches
} from '../public/spatial-v2/camera/engine/visual-coverage.js';
import { attachVisualCoverageToWall, resetSlotRepresentations } from '../public/spatial-v2/camera/provider/slot-representations.js';
import { applyWallHeavyVirtualView } from '../public/spatial-v2/camera/provider/heavy-viewer.js';
import { GUIDED_CONTROL, deriveGuidedNext, resetGuidedNextState } from '../public/spatial-v2/camera/guided-next.js';
import { renderCameraRelevanceSurface } from '../public/spatial-v2/shell/CameraRelevanceSurface.js';
import { renderCameraWallSurface } from '../public/spatial-v2/shell/CameraWallSurface.js';
import { clearHydrantRecords } from '../public/spatial-v2/map/woa/hydrant-object.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const V2 = path.join(ROOT, 'public', 'spatial-v2');
const COMMUNE = Object.freeze({ longitude: -73.553221995734, latitude: 45.494180980834 });
const BUILDING = Object.freeze({ longitude: -73.55345, latitude: 45.49442 });

function isolate() {
  configureAuthoredCameraPersistence({ storage: null, enabled: false });
  resetAuthoredCameras({ persist: false });
  resetCameraQuerySnapshot();
  resetCameraWall({ emit: false });
  resetCoveragePlanState();
  resetGuidedNextState({ emit: false });
  resetVisualCoverageState({ emit: false });
  resetVisualCoverageLookups();
  resetSlotRepresentations({ emit: false });
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

function viewpoint(id, longitude, latitude, provider = 'GOOGLE_STREET360', extras = {}) {
  const target = extras.target || COMMUNE;
  return {
    kind: 'STREET_360_VIEWPOINT',
    provider,
    providerId: id,
    providerType: extras.providerType || (provider === 'GOOGLE_STREET360' ? 'STREET360' : 'PANORAMA_360'),
    isPano: extras.isPano !== false,
    captureCoordinate: { longitude, latitude },
    captureDate: extras.captureDate || '2024-06',
    distanceM: extras.distanceM ?? 40,
    bearingFromTargetDeg: wrapHeading(headingFromPoints(target, { longitude, latitude })),
    viewHeadingTowardTarget: wrapHeading(headingFromPoints({ longitude, latitude }, target)),
    representation: {
      provider,
      providerId: id,
      captureCoordinate: { longitude, latitude },
      capturedAt: extras.captureDate || '2024-06',
      compassDeg: wrapHeading(headingFromPoints({ longitude, latitude }, target)),
      isPano: extras.isPano !== false
    }
  };
}

function mockLookups(catalog) {
  configureVisualCoverageLookups({
    google: async (point, radiusM) => {
      const hit = catalog
        .filter((item) => item.provider === 'GOOGLE_STREET360')
        .map((item) => {
          const dx = (item.longitude - point.longitude) * 80000;
          const dy = (item.latitude - point.latitude) * 111000;
          const dist = Math.hypot(dx, dy);
          return { item, dist };
        })
        .filter((row) => row.dist <= radiusM)
        .sort((a, b) => a.dist - b.dist)[0];
      if (!hit) return { available: false, panoId: null, captureCoordinate: null };
      return {
        available: true,
        panoId: hit.item.id,
        captureCoordinate: { longitude: hit.item.longitude, latitude: hit.item.latitude },
        imageDate: hit.item.date,
        heading: 0,
        offsetMeters: hit.dist
      };
    },
    mapillary: async (point, radiusM) => {
      const ranked = catalog
        .filter((item) => item.provider === 'MAPILLARY')
        .map((item) => {
          const dx = (item.longitude - point.longitude) * 80000;
          const dy = (item.latitude - point.latitude) * 111000;
          return {
            providerId: item.id,
            captureCoordinate: { longitude: item.longitude, latitude: item.latitude },
            capturedAt: item.date,
            isPano: item.isPano !== false,
            representationType: item.isPano === false ? 'STREET_IMAGE' : 'PANORAMA_360',
            distanceMeters: Math.hypot(dx, dy)
          };
        })
        .filter((item) => item.distanceMeters <= radiusM)
        .sort((a, b) => a.distanceMeters - b.distanceMeters);
      return { status: 'OK', selected: ranked[0] || null, ranked, count: ranked.length };
    }
  });
}

const STREET_CATALOG = [
  { provider: 'GOOGLE_STREET360', id: 'pano-south', longitude: -73.55322, latitude: 45.49382, date: '2024-05' },
  { provider: 'GOOGLE_STREET360', id: 'pano-east', longitude: -73.55270, latitude: 45.49418, date: '2024-06' },
  { provider: 'MAPILLARY', id: 'mly-nw', longitude: -73.55372, latitude: 45.49450, date: '2023-09-12', isPano: true },
  { provider: 'GOOGLE_STREET360', id: 'pano-south-dup', longitude: -73.55320, latitude: 45.49384, date: '2024-05' }
];

test('1 one FocusRef click is the only required map pin', async () => {
  isolate();
  mockLookups(STREET_CATALOG);
  const command = renderCameraRelevanceSurface();
  assert.match(command, /LOOK AROUND A LOCATION/);
  assert.match(command, /CLICK ONE POINT ON THE MAP/);
  assert.doesNotMatch(command, /second pin/i);
  const result = await searchVisualCoverage(focus());
  assert.equal(result.ok, true);
  assert.equal(result.mintsCameraRef, false);
  restore();
});

test('2 target inside a building still finds nearby street captures', async () => {
  isolate();
  mockLookups(STREET_CATALOG);
  const result = await searchVisualCoverage(focus(BUILDING));
  assert.equal(result.ok, true);
  assert.ok(result.selected.length >= 1);
  for (const item of result.selected) {
    assert.notEqual(item.captureCoordinate.longitude, BUILDING.longitude);
    assert.notEqual(item.captureCoordinate.latitude, BUILDING.latitude);
  }
  restore();
});

test('3 provider search is independent of AUTO_PLAN', async () => {
  isolate();
  mockLookups(STREET_CATALOG);
  assert.equal(listAuthoredCameras().length, 0);
  const result = await searchVisualCoverage(focus());
  assert.equal(result.ok, true);
  assert.equal(listAuthoredCameras().length, 0);
  assert.ok(result.selected.every((item) => item.cameraRef == null));
  restore();
});

test('4-7 provider identity, actual coordinates, Google/Mapillary IDs, capture dates', async () => {
  isolate();
  mockLookups(STREET_CATALOG);
  const result = await searchVisualCoverage(focus());
  const google = result.selected.find((item) => item.provider === 'GOOGLE_STREET360');
  const mapillary = result.selected.find((item) => item.provider === 'MAPILLARY');
  assert.ok(google);
  assert.ok(['pano-south', 'pano-south-dup', 'pano-east'].includes(google.providerId));
  assert.notEqual(google.captureCoordinate.longitude, COMMUNE.longitude);
  assert.notEqual(google.captureCoordinate.latitude, COMMUNE.latitude);
  assert.ok(google.captureDate);
  assert.ok(mapillary);
  assert.equal(mapillary.providerId, 'mly-nw');
  assert.equal(mapillary.captureDate, '2023-09-12');
  restore();
});

test('8-10 up to 3 views, duplicate suppression, angular diversity', () => {
  isolate();
  const target = COMMUNE;
  const clustered = [
    viewpoint('a', -73.55322, 45.49382, 'GOOGLE_STREET360', { target, distanceM: 30 }),
    viewpoint('a-dup', -73.55320, 45.49384, 'GOOGLE_STREET360', { target, distanceM: 31 }),
    viewpoint('b', -73.55270, 45.49418, 'GOOGLE_STREET360', { target, distanceM: 40 }),
    viewpoint('c', -73.55372, 45.49450, 'MAPILLARY', { target, distanceM: 45 })
  ];
  assert.equal(isNearDuplicate(clustered[0], clustered[1]), true);
  const selected = selectDiverseViewpoints(clustered, 3);
  assert.equal(selected.length, 3);
  assert.equal(selected.some((item) => item.providerId === 'a-dup'), false);
  const bearings = selected.map((item) => item.bearingFromTargetDeg);
  const seps = [
    angularSeparationDeg(bearings[0], bearings[1]),
    angularSeparationDeg(bearings[0], bearings[2]),
    angularSeparationDeg(bearings[1], bearings[2])
  ];
  assert.ok(Math.min(...seps) >= 35);
  restore();
});

test('10b spatial/approach diversity prefers different approaches and reports honestly', () => {
  isolate();
  const south = [
    viewpoint('s1', -73.55322, 45.49382, 'GOOGLE_STREET360', { target: COMMUNE, distanceM: 40 }),
    viewpoint('s2', -73.55318, 45.49370, 'GOOGLE_STREET360', { target: COMMUNE, distanceM: 54 }),
    viewpoint('s3', -73.55326, 45.49358, 'GOOGLE_STREET360', { target: COMMUNE, distanceM: 68 })
  ];
  const mixed = [
    ...south,
    viewpoint('east', -73.55270, 45.49418, 'GOOGLE_STREET360', { target: COMMUNE, distanceM: 40 }),
    viewpoint('west', -73.55372, 45.49418, 'MAPILLARY', { target: COMMUNE, distanceM: 42 })
  ];
  const diverse = selectDiverseViewpoints(mixed, 3);
  const approaches = new Set(diverse.map((item) => approachQuadrant(item.bearingFromTargetDeg)));
  assert.ok(approaches.size >= 2);
  const limited = summarizeApproaches(selectDiverseViewpoints(south, 3));
  assert.equal(limited.approachCount, 1);
  assert.match(limited.coverageSummary, /LIMITED STREET COVERAGE/);
  restore();
});

test('11-13 POV toward target, CameraPose unchanged, no LOS claim', async () => {
  isolate();
  mockLookups(STREET_CATALOG);
  generateCameraCoverage(focus());
  const poses = listAuthoredCameras().map(poseOf);
  const result = await searchVisualCoverage(focus());
  for (const item of result.selected) {
    const expected = wrapHeading(headingFromPoints(item.captureCoordinate, COMMUNE));
    assert.equal(item.viewHeadingTowardTarget, expected);
    assert.equal(item.mutatesCameraPose, false);
    assert.equal(item.visibilityTested, false);
    assert.equal(item.observationClaim, false);
  }
  assert.match(result.honesty, /VIEW ORIENTED TOWARD TARGET/);
  assert.match(result.honesty, /VISIBILITY NOT TESTED/);
  assert.match(result.honesty, /NOT LOS/);
  assert.doesNotMatch(result.honesty, /BEST SECURITY CAMERA/);
  applyWallHeavyVirtualView({ heading: 40, pitch: 8, zoom: 2 });
  assert.deepEqual(listAuthoredCameras().map(poseOf), poses);
  restore();
});

test('14 no CameraRef minted for provider-only viewpoint', async () => {
  isolate();
  mockLookups(STREET_CATALOG);
  const before = listAuthoredCameras().map((item) => item.cameraId);
  const result = await searchVisualCoverage(focus());
  const wall = buildVisualCoverageWall(result.selected);
  attachVisualCoverageToWall(result.selected);
  assert.equal(wall.source, 'VISUAL_COVERAGE');
  assert.equal(wall.cameraRefs.length, 0);
  assert.ok(wall.slots.every((slot) => !slot.cameraRef && slot.visualViewpointId));
  assert.deepEqual(listAuthoredCameras().map((item) => item.cameraId), before);
  restore();
});

test('15-18 honest 3-UP / 2-UP / 1-UP / not-found', () => {
  isolate();
  const three = buildVisualCoverageWall([
    viewpoint('a', -73.55322, 45.49382),
    viewpoint('b', -73.55270, 45.49418),
    viewpoint('c', -73.55372, 45.49450, 'MAPILLARY')
  ]);
  assert.equal(three.open, true);
  assert.equal(three.slotCount, 3);
  assert.equal(three.layout, 3);
  const two = buildVisualCoverageWall([
    viewpoint('a', -73.55322, 45.49382),
    viewpoint('b', -73.55270, 45.49418)
  ]);
  assert.equal(two.slotCount, 2);
  assert.equal(two.layout, 2);
  const one = buildVisualCoverageWall([viewpoint('a', -73.55322, 45.49382)]);
  assert.equal(one.slotCount, 1);
  assert.equal(one.layout, 1);
  const none = buildVisualCoverageWall([]);
  assert.equal(none.open, false);
  assert.equal(none.slotCount, 0);
  const html = renderCameraWallSurface();
  assert.match(html, /RESTORE 3-UP/);
  restore();
});

test('19-20 physical AUTO_PLAN and manual PLACE CAMERA remain intact', () => {
  isolate();
  const html = renderCameraRelevanceSurface();
  assert.match(html, /PLAN CAMERAS/);
  assert.match(html, /GENERATE CAMERA COVERAGE/);
  assert.match(html, /data-iqai-camera-plan-place>PLACE ONE CAMERA/);
  const plan = generateCameraCoverage(focus());
  assert.equal(plan.ok, true);
  assert.equal(plan.cameraCount, 3);
  assert.ok(listAuthoredCameras().every((item) => item.creationMode === CREATION_MODE.AUTO_PLAN));
  const manual = placeAuthoredCamera({ longitude: -73.554, latitude: 45.495, heading: 90, horizontalFov: 70 });
  assert.ok(isCameraRef(createCameraRef(manual.cameraId)));
  assert.equal(manual.longitude, -73.554);
  assert.equal(manual.latitude, 45.495);
  restore();
});

test('21-23 existing Tri-View, maximize/restore, Close Wall restore', () => {
  isolate();
  generateCameraCoverage(focus());
  const wall = buildRelevantCameraWall(queryRelevantCameras({ focusRef: focus() }));
  assert.equal(wall.source, 'CAMERA');
  assert.equal(wall.slotCount, 3);
  const surface = fs.readFileSync(path.join(V2, 'shell', 'CameraWallSurface.js'), 'utf8');
  assert.match(surface, /enlargeWallSlot/);
  assert.match(surface, /restoreWallTriView/);
  assert.match(surface, /exitCameraVisualization/);
  closeCameraWall();
  assert.equal(getCameraWallSnapshot().open, false);
  restore();
});

test('24-25 SelectionSet preserved and one MapView', async () => {
  isolate();
  mockLookups(STREET_CATALOG);
  const chassis = createSpatialV2Chassis();
  await chassis.executeChassis(CAMERA_QUERY_CAPABILITY, { focusRef: focus() });
  await searchVisualCoverage(focus());
  const world = chassis.stateStore.getSnapshot();
  assert.equal((world.selection?.objectRefs || []).some((ref) => isObjectRef(ref) && ref.authority === CAMERA_REF_AUTHORITY), false);
  const foundation = fs.readFileSync(path.join(V2, 'map', 'map-foundation.js'), 'utf8');
  assert.equal((foundation.match(/new MapView\(/g) || []).length, 1);
  restore();
});

test('26 guided next for 360 does not use physical relevance count', () => {
  isolate();
  const next = deriveGuidedNext({
    enabled: true,
    focusRef: focus(),
    autoPlanCameras: [],
    lastPlan: null,
    query: { relevantCount: 0 },
    wall: { open: false, slots: [] }
  });
  assert.equal(next.targetControl, GUIDED_CONTROL.LOOK_AROUND);
  assert.match(next.label, /LOOK AROUND A LOCATION/);
  const empty = deriveGuidedNext({
    enabled: true,
    operatorMode: 'LOOK_AROUND',
    focusRef: focus(),
    autoPlanCameras: [],
    visualCoverage: {
      ok: false,
      reason: 'NO_STREET_360_REPRESENTATION',
      emptyMessage: 'NO STREET 360 REPRESENTATION FOUND WITHIN 250 m'
    },
    wall: { open: false, slots: [] }
  });
  assert.match(empty.label, /CHANGE TARGET/);
  assert.match(empty.blockedReason, /NO STREET 360 REPRESENTATION FOUND WITHIN 250 m/);
  assert.doesNotMatch(empty.blockedReason || '', /NO RELEVANT CAMERAS/);
  const radii = fs.readFileSync(path.join(V2, 'camera', 'engine', 'visual-coverage.js'), 'utf8');
  assert.deepEqual([...VISUAL_COVERAGE_RADII_M], [60, 125, 250]);
  assert.match(radii, /VISUAL_COVERAGE_MAX_RADIUS_M = 250/);
  restore();
});
