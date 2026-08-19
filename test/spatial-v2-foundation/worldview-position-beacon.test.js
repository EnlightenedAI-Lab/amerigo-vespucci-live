import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSpatialV2Chassis } from '../../public/spatial-v2/bootstrap/spatial-v2-bootstrap.js';
import {
  SPATIAL_FOCUS_SOURCE_TYPE,
  getActiveSpatialFocus,
  setActiveSpatialFocus
} from '../../public/spatial-v2/map/spatial-focus.js';
import {
  STREET_OPERATING_RANGE_METERS,
  armStreetOperatingScale,
  disarmStreetOperatingScale,
  noteOperatorMapScaleIntent,
  noteStreetOperatingScaleApplied,
  offsetMeters,
  resetWorldviewNavigationForTests,
  streetOperatingScalePatch
} from '../../public/spatial-v2/map/worldview-navigation.js';
import {
  WORLDVIEW_GEOMETRY_KIND,
  createWorldviewTraversalController
} from '../../public/spatial-v2/map/worldview-traversal.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const V2 = path.join(ROOT, 'public', 'spatial-v2');

function read(rel) {
  return fs.readFileSync(path.join(V2, rel), 'utf8');
}

const START = Object.freeze({
  longitude: -73.5535,
  latitude: 45.5047,
  heading: 12,
  pitch: 0,
  zoom: 1,
  panoId: 'pano-a'
});
const NEXT = Object.freeze({
  longitude: -73.5535,
  latitude: 45.50485,
  heading: 40,
  pitch: 0,
  zoom: 1,
  panoId: 'pano-b'
});

function controller() {
  let n = 0;
  let t = 0;
  return createWorldviewTraversalController({
    idFactory: () => `trv-test-${++n}`,
    now: () => `2026-08-19T12:00:0${t++}.000Z`
  });
}

test('1. Street 360 initial pano creates current traversal start for the beacon', () => {
  const trv = controller();
  const result = trv.observeStreetPose(START);
  assert.equal(result.accepted, true);
  assert.equal(result.reason, 'start');
  assert.equal(result.snapshot.points.length, 1);
  assert.equal(result.snapshot.points[0].longitude, START.longitude);
  assert.equal(result.snapshot.points[0].latitude, START.latitude);
  assert.equal(result.snapshot.points[0].panoId, 'pano-a');
  assert.equal(result.snapshot.points[0].sourceView, 'STREET 360');
  assert.equal(result.snapshot.distanceMeters, 0);
  assert.equal(result.snapshot.active, true);
  assert.equal(result.snapshot.kind, WORLDVIEW_GEOMETRY_KIND.TRAVERSAL);
  assert.match(read('map/worldview-position-overlay.js'), /resolveBeaconPose/);
  assert.match(read('map/worldview-position-overlay.js'), /STREET 360/);
});

test('2. next panorama changes beacon coordinate by appending a travel point', () => {
  const trv = controller();
  trv.observeStreetPose(START);
  const result = trv.observeStreetPose(NEXT);
  assert.equal(result.accepted, true);
  assert.equal(result.reason, 'move');
  assert.equal(result.snapshot.points.length, 2);
  assert.equal(result.snapshot.points[1].latitude, NEXT.latitude);
  assert.equal(result.snapshot.points[1].panoId, 'pano-b');
});

test('3. heading rotates look-vector state without requiring a new point', () => {
  const trv = controller();
  trv.observeStreetPose(START);
  const result = trv.observeStreetPose({ ...START, heading: 95 });
  assert.equal(result.accepted, false);
  assert.equal(result.reason, 'orientation');
  assert.equal(result.snapshot.points.length, 1);
  assert.equal(result.snapshot.currentHeading, 95);
  assert.match(read('map/worldview-position-overlay.js'), /WORLDVIEW_LOOK/);
  assert.match(read('map/worldview-position-overlay.js'), /paintLookVector/);
  assert.match(read('map/worldview-position-overlay.js'), /destinationAlongHeading/);
});

test('4. heading-only change does NOT append traversal point', () => {
  const trv = controller();
  trv.observeStreetPose(START);
  trv.observeStreetPose({ ...START, heading: 180 });
  assert.equal(trv.snapshot().points.length, 1);
});

test('5. pitch-only change does NOT append traversal point', () => {
  const trv = controller();
  trv.observeStreetPose(START);
  const result = trv.observeStreetPose({ ...START, pitch: 22 });
  assert.equal(result.reason, 'orientation');
  assert.equal(trv.snapshot().points.length, 1);
  assert.equal(trv.snapshot().currentPitch, 22);
});

