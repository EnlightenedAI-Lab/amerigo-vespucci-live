import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ADDRESS_NOT_RESOLVED,
  SPATIAL_FOCUS_SOURCE_TYPE,
  formatLatitude,
  formatLatitudeLongitude,
  formatLongitude,
  isDropPinFocus,
  setActiveSpatialFocus,
  getActiveSpatialFocus
} from '../public/spatial-v2/map/spatial-focus.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const V2 = path.join(ROOT, 'public', 'spatial-v2');

function read(...parts) {
  return fs.readFileSync(path.join(V2, ...parts), 'utf8');
}

test('decimal-degree readout uses hemisphere and does not invent an address', () => {
  assert.equal(formatLatitude(45.50173), '45.50173° N');
  assert.equal(formatLongitude(-73.56726), '73.56726° W');
  assert.equal(formatLatitudeLongitude(45.50173, -73.56726), '45.50173° N   73.56726° W');
  assert.equal(ADDRESS_NOT_RESOLVED, 'ADDRESS NOT RESOLVED');
  assert.equal(SPATIAL_FOCUS_SOURCE_TYPE.DROP_PIN, 'DROP_PIN');
  const focus = setActiveSpatialFocus({
    longitude: -73.56726,
    latitude: 45.50173,
    sourceView: 'map'
  });
  assert.equal(focus.sourceType, 'DROP_PIN');
  assert.equal(focus.source, 'drop-pin');
  assert.equal(isDropPinFocus(focus), true);
  assert.equal(isDropPinFocus({ longitude: -73.56, latitude: 45.5, source: 'mapview-center' }), false);
  assert.equal(getActiveSpatialFocus().longitude, -73.56726);
  setActiveSpatialFocus(null);
});

test('DROP PIN is a map-stage spatial action and specialists consume spatial focus', () => {
  const stage = read('shell', 'MapStage.js');
  const app = read('shell', 'operator-session.js');
  const drop = read('shell', 'DropPinControl.js');
  const street = read('shell', 'Street360Control.js');
  const visual = read('shell', 'GooglePhotorealistic3dControl.js');
  const engine = read('map', 'google-maps-js-3d.js');
  const guided = read('shell', 'guided-next-action.js');
  const css = read('iqai-spatial-v2.css');

  assert.match(stage, /data-iqai-drop-pin/);
  assert.match(stage, />DROP PIN</);
  assert.match(stage, /data-iqai-pointer-coords/);
  assert.match(stage, /data-iqai-spatial-focus-receipt/);
  assert.doesNotMatch(stage, /data-iqai-guided-cue/);
  assert.doesNotMatch(stage, /data-iqai-slot="ask-iqai-dock"/);
  assert.match(app, /bindDropPinControl/);
  assert.match(app, /getActiveSpatialFocus/);
  assert.match(app, /armDropPin/);
  assert.match(drop, /is-drop-pin/);
  assert.match(drop, /reverseGeocodeFocus/);
  assert.match(drop, /ACTIVE SPATIAL FOCUS/);
  assert.match(street, /getSpatialFocus/);
  assert.match(street, /isDropPinFocus/);
  assert.match(street, /applySpatialFocus/);
  assert.doesNotMatch(street, /view\.on\('click'/);
  assert.match(visual, /getSpatialFocus/);
  assert.match(visual, /applySpatialFocus/);
  assert.match(visual, /canonicalFocusPoint/);
  assert.match(visual, /waitForLaidOutStage/);
  assert.match(visual, /cameraMissesFocus/);
  assert.doesNotMatch(visual, /view\.on\('click'/);
  assert.doesNotMatch(engine, /montreal-operational-center/);
  assert.doesNotMatch(engine, /mapview-center/);
  assert.match(engine, /return selectedPoint \? \{ \.\.\.selectedPoint \} : null/);
  assert.match(engine, /applySelectedPointToMap3d/);
  assert.match(engine, /settleFocusCamera/);
  assert.match(engine, /cameraFocusOffsetMeters/);
  assert.match(engine, /selectedPoint = null/);
  assert.match(guided, /host\.hidden = true/);
  assert.match(css, /is-drop-pin/);
  assert.match(css, /12 12, crosshair/);
  assert.match(css, /\.iqai-v2-guided-cue/);
});

test('headed spatial-focus proof uses DROP PIN rather than default center', () => {
  const validation = fs.readFileSync(
    path.join(ROOT, 'scripts', 'spatial-v2-spatial-focus-validate.mjs'),
    'utf8'
  );
  assert.match(validation, /--shell/);
  assert.match(validation, /data-iqai-drop-pin/);
  assert.match(validation, /NOW ASK IQAI/);
  assert.match(validation, /ACTIVE SPATIAL FOCUS/);
  assert.match(validation, /FLY TO POINT/);
  assert.match(validation, /mapViewCreateCount/);
  assert.match(validation, /Page\.bringToFront/);
  assert.doesNotMatch(validation, /Target\.targetCreated/);
  assert.match(validation, /if \(!report\.pass\) process\.exitCode = 1/);
});
