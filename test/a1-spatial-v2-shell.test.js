import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from '../src/server.js';
import { createPreviewConfig, createPreviewState } from '../src/demo-map-api.js';
import {
  ASK_QUICK_ACTIONS,
  HEADER_STATUS_SLOTS,
  INSPECTOR_REGIONS,
  PLUGIN_SLOTS,
  PRIMARY_CAPABILITY_SLOTS,
  SHELL_SLOT_IDS,
  SHELL_SLOTS
} from '../public/spatial-v2/shell/layout-registry.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const V2_DIR = path.join(ROOT, 'public', 'spatial-v2');
const V1_INDEX = path.join(ROOT, 'public', 'spatial', 'index.html');

const REQUIRED_V2_FILES = [
  'index.html',
  'spatial-v2.js',
  'iqai-spatial-v2.css',
  'shell/layout-registry.js',
  'shell/AppShell.js',
  'shell/CommandHeader.js',
  'shell/CapabilityRail.js',
  'shell/MapStage.js',
  'shell/ContextInspector.js',
  'shell/AskIqaiDock.js',
  'shell/ask-capability-bus.js',
  'shell/command-center-state.js',
  'shell/GooglePhotorealistic3dControl.js',
  'shell/OperatorImageryExperience.js',
  'shell/WhatAmILookingAt.js'
];

const REQUIRED_SLOTS = [
  'command-header',
  'capability-rail',
  'map-stage',
  'context-inspector',
  'situation-slot',
  'selected-object-slot',
  'evidence-slot',
  'provenance-slot',
  'execution-receipt-slot',
  'ask-iqai-dock',
  'build-slot'
];

const V1_CAPABILITY_MARKERS = [
  'spatial-arcgis-runtime',
  'spatial-map-command',
  'point-intelligence-service',
  'point-intelligence-control',
  'open-world-intelligence-control',
  'local-vision',
  'openai',
  'gemma',
  '/api/spatial/ai-map',
  '/api/spatial/point-intelligence',
  '/api/spatial/local-vision',
  'spatial-capability-router'
];

