import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'path';
import { fileURLToPath } from 'node:url';
import {
  SCHEMA_IDS,
  VIEW_ID,
  createDropPinFocusRef,
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
  DONOR_RECORD_CLASS,
  DONOR_SCAN,
  NO_QUALIFIED_PERSISTENT_CAMERA_POPULATION,
  PLANNING_STATE,
  QUALIFIED_PERSISTENT_CAMERAS,
  classifyDonorCandidate,
  isQualifiedPersistentCameraRecord,
  listDonorFederatedCameras,
  mapQualifiedDonorRecordToFederationCamera
} from '../public/spatial-v2/camera/donor-population.js';
import {
  evaluateCameraRelevance,
  pointInHorizontalFov
} from '../public/spatial-v2/camera/engine/incident-relevance.js';
import {
  DESIGN_BAND,
  DORI_THRESHOLDS_PX_PER_M,
  PIXEL_DENSITY_UNKNOWN,
  designBandForDensity
} from '../public/spatial-v2/camera/engine/dori.js';
import { CAMERA_QUERY_CAPABILITY } from '../public/spatial-v2/camera/engine/relevance-constants.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const V2 = path.join(ROOT, 'public', 'spatial-v2');
const HYDRANTS = JSON.parse(fs.readFileSync(path.join(V2, 'data/woa/hydrants.geojson'), 'utf8'));
const COMMUNE_PIN = Object.freeze({
  longitude: -73.553221995734,
  latitude: 45.494180980834
});

function readDonor() {
  return fs.readFileSync(path.join(V2, 'camera', 'donor-population.js'), 'utf8');
}

function hydrantHit() {
  const hits = filterHydrantsWithin(HYDRANTS, COMMUNE_PIN, 80);
  const match = hits.find((hit) => String(hit.sourceId) === '5011151');
  assert.ok(match, 'Ville coverage must include hydrant 5011151.');
  return match;
}

function resetAll() {
  resetAuthoredCameras();
  resetCameraQuerySnapshot();
  clearHydrantRecords();
}

function qualifiedDouble(overrides = {}) {
  return {
    persistent: true,
    sessionOnly: false,
    fixture: false,
    providerView: false,
    cameraId: 'donor-cam-qualified-double',
    longitude: -73.5673,
    latitude: 45.5017,
    heading: 218,
    horizontalFov: 70,
    resolutionWidth: 1920,
    modelId: 'axis-m3085-v',
    planningState: PLANNING_STATE.AUTHORED_NOT_INSTALLED,
    sourceFile: 'unit-test-double',
    locationSource: 'unit-test-double',
    opticsSource: 'unit-test-double',
    ...overrides
  };
}

test('1 qualified donor record maps to CameraRef; production list stays empty', () => {
  assert.equal(QUALIFIED_PERSISTENT_CAMERAS.length, 0);
  assert.deepEqual(listDonorFederatedCameras(), []);
  const mapped = mapQualifiedDonorRecordToFederationCamera(qualifiedDouble());
  assert.equal(isCameraRef(mapped.cameraRef), true);
  assert.equal(mapped.cameraRef.authority, CAMERA_REF_AUTHORITY);
  assert.equal(mapped.cameraRef.objectType, 'camera');
  assert.equal(mapped.cameraId, 'donor-cam-qualified-double');
  assert.equal(listDonorFederatedCameras().length, 0);
});

test('2 CameraRef authority remains iqai.camera', () => {
  const mapped = mapQualifiedDonorRecordToFederationCamera(qualifiedDouble());
  assert.equal(mapped.cameraRef.authority, 'iqai.camera');
  assert.equal(createCameraRef(mapped.cameraId).authority, 'iqai.camera');
});

test('3-4 CameraRef is not inserted into SelectionSet; FocusRef remains target authority', async () => {
  resetAll();
  const chassis = createSpatialV2Chassis({
    now: () => '2026-08-21T04:00:00.000Z',
    idFactory: () => 'pop-focus'
  });
  const record = rememberHydrantRecord(hydrantHit());
  await chassis.executeChassis('selection.set', {
    objectRefs: [record.objectRef],
    primaryObjectRefId: objectRefKey(record.objectRef)
  });
  await chassis.executeChassis(CAMERA_QUERY_CAPABILITY, {
    objectRef: record.objectRef,
    focusRef: createDropPinFocusRef({ ...COMMUNE_PIN, sourceView: VIEW_ID.MAP })
  });
  const world = chassis.stateStore.getSnapshot();
  assert.equal(world.selection.objectRefs.some((ref) => isCameraRef(ref)), false);
  assert.equal(isObjectRef(world.selection.objectRefs[0]), true);
  assert.equal(world.selection.objectRefs[0].schemaId, SCHEMA_IDS.OBJECT_REF);
  const snapshot = getLastCameraQuerySnapshot();
  assert.equal(snapshot.target.source, 'OBJECT_REMEMBERED');
  resetAll();
});

