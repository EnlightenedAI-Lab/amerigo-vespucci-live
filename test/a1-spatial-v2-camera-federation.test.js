import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  SCHEMA_IDS,
  VIEW_ID,
  createDropPinFocusRef,
  createEmptySelectionSet,
  isObjectRef,
  objectRefKey
} from '../public/spatial-v2/foundation/contracts/index.js';
import { createSpatialV2Chassis } from '../public/spatial-v2/bootstrap/spatial-v2-bootstrap.js';
import {
  placeAuthoredCamera,
  resetAuthoredCameras,
  listAuthoredCameras
} from '../public/spatial-v2/map/authored-cameras.js';
import {
  clearHydrantRecords,
  rememberHydrantRecord
} from '../public/spatial-v2/map/woa/hydrant-object.js';
import { filterHydrantsWithin } from '../public/spatial-v2/map/woa/hydrant-within.js';
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
  evaluateCameraRelevance,
  headingTowardPoint,
  pointInHorizontalFov,
  REASON
} from '../public/spatial-v2/camera/engine/incident-relevance.js';
import { destinationAlongHeading } from '../public/spatial-v2/camera/engine/geodesy.js';
import { PIXEL_DENSITY_UNKNOWN } from '../public/spatial-v2/camera/engine/dori.js';
import { CAMERA_QUERY_CAPABILITY, DEFAULT_QUERY_RADIUS_M } from '../public/spatial-v2/camera/engine/relevance-constants.js';
import { renderCameraRelevanceSurface } from '../public/spatial-v2/shell/CameraRelevanceSurface.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const V2 = path.join(ROOT, 'public', 'spatial-v2');
const HYDRANTS = JSON.parse(fs.readFileSync(path.join(V2, 'data/woa/hydrants.geojson'), 'utf8'));
const COMMUNE_PIN = Object.freeze({
  longitude: -73.553221995734,
  latitude: 45.494180980834
});

function read(...parts) {
  return fs.readFileSync(path.join(V2, ...parts), 'utf8');
}

function hydrantHit() {
  const hits = filterHydrantsWithin(HYDRANTS, COMMUNE_PIN, 80);
  const match = hits.find((hit) => String(hit.sourceId) === '5011151')
    || hits.find((hit) => /993-999 rue de la Commune Ouest/i.test(
      String(hit.feature?.properties?.source?.ADRESSE || '')
    ));
  assert.ok(match, 'Ville coverage must include hydrant 5011151.');
  assert.equal(String(match.sourceId), '5011151');
  return match;
}

function chassisFactory() {
  let n = 0;
  return createSpatialV2Chassis({
    now: () => '2026-08-21T04:00:00.000Z',
    idFactory: () => `cf-${++n}`
  });
}

function resetAll() {
  resetAuthoredCameras();
  resetCameraQuerySnapshot();
  clearHydrantRecords();
}

test('camera.query-relevant is registered as a read-only Camera capability', () => {
  const catalog = read('bootstrap', 'chassis-catalog.js');
  const adapters = read('bootstrap', 'map-surface-adapters.js');
  const session = read('bootstrap', 'worldview-map-session.js');
  assert.match(catalog, /id: 'camera\.query-relevant'/);
  assert.match(catalog, /owner: 'camera'/);
  assert.match(catalog, /EFFECT_CLASS\.READ_ONLY/);
  assert.match(adapters, /bindCameraQueryAdapter/);
  assert.match(session, /bindCameraRelevanceSurface/);
  assert.match(session, /api\.cameraRelevance/);
  const chassis = chassisFactory();
  const cap = chassis.capabilityRegistry.get(CAMERA_QUERY_CAPABILITY);
  assert.equal(cap.id, CAMERA_QUERY_CAPABILITY);
  assert.equal(cap.owner, 'camera');
  assert.equal(cap.effectClass, 'READ_ONLY');
  assert.equal(cap.resultType, 'camera-relevance');
});

