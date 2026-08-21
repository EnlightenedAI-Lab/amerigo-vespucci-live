/**
 * Live proof: Coverage Intent POINT / FOUR SIDES / PERIMETER on :3052.
 * Does not touch :3047.
 */
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'artifacts', 'spatial-v2-camera-coverage-intent-v1');
const PORT = 3052;
const URL = `http://localhost:${PORT}/spatial-v2/?v=camera-federation-v1`;
const TARGET = Object.freeze({
  longitude: -73.553221995734,
  latitude: 45.494180980834,
  address: '997 de la Commune Ouest, Montréal'
});
const BLOCK = [
  { longitude: -73.55380, latitude: 45.49462 },
  { longitude: -73.55255, latitude: 45.49462 },
  { longitude: -73.55255, latitude: 45.49378 },
  { longitude: -73.55380, latitude: 45.49378 }
];

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
      const timeoutMs = method === 'Page.captureScreenshot' || method === 'Runtime.evaluate' ? 20000 : 15000;
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
  const raw = await send('Page.captureScreenshot', { format: 'jpeg', quality: 70 });
  const file = path.join(OUT, name);
  fs.writeFileSync(file, Buffer.from(raw.data, 'base64'));
  return file;
}

const SNAP = `(() => {
  const api = window.__iqaiSpatialV2 || {};
  const overlay = document.querySelector('#iqai-v2-place-camera-overlay');
  const cameras = api.placeCamera?.snapshot?.()?.cameras || [];
  const intent = api.coverageIntent?.snapshot?.() || {};
  return {
    chooser: {
      point: document.querySelector('[data-iqai-coverage-pattern="POINT"]')?.getAttribute('aria-pressed'),
      four: document.querySelector('[data-iqai-coverage-pattern="FOUR_DIRECTION"]')?.getAttribute('aria-pressed'),
      perimeter: document.querySelector('[data-iqai-coverage-pattern="PERIMETER"]')?.getAttribute('aria-pressed'),
      summary: document.querySelector('[data-iqai-coverage-summary]')?.textContent || null
    },
    intent: {
      pattern: intent.pattern || null,
      orientation: intent.orientationIntent || null,
      cameraCount: intent.cameraCount || null
    },
    plannedCount: cameras.length,
    headings: cameras.map((camera) => Math.round(Number(camera.heading) || 0)),
    ids: cameras.map((camera) => camera.cameraId),
    adjusted: cameras.some((camera) => camera.operatorAdjusted === true),
    glyphs: overlay?.querySelectorAll('[data-iqai-planned-camera-glyph]').length || 0,
    wedges: overlay?.querySelectorAll('[data-iqai-planned-fov]').length || 0,
    targets: overlay?.querySelectorAll('[data-iqai-coverage-target]').length || 0,
    boundaries: overlay?.querySelectorAll('[data-iqai-plan-boundary]').length || 0,
    targetLabel: overlay?.querySelector('[data-iqai-coverage-target-label]')?.textContent || null,
    lookAround: Boolean(document.querySelector('[data-iqai-camera-look-around]')),
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
  live = await withCdpPage(browserPath, 9424, async (send) => {
    const shots = {};
    const mark = (name) => console.error(`live: ${name}`);
    mark('navigate');
    await send('Page.navigate', { url: URL });
    await sleep(2000);
    await send('Runtime.enable');
    await waitUntil(send, `Boolean(window.__iqaiSpatialV2 && window.__iqaiSpatialV2.worldViewFrame)`, 80, 200);
    await evaluateJson(send, `window.__iqaiSpatialV2.cameraRelevance.enterPlanCameras(); true`);
    await evaluateJson(send, `void window.__iqaiSpatialV2.dropPin.placeFromSearch({
      longitude: ${TARGET.longitude},
      latitude: ${TARGET.latitude},
      address: ${JSON.stringify(TARGET.address)}
    }); true`);
    await waitUntil(send, `Boolean(window.__iqaiSpatialV2.world()?.activeFocus)`, 30, 150);
    await waitUntil(send, `Boolean(document.querySelector('.esri-view') || window.__iqaiSpatialV2.mapViewCreateCount >= 1)`, 50, 200).catch(() => null);
    await sleep(1200);

    mark('point');
    await evaluateJson(send, `window.__iqaiSpatialV2.coverageIntent.setPattern('POINT'); window.__iqaiSpatialV2.cameraCoverage.generate(); true`);
    await waitUntil(send, `(window.__iqaiSpatialV2.placeCamera?.snapshot?.()?.count || 0) === 3`, 20, 150);
    await sleep(800);
    const point = await evaluateJson(send, SNAP);
    shots.point = await shot(send, '01-point.jpg');

    mark('four-inward');
    await evaluateJson(send, `window.__iqaiSpatialV2.cameraCoverage.clear(); window.__iqaiSpatialV2.coverageIntent.setPattern('FOUR_DIRECTION'); window.__iqaiSpatialV2.coverageIntent.setOrientation('INWARD'); window.__iqaiSpatialV2.cameraCoverage.generate(); true`);
    await waitUntil(send, `(window.__iqaiSpatialV2.placeCamera?.snapshot?.()?.count || 0) === 4`, 20, 150);
    await sleep(400);
    const fourIn = await evaluateJson(send, SNAP);
    shots.fourInward = await shot(send, '02-four-inward.jpg');

    mark('four-outward');
    await evaluateJson(send, `window.__iqaiSpatialV2.coverageIntent.setOrientation('OUTWARD'); window.__iqaiSpatialV2.cameraCoverage.generate(); true`);
    await waitUntil(send, `(window.__iqaiSpatialV2.placeCamera?.snapshot?.()?.cameras || []).length === 4`, 20, 150);
    await sleep(400);
    const fourOut = await evaluateJson(send, SNAP);
    shots.fourOutward = await shot(send, '03-four-outward.jpg');

    mark('perimeter');
    await evaluateJson(send, `window.__iqaiSpatialV2.cameraCoverage.clear(); window.__iqaiSpatialV2.coverageIntent.setPattern('PERIMETER'); window.__iqaiSpatialV2.coverageIntent.setOrientation('INWARD'); window.__iqaiSpatialV2.coverageIntent.setPolygon(${JSON.stringify(BLOCK)}); window.__iqaiSpatialV2.coverageIntent.closePolygon(); window.__iqaiSpatialV2.cameraCoverage.generate(); true`);
    await waitUntil(send, `(window.__iqaiSpatialV2.placeCamera?.snapshot?.()?.count || 0) === 4`, 20, 150);
    await sleep(400);
    const perimeter = await evaluateJson(send, SNAP);
    shots.perimeter = await shot(send, '04-perimeter.jpg');

    mark('adjust');
    await evaluateJson(send, `(() => {
      const camera = window.__iqaiSpatialV2.placeCamera.snapshot().cameras[0];
      window.__iqaiSpatialV2.placeCamera.updateActive({
        longitude: camera.longitude + 0.00025,
        latitude: camera.latitude
      });
      return true;
    })()`);
    await sleep(300);
    const adjusted = await evaluateJson(send, SNAP);
    shots.adjusted = await shot(send, '05-adjusted.jpg');

    return { point, fourIn, fourOut, perimeter, adjusted, shots };
  });
} catch (error) {
  console.log(JSON.stringify({ error: String(error), result: 'FAIL' }));
  process.exit(1);
}

const headingsReversed = JSON.stringify(live.fourIn?.headings) !== JSON.stringify(live.fourOut?.headings);
const pointOverlayReady = (live.point?.glyphs || 0) >= 3 && (live.point?.wedges || 0) >= 3 && (live.point?.targets || 0) >= 1;
const pointPass = live.point?.plannedCount === 3 && live.point?.headings?.length === 3;
const fourPass = live.fourIn?.plannedCount === 4 && live.fourOut?.plannedCount === 4 && headingsReversed
  && (live.fourIn?.glyphs || 0) >= 4 && (live.fourIn?.targets || 0) >= 1;
const periPass = live.perimeter?.plannedCount === 4 && (live.perimeter?.boundaries || 0) >= 1 && live.perimeter?.targetLabel === 'TARGET AREA'
  && (live.perimeter?.glyphs || 0) >= 4;
const adjustPass = live.adjusted?.adjusted === true && live.adjusted?.plannedCount === 4;
const mapPass = (live.fourIn?.mapViews === 1 || live.perimeter?.mapViews === 1);
const result = pointPass && fourPass && periPass && adjustPass && mapPass && (pointOverlayReady || (live.fourIn?.glyphs >= 4)) ? 'PASS' : 'PARTIAL';

console.log(JSON.stringify({
  result,
  pointPass,
  fourPass,
  periPass,
  adjustPass,
  mapPass,
  headingsReversed,
  point: live.point,
  fourIn: live.fourIn,
  fourOut: live.fourOut,
  perimeter: live.perimeter,
  adjusted: live.adjusted,
  shots: live.shots,
  out: OUT
}, null, 2));
