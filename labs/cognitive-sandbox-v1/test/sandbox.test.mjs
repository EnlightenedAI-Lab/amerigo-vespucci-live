import assert from 'node:assert/strict';
import test from 'node:test';
import { CognitiveBrain } from '../lib/brain.mjs';
import {
  cloneReadonlySnapshot,
  validateCognitiveResponse,
  validateWorldStateSnapshot
} from '../lib/contracts.mjs';
import { loadSyntheticFixtures } from '../lib/fixtures.mjs';
import { DeterministicMockAdapter } from '../lib/model-adapters.mjs';
import { createLabServer } from '../server.mjs';

const fixtures = loadSyntheticFixtures();
const byId = (id) => fixtures.find((fixture) => fixture.snapshotId === id);

test('all explicitly synthetic fixtures satisfy WorldStateSnapshot V1', () => {
  assert.equal(fixtures.length, 6);
  for (const fixture of fixtures) {
    assert.match(fixture.snapshotId, /^synthetic-test-/);
    assert.equal(validateWorldStateSnapshot(fixture), fixture);
    assert.equal(Object.isFrozen(fixture), true);
  }
});

test('schema rejects invented top-level fields', () => {
  const invalid = structuredClone(fixtures[0]);
  invalid.nearbyPeople = [];
  assert.throws(() => validateWorldStateSnapshot(invalid), /must contain exactly/);
});

test('unknown and null values are preserved rather than defaulted', () => {
  const source = byId('synthetic-test-unresolved-object');
  const cloned = cloneReadonlySnapshot(source);
  assert.equal(cloned.object.sourceId, null);
  assert.equal(cloned.object.attributes, null);
  assert.equal(cloned.object.provenance, null);
  assert.equal(cloned.sensorPose, null);
  assert.equal(cloned.street360, null);
});

test('KNOWN and INFERRED remain disjoint', async () => {
  const brain = new CognitiveBrain(new DeterministicMockAdapter());
  const response = await brain.reason(
    byId('synthetic-test-target-vs-observation-time'),
    'What date am I actually looking at?'
  );
  assert.doesNotThrow(() => validateCognitiveResponse(response));
  for (const inferred of response.inferred) {
    assert.equal(response.known.includes(inferred), false);
  }
  assert.ok(response.warnings.some((warning) => warning.includes('KNOWN and UNKNOWN are deterministic')));
});

test('target time and displayed observation time are explicitly separate', async () => {
  const brain = new CognitiveBrain(new DeterministicMockAdapter());
  const response = await brain.reason(
    byId('synthetic-test-target-vs-observation-time'),
    'What date am I actually looking at?'
  );
  assert.ok(response.known.includes('The displayed observation time is 2021-05.'));
  assert.ok(response.known.includes('The requested target time is 2019.'));
  assert.ok(response.known.includes('The target time (2019) differs from the displayed observation time (2021-05).'));
  assert.equal(response.summary.includes('2019'), false);
});

test('unresolved object identity stays unresolved', async () => {
  const brain = new CognitiveBrain(new DeterministicMockAdapter());
  const response = await brain.reason(
    byId('synthetic-test-unresolved-object'),
    'What do we know about this object?'
  );
  assert.ok(response.known.includes('An object state is present, but its identity fields are unresolved.'));
  assert.ok(response.unknown.includes('The object identity, class, and source ID are unknown.'));
  assert.equal(JSON.stringify(response).includes('building identity'), false);
  assert.equal(response.known.some((statement) => /NRCan/i.test(statement)), false);
});

test('authoritative object truth preserves source ID and provenance', async () => {
  const brain = new CognitiveBrain(new DeterministicMockAdapter());
  const response = await brain.reason(
    byId('synthetic-test-nrcan-building'),
    'Is this object authoritative or inferred?'
  );
  assert.ok(response.known.includes('The stated object authority is NRCan Automatically Extracted Buildings.'));
  assert.ok(response.known.includes('The source ID is synthetic-nrcan-building-001.'));
  assert.ok(response.known.some((statement) => statement.startsWith('Object provenance:')));
});