test('1 FocusRef POINT reaches Camera relevance query', async () => {
  resetAll();
  const chassis = chassisFactory();
  const focus = createDropPinFocusRef({
    ...COMMUNE_PIN,
    sourceView: VIEW_ID.MAP
  });
  const toward = destinationAlongHeading(COMMUNE_PIN, 40, 46);
  placeAuthoredCamera({
    ...toward,
    heading: 220,
    horizontalFov: 70
  });
  const executed = await chassis.executeChassis(CAMERA_QUERY_CAPABILITY, { focusRef: focus });
  assert.equal(executed.ok, true);
  assert.equal(executed.result.statePatch, null);
  const snapshot = getLastCameraQuerySnapshot();
  assert.equal(snapshot.target.source, 'FOCUS_POINT');
  assert.equal(snapshot.target.longitude, COMMUNE_PIN.longitude);
  assert.equal(snapshot.target.latitude, COMMUNE_PIN.latitude);
  assert.equal(snapshot.cameraPopulationSource, 'public/spatial-v2/map/authored-cameras.js');
  assert.equal(snapshot.radiusM, DEFAULT_QUERY_RADIUS_M);
  assert.ok(snapshot.results.length >= 1);
  assert.ok(Number.isFinite(snapshot.results[0].planDistanceM));
  assert.ok(snapshot.results[0].reasons.includes(REASON.VISIBILITY_NOT_TESTED));
  resetAll();
});

test('2 selected hydrant ObjectRef queries using remembered municipal coordinates', async () => {
  resetAll();
  const chassis = chassisFactory();
  const record = rememberHydrantRecord(hydrantHit());
  assert.equal(record.idBi, '5011151');
  assert.notEqual(record.longitude, COMMUNE_PIN.longitude);
  assert.notEqual(record.latitude, COMMUNE_PIN.latitude);
  await chassis.executeChassis('selection.set', {
    objectRefs: [record.objectRef],
    primaryObjectRefId: objectRefKey(record.objectRef)
  });
  const world = chassis.stateStore.getSnapshot();
  assert.equal(world.selection.objectRefs[0].id, '5011151');
  assert.equal(world.selection.objectRefs[0].schemaId, SCHEMA_IDS.OBJECT_REF);
  const executed = await chassis.executeChassis(CAMERA_QUERY_CAPABILITY, {
    objectRef: record.objectRef
  });
  assert.equal(executed.ok, true);
  const snapshot = getLastCameraQuerySnapshot();
  assert.equal(snapshot.target.source, 'OBJECT_REMEMBERED');
  assert.equal(snapshot.target.longitude, record.longitude);
  assert.equal(snapshot.target.latitude, record.latitude);
  assert.match(String(snapshot.target.coordinateSource || ''), /Ville|INVENTORY|géomatique|geomatics/i);
  assert.equal(snapshot.target.objectRef.id, '5011151');
  resetAll();
});

test('3-5 Spatial ObjectRef unchanged, Camera IDs remain Camera-owned, CameraRef stays out of SelectionSet', async () => {
  resetAll();
  const chassis = chassisFactory();
  const record = rememberHydrantRecord(hydrantHit());
  const camera = placeAuthoredCamera({
    longitude: record.longitude,
    latitude: record.latitude,
    heading: 0,
    horizontalFov: 60
  });
  await chassis.executeChassis('selection.set', {
    objectRefs: [record.objectRef],
    primaryObjectRefId: objectRefKey(record.objectRef)
  });
  await chassis.executeChassis(CAMERA_QUERY_CAPABILITY, {
    objectRef: record.objectRef
  });
  const world = chassis.stateStore.getSnapshot();
  const selected = world.selection.objectRefs[0];
  assert.equal(selected.schemaId, 'iqai.spatial.object-ref/1.0.0');
  assert.equal(isObjectRef(selected), true);
  assert.equal(isCameraRef(selected), false);
  assert.equal(selected.namespace, 'ville-montreal');
  assert.equal(selected.kind, 'hydrant');
  assert.equal(selected.id, '5011151');
  assert.ok(selected.datasetRef);
  assert.ok(selected.datasetVersion);
  const snapshot = getLastCameraQuerySnapshot();
  const cameraRef = snapshot.results[0].cameraRef;
  assert.equal(isCameraRef(cameraRef), true);
  assert.equal(cameraRef.authority, CAMERA_REF_AUTHORITY);
  assert.equal(cameraRef.objectType, 'camera');
  assert.equal(cameraRef.objectId, camera.cameraId);
  assert.equal(cameraRef.cameraId, camera.cameraId);
  assert.equal(cameraRef.schemaId, undefined);
  assert.equal(listAuthoredCameras()[0].cameraId, camera.cameraId);
  assert.equal(world.selection.objectRefs.some((ref) => isCameraRef(ref)), false);
  assert.equal(createCameraRef(camera.cameraId).authority, 'iqai.camera');
  resetAll();
});

