import test from 'node:test';
import assert from 'node:assert/strict';
import { stripSensitiveFields, sanitizeError, frameOptionsForPath } from '../src/security.js';

test('strips token and password fields from objects', () => {
  const input = { name: 'test', token: 'secret', ARCGIS_TOKEN: 'abc', password: 'pwd' };
  const result = stripSensitiveFields(input);
  assert.equal(result.name, 'test');
  assert.equal(result.token, undefined);
  assert.equal(result.ARCGIS_TOKEN, undefined);
  assert.equal(result.password, undefined);
});

test('strips sensitive fields recursively', () => {
  const input = { data: { apiKey: 'key', value: 1 } };
  const result = stripSensitiveFields(input);
  assert.equal(result.data.value, 1);
  assert.equal(result.data.apiKey, undefined);
});

test('sanitizes errors containing credential references', () => {
  const result = sanitizeError(new Error('ARCGIS_TOKEN is invalid'));
  assert.equal(result.error, 'An upstream data request failed.');
});

test('passes through safe error messages', () => {
  const result = sanitizeError(new Error('Layer 0 query failed'));
  assert.equal(result.error, 'Layer 0 query failed');
});

test('truncates overly long error messages', () => {
  const result = sanitizeError(new Error('x'.repeat(300)));
  assert.equal(result.error, 'An upstream data request failed.');
});

test('same-origin 3D specialist frame may be framed; other paths stay DENY', () => {
  assert.equal(frameOptionsForPath('/spatial-v2/google-3d-frame.html'), 'SAMEORIGIN');
  assert.equal(frameOptionsForPath('/spatial-v2/'), 'DENY');
  assert.equal(frameOptionsForPath('/spatial-v2/index.html'), 'DENY');
});
