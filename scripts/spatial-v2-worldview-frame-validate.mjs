/**
 * Live acceptance: WorldView Frame V1 on :3047.
 * Multi-view + global target time. Redacts keys. Does not commit.
 */
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'artifacts', 'spatial-v2-worldview-frame');
const PORT = 3047;
const FOCUS_A = Object.freeze({ longitude: -73.5535, latitude: 45.5047 });
const FOCUS_B = Object.freeze({ longitude: -73.56726, latitude: 45.50173 });
const MATCH_METERS = 40;

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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sanitize(text) {
  return String(text || '')
    .replace(/key=[^&\s"']+/gi, 'key=REDACTED')
    .replace(/AIza[0-9A-Za-z_-]{20,}/g, 'REDACTED_KEY')
    .slice(0, 400);
}

function errorKinds(text) {
  const hay = String(text || '');
  return [
    'RefererNotAllowedMapError',
    'InvalidKeyMapError',
    'ApiNotActivatedMapError',
    'BillingNotEnabledMapError',
    'ExpiredKeyMapError',
    'gm_authFailure'
  ].filter((kind) => hay.includes(kind));
}

function offsetMeters(a, b) {
  if (!a || !b) return null;
  const lon1 = Number(a.longitude ?? a.lng);
  const lat1 = Number(a.latitude ?? a.lat);
  const lon2 = Number(b.longitude ?? b.lng);
  const lat2 = Number(b.latitude ?? b.lat);
  if (![lon1, lat1, lon2, lat2].every(Number.isFinite)) return null;
  const toRad = (degrees) => (degrees * Math.PI) / 180;
  const radius = 6371000;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const x = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * radius * Math.asin(Math.min(1, Math.sqrt(x)));
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

function isPortOpen(port) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ port, host: '127.0.0.1' });
    socket.once('connect', () => { socket.end(); resolve(true); });
    socket.once('error', () => resolve(false));
    socket.setTimeout(1500, () => { socket.destroy(); resolve(false); });
  });
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
    '--enable-webgl',
    '--ignore-gpu-blocklist',
    'about:blank'
  ], { stdio: 'ignore' });
  try {
    const version = await waitForJson(`http://127.0.0.1:${debugPort}/json/version`);
    const ws = new WebSocket(version.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      ws.once('open', resolve);
      ws.once('error', reject);
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
      ws.send(JSON.stringify({
        id: 3,
        method: 'Target.attachToTarget',
        params: { targetId, flatten: true }
      }));
    });
    let nextId = 10;
    const logs = [];
    ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg.method === 'Runtime.consoleAPICalled') {
        const text = (msg.params?.args || [])
          .map((arg) => sanitize(arg.value || arg.description || ''))
          .join(' ');
        logs.push({ type: msg.params?.type, text, kinds: errorKinds(text) });
      }
    });
    const send = (method, params = {}) => {
      nextId += 1;
      const id = nextId;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          ws.off('message', onMessage);
          reject(new Error(`${method}: timeout`));
        }, 90000);
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
    await send('Network.enable');
    await send('Network.setCacheDisabled', { cacheDisabled: true });
    const result = await fn(send, logs);
    ws.close();
    return result;
  } finally {
    child.kill();
  }
}

async function shot(send, name) {
  const result = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  const file = path.join(OUT, name);
  fs.writeFileSync(file, Buffer.from(result.data, 'base64'));
  return file;
}

async function evaluateJson(send, expression) {
  const result = await send('Runtime.evaluate', { expression, returnByValue: true });
  const value = result.result?.value;
  if (typeof value === 'string') {
    try { return JSON.parse(value); } catch { return { raw: value }; }
  }
  return value;
}

async function waitUntil(send, expression, attempts, delayMs) {
  for (let i = 0; i < attempts; i += 1) {
    const value = await evaluateJson(send, expression);
    if (value === true || value === 'true') return true;
    await sleep(delayMs);
  }
  return false;
}

