import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  STREET_360_OPERATOR_UNAVAILABLE,
  STREET_360_SEARCH_RADIUS_METERS,
  decideStreetViewAvailability,
  formatStreetViewCaptureDate,
  offsetMetersBetween
} from '../public/spatial-v2/map/google-street-view.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const V2 = path.join(ROOT, 'public', 'spatial-v2');

function read(...parts) {
  return fs.readFileSync(path.join(V2, ...parts), 'utf8');
}

test('Street 360 specialist files exist on the official Maps JS path', () => {
  assert.equal(fs.existsSync(path.join(V2, 'map', 'google-street-view.js')), true);
  assert.equal(fs.existsSync(path.join(V2, 'shell', 'Street360Control.js')), true);
  const engine = read('map', 'google-street-view.js');
  const control = read('shell', 'Street360Control.js');
  assert.match(engine, /StreetViewService/);
  assert.match(engine, /StreetViewPanorama/);
  assert.match(engine, /getPanorama/);
  assert.match(engine, /googleMapsBrowserApiKey/);
  assert.match(engine, /visualContextOnly: true/);
  assert.match(engine, /analysis: 'PROHIBITED'/);
  assert.match(engine, /currentLive: false/);
  assert.doesNotMatch(engine, /new MapView\(/);
  assert.doesNotMatch(engine, /new SceneView\(/);
  assert.doesNotMatch(engine, /GOOGLE_MAP_TILES_API_KEY/);
  assert.doesNotMatch(engine, /takeScreenshot|toDataURL|html2canvas/);
  assert.doesNotMatch(control, /new MapView\(/);
  assert.doesNotMatch(control, /GOOGLE_MAP_TILES_API_KEY/);
  assert.doesNotMatch(control, /\.save\(|portalItem\.update/);
});

test('Street 360 capture dates keep the precision Google actually provides', () => {
  assert.deepEqual(formatStreetViewCaptureDate(null), {
    text: null,
    precision: 'UNKNOWN',
    value: null
  });
  assert.equal(formatStreetViewCaptureDate('2019-08').precision, 'MONTH');
  assert.equal(formatStreetViewCaptureDate('2019-08').text, '2019-08');
  assert.doesNotMatch(formatStreetViewCaptureDate('2019-08').text, /2019-08-01/);
  assert.equal(formatStreetViewCaptureDate('2019').precision, 'YEAR');
  assert.equal(formatStreetViewCaptureDate('2019-08-17').precision, 'DAY');
  assert.equal(formatStreetViewCaptureDate('April 2019').precision, 'MONTH');
});

test('Street 360 refuses an unreasonable panorama offset and does not invent availability', () => {
  const requested = { longitude: -73.5673, latitude: 45.5017 };
  const nearby = decideStreetViewAvailability({
    requested,
    panorama: { longitude: -73.5674, latitude: 45.5018 },
    radiusMeters: STREET_360_SEARCH_RADIUS_METERS,
    imageDate: '2021-06',
    status: 'OK'
  });
  assert.equal(nearby.available, true);
  assert.equal(nearby.operatorStatus, 'POINT PRESERVED');
  assert.equal(nearby.currentLive, false);
  assert.ok(nearby.offsetMeters < STREET_360_SEARCH_RADIUS_METERS);

  const far = decideStreetViewAvailability({
    requested,
    panorama: { longitude: -73.58, latitude: 45.51 },
    radiusMeters: STREET_360_SEARCH_RADIUS_METERS,
    status: 'OK'
  });
  assert.equal(far.available, false);
  assert.equal(far.operatorStatus, STREET_360_OPERATOR_UNAVAILABLE);
  assert.ok(far.offsetMeters > STREET_360_SEARCH_RADIUS_METERS);

  const missing = decideStreetViewAvailability({
    requested,
    panorama: null,
    status: 'ZERO_RESULTS'
  });
  assert.equal(missing.available, false);
  assert.equal(missing.operatorStatus, STREET_360_OPERATOR_UNAVAILABLE);
  assert.equal(missing.capture.precision, 'UNKNOWN');
  assert.ok(offsetMetersBetween(requested, { latitude: 45.5017, longitude: -73.5673 }) < 1);
});

test('real V2 map stage exposes a bounded STREET 360 operator lifecycle', () => {
  const app = read('shell', 'AppShell.js');
  const stage = read('shell', 'MapStage.js');
  const control = read('shell', 'Street360Control.js');
  const css = read('iqai-spatial-v2.css');
  const foundation = read('map', 'map-foundation.js');
  const google3d = read('shell', 'GooglePhotorealistic3dControl.js');

  assert.match(stage, /data-iqai-view-switcher/);
  assert.match(stage, /data-iqai-view="map"/);
  assert.match(stage, />STREET 360</);
  assert.match(stage, />3D VISUAL</);
  assert.match(stage, />3D ANALYZE</);
  assert.match(stage, /data-iqai-street-360-stage/);
  assert.doesNotMatch(stage, /data-iqai-street-360-open/);
  assert.doesNotMatch(stage, /data-iqai-street-360-return/);
  assert.doesNotMatch(stage, />RETURN TO MAP</);
  assert.doesNotMatch(stage, /POINT PRESERVED/);
  assert.doesNotMatch(stage, /StreetViewService|getPanorama|panoId|AIza/);
  assert.match(app, /bindStreet360Control/);
  assert.match(app, /bindViewSwitcher/);
  assert.match(app, /street360\.setMapReady/);
  assert.match(app, /viewSwitcher/);
  assert.match(app, /street360,/);
  assert.doesNotMatch(app, /google-street-view\.js/);
  assert.match(control, /openGoogleStreetView/);
  assert.match(control, /closeGoogleStreetView/);
  assert.match(control, /STREET_360_OPERATOR_UNAVAILABLE/);
  assert.match(control, /selectPoint/);
  assert.match(control, /mapViewPreserved/);
  assert.match(control, /visibility = 'hidden'/);
  assert.match(control, /visibility = 'visible'/);
  assert.match(control, /getPeerSelectedPoint/);
  assert.match(control, /restoreMap/);
  assert.match(css, /data-iqai-spatial-view="street-360"/);
  assert.match(css, /data-iqai-specialist-view="street-360"/);
  assert.equal((foundation.match(/new MapView\(/g) || []).length, 1);
  assert.match(google3d, /iqaiSpecialistView === 'google-3d'/);
  assert.doesNotMatch(control, /new MapView\(/);
});

test('Street 360 headed proof uses the real shell and preserves Google 3D coexistence', () => {
  const validation = fs.readFileSync(
    path.join(ROOT, 'scripts', 'spatial-v2-street-360-validate.mjs'),
    'utf8'
  );
  assert.match(validation, /--shell/);
  assert.match(validation, /\/spatial-v2\//);
  assert.match(validation, /data-iqai-view="street-360"/);
  assert.match(validation, /viewSwitcher/);
  assert.match(validation, /selectedPointFromMapClick/);
  assert.match(validation, /STREET 360 NOT AVAILABLE HERE/);
  assert.match(validation, /lookAround/);
  assert.match(validation, /zoomWorked/);
  assert.match(validation, /movedAlongCoverage/);
  assert.match(validation, /mapViewCreateCount/);
  assert.match(validation, /google3d/);
  assert.match(validation, /Page\.bringToFront/);
  assert.match(validation, /if \(!report\.pass\) process\.exitCode = 1/);
  assert.doesNotMatch(validation, /Target\.targetCreated/);
});
