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
  closeGoogleMapsJs3d,
  getGoogleMapsJs3dSnapshot,
  hydrantInventoryMarkerLabel,
  notifyGoogleMapsJs3dHydrantClick,
  openGoogleMapsJs3d,
  setGoogleMapsJs3dHydrantMarker
} from '../public/spatial-v2/map/google-maps-js-3d.js';
import {
  STREET_360_SEARCH_RADIUS_METERS,
  aimGoogleStreetViewAtHydrant,
  closeGoogleStreetView,
  concealGoogleStreetView,
  getGoogleStreetViewSnapshot,
  getStreetNearbySearchCount,
  hasKnownStreetPano,
  hasRetainedGoogleStreetView,
  hydrantStreetInventoryLabel,
  openGoogleStreetView,
  parkGoogleStreetView,
  revealGoogleStreetView,
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

test('linked MAP apply pushes ObjectRef to Google 3D even when the pane is closed', async () => {
  const hit = communeHydrantFeature();
  const record = rememberHydrantRecord(hit);
  const seen = [];
  const link = bindHydrantLink({
    google3d: {
      snapshot: () => ({ open: false }),
      lookAtHydrant: async (next) => {
        seen.push(next?.idBi || null);
        return { hydrantMarker: { sourceId: next?.idBi || null, present: false } };
      }
    }
  });
  const result = await link.apply(record, { views: 'linked' });
  assert.equal(result.objectRef.id, '5011151');
  assert.equal(result.deferredPanes, true);
  await nextTurn();
  assert.deepEqual(seen, ['5011151']);
  await link.apply(null, { views: 'linked' });
  await nextTurn();
  assert.deepEqual(seen, ['5011151', null]);
});

test('Google 3D hydrant marker uses the municipal inventory coordinate and ObjectRef', async () => {
  const hit = communeHydrantFeature();
  const record = rememberHydrantRecord(hit);
  const other = rememberHydrantRecord(filterHydrantsWithin(HYDRANTS, COMMUNE_PIN, 80).find((item) => (
    String(item.sourceId) !== '5011151'
  )));
  assert.ok(other?.idBi);
  const previous = {
    window: globalThis.window,
    document: globalThis.document,
    google: globalThis.google,
    fetch: globalThis.fetch,
    customElements: globalThis.customElements
  };
  const created = [];
  class Marker3DInteractiveElement {
    constructor(opts) {
      this.position = opts.position;
      this.label = opts.label;
      this.listeners = {};
      this.attrs = {};
      this.dataset = {};
      this.removed = false;
      created.push(this);
    }
    setAttribute(name, value) { this.attrs[name] = String(value); }
    getAttribute(name) { return this.attrs[name] || null; }
    addEventListener(type, fn) {
      this.listeners[type] = this.listeners[type] || [];
      this.listeners[type].push(fn);
    }
    replaceChildren() {}
    remove() { this.removed = true; }
    click() {
      for (const fn of this.listeners['gmp-click'] || []) fn();
    }
  }
  class Map3DElement {
    constructor(opts) {
      Object.assign(this, opts);
      this.children = [];
      this.style = { cssText: '' };
      this._listeners = {};
    }
    addEventListener(type, fn) {
      this._listeners[type] = this._listeners[type] || [];
      this._listeners[type].push(fn);
      if (type === 'gmp-steadychange') queueMicrotask(() => fn({ isSteady: true }));
    }
    removeEventListener(type, fn) {
      this._listeners[type] = (this._listeners[type] || []).filter((item) => item !== fn);
    }
    append(child) { this.children.push(child); }
    querySelector() { return null; }
    querySelectorAll(sel) {
      if (sel === '[data-iqai-hydrant-id]') {
        return this.children.filter((child) => !child.removed && child.getAttribute?.('data-iqai-hydrant-id'));
      }
      return [];
    }
    stopCameraAnimation() {}
    remove() {}
  }
  globalThis.window = globalThis;
  if (typeof globalThis.addEventListener !== 'function') {
    globalThis.addEventListener = () => {};
    globalThis.removeEventListener = () => {};
  }
  globalThis.document = {
    getElementById() { return null; },
    createElement() { return { textContent: '' }; },
    head: { appendChild() {}, append() {} },
    querySelector() { return null; }
  };
  globalThis.customElements = { whenDefined: async () => {} };
  globalThis.google = {
    maps: {
      importLibrary: async (name) => {
        if (name === 'maps3d') {
          return {
            Map3DElement,
            Marker3DInteractiveElement,
            Marker3DElement: class {},
            AltitudeMode: { RELATIVE_TO_MESH: 'RELATIVE_TO_MESH' },
            MapMode: { SATELLITE: 'SATELLITE', HYBRID: 'HYBRID' },
            GestureHandling: { GREEDY: 'GREEDY' }
          };
        }
        if (name === 'marker') return { PinElement: class { constructor(opts) { this.opts = opts; } } };
        return {};
      }
    }
  };
  globalThis.fetch = async () => ({ json: async () => ({ streetLevelContext: { googleMapsBrowserApiKey: 'test-key' } }) });
  const container = {
    hidden: true,
    innerHTML: '',
    removeAttribute() {},
    append(el) { this.child = el; el.parentElement = this; },
    querySelector() { return null; }
  };
  const clicks = [];
  try {
    await setGoogleMapsJs3dHydrantMarker(record);
    const pending = getGoogleMapsJs3dSnapshot().hydrantMarker;
    assert.equal(pending.sourceId, '5011151');
    assert.equal(pending.present, false);
    assert.equal(pending.unavailableReason, 'PANE_CLOSED');
    assert.equal(pending.longitude, record.longitude);
    assert.equal(pending.latitude, record.latitude);
    assert.equal(pending.label, hydrantInventoryMarkerLabel('5011151'));
    assert.match(pending.label, /VILLE INVENTORY POSITION/);
    assert.equal(pending.objectRef.id, '5011151');

    await openGoogleMapsJs3d({
      container,
      longitude: COMMUNE_PIN.longitude,
      latitude: COMMUNE_PIN.latitude
    });
    let snap = getGoogleMapsJs3dSnapshot().hydrantMarker;
    assert.equal(snap.present, true);
    assert.equal(snap.api, 'Marker3DInteractiveElement');
    assert.equal(snap.clickable, true);
    assert.equal(snap.sourceId, '5011151');
    assert.equal(snap.longitude, record.longitude);
    assert.equal(snap.latitude, record.latitude);
    assert.equal(created.at(-1).position.lng, record.longitude);
    assert.equal(created.at(-1).position.lat, record.latitude);
    assert.equal(created.at(-1).label, hydrantInventoryMarkerLabel('5011151'));
    assert.equal(snap.count, 1);

    await setGoogleMapsJs3dHydrantMarker(other);
    snap = getGoogleMapsJs3dSnapshot().hydrantMarker;
    assert.equal(snap.sourceId, other.idBi);
    assert.equal(snap.count, 1);
    assert.equal(created.filter((item) => !item.removed).length, 1);

    bindHydrantLink({
      selection: {
        selectById: async (idBi, sourceView) => {
          clicks.push({ idBi, sourceView });
          return true;
        }
      }
    });
    created.find((item) => !item.removed).click();
    assert.equal(clicks[0].idBi, other.idBi);
    assert.equal(clicks[0].sourceView, '3D VISUAL');

    await setGoogleMapsJs3dHydrantMarker(null);
    snap = getGoogleMapsJs3dSnapshot().hydrantMarker;
    assert.equal(snap.present, false);
    assert.equal(snap.sourceId, null);
    assert.equal(snap.count, 0);
    assert.equal(created.filter((item) => !item.removed).length, 0);
  } finally {
    await closeGoogleMapsJs3d();
    globalThis.window = previous.window;
    globalThis.document = previous.document;
    globalThis.google = previous.google;
    globalThis.fetch = previous.fetch;
    globalThis.customElements = previous.customElements;
  }
});

test('linked MAP apply stores Street ObjectRef without opening the pane', async () => {
  const hit = communeHydrantFeature();
  const record = rememberHydrantRecord(hit);
  const seen = [];
  const link = bindHydrantLink({
    street360: {
      snapshot: () => ({ open: false }),
      lookAtHydrant: async (next, opts) => {
        seen.push({ idBi: next?.idBi || null, openPane: opts?.openPane });
        return { available: true, needsOpen: true, hydrant: { sourceId: next?.idBi } };
      }
    }
  });
  const result = await link.apply(record, { views: 'linked' });
  assert.equal(result.objectRef.id, '5011151');
  await nextTurn();
  assert.equal(seen[0].idBi, '5011151');
  assert.equal(seen[0].openPane, false);
});

test('Street 360 hydrant aim keeps pano coordinate separate and heads pano → hydrant', async () => {
  const hit = communeHydrantFeature();
  const record = rememberHydrantRecord(hit);
  const pano = { latitude: 45.49416, longitude: -73.55305 };
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
          pano: 'lFf75IgonZJaGZig34Qsuw',
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
    assert.equal(panoramaRequest.radius, 80);
    assert.equal(aimed.panoId, 'lFf75IgonZJaGZig34Qsuw');
    assert.equal(aimed.panorama.latitude, pano.latitude);
    assert.equal(aimed.panorama.longitude, pano.longitude);
    assert.notEqual(aimed.panorama.latitude, record.latitude);
    assert.equal(aimed.hydrant.longitude, record.longitude);
    assert.equal(aimed.heading, sphericalHeadingDegrees(pano, record));
    assert.equal(aimed.physicalVisibility, 'NOT CONFIRMED');
    assert.equal(aimed.label, hydrantStreetInventoryLabel('5011151'));
    assert.match(aimed.label, /VILLE INVENTORY POSITION/);
  } finally {
    globalThis.window = previous.window;
    globalThis.document = previous.document;
    globalThis.google = previous.google;
    globalThis.fetch = previous.fetch;
  }
});

