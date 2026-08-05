import test from 'node:test';
import assert from 'node:assert/strict';
import { DataDockedClient, parseDataDockedPosition } from '../src/datadocked.js';

const targetMmsi = 247999000;

const dataDockedVessel = {
  mmsi: '247999000',
  name: 'AMERIGO VESPUCCI',
  speed: '8.5',
  course: '123.4',
  heading: '120',
  latitude: '43.12345',
  longitude: '10.98765',
  positionReceived: '2026-08-05T12:00:00Z',
  destination: 'LIVORNO',
  navigationalStatus: 'Under way using engine'
};

test('parses Data Docked detail response into normalized position', () => {
  const position = parseDataDockedPosition({ detail: dataDockedVessel }, targetMmsi);

  assert.deepEqual(position, {
    mmsi: targetMmsi,
    vesselName: 'AMERIGO VESPUCCI',
    speedKnots: 8.5,
    course: 123.4,
    heading: 120,
    latitude: 43.12345,
    longitude: 10.98765,
    lastAIS: new Date('2026-08-05T12:00:00Z'),
    destination: 'LIVORNO',
    navStatus: 'Under way using engine'
  });
});

test('parses top-level Data Docked response and treats invalid headings as null', () => {
  assert.equal(parseDataDockedPosition({ ...dataDockedVessel, heading: '-' }, targetMmsi).heading, null);
  assert.equal(parseDataDockedPosition({ ...dataDockedVessel, heading: 'not-a-heading' }, targetMmsi).heading, null);
});

test('rejects stale Data Docked positions when AISStream has a newer position', async () => {
  const state = {
    lastAISStreamPosition: { lastAIS: new Date('2026-08-05T12:10:00Z') },
    lastDataDockedAttempt: null,
    lastDataDockedAccepted: null
  };
  const handled = [];
  const client = new DataDockedClient({ datadockedApiKey: 'redacted', datadockedBaseUrl: 'https://datadocked.example/api/vessels_operations', targetMmsi }, (position) => handled.push(position), state);
  client.stopped = false;

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ detail: dataDockedVessel }), { status: 200, headers: { 'content-type': 'application/json' } });
  try {
    const accepted = await client.poll({ force: true, reason: 'test' });
    assert.equal(accepted, null);
    assert.equal(handled.length, 0);
    assert.equal(state.lastDataDockedAccepted, null);
    assert.ok(state.lastDataDockedAttempt instanceof Date);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
