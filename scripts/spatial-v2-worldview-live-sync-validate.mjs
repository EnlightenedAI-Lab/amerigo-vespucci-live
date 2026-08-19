/**
 * Live acceptance: WorldView Live Synchronization V1 on :3047.
 * MAP ↔ 3D follow shared navigation. Street uses genuine panorama events.
 * Does not commit. Does not activate historical imagery.
 */
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'artifacts', 'spatial-v2-worldview-live-sync');
const PORT = 3047;
const FOCUS_A = Object.freeze({ longitude: -73.5535, latitude: 45.5047 });
const PAN_B = Object.freeze({ longitude: -73.5412, latitude: 45.5095 });
const PAN_C = Object.freeze({ longitude: -73.577, latitude: 45.508 });
const MATCH_METERS = 80;

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
  const result = await send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true
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
    const api = window.__iqaiSpatialV2;
    const world = api?.world?.();
    const frame = api?.worldViewFrame?.snapshot?.() || {};
    const visual = api?.google3d?.snapshot?.() || {};
    const street = api?.street360?.snapshot?.() || {};
    const drop = api?.dropPin?.snapshot?.() || {};
    const nav = api?.worldviewNavigation?.snapshot?.() || frame.navigation || null;
    const view = api?.mapFoundation?.getView?.();
    const gmp = document.querySelector('gmp-map-3d');
    const streetCap = api?.worldviewNavigation?.streetLive?.() || api?.street360?.liveCapability?.() || null;
    const requested = world?.temporal?.requested?.instantOrInterval || null;
    const acquisition = world?.temporal?.acquisition?.start || world?.temporal?.acquisition || null;
    return {
      layout: frame.layout || Number(document.getElementById('iqai-spatial-v2')?.dataset.iqaiWorldviewLayout || 0),
      createCount: api?.mapViewCreateCount ?? null,
      gmErr: document.querySelector('.gm-err-message')?.textContent || null,
      echoBudget: null,
      requested,
      acquisition,
      waybackDates: Boolean(document.querySelector('[data-iqai-obs="wayback"]')?.textContent?.match(/\\d{4}-\\d{2}/)),
      nearmapDates: Boolean(document.querySelector('[data-iqai-obs="nearmap"]')?.textContent?.match(/\\d{4}-\\d{2}/)),
      focus: drop.focus ? { longitude: drop.focus.longitude, latitude: drop.focus.latitude } : null,
      navigation: nav ? {
        longitude: nav.longitude,
        latitude: nav.latitude,
        rangeMeters: nav.rangeMeters,
        scale: nav.scale,
        heading: nav.heading,
        sourceView: nav.sourceView,
        revision: nav.revision
      } : null,
      map: {
        longitude: view?.center?.longitude ?? null,
        latitude: view?.center?.latitude ?? null,
        scale: view?.scale ?? null,
        rotation: view?.rotation ?? null
      },
      visual: {
        open: visual.open,
        stageState: visual.stageState,
        selectedPoint: visual.selectedPoint || null,
        camera: visual.camera || null,
        cameraFocusOffsetMeters: visual.cameraFocusOffsetMeters ?? null,
        temporalMode: visual.temporalMode || null,
        displayedAcquisitionLabel: visual.displayedAcquisitionLabel || null,
        gmp: gmp ? { w: gmp.offsetWidth, h: gmp.offsetHeight } : null
      },
      street: {
        open: street.open,
        stageState: street.stageState,
        selectedPoint: street.selectedPoint || null,
        panorama: street.panoramaPosition || null,
        capture: street.capture || null,
        liveCapability: streetCap
      }
    };
  })())`);
}

if (!(await isPortOpen(PORT))) {
  console.log(JSON.stringify({ error: '3047 not listening' }));
  process.exit(1);
}

const browserPath = findBrowser();
const live = await withCdpPage(browserPath, 9318, async (send, logs) => {
  await send('Page.addScriptToEvaluateOnNewDocument', {
    source: `window.gm_authFailure = function () { window.__iqaiGmAuthFailure = true; };`
  });
  await send('Page.navigate', { url: `http://localhost:${PORT}/spatial-v2/?v=worldview-live-sync-1` });
  await send('Page.bringToFront');
  const ready = await waitUntil(
    send,
    `document.querySelector('[data-iqai-map-state]')?.getAttribute('data-iqai-map-state') === 'READY'
      && Boolean(window.__iqaiSpatialV2?.worldViewFrame?.setLayout)
      && Boolean(window.__iqaiSpatialV2?.dropPin?.placeFocus)
      && Boolean(window.__iqaiSpatialV2?.worldviewNavigation?.snapshot)`,
    50,
    1000
  );
  if (!ready) {
    return { ready: false, probe: await probe(send), screenshots: { fail: await shot(send, 'fail-not-ready.png') } };
  }

  await evaluateJson(send, `void window.__iqaiSpatialV2.dropPin.placeFocus(${FOCUS_A.longitude}, ${FOCUS_A.latitude}, 'map')`);
  await waitUntil(send, `Boolean(window.__iqaiSpatialV2.dropPin.snapshot().focus)`, 20, 250);
  await evaluateJson(send, `void window.__iqaiSpatialV2.worldViewFrame.setLayout(3)`);
  await waitUntil(send, `window.__iqaiSpatialV2.google3d.snapshot().stageState === 'OPEN'`, 50, 1000);
  await sleep(2500);
  const baseline = await probe(send);
  const baselineShot = await shot(send, '01-baseline-map-3d.png');

  await evaluateJson(send, `(() => {
    const view = window.__iqaiSpatialV2.mapFoundation.getView();
    view.center = [${PAN_B.longitude}, ${PAN_B.latitude}];
    return true;
  })()`);
  await waitUntil(send, `(() => {
    const cam = window.__iqaiSpatialV2.google3d.snapshot().camera || {};
    const nav = window.__iqaiSpatialV2.worldviewNavigation.snapshot() || {};
    const toRad = (d) => d * Math.PI / 180;
    const off = (aLat, aLon, bLat, bLon) => {
      const dLat = toRad(bLat - aLat);
      const dLon = toRad(bLon - aLon);
      const x = Math.sin(dLat/2)**2 + Math.cos(toRad(aLat))*Math.cos(toRad(bLat))*Math.sin(dLon/2)**2;
      return 2 * 6371000 * Math.asin(Math.min(1, Math.sqrt(x)));
    };
    return off(cam.lat, cam.lng, ${PAN_B.latitude}, ${PAN_B.longitude}) < ${MATCH_METERS}
      && off(nav.latitude, nav.longitude, ${PAN_B.latitude}, ${PAN_B.longitude}) < ${MATCH_METERS};
  })()`, 40, 250);
  await sleep(600);
  const testA = await probe(send);
  const testAShot = await shot(send, '02-map-pan-3d-follow.png');

  const scaleBefore = testA.map?.scale;
  await evaluateJson(send, `(() => {
    const view = window.__iqaiSpatialV2.mapFoundation.getView();
    view.scale = Number(view.scale) / 4;
    return true;
  })()`);
  await waitUntil(send, `(() => {
    const cam = window.__iqaiSpatialV2.google3d.snapshot().camera || {};
    const nav = window.__iqaiSpatialV2.worldviewNavigation.snapshot() || {};
    const before = ${JSON.stringify(testA.visual?.camera?.range ?? null)};
    return Number(cam.range) > 0 && (before == null || Math.abs(Number(cam.range) - Number(before)) / Math.max(Number(before), 1) > 0.15)
      && Number(nav.rangeMeters) > 0;
  })()`, 40, 250);
  await sleep(600);
  const testB = await probe(send);
  const testBShot = await shot(send, '03-map-zoom-3d-scale.png');

  await evaluateJson(send, `(() => {
    const gmp = document.querySelector('gmp-map-3d');
    if (!gmp) return false;
    gmp.center = { lat: ${PAN_C.latitude}, lng: ${PAN_C.longitude}, altitude: 400 };
    gmp.range = 700;
    gmp.heading = 80;
    return true;
  })()`);
  await waitUntil(send, `(() => {
    const view = window.__iqaiSpatialV2.mapFoundation.getView();
    const toRad = (d) => d * Math.PI / 180;
    const off = (aLat, aLon, bLat, bLon) => {
      const dLat = toRad(bLat - aLat);
      const dLon = toRad(bLon - aLon);
      const x = Math.sin(dLat/2)**2 + Math.cos(toRad(aLat))*Math.cos(toRad(bLat))*Math.sin(dLon/2)**2;
      return 2 * 6371000 * Math.asin(Math.min(1, Math.sqrt(x)));
    };
    return off(view.center.latitude, view.center.longitude, ${PAN_C.latitude}, ${PAN_C.longitude}) < ${MATCH_METERS};
  })()`, 40, 250);
  await sleep(800);
  const testC = await probe(send);
  const testCShot = await shot(send, '04-3d-nav-map-follow.png');

  const beforeRev = testC.navigation?.revision || 0;
  await evaluateJson(send, `(() => {
    const view = window.__iqaiSpatialV2.mapFoundation.getView();
    const gmp = document.querySelector('gmp-map-3d');
    view.center = [${PAN_B.longitude}, ${PAN_B.latitude}];
    if (gmp) gmp.center = { lat: ${PAN_C.latitude}, lng: ${PAN_C.longitude}, altitude: 400 };
    setTimeout(() => {
      view.center = [${PAN_C.longitude}, ${PAN_C.latitude}];
      if (gmp) gmp.center = { lat: ${PAN_B.latitude}, lng: ${PAN_B.longitude}, altitude: 400 };
    }, 80);
    setTimeout(() => {
      view.center = [${PAN_C.longitude}, ${PAN_C.latitude}];
    }, 200);
    return true;
  })()`);
  await sleep(1600);
  const testD = await probe(send);
  const testD2 = await probe(send);
  const testDShot = await shot(send, '05-rapid-bidirectional.png');

  await evaluateJson(send, `void window.__iqaiSpatialV2.worldViewFrame.setLayout(3)`);
  await waitUntil(send, `window.__iqaiSpatialV2.street360.snapshot().stageState === 'OPEN' || window.__iqaiSpatialV2.street360.snapshot().stageState === 'UNAVAILABLE'`, 50, 1000);
  await sleep(1500);
  const streetBefore = await probe(send);
  let streetMoved = null;
  if (streetBefore.street?.open) {
    streetMoved = await evaluateJson(send, `JSON.stringify(await window.__iqaiSpatialV2.street360.moveAlongCoverage())`);
    await sleep(2000);
  }
  const testE = await probe(send);
  const testEShot = await shot(send, '06-street-360-live.png');

  const navBeforeClose = testE.navigation;
  await evaluateJson(send, `void window.__iqaiSpatialV2.google3d.close({ restoreMap: false })`);
  await waitUntil(send, `window.__iqaiSpatialV2.google3d.snapshot().stageState === 'IDLE'`, 20, 250);
  await sleep(400);
  await evaluateJson(send, `void window.__iqaiSpatialV2.worldViewFrame.openSupporting('3D VISUAL')`);
  await waitUntil(send, `window.__iqaiSpatialV2.google3d.snapshot().stageState === 'OPEN'`, 50, 1000);
  await sleep(2500);
  const testF = await probe(send);
  const testFShot = await shot(send, '07-reopen-3d-current-nav.png');

  await evaluateJson(send, `window.__iqaiSpatialV2.execute('temporal.set-requested', { instant: '2019-08-15' })`);
  await sleep(800);
  const testG = await probe(send);
  const testGShot = await shot(send, '08-target-time-truth.png');

  return {
    ready: true,
    baseline,
    testA,
    testB,
    testC,
    testD,
    testD2,
    testE,
    testF,
    testG,
    streetMoved,
    navBeforeClose,
    scaleBefore,
    googleErrorKinds: [...new Set(logs.flatMap((row) => row.kinds))],
    screenshots: {
      baseline: baselineShot,
      testA: testAShot,
      testB: testBShot,
      testC: testCShot,
      testD: testDShot,
      testE: testEShot,
      testF: testFShot,
      testG: testGShot
    }
  };
});