test('Street panorama readiness accepts getPano even when getStatus never reports OK', async () => {
  const hit = communeHydrantFeature();
  const record = rememberHydrantRecord(hit);
  const previous = {
    window: globalThis.window,
    document: globalThis.document,
    google: globalThis.google,
    fetch: globalThis.fetch
  };
  class StreetViewPanorama {
    constructor(container, opts) {
      this.container = container;
      this._pano = opts.pano || 'lFf75IgonZJaGZig34Qsuw';
      this._pov = opts.pov || { heading: 0, pitch: 0 };
    }
    getStatus() { return ''; }
    getPano() { return this._pano; }
    getPov() { return this._pov; }
    getZoom() { return 1; }
    getPosition() {
      return { lat: () => 45.49416, lng: () => -73.55305 };
    }
    getLinks() { return [{ pano: 'next', heading: 10 }]; }
    addListener() { return { remove() {} }; }
    setVisible() {}
    setPano(id) { this._pano = id; }
    setPov(pov) { this._pov = pov; }
    setPosition() {}
  }
  class StreetViewService {
    getPanorama() {
      return Promise.resolve({
        location: {
          pano: 'lFf75IgonZJaGZig34Qsuw',
          latLng: { lat: () => 45.49416, lng: () => -73.55305 }
        }
      });
    }
  }
  globalThis.window = globalThis;
  if (typeof globalThis.addEventListener !== 'function') {
    globalThis.addEventListener = () => {};
    globalThis.removeEventListener = () => {};
  }
  globalThis.document = {
    getElementById() { return null; },
    createElement() { return { textContent: '' }; },
    head: { appendChild() {}, append() {} },
    querySelector() { return null; }
  };
  globalThis.google = {
    maps: {
      importLibrary: async (name) => {
        if (name === 'streetView') return { StreetViewService, StreetViewPanorama };
        return {};
      },
      StreetViewService,
      StreetViewPanorama,
      event: { trigger() {}, removeListener() {} },
      Marker: class {
        constructor(options) { this.options = options; }
        setMap() {}
        addListener() {}
      }
    }
  };
  globalThis.fetch = async () => ({
    json: async () => ({ streetLevelContext: { googleMapsBrowserApiKey: 'test-key' } })
  });
  const container = {
    querySelector() { return { className: 'gm-style' }; }
  };
  try {
    await closeGoogleStreetView();
    const opened = await openGoogleStreetView({
      container,
      longitude: record.longitude,
      latitude: record.latitude
    });
    assert.equal(opened.open, true);
    assert.equal(opened.panoId, 'lFf75IgonZJaGZig34Qsuw');
    const aimed = await aimGoogleStreetViewAtHydrant(record);
    assert.equal(aimed.available, true);
    assert.equal(aimed.needsOpen, false);
    assert.equal(getGoogleStreetViewSnapshot().hydrantAim?.hydrant?.sourceId, '5011151');
  } finally {
    await closeGoogleStreetView();
    globalThis.window = previous.window;
    globalThis.document = previous.document;
    globalThis.google = previous.google;
    globalThis.fetch = previous.fetch;
  }
});

