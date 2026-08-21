/**
 * Live proof: Camera stays inside STREET 360 pane; MAXIMIZE/RESTORE on :3052.
 * Does not restart :3047.
 */
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'artifacts', 'spatial-v2-camera-contained-workspace-v1');
const PORT = 3052;
const URL = `http://localhost:${PORT}/spatial-v2/?v=camera-federation-v1`;
const PIN = Object.freeze({
  longitude: -73.553221995734,
  latitude: 45.494180980834
});

function exists(file) {
  try { return fs.existsSync(file); } catch { return false; }
}

function findBrowser() {
  return [
    process.env.CHROME_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    process.env.EDGE_PATH,
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
  ].filter(Boolean).find((file) => exists(file)) || null;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function isPortOpen(port) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ port, host: '127.0.0.1' });
    socket.once('connect', () => { socket.end(); resolve(true); });
    socket.once('error', () => resolve(false));
    socket.setTimeout(1500, () => { socket.destroy(); resolve(false); });
  });
}

async function waitForJson(url, attempts = 40) {
  let lastError;
  for (let i = 0; i < attempts; i += 1) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(1000) });
      if (res.ok) return res.json();
    } catch (error) {
      lastError = error;
    }
    await sleep(120);
  }
  throw lastError || new Error(`Timed out waiting for ${url}`);
}

async function withCdpPage(browserPath, debugPort, fn) {
  fs.mkdirSync(OUT, { recursive: true });
  const userDataDir = fs.mkdtempSync(path.join(OUT, 'browser-'));
  const child = spawn(browserPath, [
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${userDataDir}`,
    '--remote-allow-origins=*',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-session-crashed-bubble',
    '--disable-infobars',
    '--disable-gpu',
    '--window-size=1920,1080',
    'about:blank'
  ], { stdio: 'ignore' });
  try {
    const version = await waitForJson(`http://127.0.0.1:${debugPort}/json/version`);
    const ws = new WebSocket(version.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('CDP websocket timeout')), 15000);
      ws.once('open', () => { clearTimeout(timer); resolve(); });
      ws.once('error', (error) => { clearTimeout(timer); reject(error); });
    });
    const { targetId } = await new Promise((resolve, reject) => {
      const onMessage = (raw) => {
        const msg = JSON.parse(raw.toString());
        if (msg.method === 'Target.targetCreated' && msg.params?.targetInfo?.type === 'page') {
          ws.off('message', onMessage);
          resolve({ targetId: msg.params.targetInfo.targetId });
        }
      };
      ws.on('message', onMessage);
      ws.send(JSON.stringify({ id: 1, method: 'Target.setDiscoverTargets', params: { discover: true } }));
      ws.send(JSON.stringify({ id: 2, method: 'Target.createTarget', params: { url: 'about:blank' } }));
      setTimeout(() => reject(new Error('Timed out creating CDP target')), 8000);
    });
    const attached = await new Promise((resolve, reject) => {
      const onMessage = (raw) => {
        const msg = JSON.parse(raw.toString());
        if (msg.id === 3) {
          ws.off('message', onMessage);
          if (msg.error) reject(new Error(JSON.stringify(msg.error)));
          else resolve(msg.result);
        }
      };
      ws.on('message', onMessage);
      ws.send(JSON.stringify({ id: 3, method: 'Target.attachToTarget', params: { targetId, flatten: true } }));
    });
    let nextId = 10;
    const send = (method, params = {}) => {
      nextId += 1;
      const id = nextId;
      const timeoutMs = method === 'Page.captureScreenshot' ? 60000 : 20000;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          ws.off('message', onMessage);
          reject(new Error(`${method}: timeout`));
        }, timeoutMs);
        const onMessage = (raw) => {
          const msg = JSON.parse(raw.toString());
          if (msg.id !== id) return;
          clearTimeout(timer);
          ws.off('message', onMessage);
          if (msg.error) reject(new Error(`${method}: ${JSON.stringify(msg.error)}`));
          else resolve(msg.result);
        };
        ws.on('message', onMessage);
        ws.send(JSON.stringify({ id, method, sessionId: attached.sessionId, params }));
      });
    };
    await send('Page.enable');
    await send('Runtime.enable');
    await send('Network.setCacheDisabled', { cacheDisabled: true });
    await send('Emulation.setDeviceMetricsOverride', {
      width: 1920,
      height: 1080,
      deviceScaleFactor: 1,
      mobile: false
    });
    const result = await fn(send);
    ws.close();
    return result;
  } finally {
    child.kill();
  }
}

