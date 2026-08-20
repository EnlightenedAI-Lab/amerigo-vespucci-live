import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ACTION_SOURCE,
  POLICY_ACTION
} from '../public/spatial-v2/foundation/contracts/index.js';
import { createSpatialV2Chassis } from '../public/spatial-v2/bootstrap/spatial-v2-bootstrap.js';
import { executeGovernedHydrantAction, executeHydrantNearest, executeHydrantWithin, filterHydrantsWithin, findNearestHydrant } from '../public/spatial-v2/map/woa/hydrant-within.js';
import { parseAskMapIntent } from '../public/spatial-v2/brain/ask-map-intent.js';
import { distanceToFeatureMeters } from '../public/spatial-v2/map/focus/objects.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const V2 = path.join(ROOT, 'public', 'spatial-v2');
const HERE = Object.freeze({ longitude: -73.56832, latitude: 45.50169 });
const HYDRANTS = JSON.parse(fs.readFileSync(path.join(V2, 'data/woa/hydrants.geojson'), 'utf8'));

function read(rel) {
  return fs.readFileSync(path.join(V2, rel), 'utf8');
}

function chassis() {
  let n = 0;
  const instance = createSpatialV2Chassis({
    now: () => '2026-08-20T16:00:00.000Z',
    idFactory: () => `gma-${++n}`
  });
  instance.setHereContextProvider(() => ({ pin: { ...HERE, source: 'drop-pin' } }));
  instance.setGovernedMapExecutor(async (input) => executeGovernedHydrantAction({
    intent: input.intent,
    here: input.here,
    collection: HYDRANTS,
    paint: async () => ({ painted: false, reason: 'NODE' })
  }));
  return instance;
}