test('Street 360 failure cannot block SelectionSet, Inspector, or Google 3D marker', async () => {
  const hit = communeHydrantFeature();
  const record = rememberHydrantRecord(hit);
  const host = chassisWithHydrant();
  await host.executeChassis('focus.set', {
    longitude: COMMUNE_PIN.longitude,
    latitude: COMMUNE_PIN.latitude,
    address: COMMUNE_PIN.address
  });
  await host.executeChassis('selection.set', {
    objectRefs: [record.objectRef],
    primaryObjectRefId: record.objectRefKey,
    sourceView: 'MAP',
    sourceAction: 'SELECT_HYDRANT'
  });
  await setGoogleMapsJs3dHydrantMarker(record);
  const before3d = getGoogleMapsJs3dSnapshot().hydrantMarker;
  const link = bindHydrantLink({
    street360: {
      snapshot: () => ({ open: false }),
      lookAtHydrant: async () => {
        throw new Error('Street View panorama did not become ready.');
      }
    }
  });
  const result = await Promise.race([
    link.apply(record, { views: 'street' }),
    new Promise((_, reject) => setTimeout(() => reject(new Error('street blocked apply')), 200))
  ]);
  assert.equal(result.objectRef.id, '5011151');
  assert.equal(host.stateStore.getSnapshot().selection.objectRefs[0].id, '5011151');
  assert.match(String(host.stateStore.getSnapshot().activeFocus.address || ''), /997 de la Commune/i);
  assert.equal(getGoogleMapsJs3dSnapshot().hydrantMarker.sourceId, before3d.sourceId);
  assert.equal(getGoogleMapsJs3dSnapshot().hydrantMarker.sourceId, '5011151');
});

