import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  MIGRATION_STATE,
  VIEW_ID,
  createDropPinFocusRef
} from '../../public/spatial-v2/foundation/contracts/index.js';
import { createSpatialV2Chassis } from '../../public/spatial-v2/bootstrap/spatial-v2-bootstrap.js';
import { renderAppShell } from '../../public/spatial-v2/shell/AppShell.js';
import { renderCommandHeader } from '../../public/spatial-v2/shell/CommandHeader.js';
import { projectLayerDrawerGroups } from '../../public/spatial-v2/shell/LayersDrawer.js';
import { WORLDVIEW_LAUNCHERS } from '../../public/spatial-v2/shell/SystemsRail.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const V2 = path.join(ROOT, 'public', 'spatial-v2');

function read(rel) {
  return fs.readFileSync(path.join(V2, rel), 'utf8');
}

test('WorldView shell keeps a permanent map-first anatomy without a dashboard', () => {
  const html = renderAppShell();
  const header = renderCommandHeader();
  assert.match(header, /IQAI SPATIAL/);
  assert.doesNotMatch(header, /MONTRÉAL/);
  assert.match(header, /Search place, address or coordinates/);
  assert.match(header, />BRAIN</);
  assert.match(header, /aria-label="Ask IQAI"/);
  assert.doesNotMatch(header, /SYSTEM STATUS/);
  assert.doesNotMatch(header, />NORMAL</);
  assert.doesNotMatch(header, />EXPERT</);
  assert.doesNotMatch(header, />CAPTURE</);
  assert.doesNotMatch(header, /PRESENTATION/);
  assert.doesNotMatch(header, /MAP READY/);
  assert.match(html, /data-iqai-launcher="layers"/);
  assert.match(html, />LAYERS</);
  assert.match(html, /\+ ADD DATA/);
  assert.match(html, />FOCUS</);
  assert.match(html, /data-iqai-view="MAP"/);
  assert.match(html, /data-iqai-view="STREET 360"/);
  assert.match(html, /data-iqai-view="3D VISUAL"/);
  assert.doesNotMatch(html, /data-iqai-view="3D ANALYZE"/);
  assert.doesNotMatch(html, /data-iqai-view="DUAL MAP"/);
  assert.match(html, /data-iqai-precision-cursor/);
  assert.match(html, /data-iqai-cursor-live/);
  assert.match(html, /data-iqai-map-scale/);
  assert.match(html, /data-iqai-precision-detail/);
  assert.match(html, /data-iqai-time-dock/);
  assert.match(html, /TIME \/ IMAGERY/);
  assert.match(html, /Ask, analyze or command/);
  assert.match(html, /data-iqai-ask-open="false"/);
  assert.doesNotMatch(html, /What do you want to know or do/);
  assert.deepEqual(WORLDVIEW_LAUNCHERS.map((item) => item.label), ['LAYERS']);
});

