/**
 * Live acceptance: MAP FocusRef → Google 3D camera on :3047.
 * Records Focus vs Map3DElement center. Redacts keys. Does not commit.
 */
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'artifacts', 'spatial-v2-google-3d-focus-sync');
const PORT = 3047;
const FOCUS_A = Object.freeze({ longitude: -73.73312, latitude: 45.52354 });
const FOCUS_B = Object.freeze({ longitude: -73.55350, latitude: 45.50470 });
const MATCH_METERS = 25;

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
      if (msg.method === 'Runtime.exceptionThrown') {
        const text = sanitize(
          msg.params?.exceptionDetails?.text
          || msg.params?.exceptionDetails?.exception?.description
        );
        logs.push({ type: 'exception', text, kinds: errorKinds(text) });
      }
    });
    const send = (method, params = {}) => {
      nextId += 1;
      const id = nextId;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          ws.off('message', onMessage);
          reject(new Error(`${method}: timeout`));
        }, 60000);
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
  const result = await send('Runtime.evaluate', {
    expression,
    returnByValue: true
  });
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
    const world = window.__iqaiSpatialV2?.world?.();
    const worldFocus = world?.activeFocus || null;
    const drop = window.__iqaiSpatialV2?.dropPin?.snapshot?.() || {};
    const visual = window.__iqaiSpatialV2?.google3d?.snapshot?.() || {};
    const street = window.__iqaiSpatialV2?.street360?.snapshot?.() || {};
    const switcher = window.__iqaiSpatialV2?.viewSwitcher?.snapshot?.() || {};
    const gmp = document.querySelector('gmp-map-3d');
    const focus = drop.focus || null;
    const worldLon = worldFocus?.geometry?.coordinates?.[0] ?? worldFocus?.longitude ?? null;
    const worldLat = worldFocus?.geometry?.coordinates?.[1] ?? worldFocus?.latitude ?? null;
    return {
      spatialView: document.getElementById('iqai-spatial-v2')?.dataset.iqaiSpatialView || null,
      activeView: switcher.activeView || null,
      mapState: document.querySelector('[data-iqai-map-state]')?.getAttribute('data-iqai-map-state') || null,
      gmErr: document.querySelector('.gm-err-message')?.textContent || null,
      authFail: Boolean(window.__iqaiGmAuthFailure),
      createCount: window.__iqaiSpatialV2?.mapViewCreateCount ?? null,
      gmp: gmp ? { w: gmp.offsetWidth, h: gmp.offsetHeight } : null,
      focus: focus ? { longitude: focus.longitude, latitude: focus.latitude, source: focus.source } : null,
      worldFocus: { longitude: worldLon, latitude: worldLat },
      visual: {
        open: visual.open,
        stageState: visual.stageState,
        maps3dLoaded: visual.maps3dLoaded,
        markerPresent: visual.markerPresent,
        selectedPoint: visual.selectedPoint || null,
        camera: visual.camera || null,
        cameraFocusOffsetMeters: visual.cameraFocusOffsetMeters ?? null,
        error: visual.error || null
      },
      street: {
        open: street.open,
        stageState: street.stageState,
        available: street.available,
        selectedPoint: street.selectedPoint || null,
        error: street.error || null
      }
    };
  })())`);
}

function targetOf(probeResult) {
  const camera = probeResult?.visual?.camera || {};
  return {
    longitude: Number.isFinite(Number(camera.lng)) ? Number(camera.lng) : null,
    latitude: Number.isFinite(Number(camera.lat)) ? Number(camera.lat) : null
  };
}

function match(focus, target) {
  const meters = offsetMeters(focus, target);
  return {
    meters,
    pass: meters != null && meters <= MATCH_METERS
  };
}

if (!(await isPortOpen(PORT))) {
  console.log(JSON.stringify({ error: '3047 not listening' }));
  process.exit(1);
}

const browserPath = findBrowser();
if (!browserPath) {
  console.log(JSON.stringify({ error: 'No Chrome/Edge browser found' }));
  process.exit(1);
}

const live = await withCdpPage(browserPath, 9311, async (send, logs) => {
  await send('Page.addScriptToEvaluateOnNewDocument', {
    source: `window.gm_authFailure = function () { window.__iqaiGmAuthFailure = true; };`
  });
  await send('Page.navigate', { url: `http://localhost:${PORT}/spatial-v2/?v=focus-sync-1` });
  await send('Page.bringToFront');
  const ready = await waitUntil(
    send,
    `document.querySelector('[data-iqai-map-state]')?.getAttribute('data-iqai-map-state') === 'READY'
      && Boolean(window.__iqaiSpatialV2?.dropPin?.placeFocus)
      && Boolean(window.__iqaiSpatialV2?.google3d?.snapshot)`,
    50,
    1000
  );
  if (!ready) {
    return { ready: false, probe: await probe(send), screenshots: { map: await shot(send, 'fail-not-ready.png') }, logs };
  }

  await evaluateJson(send, `void window.__iqaiSpatialV2.dropPin.placeFocus(${FOCUS_A.longitude}, ${FOCUS_A.latitude}, 'map')`);
  await waitUntil(
    send,
    `(() => {
      const f = window.__iqaiSpatialV2?.dropPin?.snapshot?.().focus;
      return Boolean(f) && Math.abs(f.longitude - ${FOCUS_A.longitude}) < 1e-6 && Math.abs(f.latitude - ${FOCUS_A.latitude}) < 1e-6;
    })()`,
    20,
    250
  );
  await sleep(400);
  const mapA = await probe(send);
  const mapAShot = await shot(send, 'test-a-map-focus.png');

  await evaluateJson(send, `void window.__iqaiSpatialV2.viewSwitcher.setView('3D VISUAL')`);
  await waitUntil(send, `window.__iqaiSpatialV2?.google3d?.snapshot?.().stageState === 'OPEN'`, 70, 1000);
  await sleep(3000);
  const threeDA = await probe(send);
  const threeDAShot = await shot(send, 'test-a-3d.png');

  await evaluateJson(send, `void window.__iqaiSpatialV2.viewSwitcher.setView('MAP')`);
  await waitUntil(send, `window.__iqaiSpatialV2?.viewSwitcher?.snapshot?.().activeView === 'map'`, 20, 250);
  await sleep(800);

  await evaluateJson(send, `void window.__iqaiSpatialV2.dropPin.placeFocus(${FOCUS_B.longitude}, ${FOCUS_B.latitude}, 'map')`);
  await waitUntil(
    send,
    `(() => {
      const f = window.__iqaiSpatialV2?.dropPin?.snapshot?.().focus;
      return Boolean(f) && Math.abs(f.longitude - ${FOCUS_B.longitude}) < 1e-6 && Math.abs(f.latitude - ${FOCUS_B.latitude}) < 1e-6;
    })()`,
    20,
    250
  );
  await sleep(400);
  const mapB = await probe(send);
  const mapBShot = await shot(send, 'test-b-map-focus.png');

  await evaluateJson(send, `void window.__iqaiSpatialV2.viewSwitcher.setView('3D VISUAL')`);
  await waitUntil(send, `window.__iqaiSpatialV2?.google3d?.snapshot?.().stageState === 'OPEN'`, 70, 1000);
  await sleep(3000);
  const threeDB = await probe(send);
  const threeDBShot = await shot(send, 'test-b-3d.png');

  await evaluateJson(send, `void window.__iqaiSpatialV2.viewSwitcher.setView('MAP')`);
  await waitUntil(send, `window.__iqaiSpatialV2?.viewSwitcher?.snapshot?.().activeView === 'map'`, 20, 250);
  await sleep(800);
  const preservedB = await probe(send);

  await evaluateJson(send, `void window.__iqaiSpatialV2.viewSwitcher.setView('STREET 360')`);
  await waitUntil(
    send,
    `(() => { const s = window.__iqaiSpatialV2?.street360?.snapshot?.() || {}; return s.stageState === 'OPEN' || s.stageState === 'UNAVAILABLE' || s.stageState === 'ERROR'; })()`,
    40,
    1000
  );
  await sleep(2000);
  const streetB = await probe(send);
  const streetShot = await shot(send, 'test-c-street-360.png');

  await evaluateJson(send, `void window.__iqaiSpatialV2.viewSwitcher.setView('MAP')`);
  await waitUntil(send, `window.__iqaiSpatialV2?.viewSwitcher?.snapshot?.().activeView === 'map'`, 20, 250);
  await sleep(800);

  await evaluateJson(send, `void window.__iqaiSpatialV2.viewSwitcher.setView('3D VISUAL')`);
  await waitUntil(send, `window.__iqaiSpatialV2?.google3d?.snapshot?.().stageState === 'OPEN'`, 70, 1000);
  await sleep(3000);
  const threeDC = await probe(send);
  const threeDCShot = await shot(send, 'test-c-3d.png');

  await evaluateJson(send, `void window.__iqaiSpatialV2.viewSwitcher.setView('MAP')`);
  await waitUntil(send, `window.__iqaiSpatialV2?.viewSwitcher?.snapshot?.().activeView === 'map'`, 20, 250);
  await sleep(800);
  const finalMap = await probe(send);

  return {
    ready: true,
    mapA,
    threeDA,
    mapB,
    threeDB,
    preservedB,
    streetB,
    threeDC,
    finalMap,
    screenshots: {
      mapA: mapAShot,
      threeDA: threeDAShot,
      mapB: mapBShot,
      threeDB: threeDBShot,
      streetB: streetShot,
      threeDC: threeDCShot
    },
    googleErrorKinds: [...new Set(logs.flatMap((row) => row.kinds || []))],
    googleLogs: logs.filter((row) => row.kinds?.length || /google|maps js|oops|auth/i.test(row.text)).slice(0, 20)
  };
});