test('6-8 relevance reasons, plan distance, and Camera Freeze FOV semantics', () => {
  resetAll();
  const origin = COMMUNE_PIN;
  const hitPoint = destinationAlongHeading(origin, 10, 40);
  const missPoint = destinationAlongHeading(origin, 40, 40);
  const farPoint = destinationAlongHeading(origin, 10, 300);
  const facing = placeAuthoredCamera({
    ...hitPoint,
    heading: 190,
    horizontalFov: 40,
    cameraId: 'camera-facing'
  });
  placeAuthoredCamera({
    ...missPoint,
    heading: 40,
    horizontalFov: 40,
    cameraId: 'camera-miss'
  });
  placeAuthoredCamera({
    ...farPoint,
    heading: 190,
    horizontalFov: 40,
    cameraId: 'camera-far'
  });
  const snapshot = queryRelevantCameras({
    focusRef: createDropPinFocusRef({ ...origin, sourceView: VIEW_ID.MAP })
  });
  assert.equal(snapshot.cameraCount, 3);
  const facingResult = snapshot.results.find((item) => item.cameraId === facing.cameraId);
  assert.ok(facingResult.reasons.includes(REASON.NEARBY));
  assert.ok(facingResult.reasons.includes(REASON.HORIZONTAL_FOV_INTERSECTS));
  assert.ok(facingResult.reasons.includes(REASON.VISIBILITY_NOT_TESTED));
  assert.equal(facingResult.fovIntersects, true);
  assert.equal(facingResult.relevant, true);
  assert.ok(Math.abs(facingResult.planDistanceM - 40) < 2);
  assert.equal(pointInHorizontalFov(13, 70), true);
  assert.equal(pointInHorizontalFov(40, 70), false);
  assert.equal(headingTowardPoint(13), true);
  assert.equal(headingTowardPoint(170), false);
  const miss = snapshot.results.find((item) => item.cameraId === 'camera-miss');
  assert.equal(miss.nearby, true);
  assert.equal(miss.fovIntersects, false);
  assert.equal(miss.relevant, false);
  const far = snapshot.results.find((item) => item.cameraId === 'camera-far');
  assert.equal(far.nearby, false);
  assert.equal(far.relevant, false);
  resetAll();
});

test('9-12 pixel density qualified only with optics; unknown and visibility honesty', () => {
  resetAll();
  const origin = COMMUNE_PIN;
  const cameraPoint = destinationAlongHeading(origin, 0, 50);
  const unknown = evaluateCameraRelevance({
    ...cameraPoint,
    cameraId: 'generic-unknown',
    heading: 180,
    horizontalFov: 60
  }, { point: origin }, { radiusM: 250 });
  assert.equal(unknown.pixelDensityPxPerM, null);
  assert.equal(unknown.pixelDensityLabel, PIXEL_DENSITY_UNKNOWN);
  assert.equal(unknown.targetDesign.known, false);
  assert.equal(unknown.visibilityTested, false);
  assert.equal(unknown.observationClaim, false);

  const qualified = evaluateCameraRelevance({
    ...cameraPoint,
    cameraId: 'axis-known',
    heading: 180,
    horizontalFov: 102,
    resolution: { width: 1920, height: 1080 },
    modelName: 'AXIS M3085-V'
  }, { point: origin }, { radiusM: 250 });
  assert.equal(qualified.targetDesign.known, true);
  assert.ok(Number.isFinite(qualified.pixelDensityPxPerM));
  assert.match(qualified.pixelDensityLabel, /PIXEL DENSITY .+ px\/m/);
  assert.equal(qualified.visibilityTested, false);
  assert.equal(qualified.observationClaim, false);
  assert.match(qualified.limitations.join(' '), /VISIBILITY NOT TESTED/);

  placeAuthoredCamera({ ...cameraPoint, heading: 180, horizontalFov: 60 });
  const snapshot = queryRelevantCameras({
    focusRef: createDropPinFocusRef({ ...origin, sourceView: VIEW_ID.MAP })
  });
  assert.equal(snapshot.visibilityTested, false);
  assert.equal(snapshot.observationClaim, false);
  assert.match(snapshot.honesty, /2D PLAN-VIEW GEOMETRY — NOT LOS — NOT REAL VISIBILITY — NOT OBSERVATION/);
  assert.equal(snapshot.results[0].pixelDensityLabel, PIXEL_DENSITY_UNKNOWN);
  resetAll();
});