test('5-7 donor coordinates, heading, and planning qualification preserved exactly', () => {
  const mapped = mapQualifiedDonorRecordToFederationCamera(qualifiedDouble({
    longitude: -73.567312345,
    latitude: 45.501712345,
    heading: 218,
    planningState: PLANNING_STATE.PLANNED
  }));
  assert.equal(mapped.longitude, -73.567312345);
  assert.equal(mapped.latitude, 45.501712345);
  assert.equal(mapped.heading, 218);
  assert.equal(mapped.planningState, PLANNING_STATE.PLANNED);
  assert.equal(mapped.qualification, PLANNING_STATE.PLANNED);
  assert.equal(mapped.planned, true);
  assert.equal(mapped.installed, false);

  const authored = mapQualifiedDonorRecordToFederationCamera(qualifiedDouble({
    planningState: PLANNING_STATE.AUTHORED_NOT_INSTALLED
  }));
  assert.equal(authored.qualification, PLANNING_STATE.AUTHORED_NOT_INSTALLED);
  assert.equal(authored.installed, false);
  assert.equal(authored.planned, false);

  const installed = mapQualifiedDonorRecordToFederationCamera(qualifiedDouble({
    planningState: PLANNING_STATE.INSTALLED_KNOWN
  }));
  assert.equal(installed.qualification, PLANNING_STATE.INSTALLED_KNOWN);
  assert.equal(installed.installed, true);
});

test('8-9 missing resolution and HFOV remain UNKNOWN', () => {
  const mapped = mapQualifiedDonorRecordToFederationCamera(qualifiedDouble({
    horizontalFov: null,
    resolutionWidth: null
  }));
  assert.equal(mapped.horizontalFov, null);
  assert.equal(mapped.resolution, null);
  assert.ok(mapped.provenance.unknownFields.includes('horizontalFov'));
  assert.ok(mapped.provenance.unknownFields.includes('resolutionWidth'));
  const design = evaluateCameraRelevance({
    cameraId: mapped.cameraId,
    longitude: mapped.longitude,
    latitude: mapped.latitude,
    heading: mapped.heading,
    horizontalFov: mapped.horizontalFov,
    resolution: mapped.resolution
  }, { point: COMMUNE_PIN }, { radiusM: 250 });
  assert.equal(design.pixelDensityLabel, PIXEL_DENSITY_UNKNOWN);
  assert.equal(design.targetDesign.known, false);
});

test('10-11 known resolution + HFOV yields existing pixel-density and DORI thresholds', () => {
  const mapped = mapQualifiedDonorRecordToFederationCamera(qualifiedDouble({
    horizontalFov: 102,
    resolutionWidth: 1920
  }));
  const cameraPoint = { longitude: COMMUNE_PIN.longitude, latitude: COMMUNE_PIN.latitude + 0.0004 };
  const result = evaluateCameraRelevance({
    ...cameraPoint,
    cameraId: mapped.cameraId,
    heading: 180,
    horizontalFov: mapped.horizontalFov,
    resolution: mapped.resolution
  }, { point: COMMUNE_PIN }, { radiusM: 250 });
  assert.equal(result.targetDesign.known, true);
  assert.ok(Number.isFinite(result.pixelDensityPxPerM));
  assert.equal(designBandForDensity(25), DESIGN_BAND.DETECT);
  assert.equal(designBandForDensity(62.5), DESIGN_BAND.OBSERVE);
  assert.equal(designBandForDensity(125), DESIGN_BAND.RECOGNIZE);
  assert.equal(designBandForDensity(250), DESIGN_BAND.IDENTIFY);
  assert.equal(DORI_THRESHOLDS_PX_PER_M.DETECT, 25);
  assert.equal(DORI_THRESHOLDS_PX_PER_M.IDENTIFY, 250);
});

test('12 relevant query stays empty because no qualified persistent population exists', () => {
  resetAll();
  const snapshot = queryRelevantCameras({
    focusRef: createDropPinFocusRef({ ...COMMUNE_PIN, sourceView: VIEW_ID.MAP })
  });
  assert.equal(DONOR_SCAN.qualifiedPersistent, 0);
  assert.equal(listDonorFederatedCameras().length, 0);
  assert.equal(snapshot.cameraCount, 0);
  assert.equal(snapshot.relevantCount, 0);
  assert.equal(snapshot.empty, true);
  assert.equal(snapshot.emptyReason, NO_QUALIFIED_PERSISTENT_CAMERA_POPULATION);
  resetAll();
});