test('proposed actions satisfy schema and available capability gates', async () => {
  const fixture = byId('synthetic-test-nrcan-building');
  const brain = new CognitiveBrain(new DeterministicMockAdapter());
  const response = await brain.reason(fixture, 'What should I inspect next?');
  assert.doesNotThrow(() => validateCognitiveResponse(response));
  assert.ok(response.proposedActions.length > 0);
  for (const action of response.proposedActions) {
    assert.ok(fixture.availableCapabilities.includes(action.requiredCapability));
    assert.match(action.riskTruthNotes, /Proposal only|must not override|no measurement is claimed/i);
  }
  assert.equal(response.proposedActions.some((action) => /I placed|executed/i.test(action.reason)), false);
});

test('travel distance is answered only from traversal state', async () => {
  const brain = new CognitiveBrain(new DeterministicMockAdapter());
  const travelled = await brain.reason(
    byId('synthetic-test-street360-traversal'),
    'How far have I travelled?'
  );
  assert.ok(travelled.known.includes('The supplied travelled distance is 184.6 meters.'));

  const absent = await brain.reason(
    byId('synthetic-test-map-montreal-no-object'),
    'How far have I travelled?'
  );
  assert.equal(absent.known.length, 0);
  assert.ok(absent.unknown[0].includes('no traversal state'));
});

test('model adapter is replaceable without changing the Brain contract', async () => {
  const customAdapter = {
    async health() {
      return { ok: true };
    },
    metadata() {
      return {
        provider: 'contract-test',
        model: 'replaceable-adapter',
        runtime: 'test-runtime',
        mode: 'MOCK',
        capabilities: {}
      };
    },
    async generate({ selectionContext }) {
      return JSON.stringify({
        inferenceIds: selectionContext.inferenceCandidates.map((candidate) => candidate.id),
        actionIds: selectionContext.actionCandidates.slice(0, 1).map((candidate) => candidate.id)
      });
    }
  };
  const response = await new CognitiveBrain(customAdapter).reason(fixtures[0], 'What am I looking at?');
  assert.equal(response.modelMetadata.provider, 'contract-test');
  assert.doesNotThrow(() => validateCognitiveResponse(response));
});

test('deterministic mock produces stable grounded content', async () => {
  const brain = new CognitiveBrain(new DeterministicMockAdapter());
  const first = await brain.reason(fixtures[2], 'What should I inspect next?');
  const second = await brain.reason(fixtures[2], 'What should I inspect next?');
  assert.deepEqual(first.known, second.known);
  assert.deepEqual(first.inferred, second.inferred);
  assert.deepEqual(first.unknown, second.unknown);
  assert.deepEqual(first.proposedActions, second.proposedActions);
});

test('HTTP surface has no execution or write-back API', async (t) => {
  const server = createLabServer({
    fixtures,
    adapterFactory: () => new DeterministicMockAdapter()
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;

  const health = await fetch(`${base}/api/health?provider=mock`).then((response) => response.json());
  assert.equal(health.writeBack, false);
  assert.deepEqual(health.productionTools, []);

  for (const route of ['/api/action', '/api/execute', '/api/write', '/api/map/move', '/api/camera/place']) {
    const response = await fetch(`${base}${route}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}'
    });
    assert.equal(response.status, 404, route);
  }
});

test('reason API accepts supplied state and returns structured advisory output', async (t) => {
  const server = createLabServer({
    fixtures,
    adapterFactory: () => new DeterministicMockAdapter()
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const { port } = server.address();
  const response = await fetch(`http://127.0.0.1:${port}/api/reason`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      snapshot: fixtures[0],
      question: 'What object have I acquired?',
      provider: 'mock'
    })
  });
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.ok(payload.known.includes('The snapshot contains no acquired object.'));
  assert.match(payload.warnings[0], /No action has been executed/);
});
