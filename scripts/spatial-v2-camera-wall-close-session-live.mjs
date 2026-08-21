/**
 * Live proof: CLOSE WALL and reload leave wall closed; cameras persist.
 * :3052 only. Does not restart :3047.
 */
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'artifacts', 'spatial-v2-camera-wall-close-session-v1');
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
    } catch (error) { lastError = error; }
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
      const timeoutMs = method === 'Page.captureScreenshot' ? 90000 : 25000;
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
  const result = await send('Page.captureScreenshot', { format: 'jpeg', quality: 55 });
  const file = path.join(OUT, name.replace(/\.png$/i, '.jpg'));
  fs.writeFileSync(file, Buffer.from(result.data, 'base64'));
  return file;
}

const SNAP = `(() => {
  const api = window.__iqaiSpatialV2;
  const el = document.querySelector('[data-iqai-camera-wall]');
  const placed = api.placeCamera?.snapshot?.() || {};
  const style = el ? getComputedStyle(el) : null;
  const rect = el?.getBoundingClientRect?.();
  return {
    placedCount: placed.count ?? null,
    cameraIds: (placed.cameras || []).map((item) => item.cameraId),
    autoPlan: (placed.cameras || []).every((item) => item.creationMode === 'AUTO_PLAN'),
    wallOpenAttr: el?.getAttribute('data-iqai-camera-wall-open') || null,
    wallHidden: el?.hidden === true,
    wallDisplay: style?.display || null,
    wallHeight: rect ? Math.round(rect.height) : null,
    selectorCount: document.querySelectorAll('[data-iqai-camera-wall-selector]').length,
    heavyDomCount: document.querySelectorAll('[data-iqai-camera-wall-heavy-kind]').length,
    mapViews: document.querySelectorAll('.esri-view').length
  };
})()`;

if (!(await isPortOpen(PORT))) {
  console.log(JSON.stringify({ RESULT: 'FAIL', error: '3052 not listening' }));
  process.exit(1);
}
const browserPath = findBrowser();
if (!browserPath) {
  console.log(JSON.stringify({ RESULT: 'FAIL', error: 'No Chrome/Edge' }));
  process.exit(1);
}

console.error('LIVE start', { PORT, URL, browserPath });
let live;
try {
  live = await withCdpPage(browserPath, 9374, async (send) => {
  await send('Page.navigate', { url: URL });
  await waitUntil(send, `Boolean(window.__iqaiSpatialV2 && window.__iqaiSpatialV2.dropPin && window.__iqaiSpatialV2.cameraWall)`, 60, 200);
  await evaluateJson(send, `(async () => {
    document.querySelector('[data-iqai-drop-pin]')?.click();
    await window.__iqaiSpatialV2.dropPin.placeFromSearch({
      longitude: ${PIN.longitude},
      latitude: ${PIN.latitude},
      address: '997 de la Commune Ouest, Montréal'
    });
    return true;
  })()`);
  await waitUntil(send, `Boolean(window.__iqaiSpatialV2.world()?.activeFocus?.longitude)`, 40, 200);
  await evaluateJson(send, `document.querySelector('[data-iqai-camera-coverage-generate]')?.click(); true`);
  await waitUntil(send, `window.__iqaiSpatialV2.placeCamera?.snapshot?.()?.count === 3
    && document.querySelector('[data-iqai-camera-wall]')?.hidden === false
    && document.querySelectorAll('[data-iqai-camera-wall-selector]').length === 3`, 80, 400);
  await sleep(1500);
  const open = await evaluateJson(send, SNAP);
  const shotOpen = await shot(send, '01-wall-open.jpg');

  await evaluateJson(send, `document.querySelector('[data-iqai-camera-wall-close]')?.click(); true`);
  await waitUntil(send, `(() => {
    const el = document.querySelector('[data-iqai-camera-wall]');
    return el?.hidden === true && getComputedStyle(el).display === 'none';
  })()`, 40, 150);
  await sleep(400);
  const closed = await evaluateJson(send, SNAP);
  const shotClosed = await shot(send, '02-close-wall.jpg');

  await send('Page.reload', { ignoreCache: true });
  await waitUntil(send, `Boolean(window.__iqaiSpatialV2 && window.__iqaiSpatialV2.cameraWall && window.__iqaiSpatialV2.placeCamera)`, 60, 200);
  await waitUntil(send, `window.__iqaiSpatialV2.placeCamera?.snapshot?.()?.count === 3`, 80, 250);
  await waitUntil(send, `document.querySelectorAll('.esri-view').length === 1`, 40, 250);
  await sleep(800);
  const reloaded = await evaluateJson(send, SNAP);
  const shotReload = await shot(send, '03-reload-wall-closed.jpg');

  await evaluateJson(send, `document.querySelector('[data-iqai-camera-wall-build]')?.click(); true`);
  await waitUntil(send, `document.querySelector('[data-iqai-camera-wall]')?.hidden === false
    && document.querySelectorAll('[data-iqai-camera-wall-selector]').length === 3`, 80, 300);
  await sleep(2500);
  const rebuilt = await evaluateJson(send, SNAP);
  const shotRebuild = await shot(send, '04-build-wall-after-reload.jpg');

  await evaluateJson(send, `document.querySelector('[data-iqai-camera-wall-close]')?.click(); true`);
  await waitUntil(send, `(() => {
    const el = document.querySelector('[data-iqai-camera-wall]');
    return el?.hidden === true && getComputedStyle(el).display === 'none';
  })()`, 40, 150);
  const closedAgain = await evaluateJson(send, SNAP);
  const shotClosedAgain = await shot(send, '05-close-wall-again.jpg');

  return {
    open, closed, reloaded, rebuilt, closedAgain,
    shots: { shotOpen, shotClosed, shotReload, shotRebuild, shotClosedAgain }
  };
  });
} catch (error) {
  console.log(JSON.stringify({ RESULT: 'FAIL', error: String(error?.stack || error?.message || error) }));
  process.exit(1);
}

function visuallyClosed(snap) {
  return snap?.wallHidden === true
    && snap?.wallDisplay === 'none'
    && Number(snap?.wallHeight || 0) === 0
    && snap?.wallOpenAttr !== 'true';
}

function visuallyOpen(snap) {
  return snap?.wallHidden === false
    && snap?.wallDisplay !== 'none'
    && Number(snap?.selectorCount || 0) === 3
    && Number(snap?.wallHeight || 0) > 0;
}

const pass = visuallyOpen(live.open)
  && live.open?.placedCount === 3
  && visuallyClosed(live.closed)
  && live.closed?.placedCount === 3
  && live.closed?.autoPlan === true
  && visuallyClosed(live.reloaded)
  && live.reloaded?.placedCount === 3
  && visuallyOpen(live.rebuilt)
  && live.rebuilt?.placedCount === 3
  && visuallyClosed(live.closedAgain)
  && live.closedAgain?.placedCount === 3
  && live.open?.mapViews === 1
  && live.rebuilt?.mapViews === 1;

const report = { RESULT: pass ? 'PASS' : 'FAIL', live };
fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
