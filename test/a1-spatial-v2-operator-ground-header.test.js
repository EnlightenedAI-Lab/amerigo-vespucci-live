import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ENABLED_GROUND_MODES,
  GROUND_APPLY_STATE,
  GROUND_MODE
} from '../public/spatial-v2/imagery/imagery-contract.js';
import {
  compactSystemStatusValue,
  renderCommandHeader
} from '../public/spatial-v2/shell/CommandHeader.js';
import {
  createCommandCenterState,
  createCommandCenterTruthSnapshot,
  EXPERIENCE_MODE
} from '../public/spatial-v2/shell/command-center-state.js';
import { HEADER_STATUS_SLOTS } from '../public/spatial-v2/shell/layout-registry.js';
import {
  formatOperatorGroundStatus,
  OPERATOR_GROUND_CHOICES,
  OPERATOR_GROUND_MODE_IDS
} from '../public/spatial-v2/shell/OperatorGroundControl.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const V2 = path.join(ROOT, 'public', 'spatial-v2');
const ALLOWLIST = [
  'public/spatial-v2/shell/CommandHeader.js',
  'public/spatial-v2/shell/layout-registry.js',
  'public/spatial-v2/shell/AppShell.js',
  'public/spatial-v2/shell/MapStage.js',
  'public/spatial-v2/shell/command-center-state.js',
  'public/spatial-v2/shell/OperatorGroundControl.js',
  'public/spatial-v2/iqai-spatial-v2.css',
  'test/a1-spatial-v2-shell.test.js',
  'test/a1-spatial-v2-command-center.test.js',
  'test/a1-spatial-v2-operator-ground-header.test.js',
  'scripts/spatial-v2-operator-ground-header-validate.mjs'
];

function readRepo(...parts) {
  return fs.readFileSync(path.join(ROOT, ...parts), 'utf8');
}

function readV2(...parts) {
  return fs.readFileSync(path.join(V2, ...parts), 'utf8');
}

function primaryAndDetail(html) {
  const detailIndex = html.indexOf('data-iqai-system-status-detail');
  assert.ok(detailIndex > 0, 'SYSTEM STATUS detail slot missing');
  return {
    primary: html.slice(0, detailIndex),
    detail: html.slice(detailIndex)
  };
}

test('operator GROUND allowlist is the five current-ground choices', () => {
  assert.deepEqual([...OPERATOR_GROUND_MODE_IDS], [
    GROUND_MODE.NEARMAP,
    GROUND_MODE.ESRI_WORLD_IMAGERY,
    GROUND_MODE.AUTHORED_WEBMAP,
    GROUND_MODE.PURE_BLACK,
    GROUND_MODE.PURE_WHITE
  ]);
  assert.deepEqual(OPERATOR_GROUND_CHOICES.map((item) => item.label), [
    'NEARMAP',
    'ESRI WORLD IMAGERY',
    'AUTHORED MAP',
    'BLACK',
    'WHITE'
  ]);
  assert.equal(ENABLED_GROUND_MODES.includes(GROUND_MODE.NEARMAP), false);
  const source = readV2('shell', 'OperatorGroundControl.js');
  assert.doesNotMatch(source, /GOOGLE/);
  assert.doesNotMatch(source, /LOCAL_HIGHRES/);
  assert.doesNotMatch(source, /LEGACY_GOOGLE/);
  assert.doesNotMatch(source, /ENABLED_GROUND_MODES/);
  assert.doesNotMatch(source, /discoverImageryTime/);
  assert.doesNotMatch(source, /TIME_PROVIDER_FILTER/);
});

test('operator GROUND status uses ground snapshot truth only', () => {
  const modes = [
    { id: GROUND_MODE.NEARMAP, enabled: true, limitation: null },
    { id: GROUND_MODE.AUTHORED_WEBMAP, enabled: true, limitation: null }
  ];
  assert.equal(
    formatOperatorGroundStatus({
      currentMode: GROUND_MODE.NEARMAP,
      applyState: GROUND_APPLY_STATE.APPLYING,
      displayConfirmed: false
    }, { pendingMode: GROUND_MODE.NEARMAP, modes }),
    'NEARMAP · CURRENT GROUND · APPLYING'
  );
  assert.equal(
    formatOperatorGroundStatus({
      currentMode: GROUND_MODE.AUTHORED_WEBMAP,
      applyState: GROUND_APPLY_STATE.READY,
      displayConfirmed: false
    }, { pendingMode: GROUND_MODE.NEARMAP, modes }),
    'NEARMAP · CURRENT GROUND · APPLYING'
  );
  assert.equal(
    formatOperatorGroundStatus({
      currentMode: GROUND_MODE.NEARMAP,
      applyState: GROUND_APPLY_STATE.READY,
      displayConfirmed: true
    }, { modes }),
    'NEARMAP · CURRENT GROUND · DISPLAY CONFIRMED'
  );
  assert.equal(
    formatOperatorGroundStatus({
      currentMode: GROUND_MODE.NEARMAP,
      applyState: GROUND_APPLY_STATE.READY,
      displayConfirmed: false
    }, { modes }),
    'NEARMAP · CURRENT GROUND · DISPLAY NOT CONFIRMED'
  );
  assert.equal(
    formatOperatorGroundStatus({
      currentMode: GROUND_MODE.AUTHORED_WEBMAP,
      applyState: GROUND_APPLY_STATE.READY,
      displayConfirmed: true
    }, { modes }),
    'AUTHORED MAP'
  );
  assert.doesNotMatch(
    formatOperatorGroundStatus({
      currentMode: GROUND_MODE.ESRI_WORLD_IMAGERY,
      applyState: GROUND_APPLY_STATE.READY,
      displayConfirmed: false
    }, { modes: [{ id: GROUND_MODE.ESRI_WORLD_IMAGERY, enabled: true }] }),
    /DISPLAY CONFIRMED/
  );
  assert.match(
    formatOperatorGroundStatus({
      currentMode: GROUND_MODE.NEARMAP,
      applyState: GROUND_APPLY_STATE.ERROR,
      displayConfirmed: false
    }, {
      modes: [{
        id: GROUND_MODE.NEARMAP,
        enabled: false,
        limitation: 'Nearmap latest WMS readiness has not been probed.'
      }]
    }),
    /UNAVAILABLE/
  );
  assert.doesNotMatch(
    formatOperatorGroundStatus({
      currentMode: GROUND_MODE.NEARMAP,
      applyState: GROUND_APPLY_STATE.ERROR,
      error: 'https://example.invalid/wms?SERVICE=WMS&REQUEST=GetMap'
    }, {
      modes: [{
        id: GROUND_MODE.NEARMAP,
        enabled: false,
        limitation: 'https://example.invalid/wms?SERVICE=WMS&LAYERS=secret'
      }]
    }),
    /https?:|SERVICE=|LAYERS=/
  );
});

