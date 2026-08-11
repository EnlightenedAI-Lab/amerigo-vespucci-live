import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeSpatialSourceFingerprint,
  initSpatialRuntimeInfo,
  getRuntimeInfoResponse
} from '../src/spatial/spatial-runtime-info.js';

test('computeSpatialSourceFingerprint returns stable short hash', () => {
  const a = computeSpatialSourceFingerprint();
  const b = computeSpatialSourceFingerprint();
  assert.equal(a, b);
  assert.match(a, /^[a-f0-9]{7}$/);
});

test('getRuntimeInfoResponse includes observability fields', () => {
  initSpatialRuntimeInfo({ preview: true, agent: 'A1', worktreeRole: 'spatial-v1' });
  const info = getRuntimeInfoResponse();
  assert.equal(info.agent, 'A1');
  assert.equal(info.worktreeRole, 'spatial-v1');
  assert.ok(info.gitHead);
  assert.ok(info.runtimeBuildId.startsWith('B'));
  assert.equal(info.spatialFingerprintScope, 'public/spatial/**');
  assert.equal(info.rendererMode, 'IDLE');
});
