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
import {
  getLastCameraQuerySnapshot,
  queryRelevantCameras,
  resetCameraQuerySnapshot
} from '../public/spatial-v2/camera/spatial-camera-adapter.js';
import { HEAVY_VIEWER_LIMIT, TRI_VIEW_HEAVY_BUDGET } from '../public/spatial-v2/camera/engine/view-slot.js';
import {
  buildRelevantCameraWall,
  closeCameraWall,
  getCameraWallSnapshot,
  resetCameraWall,
  setActiveSlot
} from '../public/spatial-v2/camera/engine/camera-wall.js';
import {
  attachRepresentationsForWall,
  configureProviderLookups,
  resetProviderLookups,
  resetSlotRepresentations
} from '../public/spatial-v2/camera/provider/slot-representations.js';
import {
  applyWallHeavyVirtualView,
  getLiveHeavyViewerCount,
  getWallHeavyVirtualView,
  parkWallHeavyViewer
} from '../public/spatial-v2/camera/provider/heavy-viewer.js';
import { isProviderRepresentationRef } from '../public/spatial-v2/camera/provider/provider-representation.js';
import { generateCameraCoverage, resetCoveragePlanState } from '../public/spatial-v2/camera/engine/coverage-plan.js';
import { destinationAlongHeading } from '../public/spatial-v2/camera/engine/geodesy.js';
import { CAMERA_QUERY_CAPABILITY } from '../public/spatial-v2/camera/engine/relevance-constants.js';
import { renderCameraWallSurface } from '../public/spatial-v2/shell/CameraWallSurface.js';
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
  resetSlotRepresentations({ emit: false });
  resetProviderLookups();
  resetCoveragePlanState();
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
    horizontalFov: camera.horizontalFov,
    modelId: camera.modelId || null
  };
}

function placeFacing(count) {
  const headings = [0, 90, 180, 270];
  return Array.from({ length: count }, (_, index) => {
    const originHeading = headings[index % headings.length];
    const point = destinationAlongHeading(COMMUNE_PIN, originHeading, 40 + index * 6);
    return placeAuthoredCamera({
      cameraId: `camera-wall-view-${index + 1}`,
      ...point,
      heading: (originHeading + 180) % 360,
      horizontalFov: 70
    });
  });
}

test('1-3 Camera Wall is 3-UP: three panes share the Camera workspace', () => {
  const html = renderCameraWallSurface();
  assert.match(html, /data-iqai-camera-wall-layout="tri-view"/);
  assert.match(html, /data-iqai-camera-wall-slots/);
  assert.match(html, /data-iqai-camera-wall-heavy-stage/);
  assert.match(html, /RESTORE 3-UP/);
  assert.match(html, /VIRTUAL VIEW · PAN \/ TILT \/ ZOOM/);
  assert.match(html, /PROVIDER REPRESENTATION · NOT CAMERA FEED/);
  const css = fs.readFileSync(path.join(V2, 'iqai-spatial-v2.css'), 'utf8');
  assert.match(css, /iqai-v2-camera-wall__heavy-stage/);
  assert.match(css, /flex: 1 1 auto/);
  assert.doesNotMatch(css, /clamp\(22rem, 38vh, 31\.25rem\)/);
  isolate();
  placeFacing(3);
  const query = queryRelevantCameras({
    focusRef: createDropPinFocusRef({ ...COMMUNE_PIN, sourceView: VIEW_ID.MAP })
  });
  assert.equal(query.relevantCount, 3);
  const wall = buildRelevantCameraWall(query);
  assert.equal(wall.slotCount, 3);
  restore();
});

test('4-8 tri-view budget; switching slots does not exceed approved budget', async () => {
  isolate();
  placeFacing(3);
  const query = queryRelevantCameras({
    focusRef: createDropPinFocusRef({ ...COMMUNE_PIN, sourceView: VIEW_ID.MAP })
  });
  const wall = buildRelevantCameraWall(query);
  assert.equal(wall.maxHeavyViewers, TRI_VIEW_HEAVY_BUDGET);
  assert.equal(HEAVY_VIEWER_LIMIT, 1);
  configureProviderLookups({
    google: async (camera) => ({
      available: true,
      status: 'OK',
      panoId: `pano-${camera.cameraId}`,
      captureCoordinate: { longitude: camera.longitude, latitude: camera.latitude },
      cameraCoordinate: { longitude: camera.longitude, latitude: camera.latitude },
      offsetMeters: 3,
      imageDate: '2025-06',
      heading: 10,
      mutatesCameraPose: false
    }),
    mapillary: async () => ({ status: 'OK', selected: null, count: 0 }),
    googleKey: async () => null
  });
  await attachRepresentationsForWall();
  const first = getCameraWallSnapshot().activeSlotId;
  const second = getCameraWallSnapshot().slots[1].slotId;
  const third = getCameraWallSnapshot().slots[2].slotId;
  setActiveSlot(second);
  assert.equal(getCameraWallSnapshot().activeSlotId, second);
  assert.notEqual(second, first);
  setActiveSlot(third);
  assert.equal(getCameraWallSnapshot().activeSlotId, third);
  await parkWallHeavyViewer(null);
  assert.equal(getLiveHeavyViewerCount(), 0);
  restore();
});

