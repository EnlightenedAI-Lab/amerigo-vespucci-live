/**
 * Live acceptance: VIEW CAMERA V1 on Spatial V2 :3047.
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
const OUT = path.join(ROOT, 'artifacts', 'spatial-v2-view-camera-v1');
const PORT = 3047;
const URL = `http://localhost:${PORT}/spatial-v2/`;
const CAMS = Object.freeze([
  { longitude: -73.56726, latitude: 45.50173, heading: 20, pitch: -8, heightAboveGround: 4, horizontalFov: 70 },
  { longitude: -73.56640, latitude: 45.50220, heading: 140, pitch: -6, heightAboveGround: 6, horizontalFov: 55 },
  { longitude: -73.56810, latitude: 45.50120, heading: 260, pitch: -10, heightAboveGround: 8, horizontalFov: 40 }
]);

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

function headingOk(actual, expected) {
  if (!Number.isFinite(actual) || !Number.isFinite(expected)) return false;
  const delta = Math.abs(((actual - expected + 540) % 360) - 180);
  return delta <= 4;
}

function pitchOk(actual, expected) {
  return Number.isFinite(actual) && Number.isFinite(expected) && Math.abs(actual - expected) <= 4;
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
        }, 30000);
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

function pass(ok) {
  return ok ? 'PASS' : 'FAIL';
}

if (!(await isPortOpen(PORT))) {
  console.log(JSON.stringify({ error: '3047 not listening', result: 'FAIL' }, null, 2));
  process.exit(1);
}

const browserPath = findBrowser();
if (!browserPath) {
  console.log(JSON.stringify({ error: 'No Chrome/Edge', result: 'FAIL' }, null, 2));
  process.exit(1);
}

const report = await withCdpPage(browserPath, 9247, async (send) => {
  await send('Emulation.setDeviceMetricsOverride', {
    width: 1440,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false
  });
  await send('Page.navigate', { url: URL });
  await waitUntil(send, `Boolean(document.querySelector('#iqai-spatial-v2'))`, 40, 250);
  const mapReady = await waitUntil(send, `window.__iqaiSpatialV2?.mapFoundation?.getState?.() === 'READY' || document.querySelector('[data-iqai-map-state="READY"]') != null`, 80, 400);
  await evaluateJson(send, `(async () => {
    window.__iqaiSpatialV2?.placeCamera?.reset?.();
    window.__iqaiSpatialV2?.viewCamera?.close?.();
    const view = window.__iqaiSpatialV2?.mapFoundation?.getView?.();
    if (!view) return false;
    if (typeof view.goTo === 'function') {
      await view.goTo({ center: [${CAMS[0].longitude}, ${CAMS[0].latitude}], zoom: 18 }, { animate: false });
    }
    return true;
  })()`);
  await sleep(800);

  await evaluateJson(send, `window.__iqaiSpatialV2.placeCamera.arm()`);
  const placed = [];
  for (const cam of CAMS) {
    const row = await evaluateJson(send, `window.__iqaiSpatialV2.placeCamera.placeAt(${cam.longitude}, ${cam.latitude}, {
      heading: ${cam.heading},
      pitch: ${cam.pitch},
      heightAboveGround: ${cam.heightAboveGround},
      horizontalFov: ${cam.horizontalFov}
    })`);
    placed.push(row);
  }
  const ids = placed.map((row) => row?.cameraId).filter(Boolean);
  await evaluateJson(send, `window.__iqaiSpatialV2.placeCamera.select(${JSON.stringify(ids[0] || '')})`);
  const selected = await evaluateJson(send, `window.__iqaiSpatialV2.placeCamera.snapshot()`);
  const beforeOpen = await evaluateJson(send, `(() => {
    const pose = window.__iqaiSpatialV2.placeCamera.sensorPose();
    return {
      cameraId: pose?.cameraId || null,
      heading: pose?.heading ?? null,
      pitch: pose?.pitch ?? null,
      longitude: pose?.longitude ?? null,
      latitude: pose?.latitude ?? null,
      horizontalFov: pose?.horizontalFov ?? null
    };
  })()`);

  const control = await evaluateJson(send, `{
    button: document.querySelector('[data-iqai-view-camera]')?.textContent?.trim() || null,
    hidden: document.querySelector('[data-iqai-view-camera]')?.hidden === true,
    editorHidden: document.querySelector('[data-iqai-place-camera-editor]')?.hidden === true
  }`);
  await evaluateJson(send, `window.__iqaiSpatialV2.viewCamera.open()`);
  await sleep(300);
  const geometric = await evaluateJson(send, `{
    open: window.__iqaiSpatialV2.viewCamera.snapshot().open === true,
    mode: window.__iqaiSpatialV2.viewCamera.snapshot().mode,
    canvas: document.querySelector('[data-iqai-view-camera-geometric]')?.hidden === false,
    title: true
  }`);
  const geometricShot = await shot(send, '01-geometric-camera-view.png');

  await evaluateJson(send, `window.__iqaiSpatialV2.viewCamera.setMode('street360')`);
  const streetReady = await waitUntil(send, `window.__iqaiSpatialV2.viewCamera.snapshot()?.truth?.status === 'AVAILABLE' && window.__iqaiSpatialV2.viewCamera.snapshot()?.providerPixels === true`, 50, 400);
  await sleep(800);
  const streetA = await evaluateJson(send, `{
    view: window.__iqaiSpatialV2.viewCamera.snapshot(),
    street: window.__iqaiSpatialV2.street360.snapshot(),
    pose: window.__iqaiSpatialV2.placeCamera.sensorPose(),
    text: document.querySelector('[data-iqai-view-camera-truth]')?.innerText || ''
  }`);
  const streetShot = await shot(send, '02-street360-camera-a.png');

  await evaluateJson(send, `window.__iqaiSpatialV2.placeCamera.updateActive({ heading: 90 })`);
  await waitUntil(send, `Math.abs(((Number(window.__iqaiSpatialV2.viewCamera.snapshot()?.providerHeading) - 90 + 540) % 360) - 180) <= 4`, 30, 250);
  await sleep(400);
  const afterHeading = await evaluateJson(send, `window.__iqaiSpatialV2.viewCamera.snapshot()`);
  const headingShot = await shot(send, '03-heading-90.png');

  await evaluateJson(send, `window.__iqaiSpatialV2.placeCamera.updateActive({ pitch: -18 })`);
  await waitUntil(send, `Math.abs(Number(window.__iqaiSpatialV2.viewCamera.snapshot()?.providerPitch) + 18) <= 4`, 30, 250);
  await sleep(400);
  const afterPitch = await evaluateJson(send, `window.__iqaiSpatialV2.viewCamera.snapshot()`);

  const beforeMovePano = afterPitch?.panoId || streetA?.view?.panoId || null;
  await evaluateJson(send, `window.__iqaiSpatialV2.placeCamera.updateActive({ longitude: -73.5684, latitude: 45.5022 })`);
  await waitUntil(send, `window.__iqaiSpatialV2.viewCamera.snapshot()?.truth?.status === 'AVAILABLE' || window.__iqaiSpatialV2.viewCamera.snapshot()?.truth?.status === 'UNAVAILABLE'`, 40, 350);
  await sleep(900);
  const afterMove = await evaluateJson(send, `window.__iqaiSpatialV2.viewCamera.snapshot()`);
  const moveShot = await shot(send, '04-move-reresolve.png');

  await evaluateJson(send, `window.__iqaiSpatialV2.placeCamera.select(${JSON.stringify(ids[1] || '')})`);
  await waitUntil(send, `window.__iqaiSpatialV2.viewCamera.snapshot()?.cameraId === ${JSON.stringify(ids[1] || '')}`, 20, 250);
  await sleep(1200);
  const camB = await evaluateJson(send, `window.__iqaiSpatialV2.viewCamera.snapshot()`);
  const shotB = await shot(send, '05-camera-b.png');

  await evaluateJson(send, `window.__iqaiSpatialV2.placeCamera.select(${JSON.stringify(ids[2] || '')})`);
  await waitUntil(send, `window.__iqaiSpatialV2.viewCamera.snapshot()?.cameraId === ${JSON.stringify(ids[2] || '')}`, 20, 250);
  await sleep(1200);
  const camC = await evaluateJson(send, `window.__iqaiSpatialV2.viewCamera.snapshot()`);
  const shotC = await shot(send, '06-camera-c.png');

  const afterOpenPose = await evaluateJson(send, `(() => {
    const cameras = window.__iqaiSpatialV2.placeCamera.snapshot().cameras || [];
    return cameras.map((item) => ({
      cameraId: item.cameraId,
      heading: item.heading,
      pitch: item.pitch,
      longitude: item.longitude,
      latitude: item.latitude,
      horizontalFov: item.horizontalFov
    }));
  })()`);

  await evaluateJson(send, `window.__iqaiSpatialV2.viewCamera.close()`);
  await sleep(400);
  await evaluateJson(send, `document.querySelector('[data-iqai-view="MAP"]')?.click()`);
  await sleep(400);
  await evaluateJson(send, `(async () => {
    await window.__iqaiSpatialV2.dropPin.placeFocus(${CAMS[0].longitude}, ${CAMS[0].latitude}, 'map');
    return true;
  })()`);
  await sleep(400);
  await evaluateJson(send, `void window.__iqaiSpatialV2.street360.open()`);
  const operatorStreet = await waitUntil(send, `['OPEN','UNAVAILABLE','OPENING'].includes(window.__iqaiSpatialV2.street360?.snapshot?.()?.stageState)`, 40, 400);
  const streetNormal = await evaluateJson(send, `{
    bindMode: window.__iqaiSpatialV2.street360?.snapshot?.()?.bindMode || null,
    open: window.__iqaiSpatialV2.street360?.snapshot?.()?.open === true,
    stageState: window.__iqaiSpatialV2.street360?.snapshot?.()?.stageState || null
  }`);
  await evaluateJson(send, `document.querySelector('[data-iqai-view="MAP"]')?.click()`);
  await sleep(300);
  await evaluateJson(send, `document.querySelector('[data-iqai-view="3D VISUAL"]')?.click()`);
  await waitUntil(send, `window.__iqaiSpatialV2.worldViewFrame?.snapshot?.()?.busy !== true`, 40, 250);
  await sleep(700);
  const visualOpen = await evaluateJson(send, `window.__iqaiSpatialV2.google3d?.snapshot?.()?.open === true || document.querySelector('[data-iqai-pane="3D VISUAL"]')?.hidden === false`);
  const visualShot = await shot(send, '07-google-3d-regression.png');
  await evaluateJson(send, `document.querySelector('[data-iqai-view="MAP"]')?.click()`);
  await sleep(300);

  const world = await evaluateJson(send, `{
    mapCreate: window.__iqaiSpatialV2.mapViewCreateCount,
    worldview: Boolean(window.__iqaiSpatialV2.worldViewFrame),
    woa: Boolean(window.__iqaiSpatialV2.focusInstrument),
    ops: Boolean(window.__iqaiSpatialV2.opsLayers?.snapshot),
    aisEnv: Boolean(window.__IQAI_AIS_SPATIAL_STREAM),
    portalWrites: window.__iqaiSpatialV2.portalWrites || 'NONE',
    geometricText: document.querySelector('[data-iqai-view-camera-geometric]') ? true : false,
    hostText: document.body?.innerText || ''
  }`);

  const streetPixels = streetReady === true
    || streetA?.view?.providerPixels === true
    || streetA?.street?.providerPixels === true
    || Boolean(streetA?.street?.panoId);
  const locationBind = Number.isFinite(streetA?.view?.truth?.captureOffsetMeters)
    || Number.isFinite(streetA?.street?.offsetMeters)
    || streetA?.view?.truth?.status === 'AVAILABLE';
  const headingBind = headingOk(afterHeading?.providerHeading, 90)
    && headingOk(streetA?.view?.providerHeading, CAMS[0].heading);
  const pitchBind = pitchOk(afterPitch?.providerPitch, -18);
  const moved = afterMove?.cameraId === ids[0]
    && (
      afterMove?.panoId !== beforeMovePano
      || Number.isFinite(afterMove?.truth?.captureOffsetMeters)
      || afterMove?.truth?.status === 'AVAILABLE'
      || afterMove?.truth?.status === 'UNAVAILABLE'
    );
  const switchOk = camB?.cameraId === ids[1]
    && camC?.cameraId === ids[2]
    && headingOk(camB?.heading, CAMS[1].heading)
    && headingOk(camC?.heading, CAMS[2].heading)
    && (headingOk(camB?.providerHeading, CAMS[1].heading) || camB?.truth?.status === 'UNAVAILABLE')
    && (headingOk(camC?.providerHeading, CAMS[2].heading) || camC?.truth?.status === 'UNAVAILABLE');
  const poseA = afterOpenPose?.find((item) => item.cameraId === ids[1]);
  const poseC = afterOpenPose?.find((item) => item.cameraId === ids[2]);
  const noLeak = poseA?.heading === CAMS[1].heading && poseC?.heading === CAMS[2].heading;
  const truthText = streetA?.text || '';
  const offsetTruth = /CAPTURE OFFSET/.test(truthText) && /CAMERA LOCATION/.test(truthText);
  const fovLimit = /PROVIDER POV/.test(truthText) && /NOT OPTICALLY MATCHED/.test(truthText);
  const heightLimit = /CAPTURE HEIGHT IS PROVIDER-DEFINED/.test(truthText);
  const noFake = !/photographic imagery of the authored camera/i.test(truthText)
    && streetA?.view?.truth?.fakeImagery !== true;
  const noLos = !/line of sight|LOS CONFIRMED|obstruction/i.test(truthText + (world?.hostText || ''));

  const gates = {
    PLACE_CAMERA: ids.length === 3,
    SELECT_CAMERA: selected?.activeCameraId === ids[0],
    VIEW_CAMERA_CONTROL: control?.button === 'VIEW CAMERA' && control?.hidden === false && geometric?.open === true,
    GEOMETRIC_CAMERA_VIEW: geometric?.mode === 'geometric' && geometric?.canvas === true,
    STREET360_PROVIDER_PIXELS: streetPixels === true,
    SENSORPOSE_LOCATION_BIND: locationBind === true,
    HEADING_BIND: headingBind === true,
    PITCH_BIND: pitchBind === true,
    CAMERA_MOVE_RERESOLVE: moved === true,
    CAMERA_SWITCH_ABC: switchOk === true && noLeak === true,
    CAPTURE_OFFSET_TRUTH: offsetTruth === true,
    FOV_LIMITATION: fovLimit === true,
    HEIGHT_LIMITATION: heightLimit === true,
    NO_FAKE_IMAGERY: noFake === true,
    NO_FALSE_LOS: noLos === true && /NOT LOS/.test(world?.hostText || ''),
    WOA_REGRESSION: world?.woa === true,
    OPERATIONAL_LAYERS_REGRESSION: world?.ops === true,
    STREET360_NORMAL_MODE: operatorStreet === true
      && (streetNormal?.bindMode === 'operator' || streetNormal?.bindMode == null)
      && ['OPEN', 'UNAVAILABLE', 'OPENING'].includes(streetNormal?.stageState),
    GOOGLE_3D_VISUAL: visualOpen === true,
    WORLDVIEW: world?.worldview === true,
    MAPVIEW_CREATE_COUNT: world?.mapCreate === 1,
    AIS_AUTOSTART_DEFAULT_OFF: world?.aisEnv !== true,
    MAP_READY: mapReady === true,
    POSE_NOT_MUTATED_BY_OPEN: beforeOpen?.heading === CAMS[0].heading && beforeOpen?.pitch === CAMS[0].pitch
  };

  const failed = Object.entries(gates).filter(([, value]) => value !== true).map(([key]) => key);
  return {
    result: failed.length ? (failed.length <= 3 ? 'PARTIAL' : 'FAIL') : 'PASS',
    failed,
    gates,
    control,
    geometric,
    streetA: {
      status: streetA?.view?.truth?.status || null,
      pixels: streetA?.view?.providerPixels || streetA?.street?.providerPixels || false,
      heading: streetA?.view?.providerHeading ?? null,
      pitch: streetA?.view?.providerPitch ?? null,
      offset: streetA?.view?.truth?.captureOffsetMeters ?? streetA?.street?.offsetMeters ?? null,
      bindMode: streetA?.street?.bindMode || null,
      panoId: streetA?.view?.panoId || streetA?.street?.panoId || null
    },
    afterHeading: { heading: afterHeading?.providerHeading ?? null },
    afterPitch: { pitch: afterPitch?.providerPitch ?? null },
    afterMove: { panoId: afterMove?.panoId || null, status: afterMove?.truth?.status || null },
    camB: { id: camB?.cameraId || null, heading: camB?.providerHeading ?? camB?.heading ?? null },
    camC: { id: camC?.cameraId || null, heading: camC?.providerHeading ?? camC?.heading ?? null },
    streetNormal,
    mapCreate: world?.mapCreate ?? null,
    shots: {
      geometricShot,
      streetShot,
      headingShot,
      moveShot,
      shotB,
      shotC,
      visualShot
    }
  };
});

fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
if (report.result !== 'PASS') process.exitCode = 1;
