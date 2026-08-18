import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import express from 'express';
import { fileURLToPath } from 'node:url';
import { createServer } from '../src/server.js';
import { createPreviewConfig, createPreviewState } from '../src/demo-map-api.js';
import { registerImageryV2Routes } from '../src/spatial-v2/imagery-routes.js';
import {
  DATE_KIND,
  DISPLAY_STATE,
  MATCH_KIND,
  PROVIDER_READINESS_STATE,
  TIME_ENGINE_LAYER_ID,
  isoDateFromCompact,
  nearestByIsoDate
} from '../public/spatial-v2/imagery/imagery-contract.js';
import {
  acquisitionFromWaybackMetadata,
  parseWaybackConfig,
  releaseDateFromWaybackTitle
} from '../public/spatial-v2/imagery/providers/esri-wayback-provider.js';
import {
  isObservationDisplayEvidenceConfirmed,
  summarizeScreenshotImageData
} from '../public/spatial-v2/imagery/time-engine.js';
import { observationTileReceipt } from '../public/spatial-v2/imagery/imagery-tile-receipt.js';
import {
  eligibleNearmapObservations,
  observationFromNearmapSurvey
} from '../public/spatial-v2/imagery/providers/nearmap-provider.js';
import {
  inspectWmsCapabilities,
  resolveNearmapWmsUrl,
  rewriteWmsCapabilities
} from '../src/spatial-v2/nearmap-wms.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const V2 = path.join(ROOT, 'public', 'spatial-v2');

function read(...parts) {
  return fs.readFileSync(path.join(V2, ...parts), 'utf8');
}

function walkFiles(dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    if (fs.statSync(full).isDirectory()) walkFiles(full, out);
    else out.push(full);
  }
  return out;
}

function request(port, urlPath) {
  return new Promise((resolve, reject) => {
    http.get(`http://127.0.0.1:${port}${urlPath}`, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        resolve({
          status: res.statusCode,
          headers: res.headers,
          body: Buffer.concat(chunks).toString('utf8')
        });
      });
    }).on('error', reject);
  });
}

function listen(app) {
  const server = app.listen(0);
  return {
    server,
    port: server.address().port,
    close: () => new Promise((resolve) => server.close(resolve))
  };
}

