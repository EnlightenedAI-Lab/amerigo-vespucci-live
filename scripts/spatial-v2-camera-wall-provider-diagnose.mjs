/**
 * Diagnose AUTO_PLAN wall provider representations on :3052.
 * Does not restart :3047. Does not print API keys.
 */
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'artifacts', 'spatial-v2-camera-wall-provider-repair-v1');
const PORT = 3052;
const URL = `http://localhost:${PORT}/spatial-v2/?v=camera-federation-v1`;
const PIN = Object.freeze({ longitude: -73.553221995734, latitude: 45.494180980834 });

function exists(file) { try { return fs.existsSync(file); } catch { return false; } }
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
    'about:blank'
  ], { stdio: 'ignore' });
  try {
    const version = await waitForJson(`http://127.0.0.1:${debugPort}/json/version`);
    const ws = new WebSocket(version.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
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
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { ws.off('message', onMessage); reject(new Error(`${method}: timeout`)); }, 90000);
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
    await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    const result = await fn(send);
    ws.close();
    return result;
  } finally {
    child.kill();
  }
}

async function evaluateJson(send, expression) {
  const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) {
    return { error: result.exceptionDetails.text || result.exceptionDetails.exception?.description || 'evaluate failed' };
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

const DIAG = `(() => {
  const api = window.__iqaiSpatialV2;
  const wall = api.cameraWall?.snapshot?.() || {};
  const reps = wall.representations || {};
  const query = api.cameraRelevance?.snapshot?.() || {};
  const gmErr = Array.from(document.querySelectorAll('.gm-err-container, .gm-err-message, .gm-err-title')).map((el) => el.textContent?.slice(0, 120));
  const frame = document.querySelector('iframe[src*="google-3d-frame"]');
  let frameErr = null;
  try { frameErr = frame?.contentDocument?.querySelector('.gm-err-message')?.textContent || null; } catch { frameErr = 'cross-or-empty'; }
  const mapsScript = Array.from(document.querySelectorAll('script[src*="maps.googleapis.com"]')).map((el) => ({
    hasKeyParam: /[?&]key=/.test(el.src || ''),
    referrerPolicy: el.referrerPolicy || el.getAttribute('referrerpolicy') || null
  }));
  return {
    available: query.cameraCount ?? null,
    relevant: query.relevantCount ?? null,
    slotCount: wall.wall?.slotCount ?? wall.slotCount ?? null,
    wallOpen: wall.wall?.open === true || wall.open === true,
    heavyLabel: document.querySelector('[data-iqai-camera-wall-heavy-label]')?.textContent || null,
    heavyKind: document.querySelector('[data-iqai-camera-wall-heavy-kind]')?.getAttribute('data-iqai-camera-wall-heavy-kind') || null,
    heavyOops: Boolean(document.querySelector('[data-iqai-camera-wall-heavy] .gm-err-container, [data-iqai-camera-wall-heavy] .gm-err-message')),
    gmErr,
    frameErr,
    importLibrary: typeof window.google?.maps?.importLibrary === 'function',
    streetViewService: typeof window.google?.maps?.StreetViewService === 'function',
    streetViewPanorama: typeof window.google?.maps?.StreetViewPanorama === 'function',
    mapsScript,
    referrerPolicy: document.querySelector('meta[name="referrer"]')?.content || null,
    slots: (reps.slots || []).map((item) => ({
      slotId: item.slotId,
      cameraRef: item.cameraRef,
      selected: item.selected,
      availability: item.availability,
      googleId: item.google?.providerId || null,
      mapillaryId: item.mapillary?.providerId || null,
      mapillaryStatus: item.mapillaryStatus || null,
      provider: item.representation?.provider || null,
      providerId: item.representation?.providerId || null
    })),
    slotStatusDom: Array.from(document.querySelectorAll('[data-iqai-camera-wall-rep-status]')).map((el) => el.textContent)
  };
})()`;

if (!(await isPortOpen(PORT))) {
  console.log(JSON.stringify({ error: '3052 not listening' }));
  process.exit(1);
}
const browserPath = findBrowser();
const live = await withCdpPage(browserPath, 9364, async (send) => {
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
  await waitUntil(send, `Boolean(window.__iqaiSpatialV2.world()?.activeFocus?.longitude || window.__iqaiSpatialV2.world()?.activeFocus?.geometry)`, 40, 200);
  await evaluateJson(send, `document.querySelector('[data-iqai-camera-coverage-generate]')?.click(); true`);
  await waitUntil(send, `window.__iqaiSpatialV2.placeCamera?.snapshot?.()?.count === 3`, 80, 300);
  const at1s = await evaluateJson(send, DIAG);
  await sleep(2500);
  const at4s = await evaluateJson(send, DIAG);
  await sleep(6000);
  const at10s = await evaluateJson(send, DIAG);
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  const file = path.join(OUT, '01-autoplan-wall-provider.png');
  fs.writeFileSync(file, Buffer.from(shot.data, 'base64'));
  const slotShot = await send('Page.captureScreenshot', { format: 'png' });
  const file2 = path.join(OUT, '02-autoplan-wall-provider-settled.png');
  fs.writeFileSync(file2, Buffer.from(slotShot.data, 'base64'));
  return { at1s, at4s, at10s, shots: [file, file2] };
});
fs.writeFileSync(path.join(OUT, 'repair-live.json'), JSON.stringify(live, null, 2));
const early = live.at1s?.slots || [];
const settled = live.at10s?.slots || live.at4s?.slots || [];
const hasProvider = settled.some((item) => item.providerId)
  || (live.at4s?.slots || []).some((item) => item.providerId)
  || early.some((item) => item.providerId);
const pass = live.at10s?.available === 3
  && live.at10s?.relevant === 3
  && live.at10s?.slotCount === 3
  && hasProvider
  && live.at10s?.heavyOops !== true;
console.log(JSON.stringify({ RESULT: pass ? 'PASS' : 'FAIL', hasProvider, live }, null, 2));
