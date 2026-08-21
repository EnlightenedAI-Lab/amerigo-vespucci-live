import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ACTION_SOURCE,
  POLICY_ACTION,
  objectRefKey
} from '../public/spatial-v2/foundation/contracts/index.js';
import { createSpatialV2Chassis } from '../public/spatial-v2/bootstrap/spatial-v2-bootstrap.js';
import {
  ASK_MAP_OPERATIONS,
  parseAskMapIntent
} from '../public/spatial-v2/brain/ask-map-intent.js';
import {
  executeGovernedHydrantAction,
  filterHydrantsWithin
} from '../public/spatial-v2/map/woa/hydrant-within.js';
import {
  clearHydrantRecords,
  createHydrantObjectRef,
  getHydrantRecord,
  hydrantIdBi,
  hydrantInspectorFacts,
  rememberHydrantRecord,
  resolveHydrantRecord,
  rememberHydrantHits
} from '../public/spatial-v2/map/woa/hydrant-object.js';
import { bindHydrantLink } from '../public/spatial-v2/map/woa/hydrant-link.js';
import { bindHydrantSelection } from '../public/spatial-v2/map/woa/hydrant-selection.js';
import { clearHydrantTrace, getHydrantTrace } from '../public/spatial-v2/map/woa/hydrant-trace.js';
import {
  hydrantGraphicAttributes,
  resolveGovernedHydrantHit
} from '../public/spatial-v2/map/governed-map-overlay.js';
import {
  getGoogleMapsJs3dSnapshot,
  notifyGoogleMapsJs3dHydrantClick,
  setGoogleMapsJs3dHydrantMarker
} from '../public/spatial-v2/map/google-maps-js-3d.js';
import {
  STREET_360_SEARCH_RADIUS_METERS,
  aimGoogleStreetViewAtHydrant,
  sphericalHeadingDegrees
} from '../public/spatial-v2/map/google-street-view.js';
import {
  notifyHistoryPainterMarkClick,
  setHistoryPainterMarks,
  setHistoryPainterSelectedId
} from '../public/spatial-v2/imagery/historical/history-painter.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const V2 = path.join(ROOT, 'public', 'spatial-v2');
const HYDRANTS = JSON.parse(fs.readFileSync(path.join(V2, 'data/woa/hydrants.geojson'), 'utf8'));
const COMMUNE_PIN = Object.freeze({
  longitude: -73.553221995734,
  latitude: 45.494180980834,
  source: 'drop-pin',
  address: '997 de la Commune Ouest'
});

function read(rel) {
  return fs.readFileSync(path.join(V2, rel), 'utf8');
}

function communeHydrantFeature() {
  const hits = filterHydrantsWithin(HYDRANTS, COMMUNE_PIN, 80);
  const match = hits.find((hit) => /993-999 rue de la Commune Ouest/i.test(
    String(hit.feature?.properties?.source?.ADRESSE || '')
  ));
  assert.ok(match, 'Ville coverage must include the quay hydrant near 997 de la Commune Ouest.');
  assert.equal(String(match.sourceId), '5011151');
  return match;
}

function mockMapView(onClick) {
  return {
    on(type, handler) {
      if (type === 'click') onClick.current = handler;
      return { remove() { onClick.current = null; } };
    }
  };
}

function nextTurn() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function chassisWithHydrant(selected = null) {
  let n = 0;
  const instance = createSpatialV2Chassis({
    now: () => '2026-08-20T18:00:00.000Z',
    idFactory: () => `lh-${++n}`
  });
  instance.setHereContextProvider(() => ({ pin: { ...COMMUNE_PIN } }));
  instance.setSelectedHydrantProvider(() => selected);
  instance.setGovernedMapExecutor(async (input) => {
    if (
      input?.intent?.operation === ASK_MAP_OPERATIONS.SHOW_SELECTED_STREET
      || input?.intent?.operation === ASK_MAP_OPERATIONS.SHOW_SELECTED_ALL
    ) {
      assert.ok(input.selectedHydrant?.objectRef, 'Selected hydrant ObjectRef is required.');
      assert.equal(input.selectedHydrant.longitude, selected.longitude);
      assert.equal(input.selectedHydrant.latitude, selected.latitude);
      return {
        confirmationTitle: input.intent.confirmationTitle,
        operation: input.intent.operation,
        objectRef: input.selectedHydrant.objectRef,
        count: 1,
        source: input.intent.source,
        here: null,
        hits: [],
        paint: { painted: false, reason: 'NODE' }
      };
    }
    return executeGovernedHydrantAction({
      intent: input.intent,
      here: input.here,
      collection: HYDRANTS,
      paint: async () => ({ painted: false, reason: 'NODE' })
    });
  });
  return instance;
}

