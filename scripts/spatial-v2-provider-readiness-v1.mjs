import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'artifacts', 'spatial-v2-provider-readiness-v1');
const BASE = process.env.SPATIAL_URL?.replace(/\/$/, '') || 'http://127.0.0.1:3000';

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  for (const line of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const index = trimmed.indexOf('=');
    if (index <= 0) continue;
    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim();
    if (!process.env[key]) process.env[key] = value;
  }
}

loadEnvFile(path.join(ROOT, '.env'));

function findBrowser() {
  return [
    process.env.EDGE_PATH,
    process.env.CHROME_PATH,
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
  ].filter(Boolean).find((candidate) => fs.existsSync(candidate)) || null;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForJson(url, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(2000) });
      if (response.ok) return response.json();
    } catch {
      // Browser is still starting.
    }
    await sleep(250);
  }
  throw new Error(`Timed out waiting for ${url}`);
}

async function fetchPreauthToken() {
  const username = process.env.ARCGIS_USERNAME;
  const password = process.env.ARCGIS_PASSWORD;
  const portal = (process.env.ARCGIS_PORTAL_URL || 'https://www.arcgis.com').replace(/\/$/, '');
  if (!username || !password) return null;
  try {
    const params = new URLSearchParams({
      username,
      password,
      client: 'requestip',
      expiration: '60',
      f: 'json'
    });
    const response = await fetch(`${portal}/sharing/rest/generateToken`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
      signal: AbortSignal.timeout(12000)
    });
    const payload = await response.json().catch(() => ({}));
    if (!payload.token) return null;
    return {
      token: payload.token,
      expires: payload.expires
        ? (Number(payload.expires) > 1e12 ? Number(payload.expires) : Number(payload.expires) * 1000)
        : Date.now() + 3600000
    };
  } catch {
    return null;
  }
}

function secretSafeProviderResponse(payload) {
  if (!payload || typeof payload !== 'object') return payload;
  if (Array.isArray(payload)) return payload.map(secretSafeProviderResponse);
  return Object.fromEntries(Object.entries(payload).map(([key, value]) => [
    key,
    /key|apikey|token|password|secret/i.test(key)
      ? '[redacted]'
      : secretSafeProviderResponse(value)
  ]));
}

async function providerJson(pathname) {
  try {
    const response = await fetch(`${BASE}${pathname}`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(30000)
    });
    return {
      status: response.status,
      body: secretSafeProviderResponse(await response.json().catch(() => ({})))
    };
  } catch (error) {
    return { status: null, body: null, error: String(error?.message || error) };
  }
}

async function withPage(browserPath, debugPort, run) {
  fs.mkdirSync(OUT, { recursive: true });
  const userDataDir = fs.mkdtempSync(path.join(OUT, 'browser-'));
  const child = spawn(browserPath, [
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${userDataDir}`,
    '--window-size=1600,900',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
    '--enable-webgl',
    '--ignore-gpu-blocklist',
    'about:blank'
  ], { stdio: 'ignore' });
  let ws;
  try {
    await waitForJson(`http://127.0.0.1:${debugPort}/json/version`);
    let target = null;
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const targets = await waitForJson(`http://127.0.0.1:${debugPort}/json/list`);
      target = targets.find((item) => item.type === 'page' && item.webSocketDebuggerUrl) || null;
      if (target) break;
      await sleep(250);
    }
    if (!target) throw new Error('No browser page target was available.');
    ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('CDP websocket timed out')), 8000);
      ws.once('open', () => {
        clearTimeout(timer);
        resolve();
      });
      ws.once('error', reject);
    });

    let id = 0;
    const pending = new Map();
    const network = [];
    ws.on('message', (raw) => {
      const message = JSON.parse(raw.toString());
      if (message.id && pending.has(message.id)) {
        const entry = pending.get(message.id);
        pending.delete(message.id);
        clearTimeout(entry.timer);
        if (message.error) entry.reject(new Error(JSON.stringify(message.error)));
        else entry.resolve(message.result);
      }
      if (message.method === 'Network.responseReceived') {
        const response = message.params?.response;
        if (response?.url) {
          network.push({
            url: response.url,
            status: response.status,
            mimeType: response.mimeType || null
          });
        }
      }
    });
    const send = (method, params = {}, timeoutMs = 60000) => new Promise((resolve, reject) => {
      id += 1;
      const messageId = id;
      const timer = setTimeout(() => {
        pending.delete(messageId);
        reject(new Error(`${method} timed out`));
      }, timeoutMs);
      pending.set(messageId, { resolve, reject, timer });
      ws.send(JSON.stringify({ id: messageId, method, params }));
    });
    await send('Page.enable');
    await send('Runtime.enable');
    await send('Network.enable');
    const result = await run(send);
    return { ...result, network };
  } finally {
    try {
      ws?.close();
    } catch {
      // Already closed.
    }
    try {
      child.kill();
    } catch {
      // Already exited.
    }
    if (child.pid) {
      spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    }
    await sleep(500);
    try {
      fs.rmSync(userDataDir, { recursive: true, force: true });
    } catch {
      // Browser profile can remain locked briefly.
    }
  }
}