test('AppShell remains composition-only while MAP is wrapped outside it', () => {
  const app = read('shell/AppShell.js');
  const session = read('bootstrap/worldview-map-session.js');
  assert.match(app, /composition only/);
  assert.doesNotMatch(app, /initMapFoundation/);
  assert.doesNotMatch(app, /new MapView\(/);
  assert.match(session, /initMapFoundation/);
  assert.match(session, /bindDropPinControl/);
  assert.match(session, /bindFocusInstrument/);
  assert.match(session, /bindStreet360Control/);
  assert.match(session, /bindGooglePhotorealistic3dControl/);
  assert.match(session, /bindViewSwitcher/);
  assert.match(session, /bindWorldViewFrame/);
  assert.equal((read('map/map-foundation.js').match(/new MapView\(/g) || []).length, 1);
});

test('WorldView 3D reuses the donor in-page Maps JS engine over one MapView', () => {
  const control = read('shell/GooglePhotorealistic3dControl.js');
  const engine = read('map/google-maps-js-3d.js');
  assert.match(control, /from '\.\.\/map\/google-maps-js-3d\.js'/);
  assert.match(control, /openGoogleMapsJs3d/);
  assert.match(control, /container: stageHost/);
  assert.match(control, /canonicalFocusPoint/);
  assert.match(control, /waitForLaidOutStage/);
  assert.doesNotMatch(control, /google-3d-frame\.html/);
  assert.match(engine, /defaultUIHidden:\s*false/);
  assert.match(engine, /applySelectedPointToMap3d/);
  assert.match(engine, /settleFocusCamera/);
  assert.match(engine, /importLibrary\(['"]maps3d['"]\)/);
  assert.equal((read('map/map-foundation.js').match(/new MapView\(/g) || []).length, 1);
});

test('MAP, STREET 360, and 3D VISUAL are migrated; 3D ANALYZE stays unavailable', async () => {
  let n = 0;
  const chassis = createSpatialV2Chassis({
    now: () => '2026-08-18T18:00:00.000Z',
    idFactory: () => `wv-${++n}`
  });
  assert.equal(chassis.viewRegistry.require(VIEW_ID.MAP).migrationState, MIGRATION_STATE.MIGRATED);
  assert.equal(chassis.capabilityRegistry.require('map').migrationState, MIGRATION_STATE.MIGRATED);
  assert.equal(chassis.capabilityRegistry.require('focus.set').migrationState, MIGRATION_STATE.MIGRATED);
  assert.equal(chassis.capabilityRegistry.require('selection.set').migrationState, MIGRATION_STATE.MIGRATED);
  assert.equal(chassis.viewRegistry.require(VIEW_ID.STREET_360).migrationState, MIGRATION_STATE.MIGRATED);
  assert.equal(chassis.viewRegistry.require(VIEW_ID.VISUAL_3D).migrationState, MIGRATION_STATE.MIGRATED);
  assert.equal(chassis.viewRegistry.require(VIEW_ID.ANALYZE_3D).migrationState, MIGRATION_STATE.UNAVAILABLE);
  const focus = await chassis.executeChassis('focus.set', {
    longitude: -73.56726,
    latitude: 45.50173,
    address: null
  });
  assert.equal(focus.ok, true);
  const world = chassis.stateStore.getSnapshot();
  assert.equal(world.activeFocus.sourceAction, 'DROP_PIN');
  assert.equal(world.activeFocus.geometry.coordinates[0], -73.56726);
  assert.equal(createDropPinFocusRef({
    longitude: -73.56726,
    latitude: 45.50173,
    sourceView: VIEW_ID.MAP
  }).sourceAction, 'DROP_PIN');
});

test('Layers drawer projects registry families and live authored visibility only', () => {
  const groups = projectLayerDrawerGroups({
    definitions: [
      { layerId: 'authored-operational-map', title: 'Authored operational map', family: 'OPERATIONAL' },
      { layerId: 'chassis-session-workspace', title: 'Session workspace', family: 'SESSION/INVESTIGATION' }
    ],
    liveLayers: [
      { id: 'neighbourhoods', title: 'Neighbourhoods', visible: true, depth: 0, group: null, type: 'feature', source: 'Authored operational map' },
      { id: 'imagery-wms', title: 'Current ground', visible: false, depth: 0, group: null, type: 'wms', source: 'Authored operational map' }
    ],
    instances: {
      neighbourhoods: { visible: true },
      'imagery-wms': { visible: false }
    }
  });
  const families = groups.map((group) => group.family);
  assert.ok(families.includes('OPERATIONAL'));
  assert.ok(families.includes('IMAGERY'));
  assert.equal(families.includes('SESSION/INVESTIGATION'), false);
  const imagery = groups.find((group) => group.family === 'IMAGERY').items[0];
  assert.equal(imagery.togglable, true);
  assert.equal(imagery.visible, false);
});

test('WorldView shell stamps closed inspector and map-first hosts', () => {
  const html = renderAppShell();
  assert.match(html, /data-iqai-layers-drawer/);
  assert.match(html, /data-iqai-slot="context-inspector"/);
  assert.match(html, /data-iqai-slot="ask-iqai-dock"/);
  assert.match(html, /data-iqai-map-host/);
});

test('local API-key demo keeps OAuth code and does not embed a live secret', () => {
  const session = read('map/agol-session.js');
  const foundation = read('map/map-foundation.js');
  const focus = read('map/spatial-focus.js');
  assert.match(session, /authMode === 'local-api-key'/);
  assert.match(session, /esriConfig\.apiKey/);
  assert.match(session, /registerOAuthInfos/);
  assert.match(foundation, /apiKeyConfigured/);
  assert.match(foundation, /API_KEY_ITEM_DENIED/);
  assert.match(focus, /getLocalDemoApiKey/);
  assert.doesNotMatch(session, /AAPTau/);
  assert.doesNotMatch(foundation, /AAPTau/);
});
