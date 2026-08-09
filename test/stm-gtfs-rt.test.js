import test from 'node:test';
import assert from 'node:assert/strict';
import GtfsRealtimeBindings from 'gtfs-realtime-bindings';
import { fetchStmVehiclePositions } from '../src/spatial/stm-gtfs-rt-client.js';
import {
  STM_LAYER_ID,
  STM_LAYER_TITLE,
  STM_CLIENT_REFRESH_MS,
  STM_SOURCE_LABEL
} from '../src/spatial/stm-gtfs-rt-config.js';

function buildMockFeed() {
  const feed = GtfsRealtimeBindings.transit_realtime.FeedMessage.create({
    header: {
      gtfsRealtimeVersion: '2.0',
      timestamp: 1_700_000_000
    },
    entity: [{
      id: '42',
      vehicle: {
        trip: { routeId: '57', tripId: 'trip-57' },
        position: { latitude: 45.5017, longitude: -73.5673, bearing: 180, speed: 4.2 },
        timestamp: 1_700_000_000
      }
    }]
  });
  return GtfsRealtimeBindings.transit_realtime.FeedMessage.encode(feed).finish();
}

test('stm config exposes layer identity and refresh interval', () => {
  assert.equal(STM_LAYER_ID, 'stm-live-buses');
  assert.equal(STM_LAYER_TITLE, 'STM — Live Buses');
  assert.equal(STM_CLIENT_REFRESH_MS, 20_000);
  assert.equal(STM_SOURCE_LABEL, 'STM GTFS-Realtime');
});

test('fetchStmVehiclePositions decodes protobuf and normalizes vehicles', async () => {
  const origKey = process.env.STM_API_KEY;
  process.env.STM_API_KEY = 'test-stm-key-not-real';

  const bytes = buildMockFeed();
  const fetchFn = async (url, options) => {
    assert.equal(url, 'https://api.stm.info/pub/od/gtfs-rt/ic/v2/vehiclePositions');
    assert.equal(options.headers.apikey, 'test-stm-key-not-real');
    assert.equal(options.headers.accept, 'application/x-protobuf');
    return {
      ok: true,
      arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
    };
  };

  const result = await fetchStmVehiclePositions({ fetchFn });
  assert.equal(result.ok, true);
  assert.equal(result.source, STM_SOURCE_LABEL);
  assert.equal(result.vehicleCount, 1);
  assert.equal(result.vehicles[0].vehicleId, '42');
  assert.equal(result.vehicles[0].routeId, '57');
  assert.equal(result.vehicles[0].tripId, 'trip-57');
  assert.ok(Math.abs(result.vehicles[0].latitude - 45.5017) < 0.0001);
  assert.ok(Math.abs(result.vehicles[0].longitude - -73.5673) < 0.0001);
  assert.ok(Math.abs(result.vehicles[0].bearing - 180) < 0.01);
  assert.ok(Math.abs(result.vehicles[0].speed - 4.2) < 0.01);
  assert.equal(result.vehicles[0].timestamp, 1_700_000_000);
  assert.match(String(result.feedTimestampIso), /^\d{4}-\d{2}-\d{2}T/);
  assert.match(String(result.retrievedAt), /^\d{4}-\d{2}-\d{2}T/);

  process.env.STM_API_KEY = origKey;
});

test('fetchStmVehiclePositions fails without STM_API_KEY', async () => {
  const origKey = process.env.STM_API_KEY;
  delete process.env.STM_API_KEY;
  const result = await fetchStmVehiclePositions();
  assert.equal(result.ok, false);
  assert.match(result.error, /STM_API_KEY/i);
  process.env.STM_API_KEY = origKey;
});

test('STM live buses API does not expose api key', async () => {
  const { createServer } = await import('../src/server.js');
  const { createPreviewConfig, createPreviewState } = await import('../src/demo-map-api.js');
  const origKey = process.env.STM_API_KEY;
  process.env.STM_API_KEY = 'test-stm-key-not-real';

  const bytes = buildMockFeed();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    if (String(url).includes('api.stm.info')) {
      assert.equal(options.headers.apikey, 'test-stm-key-not-real');
      return {
        ok: true,
        arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
      };
    }
    return originalFetch(url, options);
  };

  const app = createServer(createPreviewState(), createPreviewConfig(), null, { preview: true });
  const server = app.listen(0);
  const port = server.address().port;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/spatial/stm/live-buses`);
    const body = await response.json();
    const text = JSON.stringify(body);
    assert.equal(response.status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.vehicleCount, 1);
    assert.doesNotMatch(text, /test-stm-key-not-real/i);
    assert.doesNotMatch(text, /apikey/i);
  } finally {
    globalThis.fetch = originalFetch;
    process.env.STM_API_KEY = origKey;
    await new Promise((resolve) => server.close(resolve));
  }
});

test('stm-live-buses client polls IQAI endpoint not STM API', async () => {
  const src = await import('node:fs/promises').then((fs) =>
    fs.readFile(new URL('../public/spatial/stm-live-buses.js', import.meta.url), 'utf8')
  );
  assert.match(src, /\/api\/spatial\/stm\/live-buses/);
  assert.doesNotMatch(src, /api\.stm\.info/);
});