test('Street requested representation becomes the supporting pair and cannot remain OPENING after pano', () => {
  const frame = read('shell/WorldViewFrame.js');
  const street = read('shell/Street360Control.js');
  assert.match(frame, /return applyLayout\(2, WORLDVIEW_PANE\.STREET_360\)/);
  assert.match(frame, /return applyLayout\(2, WORLDVIEW_PANE\.VISUAL_3D\)/);
  assert.doesNotMatch(frame, /pairView === WORLDVIEW_PANE\.VISUAL_3D\) return applyLayout\(3\)/);
  assert.match(frame, /pendingSpecialists/);
  assert.match(frame, /activePresentation/);
  assert.match(frame, /waitStreetPaneLaidOut/);
  assert.match(street, /operatorVisible: operatorVisibleReady\(engine\)/);
  assert.match(street, /hostLaidOut/);
  assert.match(street, /hostWidth: size\.width/);
  assert.match(street, /stageState = STAGE_STATE\.OPEN/);
  assert.match(street, /engine\.panoId \|\| engine\.panoPresent \|\| engine\.open === true/);
});

test('zero-size Street host cannot be treated as operator-visible ready', async () => {
  const { bindStreet360Control } = await import('../public/spatial-v2/shell/Street360Control.js');
  const stage = {
    hidden: true,
    offsetWidth: 0,
    offsetHeight: 0,
    style: {},
    dataset: {},
    querySelector() { return null; },
    removeAttribute() {},
    innerHTML: ''
  };
  const pane = { hidden: true };
  const root = {
    dataset: {},
    querySelector(sel) {
      if (sel === '.iqai-v2-stage__well') return { dataset: {} };
      if (sel === '[data-iqai-map-host]') return { style: {} };
      if (sel === '[data-iqai-pane="STREET 360"]') return pane;
      if (sel === '[data-iqai-view-anchor="STREET 360"]') return stage;
      if (sel === '[data-iqai-street-360-date]') return { hidden: true, textContent: '' };
      return null;
    }
  };
  const ctl = bindStreet360Control(root, { keepMapVisible: true });
  const snap = ctl.snapshot();
  assert.equal(snap.hostWidth, 0);
  assert.equal(snap.hostHeight, 0);
  assert.equal(snap.operatorVisible, false);
  assert.notEqual(snap.stageState, 'OPEN');
});

