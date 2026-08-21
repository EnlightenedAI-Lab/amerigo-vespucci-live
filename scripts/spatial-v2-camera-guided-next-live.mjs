/**
 * Live proof: Guided Next Operator Flow V1 on :3052.
 * Does not restart :3047. Does not auto-open Camera Wall from guidance.
 */
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'artifacts', 'spatial-v2-camera-guided-next-v1');
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
  const guided = api.guidedNext?.snapshot?.() || {};
  const placed = api.placeCamera?.snapshot?.() || {};
  const panel = document.querySelector('[data-iqai-guided-next]');
  const wallEl = document.querySelector('[data-iqai-camera-wall]');
  const nextEls = Array.from(document.querySelectorAll('[data-iqai-guided="next"]'));
  const world = api.world?.() || {};
  return {
    guidedState: guided.state || panel?.dataset.iqaiGuidedState || null,
    guidedStatus: guided.status || panel?.dataset.iqaiGuidedStatus || null,
    guidedControl: guided.targetControl || panel?.dataset.iqaiGuidedControl || null,
    guidedLabel: panel?.querySelector('[data-iqai-guided-action]')?.textContent || guided.label || null,
    guidedEnabled: panel?.dataset.iqaiGuidedEnabled || String(guided.enabled !== false),
    opensWall: guided.opensWall === true,
    greenCount: nextEls.length,
    greenFocus: Boolean(document.querySelector('.iqai-v2-focus-tool[data-iqai-drop-pin][data-iqai-guided="next"]')),
    greenGenerate: Boolean(document.querySelector('[data-iqai-camera-coverage-generate][data-iqai-guided="next"]')),
    greenBuild: Boolean(document.querySelector('[data-iqai-camera-wall-build][data-iqai-guided="next"]')),
    greenSelector: document.querySelector('[data-iqai-camera-wall-selector][data-iqai-guided="next"]')?.getAttribute('data-iqai-camera-wall-selector') || null,
    blockedCount: document.querySelectorAll('[data-iqai-guided="blocked"]').length,
    placedCount: placed.count ?? (placed.cameras || []).length,
    cameras: (placed.cameras || []).map((item) => ({
      cameraId: item.cameraId,
      longitude: item.longitude,
      latitude: item.latitude,
      heading: item.heading,
      pitch: item.pitch,
      horizontalFov: item.horizontalFov
    })),
    wallHidden: wallEl?.hidden === true,
    wallDisplay: wallEl ? getComputedStyle(wallEl).display : null,
    wallHeight: wallEl ? Math.round(wallEl.getBoundingClientRect().height) : 0,
    selectorCount: document.querySelectorAll('[data-iqai-camera-wall-selector]').length,
    heavyKind: document.querySelector('[data-iqai-camera-wall-heavy-kind]')?.getAttribute('data-iqai-camera-wall-heavy-kind') || null,
    virtualViewText: document.querySelector('[data-iqai-camera-wall-virtual-view]')?.textContent || null,
    poseTruth: document.querySelector('[data-iqai-camera-wall-pose-truth]')?.textContent || null,
    cameraInSelection: (world.selection?.objectRefs || []).some((ref) => ref.authority === 'iqai.camera'),
    mapViews: document.querySelectorAll('.esri-view').length
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
  live = await withCdpPage(browserPath, 9374, async (send) => {
    await send('Page.navigate', { url: URL });
    await waitUntil(send, `Boolean(window.__iqaiSpatialV2 && window.__iqaiSpatialV2.guidedNext && window.__iqaiSpatialV2.cameraWall)`, 80, 200);
    await waitUntil(send, `document.querySelectorAll('.esri-view').length === 1`, 50, 250);
    await sleep(600);

    const noTarget = await evaluateJson(send, SNAP);
    const shot01 = await shot(send, '01-no-target-focus-green.jpg');

    await evaluateJson(send, `(async () => {
      document.querySelector('.iqai-v2-focus-tool[data-iqai-drop-pin]')?.click();
      await window.__iqaiSpatialV2.dropPin.placeFromSearch({
        longitude: ${PIN.longitude},
        latitude: ${PIN.latitude},
        address: '997 de la Commune Ouest, Montréal'
      });
      return true;
    })()`);
    await waitUntil(
      send,
      `Boolean(window.__iqaiSpatialV2.world()?.activeFocus?.longitude || window.__iqaiSpatialV2.world()?.activeFocus?.geometry)
        && document.querySelector('[data-iqai-camera-coverage-generate][data-iqai-guided="next"]')`,
      50,
      200
    );
    const targetReady = await evaluateJson(send, SNAP);
    const shot02 = await shot(send, '02-target-generate-green.jpg');

    await evaluateJson(send, `document.querySelector('[data-iqai-camera-coverage-generate]')?.click(); true`);
    await sleep(400);
    const loading = await evaluateJson(send, SNAP);
    const shot03 = await shot(send, '03-generate-loading-or-wall.jpg');

    await waitUntil(
      send,
      `window.__iqaiSpatialV2.placeCamera?.snapshot?.()?.count === 3
        && document.querySelectorAll('[data-iqai-camera-wall-selector]').length === 3`,
      80,
      400
    );
    await waitUntil(
      send,
      `Boolean(document.querySelector('[data-iqai-camera-wall-selector][data-iqai-guided="next"]'))`,
      80,
      400
    );
    await sleep(800);
    const cameraReady = await evaluateJson(send, SNAP);
    const shot04 = await shot(send, '04-first-usable-camera-green.jpg');
    const posesBeforeView = cameraReady?.cameras || [];

    await evaluateJson(send, `document.querySelector('[data-iqai-camera-wall-selector="1"]')?.click(); true`);
    await waitUntil(
      send,
      `Boolean(document.querySelector('[data-iqai-camera-wall-selector="2"][data-iqai-guided="next"]'))`,
      40,
      200
    );
    const after01 = await evaluateJson(send, SNAP);
    const shot05 = await shot(send, '05-camera-01-then-02-green.jpg');

    await evaluateJson(send, `window.__iqaiSpatialV2.cameraWall.applyVirtualView({ heading: 42, pitch: 10, zoom: 2 }); true`);
    await sleep(900);
    const afterPan = await evaluateJson(send, SNAP);
    const shot06 = await shot(send, '06-virtual-pan-tilt-zoom.jpg');

    await evaluateJson(send, `document.querySelector('[data-iqai-camera-wall-selector="2"]')?.click(); true`);
    await waitUntil(
      send,
      `Boolean(document.querySelector('[data-iqai-camera-wall-selector="3"][data-iqai-guided="next"]'))`,
      40,
      200
    );
    const after02 = await evaluateJson(send, SNAP);
    const shot07 = await shot(send, '07-camera-02-then-03-green.jpg');

    await evaluateJson(send, `document.querySelector('[data-iqai-camera-wall-selector="3"]')?.click(); true`);
    await waitUntil(
      send,
      `document.querySelector('[data-iqai-guided-next]')?.dataset.iqaiGuidedState === 'TOUR_COMPLETE'`,
      40,
      200
    );
    const complete = await evaluateJson(send, SNAP);
    const shot08 = await shot(send, '08-camera-inspection-ready.jpg');

    await evaluateJson(send, `document.querySelector('[data-iqai-camera-wall-close]')?.click(); true`);
    await waitUntil(send, `(() => {
      const el = document.querySelector('[data-iqai-camera-wall]');
      return el?.hidden === true && getComputedStyle(el).display === 'none'
        && document.querySelector('[data-iqai-camera-wall-build][data-iqai-guided="next"]');
    })()`, 40, 150);
    const closed = await evaluateJson(send, SNAP);
    const shot09 = await shot(send, '09-close-wall-build-green.jpg');

    await send('Page.reload', { ignoreCache: true });
    await waitUntil(send, `Boolean(window.__iqaiSpatialV2 && window.__iqaiSpatialV2.guidedNext && window.__iqaiSpatialV2.placeCamera)`, 80, 200);
    await waitUntil(send, `window.__iqaiSpatialV2.placeCamera?.snapshot?.()?.count === 3`, 80, 250);
    await waitUntil(send, `document.querySelectorAll('.esri-view').length === 1`, 40, 250);
    await waitUntil(send, `document.querySelector('[data-iqai-camera-wall-build][data-iqai-guided="next"]')`, 40, 200);
    await sleep(700);
    const reloaded = await evaluateJson(send, SNAP);
    const shot10 = await shot(send, '10-reload-wall-closed-build-green.jpg');

    await evaluateJson(send, `document.querySelector('[data-iqai-camera-wall-build]')?.click(); true`);
    await waitUntil(send, `document.querySelector('[data-iqai-camera-wall]')?.hidden === false
      && document.querySelectorAll('[data-iqai-camera-wall-selector]').length === 3`, 80, 300);
    await sleep(1800);
    const rebuilt = await evaluateJson(send, SNAP);
    const shot11 = await shot(send, '11-build-reopen.jpg');

    return {
      noTarget,
      targetReady,
      loading,
      cameraReady,
      posesBeforeView,
      after01,
      afterPan,
      after02,
      complete,
      closed,
      reloaded,
      rebuilt,
      shots: { shot01, shot02, shot03, shot04, shot05, shot06, shot07, shot08, shot09, shot10, shot11 }
    };
  });
} catch (error) {
  console.log(JSON.stringify({ RESULT: 'FAIL', error: String(error?.stack || error?.message || error) }));
  process.exit(1);
}

