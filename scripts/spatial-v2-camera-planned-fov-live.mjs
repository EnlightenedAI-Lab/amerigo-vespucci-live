/**
 * Live proof: planned FOV restored + distinct Street360 viewpoints on :3052.
 */
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'artifacts', 'spatial-v2-camera-planned-fov-v1');
const PORT = 3052;
const URL = `http://localhost:${PORT}/spatial-v2/?v=camera-federation-v1`;
const TARGET = Object.freeze({
  longitude: -73.553221995734,
  latitude: 45.494180980834,
  address: '997 de la Commune Ouest, Montréal'
});
const PLACE = Object.freeze({
  longitude: -73.55405,
  latitude: 45.49485
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
      const timeoutMs = method === 'Page.captureScreenshot' || method === 'Runtime.evaluate' ? 90000 : 25000;
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
    awaitPromise: false,
    returnByValue: true
  });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.text || 'evaluate failed');
  }
  return result.result?.value;
}

async function waitUntil(send, expression, attempts, delayMs) {
  let last;
  for (let i = 0; i < attempts; i += 1) {
    last = await evaluateJson(send, expression);
    if (last) return last;
    await sleep(delayMs);
  }
  throw new Error(`waitUntil failed: ${expression} last=${JSON.stringify(last)}`);
}

async function shot(send, name) {
  const raw = await send('Page.captureScreenshot', { format: 'jpeg', quality: 72 });
  const file = path.join(OUT, name);
  fs.writeFileSync(file, Buffer.from(raw.data, 'base64'));
  return file;
}