test('6. zoom-only change does NOT append traversal point', () => {
  const trv = controller();
  trv.observeStreetPose(START);
  const result = trv.observeStreetPose({ ...START, zoom: 3 });
  assert.equal(result.reason, 'orientation');
  assert.equal(trv.snapshot().points.length, 1);
  assert.equal(trv.snapshot().currentZoom, 3);
});

test('7. actual pano movement appends exactly one valid traversal point', () => {
  const trv = controller();
  trv.observeStreetPose(START);
  trv.observeStreetPose(NEXT);
  assert.equal(trv.snapshot().points.length, 2);
  trv.observeStreetPose({
    longitude: -73.55365,
    latitude: 45.505,
    heading: 10,
    panoId: 'pano-c'
  });
  assert.equal(trv.snapshot().points.length, 3);
});

test('8. duplicate/jitter event does not create duplicate path points', () => {
  const trv = controller();
  trv.observeStreetPose(START);
  trv.observeStreetPose(START);
  const jitter = trv.observeStreetPose({
    ...START,
    latitude: START.latitude + 0.00001,
    panoId: 'pano-a'
  });
  assert.equal(jitter.reason, 'orientation');
  const near = trv.observeStreetPose({
    longitude: START.longitude,
    latitude: START.latitude + 0.00002,
    heading: 12,
    panoId: null
  });
  assert.equal(near.reason, 'jitter');
  assert.equal(trv.snapshot().points.length, 1);
});

test('9. accumulated travel distance is deterministic', () => {
  const trv = controller();
  trv.observeStreetPose(START);
  trv.observeStreetPose(NEXT);
  const expected = offsetMeters(START, NEXT);
  assert.ok(expected > 10);
  assert.equal(trv.snapshot().distanceMeters, Number(expected.toFixed(3)));
  const third = {
    longitude: -73.5538,
    latitude: 45.5051,
    heading: 8,
    panoId: 'pano-c'
  };
  trv.observeStreetPose(third);
  const total = offsetMeters(START, NEXT) + offsetMeters(NEXT, third);
  assert.equal(trv.snapshot().distanceMeters, Number(total.toFixed(3)));
});

test('10. CLEAR TRACE clears path/session without inventing a position', () => {
  const trv = controller();
  trv.observeStreetPose(START);
  trv.observeStreetPose(NEXT);
  const cleared = trv.clear();
  assert.equal(cleared.points.length, 0);
  assert.equal(cleared.distanceMeters, 0);
  assert.equal(cleared.active, false);
  assert.equal(cleared.sessionId, null);
  assert.match(read('hosts/view-host.js'), /data-iqai-clear-trace/);
  assert.match(read('bootstrap/worldview-map-session.js'), /clearWorldviewTraversal/);
});

test('11. WorldView live synchronization wiring remains in place', () => {
  const session = read('bootstrap/worldview-map-session.js');
  assert.match(session, /attachWorldviewMapAdapter/);
  assert.match(session, /from '\.\.\/map\/worldview-map-adapter\.js'/);
  assert.match(session, /bindWorldviewPositionOverlay/);
  assert.match(read('map/worldview-navigation.js'), /proposeWorldviewNavigation/);
  assert.match(read('shell/Street360Control.js'), /observeStreetTraversal/);
});