test('13-14 query does not write WorldState.cameras and reuses authored-cameras store', async () => {
  resetAll();
  const chassis = chassisFactory();
  const before = chassis.stateStore.getSnapshot();
  placeAuthoredCamera({ longitude: COMMUNE_PIN.longitude, latitude: COMMUNE_PIN.latitude, heading: 0 });
  await chassis.executeChassis(CAMERA_QUERY_CAPABILITY, {
    focusRef: createDropPinFocusRef({ ...COMMUNE_PIN, sourceView: VIEW_ID.MAP })
  });
  const after = chassis.stateStore.getSnapshot();
  assert.equal(after.cameras.byViewId.MAP.viewId, VIEW_ID.MAP);
  assert.equal(after.cameras.byViewId.MAP.retained, true);
  assert.deepEqual(after.cameras.byViewId.MAP, before.cameras.byViewId.MAP);
  assert.equal(getLastCameraQuerySnapshot().worldStateCamerasWritten, false);
  assert.equal(getLastCameraQuerySnapshot().cameraPopulationSource, 'public/spatial-v2/map/authored-cameras.js');
  assert.equal(getLastCameraQuerySnapshot().cameraCount, listAuthoredCameras().length);
  const store = read('map', 'authored-cameras.js');
  const adapter = read('camera', 'spatial-camera-adapter.js');
  assert.match(adapter, /listAuthoredCameras/);
  assert.doesNotMatch(adapter, /pose-store/);
  assert.match(store, /Not WorldState\.cameras/);
  resetAll();
});

