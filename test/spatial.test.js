import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from '../src/server.js';

const state = { aisConnected: () => false };
const config = { healthStaleAfterSeconds: 60, targetMmsi: 0, enableHistory: false, enableConditions: false };

test('/spatial serves the isolated IQAI Spatial prototype', async (t) => {
  const server = createServer(state, config).listen(0);
  t.after(() => server.close());
  await new Promise((resolve) => server.once('listening', resolve));
  const response = await fetch(`http://127.0.0.1:${server.address().port}/spatial`);
  const html = await response.text();
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /text\/html/);
  assert.match(html, /What would you like to map\?/);
  assert.match(html, /Create Map/);
  assert.match(html, /Generated map workspace/);
});

test('/ remains the classic Vespucci service response', async (t) => {
  const server = createServer(state, config).listen(0);
  t.after(() => server.close());
  await new Promise((resolve) => server.once('listening', resolve));
  const response = await fetch(`http://127.0.0.1:${server.address().port}/`);
  assert.deepEqual(await response.json(), { service: 'amerigo-vespucci-live', health: '/health' });
});

test('prototype script wires creation, revision, panels, tabs, and back navigation', async () => {
  const script = await readFile(new URL('../public/spatial/spatial.js', import.meta.url), 'utf8');
  for (const interaction of ['#create-form', '#revision-form', '#panel-trigger', '#close-panel', '#back-button', '[role="tab"]']) {
    assert.match(script, new RegExp(interaction.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  assert.doesNotMatch(script, /fetch\s*\(/);
});
