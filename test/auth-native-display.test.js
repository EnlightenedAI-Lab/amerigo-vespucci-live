import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveRendererBadgeMode } from '../public/spatial/spatial-renderer-telemetry.js';

test('resolveRendererBadgeMode maps auth_native to AUTH-NATIVE', () => {
  assert.equal(resolveRendererBadgeMode('auth_native'), 'AUTH-NATIVE');
});

test('resolveRendererBadgeMode maps runtime-fallback explicitly', () => {
  assert.equal(resolveRendererBadgeMode('runtime-fallback'), 'RUNTIME-FALLBACK');
});

test('resolveRendererBadgeMode returns IDLE when mode missing', () => {
  assert.equal(resolveRendererBadgeMode(null), 'IDLE');
});

test('resolveRendererBadgeMode returns ERROR for layer view filter failure', () => {
  assert.equal(
    resolveRendererBadgeMode(null, { success: false, reason: 'layer_view_filter_failed' }),
    'ERROR'
  );
});
