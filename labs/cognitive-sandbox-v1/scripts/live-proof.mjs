import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CognitiveBrain } from '../lib/brain.mjs';
import { loadSyntheticFixtures } from '../lib/fixtures.mjs';
import { createModelAdapter } from '../lib/model-adapters.mjs';

const LAB_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const provider = process.argv.find((argument) => argument.startsWith('--provider='))?.split('=')[1] ?? 'ollama';
const adapter = createModelAdapter(provider);
const health = await adapter.health();

if (!health.ok) {
  console.error(JSON.stringify({
    result: 'BLOCKED',
    reason: 'Requested model adapter is not healthy',
    health
  }, null, 2));
  process.exitCode = 1;
} else {
  const fixtures = loadSyntheticFixtures();
  const byId = (id) => fixtures.find((fixture) => fixture.snapshotId === id);
  const brain = new CognitiveBrain(adapter);
  const cases = [
    {
      snapshotId: 'synthetic-test-map-montreal-no-object',
      question: 'What object have I acquired?',
      verify(response) {
        assert.ok(response.known.includes('The snapshot contains no acquired object.'));
      }
    },
    {
      snapshotId: 'synthetic-test-nrcan-building',
      question: 'What do we know about this object?',
      verify(response) {
        assert.ok(response.known.includes('The source ID is synthetic-nrcan-building-001.'));
        assert.ok(response.known.includes('The stated object authority is NRCan Automatically Extracted Buildings.'));
      }
    },
    {
      snapshotId: 'synthetic-test-target-vs-observation-time',
      question: 'What date am I actually looking at?',
      verify(response) {
        assert.ok(response.known.includes('The target time (2019) differs from the displayed observation time (2021-05).'));
      }
    },
    {
      snapshotId: 'synthetic-test-street360-traversal',
      question: 'How far have I travelled?',
      verify(response) {
        assert.ok(response.known.includes('The supplied travelled distance is 184.6 meters.'));
      }
    },
    {
      snapshotId: 'synthetic-test-unresolved-object',
      question: 'Is this object authoritative or inferred?',
      verify(response) {
        assert.ok(response.unknown.includes('The object authority is unknown.'));
        assert.equal(response.known.some((statement) => /NRCan/i.test(statement)), false);
      }
    }
  ];

  const results = [];
  for (const proofCase of cases) {
    const response = await brain.reason(byId(proofCase.snapshotId), proofCase.question);
    proofCase.verify(response);
    assert.equal(response.modelMetadata.status, 'READY', 'Live model must not silently fall back');
    results.push({
      inputSnapshotId: proofCase.snapshotId,
      question: proofCase.question,
      latencyMs: response.modelMetadata.latencyMs,
      loadTimeMs: response.modelMetadata.loadTimeMs,
      structuredOutput: response
    });
  }

  const proof = {
    result: 'PASS',
    generatedAt: new Date().toISOString(),
    syntheticFixtures: true,
    model: health.model,
    provider: health.provider,
    runtime: health.runtime,
    mode: health.mode,
    modelLoadTimeMs: results[0].loadTimeMs,
    cases: results
  };
  const proofDirectory = path.join(LAB_ROOT, 'proof');
  fs.mkdirSync(proofDirectory, { recursive: true });
  const proofPath = path.join(proofDirectory, `live-${provider}-proof.json`);
  fs.writeFileSync(proofPath, `${JSON.stringify(proof, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({ ...proof, proofPath }, null, 2));
}
