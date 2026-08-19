/**
 * Live Focus V4.6 promotion on Spatial V2 :3047.
 * Does not commit, push, merge, deploy, or write Portal.
 */
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'artifacts', 'spatial-v2-focus-v46');
const PORT = 3047;
const URL = `http://localhost:${PORT}/spatial-v2/`;
const PVM = Object.freeze({ lat: 45.50169, lng: -73.56832 });
const APPROACH = Object.freeze({ lat: 45.50116, lng: -73.56832 });
const AWAY = Object.freeze({ lat: 45.5088, lng: -73.5544 });

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

if (!(await isPortOpen(PORT))) {
  console.log(JSON.stringify({ error: '3047 not listening', result: 'FAIL' }));
  process.exit(1);
}

const browserPath = findBrowser();
if (!browserPath) {
  console.log(JSON.stringify({ error: 'No Chrome/Edge', result: 'FAIL' }));
  process.exit(1);
}

const report = await withCdpPage(browserPath, 9227, async (send) => {
  await send('Page.navigate', { url: URL });
  const loaded = await waitUntil(send, `Boolean(document.querySelector('#iqai-spatial-v2'))`, 40, 250);
  const mapReady = await waitUntil(send, `window.__iqaiSpatialV2?.mapFoundation?.getState?.() === 'READY' || document.querySelector('[data-iqai-map-state="READY"]') != null`, 80, 400);
  const focusReady = await waitUntil(send, `window.__iqaiSpatialV2?.focusInstrument?.getState?.()?.ready === true`, 50, 300);
  await evaluateJson(send, `(() => {
    const view = window.__iqaiSpatialV2?.mapFoundation?.getView?.();
    if (!view) return false;
    view.center = [${PVM.lng}, ${PVM.lat}];
    if (Number.isFinite(view.zoom)) view.zoom = 18;
    return true;
  })()`);
  const zoomed = await waitUntil(send, `Number(window.__iqaiSpatialV2?.mapFoundation?.getView?.()?.scale) > 0 && Number(window.__iqaiSpatialV2.mapFoundation.getView().scale) < 20000`, 40, 250);
  await sleep(800);

  const hoverNear = await evaluateJson(send, `window.__iqaiSpatialV2.focusInstrument.hoverAt(${APPROACH.lat}, ${APPROACH.lng}, { x: 400, y: 300 })`);
  await sleep(120);
  const dwell = await evaluateJson(send, `window.__iqaiSpatialV2.focusInstrument.dwellAt(${PVM.lat}, ${PVM.lng}, { x: 420, y: 310 })`);
  const greenShot = await shot(send, '01-green-candidate.png');
  const hoverObjectRef = dwell?.objectRef || hoverNear?.objectRef || null;

  const sealProbe = await evaluateJson(send, `(async () => {
    const pending = window.__iqaiSpatialV2.focusInstrument.acquireAt(${PVM.lat}, ${PVM.lng});
    await new Promise((resolve) => setTimeout(resolve, 90));
    const during = window.__iqaiSpatialV2.focusInstrument.getState();
    const after = await pending;
    return { during, after };
  })()`);
  const lockShot = await shot(send, '02-bright-red-lock.png');
  const afterLeave = await evaluateJson(send, `(async () => {
    const left = window.__iqaiSpatialV2.focusInstrument.hoverAt(${AWAY.lat}, ${AWAY.lng}, { x: 80, y: 80 });
    return left;
  })()`);
  const persistShot = await shot(send, '03-lock-persists.png');

  const inspector = await evaluateJson(send, `{
    body: document.querySelector('[data-iqai-slot="selected-object-slot"] .iqai-v2-region__body')?.textContent || '',
    state: document.querySelector('[data-iqai-slot="selected-object-slot"] .iqai-v2-region__state')?.textContent || '',
    worldPrimary: window.__iqaiSpatialV2.world()?.selection?.primaryObjectRefId || null,
    worldCount: window.__iqaiSpatialV2.world()?.selection?.objectRefs?.length || 0,
    vm: window.__iqaiSpatialV2.chassis ? null : (window.__iqaiSpatialV2.world ? 'world' : null)
  }`);
  const vm = await evaluateJson(send, `document.querySelector('[data-iqai-slot="selected-object-slot"] .iqai-v2-region__body')?.textContent || ''`);

  const collected = await evaluateJson(send, `window.__iqaiSpatialV2.focusInstrument.addToSet()`);
  const duplicate = await evaluateJson(send, `window.__iqaiSpatialV2.focusInstrument.addToSet()`);
  const csv = await evaluateJson(send, `window.__iqaiSpatialV2.focusInstrument.exportCsv()`);
  const objectAfterCollect = await evaluateJson(send, `window.__iqaiSpatialV2.focusInstrument.getState().objectRef?.id || null`);

  await evaluateJson(send, `(async () => {
    const placed = window.__iqaiSpatialV2.dropPin.placeFocus(${PVM.lng}, ${PVM.lat}, 'map');
    await Promise.race([placed, new Promise((resolve) => setTimeout(resolve, 4000))]);
    return true;
  })()`);
  await sleep(600);
  const objectAfterDropPin = await evaluateJson(send, `window.__iqaiSpatialV2.focusInstrument.getState().objectRef?.id || null`);

  const createBefore = await evaluateJson(send, `window.__iqaiSpatialV2.mapViewCreateCount || window.__iqaiSpatialV2.focusInstrument.getState().mapViewCreateCount`);
  await evaluateJson(send, `document.querySelector('[data-iqai-view="3D VISUAL"]')?.click()`);
  await waitUntil(send, `window.__iqaiSpatialV2.worldViewFrame?.snapshot?.()?.busy !== true`, 40, 250);
  await sleep(800);
  const visualOpen = await evaluateJson(send, `window.__iqaiSpatialV2.google3d?.snapshot?.()?.open === true || document.querySelector('[data-iqai-pane="3D VISUAL"]')?.hidden === false`);
  const camera3d = await evaluateJson(send, `Boolean(document.querySelector('[data-iqai-camera-instrument]'))`);
  const after3d = await evaluateJson(send, `window.__iqaiSpatialV2.focusInstrument.getState()`);
  await evaluateJson(send, `void window.__iqaiSpatialV2.street360.open()`);
  const streetOpen = await waitUntil(
    send,
    `['OPEN','UNAVAILABLE','OPENING'].includes(window.__iqaiSpatialV2.street360?.snapshot?.()?.stageState)`,
    50,
    500
  );
  const streetState = await evaluateJson(send, `window.__iqaiSpatialV2.street360?.snapshot?.()?.stageState || null`);
  const streetSnap = await evaluateJson(send, `{
    stageState: window.__iqaiSpatialV2.street360?.snapshot?.()?.stageState || null,
    open: window.__iqaiSpatialV2.street360?.snapshot?.()?.open === true,
    layout: window.__iqaiSpatialV2.worldViewFrame?.snapshot?.()?.layout || null,
    pairView: window.__iqaiSpatialV2.worldViewFrame?.snapshot?.()?.pairView || null,
    hasFocus: Boolean(window.__iqaiSpatialV2.dropPin?.snapshot?.()?.focus)
  }`);
  const afterStreet = await evaluateJson(send, `window.__iqaiSpatialV2.focusInstrument.getState()`);
  await evaluateJson(send, `document.querySelector('[data-iqai-view="MAP"]')?.click()`);
  await sleep(800);
  const mapShown = await evaluateJson(send, `document.querySelector('[data-iqai-map-shown]')?.getAttribute('data-iqai-map-shown') !== 'false'`);
  const north = await evaluateJson(send, `Boolean(document.querySelector('[data-iqai-north-instrument]'))`);
  const overlay = await evaluateJson(send, `Boolean(document.querySelector('[data-iqai-worldview-overlay], #iqai-v2-worldview-overlay'))`);
  const createAfter = await evaluateJson(send, `window.__iqaiSpatialV2.mapViewCreateCount || window.__iqaiSpatialV2.focusInstrument.getState().mapViewCreateCount`);
  const finalState = await evaluateJson(send, `window.__iqaiSpatialV2.focusInstrument.getState()`);
  const focusOverlay = await evaluateJson(send, `Boolean(document.querySelector('#iqai-v2-focus-overlay'))`);
  const mapViews = await evaluateJson(send, `document.querySelectorAll('.esri-view').length`);
  const tools = await evaluateJson(send, `{
    dropPin: document.querySelector('[data-iqai-drop-pin]')?.textContent || '',
    addSet: Boolean(document.querySelector('[data-iqai-add-set]')),
    csv: Boolean(document.querySelector('[data-iqai-export-csv]'))
  }`);

  return {
    zoomed,
    loaded,
    mapReady,
    focusReady,
    hoverNear,
    dwell,
    hoverObjectRef,
    sealProbe,
    afterLeave,
    inspector: { ...inspector, body: vm },
    collected,
    duplicate,
    csv,
    objectAfterCollect,
    objectAfterDropPin,
    visualOpen,
    camera3d,
    after3dObjectRef: after3d?.objectRef?.id || null,
    streetOpen,
    streetState,
    streetSnap,
    afterStreetObjectRef: afterStreet?.objectRef?.id || null,
    mapShown,
    north,
    overlay,
    createBefore,
    createAfter,
    finalState,
    focusOverlay,
    mapViews,
    tools,
    screenshots: { greenShot, lockShot, persistShot }
  };
});