const focusA = live.mapA?.focus || FOCUS_A;
const focusB = live.mapB?.focus || FOCUS_B;
const targetA = targetOf(live.threeDA);
const targetB = targetOf(live.threeDB);
const targetC = targetOf(live.threeDC);
const matchA = match(focusA, targetA);
const matchB = match(focusB, targetB);
const matchC = match(focusB, targetC);
const pixels = Boolean(
  live.threeDA?.gmp?.w > 200
  && live.threeDA?.gmp?.h > 200
  && live.threeDB?.gmp?.w > 200
  && live.threeDB?.gmp?.h > 200
  && !live.threeDA?.gmErr
  && !live.threeDB?.gmErr
  && !live.threeDA?.authFail
);
const streetOk = live.streetB?.street?.open === true
  && offsetMeters(focusB, live.streetB?.street?.selectedPoint) != null
  && offsetMeters(focusB, live.streetB?.street?.selectedPoint) <= MATCH_METERS;
const returnMap = live.finalMap?.activeView === 'map' || live.finalMap?.spatialView === '2d';
const focusPreserved = offsetMeters(focusB, live.preservedB?.focus) != null
  && offsetMeters(focusB, live.preservedB?.focus) <= 1
  && offsetMeters(focusB, live.finalMap?.focus) != null
  && offsetMeters(focusB, live.finalMap?.focus) <= 1;
