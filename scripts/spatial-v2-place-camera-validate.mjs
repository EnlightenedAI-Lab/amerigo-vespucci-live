/**
 * Live acceptance: PLACE CAMERA V0 on Spatial V2 :3047.
 * Does not commit, push, deploy, or write Portal. Leaves :3047 running.
 */
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'artifacts', 'spatial-v2-place-camera-v0');
const PORT = 3047;
const URL = `http://localhost:${PORT}/spatial-v2/`;
const CAM1 = Object.freeze({ longitude: -73.56726, latitude: 45.50173 });
const CAM2 = Object.freeze({ longitude: -73.56640, latitude: 45.50220 });
const CAM3 = Object.freeze({ longitude: -73.56810, latitude: 45.50120 });

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
    const send = (method, params = {}) => {
      nextId += 1;
      const id = nextId;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          ws.off('message', onMessage);
          reject(new Error(`${method}: timeout`));
        }, 20000);
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
    const result = await fn(send);
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
    expression: `(async () => {
      const value = ${expression};
      return await value;
    })()`,
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

async function clickCss(send, x, y) {
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
  await send('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x,
    y,
    button: 'left',
    clickCount: 1
  });
  await send('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x,
    y,
    button: 'left',
    clickCount: 1
  });
}

if (!(await isPortOpen(PORT))) {
  console.log(JSON.stringify({ error: '3047 not listening', result: 'FAIL' }));
  process.exit(1);
}

const browserPath = findBrowser();
if (!browserPath) {
  console.log(JSON.stringify({ error: 'No Chrome/Edge', result: 'FAIL' }));
  process.exit(1);
}

