import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeRendererClassValue } from '../public/spatial/result-legend-model.js';
import { classifyCase } from '../public/spatial/iqai-legend-diagnostic.js';

test('classifyCase CASE_A when map and native ok but iqai fails', () => {
  assert.equal(classifyCase('loaded', 'loaded', 'black'), 'CASE_A');
});

test('classifyCase CASE_B when map ok but native and iqai fail', () => {
  assert.equal(classifyCase('loaded', 'black', 'black'), 'CASE_B');
});

test('classifyCase CASE_C when map fails', () => {
  assert.equal(classifyCase('black', 'black', 'black'), 'CASE_C');
});

test('classifyCase CASE_D when all pass', () => {
  assert.equal(classifyCase('loaded', 'loaded', 'loaded'), 'CASE_D');
});

test('normalizeRendererClassValue from result-legend-model', () => {
  assert.equal(normalizeRendererClassValue('  bicycle_parking '), 'bicycle_parking');
});
