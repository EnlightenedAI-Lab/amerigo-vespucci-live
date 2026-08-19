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
  WORLDVIEW_NAV_SOURCE,
  WORLDVIEW_NAV_TOLERANCE,
  createWorldviewNavigationController,
  getStreet360LiveCapability,
  mapScaleFromRangeMeters,
  navigationWithinTolerance,
  rangeMetersFromMapScale,
  resetWorldviewNavigationForTests
} from '../../public/spatial-v2/map/worldview-navigation.js';
import {
  applyWorldviewNavigationToMapView,
  attachWorldviewMapAdapter,
  readMapViewNavigation
} from '../../public/spatial-v2/map/worldview-map-adapter.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const V2 = path.join(ROOT, 'public', 'spatial-v2');

function read(rel) {
  return fs.readFileSync(path.join(V2, rel), 'utf8');
}

function fakeMapView(seed = {}) {
  const watches = [];
  const view = {
    center: {
      longitude: seed.longitude ?? -73.5535,
      latitude: seed.latitude ?? 45.5047
    },
    scale: seed.scale ?? 144448,
    rotation: seed.heading ?? 0,
    extent: { width: seed.extentWidth ?? 2000 },
    watch(prop, fn) {
      watches.push({ prop, fn });
      return { remove() {} };
    }
  };
  return { view, watches };
}

test('1. MAP navigation updates shared WorldView state', () => {
  const nav = createWorldviewNavigationController();
  const result = nav.propose(WORLDVIEW_NAV_SOURCE.MAP, {
    longitude: -73.56,
    latitude: 45.50,
    scale: 144448,
    heading: 12
  });
  assert.equal(result.accepted, true);
  assert.equal(result.snapshot.sourceView, WORLDVIEW_NAV_SOURCE.MAP);
  assert.equal(result.snapshot.longitude, -73.56);
  assert.equal(result.snapshot.latitude, 45.50);
  assert.ok(Math.abs(result.snapshot.rangeMeters - 1000) < 1);
  assert.equal(result.snapshot.heading, 12);
  assert.equal(result.snapshot.revision, 1);
});

test('2. shared state drives 3D adapter input without view-to-view callbacks', () => {
  const nav = createWorldviewNavigationController();
  const applied = [];
  nav.subscribe((state) => {
    if (!state || state.sourceView === WORLDVIEW_NAV_SOURCE.VISUAL_3D) return;
    applied.push(state);
  });
  nav.propose(WORLDVIEW_NAV_SOURCE.MAP, {
    longitude: -73.56726,
    latitude: 45.50173,
    rangeMeters: 800
  });
  assert.equal(applied.at(-1).latitude, 45.50173);
  assert.equal(applied.at(-1).rangeMeters, 800);
  assert.doesNotMatch(read('map/worldview-navigation.js'), /google3d\.open|street360\.open/);
  assert.match(read('shell/GooglePhotorealistic3dControl.js'), /subscribeWorldviewNavigation/);
  assert.match(read('map/google-maps-js-3d.js'), /applyWorldviewNavigationToMap3d/);
});

test('3. 3D navigation updates shared state', () => {
  const nav = createWorldviewNavigationController();
  const result = nav.propose(WORLDVIEW_NAV_SOURCE.VISUAL_3D, {
    longitude: -73.57,
    latitude: 45.502,
    rangeMeters: 600,
    heading: 90
  });
  assert.equal(result.accepted, true);
  assert.equal(result.snapshot.sourceView, WORLDVIEW_NAV_SOURCE.VISUAL_3D);
  assert.equal(result.snapshot.rangeMeters, 600);
  assert.equal(result.snapshot.heading, 90);
  assert.equal(result.snapshot.tilt, undefined);
});

test('4. shared state drives MAP adapter', () => {
  const { view } = fakeMapView();
  resetWorldviewNavigationForTests();
  const applied = applyWorldviewNavigationToMapView(view, {
    longitude: -73.58,
    latitude: 45.51,
    rangeMeters: 500,
    heading: 45,
    revision: 4
  });
  assert.equal(applied, true);
  assert.equal(view.center.longitude, -73.58);
  assert.equal(view.center.latitude, 45.51);
  assert.ok(Math.abs(view.scale - mapScaleFromRangeMeters(500)) < 1);
  assert.equal(view.rotation, 45);
  const sample = readMapViewNavigation(view);
  assert.equal(sample.longitude, -73.58);
});

