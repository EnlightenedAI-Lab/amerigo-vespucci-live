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
  configureAuthoredCameraPersistence,
  getAuthoredCamera,
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
  queryRelevantCameras,
  resetCameraQuerySnapshot
} from '../public/spatial-v2/camera/spatial-camera-adapter.js';
import { HEAVY_VIEWER_LIMIT, TRI_VIEW_HEAVY_BUDGET, heavyViewerPolicy } from '../public/spatial-v2/camera/engine/view-slot.js';
import {
  buildRelevantCameraWall,
  closeCameraWall,
  getCameraWallSnapshot,
  resetCameraWall,
  setActiveSlot
} from '../public/spatial-v2/camera/engine/camera-wall.js';
import { PIXEL_DENSITY_UNKNOWN } from '../public/spatial-v2/camera/engine/dori.js';
import { destinationAlongHeading, geodesicMeters } from '../public/spatial-v2/camera/engine/geodesy.js';
import { CAMERA_QUERY_CAPABILITY } from '../public/spatial-v2/camera/engine/relevance-constants.js';
import {
  PROVIDER_REPRESENTATION_REF_AUTHORITY,
  createProviderRepresentationRef,
  isProviderRepresentationRef
} from '../public/spatial-v2/camera/provider/provider-representation.js';
import { classifyMapillaryImage } from '../public/spatial-v2/camera/provider/mapillary-provider.js';
import { classifyGoogleStreet360 } from '../public/spatial-v2/camera/provider/google-street360-representation.js';
import {
  attachRepresentationsForWall,
  configureProviderLookups,
  getSlotRepresentationSnapshot,
  resetProviderLookups,
  resetSlotRepresentations,
  selectSlotProvider
} from '../public/spatial-v2/camera/provider/slot-representations.js';
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

function placeFacing(count) {
  const headings = [0, 90, 180];
  const cameras = [];
  for (let i = 0; i < count; i += 1) {
    const originHeading = headings[i % headings.length];
    const point = destinationAlongHeading(COMMUNE_PIN, originHeading, 42 + i * 6);
    cameras.push(placeAuthoredCamera({
      cameraId: `camera-rep-${i + 1}`,
      ...point,
      heading: (originHeading + 180) % 360,
      pitch: -8,
      heightAboveGround: 4 + i,
      horizontalFov: 70
    }));
  }
  return cameras;
}

function queryTarget() {
  return queryRelevantCameras({
    focusRef: createDropPinFocusRef({ ...COMMUNE_PIN, sourceView: VIEW_ID.MAP })
  });
}

function googleLookupFor(camera, extras = {}) {
  const capture = extras.capture || destinationAlongHeading(camera, 90, 18);
  return {
    available: extras.available !== false,
    status: extras.available === false ? 'ZERO_RESULTS' : 'OK',
    panoId: extras.available === false ? null : (extras.panoId || `pano-${camera.cameraId}`),
    captureCoordinate: extras.available === false ? null : capture,
    cameraCoordinate: { longitude: camera.longitude, latitude: camera.latitude },
    offsetMeters: extras.available === false ? null : geodesicMeters(camera, capture),
    imageDate: extras.imageDate === undefined ? '2025-06' : extras.imageDate,
    heading: 42,
    mutatesCameraPose: false
  };
}

test('1-3 CameraRef unchanged; provider ref and capture coordinate stay separate', async () => {
  isolate();
  const [camera] = placeFacing(1);
  const before = poseOf(camera);
  buildRelevantCameraWall(queryTarget());
  configureProviderLookups({
    google: async (item) => googleLookupFor(item),
    mapillary: async () => ({ status: 'OK', selected: null, count: 0 }),
    googleKey: async () => null
  });
  const snap = await attachRepresentationsForWall();
  const pack = snap.slots[0];
  assert.equal(pack.cameraRef, camera.cameraId);
  assert.equal(isCameraRef(createCameraRef(pack.cameraRef)), true);
  assert.equal(createCameraRef(pack.cameraRef).authority, CAMERA_REF_AUTHORITY);
  assert.equal(isProviderRepresentationRef(pack.representation.representationRef), true);
  assert.equal(pack.representation.representationRef.authority, PROVIDER_REPRESENTATION_REF_AUTHORITY);
  assert.notEqual(pack.representation.providerId, camera.cameraId);
  assert.notDeepEqual(pack.representation.captureCoordinate, {
    longitude: camera.longitude,
    latitude: camera.latitude
  });
  assert.deepEqual(poseOf(getAuthoredCamera(camera.cameraId)), before);
  restore();
});