test('showInStreet opens the Street supporting pane then reapplies selected ObjectRef', async () => {
  const hit = communeHydrantFeature();
  const record = rememberHydrantRecord(hit);
  const seen = [];
  const link = bindHydrantLink({
    worldViewFrame: {
      openSupporting: async (view) => {
        seen.push(['open', view]);
        return { pairView: 'STREET 360', activePresentation: 'STREET 360', layout: 2 };
      }
    },
    street360: {
      snapshot: () => ({ open: false, stageState: 'IDLE' }),
      lookAtHydrant: async (next, opts) => {
        seen.push(['aim', next?.idBi || null, opts?.openPane === true]);
        return {
          available: true,
          hydrant: { sourceId: next?.idBi },
          physicalVisibility: 'NOT CONFIRMED'
        };
      }
    }
  });
  const result = await link.showInStreet(record);
  assert.equal(seen[0][0], 'open');
  assert.equal(seen[0][1], 'STREET 360');
  const aim = seen.find((item) => item[0] === 'aim');
  assert.equal(aim[1], '5011151');
  assert.equal(result.objectRef.id, '5011151');
});

test('Street failure cannot alter SelectionSet or Inspector', async () => {
  const hit = communeHydrantFeature();
  const record = rememberHydrantRecord(hit);
  const host = chassisWithHydrant();
  await host.executeChassis('focus.set', {
    longitude: COMMUNE_PIN.longitude,
    latitude: COMMUNE_PIN.latitude,
    address: COMMUNE_PIN.address
  });
  await host.executeChassis('selection.set', {
    objectRefs: [record.objectRef],
    primaryObjectRefId: record.objectRefKey,
    sourceView: 'MAP',
    sourceAction: 'SELECT_HYDRANT'
  });
  const before = host.stateStore.getSnapshot();
  const link = bindHydrantLink({
    worldViewFrame: {
      openSupporting: async () => {
        throw new Error('STREET PANE FAILED');
      }
    },
    street360: {
      snapshot: () => ({ open: false, stageState: 'ERROR' }),
      lookAtHydrant: async () => ({ available: false, message: 'STREET 360 UNAVAILABLE' })
    }
  });
  await link.showInStreet(record);
  const after = host.stateStore.getSnapshot();
  assert.equal(after.selection.objectRefs[0].id, '5011151');
  assert.equal(after.selection.objectRefs[0].id, before.selection.objectRefs[0].id);
  assert.equal(after.activeFocus.address, before.activeFocus.address);
});