function posesEqual(a, b) {
  return JSON.stringify(a || []) === JSON.stringify(b || []);
}

function visuallyClosed(snap) {
  return snap?.wallHidden === true
    && snap?.wallDisplay === 'none'
    && Number(snap?.wallHeight || 0) === 0;
}

const pass = live.noTarget?.greenFocus === true
  && live.noTarget?.greenCount === 1
  && live.noTarget?.greenGenerate !== true
  && live.targetReady?.greenGenerate === true
  && live.targetReady?.greenCount === 1
  && live.cameraReady?.placedCount === 3
  && live.cameraReady?.selectorCount === 3
  && live.cameraReady?.greenBuild !== true
  && Boolean(live.cameraReady?.greenSelector)
  && live.cameraReady?.greenCount === 1
  && live.after01?.greenSelector === '2'
  && posesEqual(live.posesBeforeView, live.afterPan?.cameras)
  && live.after02?.greenSelector === '3'
  && live.complete?.guidedState === 'TOUR_COMPLETE'
  && live.complete?.greenCount === 0
  && visuallyClosed(live.closed)
  && live.closed?.placedCount === 3
  && live.closed?.greenBuild === true
  && visuallyClosed(live.reloaded)
  && live.reloaded?.placedCount === 3
  && live.reloaded?.greenBuild === true
  && live.rebuilt?.selectorCount === 3
  && live.rebuilt?.wallHidden === false
  && live.noTarget?.opensWall !== true
  && live.reloaded?.opensWall !== true
  && live.noTarget?.mapViews === 1
  && live.reloaded?.mapViews === 1
  && live.rebuilt?.mapViews === 1
  && live.cameraReady?.cameraInSelection !== true;

const report = { RESULT: pass ? 'PASS' : 'FAIL', live };
fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify({
  RESULT: report.RESULT,
  states: {
    noTarget: live.noTarget?.guidedState,
    targetReady: live.targetReady?.guidedState,
    loading: live.loading?.guidedState,
    cameraReady: live.cameraReady?.guidedState,
    after01: live.after01?.guidedControl,
    after02: live.after02?.guidedControl,
    complete: live.complete?.guidedState,
    closed: live.closed?.guidedState,
    reloaded: live.reloaded?.guidedState
  },
  green: {
    noTarget: live.noTarget?.greenCount,
    targetReady: live.targetReady?.greenCount,
    cameraReady: live.cameraReady?.greenCount,
    complete: live.complete?.greenCount
  },
  shots: live.shots
}, null, 2));