const acquired = report.sealProbe?.after?.objectRef || report.finalState?.objectRef;
const sensingDwell = report.dwell?.sensing || {};
const sensingLock = report.sealProbe?.during?.sensing || {};
const sensingAfter = report.sealProbe?.after?.sensing || {};
const sensingLeave = report.afterLeave?.sensing || {};
const nrcan = report.finalState?.nrcanFeatureCount ?? report.dwell?.nrcanFeatureCount;
const createCount = report.createAfter ?? report.createBefore;

const gates = {
  spatialLoads: report.loaded === true,
  mapWorks: report.mapReady === true && report.mapShown !== false,
  visual3d: report.visualOpen === true,
    street360: report.streetOpen === true
      || ['OPEN', 'UNAVAILABLE', 'OPENING'].includes(report.streetState)
      || report.streetSnap?.open === true,
  worldview: report.north === true && report.overlay === true,
  oneMapView: createCount === 1 && (report.mapViews == null || report.mapViews <= 2),
  pointerReady: report.focusReady === true,
  greenCandidate: sensingDwell.candidateGreen === true || sensingDwell.green === 1,
  facade: (sensingDwell.contact || 0) >= 1,
  brightRed: sensingAfter.acquiredRed === true || sensingAfter.red === 1,
  lockSeal: (sensingLock.seal || 0) >= 1,
  lockPersists: Boolean(report.afterLeave?.objectRef?.id) && (sensingLeave.acquiredRed === true || sensingLeave.red === 1),
  hoverNotAcquire: report.hoverObjectRef == null,
  objectRef: Boolean(acquired?.id) && acquired.schemaId === 'iqai.spatial.object-ref/1.0.0',
  dropPinDoesNotClearLock: Boolean(report.objectAfterDropPin) && report.objectAfterDropPin === report.objectAfterCollect,
  inspector: String(report.inspector?.body || '').includes('OBJECT ACQUIRED'),
  collected: report.collected?.ok === true && report.duplicate?.reason === 'duplicate',
  csv: report.csv?.ok === true && Array.isArray(report.csv?.header) && report.csv.header[0] === 'object_key',
  nrcan571: nrcan === 571,
  noWorldViewRegression: report.north === true && createCount === 1,
  dropPinLabel: String(report.tools?.dropPin || '').includes('FOCUS')
};

const failed = Object.entries(gates).filter(([, ok]) => !ok).map(([name]) => name);
const result = failed.length === 0 ? 'PASS' : (gates.spatialLoads && gates.objectRef ? 'PARTIAL' : 'FAIL');

const out = {
  result,
  failed,
  gates,
  nrcanFeatureCount: nrcan,
  mapViewCreateCount: createCount,
  objectRefId: acquired?.id || null,
  zoomed: report.zoomed,
  streetState: report.streetState,
  streetSnap: report.streetSnap,
  sensing: {
    hover: report.hoverNear?.sensing || null,
    dwell: report.dwell?.sensing || null,
    duringLock: sensingLock,
    afterLock: sensingAfter,
    afterLeave: sensingLeave
  },
  screenshots: report.screenshots,
  errors: {
    hoverNear: report.hoverNear?.error,
    dwell: report.dwell?.error,
    seal: report.sealProbe?.error,
    inspector: report.inspector?.error
  }
};
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
if (result !== 'PASS') process.exitCode = 1;