test('operator GROUND overlay is hosted on MapStage and bound through AppShell', () => {
  const app = readV2('shell', 'AppShell.js');
  const stage = readV2('shell', 'MapStage.js');
  const ground = readV2('shell', 'OperatorGroundControl.js');
  assert.match(stage, /renderOperatorGroundControl/);
  assert.match(ground, /data-iqai-operator-ground/);
  assert.match(app, /bindOperatorGroundControl/);
  assert.match(app, /paintOperatorGroundControl/);
  assert.match(app, /onChange: \(modeId\) => setGroundMode\(modeId\)/);
  assert.match(ground, /setGroundMode/);
  assert.match(ground, /for="iqai-v2-operator-ground-select">GROUND/);
});

test('closed primary header has no account email or connection clutter', () => {
  const html = renderCommandHeader();
  const { primary, detail } = primaryAndDetail(html);
  assert.match(primary, /IQAI SPATIAL/);
  assert.match(primary, /MONTRÉAL/);
  assert.match(primary, /TIME/);
  assert.match(primary, /SYSTEM STATUS/);
  assert.match(primary, />NORMAL</);
  assert.match(primary, />EXPERT</);
  assert.match(primary, /disabled[\s\S]*PRESENTATION|PRESENTATION[\s\S]*disabled/);
  assert.equal(primary.includes('@'), false);
  assert.doesNotMatch(primary, /NOT CONNECTED/);
  assert.doesNotMatch(primary, /AGOL \/ PORTAL/);
  assert.doesNotMatch(primary, /LOCAL AI/);
  assert.doesNotMatch(primary, /CLOUD AI/);
  assert.doesNotMatch(primary, /OPEN-WORLD/);
  assert.doesNotMatch(primary, /POINT INTELLIGENCE/);
  assert.match(detail, /NOT CONNECTED/);
  assert.match(detail, /SHELL ONLY/);
  assert.match(detail, /AGOL \/ PORTAL/);
  const values = HEADER_STATUS_SLOTS.map((item) => item.value);
  assert.ok(values.includes('NOT CONNECTED'));
  assert.ok(values.includes('SHELL ONLY'));
  assert.equal(compactSystemStatusValue('READY').value, 'MAP READY');
  assert.equal(compactSystemStatusValue('ERROR').value, 'MAP ERROR');
  assert.equal(compactSystemStatusValue('INITIALIZING').value, 'SHELL ONLY');
});

test('SYSTEM STATUS is presentation state and stays out of canonical truth', () => {
  const state = createCommandCenterState();
  state.setSystemStatusOpen(true);
  state.setExperience(EXPERIENCE_MODE.EXPERT);
  const snapshot = state.getSnapshot();
  assert.equal(snapshot.systemStatusOpen, true);
  assert.equal(snapshot.experience, EXPERIENCE_MODE.EXPERT);
  const truth = createCommandCenterTruthSnapshot({
    map: { state: 'READY', mapViewCreateCount: 1 },
    ground: { currentMode: GROUND_MODE.NEARMAP, applyState: 'READY', displayConfirmed: true },
    time: { displayConfirmed: false, displayState: 'NONE' },
    command: snapshot
  });
  assert.equal('experience' in truth, false);
  assert.equal('systemStatusOpen' in truth, false);
  assert.equal(truth.displayConfirmed, false);
  assert.equal(truth.groundDisplayConfirmed, true);
  assert.equal(truth.mapState, 'READY');
});

test('allowlist chrome does not write Portal items or invent CONNECTED', () => {
  for (const rel of ALLOWLIST) {
    const file = path.join(ROOT, rel);
    if (!fs.existsSync(file)) continue;
    const text = fs.readFileSync(file, 'utf8');
    assert.doesNotMatch(text, /\.save\(/);
    assert.doesNotMatch(text, /portalItem\.update/);
  }
  const shellFiles = [
    'shell/CommandHeader.js',
    'shell/AppShell.js',
    'shell/MapStage.js',
    'shell/command-center-state.js',
    'shell/OperatorGroundControl.js'
  ];
  for (const rel of shellFiles) {
    const text = readV2(...rel.split('/'));
    assert.equal(/\bCONNECTED\b/.test(text.replaceAll('NOT CONNECTED', '')), false, rel);
  }
  const app = readV2('shell', 'AppShell.js');
  assert.match(app, /updateHeaderStatus\([\s\S]*agol-portal[\s\S]*snapshot\.portalUser/);
  assert.match(app, /paintSystemStatus/);
  assert.match(readRepo('public', 'spatial-v2', 'shell', 'layout-registry.js'), /HEADER_STATUS_SLOTS/);
});