test('Search/GO focus.set establishes current FocusRef for HERE', async () => {
  const host = chassisWithHydrant();
  const before = host.stateStore.getRevision();
  await host.executeChassis('focus.set', {
    longitude: COMMUNE_PIN.longitude,
    latitude: COMMUNE_PIN.latitude,
    address: COMMUNE_PIN.address
  });
  const world = host.stateStore.getSnapshot();
  assert.ok(world.revision > before);
  assert.equal(world.activeFocus.geometry.coordinates[0], COMMUNE_PIN.longitude);
  assert.equal(world.activeFocus.geometry.coordinates[1], COMMUNE_PIN.latitude);
  assert.match(String(world.activeFocus.address || ''), /997 de la Commune/i);
});

test('MAP hydrant hitTest resolves municipal ID_BI, not a graphic id', () => {
  const hit = communeHydrantFeature();
  const idBi = hydrantIdBi(hit);
  assert.equal(idBi, '5011151');
  const graphicHit = resolveGovernedHydrantHit({
    results: [{
      graphic: {
        attributes: {
          iqaiHydrant: true,
          kind: 'hydrant',
          sourceId: idBi,
          objectId: 999999
        }
      }
    }]
  });
  assert.equal(graphicHit.sourceId, idBi);
  assert.notEqual(graphicHit.sourceId, '999999');
  assert.equal(hydrantGraphicAttributes({ attributes: { objectId: 12 } }), null);
});

test('cold-cache MAP hitTest resolves the Ville record and commits selection.set', async () => {
  clearHydrantRecords();
  const hit = communeHydrantFeature();
  assert.equal(getHydrantRecord(hit.sourceId), null);

  const record = await resolveHydrantRecord(hit.sourceId, { collection: HYDRANTS });
  assert.equal(record.idBi, '5011151');
  assert.equal(record.objectRef.id, '5011151');
  assert.equal(record.address, '993-999 rue de la Commune Ouest');
  assert.equal(record.provider, 'Ville de Montréal');
  assert.equal(Number(record.feature.properties.source.ID_BI), 5011151);
  assert.notEqual(record.objectRef.id, '999999');

  rememberHydrantHits([hit]);
  clearHydrantRecords();
  assert.equal(getHydrantRecord('5011151'), null);
  const fromPaintedHits = await resolveHydrantRecord('5011151');
  assert.equal(fromPaintedHits.idBi, '5011151');
  assert.equal(fromPaintedHits.address, '993-999 rue de la Commune Ouest');

  const host = chassisWithHydrant();
  await host.executeChassis('focus.set', {
    longitude: COMMUNE_PIN.longitude,
    latitude: COMMUNE_PIN.latitude,
    address: COMMUNE_PIN.address
  });
  const focusBefore = host.stateStore.getSnapshot().activeFocus;
  clearHydrantRecords();
  assert.equal(getHydrantRecord('5011151'), null);

  const click = { current: null };
  const binder = bindHydrantSelection({
    chassis: host,
    collection: HYDRANTS,
    hitTest: async () => ({ sourceId: '5011151' })
  });
  binder.attachView(mockMapView(click));
  await click.current({ button: 0 });

  const world = host.stateStore.getSnapshot();
  const selected = world.selection.objectRefs[0];
  const inspect = host.getViewModel().inspector.selection;
  assert.equal(binder.snapshot().selectedId, '5011151');
  assert.equal(selected.id, '5011151');
  assert.equal(selected.kind, 'hydrant');
  assert.equal(objectRefKey(selected), getHydrantRecord('5011151').objectRefKey);
  assert.match(inspect, /Ville de Montréal/);
  assert.match(inspect, /ID_BI: 5011151/);
  assert.match(inspect, /993-999 rue de la Commune Ouest/);
  assert.equal(world.activeFocus.geometry.coordinates[0], focusBefore.geometry.coordinates[0]);
  assert.equal(world.activeFocus.geometry.coordinates[1], focusBefore.geometry.coordinates[1]);
  assert.match(String(world.activeFocus.address || ''), /997 de la Commune/i);
  binder.destroy();
});