async function evaluate(send, expression, awaitPromise = false, timeoutMs = 60000) {
  const result = await send('Runtime.evaluate', {
    expression,
    awaitPromise,
    returnByValue: true
  }, timeoutMs);
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description || 'Runtime evaluation failed');
  }
  return result.result?.value;
}

const browserPath = findBrowser();
if (!browserPath) throw new Error('Edge or Chrome was not found.');

const [google, nearmapWms, nearmapCoverage] = await Promise.all([
  providerJson('/api/spatial-v2/imagery/google/status'),
  providerJson('/api/spatial-v2/imagery/nearmap/wms/status'),
  providerJson('/api/spatial-v2/imagery/nearmap/coverage?probe=1')
]);
const preauth = await fetchPreauthToken();

const live = await withPage(browserPath, 9273, async (send) => {
  if (preauth) {
    await send('Page.addScriptToEvaluateOnNewDocument', {
      source: `window.__MONTREAL_PREAUTH_TOKEN = ${JSON.stringify(preauth)};`
    });
  }
  await send('Page.addScriptToEvaluateOnNewDocument', {
    source: `(function() {
      const original = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function(type, attrs) {
        if (type === 'webgl' || type === 'webgl2' || type === 'experimental-webgl') {
          attrs = Object.assign({}, attrs || {}, { preserveDrawingBuffer: true });
        }
        return original.call(this, type, attrs);
      };
    })();`
  });
  await send('Page.navigate', { url: `${BASE}/spatial-v2/?provider-readiness=v1` });
  let ready = false;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    ready = await evaluate(
      send,
      `Boolean(window.__iqaiSpatialV2?.setGroundMode
        && window.__iqaiSpatialV2?.mapFoundation?.getState?.() === 'READY')`
    ).catch(() => false);
    if (ready) break;
    await sleep(500);
  }
  if (!ready) return { ready: false, error: 'Spatial V2 did not become ready.' };
  console.error('[readiness] map ready');
  await evaluate(send, `window.__iqaiSpatialV2.mapFoundation.goHome().then(() => true)`, true, 20000)
    .catch(() => false);
  console.error('[readiness] home done');
  await sleep(1000);
  const originalLayer = await evaluate(send, `(() => {
    const map = window.__iqaiSpatialV2.mapFoundation.getWebMap();
    const layer = map?.allLayers?.find?.((item) => item?.id === '19fdca1f24c-layer-4');
    if (!layer) return { found: false };
    return {
      found: true,
      id: layer.id,
      title: layer.title,
      type: layer.type,
      version: layer.version || null,
      loadStatus: layer.loadStatus || null,
      parentTitle: layer.parent?.title || null,
      parentType: layer.parent?.declaredClass || layer.parent?.type || null,
      topLevel: !layer.parent || layer.parent === map,
      parentVisible: layer.parent?.visible === true,
      visible: layer.visible === true,
      visibleLayers: Array.isArray(layer.visibleLayers) ? layer.visibleLayers : [],
      sublayers: layer.sublayers?.toArray ? layer.sublayers.toArray().map((item) => item.name) : []
    };
  })()`);
  console.error('[readiness] authored layer inspected', originalLayer?.found, originalLayer?.title);
  const before = await evaluate(send, `(() => ({
    ground: window.__iqaiSpatialV2.ground(),
    mapViewCreateCount: window.__iqaiSpatialV2.mapFoundation.getMapViewCreateCount()
  }))()`);
  console.error('[readiness] applying NEARMAP');
  const applied = await evaluate(send, `(() => {
    const started = Date.now();
    return window.__iqaiSpatialV2.setGroundMode('NEARMAP')
      .then(() => ({ ok: true, elapsedMs: Date.now() - started }))
      .catch((error) => ({
        ok: false,
        elapsedMs: Date.now() - started,
        error: String(error?.message || error)
      }));
  })()`, true, 90000).catch((error) => ({ ok: false, error: String(error?.message || error) }));
  console.error('[readiness] apply result', applied?.ok, applied?.error || 'ok');
  await sleep(1000);
  const after = await evaluate(send, `(() => {
    const api = window.__iqaiSpatialV2;
    const view = api.mapFoundation.getView();
    const layers = [
      ...(view?.allLayerViews?.toArray ? view.allLayerViews.toArray() : []),
      ...(view?.basemapView?.baseLayerViews?.toArray ? view.basemapView.baseLayerViews.toArray() : []),
      ...(view?.basemapView?.referenceLayerViews?.toArray ? view.basemapView.referenceLayerViews.toArray() : [])
    ];
    const layerView = layers.find((item) => (
      item.layer?.id === 'iqai-ground-nearmap-wms'
      || item.layer?.id === '19fdca1f24c-layer-4'
      || item.layer?.title === 'Aerial 3.5cm'
    ));
    return {
      ground: api.ground(),
      mapViewCreateCount: api.mapFoundation.getMapViewCreateCount(),
      center: { longitude: view?.center?.longitude, latitude: view?.center?.latitude },
      layerView: layerView ? {
        suspended: layerView.suspended === true,
        updating: layerView.updating === true,
        visible: layerView.visible !== false,
        visibleAtCurrentScale: layerView.visibleAtCurrentScale !== false
      } : null
    };
  })()`);
  const captured = await send('Page.captureScreenshot', { format: 'png' }, 30000);
  const screenshotPath = path.join(OUT, 'nearmap-ground.png');
  fs.writeFileSync(screenshotPath, Buffer.from(captured.data, 'base64'));
  const restored = await evaluate(send, `(() => window.__iqaiSpatialV2.setGroundMode('AUTHORED_WEBMAP')
    .then(() => {
      const api = window.__iqaiSpatialV2;
      const map = api.mapFoundation.getWebMap();
      const layer = map?.allLayers?.find?.((item) => item?.id === '19fdca1f24c-layer-4');
      return {
        ok: true,
        currentMode: api.ground()?.currentMode,
        authoredLayerVisible: layer?.visible === true,
        parentVisible: layer?.parent?.visible === true
      };
    })
    .catch((error) => ({ ok: false, error: String(error?.message || error) })))()`, true, 40000);
  return {
    ready: true,
    originalLayer,
    before,
    applied,
    after,
    restored,
    screenshot: { path: screenshotPath, bytes: Buffer.from(captured.data, 'base64').length }
  };
});