test('5. feedback-loop prevention uses programmatic + echo window + tolerance', () => {
  const nav = createWorldviewNavigationController();
  nav.propose(WORLDVIEW_NAV_SOURCE.MAP, {
    longitude: -73.5535,
    latitude: 45.5047,
    rangeMeters: 1000
  });
  const first = nav.snapshot();
  const again = nav.propose(WORLDVIEW_NAV_SOURCE.VISUAL_3D, {
    longitude: -73.5535,
    latitude: 45.5047,
    rangeMeters: 1000
  });
  assert.equal(again.accepted, false);
  assert.equal(again.reason, 'tolerance');

  nav.beginApply(WORLDVIEW_NAV_SOURCE.VISUAL_3D);
  const programmatic = nav.propose(WORLDVIEW_NAV_SOURCE.VISUAL_3D, {
    longitude: -73.56,
    latitude: 45.50,
    rangeMeters: 400
  });
  assert.equal(programmatic.accepted, false);
  assert.equal(programmatic.reason, 'programmatic');
  nav.endApply(WORLDVIEW_NAV_SOURCE.VISUAL_3D, first.revision);

  const echo = nav.propose(WORLDVIEW_NAV_SOURCE.VISUAL_3D, {
    longitude: -73.57,
    latitude: 45.49,
    rangeMeters: 400
  });
  assert.equal(echo.accepted, false);
  assert.equal(echo.reason, 'echo');
  assert.ok(nav.getEchoBudget() >= 1);
});

test('6. tolerance and debounce stay bounded, not a hidden delay', () => {
  assert.equal(WORLDVIEW_NAV_TOLERANCE.centerMeters, 12);
  assert.equal(WORLDVIEW_NAV_TOLERANCE.rangeRatio, 0.08);
  assert.equal(WORLDVIEW_NAV_TOLERANCE.headingDeg, 2.5);
  assert.equal(WORLDVIEW_NAV_TOLERANCE.debounceMs, 48);
  assert.equal(WORLDVIEW_NAV_TOLERANCE.echoMs, 320);
  assert.ok(WORLDVIEW_NAV_TOLERANCE.echoMs < 400);
  assert.ok(navigationWithinTolerance(
    { longitude: -73.5535, latitude: 45.5047, rangeMeters: 1000, heading: 0 },
    { longitude: -73.55351, latitude: 45.5047, rangeMeters: 1020, heading: 1 }
  ));
  assert.equal(
    navigationWithinTolerance(
      { longitude: -73.56, latitude: 45.50, rangeMeters: 1000 },
      { longitude: -73.5535, latitude: 45.5047, rangeMeters: 1000 }
    ),
    false
  );
  assert.ok(Math.abs(rangeMetersFromMapScale(144448) - 1000) < 0.01);
});

test('7. layout change does not reset navigation state', () => {
  resetWorldviewNavigationForTests();
  const frame = read('shell/WorldViewFrame.js');
  assert.match(frame, /navigation: getWorldviewNavigation\(\)/);
  assert.doesNotMatch(frame, /resetWorldviewNavigation/);
  assert.match(frame, /seedWorldviewNavigationFromFocus/);
  const { view, watches } = fakeMapView();
  const detach = attachWorldviewMapAdapter(view);
  view.center = { longitude: -73.56, latitude: 45.50 };
  watches.find((item) => item.prop === 'center')?.fn();
  detach();
});

test('8. reopening a view reads current WorldView navigation, not startup Focus only', () => {
  const visual = read('shell/GooglePhotorealistic3dControl.js');
  const street = read('shell/Street360Control.js');
  assert.match(visual, /openCameraTarget/);
  assert.match(visual, /getWorldviewNavigation\(\)/);
  assert.match(visual, /markerLongitude/);
  assert.match(street, /openTarget/);
  assert.match(street, /preferPosition: target.source === 'worldview-navigation'/);
  assert.match(read('map/google-maps-js-3d.js'), /options.range/);
  assert.match(read('map/google-street-view.js'), /preferPosition/);
});

