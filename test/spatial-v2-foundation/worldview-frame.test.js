import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderAppShell } from '../../public/spatial-v2/shell/AppShell.js';
import { createSpatialV2Chassis } from '../../public/spatial-v2/bootstrap/spatial-v2-bootstrap.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const V2 = path.join(ROOT, 'public', 'spatial-v2');

function read(rel) {
  return fs.readFileSync(path.join(V2, rel), 'utf8');
}

test('WorldView Frame exposes 1-4 layout and observation panes without Dual Map', () => {
  const html = renderAppShell();
  const frame = read('shell/WorldViewFrame.js');
  const host = read('hosts/view-host.js');
  const session = read('bootstrap/worldview-map-session.js');
  const css = read('iqai-spatial-v2.css');
  assert.match(html, /data-iqai-worldview-frame/);
  assert.match(html, /data-iqai-layout="1"/);
  assert.match(html, /data-iqai-layout="2"/);
  assert.match(html, /data-iqai-layout="3"/);
  assert.match(html, /data-iqai-layout="4"/);
  assert.match(html, /data-iqai-pane="MAP"/);
  assert.match(html, /data-iqai-pane="STREET 360"/);
  assert.match(html, /data-iqai-pane="3D VISUAL"/);
  assert.match(html, /data-iqai-pane="IMAGERY"/);
  assert.match(html, /data-iqai-imagery-pane-source="NEARMAP"/);
  assert.match(html, /data-iqai-imagery-pane-source="LIBRARY"/);
  assert.match(html, /NOT CONNECTED \/ NOT MIGRATED/);
  assert.match(html, /data-iqai-pane-maximize/);
  assert.match(html, /data-iqai-pane-restore/);
  assert.match(html, /data-iqai-pane-close/);
  assert.doesNotMatch(html, /data-iqai-view="DUAL MAP"/);
  assert.match(frame, /bindWorldViewFrame/);
  assert.match(frame, /followFocus/);
  assert.doesNotMatch(frame, /new MapView\(/);
  assert.match(session, /bindWorldViewFrame/);
  assert.match(session, /keepMapVisible: true/);
  assert.match(session, /exclusive: false/);
  assert.match(session, /attachWorldviewMapAdapter/);
  assert.match(session, /seedWorldviewNavigationFromFocus/);
  assert.match(session, /openSupporting\?\.\('3D VISUAL'\)/);
  assert.match(css, /data-iqai-worldview-layout="3"/);
  assert.match(css, /--iqai-split-top/);
  assert.match(css, /--iqai-split-left/);
  assert.match(host, /data-iqai-splitters/);
  assert.match(host, /data-iqai-split="row"/);
  assert.match(host, /data-iqai-split="col"/);
  assert.match(host, /data-iqai-basemap-picker/);
  assert.match(frame, /paintSplitters/);
  assert.match(frame, /resizeGoogleStreetView/);
  assert.match(frame, /return applyLayout\(2, WORLDVIEW_PANE\.STREET_360\)/);
  assert.doesNotMatch(frame, /pairView === WORLDVIEW_PANE\.VISUAL_3D\) return applyLayout\(3\)/);
  assert.match(frame, /activePresentation/);
  assert.match(frame, /concealStreet/);
  assert.match(frame, /await ensureStreet/);
  assert.doesNotMatch(frame, /new MapView\(/);
  assert.equal((read('map/map-foundation.js').match(/new MapView\(/g) || []).length, 1);
  assert.match(host, /data-iqai-imagery-seam/);
  assert.match(host, /data-iqai-imagery-pane-stage/);
  assert.match(frame, /dockHistoryStage/);
  assert.match(frame, /ensureImagery/);
  assert.match(frame, /leaveImagery/);
  assert.match(session, /openWorldviewImagery/);
  assert.match(session, /overlayHydrantMarks/);
  assert.doesNotMatch(session, /new MapView\(/);
  assert.match(css, /data-iqai-worldview-layout="4"\] \[data-iqai-pane="IMAGERY"\] \[data-iqai-history-stage\]/);
});

test('WorldView Time strip is permanent and does not invent imagery dates', () => {
  const html = renderAppShell();
  const dock = read('shell/TimeDock.js');
  assert.match(html, /data-iqai-time-strip/);
  assert.match(html, /data-iqai-time-requested/);
  assert.match(html, /data-iqai-time-year="2019"/);
  assert.match(html, /NEARMAP NOT CONNECTED/);
  assert.match(html, /WAYBACK NOT CONNECTED/);
  assert.match(dock, /TARGET/);
  assert.match(dock, /Requested time is intent, never observation/);
  assert.doesNotMatch(dock, /TimeSlider/);
});

test('Specialists keep the MapView visible in WorldView and 3D stays CURRENT ONLY', () => {
  const street = read('shell/Street360Control.js');
  const visual = read('shell/GooglePhotorealistic3dControl.js');
  const switcher = read('shell/ViewSwitcher.js');
  assert.match(street, /keepMapVisible/);
  assert.match(visual, /keepMapVisible/);
  assert.match(visual, /CURRENT_ONLY/);
  assert.match(visual, /CURRENT ONLY/);
  assert.match(switcher, /exclusive !== false/);
  assert.match(switcher, /onRequestView/);
});

test('temporal.set-requested remains World State intent and does not fill acquisition', async () => {
  let n = 0;
  const chassis = createSpatialV2Chassis({
    now: () => '2026-08-19T12:00:00.000Z',
    idFactory: () => `wv-time-${++n}`
  });
  const result = await chassis.executeChassis('temporal.set-requested', { instant: '2019-08-15' });
  assert.equal(result.ok, true);
  const world = chassis.stateStore.getSnapshot();
  assert.equal(world.temporal.requested.instantOrInterval.startsWith('2019-08-15'), true);
  assert.equal(world.temporal.acquisition, null);
  assert.equal(world.temporal.match, 'NONE');
  assert.match(world.temporal.limitation || '', /not migrated|intent/i);
});
