import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LAYER_CATALOG,
  validateCatalog,
  validateLayerRecord,
  isRetiredHycomItem,
  RETIRED_HYCOM_ITEM_ID,
  getLayersForMode
} from '../src/spatial/layer-catalog.js';
import { CostPolicy } from '../src/spatial/cost-policy.js';
import { ModeController } from '../src/spatial/mode-controller.js';
import { TimeController, parseProviderTime } from '../src/spatial/time-controller.js';
import {
  classifyVesselFreshness,
  resolveHeading,
  bearingToDestination,
  routeMetrics,
  FRESHNESS_LIVE_SECONDS
} from '../src/spatial/vessel-state.js';
import { AttributionManager } from '../src/spatial/attribution-manager.js';
import { WpiPortService } from '../src/spatial/wpi-ports.js';
import { ProviderHealth } from '../src/spatial/provider-health.js';

test('LayerCatalog schema validates all enabled layers', () => {
  const errors = validateCatalog();
  assert.deepEqual(errors, []);
});

test('every enabled layer has provider, evidence, cost, licence, attribution, revalidatedAt', () => {
  for (const layer of LAYER_CATALOG.filter((l) => l.enabled)) {
    assert.ok(layer.provider, `${layer.id} provider`);
    assert.ok(layer.evidenceClass, `${layer.id} evidence`);
    assert.ok(layer.costClass, `${layer.id} cost`);
    assert.ok(layer.licenceStatus, `${layer.id} licence`);
    assert.ok(layer.attribution, `${layer.id} attribution`);
    assert.ok(layer.revalidatedAt, `${layer.id} revalidatedAt`);
  }
});

test('CostPolicy blocks UNKNOWN in production', () => {
  const policy = new CostPolicy({ isProduction: true, blockUnknownInProduction: true });
  const layer = LAYER_CATALOG.find((l) => l.id === 'ipma-radar-azores');
  const decision = policy.evaluate(layer);
  assert.equal(decision.allowed, false);
});

test('CostPolicy blocks unfunded COMMERCIAL', () => {
  const policy = new CostPolicy({ commercialEnabled: false });
  const decision = policy.evaluate({
    enabled: true,
    costClass: 'COMMERCIAL',
    id: 'x',
    modes: ['navigation']
  });
  assert.equal(decision.allowed, false);
});

test('CostPolicy blocks unconfirmed ARCGIS_CREDIT_CONSUMING', () => {
  const policy = new CostPolicy();
  const decision = policy.evaluate({
    enabled: true,
    costClass: 'ARCGIS_CREDIT_CONSUMING',
    id: 'credit-layer',
    modes: ['ocean']
  });
  assert.equal(decision.allowed, false);
  assert.equal(decision.requiresConfirmation, true);
});

test('CostPolicy allows approved FREE_PUBLIC and ARCGIS_SUBSCRIBER', () => {
  const policy = new CostPolicy({ radarEnabled: false });
  assert.equal(policy.canActivate('copernicus-current'), true);
  assert.equal(policy.canActivate('vespucci-operational'), true);
});

test('IPMA radar defaults disabled', () => {
  const policy = new CostPolicy({ radarEnabled: false, isProduction: true });
  const layer = LAYER_CATALOG.find((l) => l.id === 'ipma-radar-azores');
  assert.equal(layer.enabled, false);
  const decision = policy.evaluate({ ...layer, enabled: true });
  assert.equal(decision.allowed, false);
  assert.match(decision.reason, /Permission review|UNKNOWN/i);
});

test('retired HYCOM item cannot be enabled as live', () => {
  assert.equal(isRetiredHycomItem(RETIRED_HYCOM_ITEM_ID), true);
  const hycom = LAYER_CATALOG.find((l) => l.id === 'hycom-retired');
  assert.equal(hycom.enabled, false);
  assert.ok(validateLayerRecord({ ...hycom, enabled: true }).some((e) => /HYCOM/i.test(e)));
});

test('mode transitions preserve tracker layers and enable contextual layers', () => {
  const mc = new ModeController(new CostPolicy({ radarEnabled: false }));
  const nav = mc.setMode('navigation');
  assert.ok(nav.tracker.length >= 1);
  assert.ok(nav.contextual.some((l) => l.id === 'gebco-bathymetry'));
  const ocean = mc.setMode('ocean');
  assert.ok(ocean.contextual.some((l) => l.id === 'copernicus-current'));
  assert.ok(ocean.tracker.length >= 1);
});

test('full-coverage analytical exclusivity in ocean mode', () => {
  const mc = new ModeController(new CostPolicy({ radarEnabled: false }));
  const ocean = mc.setMode('ocean');
  const exclusive = ocean.contextual.filter((l) => l.exclusiveGroup === 'ocean-analytical');
  assert.equal(exclusive.length, 1);
  assert.equal(exclusive[0].id, 'copernicus-current');
});