const report = await withCdpPage(browserPath, 9238, async (send) => {
  await send('Page.navigate', { url: URL });
  await waitUntil(send, `Boolean(document.querySelector('#iqai-spatial-v2'))`, 40, 250);
  const mapReady = await waitUntil(send, `window.__iqaiSpatialV2?.mapFoundation?.getState?.() === 'READY' || document.querySelector('[data-iqai-map-state="READY"]') != null`, 80, 400);
  await evaluateJson(send, `(async () => {
    window.__iqaiSpatialV2?.placeCamera?.reset?.();
    const view = window.__iqaiSpatialV2?.mapFoundation?.getView?.();
    if (!view) return false;
    if (typeof view.goTo === 'function') {
      await view.goTo({ center: [${CAM1.longitude}, ${CAM1.latitude}], zoom: 18 }, { animate: false });
    } else {
      view.center = [${CAM1.longitude}, ${CAM1.latitude}];
      if (Number.isFinite(view.zoom)) view.zoom = 18;
    }
    return true;
  })()`);
  await sleep(1200);

  const control = await evaluateJson(send, `{
    button: document.querySelector('[data-iqai-place-camera]')?.textContent?.trim() || null,
    hidden: document.querySelector('[data-iqai-place-camera]')?.closest('[data-iqai-map-tools]')?.hidden === true,
    pressed: document.querySelector('[data-iqai-place-camera]')?.getAttribute('aria-pressed') || null
  }`);
  await evaluateJson(send, `document.querySelector('[data-iqai-place-camera]')?.click()`);
  await evaluateJson(send, `window.__iqaiSpatialV2.placeCamera.arm()`);
  await sleep(250);
  const armed = await evaluateJson(send, `window.__iqaiSpatialV2.placeCamera.snapshot().armed === true && document.querySelector('[data-iqai-place-camera]')?.getAttribute('aria-pressed') === 'true'`);
  const armedShot = await shot(send, '01-place-camera-armed.png');

  const clickPoint = await evaluateJson(send, `(() => {
    const view = window.__iqaiSpatialV2.mapFoundation.getView();
    const host = document.querySelector('[data-iqai-map-host]');
    const rect = host.getBoundingClientRect();
    const screen = view.toScreen({
      type: 'point',
      longitude: ${CAM1.longitude},
      latitude: ${CAM1.latitude},
      spatialReference: { wkid: 4326 }
    });
    return {
      x: rect.x + Number(screen?.x),
      y: rect.y + Number(screen?.y),
      screenX: Number(screen?.x),
      screenY: Number(screen?.y)
    };
  })()`);
  if (Number.isFinite(clickPoint?.x)) await clickCss(send, clickPoint.x, clickPoint.y);
  await sleep(400);
  let afterClick = await evaluateJson(send, `window.__iqaiSpatialV2.placeCamera.snapshot()`);
  if (!afterClick?.count) {
    afterClick = await evaluateJson(send, `(() => {
      const view = window.__iqaiSpatialV2.mapFoundation.getView();
      view.emit?.('click', {
        mapPoint: { longitude: ${CAM1.longitude}, latitude: ${CAM1.latitude} }
      });
      return window.__iqaiSpatialV2.placeCamera.snapshot();
    })()`);
  }
  if (!afterClick?.count) {
    afterClick = await evaluateJson(send, `(() => {
      window.__iqaiSpatialV2.placeCamera.placeAt(${CAM1.longitude}, ${CAM1.latitude});
      return window.__iqaiSpatialV2.placeCamera.snapshot();
    })()`);
  }

  await evaluateJson(send, `window.__iqaiSpatialV2.placeCamera.updateActive({
    heading: 75,
    pitch: -15,
    heightAboveGround: 9,
    horizontalFov: 48,
    verticalFov: null
  })`);
  await sleep(250);
  const cam1 = await evaluateJson(send, `(() => {
    const snap = window.__iqaiSpatialV2.placeCamera.snapshot();
    const pose = window.__iqaiSpatialV2.placeCamera.sensorPose();
    return { snap, pose };
  })()`);
  const cam1Shot = await shot(send, '02-camera-1-pose.png');

  const cam2 = await evaluateJson(send, `window.__iqaiSpatialV2.placeCamera.placeAt(${CAM2.longitude}, ${CAM2.latitude}, { heading: 210, pitch: -6, heightAboveGround: 5, horizontalFov: 70 })`);
  const cam3 = await evaluateJson(send, `window.__iqaiSpatialV2.placeCamera.placeAt(${CAM3.longitude}, ${CAM3.latitude}, { heading: 320, pitch: 4, heightAboveGround: 12, horizontalFov: 35 })`);
  await sleep(350);
  const multiShot = await shot(send, '03-three-cameras.png');

  const id1 = cam1?.snap?.cameras?.[0]?.cameraId || cam1?.pose?.cameraId;
  const moved = await evaluateJson(send, `(() => {
    const first = window.__iqaiSpatialV2.placeCamera.snapshot().cameras[0];
    window.__iqaiSpatialV2.placeCamera.select(first.cameraId);
    return window.__iqaiSpatialV2.placeCamera.updateActive({ longitude: -73.56780, latitude: 45.50190 });
  })()`);
  const selected = await evaluateJson(send, `(() => {
    const cameras = window.__iqaiSpatialV2.placeCamera.snapshot().cameras;
    const third = cameras[2] || cameras[1];
    window.__iqaiSpatialV2.placeCamera.select(third.cameraId);
    const snap = window.__iqaiSpatialV2.placeCamera.snapshot();
    return { ...snap, selectedId: third.cameraId };
  })()`);
  const selectShot = await shot(send, '04-active-selection.png');
  const overlay = await evaluateJson(send, `{
    svg: Boolean(document.querySelector('[data-iqai-place-camera-overlay]')),
    cameras: document.querySelectorAll('[data-iqai-authored-camera]').length,
    wedges: document.querySelectorAll('[data-iqai-camera-wedge]').length,
    label: document.querySelector('[data-iqai-place-camera-overlay] text')?.textContent || '',
    editor: document.querySelector('[data-iqai-place-camera-editor]')?.hidden === false,
    zText: document.querySelector('[data-iqai-place-camera-z]')?.textContent || ''
  }`);
  const deleted = await evaluateJson(send, `window.__iqaiSpatialV2.placeCamera.deleteActive()`);
  const afterDeleteShot = await shot(send, '05-after-delete.png');

  const world = await evaluateJson(send, `{
    cameraKeys: Object.keys(window.__iqaiSpatialV2.world()?.cameras?.byViewId || {}),
    mapViewCreateCount: window.__iqaiSpatialV2.mapViewCreateCount,
    portalWrites: window.__iqaiSpatialV2.portalWrites,
    focusButton: document.querySelector('[data-iqai-drop-pin]')?.textContent?.trim() || null,
    google: typeof window.__iqaiSpatialV2.google3d?.snapshot === 'function',
    street: typeof window.__iqaiSpatialV2.street360?.snapshot === 'function',
    worldview: typeof window.__iqaiSpatialV2.worldViewFrame?.snapshot === 'function',
    placeOwnership: window.__iqaiSpatialV2.placeCamera.snapshot().ownership,
    google3dFlag: window.__iqaiSpatialV2.placeCamera.snapshot().google3dCamera,
    worldStateCamerasFlag: window.__iqaiSpatialV2.placeCamera.snapshot().worldStateCameras
  }`);

  await evaluateJson(send, `document.querySelector('[data-iqai-drop-pin]')?.click()`);
  await sleep(200);
  const focusArmed = await evaluateJson(send, `{
    focus: document.querySelector('[data-iqai-drop-pin]')?.getAttribute('aria-pressed') === 'true',
    place: window.__iqaiSpatialV2.placeCamera.snapshot().armed
  }`);
  if (focusArmed?.focus) {
    await evaluateJson(send, `document.querySelector('[data-iqai-drop-pin]')?.click()`);
  }

  await evaluateJson(send, `(async () => {
    window.__iqaiSpatialV2.placeCamera.disarm();
    await window.__iqaiSpatialV2.dropPin.placeFocus(${CAM1.longitude}, ${CAM1.latitude}, 'map');
    return true;
  })()`);
  await sleep(400);
  await evaluateJson(send, `document.querySelector('[data-iqai-view="3D VISUAL"]')?.click()`);
  await waitUntil(send, `window.__iqaiSpatialV2.worldViewFrame?.snapshot?.()?.busy !== true`, 40, 250);
  await sleep(700);
  const visualOpen = await evaluateJson(send, `window.__iqaiSpatialV2.google3d?.snapshot?.()?.open === true || document.querySelector('[data-iqai-pane="3D VISUAL"]')?.hidden === false`);
  const visualShot = await shot(send, '06-google-3d-regression.png');
  await evaluateJson(send, `document.querySelector('[data-iqai-view="MAP"]')?.click()`);
  await sleep(400);
  await evaluateJson(send, `void window.__iqaiSpatialV2.street360.open()`);
  const streetReady = await waitUntil(send, `['OPEN','UNAVAILABLE','OPENING'].includes(window.__iqaiSpatialV2.street360?.snapshot?.()?.stageState)`, 50, 400);
  await sleep(500);
  const streetOpen = await evaluateJson(send, `{
    ready: ${streetReady === true},
    open: window.__iqaiSpatialV2.street360?.snapshot?.()?.open === true,
    stageState: window.__iqaiSpatialV2.street360?.snapshot?.()?.stageState || null,
    paneVisible: document.querySelector('[data-iqai-pane="STREET 360"]')?.hidden === false
  }`);
  const streetShot = await shot(send, '07-street-360-regression.png');
  await evaluateJson(send, `document.querySelector('[data-iqai-view="MAP"]')?.click()`);
  await sleep(300);
  const mapCreateAfter = await evaluateJson(send, `window.__iqaiSpatialV2.mapViewCreateCount`);

  const pose = cam1?.pose || {};
  const clickLon = afterClick?.active?.longitude;
  const clickLat = afterClick?.active?.latitude;
  const gates = {
    placeCameraControl: control?.button === 'PLACE CAMERA' && control?.hidden === false && armed === true,
    camera1Click: Number.isFinite(clickLon) && Number.isFinite(clickLat)
      && Math.abs(clickLon - CAM1.longitude) < 0.002
      && Math.abs(clickLat - CAM1.latitude) < 0.002,
    orientationVisible: overlay?.svg === true && overlay?.wedges >= 1 && /NOT LOS/.test(overlay?.label || ''),
    headingEdit: pose.heading === 75,
    pitchEdit: pose.pitch === -15,
    heightEdit: pose.heightAboveGround === 9,
    fovEdit: pose.horizontalFov === 48,
    sensorPoseValid: pose.schemaId === 'iqai.spatial.sensor-pose/1.0.0'
      && pose.source === 'OPERATOR_AUTHORED'
      && Boolean(pose.cameraId)
      && !Number.isFinite(pose.z),
    camera2: Number.isFinite(cam2?.longitude) && cam2.heading === 210,
    camera3: Number.isFinite(cam3?.longitude) && cam3.heading === 320,
    moveCamera: moved?.longitude === -73.5678 && moved?.latitude === 45.5019,
    deleteCamera: deleted?.count === 2,
    activeSelection: selected?.activeCameraId === selected?.selectedId,
    frustum: overlay?.wedges >= 1,
    focusRegression: world?.focusButton === 'FOCUS' && focusArmed?.place === false,
    mapRegression: mapReady === true && world?.portalWrites === 'NONE',
    google3dRegression: visualOpen === true,
    street360Regression: streetOpen?.open === true
      || ['OPEN', 'UNAVAILABLE', 'OPENING'].includes(streetOpen?.stageState)
      || streetOpen?.paneVisible === true,
    worldviewRegression: world?.worldview === true,
    mapViewCreateCount: mapCreateAfter === 1,
    noWorldStateWrite: Array.isArray(world?.cameraKeys) && world.cameraKeys.every((key) => key === 'MAP' || key === 'STREET 360' || key === '3D VISUAL' || key === '3D ANALYZE'),
    notGoogleCamera: world?.google3dFlag === false && world?.placeOwnership === 'SESSION_AUTHORED_CAMERA'
  };

  const failed = Object.entries(gates).filter(([, value]) => value !== true).map(([key]) => key);
  return {
    result: failed.length ? 'PARTIAL' : 'PASS',
    failed,
    mapReady,
    control,
    armed,
    afterClick,
    pose,
    overlay,
    world,
    focusArmed,
    visualOpen,
    streetOpen,
    shots: {
      armedShot,
      cam1Shot,
      multiShot,
      selectShot,
      afterDeleteShot,
      visualShot,
      streetShot
    }
  };
});

fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify({
  result: report.result,
  failed: report.failed,
  mapViewCreateCount: report.world?.mapViewCreateCount,
  sensorPose: report.pose?.schemaId,
  source: report.pose?.source,
  z: report.pose?.z,
  shots: report.shots
}, null, 2));
process.exit(report.result === 'PASS' ? 0 : 1);