test('Time Engine V1 files exist and keep one MapView', () => {
  for (const rel of [
    'imagery/time-engine.js',
    'imagery/imagery-plane.js',
    'imagery/imagery-tile-receipt.js',
    'imagery/providers/esri-wayback-provider.js',
    'imagery/providers/nearmap-provider.js'
  ]) {
    assert.equal(fs.existsSync(path.join(V2, rel)), true, `missing ${rel}`);
  }
  assert.equal((read('map', 'map-foundation.js').match(/new MapView\(/g) || []).length, 1);
  assert.equal((read('imagery', 'time-engine.js').match(/new MapView\(/g) || []).length, 0);
  assert.equal(TIME_ENGINE_LAYER_ID, 'iqai-v2-imagery-time-observation');
});

test('Time Engine V1 does not use TimeSlider, view.timeExtent, or Portal writes', () => {
  const files = walkFiles(path.join(V2, 'imagery')).concat([
    path.join(V2, 'shell', 'ImageryPanel.js'),
    path.join(V2, 'shell', 'AppShell.js')
  ]);
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    assert.doesNotMatch(text, /new TimeSlider/);
    assert.doesNotMatch(text, /timeExtent\s*=/);
    assert.doesNotMatch(text, /\.save\(/);
    assert.doesNotMatch(text, /saveAs\(/);
    assert.doesNotMatch(text, /portalItem\.update/);
  }
  const engine = read('imagery', 'time-engine.js');
  assert.match(engine, /discoverImageryTime/);
  assert.match(engine, /activateObservation/);
  assert.match(engine, /deactivateObservation/);
  assert.match(engine, /IMAGERY_POOL\.HISTORY && collected.length/);
  assert.match(engine, /GROUND_MODE\.AUTHORED_WEBMAP/);
  assert.match(engine, /previousObservation/);
  assert.match(engine, /nextObservation/);
  assert.match(engine, /TIME_ENGINE_LAYER_ID/);
  assert.match(engine, /replaceTimeLayer\(previous\)/);
  assert.match(engine, /layers\.add/);
  assert.match(engine, /Time observation was not attached to the imagery plane/);
  assert.match(engine, /DISPLAY_CONFIRMED/);
  assert.match(engine, /displayConfirmed/);
  assert.match(engine, /ImageData/);
  assert.match(engine, /bindLayer/);
  assert.match(engine, /suspendEmptyIqaiPlanes/);
  assert.match(engine, /observationTileReceipt/);
  assert.match(engine, /layers: \[layer\]/);
  assert.match(engine, /mapview-layer-isolated-screenshot-v1/);
  assert.doesNotMatch(engine, /Time observation settlement timed out/);
  assert.equal(DISPLAY_STATE.SELECTED, 'SELECTED');
  assert.equal(DISPLAY_STATE.ACTIVATED, 'ACTIVATED');
  assert.equal(DISPLAY_STATE.LAYER_ATTACHED, 'LAYER_ATTACHED');
  assert.equal(DISPLAY_STATE.LAYER_LOADED, 'LAYER_LOADED');
  assert.equal(DISPLAY_STATE.DISPLAY_CONFIRMED, 'DISPLAY_CONFIRMED');
  const plane = read('imagery', 'imagery-plane.js');
  assert.match(plane, /TIME_ENGINE_LAYER_ID/);
  assert.match(plane, /WebTileLayer/);
  assert.match(plane, /webmap\.layers\.add\(observationLayer\)/);
  assert.doesNotMatch(plane, /layers: \[observationLayer\]/);
});

test('Wayback display confirmation requires release-specific network and isolated painted pixels', () => {
  const width = 40;
  const height = 40;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    const value = Math.floor((i / 4) / 4) % 2 === 0 ? 20 : 220;
    data[i] = value;
    data[i + 1] = value;
    data[i + 2] = value;
    data[i + 3] = 255;
  }
  const screenshot = summarizeScreenshotImageData({ width, height, data });
  assert.equal(screenshot.opaquePixelCount, 400);
  assert.equal(screenshot.opaqueShare, 1);
  assert.equal(screenshot.contrast, 200);

  const observation = {
    id: 'wayback:26334',
    providerId: 'esri-wayback',
    sourceIdentity: { releaseNum: 26334 }
  };
  const network = observationTileReceipt(observation, {
    sinceStartTime: 5,
    entries: [
      {
        name: 'https://wayback.maptiles.arcgis.com/x/tile/26334/12/1/2',
        startTime: 10,
        responseStatus: 200,
        transferSize: 2048,
        encodedBodySize: 1800
      },
      {
        name: 'https://wayback.maptiles.arcgis.com/x/tile/8249/12/1/2',
        startTime: 11,
        responseStatus: 200
      },
      {
        name: 'https://wayback.maptiles.arcgis.com/x/tile/26334/12/1/3',
        startTime: 1,
        responseStatus: 200
      }
    ]
  });
  assert.equal(network.resourceTimingEntryCount, 1);
  assert.deepEqual(network.responseStatuses, { 200: 1 });

  const evidence = {
    observationActive: true,
    layerAttached: true,
    layer: {
      visible: true,
      opacity: 1,
      parentChainVisible: true,
      urlMatchesObservation: true
    },
    layerView: {
      ready: true,
      visible: true,
      visibleAtCurrentScale: true,
      suspended: false,
      updating: false
    },
    view: { ready: true, stationary: true },
    network,
    screenshot
  };
  assert.equal(isObservationDisplayEvidenceConfirmed(evidence), true);
  assert.equal(
    isObservationDisplayEvidenceConfirmed({
      ...evidence,
      network: { ...network, resourceTimingEntryCount: 0 }
    }),
    false
  );
  assert.equal(
    isObservationDisplayEvidenceConfirmed({
      ...evidence,
      layerView: { ...evidence.layerView, updating: true }
    }),
    true
  );
  assert.equal(
    isObservationDisplayEvidenceConfirmed({
      ...evidence,
      layerView: { ...evidence.layerView, suspended: true }
    }),
    false
  );
  assert.equal(
    isObservationDisplayEvidenceConfirmed({
      ...evidence,
      screenshot: { ...screenshot, opaquePixelCount: 0, opaqueShare: 0 }
    }),
    false
  );
});

test('Wayback releaseDate is not copied onto acquisitionDate', () => {
  const config = {
    '26334': {
      itemTitle: 'World Imagery (Wayback 2026-08-05)',
      itemURL: 'https://wayback.maptiles.arcgis.com/arcgis/rest/services/World_Imagery/WMTS/1.0.0/default028mm/MapServer/tile/26334/{level}/{row}/{col}',
      metadataLayerUrl: 'https://metadata.maptiles.arcgis.com/arcgis/rest/services/World_Imagery_Metadata_2026_r07/MapServer',
      layerIdentifier: 'WB_2026_R07'
    }
  };
  const releases = parseWaybackConfig(config);
  assert.equal(releases.length, 1);
  assert.equal(releases[0].releaseDate, '2026-08-05');
  assert.equal(releaseDateFromWaybackTitle(config['26334'].itemTitle), '2026-08-05');
  const wayback = read('imagery', 'providers', 'esri-wayback-provider.js');
  assert.match(wayback, /acquisitionDate: null/);
  assert.match(wayback, /matchDate: null/);
  assert.doesNotMatch(wayback, /matchDate: release\.releaseDate/);
  assert.doesNotMatch(wayback, /acquisitionDate:\s*releaseDate/);
  assert.doesNotMatch(wayback, /acquisitionDate:\s*release\.releaseDate/);
  assert.equal(acquisitionFromWaybackMetadata({ SRC_DATE: 20140520 }), '2014-05-20');
  assert.equal(acquisitionFromWaybackMetadata({ SRC_DATE2: '2014-05-20T00:00:00Z' }), '2014-05-20');
  assert.equal(acquisitionFromWaybackMetadata({ ReleaseName: 'WB_2014_R01' }), null);
  assert.equal(isoDateFromCompact(20140520), '2014-05-20');
});

test('Nearmap client never embeds the key or upstream tile host', () => {
  const client = read('imagery', 'providers', 'nearmap-provider.js');
  const ground = read('imagery', 'providers', 'nearmap-wms-ground-provider.js');
  const engine = read('imagery', 'time-engine.js');
  const panel = read('shell', 'ImageryPanel.js');
  for (const text of [client, ground, engine, panel]) {
    assert.doesNotMatch(text, /NEARMAP_API_KEY/);
    assert.doesNotMatch(text, /NEARMAP_WMS_URL/);
    assert.doesNotMatch(text, /api\.nearmap\.com/);
    assert.doesNotMatch(text, /apikey=/i);
  }
  assert.match(client, /\/api\/spatial-v2\/imagery\/nearmap\/coverage/);
  assert.match(client, /\/api\/spatial-v2\/imagery\/nearmap\/tiles\//);
  assert.match(ground, /\/api\/spatial-v2\/imagery\/nearmap\/wms/);
  const observation = observationFromNearmapSurvey({
    id: 'survey-1',
    captureDate: '2022-06-15',
    firstPublicDate: '2022-06-20'
  });
  assert.equal(observation.acquisitionDate, '2022-06-15');
  assert.equal(observation.matchDate, '2022-06-15');
  assert.equal(observation.firstPublicDate, '2022-06-20');
  assert.equal(observation.dateKindUsed, DATE_KIND.ACQUISITION);
  assert.equal(eligibleNearmapObservations([
    { id: 'survey-1', captureDate: '2022-06-15' },
    { id: 'undated-survey' },
    { captureDate: '2022-06-16' }
  ]).length, 1);
  const matched = nearestByIsoDate([observation], '2022-06-18', 'matchDate');
  assert.equal(matched.match, MATCH_KIND.NEAREST);
  assert.equal(matched.deltaDays, -3);
});

test('Nearmap proxy is entitlement-gated and does not leak the key', async () => {
  const missingApp = express();
  registerImageryV2Routes(missingApp, { env: {} });
  const missing = listen(missingApp);
  try {
    const res = await request(missing.port, '/api/spatial-v2/imagery/nearmap/coverage?aoi=point&longitude=-73.5&latitude=45.5');
    assert.equal(res.status, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.entitlement, 'entitlement-missing');
    assert.equal(body.readinessState, PROVIDER_READINESS_STATE.NOT_CONFIGURED);
    assert.deepEqual(body.surveys, []);
    assert.equal(JSON.stringify(body).includes('secret-key'), false);
  } finally {
    await missing.close();
  }

  const calls = [];
  const gatedApp = express();
  registerImageryV2Routes(gatedApp, {
    env: { NEARMAP_API_KEY: 'secret-key' },
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), hasAuth: Boolean(init?.headers?.Authorization) });
      assert.equal(String(init?.headers?.Authorization || '').includes('secret-key'), true);
      if (String(url).includes('/coverage/v2/')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ surveys: [], total: 0 })
        };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    }
  });
  const gated = listen(gatedApp);
  try {
    const empty = await request(gated.port, '/api/spatial-v2/imagery/nearmap/coverage?aoi=point&longitude=-73.5&latitude=45.5');
    assert.equal(empty.status, 200);
    const emptyBody = JSON.parse(empty.body);
    assert.equal(emptyBody.entitlement, 'ready');
    assert.equal(emptyBody.readinessState, PROVIDER_READINESS_STATE.NO_COVERAGE);
    assert.deepEqual(emptyBody.surveys, []);
    assert.equal(empty.body.includes('secret-key'), false);
    assert.equal(calls.length, 1);
  } finally {
    await gated.close();
  }

  const deniedApp = express();
  registerImageryV2Routes(deniedApp, {
    env: { NEARMAP_API_KEY: 'secret-key' },
    fetchImpl: async () => ({ ok: false, status: 403, json: async () => ({ error: 'nope' }) })
  });
  const denied = listen(deniedApp);
  try {
    const res = await request(denied.port, '/api/spatial-v2/imagery/nearmap/coverage?aoi=point&longitude=-73.5&latitude=45.5');
    assert.equal(res.status, 403);
    const body = JSON.parse(res.body);
    assert.equal(body.entitlement, 'denied');
    assert.equal(body.readinessState, PROVIDER_READINESS_STATE.ENTITLEMENT_REQUIRED);
    assert.deepEqual(body.surveys, []);
    assert.equal(res.body.includes('secret-key'), false);
  } finally {
    await denied.close();
  }
});

