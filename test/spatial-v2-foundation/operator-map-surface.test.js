import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  MIGRATION_STATE,
  VIEW_ID
} from '../../public/spatial-v2/foundation/contracts/index.js';
import { createSpatialV2Chassis } from '../../public/spatial-v2/bootstrap/spatial-v2-bootstrap.js';
import { renderAppShell } from '../../public/spatial-v2/shell/AppShell.js';
import { projectLayerDrawerGroups } from '../../public/spatial-v2/shell/LayersDrawer.js';
import { CURSOR_DWELL_MS } from '../../public/spatial-v2/map/spatial-cursor.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const V2 = path.join(ROOT, 'public', 'spatial-v2');

function read(rel) {
  return fs.readFileSync(path.join(V2, rel), 'utf8');
}

test('Ask IQAI is closed by default and unavailable views stay honest', () => {
  const html = renderAppShell();
  assert.match(html, /data-iqai-ask-open="false"/);
  assert.match(html, /data-iqai-slot="ask-iqai-dock"[^>]*hidden/);
  assert.match(html, />BRAIN</);
  assert.match(html, /ASK IQAI/);
  assert.match(html, /UNMIGRATED NOT MIGRATED/);
  assert.match(html, /data-iqai-view="STREET 360"/);
  assert.match(html, /data-iqai-view="3D VISUAL"/);
  assert.match(html, /data-iqai-view="3D ANALYZE"/);
  assert.match(html, /data-iqai-second-view hidden/);
  assert.match(html, /data-iqai-sheet="closed"|data-iqai-slot="context-inspector"/);
});

test('Focus marker is a reticle, not a teardrop, and DROP PIN remains the FocusRef action', () => {
  const drop = read('shell/DropPinControl.js');
  const stage = read('hosts/view-host.js');
  assert.match(drop, /style: 'cross'/);
  assert.match(drop, /style: 'circle'/);
  assert.doesNotMatch(drop, /teardrop|picture-marker|path: 'M'/);
  assert.match(stage, />FOCUS</);
  assert.match(stage, /data-iqai-cursor-live/);
  assert.match(stage, /data-iqai-map-scale/);
  assert.match(drop, /SPATIAL_FOCUS_SOURCE_TYPE\.DROP_PIN/);
  assert.match(read('shell/LayersDrawer.js'), /Does not save the authored WebMap/);
  assert.doesNotMatch(read('shell/LayersDrawer.js'), /Legend unavailable<\/em>/);
});

test('Add Data is session-local and cannot save Portal or the authored WebMap', () => {
  const foundation = read('map/map-foundation.js');
  const adapters = read('bootstrap/map-surface-adapters.js');
  assert.match(foundation, /WEBMAP_NOT_SESSION_OVERLAY/);
  assert.match(foundation, /portalWrite: false/);
  assert.match(foundation, /runtimePlane\.add\(layer\)/);
  assert.doesNotMatch(foundation, /\.save\(/);
  assert.doesNotMatch(foundation, /portalItem\.update/);
  assert.doesNotMatch(adapters, /\.save\(/);
  assert.doesNotMatch(adapters, /portalItem\.update/);
  assert.match(foundation, /type:"Web Map"/);
  assert.match(read('shell/LayersDrawer.js'), /Does not save the authored WebMap/);
});

test('precision cursor dwells before reverse geocode and does not treat missing elevation as zero', () => {
  const cursor = read('map/spatial-cursor.js');
  assert.equal(CURSOR_DWELL_MS >= 300, true);
  assert.match(cursor, /reverseGeocodeFocus/);
  assert.match(cursor, /fetchElevationMeters/);
  assert.doesNotMatch(cursor, /reverseGeocodeFocus\(.*pointer-move/);
  assert.match(read('map/coordinate-formats.js'), /Missing values stay null/);
});

test('requested time writes intent only and does not invent imagery acquisition', async () => {
  let n = 0;
  const chassis = createSpatialV2Chassis({
    now: () => '2026-08-18T21:00:00.000Z',
    idFactory: () => `oms-${++n}`
  });
  assert.equal(chassis.viewRegistry.require(VIEW_ID.MAP).migrationState, MIGRATION_STATE.MIGRATED);
  assert.equal(chassis.layerRegistry.require('session-agol').migrationState, MIGRATION_STATE.MIGRATED);
  const before = chassis.stateStore.getSnapshot();
  assert.equal(before.temporal.acquisition, null);
  const result = await chassis.executeChassis('temporal.set-requested', { instant: '2026-08-01' });
  assert.equal(result.ok, true);
  const world = chassis.stateStore.getSnapshot();
  assert.equal(world.temporal.requested.instantOrInterval, '2026-08-01T00:00:00.000Z');
  assert.equal(world.temporal.requested.precision, 'DAY');
  assert.equal(world.temporal.acquisition, null);
  assert.equal(world.temporal.match, 'NONE');
  assert.match(world.temporal.limitation, /not migrated/i);
});

test('session overlay commit is SESSION and layers drawer can project session rows', async () => {
  let n = 0;
  const chassis = createSpatialV2Chassis({
    now: () => '2026-08-18T21:00:00.000Z',
    idFactory: () => `sess-${++n}`
  });
  const added = await chassis.executeChassis('layers.add-session', { instanceId: 'session-demo' });
  assert.equal(added.ok, true);
  const world = chassis.stateStore.getSnapshot();
  assert.equal(world.layers.byId['session-demo'].status, 'SESSION');
  assert.equal(world.layers.byId['session-demo'].layerId, 'session-agol');
  const groups = projectLayerDrawerGroups({
    definitions: chassis.layerRegistry.list(),
    liveLayers: [
      { id: 'neighbourhoods', title: 'Neighbourhoods', visible: true, depth: 0, group: null, type: 'feature', opacity: 1 },
      { id: 'session-demo', title: 'Demo overlay', visible: true, depth: 0, group: 'Session overlay', type: 'feature', session: true, opacity: 0.5, legend: ['A'] }
    ],
    instances: {
      neighbourhoods: { visible: true, opacity: 1 },
      'session-demo': { ...world.layers.byId['session-demo'], opacity: 0.5 }
    }
  });
  const session = groups.find((group) => group.family === 'SESSION/INVESTIGATION');
  assert.equal(session.items[0].instanceId, 'session-demo');
  assert.equal(session.items[0].opacity, 0.5);
  assert.deepEqual(session.items[0].legend, ['A']);
});