test('warm-cache hydrant path still commits the same ObjectRef', async () => {
  clearHydrantRecords();
  const hit = communeHydrantFeature();
  const warmed = rememberHydrantRecord(hit);
  const again = await resolveHydrantRecord(hit.sourceId, {
    collection: { type: 'FeatureCollection', features: [] }
  });
  assert.equal(again.objectRefKey, warmed.objectRefKey);
  assert.equal(again.idBi, '5011151');

  const host = chassisWithHydrant(warmed);
  const click = { current: null };
  const binder = bindHydrantSelection({
    chassis: host,
    collection: { type: 'FeatureCollection', features: [] },
    hitTest: async () => ({ sourceId: warmed.idBi })
  });
  binder.attachView(mockMapView(click));
  await click.current({ button: 0 });
  assert.equal(host.stateStore.getSnapshot().selection.objectRefs[0].id, '5011151');
  assert.equal(objectRefKey(host.stateStore.getSnapshot().selection.objectRefs[0]), warmed.objectRefKey);
  binder.destroy();
});

test('MAP click listener attaches even if the first view bind had no on()', () => {
  const binder = bindHydrantSelection({ collection: HYDRANTS });
  const later = { current: null };
  const view = {};
  assert.equal(binder.attachView(view), false);
  assert.equal(binder.snapshot().attached, false);
  view.on = function on(type, handler) {
    if (type === 'click') later.current = handler;
    return { remove() { later.current = null; } };
  };
  assert.equal(binder.attachView(view), true);
  assert.equal(typeof later.current, 'function');
  assert.equal(binder.snapshot().attached, true);
  binder.destroy();
});

test('selection.set commits before a hanging presentation adapter', async () => {
  clearHydrantRecords();
  clearHydrantTrace();
  const hit = communeHydrantFeature();
  rememberHydrantHits([hit]);
  const host = chassisWithHydrant();
  await host.executeChassis('focus.set', {
    longitude: COMMUNE_PIN.longitude,
    latitude: COMMUNE_PIN.latitude,
    address: COMMUNE_PIN.address
  });
  const focusBefore = host.stateStore.getSnapshot().activeFocus;
  const applyCalls = [];
  const click = { current: null };
  const binder = bindHydrantSelection({
    chassis: host,
    collection: HYDRANTS,
    hitTest: async () => ({ sourceId: '5011151' }),
    onSelection: () => {
      applyCalls.push('start');
      throw new Error('GOOGLE_3D_ADAPTER_FAIL');
    }
  });
  binder.attachView(mockMapView(click));
  await click.current({ button: 0 });
  const world = host.stateStore.getSnapshot();
  const selected = world.selection.objectRefs[0];
  const steps = getHydrantTrace().map((item) => item.step);
  assert.equal(selected.id, '5011151');
  assert.equal(selected.namespace, 'ville-montreal');
  assert.equal(selected.kind, 'hydrant');
  assert.match(host.getViewModel().inspector.selection, /ID_BI: 5011151/);
  assert.equal(applyCalls.length, 0);
  assert.ok(steps.indexOf('selection.set.done') >= 0);
  assert.ok(steps.indexOf('selection.set.done') < steps.indexOf('handleHit.end'));
  await nextTurn();
  assert.equal(applyCalls.length, 1);
  assert.equal(host.stateStore.getSnapshot().selection.objectRefs[0].id, '5011151');
  assert.match(String(host.stateStore.getSnapshot().activeFocus.address || ''), /997 de la Commune/i);
  assert.equal(world.activeFocus.geometry.coordinates[0], focusBefore.geometry.coordinates[0]);
  binder.destroy();
});

test('linked MAP apply does not wait for a hung Google 3D adapter', async () => {
  const hit = communeHydrantFeature();
  const record = rememberHydrantRecord(hit);
  let visualStarted = false;
  const link = bindHydrantLink({
    google3d: {
      snapshot: () => ({ open: true }),
      lookAtHydrant: () => {
        visualStarted = true;
        return new Promise(() => {});
      }
    }
  });
  const result = await Promise.race([
    link.apply(record, { views: 'linked' }),
    new Promise((_, reject) => setTimeout(() => reject(new Error('apply waited on Google 3D')), 200))
  ]);
  assert.equal(result.objectRef.id, '5011151');
  assert.equal(result.deferredPanes, true);
  await nextTurn();
  assert.equal(visualStarted, true);
  assert.equal(result.objectRef.id, record.idBi);
});