test('governed hydrant WITHIN uses Ville de Montréal records and the 500 m constraint', async () => {
  const intent = parseAskMapIntent('Show hydrants within 500 m of here.');
  const hits = filterHydrantsWithin(HYDRANTS, HERE, 500);
  const executed = await executeHydrantWithin({
    intent,
    here: { ...HERE, kind: 'PIN' },
    collection: HYDRANTS
  });
  assert.equal(executed.count, hits.length);
  assert.ok(executed.count > 0);
  assert.equal(executed.source.provider, 'Ville de Montréal');
  assert.match(executed.source.dataset, /Bornes d'incendie/);
  assert.equal(executed.hits.every((hit) => hit.distanceMeters <= 500), true);
  assert.equal(executed.hits.some((hit) => hit.distanceMeters > 500), false);
});

test('Ask proposes SHOW HYDRANTS WITHIN 500 M and does not execute until confirm', async () => {
  const host = chassis();
  const proposed = await host.submitAsk({ text: 'Show hydrants within 500 m of here.' });
  assert.equal(proposed.state, 'ROUTED');
  assert.equal(proposed.result.needsConfirmation, true);
  assert.equal(proposed.result.mapExecuted, false);
  assert.equal(proposed.result.confirmationTitle, 'SHOW HYDRANTS WITHIN 500 M');
  assert.equal(host.snapshotGovernedMapAction().pending.confirmationTitle, 'SHOW HYDRANTS WITHIN 500 M');
  assert.equal(host.snapshotGovernedMapAction().last, null);
});

test('operator confirmation executes the governed action with a truthful count', async () => {
  const host = chassis();
  await host.submitAsk({ text: 'Show hydrants within 500 m of here.' });
  const confirmed = await host.confirmGovernedMapAction();
  const expected = filterHydrantsWithin(HYDRANTS, HERE, 500).length;
  assert.equal(confirmed.result.mapExecuted, true);
  assert.equal(confirmed.result.count, expected);
  assert.equal(confirmed.result.source.provider, 'Ville de Montréal');
  assert.match(confirmed.result.message, /SHOW HYDRANTS WITHIN 500 M/);
  assert.equal(host.snapshotGovernedMapAction().pending, null);
  assert.equal(host.snapshotGovernedMapAction().last.count, expected);
});

test('unconfirmed capability execution fails closed', async () => {
  const host = chassis();
  await assert.rejects(
    () => host.executeChassis('map.governed-action', { confirmed: false }),
    (error) => error.code === 'OPERATOR_CONFIRMATION_REQUIRED'
  );
});

test('Brain cannot mint a grant', () => {
  const host = chassis();
  assert.throws(
    () => host.policyService.issueGrant({
      actorRef: 'operator:session',
      capabilityId: 'map.governed-action',
      policyAction: POLICY_ACTION.DISPLAY,
      resourceRefs: [],
      sessionId: host.stateStore.getSnapshot().context.sessionId,
      worldId: host.stateStore.getSnapshot().worlds.activeWorldId
    }, { source: ACTION_SOURCE.BRAIN }),
    (error) => error.code === 'MODEL_CANNOT_MINT_GRANT'
  );
});

test('HERE must be operator-defined; map center is not enough', async () => {
  const host = chassis();
  host.setHereContextProvider(() => ({ mapCenter: HERE }));
  const receipt = await host.submitAsk({ text: 'Show hydrants within 500 m of here.' });
  assert.equal(receipt.result.needsLocation, true);
  assert.equal(receipt.result.mapExecuted, false);
  assert.equal(host.snapshotGovernedMapAction().pending, null);
});

test('V2 governed map action does not import the V1 painter', () => {
  for (const rel of [
    'brain/ask-map-intent.js',
    'brain/here-context.js',
    'map/woa/hydrant-within.js',
    'map/governed-map-overlay.js',
    'bootstrap/spatial-v2-bootstrap.js',
    'shell/AskIqaiDock.js'
  ]) {
    assert.doesNotMatch(read(rel), /spatial-map-command/);
    assert.doesNotMatch(read(rel), /new MapView\(/);
  }
});

function independentNearestHydrant(collection, here) {
  let best = null;
  for (const feature of collection.features || []) {
    const dist = distanceToFeatureMeters(here.latitude, here.longitude, feature);
    const sourceId = String(feature?.properties?.lab?.sourceId || '');
    if (!sourceId || !Number.isFinite(dist)) continue;
    if (
      !best
      || dist < best.distanceMeters
      || (dist === best.distanceMeters && sourceId.localeCompare(best.sourceId) < 0)
    ) {
      best = { sourceId, distanceMeters: dist, feature };
    }
  }
  return best;
}

test('Ask proposes SHOW NEAREST HYDRANT and does not execute until confirm', async () => {
  const host = chassis();
  const proposed = await host.submitAsk({ text: 'Show the nearest hydrant to here.' });
  assert.equal(proposed.state, 'ROUTED');
  assert.equal(proposed.result.needsConfirmation, true);
  assert.equal(proposed.result.mapExecuted, false);
  assert.equal(proposed.result.confirmationTitle, 'SHOW NEAREST HYDRANT');
  assert.equal(proposed.result.intent.operation, 'NEAREST');
  assert.equal(host.snapshotGovernedMapAction().pending.confirmationTitle, 'SHOW NEAREST HYDRANT');
  assert.equal(host.snapshotGovernedMapAction().pending.operation, 'NEAREST');
  assert.equal(host.snapshotGovernedMapAction().last, null);
});

test('operator confirmation executes NEAREST on the actual minimum-distance hydrant', async () => {
  const host = chassis();
  const expected = independentNearestHydrant(HYDRANTS, HERE);
  const queried = findNearestHydrant(HYDRANTS, HERE);
  assert.equal(queried.sourceId, expected.sourceId);
  const closer = (HYDRANTS.features || []).filter((feature) => {
    const dist = distanceToFeatureMeters(HERE.latitude, HERE.longitude, feature);
    const sourceId = String(feature?.properties?.lab?.sourceId || '');
    return sourceId && Number.isFinite(dist) && dist < expected.distanceMeters;
  });
  assert.equal(closer.length, 0);

  await host.submitAsk({ text: 'Show the nearest hydrant to here.' });
  assert.equal(host.snapshotGovernedMapAction().last, null);
  const confirmed = await host.confirmGovernedMapAction();
  assert.equal(confirmed.result.mapExecuted, true);
  assert.equal(confirmed.result.count, 1);
  assert.equal(confirmed.result.nearest.sourceId, expected.sourceId);
  assert.equal(Math.abs(confirmed.result.distanceMeters - expected.distanceMeters) < 0.01, true);
  assert.match(confirmed.result.message, /SHOW NEAREST HYDRANT/);
  assert.match(confirmed.result.message, new RegExp(expected.sourceId));
  assert.equal(confirmed.result.source.provider, 'Ville de Montréal');
  assert.equal(host.snapshotGovernedMapAction().pending, null);
  assert.equal(host.snapshotGovernedMapAction().last.nearest.sourceId, expected.sourceId);
  assert.equal(host.snapshotGovernedMapAction().last.operation, 'NEAREST');
});

test('NEAREST calculation returns the actual minimum-distance hydrant from GeoJSON', async () => {
  const intent = parseAskMapIntent('Show the nearest hydrant to here.');
  const expected = independentNearestHydrant(HYDRANTS, HERE);
  const executed = await executeHydrantNearest({
    intent,
    here: { ...HERE, kind: 'PIN' },
    collection: HYDRANTS
  });
  assert.equal(executed.count, 1);
  assert.equal(executed.operation, 'NEAREST');
  assert.equal(executed.nearest.sourceId, expected.sourceId);
  assert.equal(executed.hits[0].sourceId, expected.sourceId);
  assert.ok(executed.nearest.distanceMeters > 0);
  assert.equal(Math.abs(executed.nearest.distanceMeters - expected.distanceMeters) < 0.01, true);
  for (const feature of HYDRANTS.features || []) {
    const dist = distanceToFeatureMeters(HERE.latitude, HERE.longitude, feature);
    const sourceId = String(feature?.properties?.lab?.sourceId || '');
    if (!sourceId || sourceId === expected.sourceId || !Number.isFinite(dist)) continue;
    assert.ok(dist >= expected.distanceMeters);
  }
});

test('HERE for NEAREST uses the accepted operator pin path', async () => {
  const host = chassis();
  const proposed = await host.submitAsk({ text: 'Show the nearest hydrant to here.' });
  assert.equal(proposed.result.here.kind, 'PIN');
  assert.equal(proposed.result.here.latitude, HERE.latitude);
  assert.equal(proposed.result.here.longitude, HERE.longitude);
  host.setHereContextProvider(() => ({ mapCenter: HERE }));
  const missing = await host.submitAsk({ text: 'Show the nearest hydrant to here.' });
  assert.equal(missing.result.needsLocation, true);
  assert.equal(missing.result.mapExecuted, false);
});