test('9-16 virtual view does not mutate CameraPose, CameraRef, provider ref, or SelectionSet', async () => {
  isolate();
  const chassis = createSpatialV2Chassis({
    now: () => '2026-08-21T14:40:00.000Z',
    idFactory: () => 'active-view-sel'
  });
  const cameras = placeFacing(2);
  const before = cameras.map((camera) => poseOf(camera));
  const selectionBefore = chassis.stateStore.getSnapshot().selection;
  buildRelevantCameraWall(queryRelevantCameras({
    focusRef: createDropPinFocusRef({ ...COMMUNE_PIN, sourceView: VIEW_ID.MAP })
  }));
  configureProviderLookups({
    google: async (camera) => ({
      available: true,
      status: 'OK',
      panoId: 'g-pano-active',
      captureCoordinate: destinationAlongHeading(camera, 90, 12),
      cameraCoordinate: { longitude: camera.longitude, latitude: camera.latitude },
      offsetMeters: 12,
      imageDate: '2020-11',
      heading: 77,
      mutatesCameraPose: false
    }),
    mapillary: async (camera) => ({
      status: 'OK',
      selected: {
        provider: 'MAPILLARY',
        providerId: 'mly-active',
        isPano: true,
        captureCoordinate: destinationAlongHeading(camera, 270, 8)
      },
      count: 1
    }),
    googleKey: async () => null
  });
  const snap = await attachRepresentationsForWall();
  const view = getWallHeavyVirtualView();
  assert.equal(view.mutatesCameraPose, false);
  assert.equal(view.opticalZoom, false);
  assert.equal(view.kind, 'VIRTUAL VIEW');
  assert.equal(view.zoomKind, 'VIRTUAL ZOOM');
  applyWallHeavyVirtualView({ heading: 44, pitch: 12, zoom: 2 });
  assert.equal(getWallHeavyVirtualView().mutatesCameraPose, false);
  const pack = snap.slots[0];
  assert.equal(createCameraRef(pack.cameraRef).authority, CAMERA_REF_AUTHORITY);
  assert.equal(isProviderRepresentationRef(pack.representation.representationRef), true);
  assert.notDeepEqual(pack.representation.captureCoordinate, {
    longitude: cameras[0].longitude,
    latitude: cameras[0].latitude
  });
  assert.deepEqual(listAuthoredCameras().map((item) => poseOf(item)), before);
  await chassis.executeChassis(CAMERA_QUERY_CAPABILITY, {
    focusRef: createDropPinFocusRef({ ...COMMUNE_PIN, sourceView: VIEW_ID.MAP })
  });
  const selectionAfter = chassis.stateStore.getSnapshot().selection;
  assert.deepEqual(selectionAfter.objectRefs, selectionBefore.objectRefs);
  assert.equal(selectionAfter.objectRefs.some((ref) => isCameraRef(ref)), false);
  assert.equal(selectionAfter.objectRefs.every((ref) => !ref || isObjectRef(ref)), true);
  restore();
});

test('17-20 CLOSE WALL and AUTO_PLAN preserve cameras; visibility stays untested', () => {
  isolate();
  const plan = generateCameraCoverage(createDropPinFocusRef({ ...COMMUNE_PIN, sourceView: VIEW_ID.MAP }));
  assert.equal(plan.cameraCount, 3);
  const query = queryRelevantCameras({
    focusRef: createDropPinFocusRef({ ...COMMUNE_PIN, sourceView: VIEW_ID.MAP })
  });
  assert.equal(query.cameraCount, 3);
  assert.equal(query.relevantCount, 3);
  assert.equal(query.visibilityTested, false);
  assert.equal(query.observationClaim, false);
  buildRelevantCameraWall(query);
  const ids = listAuthoredCameras().map((item) => item.cameraId);
  closeCameraWall();
  assert.deepEqual(listAuthoredCameras().map((item) => item.cameraId), ids);
  assert.equal(getLastCameraQuerySnapshot().visibilityTested, false);
  restore();
});

test('21-22 provider attach/fallback wording remains; one MapView', () => {
  const wall = fs.readFileSync(path.join(V2, 'shell', 'CameraWallSurface.js'), 'utf8');
  const heavy = fs.readFileSync(path.join(V2, 'camera', 'provider', 'heavy-viewer.js'), 'utf8');
  const css = fs.readFileSync(path.join(V2, 'iqai-spatial-v2.css'), 'utf8');
  const foundation = fs.readFileSync(path.join(V2, 'map', 'map-foundation.js'), 'utf8');
  assert.match(wall, /PROVIDER REPRESENTATION/);
  assert.match(wall, /NOT CAMERA FEED/);
  assert.match(wall, /VIRTUAL VIEW/);
  assert.match(heavy, /panControl: true/);
  assert.match(heavy, /zoomControl: true/);
  assert.match(heavy, /VIRTUAL ZOOM/);
  assert.doesNotMatch(heavy, /optical zoom control|ONVIF|RTSP|Road511/);
  assert.doesNotMatch(wall, /new MapView\(/);
  assert.doesNotMatch(css, /height: 11rem/);
  assert.equal((foundation.match(/new MapView\(/g) || []).length, 1);
});