test('missing authoritative hydrant record fails closed without minting an ObjectRef', async () => {
  clearHydrantRecords();
  await assert.rejects(
    () => resolveHydrantRecord('0000000', { collection: HYDRANTS }),
    (error) => error.code === 'HYDRANT_RECORD_NOT_RESOLVED'
  );
  assert.equal(getHydrantRecord('0000000'), null);

  const host = chassisWithHydrant();
  await host.executeChassis('focus.set', {
    longitude: COMMUNE_PIN.longitude,
    latitude: COMMUNE_PIN.latitude,
    address: COMMUNE_PIN.address
  });
  const click = { current: null };
  const binder = bindHydrantSelection({
    chassis: host,
    collection: HYDRANTS,
    hitTest: async () => ({ sourceId: '0000000' })
  });
  binder.attachView(mockMapView(click));
  await click.current({ button: 0 });
  const world = host.stateStore.getSnapshot();
  assert.equal(binder.snapshot().lastHit?.error, 'HYDRANT_RECORD_NOT_RESOLVED');
  assert.equal(world.selection.objectRefs.length, 0);
  assert.equal(getHydrantRecord('0000000'), null);
  assert.match(String(host.getViewModel().inspector.selectionHtml || ''), /HYDRANT_RECORD_NOT_RESOLVED/);
  assert.match(String(world.activeFocus.address || ''), /997 de la Commune/i);
  binder.destroy();
});

test('selection.set receives the hydrant ObjectRef and panes share that identity', async () => {
  clearHydrantRecords();
  const hit = communeHydrantFeature();
  const record = rememberHydrantRecord(hit);
  const objectRef = createHydrantObjectRef(hit);
  assert.equal(objectRef.kind, 'hydrant');
  assert.equal(objectRef.namespace, 'ville-montreal');
  assert.equal(objectRef.id, record.idBi);
  assert.equal(objectRefKey(objectRef), record.objectRefKey);
  assert.equal(getHydrantRecord(record.idBi).objectRefKey, record.objectRefKey);

  const host = chassisWithHydrant(record);
  await host.executeChassis('selection.set', {
    objectRefs: [record.objectRef],
    primaryObjectRefId: record.objectRefKey,
    sourceView: 'MAP',
    sourceAction: 'SELECT_HYDRANT'
  });
  const selection = host.stateStore.getSnapshot().selection;
  assert.equal(selection.objectRefs.length, 1);
  assert.equal(selection.objectRefs[0].id, record.idBi);
  assert.equal(objectRefKey(selection.objectRefs[0]), record.objectRefKey);

  const selectedIds = [];
  bindHydrantLink({
    selection: {
      selectById: async (idBi, sourceView) => {
        selectedIds.push({ idBi, sourceView, key: getHydrantRecord(idBi).objectRefKey });
        return true;
      }
    }
  });
  await setGoogleMapsJs3dHydrantMarker(record);
  const visual = getGoogleMapsJs3dSnapshot().hydrantMarker;
  assert.equal(visual.sourceId, record.idBi);
  assert.equal(visual.longitude, record.longitude);
  assert.equal(visual.latitude, record.latitude);
  assert.equal(objectRefKey(visual.objectRef), record.objectRefKey);
  notifyGoogleMapsJs3dHydrantClick(record);
  notifyHistoryPainterMarkClick({ sourceId: record.idBi, kind: 'hydrant' });
  assert.equal(selectedIds.length, 2);
  assert.equal(selectedIds[0].idBi, record.idBi);
  assert.equal(selectedIds[0].sourceView, '3D VISUAL');
  assert.equal(selectedIds[1].sourceView, 'IMAGERY');
  assert.equal(selectedIds[0].key, record.objectRefKey);
  assert.equal(selectedIds[1].key, record.objectRefKey);
});