function readV2(...parts) {
  return fs.readFileSync(path.join(V2_DIR, ...parts), 'utf8');
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

test('V2 shell files exist as a separate tree', () => {
  for (const rel of REQUIRED_V2_FILES) {
    assert.equal(fs.existsSync(path.join(V2_DIR, rel)), true, `missing ${rel}`);
  }
});

test('V2 shell exposes stable semantic slot identities', () => {
  assert.deepEqual([...SHELL_SLOT_IDS].sort(), [...REQUIRED_SLOTS].sort());
  const sources = [
    readV2('shell', 'layout-registry.js'),
    readV2('shell', 'CommandHeader.js'),
    readV2('shell', 'CapabilityRail.js'),
    readV2('shell', 'MapStage.js'),
    readV2('shell', 'ContextInspector.js'),
    readV2('shell', 'AskIqaiDock.js')
  ].join('\n');
  for (const slot of REQUIRED_SLOTS) {
    assert.match(sources, new RegExp(`data-iqai-slot="${slot}"|slot: '${slot}'`));
  }
  assert.equal(SHELL_SLOTS.buildSlot.slot, 'build-slot');
  assert.equal(PRIMARY_CAPABILITY_SLOTS.find((item) => item.id === 'build')?.slot, 'build-slot');
});

test('V2 shell reserves primary capabilities and plugin real estate', () => {
  const ids = PRIMARY_CAPABILITY_SLOTS.map((item) => item.id);
  assert.deepEqual(ids, ['map', 'point', 'intelligence', 'vision', 'build']);
  assert.equal(PRIMARY_CAPABILITY_SLOTS[0].shortLabel, 'MAP');
  assert.equal(PRIMARY_CAPABILITY_SLOTS[1].displayLabel, 'POINT INTELLIGENCE');
  assert.equal(PRIMARY_CAPABILITY_SLOTS[2].displayLabel, 'OPEN-WORLD INTELLIGENCE');
  assert.equal(PRIMARY_CAPABILITY_SLOTS[3].shortLabel, 'VISION');
  assert.equal(PRIMARY_CAPABILITY_SLOTS[4].shortLabel, 'BUILD');
  assert.match(PRIMARY_CAPABILITY_SLOTS[4].description, /Create maps, instruments and temporary apps/);
  assert.deepEqual(PLUGIN_SLOTS.map((item) => item.displayLabel), [
    'DATA & LAYERS',
    'IMAGERY',
    'DOCUMENTS'
  ]);
  assert.ok(readV2('shell', 'CapabilityRail.js').includes('data-iqai-plugin-host="capability-rail"'));
});

test('V2 shell keeps Ask IQAI as the single front door', () => {
  const dock = readV2('shell', 'AskIqaiDock.js');
  assert.match(dock, /ASK IQAI/);
  assert.match(dock, /Ask a question or describe what you want to build/);
  assert.deepEqual(ASK_QUICK_ACTIONS.map((item) => item.label), [
    'MAP',
    'IMAGERY',
    'ANALYZE',
    'INTELLIGENCE',
    'VISION',
    'BUILD'
  ]);
  assert.equal(dock.includes('Map Command'), false);
  assert.equal(dock.includes('AI MAP'), false);
  assert.equal(dock.includes('Local Vision'), false);
});

test('V2 CSS is namespaced and does not restyle V1 classes', () => {
  const css = readV2('iqai-spatial-v2.css');
  assert.match(css, /#iqai-spatial-v2/);
  assert.match(css, /\.iqai-v2-/);
  assert.equal(css.includes('.spatial-app'), false);
  assert.equal(css.includes('iqai-spatial-shell'), false);
});

test('V2 shell does not migrate V1 capabilities or fake live connections', () => {
  const files = walkFiles(V2_DIR);
  assert.ok(files.length > 0);
  const shellLanguageFiles = files.filter((file) => {
    const rel = path.relative(V2_DIR, file).replaceAll('\\', '/');
    return !rel.startsWith('imagery/');
  });
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    for (const marker of V1_CAPABILITY_MARKERS) {
      assert.equal(text.toLowerCase().includes(marker.toLowerCase()), false, `${file} contains ${marker}`);
    }
  }
  for (const file of shellLanguageFiles) {
    const text = fs.readFileSync(file, 'utf8');
    assert.equal(/\bCONNECTED\b/.test(text.replaceAll('NOT CONNECTED', '')), false, `${file} presents a connected state`);
    assert.doesNotMatch(text, />\s*ONLINE\s*</i);
    assert.doesNotMatch(text, /healthy|live telemetry/i);
  }
  const values = HEADER_STATUS_SLOTS.map((item) => item.value);
  assert.ok(values.includes('NOT CONNECTED'));
  assert.ok(values.includes('RESERVED'));
  assert.ok(values.includes('SHELL ONLY'));
  assert.equal(INSPECTOR_REGIONS.length, 5);
});

test('V1 spatial index remains a separate surface', () => {
  const v1 = fs.readFileSync(V1_INDEX, 'utf8');
  assert.match(v1, /src="\/spatial\/spatial\.js"/);
  assert.match(v1, /IQAI Spatial — Intelligence/);
  assert.equal(v1.includes('/spatial-v2/'), false);
  assert.equal(v1.includes('iqai-spatial-v2'), false);
  const v2 = readV2('index.html');
  assert.match(v2, /src="\/spatial-v2\/spatial-v2\.js"/);
  assert.match(v2, /href="\/spatial-v2\/iqai-spatial-v2\.css"/);
  assert.equal(v2.includes('/spatial/spatial.js'), false);
  assert.equal(v2.includes('spatial-arcgis-runtime'), false);
});

test('preview server serves /spatial and /spatial-v2 independently', async () => {
  const app = createServer(createPreviewState(), createPreviewConfig(), null, { preview: true });
  const server = app.listen(0);
  const port = server.address().port;
  try {
    const v1 = await request(port, '/spatial/');
    const v1Index = await request(port, '/spatial/index.html');
    const v2 = await request(port, '/spatial-v2/');
    const v2Index = await request(port, '/spatial-v2/index.html');
    const v2Css = await request(port, '/spatial-v2/iqai-spatial-v2.css');
    const v2Js = await request(port, '/spatial-v2/spatial-v2.js');
    const v2Shell = await request(port, '/spatial-v2/shell/layout-registry.js');

    assert.equal(v1.status, 200);
    assert.equal(v1Index.status, 200);
    assert.match(v1.body, /\/spatial\/spatial\.js/);
    assert.match(v1.body, /IQAI Spatial — Intelligence/);
    assert.equal(v1.body.includes('iqai-spatial-v2'), false);

    assert.equal(v2.status, 200);
    assert.equal(v2Index.status, 200);
    assert.equal(v2Css.status, 200);
    assert.equal(v2Js.status, 200);
    assert.equal(v2Shell.status, 200);
    assert.match(v2.body, /id="iqai-spatial-v2"/);
    assert.match(v2.body, /\/spatial-v2\/spatial-v2\.js/);
    assert.equal(v2.body.includes('/spatial/spatial.js'), false);
    assert.match(v2Css.body, /\.iqai-v2-app/);
    assert.match(v2Js.body, /mountCommandCenter/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