async function probe(send) {
  return evaluateJson(send, `JSON.stringify((() => {
    const api = window.__iqaiSpatialV2;
    const world = api?.world?.();
    const frame = api?.worldViewFrame?.snapshot?.() || {};
    const visual = api?.google3d?.snapshot?.() || {};
    const street = api?.street360?.snapshot?.() || {};
    const drop = api?.dropPin?.snapshot?.() || {};
    const gmp = document.querySelector('gmp-map-3d');
    const pano = document.querySelector('.gm-style') || document.querySelector('[aria-label*="Street View" i]');
    const requested = world?.temporal?.requested?.instantOrInterval || null;
    const acquisition = world?.temporal?.acquisition?.start || null;
    return {
      layout: frame.layout || Number(document.getElementById('iqai-spatial-v2')?.dataset.iqaiWorldviewLayout || 0),
      maximized: frame.maximized || null,
      panes: frame.panes || [],
      strip: Boolean(document.querySelector('[data-iqai-time-strip]')),
      targetInput: document.querySelector('[data-iqai-time-requested]')?.value || null,
      requested,
      acquisition,
      imagerySeam: document.querySelector('[data-iqai-imagery-seam]')?.hidden === false
        || Boolean(document.querySelector('[data-iqai-pane="IMAGERY"]:not([hidden])')),
      waybackDates: Boolean(document.querySelector('[data-iqai-obs="wayback"]')?.textContent?.match(/\\d{4}-\\d{2}/)),
      nearmapDates: Boolean(document.querySelector('[data-iqai-obs="nearmap"]')?.textContent?.match(/\\d{4}-\\d{2}/)),
      mapState: document.querySelector('[data-iqai-map-state]')?.getAttribute('data-iqai-map-state') || null,
      createCount: api?.mapViewCreateCount ?? null,
      gmErr: document.querySelector('.gm-err-message')?.textContent || null,
      gmp: gmp ? { w: gmp.offsetWidth, h: gmp.offsetHeight } : null,
      pano: Boolean(pano),
      focus: drop.focus ? { longitude: drop.focus.longitude, latitude: drop.focus.latitude } : null,
      visual: {
        open: visual.open,
        stageState: visual.stageState,
        selectedPoint: visual.selectedPoint || null,
        camera: visual.camera || null,
        cameraFocusOffsetMeters: visual.cameraFocusOffsetMeters ?? null,
        temporalMode: visual.temporalMode || null,
        displayedAcquisitionLabel: visual.displayedAcquisitionLabel || null
      },
      street: {
        open: street.open,
        stageState: street.stageState,
        selectedPoint: street.selectedPoint || null,
        capture: street.capture || null
      }
    };
  })())`);
}

if (!(await isPortOpen(PORT))) {
  console.log(JSON.stringify({ error: '3047 not listening' }));
  process.exit(1);
}