test('MAP highlight and imagery selected marker use the same ID_BI', () => {
  const overlay = read('map/governed-map-overlay.js');
  assert.match(overlay, /HYDRANT_SELECTED_MARKER/);
  assert.match(overlay, /HYDRANT_SUBORDINATE_MARKER/);
  assert.match(overlay, /view\.hitTest/);
  const painter = read('imagery/historical/history-painter.js');
  assert.match(painter, /selectedMarkId/);
  assert.match(painter, /sourceId/);
  const hit = communeHydrantFeature();
  const record = rememberHydrantRecord(hit);
  setHistoryPainterSelectedId(record.idBi);
  setHistoryPainterMarks([{
    kind: 'hydrant',
    sourceId: record.idBi,
    longitude: record.longitude,
    latitude: record.latitude
  }]);
  assert.equal(record.longitude, hit.feature.geometry.coordinates[0]);
  assert.equal(record.latitude, hit.feature.geometry.coordinates[1]);
});

test('StreetViewService searches from the hydrant coordinate and aims pano toward it', async () => {
  const hit = communeHydrantFeature();
  const record = rememberHydrantRecord(hit);
  const pano = { latitude: record.latitude + 0.0002, longitude: record.longitude - 0.0002 };
  let panoramaRequest = null;
  const previous = {
    window: globalThis.window,
    document: globalThis.document,
    google: globalThis.google,
    fetch: globalThis.fetch
  };
  globalThis.window = globalThis;
  globalThis.document = {
    getElementById() { return null; },
    createElement() { return { textContent: '' }; },
    head: { appendChild() {} },
    querySelector() { return null; }
  };
  class StreetViewService {
    getPanorama(request) {
      panoramaRequest = request;
      return Promise.resolve({
        location: {
          pano: 'PANO_TEST',
          latLng: { lat: () => pano.latitude, lng: () => pano.longitude }
        }
      });
    }
  }
  globalThis.google = {
    maps: {
      importLibrary: async () => ({ StreetViewService }),
      StreetViewService,
      Marker: class {
        constructor(options) { this.options = options; }
        setMap() {}
        addListener() {}
      }
    }
  };
  globalThis.fetch = async () => ({ json: async () => ({}) });
  try {
    const aimed = await aimGoogleStreetViewAtHydrant(record);
    assert.equal(panoramaRequest.location.lat, record.latitude);
    assert.equal(panoramaRequest.location.lng, record.longitude);
    assert.equal(panoramaRequest.radius, STREET_360_SEARCH_RADIUS_METERS);
    assert.equal(aimed.available, true);
    assert.equal(aimed.physicalVisibility, 'NOT CONFIRMED');
    assert.equal(aimed.hydrant.longitude, record.longitude);
    assert.equal(aimed.hydrant.latitude, record.latitude);
    assert.equal(aimed.heading, sphericalHeadingDegrees(pano, record));
    assert.match(aimed.message, /INVENTORY POSITION PROJECTED INTO STREET VIEW/);
  } finally {
    globalThis.window = previous.window;
    globalThis.document = previous.document;
    globalThis.google = previous.google;
    globalThis.fetch = previous.fetch;
  }
});

test('no nearby Street panorama is an honest unavailable state', async () => {
  const hit = communeHydrantFeature();
  const record = rememberHydrantRecord(hit);
  const previous = {
    window: globalThis.window,
    document: globalThis.document,
    google: globalThis.google,
    fetch: globalThis.fetch
  };
  globalThis.window = globalThis;
  globalThis.document = {
    getElementById() { return null; },
    createElement() { return { textContent: '' }; },
    head: { appendChild() {} },
    querySelector() { return null; }
  };
  class StreetViewService {
    getPanorama() {
      return Promise.reject({ status: 'ZERO_RESULTS' });
    }
  }
  globalThis.google = {
    maps: {
      importLibrary: async () => ({ StreetViewService }),
      StreetViewService
    }
  };
  globalThis.fetch = async () => ({ json: async () => ({}) });
  try {
    const aimed = await aimGoogleStreetViewAtHydrant(record);
    assert.equal(aimed.available, false);
    assert.equal(aimed.message, 'NO STREET CAPTURE NEAR THIS HYDRANT');
    assert.equal(aimed.physicalVisibility, 'NOT CONFIRMED');
  } finally {
    globalThis.window = previous.window;
    globalThis.document = previous.document;
    globalThis.google = previous.google;
    globalThis.fetch = previous.fetch;
  }
});