test('4-8 capture offset, provider ids, and capture time honesty', () => {
  isolate();
  const camera = { longitude: COMMUNE_PIN.longitude, latitude: COMMUNE_PIN.latitude };
  const capture = destinationAlongHeading(camera, 45, 18);
  const google = classifyGoogleStreet360(googleLookupFor(camera, { capture, panoId: 'g-pano-1' }), camera);
  assert.ok(Math.abs(google.distanceMeters - 18) < 1);
  assert.equal(google.providerId, 'g-pano-1');
  assert.equal(google.capturedAt, '2025-06');
  const unknown = classifyGoogleStreet360(googleLookupFor(camera, { imageDate: null, panoId: 'g-pano-2' }), camera);
  assert.equal(unknown.capturedAt, null);
  assert.equal(unknown.honesty.currentnessUnknown, true);
  const mapillary = classifyMapillaryImage({
    id: 'm-image-9',
    captured_at: 1717200000000,
    is_pano: true,
    geometry: { coordinates: [capture.longitude, capture.latitude] },
    thumb_1024_url: 'https://example.test/thumb.jpg'
  }, { cameraCoordinate: camera });
  assert.equal(mapillary.providerId, 'm-image-9');
  assert.equal(mapillary.capturedAt, '2024-06-01');
  const missingTime = classifyMapillaryImage({
    id: 'm-image-10',
    geometry: { coordinates: [capture.longitude, capture.latitude] }
  }, { cameraCoordinate: camera });
  assert.equal(missingTime.capturedAt, null);
  restore();
});

test('9-13 planned camera truth and absent representation stay honest', async () => {
  isolate();
  placeFacing(2);
  const query = queryTarget();
  buildRelevantCameraWall(query);
  configureProviderLookups({
    google: async (item) => googleLookupFor(item, { available: item.cameraId.endsWith('1') }),
    mapillary: async () => ({ status: 'OK', selected: null, count: 0 }),
    googleKey: async () => null
  });
  const snap = await attachRepresentationsForWall();
  assert.equal(snap.slots[0].representation.observationClaim, false);
  assert.equal(snap.visibilityTested, false);
  assert.equal(snap.observationClaim, false);
  assert.equal(query.relevant[0].qualification, 'PLANNED · NOT INSTALLED');
  assert.equal(query.visibilityTested, false);
  assert.ok(snap.slots[0].representation?.providerId);
  assert.equal(snap.slots[1].representation, null);
  assert.match(snap.slots[1].availability, /NOT AVAILABLE|NONE/);
  restore();
});

test('14-17 tri-view budget; provider-bearing slots may all be heavy-eligible', async () => {
  isolate();
  placeFacing(2);
  buildRelevantCameraWall(queryTarget());
  configureProviderLookups({
    google: async (item) => googleLookupFor(item),
    mapillary: async () => ({ status: 'OK', selected: null, count: 0 }),
    googleKey: async () => null
  });
  await attachRepresentationsForWall();
  const first = getSlotRepresentationSnapshot();
  assert.equal(HEAVY_VIEWER_LIMIT, 1);
  assert.equal(first.maxHeavyViewers, TRI_VIEW_HEAVY_BUDGET);
  assert.ok(first.liveDecoders <= TRI_VIEW_HEAVY_BUDGET);
  assert.equal(first.slots.filter((item) => item.heavy).length, 2);
  assert.equal(first.slots[0].heavy, true);
  assert.equal(first.slots[1].heavy, true);
  const previousHeavy = first.heavySlotId;
  setActiveSlot(getCameraWallSnapshot().slots[1].slotId);
  const second = getSlotRepresentationSnapshot();
  assert.ok(second.liveDecoders <= TRI_VIEW_HEAVY_BUDGET);
  assert.equal(second.slots.filter((item) => item.heavy).length, 2);
  assert.equal(second.heavySlotId, getCameraWallSnapshot().slots[1].slotId);
  const policy = heavyViewerPolicy(getCameraWallSnapshot().slots, second.heavySlotId, {
    budget: TRI_VIEW_HEAVY_BUDGET
  });
  assert.ok(policy.liveDecoders <= TRI_VIEW_HEAVY_BUDGET);
  restore();
});