const createCount = live.finalMap?.createCount ?? live.threeDC?.createCount ?? null;
const authError = Boolean(live.googleErrorKinds?.length || live.threeDA?.authFail || live.threeDA?.gmErr);
const exact = matchA.pass && matchB.pass && matchC.pass;

const report = {
  origin: `http://localhost:${PORT}/spatial-v2/`,
  focusA,
  worldA: live.mapA?.worldFocus || null,
  targetA,
  matchA,
  focusB,
  worldB: live.mapB?.worldFocus || null,
  targetB,
  matchB,
  targetC,
  matchC,
  pixels,
  streetOk,
  streetState: live.streetB?.street || null,
  returnMap,
  focusPreserved,
  createCount,
  authError,
  googleErrorKinds: live.googleErrorKinds || [],
  exact,
  live
};

fs.writeFileSync(path.join(OUT, 'focus-sync-validate.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify({
  exact,
  pixels,
  streetOk,
  returnMap,
  focusPreserved,
  createCount,
  authError,
  googleErrorKinds: report.googleErrorKinds,
  focusA,
  targetA,
  matchA,
  focusB,
  targetB,
  matchB,
  targetC,
  matchC,
  screenshots: live.screenshots
}, null, 2));
if (!live.ready || !exact || !pixels || !streetOk || !returnMap || !focusPreserved || createCount !== 1 || authError) {
  process.exitCode = 1;
}