test('15-16 no Camera lab HTML/CSS/fixtures and no Road511 dependency', () => {
  const files = [
    'camera/spatial-camera-adapter.js',
    'camera/camera-ref.js',
    'camera/donor-population.js',
    'camera/engine/incident-relevance.js',
    'camera/engine/geodesy.js',
    'camera/engine/catalog.js',
    'camera/engine/optics.js',
    'camera/engine/dori.js',
    'camera/engine/relevance-constants.js',
    'shell/CameraRelevanceSurface.js'
  ];
  for (const rel of files) {
    const text = read(...rel.split('/'));
    assert.doesNotMatch(text, /camera-planner-lab/);
    assert.doesNotMatch(text, /from ['"].*pose-store/);
    assert.doesNotMatch(text, /camera-planner-lab\/engine\/pose-store/);
    assert.doesNotMatch(text, /Road511|road511/);
  }
  const engineFiles = files.filter((rel) => rel !== 'shell/CameraRelevanceSurface.js');
  for (const rel of engineFiles) {
    const text = read(...rel.split('/'));
    assert.doesNotMatch(text, /Mapillary|mapillary/);
    assert.doesNotMatch(text, /google-street-view|Street360Control|street360/);
  }
  const surface = read('shell', 'CameraRelevanceSurface.js');
  assert.doesNotMatch(surface, /\.css/);
  assert.doesNotMatch(surface, /camera-planner-lab\.html/);
});

test('17 empty authored camera store returns empty honestly', async () => {
  resetAll();
  const chassis = chassisFactory();
  await chassis.executeChassis(CAMERA_QUERY_CAPABILITY, {
    focusRef: createDropPinFocusRef({ ...COMMUNE_PIN, sourceView: VIEW_ID.MAP })
  });
  const snapshot = getLastCameraQuerySnapshot();
  assert.equal(snapshot.cameraCount, 0);
  assert.equal(snapshot.relevantCount, 0);
  assert.deepEqual(snapshot.results, []);
  assert.equal(snapshot.empty, true);
  assert.equal(snapshot.emptyReason, 'NO QUALIFIED PERSISTENT CAMERA POPULATION');
  assert.equal(snapshot.donorQualifiedCount, 0);
  const html = renderCameraRelevanceSurface();
  assert.match(html, /CAMERAS/);
  assert.match(html, /WAITING FOR FOCUS OR SELECTION/);
  assert.match(html, /PLAN GEOMETRY · VISIBILITY NOT TESTED/);
  resetAll();
});

test('18 SelectionSet is not cleared on Camera query failure', async () => {
  resetAll();
  const chassis = chassisFactory();
  const record = rememberHydrantRecord(hydrantHit());
  await chassis.executeChassis('selection.set', {
    objectRefs: [record.objectRef],
    primaryObjectRefId: objectRefKey(record.objectRef)
  });
  const before = chassis.stateStore.getSnapshot().selection;
  const surface = read('shell', 'CameraRelevanceSurface.js');
  assert.match(surface, /SelectionSet left unchanged/);
  assert.doesNotMatch(surface, /selection\.set|createEmptySelectionSet/);
  try {
    await chassis.executeChassis(CAMERA_QUERY_CAPABILITY, {
      objectRef: record.objectRef,
      focusRef: { schemaId: SCHEMA_IDS.FOCUS_REF }
    });
  } catch {
    // fail-closed query must not mutate selection
  }
  const after = chassis.stateStore.getSnapshot().selection;
  assert.equal(after.primaryObjectRefId, before.primaryObjectRefId);
  assert.equal(after.objectRefs[0].id, '5011151');
  assert.notEqual(after.objectRefs.length, createEmptySelectionSet({ sourceView: VIEW_ID.MAP }).objectRefs.length || -1);
  assert.equal(after.objectRefs.length, 1);
  resetAll();
});

test('19-20 Inspector remains intact and mapViewCreateCount stays 1', () => {
  const inspector = read('shell', 'ContextInspector.js');
  const host = read('hosts', 'view-host.js');
  const foundation = read('map', 'map-foundation.js');
  assert.match(inspector, /situation-slot/);
  assert.match(inspector, /selected-object-slot/);
  assert.match(inspector, /evidence-slot/);
  assert.match(inspector, /provenance-slot/);
  assert.match(inspector, /execution-receipt-slot/);
  assert.match(inspector, /SHEET_PANES/);
  assert.match(inspector, /WORKFLOW/);
  assert.match(inspector, /OBJECT/);
  assert.match(inspector, /EVIDENCE/);
  assert.match(inspector, /SOURCE/);
  assert.match(inspector, /RESULT/);
  assert.match(host, /data-iqai-place-camera/);
  assert.doesNotMatch(host, /new MapView\(/);
  assert.equal((foundation.match(/new MapView\(/g) || []).length, 1);
  const overlay = read('map', 'place-camera-overlay.js');
  assert.doesNotMatch(overlay, /new MapView\(/);
  const surface = read('shell', 'CameraRelevanceSurface.js');
  assert.doesNotMatch(surface, /new MapView\(/);
  assert.match(surface, /selectAuthoredCamera/);
});

test('compact surface mounts relevant rows with plan-geometry footer', () => {
  resetAll();
  const origin = COMMUNE_PIN;
  const cameraPoint = destinationAlongHeading(origin, 20, 42);
  placeAuthoredCamera({
    ...cameraPoint,
    heading: 200,
    horizontalFov: 80,
    cameraId: 'camera-row'
  });
  const snapshot = queryRelevantCameras({
    focusRef: createDropPinFocusRef({ ...origin, sourceView: VIEW_ID.MAP })
  });
  assert.ok(snapshot.relevantCount >= 1);
  const row = snapshot.relevant[0];
  assert.equal(row.compactReason, 'FOV INTERSECTS');
  assert.match(String(Math.round(row.planDistanceM)), /\d+/);
  assert.equal(row.visibilityTested, false);
  assert.equal(row.observationClaim, false);
  const html = renderCameraRelevanceSurface();
  assert.match(html, /data-iqai-camera-relevance/);
  assert.match(html, /CAMERAS/);
  resetAll();
});
