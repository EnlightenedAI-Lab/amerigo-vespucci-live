import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createServer } from '../src/server.js';
import { createPreviewConfig, createPreviewState } from '../src/demo-map-api.js';
import {
  parseSpatialIntent,
  UNSUPPORTED_OPERATION_MESSAGE,
  unconfiguredDatasetMessage
} from '../src/spatial/mapper-intent.js';
import {
  filterStationsWithinRadius,
  normalizeFireStationCollection,
  filterActiveFireStations,
  classifyOperationalStatus,
  queryFireStationsWithinRadius
} from '../src/spatial/fire-station-query.js';
import { buildMapFromPrompt } from '../src/spatial/iqai-mapper.js';
import {
  getCuratedSource,
  listWhereSources
} from '../src/spatial/source-registry.js';
import {
  MTL_FIRE_STATIONS_CATALOGUE_URL,
  MTL_FIRE_STATIONS_GEOJSON_URL,
  MTL_FIRE_STATIONS_SOURCE_ID
} from '../src/spatial/fire-station-config.js';
import { DATASET_IDS } from '../src/spatial/dataset-registry.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixture = readFileSync(join(__dirname, 'fixtures', 'montreal-fire-stations-sample.geojson'), 'utf8');

const ORIGIN = { latitude: 45.492941, longitude: -73.648837 };
const COMMUNE = { latitude: 45.4955, longitude: -73.554 };

function mockFetch() {
  return async () => ({
    ok: true,
    status: 200,
    json: async () => JSON.parse(fixture)
  });
}

function postJson(port, path, body) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = http.request({
      hostname: '127.0.0.1',
      port,
      path,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      }
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(data) }));
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

test('parseSpatialIntent accepts fire within km variants', () => {
  const cases = [
    'Map fire stations within 3 km of 6939 Décarie Boulevard.',
    'Show fire stations within 3 km of 6939 Décarie.',
    'Map fire stations near 6939 Décarie within 3 kilometres.',
    'Show fire stations within 5 km of Old Montreal.'
  ];
  for (const prompt of cases) {
    const parsed = parseSpatialIntent(prompt);
    assert.equal(parsed.supported, true, prompt);
    assert.equal(parsed.request.action, 'WITHIN');
    assert.equal(parsed.request.datasetIds[0], DATASET_IDS.FIRE_STATIONS);
    assert.ok(parsed.request.radiusMeters > 0);
    assert.ok(parsed.request.locationText.length > 0);
  }
});

test('parseSpatialIntent parses LOCATE, NEAREST, COUNT, CLEAR', () => {
  const locate = parseSpatialIntent('Put a point at 997 de la Commune, Montreal.');
  assert.equal(locate.supported, true);
  assert.equal(locate.request.action, 'LOCATE');

  const nearest = parseSpatialIntent('Show the 3 nearest police stations to 997 de la Commune, Montreal.');
  assert.equal(nearest.supported, true);
  assert.equal(nearest.request.action, 'NEAREST');
  assert.equal(nearest.request.limit, 3);
  assert.equal(nearest.request.datasetIds[0], DATASET_IDS.POLICE_STATIONS);

  const count = parseSpatialIntent('How many fire stations are within 5 km of 997 de la Commune, Montreal?');
  assert.equal(count.supported, true);
  assert.equal(count.request.action, 'COUNT');

  const clear = parseSpatialIntent('Clear the results.');
  assert.equal(clear.supported, true);
  assert.equal(clear.request.action, 'CLEAR');
});

test('parseSpatialIntent rejects unconfigured datasets and unsupported ops', () => {
  const nuclear = parseSpatialIntent('Map nuclear shelters within 3 km of 997 de la Commune.');
  assert.equal(nuclear.supported, false);
  assert.equal(nuclear.message, unconfiguredDatasetMessage('nuclear shelters'));

  const predict = parseSpatialIntent('Predict where crime will happen tomorrow');
  assert.equal(predict.supported, false);
  assert.equal(predict.message, UNSUPPORTED_OPERATION_MESSAGE);

  const nearTransit = parseSpatialIntent('Show transit near 997 de la Commune, Montreal.');
  assert.equal(nearTransit.supported, false);
  assert.match(nearTransit.message, /requires a distance/i);
});