async function evaluateJson(send, expression) {
  const result = await send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true
  });
  if (result.exceptionDetails) {
    return {
      error: result.exceptionDetails.text
        || result.exceptionDetails.exception?.description
        || 'evaluate failed'
    };
  }
  return result.result?.value;
}

async function waitUntil(send, expression, attempts, delayMs) {
  for (let i = 0; i < attempts; i += 1) {
    const value = await evaluateJson(send, expression);
    if (value === true || value === 'true') return true;
    await sleep(delayMs);
  }
  return false;
}

async function shot(send, name) {
  try {
    const result = await send('Page.captureScreenshot', { format: 'jpeg', quality: 70 });
    const file = path.join(OUT, name);
    fs.writeFileSync(file, Buffer.from(result.data, 'base64'));
    return file;
  } catch (error) {
    return { error: String(error?.message || error) };
  }
}

const SNAP = `(() => {
  const api = window.__iqaiSpatialV2;
  const well = document.querySelector('[data-iqai-view-host]');
  const frame = api.worldViewFrame?.snapshot?.() || {};
  const wallEl = document.querySelector('[data-iqai-camera-wall]');
  const pane = document.querySelector('[data-iqai-pane="STREET 360"]');
  const mapPane = document.querySelector('[data-iqai-pane="MAP"]');
  const visualPane = document.querySelector('[data-iqai-pane="3D VISUAL"]');
  const stage = document.querySelector('[data-iqai-camera-wall-heavy-stage]');
  const wr = wallEl && !wallEl.hidden ? wallEl.getBoundingClientRect() : null;
  const pr = pane && !pane.hidden ? pane.getBoundingClientRect() : null;
  const mr = mapPane && !mapPane.hidden ? mapPane.getBoundingClientRect() : null;
  const placed = api.placeCamera?.snapshot?.() || {};
  const guided = api.guidedNext?.snapshot?.() || {};
  const contained = Boolean(wr && pr
    && wr.left >= pr.left - 2
    && wr.right <= pr.right + 2
    && wr.top >= pr.top - 2
    && wr.bottom <= pr.bottom + 2);
  const overlapsMap = Boolean(wr && mr && wr.left < mr.right - 8 && wr.right > mr.left + 8 && wr.top < mr.bottom - 8 && wr.bottom > mr.top + 8);
  return {
    layout: frame.layout || Number(well?.dataset.iqaiWorldviewLayout) || null,
    maximized: frame.maximized || well?.dataset.iqaiWorldviewMaximized || null,
    layoutButtons: ['1', '2', '3', '4'].map((n) => Boolean(document.querySelector('[data-iqai-layout="' + n + '"]'))),
    mapPaneHidden: mapPane?.hidden === true,
    streetPaneHidden: pane?.hidden === true,
    visualPaneHidden: visualPane?.hidden === true,
    wallParentPane: wallEl?.closest('[data-iqai-pane]')?.getAttribute('data-iqai-pane') || null,
    wallHidden: wallEl?.hidden === true,
    contained,
    overlapsMap,
    selectorCount: document.querySelectorAll('[data-iqai-camera-wall-selector]').length,
    selectorHeight: document.querySelector('[data-iqai-camera-wall-slots]')?.getBoundingClientRect?.().height || 0,
    stageHeight: stage ? Math.round(stage.getBoundingClientRect().height) : 0,
    heavyDomCount: document.querySelectorAll('[data-iqai-camera-wall-heavy-kind]').length,
    greenCount: document.querySelectorAll('[data-iqai-guided="next"]').length,
    guidedState: guided.state || null,
    guidedControl: guided.targetControl || null,
    placedCount: placed.count ?? (placed.cameras || []).length,
    cameras: (placed.cameras || []).map((item) => ({
      cameraId: item.cameraId,
      longitude: item.longitude,
      latitude: item.latitude,
      heading: item.heading,
      pitch: item.pitch,
      horizontalFov: item.horizontalFov
    })),
    cameraInSelection: (api.world?.()?.selection?.objectRefs || []).some((ref) => ref.authority === 'iqai.camera'),
    detailsOpen: document.querySelector('[data-iqai-camera-command-details-panel]')?.hidden === false,
    commandRows: document.querySelectorAll('[data-iqai-camera-relevance-row]').length,
    mapViews: document.querySelectorAll('.esri-view').length,
    viewport: { width: window.innerWidth, height: window.innerHeight }
  };
})()`;