test('official Google Map Tiles readiness is server-side and never overstates runtime readiness', async () => {
  const missingApp = express();
  registerImageryV2Routes(missingApp, { env: {} });
  const missing = listen(missingApp);
  try {
    const response = await request(missing.port, '/api/spatial-v2/imagery/google/status');
    assert.equal(response.status, 200);
    const body = JSON.parse(response.body);
    assert.equal(body.readinessState, PROVIDER_READINESS_STATE.NOT_CONFIGURED);
    assert.equal(body.configured, false);
    assert.equal(body.runtimeIntegrated, false);
  } finally {
    await missing.close();
  }

  const acceptedApp = express();
  registerImageryV2Routes(acceptedApp, {
    env: { GOOGLE_MAP_TILES_API_KEY: 'server-secret' },
    fetchImpl: async (url, init) => {
      assert.match(String(url), /^https:\/\/tile\.googleapis\.com\/v1\/createSession\?key=/);
      assert.equal(init?.method, 'POST');
      assert.equal(JSON.parse(init?.body || '{}').mapType, 'satellite');
      return {
        ok: true,
        status: 200,
        json: async () => ({ session: 'session-token', expiry: '9999999999' })
      };
    }
  });
  const accepted = listen(acceptedApp);
  try {
    const response = await request(accepted.port, '/api/spatial-v2/imagery/google/status');
    assert.equal(response.status, 200);
    const body = JSON.parse(response.body);
    assert.equal(body.entitlement, 'ready');
    assert.equal(body.credentialUsable, true);
    assert.equal(body.runtimeIntegrated, false);
    assert.equal(body.readinessState, PROVIDER_READINESS_STATE.UNAVAILABLE);
    assert.equal(response.body.includes('server-secret'), false);
    assert.equal(response.body.includes('session-token'), false);
  } finally {
    await accepted.close();
  }

  const deniedApp = express();
  registerImageryV2Routes(deniedApp, {
    env: { GOOGLE_MAP_TILES_API_KEY: 'server-secret' },
    fetchImpl: async () => ({ ok: false, status: 403, json: async () => ({}) })
  });
  const denied = listen(deniedApp);
  try {
    const response = await request(denied.port, '/api/spatial-v2/imagery/google/status');
    const body = JSON.parse(response.body);
    assert.equal(body.readinessState, PROVIDER_READINESS_STATE.ENTITLEMENT_REQUIRED);
    assert.equal(body.credentialUsable, false);
  } finally {
    await denied.close();
  }
});