test('MTL_FIRE_STATIONS_001 is registered with catalogue and resource URLs', () => {
  const source = getCuratedSource(MTL_FIRE_STATIONS_SOURCE_ID);
  assert.ok(source);
  assert.match(source.name, /Fire Stations/i);
  assert.equal(source.category, 'where');
  assert.equal(source.trust, 'AUTHORITATIVE_PUBLIC');
  assert.equal(source.catalogueUrl, MTL_FIRE_STATIONS_CATALOGUE_URL);
  assert.equal(source.url, MTL_FIRE_STATIONS_GEOJSON_URL);
  assert.ok(listWhereSources().some((s) => s.id === MTL_FIRE_STATIONS_SOURCE_ID));
});

test('normalizeFireStationCollection and distance filter are deterministic', () => {
  const all = normalizeFireStationCollection(JSON.parse(fixture));
  assert.equal(all.length, 4);
  const stations = filterActiveFireStations(all);
  assert.equal(stations.length, 3);
  const within3km = filterStationsWithinRadius(stations, {
    ...ORIGIN,
    radiusMeters: 3000
  });
  assert.equal(within3km.length, 2);
  assert.ok(!within3km.some((station) => station.stationNumber === '79'));
  assert.ok(within3km[0].distanceMeters <= within3km[1].distanceMeters);
});

test('excludes closed fire stations with DATE_FIN before proximity filtering', () => {
  const closed = classifyOperationalStatus({
    CASERNE: '79',
    DATE_DEBUT: '1900-01-01T07:00:00',
    DATE_FIN: '2009-11-05T06:59:59',
    LATITUDE: 45.49295,
    LONGITUDE: -73.64884
  });
  assert.equal(closed.operationalStatus, 'closed');
  assert.equal(closed.isActive, false);
});

test('buildMapFromPrompt returns map result contract', async () => {
  const result = await buildMapFromPrompt(
    'Map fire stations within 3 km of 6939 Décarie Boulevard.',
    {
      geocodeFn: async () => [{
        geocoder: 'ArcGIS World GeocodeServer',
        resolvedAddress: '6939 Boul Décarie, Montréal, QC',
        latitude: ORIGIN.latitude,
        longitude: ORIGIN.longitude,
        score: 100
      }],
      fetchFn: mockFetch()
    }
  );

  assert.equal(result.supported, true);
  assert.equal(result.request.radiusMeters, 3000);
  assert.equal(result.origin.matchedAddress, '6939 Boul Décarie, Montréal, QC');
  assert.equal(result.source.authority, 'Ville de Montréal');
  assert.equal(result.summary.matchedFeatures, 2);
  assert.equal(result.features.length, 2);
  assert.ok(result.features[0].distanceMeters != null);
});

test('buildMapFromPrompt LOCATE returns locate summary', async () => {
  const result = await buildMapFromPrompt('Put a point at 997 de la Commune, Montreal.', {
    geocodeFn: async () => [{
      geocoder: 'ArcGIS World GeocodeServer',
      resolvedAddress: '997 Rue De La Commune O, Montréal, QC',
      latitude: COMMUNE.latitude,
      longitude: COMMUNE.longitude,
      score: 100
    }]
  });
  assert.equal(result.supported, true);
  assert.equal(result.request.action, 'LOCATE');
  assert.equal(result.summary.spatialOperation, 'Locate');
  assert.equal(result.summary.matchedFeatures, 1);
});

test('buildMapFromPrompt CLEAR returns clear action', async () => {
  const result = await buildMapFromPrompt('Clear the results.');
  assert.equal(result.supported, true);
  assert.equal(result.action, 'CLEAR');
});

test('POST /api/spatial/map returns unsupported for unknown prompt', async (t) => {
  const server = createServer(createPreviewState(), createPreviewConfig(), null, { preview: true }).listen(0);
  t.after(() => server.close());
  await new Promise((resolve) => server.once('listening', resolve));
  const port = server.address().port;
  const response = await postJson(port, '/api/spatial/map', {
    prompt: 'Map every tree in Canada'
  });
  assert.equal(response.status, 422);
  assert.equal(response.body.supported, false);
});