if (!(await isPortOpen(PORT))) {
  console.log(JSON.stringify({ error: '3052 not listening', result: 'FAIL' }));
  process.exit(1);
}

const browserPath = findBrowser();
if (!browserPath) {
  console.log(JSON.stringify({ error: 'No Chrome/Edge', result: 'FAIL' }));
  process.exit(1);
}

let live;
try {
  live = await withCdpPage(browserPath, 9376, async (send) => {
    await send('Page.navigate', { url: URL });
    await waitUntil(send, `Boolean(window.__iqaiSpatialV2 && window.__iqaiSpatialV2.worldViewFrame && window.__iqaiSpatialV2.cameraWall)`, 80, 200);
    await waitUntil(send, `document.querySelectorAll('.esri-view').length === 1`, 50, 250);
    await sleep(500);
    const normal = await evaluateJson(send, SNAP);
    const shot01 = await shot(send, '01-normal-workspace.jpg');

    await evaluateJson(send, `(async () => {
      await window.__iqaiSpatialV2.dropPin.placeFromSearch({
        longitude: ${PIN.longitude},
        latitude: ${PIN.latitude},
        address: '997 de la Commune Ouest, Montréal'
      });
      return true;
    })()`);
    await waitUntil(send, `Boolean(window.__iqaiSpatialV2.world()?.activeFocus)`, 40, 200);
    await evaluateJson(send, `document.querySelector('[data-iqai-camera-coverage-generate]')?.click(); true`);
    await waitUntil(
      send,
      `window.__iqaiSpatialV2.placeCamera?.snapshot?.()?.count === 3
        && document.querySelectorAll('[data-iqai-camera-wall-selector]').length === 3
        && document.querySelector('[data-iqai-camera-wall]')?.hidden === false`,
      90,
      400
    );
    await waitUntil(
      send,
      `document.querySelector('[data-iqai-pane="STREET 360"]')?.hidden === false`,
      40,
      200
    );
    await sleep(1200);
    const contained = await evaluateJson(send, SNAP);
    const shot02 = await shot(send, '02-camera-contained.jpg');
    const poses = contained?.cameras || [];

    await evaluateJson(send, `document.querySelector('[data-iqai-pane-maximize="STREET 360"]')?.click(); true`);
    await waitUntil(
      send,
      `window.__iqaiSpatialV2.worldViewFrame?.snapshot?.()?.maximized === 'STREET 360'`,
      40,
      150
    );
    await sleep(800);
    const maximized = await evaluateJson(send, SNAP);
    const shot03 = await shot(send, '03-camera-maximized.jpg');

    await evaluateJson(send, `window.__iqaiSpatialV2.cameraWall.applyVirtualView({ heading: 40, pitch: 8, zoom: 2 }); true`);
    await sleep(700);
    const afterPan = await evaluateJson(send, SNAP);

    await evaluateJson(send, `document.querySelector('[data-iqai-pane-restore="STREET 360"]')?.click(); true`);
    await waitUntil(
      send,
      `window.__iqaiSpatialV2.worldViewFrame?.snapshot?.()?.maximized == null`,
      40,
      150
    );
    await sleep(700);
    const restored = await evaluateJson(send, SNAP);
    const shot04 = await shot(send, '04-camera-restored.jpg');

    await evaluateJson(send, `document.querySelector('[data-iqai-pane-maximize="MAP"]')?.click(); true`);
    await waitUntil(send, `window.__iqaiSpatialV2.worldViewFrame?.snapshot?.()?.maximized === 'MAP'`, 30, 150);
    const mapMax = await evaluateJson(send, SNAP);
    await evaluateJson(send, `document.querySelector('[data-iqai-pane-restore="MAP"]')?.click(); true`);
    await waitUntil(send, `window.__iqaiSpatialV2.worldViewFrame?.snapshot?.()?.maximized == null`, 30, 150);
    await sleep(500);
    const finalWs = await evaluateJson(send, SNAP);
    const shot05 = await shot(send, '05-final-workspace.jpg');

    return {
      normal, contained, maximized, afterPan, restored, mapMax, finalWs, poses,
      shots: { shot01, shot02, shot03, shot04, shot05 }
    };
  });
} catch (error) {
  console.log(JSON.stringify({ RESULT: 'FAIL', error: String(error?.stack || error?.message || error) }));
  process.exit(1);
}