test('BRAIN show-this-hydrant intents cannot mint coordinates or grants', async () => {
  const host = chassisWithHydrant(null);
  const street = parseAskMapIntent('Show this hydrant in Street View.');
  const all = parseAskMapIntent('Show this hydrant in all views.');
  assert.equal(street.operation, ASK_MAP_OPERATIONS.SHOW_SELECTED_STREET);
  assert.equal(all.operation, ASK_MAP_OPERATIONS.SHOW_SELECTED_ALL);
  assert.equal(street.locationKind, 'SELECTED_HYDRANT');
  assert.equal(all.radiusMeters, null);

  const missing = await host.submitAsk({ text: 'Show this hydrant in Street View.' });
  assert.equal(missing.result.needsObject, true);
  assert.equal(missing.result.mapExecuted, false);
  assert.equal(host.snapshotGovernedMapAction().pending, null);

  const hit = communeHydrantFeature();
  const record = rememberHydrantRecord(hit);
  const selectedHost = chassisWithHydrant(record);
  const proposed = await selectedHost.submitAsk({ text: 'Show this hydrant in all views.' });
  assert.equal(proposed.result.needsConfirmation, true);
  assert.equal(proposed.result.objectRef.id, record.idBi);
  assert.match(proposed.result.confirmationDetail, /No coordinates will be minted/);
  const confirmed = await selectedHost.confirmGovernedMapAction();
  assert.equal(confirmed.result.mapExecuted, true);
  assert.equal(confirmed.result.objectRef.id, record.idBi);

  assert.throws(
    () => selectedHost.policyService.issueGrant({
      actorRef: 'operator:session',
      capabilityId: 'map.governed-action',
      policyAction: POLICY_ACTION.DISPLAY,
      resourceRefs: [],
      sessionId: selectedHost.stateStore.getSnapshot().context.sessionId,
      worldId: selectedHost.stateStore.getSnapshot().worlds.activeWorldId
    }, { source: ACTION_SOURCE.BRAIN }),
    (error) => error.code === 'MODEL_CANNOT_MINT_GRANT'
  );
});

test('Inspector facts stay source-backed and do not claim pressure or physical visibility', () => {
  const hit = communeHydrantFeature();
  const record = rememberHydrantRecord(hit);
  const facts = hydrantInspectorFacts(record, COMMUNE_PIN);
  const labels = facts.facts.map(([label]) => label);
  assert.ok(labels.includes('ID_BI'));
  assert.ok(labels.includes('PROVIDER'));
  assert.ok(labels.includes('ADDRESS'));
  assert.equal(facts.facts.find(([label]) => label === 'ID_BI')[1], record.idBi);
  assert.ok(facts.limitations.some((item) => /NOT CONFIRMED/i.test(item)));
  assert.ok(facts.limitations.some((item) => /Pressure, flow/i.test(item)));
});

test('Search/GO geocode is bounded to Greater Montréal', () => {
  const foundation = read('map/map-foundation.js');
  assert.match(foundation, /sourceCountry: 'CAN'/);
  assert.match(foundation, /searchExtent: '-74\.3,45\.2,-73\.2,45\.9'/);
  assert.match(foundation, /isGreaterMontrealLongitudeLatitude/);
  assert.match(foundation, /Montréal/);
});

test('linked hydrant V1 does not construct another MapView', () => {
  const files = [
    'map/woa/hydrant-object.js',
    'map/woa/hydrant-selection.js',
    'map/woa/hydrant-link.js',
    'map/woa/hydrant-trace.js',
    'map/governed-map-overlay.js',
    'map/google-maps-js-3d.js',
    'map/google-street-view.js',
    'bootstrap/worldview-map-session.js',
    'bootstrap/spatial-v2-bootstrap.js'
  ];
  let mapViewCreates = 0;
  for (const rel of files) {
    const source = read(rel);
    assert.doesNotMatch(source, /new MapView\(/);
    mapViewCreates += (source.match(/new MapView\(/g) || []).length;
  }
  assert.equal(mapViewCreates, 0);
  assert.equal((read('map/map-foundation.js').match(/new MapView\(/g) || []).length, 1);
  assert.match(read('bootstrap/worldview-map-session.js'), /showMapView\(mapHost\)/);
  assert.doesNotMatch(
    read('bootstrap/worldview-map-session.js').slice(
      read('bootstrap/worldview-map-session.js').indexOf('setGovernedMapExecutor')
    ),
    /executeChassis\('view.select'/
  );
  assert.match(read('map/google-maps-js-3d.js'), /Marker3DInteractiveElement/);
  assert.match(read('map/google-street-view.js'), /StreetViewService/);
  assert.match(read('map/google-street-view.js'), /sphericalHeadingDegrees/);
});