test('preview server proxies Wayback config and Nearmap entitlement-missing', async () => {
  const app = createServer(createPreviewState(), createPreviewConfig(), null, { preview: true });
  const server = app.listen(0);
  const port = server.address().port;
  try {
    const wayback = await request(port, '/api/spatial-v2/imagery/wayback/config');
    assert.equal(wayback.status, 200);
    const config = JSON.parse(wayback.body);
    const releases = parseWaybackConfig(config);
    assert.ok(releases.length > 0);
    assert.ok(releases.some((item) => item.releaseDate));
    assert.ok(releases.every((item) => item.itemURL));
    const coverage = await request(port, '/api/spatial-v2/imagery/nearmap/coverage?probe=1');
    const coverageBody = JSON.parse(coverage.body);
    assert.ok(['entitlement-missing', 'ready'].includes(coverageBody.entitlement));
    if (coverageBody.entitlement === 'entitlement-missing') {
      assert.deepEqual(coverageBody.surveys, []);
    }
    const client = await request(port, '/spatial-v2/imagery/time-engine.js');
    assert.equal(client.status, 200);
    assert.match(client.body, /discoverImageryTime/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

const FAKE_NEARMAP_WMS = 'https://api.nearmap.com/wms/v1/latest/apikey/00000000-0000-4000-8000-000000000000';
const FAKE_WMS_CAPABILITIES = `<?xml version="1.0" encoding="UTF-8"?>
<WMT_MS_Capabilities version="1.1.1" updateSequence="2026-08-17T04:01:15Z">
  <Service>
    <Name>OGC:WMS</Name>
    <Title>Nearmap WMS Server</Title>
    <AccessConstraints>See web site for license constraints.</AccessConstraints>
  </Service>
  <Capability>
    <Request>
      <GetMap>
        <DCPType><HTTP><Get>
          <OnlineResource xlink:href="${FAKE_NEARMAP_WMS}" />
        </Get></HTTP></DCPType>
      </GetMap>
    </Request>
    <Layer>
      <Name>Nearmap WMS</Name>
      <Title>Nearmap WMS</Title>
      <SRS>EPSG:3857</SRS>
      <SRS>EPSG:4326</SRS>
      <Layer>
        <Name>Nearmap</Name>
        <Title>Nearmap</Title>
        <Layer>
          <Name>Nearmap/Nearmap/Canada</Name>
          <Title>Canada latest</Title>
        </Layer>
      </Layer>
      <Layer>
        <Name>Satellite</Name>
        <Title>Satellite</Title>
      </Layer>
    </Layer>
  </Capability>
</WMT_MS_Capabilities>`;

test('Nearmap latest WMS is classified as current ground, not Time Engine history', () => {
  assert.equal(resolveNearmapWmsUrl({}), null);
  assert.equal(resolveNearmapWmsUrl({ NEARMAP_WMS_URL: FAKE_NEARMAP_WMS, NEARMAP_API_KEY: 'other-key' }), FAKE_NEARMAP_WMS);
  const inspected = inspectWmsCapabilities(FAKE_WMS_CAPABILITIES);
  assert.equal(inspected.serviceType, 'WMS');
  assert.equal(inspected.version, '1.1.1');
  assert.equal(inspected.timeDimension, false);
  assert.equal(inspected.tileMatrixSet, false);
  assert.deepEqual(inspected.datedLayerNames, []);
  assert.ok(inspected.layers.includes('Nearmap'));
  assert.ok(inspected.latestTitles.includes('Canada latest'));
  const rewritten = rewriteWmsCapabilities(
    FAKE_WMS_CAPABILITIES,
    'http://127.0.0.1/api/spatial-v2/imagery/nearmap/wms'
  );
  assert.match(rewritten, /http:\/\/127\.0\.0\.1\/api\/spatial-v2\/imagery\/nearmap\/wms/);
  assert.equal(rewritten.includes('00000000-0000-4000-8000-000000000000'), false);
  assert.doesNotMatch(rewritten, /api\.nearmap\.com\/wms/);
});

test('Nearmap latest WMS proxy rewrites capabilities and does not require NEARMAP_API_KEY', async () => {
  const missingApp = express();
  registerImageryV2Routes(missingApp, { env: {} });
  const missing = listen(missingApp);
  try {
    const status = await request(missing.port, '/api/spatial-v2/imagery/nearmap/wms/status');
    assert.equal(status.status, 200);
    const statusBody = JSON.parse(status.body);
    assert.equal(statusBody.entitlement, 'entitlement-missing');
    assert.equal(statusBody.readinessState, PROVIDER_READINESS_STATE.NOT_CONFIGURED);
    const proxied = await request(missing.port, '/api/spatial-v2/imagery/nearmap/wms?SERVICE=WMS&REQUEST=GetCapabilities');
    assert.equal(proxied.status, 503);
  } finally {
    await missing.close();
  }

  const app = express();
  registerImageryV2Routes(app, {
    env: { NEARMAP_WMS_URL: FAKE_NEARMAP_WMS },
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      headers: { get: (name) => (name === 'content-type' ? 'application/vnd.ogc.wms_xml' : null) },
      text: async () => FAKE_WMS_CAPABILITIES,
      arrayBuffer: async () => new TextEncoder().encode(FAKE_WMS_CAPABILITIES)
    })
  });
  const server = listen(app);
  try {
    const status = await request(server.port, '/api/spatial-v2/imagery/nearmap/wms/status');
    assert.equal(status.status, 200);
    const statusBody = JSON.parse(status.body);
    assert.equal(statusBody.entitlement, 'ready');
    assert.equal(statusBody.readinessState, PROVIDER_READINESS_STATE.READY);
    assert.equal(statusBody.historical, false);
    assert.equal(statusBody.timeDimension, false);
    assert.equal(statusBody.defaultLayer, 'Nearmap');
    assert.equal(status.body.includes('00000000-0000-4000-8000-000000000000'), false);
    const caps = await request(server.port, '/api/spatial-v2/imagery/nearmap/wms?SERVICE=WMS&REQUEST=GetCapabilities');
    assert.equal(caps.status, 200);
    assert.match(caps.body, /\/api\/spatial-v2\/imagery\/nearmap\/wms/);
    assert.equal(caps.body.includes('00000000-0000-4000-8000-000000000000'), false);
    assert.doesNotMatch(caps.body, /api\.nearmap\.com\/wms/);
    const jpegCalls = [];
    const jpegApp = express();
    registerImageryV2Routes(jpegApp, {
      env: { NEARMAP_WMS_URL: FAKE_NEARMAP_WMS },
      fetchImpl: async (url) => {
        jpegCalls.push(String(url));
        return {
          ok: true,
          status: 200,
          headers: { get: (name) => (name === 'content-type' ? 'image/jpeg' : null) },
          arrayBuffer: async () => Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]).buffer
        };
      }
    });
    const jpegServer = listen(jpegApp);
    try {
      const mapped = await request(jpegServer.port, '/api/spatial-v2/imagery/nearmap/wms?SERVICE=WMS&REQUEST=GetMap&FORMAT=image/jpg&LAYERS=Nearmap');
      assert.equal(mapped.status, 200);
      assert.match(jpegCalls[0], /FORMAT=image%2Fjpeg/);
    } finally {
      await jpegServer.close();
    }
  } finally {
    await server.close();
  }
});

test('Time Engine HUD and .env.example keep Nearmap server-side', () => {
  const panel = read('shell', 'ImageryPanel.js');
  const example = fs.readFileSync(path.join(ROOT, '.env.example'), 'utf8');
  assert.match(panel, /TIME MACHINE/);
  assert.match(panel, /data-iqai-time-action="discover"/);
  assert.match(panel, /data-iqai-time-action="activate"/);
  assert.match(panel, /data-iqai-time-action="previous"/);
  assert.match(example, /^GOOGLE_MAP_TILES_API_KEY=$/m);
  assert.match(example, /^NEARMAP_API_KEY=$/m);
  assert.match(example, /^NEARMAP_WMS_URL=$/m);
  assert.match(example, /server-side only/);
});