function posesEqual(a, b) {
  return JSON.stringify(a || []) === JSON.stringify(b || []);
}

const pass = live.normal?.layout === 1
  && live.normal?.layoutButtons?.every(Boolean)
  && live.normal?.mapViews === 1
  && live.contained?.placedCount === 3
  && live.contained?.selectorCount === 3
  && live.contained?.wallParentPane === 'STREET 360'
  && live.contained?.contained === true
  && live.contained?.overlapsMap !== true
  && live.contained?.layout >= 2
  && live.contained?.streetPaneHidden === false
  && live.contained?.mapPaneHidden === false
  && Number(live.contained?.selectorHeight || 0) <= 110
  && Number(live.contained?.stageHeight || 0) >= 160
  && live.contained?.heavyDomCount <= 1
  && live.maximized?.maximized === 'STREET 360'
  && live.maximized?.mapPaneHidden === true
  && live.maximized?.contained === true
  && live.maximized?.heavyDomCount <= 1
  && live.maximized?.mapViews === 1
  && posesEqual(live.poses, live.afterPan?.cameras)
  && live.restored?.maximized == null
  && live.restored?.layout === live.contained?.layout
  && live.restored?.mapPaneHidden === false
  && live.restored?.streetPaneHidden === false
  && live.restored?.placedCount === 3
  && live.restored?.heavyDomCount <= 1
  && live.mapMax?.maximized === 'MAP'
  && live.finalWs?.maximized == null
  && live.finalWs?.mapViews === 1
  && live.contained?.cameraInSelection !== true
  && live.contained?.detailsOpen !== true;

const report = { RESULT: pass ? 'PASS' : 'FAIL', live };
fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify({
  RESULT: report.RESULT,
  layout: {
    normal: live.normal?.layout,
    contained: live.contained?.layout,
    maximized: live.maximized?.maximized,
    restored: live.restored?.layout,
    restoredMax: live.restored?.maximized
  },
  contained: live.contained?.contained,
  overlapsMap: live.contained?.overlapsMap,
  selectorHeight: live.contained?.selectorHeight,
  stageHeight: live.contained?.stageHeight,
  heavy: {
    contained: live.contained?.heavyDomCount,
    maximized: live.maximized?.heavyDomCount,
    restored: live.restored?.heavyDomCount
  },
  shots: live.shots
}, null, 2));