test('BRAIN Show this hydrant in Street View requires selected ObjectRef and does not mint coordinates', async () => {
  const missing = await chassisWithHydrant(null).submitAsk({ text: 'Show this hydrant in Street View.' });
  assert.equal(missing.result.needsObject, true);
  assert.match(String(missing.result.message || ''), /Select a hydrant/);
  const hit = communeHydrantFeature();
  const record = rememberHydrantRecord(hit);
  const host = chassisWithHydrant(record);
  const proposed = await host.submitAsk({ text: 'Show this hydrant in Street View.' });
  assert.equal(proposed.result.needsConfirmation, true);
  assert.equal(proposed.result.objectRef.id, '5011151');
  assert.match(proposed.result.confirmationDetail, /No coordinates will be minted/);
  const confirmed = await host.confirmGovernedMapAction();
  assert.equal(confirmed.result.mapExecuted, true);
  assert.equal(confirmed.result.objectRef.id, '5011151');
  assert.equal(confirmed.result.objectRef.id, record.idBi);
});

test('Street conceal for Google 3D keeps the known pano and return does not search again', async () => {
  const hit = communeHydrantFeature();
  const record = rememberHydrantRecord(hit);
  const previous = {
    window: globalThis.window,
    document: globalThis.document,
    google: globalThis.google,
    fetch: globalThis.fetch
  };
  class StreetViewPanorama {
    constructor(container, opts) {
      this.container = container;
      this._pano = opts.pano || 'NgMTZ71FiuQ7YuYNB-Kh2A';
      this._pov = opts.pov || { heading: 0, pitch: 0 };
    }
    getStatus() { return 'OK'; }
    getPano() { return this._pano; }
    getPov() { return this._pov; }
    getZoom() { return 1; }
    getPosition() {
      return { lat: () => 45.494515, lng: () => -73.552964 };
    }
    getLinks() { return [{ pano: 'next', heading: 10 }]; }
    addListener() { return { remove() {} }; }
    setVisible() {}
    setPano(id) { this._pano = id; }
    setPov(pov) { this._pov = pov; }
    setPosition() {}
  }
  class StreetViewService {
    getPanorama() {
      return Promise.resolve({
        location: {
          pano: 'NgMTZ71FiuQ7YuYNB-Kh2A',
          latLng: { lat: () => 45.494515, lng: () => -73.552964 }
        }
      });
    }
  }
  globalThis.window = globalThis;
  if (typeof globalThis.addEventListener !== 'function') {
    globalThis.addEventListener = () => {};
    globalThis.removeEventListener = () => {};
  }
  globalThis.document = {
    getElementById() { return null; },
    createElement() { return { textContent: '' }; },
    head: { appendChild() {}, append() {} },
    querySelector() { return null; }
  };
  globalThis.google = {
    maps: {
      importLibrary: async (name) => {
        if (name === 'streetView') return { StreetViewService, StreetViewPanorama };
        return {};
      },
      StreetViewService,
      StreetViewPanorama,
      event: { trigger() {}, removeListener() {} },
      Marker: class {
        constructor(options) { this.options = options; }
        setMap() {}
        addListener() {}
      }
    }
  };
  globalThis.fetch = async () => ({
    json: async () => ({ streetLevelContext: { googleMapsBrowserApiKey: 'test-key' } })
  });
  const container = {
    offsetWidth: 569,
    offsetHeight: 831,
    querySelector() { return { className: 'gm-style' }; }
  };
  try {
    await closeGoogleStreetView();
    const aimed = await aimGoogleStreetViewAtHydrant(record);
    assert.equal(aimed.panoId, 'NgMTZ71FiuQ7YuYNB-Kh2A');
    const opened = await openGoogleStreetView({
      container,
      longitude: record.longitude,
      latitude: record.latitude,
      availability: { available: true, panorama: aimed.panorama }
    });
    assert.equal(opened.open, true);
    assert.equal(hasRetainedGoogleStreetView(), true);
    const searchesAfterOpen = getStreetNearbySearchCount();
    await concealGoogleStreetView();
    assert.equal(hasKnownStreetPano(), true);
    assert.equal(getGoogleStreetViewSnapshot().panoId, 'NgMTZ71FiuQ7YuYNB-Kh2A');
    const revealed = await revealGoogleStreetView(container);
    assert.equal(revealed.open, true);
    assert.equal(revealed.panoId, 'NgMTZ71FiuQ7YuYNB-Kh2A');
    const reused = await aimGoogleStreetViewAtHydrant(record);
    assert.equal(reused.panoId, 'NgMTZ71FiuQ7YuYNB-Kh2A');
    assert.equal(reused.heading, aimed.heading);
    assert.equal(getStreetNearbySearchCount(), searchesAfterOpen);
  } finally {
    await closeGoogleStreetView();
    globalThis.window = previous.window;
    globalThis.document = previous.document;
    globalThis.google = previous.google;
    globalThis.fetch = previous.fetch;
  }
});