test('13-16 distance/FOV use existing geometry; visibility and observation stay false', () => {
  resetAll();
  const mapped = mapQualifiedDonorRecordToFederationCamera(qualifiedDouble({
    longitude: COMMUNE_PIN.longitude,
    latitude: COMMUNE_PIN.latitude + 0.00036,
    heading: 180,
    horizontalFov: 70
  }));
  const snapshot = queryRelevantCameras({
    focusRef: createDropPinFocusRef({ ...COMMUNE_PIN, sourceView: VIEW_ID.MAP })
  }, { cameras: [mapped] });
  assert.ok(snapshot.results.length >= 1);
  assert.ok(Number.isFinite(snapshot.results[0].planDistanceM));
  assert.ok(snapshot.results[0].planDistanceM > 0);
  assert.equal(typeof snapshot.results[0].fovIntersects, 'boolean');
  assert.equal(pointInHorizontalFov(13, 70), true);
  assert.equal(snapshot.visibilityTested, false);
  assert.equal(snapshot.observationClaim, false);
  assert.equal(snapshot.results[0].visibilityTested, false);
  assert.equal(snapshot.results[0].observationClaim, false);
  assert.match(snapshot.honesty, /2D PLAN-VIEW GEOMETRY — NOT LOS — NOT REAL VISIBILITY — NOT OBSERVATION/);
  assert.equal(listDonorFederatedCameras().length, 0);
  resetAll();
});

test('17 provider views are excluded from physical Camera population', () => {
  const provider = {
    persistent: true,
    cameraId: 'provider-view-1',
    longitude: -73.55,
    latitude: 45.50,
    providerView: true,
    representationKind: 'PROVIDER_VIEW'
  };
  assert.equal(classifyDonorCandidate(provider), DONOR_RECORD_CLASS.PROVIDER_VIEW);
  assert.equal(isQualifiedPersistentCameraRecord(provider), false);
  assert.equal(mapQualifiedDonorRecordToFederationCamera(provider), null);
  assert.equal(DONOR_SCAN.excludedProviderViewAdapters, 1);
});

test('18 fixtures are excluded from production population', () => {
  const fixture = {
    persistent: true,
    fixture: true,
    cameraId: 'fixture-cam',
    longitude: -73.5673,
    latitude: 45.5017,
    planningState: PLANNING_STATE.AUTHORED_NOT_INSTALLED
  };
  assert.equal(classifyDonorCandidate(fixture), DONOR_RECORD_CLASS.FIXTURE_TEST_ONLY);
  assert.equal(isQualifiedPersistentCameraRecord(fixture), false);
  assert.equal(mapQualifiedDonorRecordToFederationCamera(fixture), null);
  assert.equal(DONOR_SCAN.excludedFixtureScenes, 7);
});

test('19 no invented camera record exists in production donor population', () => {
  assert.deepEqual(QUALIFIED_PERSISTENT_CAMERAS, []);
  assert.equal(listDonorFederatedCameras().length, 0);
  const source = readDonor();
  assert.match(source, /QUALIFIED_PERSISTENT_CAMERAS = Object\.freeze\(\[\]\)/);
  assert.doesNotMatch(source, /cameraId: '/);
  assert.equal(DONOR_SCAN.persistentPopulationFile, false);
  assert.equal(DONOR_SCAN.installedKnownEnumOnly, true);
  const session = {
    cameraId: 'session-seed',
    longitude: -73.5673,
    latitude: 45.5017,
    persistent: false,
    sessionOnly: true
  };
  assert.equal(classifyDonorCandidate(session), DONOR_RECORD_CLASS.SESSION_ONLY);
  assert.equal(mapQualifiedDonorRecordToFederationCamera(session), null);
});

test('20 MapView create count remains 1', () => {
  const foundation = fs.readFileSync(path.join(V2, 'map', 'map-foundation.js'), 'utf8');
  const surface = fs.readFileSync(path.join(V2, 'shell', 'CameraRelevanceSurface.js'), 'utf8');
  const donor = readDonor();
  assert.equal((foundation.match(/new MapView\(/g) || []).length, 1);
  assert.doesNotMatch(surface, /new MapView\(/);
  assert.doesNotMatch(donor, /new MapView\(/);
});

test('21-22 existing Place Camera / FocusRef / ObjectRef identity remains', async () => {
  resetAll();
  const chassis = createSpatialV2Chassis({
    now: () => '2026-08-21T04:00:00.000Z',
    idFactory: () => 'pop-place'
  });
  const camera = placeAuthoredCamera({
    ...COMMUNE_PIN,
    heading: 40,
    horizontalFov: 60
  });
  assert.equal(listAuthoredCameras()[0].cameraId, camera.cameraId);
  const focus = createDropPinFocusRef({ ...COMMUNE_PIN, sourceView: VIEW_ID.MAP });
  await chassis.executeChassis(CAMERA_QUERY_CAPABILITY, { focusRef: focus });
  const snapshot = getLastCameraQuerySnapshot();
  assert.equal(snapshot.target.source, 'FOCUS_POINT');
  assert.equal(snapshot.cameraCount, 1);
  assert.equal(isCameraRef(snapshot.results[0].cameraRef), true);
  const world = chassis.stateStore.getSnapshot();
  assert.equal(world.selection.objectRefs.some((ref) => isCameraRef(ref)), false);
  resetAll();
});
