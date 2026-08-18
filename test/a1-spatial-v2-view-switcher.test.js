import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const V2 = path.join(ROOT, 'public', 'spatial-v2');

function read(...parts) {
  return fs.readFileSync(path.join(V2, ...parts), 'utf8');
}

test('VIEW switcher is the persistent operator control for MAP / STREET 360 / 3D VISUAL', () => {
  const stage = read('shell', 'MapStage.js');
  const app = read('shell', 'AppShell.js');
  const switcher = read('shell', 'ViewSwitcher.js');
  const css = read('iqai-spatial-v2.css');

  assert.equal(fs.existsSync(path.join(V2, 'shell', 'ViewSwitcher.js')), true);
  assert.match(stage, /data-iqai-view-switcher/);
  assert.match(stage, /data-iqai-view="map"/);
  assert.match(stage, /data-iqai-view="street-360"/);
  assert.match(stage, /data-iqai-view="3d-visual"/);
  assert.match(stage, /data-iqai-view="3d-analyze"/);
  assert.match(stage, />3D ANALYZE</);
  assert.match(stage, /data-iqai-drop-pin/);
  assert.match(stage, />DROP PIN</);
  assert.doesNotMatch(stage, /data-iqai-guided-cue/);
  assert.doesNotMatch(stage, /POINT PRESERVED/);
  assert.doesNotMatch(stage, />OPEN 3D</);
  assert.doesNotMatch(stage, />RETURN TO 2D</);
  assert.doesNotMatch(stage, />RETURN TO MAP</);
  assert.doesNotMatch(stage, /data-iqai-street-360-open/);
  assert.doesNotMatch(stage, /data-iqai-google-3d-open/);
  assert.match(app, /bindViewSwitcher/);
  assert.match(app, /viewSwitcher/);
  assert.match(app, /onMapPointSelected/);
  assert.match(switcher, /SELECT A POINT FOR STREET 360/);
  assert.match(switcher, /SELECT A POINT FOR 3D VISUAL/);
  assert.match(switcher, /LOADING STREET 360…/);
  assert.match(switcher, /LOADING 3D VISUAL…/);
  assert.match(switcher, /STREET 360 NOT AVAILABLE HERE/);
  assert.match(switcher, /restoreMap = except === VIEWS\.MAP/);
  assert.match(switcher, /pendingView/);
  assert.doesNotMatch(switcher, /panoId|StreetViewService|AIza/);
  assert.match(css, /\.iqai-v2-view-switcher/);
  assert.match(css, /z-index: 8/);
  assert.match(css, /\.iqai-v2-google-3d-controls\[hidden\]/);
});

test('headed VIEW switcher proof uses the real shell and one-click specialist transitions', () => {
  const validation = fs.readFileSync(
    path.join(ROOT, 'scripts', 'spatial-v2-view-switcher-validate.mjs'),
    'utf8'
  );
  assert.match(validation, /--shell/);
  assert.match(validation, /\/spatial-v2\//);
  assert.match(validation, /window\.__iqaiSpatialV2\?\.viewSwitcher/);
  assert.match(validation, /data-iqai-view="street-360"/);
  assert.match(validation, /data-iqai-view="3d-visual"/);
  assert.match(validation, /SELECT A POINT FOR STREET 360/);
  assert.match(validation, /LOADING STREET 360/);
  assert.match(validation, /STREET 360 NOT AVAILABLE HERE/);
  assert.match(validation, /POINT PRESERVED/);
  assert.match(validation, /mapViewCreateCount/);
  assert.match(validation, /askOverlap/);
  assert.match(validation, /Page\.bringToFront/);
  assert.match(validation, /if \(!report\.pass\) process\.exitCode = 1/);
  assert.doesNotMatch(validation, /Target\.targetCreated/);
});
