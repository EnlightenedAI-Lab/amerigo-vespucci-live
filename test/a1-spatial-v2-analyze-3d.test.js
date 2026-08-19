import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  SCHEMA_IDS,
  SENSOR_POSE_SOURCE,
  createAnalyticalHit,
  createSensorPose,
  measureAnalyticalHits,
  geodesicMeters,
  enuDeltaMeters,
  MIGRATION_STATE,
  VIEW_ID
} from '../public/spatial-v2/foundation/contracts/index.js';
import { ContractError } from '../public/spatial-v2/foundation/contracts/validate.js';
import { createSpatialV2Chassis } from '../public/spatial-v2/bootstrap/spatial-v2-bootstrap.js';
import {
  DOWNTOWN_MONTREAL_SCENE_EXTENT,
  isDowntownMontrealAnalyticalCoverage,
  ANALYZE_3D_WEBSCENE_ITEM_ID,
  ANALYZE_3D_BUILDING_SCENE_URL,
  ANALYZE_3D_COVERAGE_LABEL
} from '../public/spatial-v2/map/arcgis-scene-analyze.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const V2 = path.join(ROOT, 'public', 'spatial-v2');

function read(...parts) {
  return fs.readFileSync(path.join(V2, ...parts), 'utf8');
}

function hit(overrides = {}) {
  return createAnalyticalHit({
    screen: { x: 120, y: 80 },
    mapPoint: { x: -73.56726, y: 45.50173, z: 42.1, spatialReferenceWkid: 4326 },
    longitude: -73.56726,
    latitude: 45.50173,
    z: 42.1,
    layerTitle: 'Building_Montreal',
    serviceUrl: ANALYZE_3D_BUILDING_SCENE_URL,
    webSceneItemId: ANALYZE_3D_WEBSCENE_ITEM_ID,
    objectId: 17,
    buildingFID: 'B-17',
    buildingShellFID: 'S-17',
    attributes: { OBJECTID: 17, name: 'Hall' },
    provenance: 'City of Montréal / Esri Canada / Esri. Downtown only. Not NRCan Focus.',
    ...overrides
  }, { idFactory: () => 'hit-1', now: () => '2026-08-19T16:00:00.000Z' });
}