test('18-20 slot switching does not mutate pose, heading/HFOV, or SelectionSet', async () => {
  isolate();
  const chassis = createSpatialV2Chassis({
    now: () => '2026-08-21T14:00:00.000Z',
    idFactory: () => 'wall-rep-sel'
  });
  const cameras = placeFacing(2);
  const before = cameras.map((camera) => poseOf(camera));
  await chassis.executeChassis(CAMERA_QUERY_CAPABILITY, {
    focusRef: createDropPinFocusRef({ ...COMMUNE_PIN, sourceView: VIEW_ID.MAP })
  });
  const selectionBefore = chassis.stateStore.getSnapshot().selection;
  buildRelevantCameraWall(queryTarget());
  configureProviderLookups({
    google: async (item) => googleLookupFor(item),
    mapillary: async () => ({ status: 'OK', selected: null, count: 0 }),
    googleKey: async () => null
  });
  await attachRepresentationsForWall();
  setActiveSlot(getCameraWallSnapshot().slots[1].slotId);
  selectSlotProvider(getCameraWallSnapshot().slots[1].slotId, 'GOOGLE_STREET360');
  const after = cameras.map((camera) => poseOf(getAuthoredCamera(camera.cameraId)));
  assert.deepEqual(after, before);
  const selectionAfter = chassis.stateStore.getSnapshot().selection;
  assert.deepEqual(selectionAfter.objectRefs, selectionBefore.objectRefs);
  assert.equal(selectionAfter.objectRefs.some((ref) => isCameraRef(ref) || isProviderRepresentationRef(ref)), false);
  assert.equal(selectionAfter.objectRefs.every((ref) => !ref || isObjectRef(ref)), true);
  restore();
});

test('21-23 close and provider failure preserve cameras; missing Mapillary credential is honest', async () => {
  isolate();
  placeFacing(2);
  const ids = listAuthoredCameras().map((item) => item.cameraId);
  buildRelevantCameraWall(queryTarget());
  configureProviderLookups({
    google: async () => { throw new Error('GOOGLE_DOWN'); },
    mapillary: async () => ({
      status: 'MAPILLARY_CREDENTIAL_REQUIRED',
      credentialPresent: false,
      selected: null,
      count: 0
    }),
    googleKey: async () => null
  });
  const snap = await attachRepresentationsForWall();
  assert.equal(snap.slots[0].mapillaryStatus, 'MAPILLARY_CREDENTIAL_REQUIRED');
  assert.match(snap.slots[0].availability, /MAPILLARY CREDENTIAL REQUIRED|NOT AVAILABLE/);
  assert.deepEqual(listAuthoredCameras().map((item) => item.cameraId), ids);
  closeCameraWall();
  resetSlotRepresentations({ emit: false });
  assert.deepEqual(listAuthoredCameras().map((item) => item.cameraId), ids);
  restore();
});

test('Mapillary is not blocked by a slow Google lookup; Google remains preferred when both exist', async () => {
  isolate();
  const [camera] = placeFacing(1);
  buildRelevantCameraWall(queryTarget());
  configureProviderLookups({
    google: async (item) => {
      await new Promise((resolve) => setTimeout(resolve, 40));
      return googleLookupFor(item);
    },
    mapillary: async () => ({
      status: 'OK',
      selected: {
        provider: 'MAPILLARY',
        providerId: 'map-1',
        isPano: true,
        captureCoordinate: { longitude: camera.longitude, latitude: camera.latitude }
      },
      count: 1
    }),
    googleKey: async () => null
  });
  const snap = await attachRepresentationsForWall();
  assert.equal(snap.slots[0].selected, 'GOOGLE_STREET360');
  assert.equal(Boolean(snap.slots[0].mapillary?.providerId), true);
  assert.equal(Boolean(snap.slots[0].google?.providerId), true);
  restore();
});

test('24-25 no secret committed; one MapView remains', () => {
  const files = [
    path.join(V2, 'shell', 'CameraWallSurface.js'),
    path.join(V2, 'camera', 'provider', 'heavy-viewer.js'),
    path.join(V2, 'camera', 'provider', 'slot-representations.js'),
    path.join(ROOT, 'src', 'spatial-v2', 'camera-provider-routes.js'),
    path.join(ROOT, 'src', 'spatial-v2', 'camera-provider-env.js')
  ].map((file) => fs.readFileSync(file, 'utf8'));
  for (const source of files) {
    assert.doesNotMatch(source, /MAPILLARY_ACCESS_TOKEN\s*=\s*['"][^'"]+['"]/);
    assert.doesNotMatch(source, /MLY\|/);
    assert.doesNotMatch(source, /LIVE CAMERA|CURRENT CAMERA VIDEO/);
    assert.doesNotMatch(source, /camera-planner-lab/);
    assert.doesNotMatch(source, /new MapView\(/);
  }
  const foundation = fs.readFileSync(path.join(V2, 'map', 'map-foundation.js'), 'utf8');
  assert.equal((foundation.match(/new MapView\(/g) || []).length, 1);
  const wall = fs.readFileSync(path.join(V2, 'shell', 'CameraWallSurface.js'), 'utf8');
  assert.match(wall, /PROVIDER REPRESENTATION/);
  assert.match(wall, /NOT CAMERA FEED/);
});