const nearMapRequests = live.network.filter((entry) => (
  /(?:[?&]|%26)REQUEST(?:=|%3D)GetMap/i.test(entry.url)
  && (
    /\/api\/spatial-v2\/imagery\/nearmap\/wms/i.test(entry.url)
    || /\/wms\/v1\/(?:latest\/)?apikey\//i.test(entry.url)
  )
));
const portalWrites = live.network.filter((entry) => (
  /sharing\/rest\/content\/users\/.*\/(?:addItem|update|deleteItems|publish)/i.test(entry.url)
));
const evidence = live.after?.ground?.receipt?.displayEvidence || null;
const pass = live.ready === true
  && live.applied?.ok === true
  && live.after?.ground?.currentMode === 'NEARMAP'
  && live.after?.ground?.displayConfirmed === true
  && evidence?.confirmed === true
  && nearMapRequests.some((entry) => entry.status >= 200 && entry.status < 300)
  && live.restored?.ok === true
  && live.restored?.currentMode === 'AUTHORED_WEBMAP'
  && live.after?.mapViewCreateCount === 1
  && portalWrites.length === 0;
const report = {
  generatedAt: new Date().toISOString(),
  google: {
    server: google,
    productReadiness: live.before?.ground?.providerReadiness?.GOOGLE_SATELLITE || null
  },
  nearmap: {
    originalAuthoredLayer: live.originalLayer || null,
    restore: live.restored || null,
    wms: nearmapWms,
    coverage: nearmapCoverage,
    apply: live.applied || null,
    ground: live.after?.ground || null,
    layerView: live.after?.layerView || null,
    getMapResponses: nearMapRequests.map((entry) => ({
      status: entry.status,
      mimeType: entry.mimeType,
      path: new URL(entry.url).pathname
    })),
    displayEvidence: evidence
  },
  mapViewCreateCount: live.after?.mapViewCreateCount || live.before?.mapViewCreateCount || null,
  portalWriteRequests: portalWrites.map((entry) => new URL(entry.url).pathname),
  screenshot: live.screenshot || null,
  pass
};

fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'qa-report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
if (!pass) process.exitCode = 1;