const browserPath = findBrowser();
const live = await withCdpPage(browserPath, 9317, async (send, logs) => {
  await send('Page.addScriptToEvaluateOnNewDocument', {
    source: `window.gm_authFailure = function () { window.__iqaiGmAuthFailure = true; };`
  });
  await send('Page.navigate', { url: `http://localhost:${PORT}/spatial-v2/?v=worldview-frame-1` });
  await send('Page.bringToFront');
  const ready = await waitUntil(
    send,
    `document.querySelector('[data-iqai-map-state]')?.getAttribute('data-iqai-map-state') === 'READY'
      && Boolean(window.__iqaiSpatialV2?.worldViewFrame?.setLayout)
      && Boolean(window.__iqaiSpatialV2?.dropPin?.placeFocus)`,
    50,
    1000
  );
  if (!ready) return { ready: false, probe: await probe(send), screenshots: { map: await shot(send, 'fail-not-ready.png') } };

  await evaluateJson(send, `void window.__iqaiSpatialV2.dropPin.placeFocus(${FOCUS_A.longitude}, ${FOCUS_A.latitude}, 'map')`);
  await waitUntil(send, `Boolean(window.__iqaiSpatialV2.dropPin.snapshot().focus)`, 20, 250);
  await sleep(800);
  const single = await probe(send);
  const singleShot = await shot(send, '01-single-map.png');

  await evaluateJson(send, `void window.__iqaiSpatialV2.worldViewFrame.setLayout(2)`);
  await waitUntil(send, `window.__iqaiSpatialV2.worldViewFrame.snapshot().layout === 2`, 20, 250);
  await waitUntil(send, `window.__iqaiSpatialV2.street360.snapshot().stageState === 'OPEN' || window.__iqaiSpatialV2.street360.snapshot().stageState === 'UNAVAILABLE'`, 50, 1000);
  await sleep(2000);
  const twoStreet = await probe(send);
  const twoStreetShot = await shot(send, '02-map-street-360.png');

  await evaluateJson(send, `void window.__iqaiSpatialV2.worldViewFrame.setLayout(1)`);
  await waitUntil(send, `window.__iqaiSpatialV2.worldViewFrame.snapshot().layout === 1`, 20, 250);
  await sleep(800);
  await evaluateJson(send, `void window.__iqaiSpatialV2.worldViewFrame.openSupporting('3D VISUAL')`);
  await waitUntil(send, `window.__iqaiSpatialV2.google3d.snapshot().stageState === 'OPEN'`, 70, 1000);
  await sleep(2500);
  const twoVisual = await probe(send);
  const twoVisualShot = await shot(send, '03-map-3d.png');

  await evaluateJson(send, `void window.__iqaiSpatialV2.worldViewFrame.setLayout(3)`);
  await waitUntil(send, `window.__iqaiSpatialV2.worldViewFrame.snapshot().layout === 3`, 20, 250);
  await waitUntil(send, `window.__iqaiSpatialV2.street360.snapshot().stageState === 'OPEN' || window.__iqaiSpatialV2.street360.snapshot().stageState === 'UNAVAILABLE'`, 50, 1000);
  await waitUntil(send, `window.__iqaiSpatialV2.google3d.snapshot().stageState === 'OPEN'`, 40, 1000);
  await sleep(2500);
  const three = await probe(send);
  const threeShot = await shot(send, '04-three-view.png');

  await evaluateJson(send, `void window.__iqaiSpatialV2.worldViewFrame.maximize('3D VISUAL')`);
  await sleep(800);
  const maximized = await probe(send);
  await evaluateJson(send, `void window.__iqaiSpatialV2.worldViewFrame.restore()`);
  await sleep(800);
  const restored = await probe(send);

  await evaluateJson(send, `void window.__iqaiSpatialV2.worldViewFrame.setLayout(4)`);
  await waitUntil(send, `window.__iqaiSpatialV2.worldViewFrame.snapshot().layout === 4`, 20, 250);
  await sleep(600);
  const four = await probe(send);
  await evaluateJson(send, `void window.__iqaiSpatialV2.worldViewFrame.closePane('IMAGERY')`);
  await waitUntil(send, `window.__iqaiSpatialV2.worldViewFrame.snapshot().layout === 3`, 20, 250);
  await evaluateJson(send, `void window.__iqaiSpatialV2.worldViewFrame.setLayout(4)`);
  await sleep(400);
  const fourReopen = await probe(send);

  await evaluateJson(send, `void window.__iqaiSpatialV2.dropPin.placeFocus(${FOCUS_B.longitude}, ${FOCUS_B.latitude}, 'map')`);
  await waitUntil(
    send,
    `Math.abs(window.__iqaiSpatialV2.dropPin.snapshot().focus.longitude - ${FOCUS_B.longitude}) < 1e-6`,
    20,
    250
  );
  await sleep(20000);
  const afterB = await probe(send);

  await evaluateJson(send, `void window.__iqaiSpatialV2.execute('temporal.set-requested', { instant: '2019-08-15' })`);
  await sleep(800);
  const historical = await probe(send);
  const historicalShot = await shot(send, '05-timeline-historical-target.png');

  return {
    ready: true,
    single,
    twoStreet,
    twoVisual,
    three,
    maximized,
    restored,
    four,
    fourReopen,
    afterB,
    historical,
    screenshots: {
      single: singleShot,
      map360: twoStreetShot,
      map3d: twoVisualShot,
      three: threeShot,
      historical: historicalShot
    },
    googleErrorKinds: [...new Set(logs.flatMap((row) => row.kinds || []))]
  };
});

