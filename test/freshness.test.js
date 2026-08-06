import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyFreshness, positionAgeSeconds, FRESHNESS_THRESHOLDS } from '../src/freshness.js';

const NOW = new Date('2026-08-05T12:00:00Z').getTime();

test('classifies fresh positions within threshold', () => {
  const recent = new Date(NOW - 300_000);
  assert.equal(classifyFreshness(recent, NOW), 'fresh');
});

test('classifies aging positions between thresholds', () => {
  const aging = new Date(NOW - 1800_000);
  assert.equal(classifyFreshness(aging, NOW), 'aging');
});

test('classifies stale positions beyond aging threshold', () => {
  const stale = new Date(NOW - 7200_000);
  assert.equal(classifyFreshness(stale, NOW), 'stale');
});

test('returns unknown for null or invalid timestamps', () => {
  assert.equal(classifyFreshness(null, NOW), 'unknown');
  assert.equal(classifyFreshness('invalid', NOW), 'unknown');
});

test('computes position age in seconds', () => {
  const ts = new Date(NOW - 120_000);
  assert.equal(positionAgeSeconds(ts, NOW), 120);
});

test('returns null age for missing timestamp', () => {
  assert.equal(positionAgeSeconds(null, NOW), null);
});

test('freshness thresholds are documented values', () => {
  assert.equal(FRESHNESS_THRESHOLDS.fresh, 600);
  assert.equal(FRESHNESS_THRESHOLDS.aging, 3600);
});