const mapPan3d = offsetMeters(live.testA?.visual?.camera, PAN_B);
const mapZoomChanged = Number(live.testB?.visual?.camera?.range) > 0
  && Number(live.baseline?.visual?.camera?.range) > 0
  && Math.abs(Number(live.testB.visual.camera.range) - Number(live.baseline.visual.camera.range))
    / Number(live.baseline.visual.camera.range) > 0.12;
const threeDToMap = offsetMeters(live.testC?.map, PAN_C);
const pingPong = offsetMeters(live.testD?.visual?.camera, live.testD2?.visual?.camera);
const reopen = offsetMeters(live.testF?.visual?.camera, live.navBeforeClose);
const focusPreserved = live.testA?.focus
  && Math.abs(live.testA.focus.longitude - FOCUS_A.longitude) < 0.00001
  && Math.abs(live.testA.focus.latitude - FOCUS_A.latitude) < 0.00001;

const report = {
  origin: `http://localhost:${PORT}/spatial-v2/`,
  ready: live.ready,
  mapPan3dMeters: mapPan3d,
  mapZoomChanged,
  threeDToMapMeters: threeDToMap,
  pingPongMeters: pingPong,
  reopenMeters: reopen,
  focusPreserved,
  createCount: live.testG?.createCount ?? live.testF?.createCount,
  requested: live.testG?.requested,
  acquisition: live.testG?.acquisition,
  currentOnly: live.testG?.visual?.displayedAcquisitionLabel,
  streetCapture: live.testE?.street?.capture || null,
  streetLive: live.testE?.street?.liveCapability || null,
  streetMoved: live.streetMoved,
  inventedWayback: live.testG?.waybackDates === true,
  inventedNearmap: live.testG?.nearmapDates === true,
  authError: Boolean(live.googleErrorKinds?.length || live.testA?.gmErr),
  screenshots: live.screenshots,
  live
};