test('repeated Street park/reveal disposes each instance and reapplies known pano without search', async () => {
  const hit = communeHydrantFeature();
  const record = rememberHydrantRecord(hit);
  const previous = {
    window: globalThis.window,
    document: globalThis.document,
    google: globalThis.google,
    fetch: globalThis.fetch
  };
  let constructs = 0;
  let cleared = 0;
  class StreetViewPanorama {
    constructor(container, opts) {
      constructs += 1;
      this.container = container;
      container.owned = constructs;
      this._pano = opts.pano || 'NgMTZ71FiuQ7YuYNB-Kh2A';
      this._pov = opts.pov || { heading: 0, pitch: 0 };
    }
    getStatus() { return 'OK'; }
    getPano() { return this._pano; }
    getPov() { return this._pov; }
    getZoom() { return 1; }
    getPosition() {
      return { lat: () => 45.494515, lng: () => -73.552964 };
    }
    getLinks() { return [{ pano: 'next', heading: 10 }]; }
    addListener() { return { remove() {} }; }
    setVisible() {}
    setPano(id) { this._pano = id; }
    setPov(pov) { this._pov = pov; }
    setPosition() {}
  }
  class StreetViewService {
    getPanorama() {
      return Promise.resolve({
        location: {
          pano: 'NgMTZ71FiuQ7YuYNB-Kh2A',
          latLng: { lat: () => 45.494515, lng: () => -73.552964 }
        }
      });
    }
  }
  globalThis.window = globalThis;
  if (typeof globalThis.addEventListener !== 'function') {
    globalThis.addEventListener = () => {};
    globalThis.removeEventListener = () => {};
  }
  globalThis.document = {
    getElementById() { return null; },
    createElement() { return { textContent: '' }; },
    head: { appendChild() {}, append() {} },
    querySelector() { return null; }
  };
  globalThis.google = {
    maps: {
      importLibrary: async (name) => {
        if (name === 'streetView') return { StreetViewService, StreetViewPanorama };
        return {};
      },
      StreetViewService,
      StreetViewPanorama,
      event: {
        trigger() {},
        removeListener() {},
        clearInstanceListeners() { cleared += 1; }
      },
      Marker: class {
        constructor(options) { this.options = options; }
        setMap() {}
        addListener() {}
      }
    }
  };
  globalThis.fetch = async () => ({
    json: async () => ({ streetLevelContext: { googleMapsBrowserApiKey: 'test-key' } })
  });
  const container = {
    offsetWidth: 569,
    offsetHeight: 831,
    owned: null,
    querySelector() { return { className: 'gm-style', width: 569, height: 831 }; },
    replaceChildren() { this.owned = null; }
  };
  try {
    await closeGoogleStreetView();
    const aimed = await aimGoogleStreetViewAtHydrant(record);
    await openGoogleStreetView({
      container,
      availability: { available: true, panorama: aimed.panorama }
    });
    const searchesAfterOpen = getStreetNearbySearchCount();
    const heading = aimed.heading;
    const createdAfterOpen = getGoogleStreetViewSnapshot().stageCreateCount;
    const disposedAfterOpen = getGoogleStreetViewSnapshot().stageDisposeCount;
    const constructsAfterOpen = constructs;
    for (let cycle = 0; cycle < 4; cycle += 1) {
      await parkGoogleStreetView();
      assert.equal(hasRetainedGoogleStreetView(), false);
      assert.equal(hasKnownStreetPano(), true);
      assert.equal(container.owned, null);
      const revealed = await revealGoogleStreetView(container);
      assert.equal(revealed.open, true);
      assert.equal(revealed.panoId, 'NgMTZ71FiuQ7YuYNB-Kh2A');
      const reapplied = await aimGoogleStreetViewAtHydrant(record);
      assert.equal(reapplied.panoId, 'NgMTZ71FiuQ7YuYNB-Kh2A');
      assert.equal(reapplied.heading, heading);
      assert.ok(reapplied.markerApi === 'Marker' || revealed.hydrantMarkerApi === 'Marker');
    }
    const snap = getGoogleStreetViewSnapshot();
    assert.equal(getStreetNearbySearchCount(), searchesAfterOpen);
    assert.equal(constructs - constructsAfterOpen, 4);
    assert.equal(snap.stageCreateCount - createdAfterOpen, 4);
    assert.equal(snap.stageDisposeCount - disposedAfterOpen, 4);
    assert.ok(cleared >= 4);
  } finally {
    await closeGoogleStreetView();
    globalThis.window = previous.window;
    globalThis.document = previous.document;
    globalThis.google = previous.google;
    globalThis.fetch = previous.fetch;
  }
});