test('3D ANALYZE is a deferred SceneView specialist isolated from Google 3D VISUAL', () => {
  const google = read('map', 'google-maps-js-3d.js');
  const analyze = read('map', 'arcgis-scene-analyze.js');
  const foundation = read('map', 'map-foundation.js');
  const control = read('shell', 'Analyze3dControl.js');
  const session = read('bootstrap', 'worldview-map-session.js');
  const host = read('hosts', 'view-host.js');

  assert.equal((foundation.match(/new MapView\(/g) || []).length, 1);
  assert.equal((foundation.match(/new SceneView\(/g) || []).length, 0);
  assert.doesNotMatch(google, /new SceneView\(/);
  assert.doesNotMatch(google, /arcgis-scene-analyze/);
  assert.doesNotMatch(google, /Building_Montreal/);
  assert.match(analyze, /new SceneView\(/);
  assert.match(analyze, /63a16e0c9f364d0fab9d55f40bf71771/);
  assert.match(analyze, /Building_Montreal/);
  assert.match(analyze, /viewingMode: 'global'/);
  assert.match(analyze, /elevationInfo/);
  assert.match(analyze, /wkid: 4326/);
  assert.match(analyze, /ground: 'world-elevation'/);
  assert.match(analyze, /WorldElevation3D\/Terrain3D/);
  assert.doesNotMatch(analyze, /basemap: 'hybrid'/);
  const sdk = read('map', 'arcgis-sdk.js');
  assert.match(sdk, /https:\/\/js\.arcgis\.com\/\$\{ARCGIS_SDK_VERSION\}/);
  assert.match(sdk, /esri\/core\/workers\/init\.js/);
  assert.doesNotMatch(sdk, /@arcgis\/core\/assets/);
  assert.match(read('index.html'), /assetsPath: 'https:\/\/js\.arcgis\.com\/5\.1'/);
  assert.match(analyze, /view\.destroy\(\)/);
  assert.doesNotMatch(analyze, /\.save\(/);
  assert.match(analyze, /Not WorldState\.cameras/);
  assert.match(analyze, /Not PLACE CAMERA/);
  assert.doesNotMatch(analyze, /Viewshed|LineOfSight/);
  assert.doesNotMatch(analyze, /new FeatureLayer\(/);
  assert.match(control, /from '\.\.\/map\/arcgis-scene-analyze\.js'/);
  assert.doesNotMatch(control, /google-maps-js-3d/);
  assert.match(session, /bindAnalyze3dControl/);
  assert.match(session, /adapterId: 'analyze-3d'|VIEW_ID\.ANALYZE_3D/);
  assert.match(host, /data-iqai-view="3D ANALYZE"/);
  assert.match(host, /data-iqai-analyze-3d-stage/);
  assert.doesNotMatch(host, /data-iqai-pane="3D ANALYZE"/);
});

test('downtown SceneLayer coverage is honest and is not island-wide Greater Montréal', () => {
  assert.equal(isDowntownMontrealAnalyticalCoverage(-73.56726, 45.50173), true);
  assert.equal(isDowntownMontrealAnalyticalCoverage(-73.5535, 45.5047), true);
  assert.equal(isDowntownMontrealAnalyticalCoverage(-73.73312, 45.52354), false);
  assert.equal(isDowntownMontrealAnalyticalCoverage(null, 45.5), false);
  assert.ok(DOWNTOWN_MONTREAL_SCENE_EXTENT.xmax - DOWNTOWN_MONTREAL_SCENE_EXTENT.xmin < 0.12);
  assert.equal(ANALYZE_3D_COVERAGE_LABEL, 'ANALYTICAL 3D COVERAGE UNAVAILABLE');
  const montrealConfig = read('..', 'spatial', 'montreal-operational-config.js');
  assert.doesNotMatch(read('map', 'arcgis-scene-analyze.js'), /isGreaterMontrealLongitudeLatitude/);
  assert.match(montrealConfig, /isGreaterMontrealLongitudeLatitude/);
});

test('AnalyticalHit keeps real identity fields and does not fabricate missing ones', () => {
  const created = hit();
  assert.equal(created.schemaId, SCHEMA_IDS.ANALYTICAL_HIT);
  assert.equal(created.objectId, 17);
  assert.equal(created.buildingFID, 'B-17');
  assert.equal(created.z, 42.1);
  assert.match(created.provenance, /Not NRCan Focus/);
  const sparse = createAnalyticalHit({
    screen: { x: 10, y: 10 },
    longitude: -73.56,
    latitude: 45.50,
    z: 12.4,
    provenance: 'City of Montréal / Esri Canada / Esri. Downtown only.'
  });
  assert.equal(sparse.objectId, null);
  assert.equal(sparse.buildingFID, null);
  assert.equal(sparse.buildingShellFID, null);
  assert.equal(sparse.attributes, null);
  assert.throws(
    () => createAnalyticalHit({
      screen: { x: 10, y: 10 },
      longitude: -73.56,
      latitude: 45.50,
      z: 12.4,
      provenance: 'ok',
      objectRef: 'not-allowed'
    }),
    (error) => error instanceof ContractError && error.code === 'UNKNOWN_FIELD'
  );
});

test('two AnalyticalHits produce direct, horizontal, and vertical measurements', () => {
  const from = hit({
    hitId: 'from',
    longitude: -73.56726,
    latitude: 45.50173,
    z: 20,
    mapPoint: { x: -73.56726, y: 45.50173, z: 20, spatialReferenceWkid: 4326 }
  });
  const to = hit({
    hitId: 'to',
    longitude: -73.56626,
    latitude: 45.50273,
    z: 45,
    screen: { x: 200, y: 90 },
    mapPoint: { x: -73.56626, y: 45.50273, z: 45, spatialReferenceWkid: 4326 },
    objectId: 18
  });
  const measured = measureAnalyticalHits(from, to, { now: () => '2026-08-19T16:00:00.000Z' });
  assert.equal(measured.schemaId, SCHEMA_IDS.ANALYTICAL_MEASURE);
  assert.ok(measured.direct3dMeters > measured.horizontalMeters);
  assert.equal(measured.verticalMeters, 25);
  assert.ok(Math.abs(measured.horizontalMeters - geodesicMeters(from, to)) < 1e-6);
  const enu = enuDeltaMeters(from, to);
  assert.ok(Math.abs(measured.direct3dMeters - enu.direct) < 1e-6);
  assert.throws(
    () => measureAnalyticalHits({ ...from, z: null }, to),
    (error) => error.code === 'MISSING_Z'
  );
});

test('SensorPose is a real-world analytical pose, not WorldState.cameras', () => {
  const pose = createSensorPose({
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
  assert.equal(pose.schemaId, SCHEMA_IDS.SENSOR_POSE);
  assert.equal(pose.source, 'SCENE_CAMERA_SAMPLE');
  assert.match(pose.provenance, /Not WorldState\.cameras/);
  assert.equal(pose.roll, null);
  assert.throws(
    () => createSensorPose({
      x: -73.56,
      y: 45.50,
      source: 'WORLDSTATE_CAMERA',
      provenance: 'no'
    }),
    (error) => error.code === 'UNKNOWN_ENUM'
  );
});

test('chassis registers 3D ANALYZE as migrated deferred SceneView, not Dual Map', () => {
  let n = 0;
  const chassis = createSpatialV2Chassis({
    now: () => '2026-08-19T16:00:00.000Z',
    idFactory: () => `a3d-${++n}`
  });
  const view = chassis.viewRegistry.require(VIEW_ID.ANALYZE_3D);
  assert.equal(view.migrationState, MIGRATION_STATE.MIGRATED);
  assert.equal(view.adapterId, 'analyze-3d');
  assert.equal(view.lifecycle, 'DEFERRED');
  assert.equal(chassis.stateStore.getSnapshot().views.byId[VIEW_ID.ANALYZE_3D].lifecycle, 'DEFERRED');
  assert.equal(chassis.viewRegistry.require(VIEW_ID.VISUAL_3D).adapterId, 'visual-3d');
  const bootstrap = read('bootstrap', 'spatial-v2-bootstrap.js');
  assert.match(bootstrap, /analyze3d: 'MIGRATED'/);
});