test('TimeController selects nearest valid frame', () => {
  const tc = new TimeController();
  const frames = ['2026-08-05T00:00:00Z', '2026-08-05T06:00:00Z', '2026-08-05T12:00:00Z'];
  tc.setFrames(frames, '2026-08-05T07:00:00Z');
  assert.match(tc.validTime, /2026-08-05T06:00:00/);
  assert.equal(tc.evidenceClassForTime('2026-08-06T00:00:00Z', new Date('2026-08-05T00:00:00Z')), 'FORECAST');
});

test('parseProviderTime returns UTC ISO', () => {
  assert.equal(parseProviderTime('2026-08-05T12:00:00Z'), '2026-08-05T12:00:00.000Z');
});

test('AIS heading 511 falls back to COG', () => {
  const r = resolveHeading({ heading: 511, course: 95 });
  assert.equal(r.heading, 95);
  assert.equal(r.source, 'cog');
});

test('freshness thresholds', () => {
  const now = Date.now();
  assert.equal(classifyVesselFreshness(new Date(now - FRESHNESS_LIVE_SECONDS * 1000)), 'LIVE');
  assert.equal(classifyVesselFreshness(new Date(now - 600 * 1000)), 'DELAYED');
  assert.equal(classifyVesselFreshness(new Date(now - 4000 * 1000)), 'STALE');
});

test('route metrics distance bearing and ETA', () => {
  const vessel = {
    latitude: 49.384148,
    longitude: -65.806084,
    speedKnots: 8,
    lastAIS: new Date('2026-08-05T12:00:00Z')
  };
  const dest = { latitude: 37.734722, longitude: -25.664444 };
  const m = routeMetrics(vessel, dest, { etaMinSpeedKnots: 1 });
  assert.ok(m.distanceNM > 1800);
  assert.ok(m.bearingDeg >= 0 && m.bearingDeg <= 360);
  assert.ok(m.eta instanceof Date);
  assert.equal(m.estimated, true);
});

test('bearingToDestination computes degrees', () => {
  const br = bearingToDestination(
    { latitude: 49.38, longitude: -65.8 },
    { latitude: 37.73, longitude: -25.66 }
  );
  assert.ok(br > 0 && br < 180);
});

test('AttributionManager deduplicates', () => {
  const am = new AttributionManager();
  am.setActiveLayers([
    { attribution: 'Copernicus Marine Service', provider: 'Copernicus' },
    { attribution: 'Copernicus Marine Service', provider: 'Copernicus' },
    { attribution: 'Esri', provider: 'Esri' }
  ]);
  assert.equal(am.list().length, 2);
});

test('WPI CSV normalization and viewport filter', () => {
  const svc = new WpiPortService();
  const csv = 'PORT_NAME,COUNTRY,LATITUDE,LONGITUDE,HARBOR_SIZE\n"Ponta Delgada","Portugal",37.7347,-25.6644,"Large"\n';
  const ports = svc.parseCsv(csv);
  assert.equal(ports.length, 1);
  assert.equal(ports[0].name, 'Ponta Delgada');
  svc.cache.ports = ports;
  const filtered = svc.queryViewport({ west: -30, south: 35, east: -20, north: 40 });
  assert.equal(filtered.length, 1);
});

test('WPI NGA CSV parses DMS coordinates and camelCase headers', async () => {
  const { parseWpiCoordinate } = await import('../src/spatial/wpi-ports.js');
  assert.equal(parseWpiCoordinate('30°20\'00"N', 'lat'), 30 + 20 / 60);
  assert.equal(parseWpiCoordinate('48°17\'00"E', 'lon'), 48 + 17 / 60);
  const svc = new WpiPortService();
  const csv = 'portName,countryName,latitude,longitude,harborSize\nAbadan,Iran,"30°20\'00""N","48°17\'00""E",M\n';
  const ports = svc.parseCsv(csv);
  assert.equal(ports.length, 1);
  assert.ok(Math.abs(ports[0].latitude - 30.3333) < 0.01);
});

test('ProviderHealth circuit breaker returns last good', async () => {
  const ph = new ProviderHealth();
  ph.markReady('test', { lastGood: { ok: true } });
  let calls = 0;
  const result = await ph.run('test', async () => {
    calls++;
    throw new Error('fail');
  });
  assert.equal(result.ok, false);
  assert.ok(calls >= 1);
});

test('navigation mode includes seamarks and gebco', () => {
  const layers = getLayersForMode('navigation');
  assert.ok(layers.some((l) => l.id === 'openseamap-seamarks'));
  assert.ok(layers.some((l) => l.id === 'gebco-bathymetry'));
});