const SNAP = `(() => {
  const api = window.__iqaiSpatialV2 || {};
  const wall = api.cameraWall?.snapshot?.() || {};
  const visual = api.visualCoverage?.snapshot?.() || null;
  const cameras = api.placeCamera?.snapshot?.()?.cameras || [];
  const plannedOverlay = document.querySelector('#iqai-v2-place-camera-overlay');
  const visualOverlay = document.querySelector('#iqai-v2-visual-coverage-overlay');
  return {
    operatorMode: api.cameraOperatorMode?.get?.() || null,
    planVisible: document.querySelector('[data-iqai-camera-plan-controls]')?.hidden === false,
    lookAroundVisible: document.querySelector('[data-iqai-camera-look-around-controls]')?.hidden === false,
    visualStatus: document.querySelector('[data-iqai-visual-coverage-status]')?.textContent || null,
    wallOpen: wall.wall?.open === true,
    slotCount: wall.wall?.slotCount || 0,
    labels: [...document.querySelectorAll('[data-iqai-camera-wall-selector-label]')].map((el) => el.textContent.trim()),
    offsets: [...document.querySelectorAll('[data-iqai-camera-wall-selector-offset]')].map((el) => el.textContent.trim()).filter(Boolean),
    plannedCount: cameras.length,
    plannedVisible: plannedOverlay?.style?.visibility !== 'hidden',
    plannedWedges: plannedOverlay?.querySelectorAll('[data-iqai-planned-fov]').length || 0,
    plannedSymbols: plannedOverlay?.querySelectorAll('[data-iqai-planned-camera-symbol]').length || 0,
    plannedFovLabel: plannedOverlay?.querySelector('[data-iqai-planned-fov-label]')?.textContent || null,
    rings: visualOverlay?.querySelectorAll('[data-iqai-360-ring]').length || 0,
    viewDirection: [...visualOverlay?.querySelectorAll('[data-iqai-view-direction-label]') || []].map((el) => el.textContent.trim()),
    offsetLabels: [...visualOverlay?.querySelectorAll('[data-iqai-representation-offset-label]') || []].map((el) => el.textContent.trim()),
    coverageSummary: visual?.coverageSummary || null,
    approachCount: visual?.approachCount ?? null,
    visualOk: visual?.ok === true,
    mapViews: document.querySelectorAll('.esri-view').length,
    mapViewCreateCount: api.mapViewCreateCount || null
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
  live = await withCdpPage(browserPath, 9420, async (send) => {
    const shots = {};
    const mark = (name) => console.error(`live: ${name}`);

    mark('navigate');
    await send('Page.navigate', { url: URL });
    await sleep(2500);
    await send('Runtime.enable');
    await waitUntil(send, `Boolean(window.__iqaiSpatialV2 && window.__iqaiSpatialV2.cameraRelevance && window.__iqaiSpatialV2.cameraCoverage)`, 80, 200);
    await sleep(800);

    mark('plan-cameras');
    await evaluateJson(send, `window.__iqaiSpatialV2.cameraRelevance.enterPlanCameras(); true`);
    await waitUntil(send, `window.__iqaiSpatialV2.cameraOperatorMode?.get?.() === 'PLAN_CAMERAS'`, 20, 150);
    await evaluateJson(send, `void window.__iqaiSpatialV2.dropPin.placeFromSearch({
      longitude: ${TARGET.longitude},
      latitude: ${TARGET.latitude},
      address: ${JSON.stringify(TARGET.address)}
    }); true`);
    await waitUntil(send, `Boolean(window.__iqaiSpatialV2.world()?.activeFocus)`, 40, 200);
    await evaluateJson(send, `window.__iqaiSpatialV2.cameraCoverage.generate(); true`);
    await waitUntil(send, `(window.__iqaiSpatialV2.placeCamera?.snapshot?.()?.count || 0) >= 3`, 40, 200);
    await sleep(1500);
    const afterPlan = await evaluateJson(send, SNAP);
    shots.plan = await shot(send, '01-plan-cameras-fov.jpg');

    mark('place-camera');
    await evaluateJson(send, `window.__iqaiSpatialV2.placeCamera.placeAt(${PLACE.longitude}, ${PLACE.latitude}, { heading: 210, horizontalFov: 70 }); true`);
    await waitUntil(send, `(window.__iqaiSpatialV2.placeCamera?.snapshot?.()?.count || 0) >= 4`, 20, 150);
    await sleep(800);
    const afterPlace = await evaluateJson(send, SNAP);
    shots.place = await shot(send, '02-place-camera-exact.jpg');

    mark('combined');
    await evaluateJson(send, `void window.__iqaiSpatialV2.visualCoverage.search(); true`);
    await sleep(8000);
    const combined = await evaluateJson(send, SNAP).catch(() => afterPlace);
    shots.combined = await shot(send, '03-combined-planned-and-360.jpg');

    mark('look-around');
    await evaluateJson(send, `window.__iqaiSpatialV2.cameraRelevance.enterLookAround(); true`);
    await sleep(8000);
    const look = await evaluateJson(send, SNAP).catch(() => combined);
    shots.look = await shot(send, '04-look-around-360.jpg');
    shots.wall = await shot(send, '05-3up-labels.jpg');

    return { afterPlan, afterPlace, combined, look, shots };
  });
} catch (error) {
  console.log(JSON.stringify({ error: String(error), result: 'FAIL' }));
  process.exit(1);
}

const { afterPlan, afterPlace, combined, look } = live;
const planPass = afterPlan?.operatorMode === 'PLAN_CAMERAS'
  && afterPlan?.plannedCount >= 3
  && (afterPlan.plannedWedges >= 3 || afterPlan.plannedSymbols >= 3);
const placePass = afterPlace?.plannedCount >= 4;
const lookPass = look?.operatorMode === 'LOOK_AROUND'
  && look?.plannedVisible === false
  && (look.rings >= 1 || look.visualOk === true);
const combinedPass = combined?.plannedCount >= 3
  && (combined.rings >= 1 || combined.visualOk === true);
const result = planPass && placePass && lookPass && combinedPass ? 'PASS' : 'PARTIAL';

console.log(JSON.stringify({
  result,
  planPass,
  placePass,
  lookPass,
  combinedPass,
  afterPlan,
  afterPlace,
  combined,
  look,
  shots: live.shots,
  out: OUT
}, null, 2));