test('BRAIN Street dispatch resolves without waiting for panorama paint', async () => {
  const hit = communeHydrantFeature();
  const record = rememberHydrantRecord(hit);
  let lookResolve;
  const hanging = new Promise((resolve) => { lookResolve = resolve; });
  const link = bindHydrantLink({
    worldViewFrame: {
      openSupporting: async () => ({ pairView: 'STREET 360' })
    },
    street360: {
      snapshot: () => ({ open: false, stageState: 'OPENING' }),
      lookAtHydrant: async () => hanging
    }
  });
  const result = await Promise.race([
    Promise.resolve(link.dispatchStreet(record)),
    new Promise((_, reject) => setTimeout(() => reject(new Error('BRAIN dispatch hung')), 80))
  ]);
  assert.equal(result.objectRef.id, '5011151');
  assert.equal(result.dispatched, true);
  assert.equal(result.representation, 'PENDING');
  lookResolve({ available: true, hydrant: { sourceId: '5011151' } });
});

test('WorldView conceals Street for Google 3D instead of destroying the panorama', () => {
  const frame = read('shell/WorldViewFrame.js');
  const street = read('shell/Street360Control.js');
  const session = read('bootstrap/worldview-map-session.js');
  const engine = read('map/google-street-view.js');
  const link = read('map/woa/hydrant-link.js');
  assert.match(frame, /concealStreet/);
  assert.match(street, /async function conceal/);
  assert.match(street, /async function reveal/);
  assert.match(street, /concealed !== true/);
  assert.match(engine, /street\.panorama\.reconstruct/);
  assert.match(engine, /disposePanoramaInstance/);
  assert.match(engine, /street\.aim\.reuse/);
  assert.match(session, /dispatchStreet/);
  assert.match(link, /representation: 'PENDING'/);
  assert.equal((read('map/map-foundation.js').match(/new MapView\(/g) || []).length, 1);
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
