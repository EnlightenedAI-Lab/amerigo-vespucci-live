import test from 'node:test';
import assert from 'node:assert/strict';
import { MapCache } from '../src/map-cache.js';

test('returns null for missing cache key', () => {
  const cache = new MapCache(1000);
  assert.equal(cache.get('missing'), null);
});

test('stores and retrieves cached data', () => {
  const cache = new MapCache(60_000);
  const entry = cache.set('test', { value: 42 });
  const hit = cache.get('test');
  assert.ok(hit);
  assert.deepEqual(hit.data, { value: 42 });
  assert.equal(hit.fetchedAt.toISOString(), entry.fetchedAt.toISOString());
});

test('expires cache entries after TTL', () => {
  const cache = new MapCache(50);
  cache.set('test', { value: 1 });
  const start = Date.now();
  while (Date.now() - start < 60) { /* wait for expiry */ }
  assert.equal(cache.get('test'), null);
});

test('clear removes all entries', () => {
  const cache = new MapCache(60_000);
  cache.set('a', 1);
  cache.set('b', 2);
  cache.clear();
  assert.equal(cache.get('a'), null);
  assert.equal(cache.get('b'), null);
});