test('12. MapView create count remains 1', () => {
  assert.equal((read('map/map-foundation.js').match(/new MapView\(/g) || []).length, 1);
  assert.doesNotMatch(read('map/worldview-position-overlay.js'), /new MapView\(/);
  assert.doesNotMatch(read('map/worldview-traversal.js'), /new MapView\(/);
});

test('13. layout changes preserve beacon/trace (overlay is not host layout state)', () => {
  const frame = read('shell/WorldViewFrame.js');
  assert.doesNotMatch(frame, /clearWorldviewTraversal/);
  assert.doesNotMatch(frame, /resetWorldviewTraversal/);
  assert.match(read('map/worldview-position-overlay.js'), /WORLDVIEW_BEACON_LAYER_ID/);
  assert.match(read('map/worldview-position-overlay.js'), /WORLDVIEW_TRACE_LAYER_ID/);
});

test('14. no ObjectRef / SensorPose / Focus collapse', () => {
  const traversal = read('map/worldview-traversal.js');
  const overlay = read('map/worldview-position-overlay.js');
  assert.doesNotMatch(traversal, /createObjectRef|setActiveSpatialFocus/);
  assert.doesNotMatch(overlay, /createObjectRef|setActiveSpatialFocus/);
  assert.match(overlay, /not FocusRef, not ObjectRef, not a virtual sensor/);
  assert.match(traversal, /Not ObjectRef/);
  setActiveSpatialFocus({
    longitude: -73.5535,
    latitude: 45.5047,
    sourceType: SPATIAL_FOCUS_SOURCE_TYPE.DROP_PIN,
    source: 'drop-pin'
  });
  const trv = controller();
  trv.observeStreetPose(NEXT);
  const focus = getActiveSpatialFocus();
  assert.equal(focus.longitude, -73.5535);
  assert.equal(focus.sourceType, SPATIAL_FOCUS_SOURCE_TYPE.DROP_PIN);
});

test('15. temporal truth remains requested-intent vs missing acquisition', async () => {
  let n = 0;
  const chassis = createSpatialV2Chassis({
    now: () => '2026-08-19T12:00:00.000Z',
    idFactory: () => `trv-time-${++n}`
  });
  const result = await chassis.executeChassis('temporal.set-requested', { instant: '2019-08-15' });
  assert.equal(result.ok, true);
  const world = chassis.stateStore.getSnapshot();
  assert.equal(world.temporal.requested.instantOrInterval.startsWith('2019-08-15'), true);
  assert.equal(world.temporal.acquisition, null);
  assert.doesNotMatch(read('map/worldview-traversal.js'), /wayback|nearmap/i);
  assert.doesNotMatch(read('map/worldview-position-overlay.js'), /wayback|nearmap/i);
});

test('16. programmatic layout/3D relocation does not append operator travel', () => {
  const trv = controller();
  trv.observeStreetPose(START);
  const result = trv.observeStreetPose({ ...NEXT, programmatic: true });
  assert.equal(result.accepted, false);
  assert.equal(result.reason, 'programmatic');
  assert.equal(trv.snapshot().points.length, 1);
  assert.match(read('map/worldview-traversal.js'), /beginProgrammaticTraversal/);
  assert.match(read('shell/WorldViewFrame.js'), /beginProgrammaticTraversal/);
  assert.match(read('map/google-street-view.js'), /beginProgrammaticTraversal/);
});

test('17. Street operating scale stays armed while Street is the live navigator', () => {
  resetWorldviewNavigationForTests();
  armStreetOperatingScale();
  const coarse = streetOperatingScalePatch({ rangeMeters: 1000 });
  assert.equal(coarse.rangeMeters, STREET_OPERATING_RANGE_METERS);
  noteStreetOperatingScaleApplied({ rangeMeters: STREET_OPERATING_RANGE_METERS });
  assert.equal(
    streetOperatingScalePatch({ rangeMeters: 2000 }).rangeMeters,
    STREET_OPERATING_RANGE_METERS
  );
  assert.deepEqual(streetOperatingScalePatch({ rangeMeters: 200 }), {});
  disarmStreetOperatingScale();
  assert.deepEqual(streetOperatingScalePatch({ rangeMeters: 2000 }), {});
  resetWorldviewNavigationForTests();
  armStreetOperatingScale();
  noteOperatorMapScaleIntent();
  assert.deepEqual(streetOperatingScalePatch({ rangeMeters: 2000 }), {});
  assert.match(read('map/worldview-navigation.js'), /zoomToWorldScale: false/);
  assert.match(read('shell/Street360Control.js'), /streetOperatingScalePatch/);
  assert.match(read('shell/Street360Control.js'), /disarmStreetOperatingScale/);
  assert.match(read('bootstrap/worldview-map-session.js'), /from '\.\.\/map\/worldview-map-adapter\.js'/);
  assert.match(read('map/worldview-position-overlay.js'), /r: 2\.05/);
  assert.match(read('map/worldview-position-overlay.js'), /stroke-width': 3.6/);
  assert.match(read('map/worldview-position-overlay.js'), /createElementNS/);
  assert.match(read('map/worldview-position-overlay.js'), /view\.toScreen/);
  assert.doesNotMatch(read('map/worldview-position-overlay.js'), /#ffdc30|#ffc|#ffe066|yellow/i);
  assert.match(read('map/worldview-map-adapter.js'), /STREET_MAP_OPERATING_SCALE/);
  assert.match(read('map/worldview-navigation.js'), /STREET_MAP_OPERATING_SCALE = 9000/);
});

test('18. programmatic opening seeds current position without counting later layout relocates as travel', () => {
  const trv = controller();
  const start = trv.observeStreetPose({ ...START, programmatic: true });
  assert.equal(start.accepted, true);
  assert.equal(start.reason, 'start');
  assert.equal(trv.snapshot().points.length, 1);
  const relocated = trv.observeStreetPose({ ...NEXT, programmatic: true });
  assert.equal(relocated.accepted, false);
  assert.equal(relocated.reason, 'programmatic');
  assert.equal(trv.snapshot().points.length, 1);
});

test('19. 2D north instrument is true/grid, not Esri Compass, and resets rotation', () => {
  const overlay = read('map/worldview-position-overlay.js');
  const css = read('iqai-spatial-v2.css');
  assert.match(overlay, /data-iqai-north-instrument/);
  assert.match(overlay, /TRUE \/ GRID/);
  assert.match(overlay, />N</);
  assert.match(overlay, />E</);
  assert.match(overlay, />S</);
  assert.match(overlay, />W</);
  assert.match(overlay, /resetMapNorth/);
  assert.match(overlay, /snapNorth/);
  assert.match(overlay, /rotation = 0/);
  assert.match(overlay, /not magnetic north/);
  assert.doesNotMatch(overlay, /esri-widgets-Compass|new Compass\(|arcgis-compass/);
  assert.match(css, /\.iqai-v2-north/);
  assert.match(read('bootstrap/worldview-map-session.js'), /resetNorth/);
});

test('20. look vector is distinct from north and from traversal', () => {
  const overlay = read('map/worldview-position-overlay.js');
  const kinds = read('map/worldview-traversal.js');
  assert.match(kinds, /LOOK: 'WORLDVIEW_LOOK'/);
  assert.match(kinds, /NORTH: 'WORLDVIEW_NORTH'/);
  assert.match(overlay, /sourceView !== 'STREET 360'/);
  assert.match(overlay, /data-iqai-kind': WORLDVIEW_GEOMETRY_KIND.LOOK/);
  assert.match(overlay, /data-iqai-trace-dir/);
});

test('21. current position is high-contrast optical mark, not a yellow pin', () => {
  const overlay = read('map/worldview-position-overlay.js');
  assert.match(overlay, /const INK = '#f4f0ea'/);
  assert.match(overlay, /WORLDVIEW_POSITION/);
  assert.match(overlay, /stroke-linecap': 'square'/);
  assert.doesNotMatch(overlay, /rotate\(\$\{heading/);
  assert.doesNotMatch(overlay, /SimpleMarkerSymbol/);
});

test('22. heading-only look change does not reverse historic trace direction marks', () => {
  const trv = controller();
  trv.observeStreetPose(START);
  trv.observeStreetPose(NEXT);
  const before = trv.snapshot().points.map((point) => `${point.longitude},${point.latitude}`);
  trv.observeStreetPose({ ...NEXT, heading: 220 });
  const after = trv.snapshot().points.map((point) => `${point.longitude},${point.latitude}`);
  assert.deepEqual(after, before);
  assert.equal(trv.snapshot().points.length, 2);
  assert.match(read('map/worldview-position-overlay.js'), /pointAlongPath/);
});

test('23. 3D camera instrument is distinct from 2D true/grid north', () => {
  const overlay = read('map/worldview-position-overlay.js');
  const css = read('iqai-spatial-v2.css');
  assert.match(overlay, /data-iqai-camera-instrument/);
  assert.match(overlay, /CAMERA/);
  assert.match(overlay, /pitchFromTilt/);
  assert.match(overlay, /cardinalFromHeading/);
  assert.match(css, /\.iqai-v2-camera/);
  assert.match(overlay, /not magnetic north/);
});

test('24. trace uses sparse chronological chevrons, not a dense arrow chain', () => {
  const overlay = read('map/worldview-position-overlay.js');
  assert.match(overlay, /const count = total < 48 \? 1 : 2/);
  assert.match(overlay, /stroke-width': 1.2/);
});

test('25. Street optional Google chrome is disabled; required attribution is not CSS-hidden', () => {
  const street = read('map/google-street-view.js');
  const css = read('iqai-spatial-v2.css');
  const foundation = read('map/map-foundation.js');
  assert.match(street, /disableDefaultUI: true/);
  assert.match(street, /addressControl: false/);
  assert.match(street, /panControl: false/);
  assert.match(street, /zoomControl: false/);
  assert.match(street, /linksControl: true/);
  assert.match(street, /showRoadLabels: false/);
  assert.doesNotMatch(css, /gm-style-cc[^{]*\{[^}]*display:\s*none/);
  assert.match(foundation, /ui\.components = \['attribution'\]/);
});