function matchFocus(probeResult, focus) {
  const street = offsetMeters(focus, probeResult?.street?.selectedPoint);
  const cam = probeResult?.visual?.camera
    ? { longitude: probeResult.visual.camera.lng, latitude: probeResult.visual.camera.lat }
    : probeResult?.visual?.selectedPoint;
  const visual = offsetMeters(focus, cam);
  return { street, visual };
}

const a360 = matchFocus(live.twoStreet, live.twoStreet?.focus || FOCUS_A);
const a3d = matchFocus(live.twoVisual, live.twoVisual?.focus || FOCUS_A);
const threeA = matchFocus(live.three, live.three?.focus || FOCUS_A);
const b = matchFocus(live.afterB, live.afterB?.focus || FOCUS_B);

const report = {
  origin: `http://localhost:${PORT}/spatial-v2/`,
  ready: live.ready,
  layout1: live.single?.layout === 1,
  layout2Street: live.twoStreet?.layout === 2 && (live.twoStreet?.street?.open === true || live.twoStreet?.street?.stageState === 'UNAVAILABLE'),
  layout2Visual: live.twoVisual?.layout === 2 && live.twoVisual?.visual?.open === true,
  layout3: live.three?.layout === 3,
  layout4: live.four?.layout === 4 && live.four?.imagerySeam === true,
  maximize: live.maximized?.maximized === '3D VISUAL',
  restore: live.restored?.maximized == null && live.restored?.layout === 3,
  closeReopen: live.fourReopen?.layout === 4,
  focusA: live.single?.focus,
  focusB: live.afterB?.focus,
  matchA360: a360,
  matchA3d: a3d,
  matchThree: threeA,
  matchB: b,
  createCount: live.historical?.createCount ?? live.afterB?.createCount,
  strip: live.single?.strip === true,
  requested: live.historical?.requested,
  acquisitionUnchanged: live.historical?.acquisition == null,
  currentOnly: live.historical?.visual?.displayedAcquisitionLabel === 'CURRENT ONLY'
    || live.three?.visual?.displayedAcquisitionLabel === 'CURRENT ONLY',
  streetCapture: live.three?.street?.capture || live.twoStreet?.street?.capture || null,
  inventedWayback: live.historical?.waybackDates === true,
  inventedNearmap: live.historical?.nearmapDates === true,
  authError: Boolean(live.googleErrorKinds?.length || live.three?.gmErr),
  screenshots: live.screenshots,
  live
};

fs.writeFileSync(path.join(OUT, 'worldview-frame-validate.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify({
  layout1: report.layout1,
  layout2Street: report.layout2Street,
  layout2Visual: report.layout2Visual,
  layout3: report.layout3,
  layout4: report.layout4,
  maximize: report.maximize,
  restore: report.restore,
  closeReopen: report.closeReopen,
  focusA: report.focusA,
  focusB: report.focusB,
  matchA360: report.matchA360,
  matchA3d: report.matchA3d,
  matchB: report.matchB,
  createCount: report.createCount,
  strip: report.strip,
  requested: report.requested,
  acquisitionUnchanged: report.acquisitionUnchanged,
  currentOnly: report.currentOnly,
  streetCapture: report.streetCapture,
  inventedWayback: report.inventedWayback,
  inventedNearmap: report.inventedNearmap,
  authError: report.authError,
  screenshots: report.screenshots
}, null, 2));

const visualOk = (report.matchA3d.visual != null && report.matchA3d.visual <= MATCH_METERS)
  && (report.matchB.visual != null && report.matchB.visual <= MATCH_METERS);
const streetOk = (report.matchA360.street == null || report.matchA360.street <= MATCH_METERS)
  && (report.matchB.street == null || report.matchB.street <= MATCH_METERS);
if (!live.ready || !report.layout1 || !report.layout3 || !report.strip || report.createCount !== 1 || report.authError || !visualOk || !streetOk || !report.currentOnly || report.inventedWayback || report.inventedNearmap) {
  process.exitCode = 1;
}