fs.writeFileSync(path.join(OUT, 'worldview-live-sync-validate.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify({
  ready: report.ready,
  mapPan3dMeters: report.mapPan3dMeters,
  mapZoomChanged: report.mapZoomChanged,
  threeDToMapMeters: report.threeDToMapMeters,
  pingPongMeters: report.pingPongMeters,
  reopenMeters: report.reopenMeters,
  focusPreserved: report.focusPreserved,
  createCount: report.createCount,
  requested: report.requested,
  acquisition: report.acquisition,
  currentOnly: report.currentOnly,
  streetCapture: report.streetCapture,
  streetLive: report.streetLive,
  inventedWayback: report.inventedWayback,
  inventedNearmap: report.inventedNearmap,
  authError: report.authError,
  screenshots: report.screenshots
}, null, 2));

if (
  !live.ready
  || report.createCount !== 1
  || report.authError
  || !report.focusPreserved
  || !(mapPan3d != null && mapPan3d <= MATCH_METERS)
  || !mapZoomChanged
  || !(threeDToMap != null && threeDToMap <= MATCH_METERS)
  || (pingPong != null && pingPong > 250)
  || !(reopen != null && reopen <= MATCH_METERS)
  || report.inventedWayback
  || report.inventedNearmap
) {
  process.exitCode = 1;
}