test('buildMapFromPrompt executes compound nearest police + fire within', async () => {
  const policeGeo = {
    type: 'FeatureCollection',
    features: [
      { type: 'Feature', properties: { DESC_LIEU: 'PDQ 20', LATITUDE: ORIGIN.latitude + 0.01, LONGITUDE: ORIGIN.longitude + 0.01 }, geometry: { type: 'Point', coordinates: [ORIGIN.longitude + 0.01, ORIGIN.latitude + 0.01] } },
      { type: 'Feature', properties: { DESC_LIEU: 'PDQ 21', LATITUDE: ORIGIN.latitude + 0.02, LONGITUDE: ORIGIN.longitude + 0.02 }, geometry: { type: 'Point', coordinates: [ORIGIN.longitude + 0.02, ORIGIN.latitude + 0.02] } },
      { type: 'Feature', properties: { DESC_LIEU: 'PDQ 22', LATITUDE: ORIGIN.latitude + 0.03, LONGITUDE: ORIGIN.longitude + 0.03 }, geometry: { type: 'Point', coordinates: [ORIGIN.longitude + 0.03, ORIGIN.latitude + 0.03] } },
      { type: 'Feature', properties: { DESC_LIEU: 'PDQ 23', LATITUDE: ORIGIN.latitude + 0.04, LONGITUDE: ORIGIN.longitude + 0.04 }, geometry: { type: 'Point', coordinates: [ORIGIN.longitude + 0.04, ORIGIN.latitude + 0.04] } }
    ]
  };
  const result = await buildMapFromPrompt(
    'map 3 nearest police stations and all fire stations within 4 km of 997 de la Commune',
    {
      geocodeFn: async () => [{
        geocoder: 'ArcGIS World GeocodeServer',
        resolvedAddress: '997 Rue De La Commune O, Montréal, QC',
        latitude: ORIGIN.latitude,
        longitude: ORIGIN.longitude,
        score: 100
      }],
      fetchFn: async (url) => {
        if (String(url).includes('pdq.geojson')) {
          return { ok: true, status: 200, json: async () => policeGeo };
        }
        return { ok: true, status: 200, json: async () => JSON.parse(fixture) };
      }
    }
  );
  assert.equal(result.supported, true);
  assert.equal(result.datasetResults.length, 2);
  assert.equal(result.summary.action, 'COMPOUND');
  const police = result.datasetResults.find((d) => d.datasetId === DATASET_IDS.POLICE_STATIONS);
  const fire = result.datasetResults.find((d) => d.datasetId === DATASET_IDS.FIRE_STATIONS);
  assert.equal(police?.matchedFeatures, 3);
  assert.ok(fire?.matchedFeatures >= 1);
  assert.ok(!result.features.some((f) => f.stationNumber === '79'));
});

test('POST /api/spatial/map returns fire station map result', async (t) => {
  const server = createServer(createPreviewState(), createPreviewConfig(), null, { preview: true }).listen(0);
  t.after(() => server.close());
  await new Promise((resolve) => server.once('listening', resolve));
  const port = server.address().port;

  const original = global.fetch;
  global.fetch = async (url) => {
    if (String(url).includes('findAddressCandidates')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          candidates: [{
            address: '6939 Boul Décarie, Montréal, QC',
            location: { x: ORIGIN.longitude, y: ORIGIN.latitude },
            score: 100,
            attributes: { Score: 100 }
          }]
        })
      };
    }
    if (String(url).includes('casernes.geojson')) {
      return {
        ok: true,
        status: 200,
        json: async () => JSON.parse(fixture)
      };
    }
    return original(url);
  };
  t.after(() => { global.fetch = original; });

  const response = await postJson(port, '/api/spatial/map', {
    prompt: 'Map fire stations within 3 km of 6939 Décarie Boulevard.'
  });
  assert.equal(response.status, 200);
  assert.equal(response.body.supported, true);
  assert.equal(response.body.summary.matchedFeatures, 2);
});