test('9. existing Focus target is not overwritten by navigation', () => {
  setActiveSpatialFocus({
    longitude: -73.5535,
    latitude: 45.5047,
    sourceType: SPATIAL_FOCUS_SOURCE_TYPE.DROP_PIN,
    source: 'drop-pin'
  });
  const nav = createWorldviewNavigationController();
  nav.propose(WORLDVIEW_NAV_SOURCE.MAP, {
    longitude: -73.56726,
    latitude: 45.50173,
    rangeMeters: 900
  });
  const focus = getActiveSpatialFocus();
  assert.equal(focus.longitude, -73.5535);
  assert.equal(focus.latitude, 45.5047);
  assert.equal(focus.sourceType, SPATIAL_FOCUS_SOURCE_TYPE.DROP_PIN);
  assert.doesNotMatch(read('map/worldview-navigation.js'), /setActiveSpatialFocus/);
  assert.doesNotMatch(read('map/worldview-map-adapter.js'), /setActiveSpatialFocus/);
});

test('10. temporal truth remains requested-intent vs missing acquisition', async () => {
  let n = 0;
  const chassis = createSpatialV2Chassis({
    now: () => '2026-08-19T12:00:00.000Z',
    idFactory: () => `wv-nav-time-${++n}`
  });
  const result = await chassis.executeChassis('temporal.set-requested', { instant: '2019-08-15' });
  assert.equal(result.ok, true);
  const world = chassis.stateStore.getSnapshot();
  assert.equal(world.temporal.requested.instantOrInterval.startsWith('2019-08-15'), true);
  assert.equal(world.temporal.acquisition, null);
  assert.match(read('shell/GooglePhotorealistic3dControl.js'), /CURRENT_ONLY/);
  assert.doesNotMatch(read('map/worldview-navigation.js'), /wayback|nearmap/i);
});

test('11. Street 360 live position sync uses genuine panorama events', () => {
  const capability = getStreet360LiveCapability();
  assert.equal(capability.positionEvents, true);
  assert.equal(capability.headingFromPov, true);
  assert.ok(capability.events.includes('position_changed'));
  assert.ok(capability.events.includes('pano_changed'));
  assert.ok(capability.events.includes('pov_changed'));
  const engine = read('map/google-street-view.js');
  assert.match(engine, /position_changed/);
  assert.match(engine, /subscribeGoogleStreetViewNavigation/);
  assert.match(read('shell/Street360Control.js'), /subscribeGoogleStreetViewNavigation/);
  assert.match(read('shell/Street360Control.js'), /WORLDVIEW_NAV_SOURCE.STREET_360/);
});

test('12. Street zoom/pitch stay Street-only; no fake 2D pitch', () => {
  const capability = getStreet360LiveCapability();
  assert.equal(capability.zoomToWorldScale, false);
  assert.equal(capability.pitchToMap, false);
  assert.equal(capability.pitchTo3dTilt, false);
  assert.match(read('map/google-maps-js-3d.js'), /tilt: Number.isFinite\(camera.tilt\) \? camera.tilt : lastOperatorTilt/);
  assert.doesNotMatch(read('map/worldview-navigation.js'), /\bpitch\b|\btilt\b/);
  assert.equal((read('map/map-foundation.js').match(/new MapView\(/g) || []).length, 1);
});

test('Map adapter ignores FOCUS-seeded navigation so DROP PIN does not steal 2D framing', () => {
  const adapter = read('map/worldview-map-adapter.js');
  assert.match(adapter, /WORLDVIEW_NAV_SOURCE.FOCUS/);
  assert.match(adapter, /nav.sourceView === WORLDVIEW_NAV_SOURCE.MAP/);
  assert.match(read('bootstrap/worldview-map-session.js'), /attachWorldviewMapAdapter/);
  assert.match(read('bootstrap/worldview-map-session.js'), /from '\.\.\/map\/worldview-map-adapter\.js'/);
  assert.match(read('bootstrap/worldview-map-session.js'), /seedWorldviewNavigationFromFocus/);
  assert.match(read('bootstrap/worldview-map-session.js'), /api.worldviewNavigation/);
});
