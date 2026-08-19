/**
 * Live acceptance: WOA V1.4 promotion on Spatial V2 :3047.
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
const OUT = path.join(ROOT, 'artifacts', 'spatial-v2-woa-v14');
const PORT = 3047;
const URL = `http://localhost:${PORT}/spatial-v2/`;
const FIX = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/spatial-v2/data/woa/catalog.json'), 'utf8')).fixtures;
const CAM = Object.freeze({ longitude: -73.56726, latitude: 45.50173 });

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

async function goTo(send, lng, lat, zoom = 18) {
  await evaluateJson(send, `(async () => {
    const view = window.__iqaiSpatialV2?.mapFoundation?.getView?.();
    if (!view) return false;
    if (typeof view.goTo === 'function') {
      await view.goTo({ center: [${lng}, ${lat}], zoom: ${zoom} }, { animate: false });
    }
    await window.__iqaiSpatialV2.focusInstrument?.refreshUev?.({
      lat: ${lat},
      lng: ${lng}
    });
    return true;
  })()`);
  await sleep(700);
}

async function acquireClass(send, fixture, objectClass) {
  await evaluateJson(send, `window.__iqaiSpatialV2.focusInstrument.clear()`);
  await goTo(send, fixture.lng, fixture.lat);
  const hover = await evaluateJson(send, `window.__iqaiSpatialV2.focusInstrument.hoverAt(${fixture.lat}, ${fixture.lng}, { x: 420, y: 310 })`);
  await sleep(80);
  const dwell = await evaluateJson(send, `window.__iqaiSpatialV2.focusInstrument.dwellAt(${fixture.lat}, ${fixture.lng}, { x: 420, y: 310 })`);
  const acquired = await evaluateJson(send, `window.__iqaiSpatialV2.focusInstrument.acquireAt(${fixture.lat}, ${fixture.lng})`);
  await sleep(200);
  return {
    hoverClass: hover?.candidate?.objectClass || hover?.hover?.objectClass || null,
    dwellClass: dwell?.candidate?.objectClass || null,
    acquiredClass: acquired?.acquiredClass || acquired?.objectRef?.kind || null,
    sourceId: acquired?.objectRef?.id || null,
    green: hover?.sensing?.candidateGreen === true || dwell?.sensing?.candidateGreen === true,
    red: acquired?.sensing?.acquiredRed === true || acquired?.sensing?.brightRed === true,
    clickOwner: acquired?.clickOwner || hover?.clickOwner || null,
    inspectorHtml: await evaluateJson(send, `document.querySelector('[data-iqai-woa-inspector]') != null`),
    rawOpen: await evaluateJson(send, `document.querySelector('[data-iqai-woa-raw]')?.open === true`)
  };
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

const report = await withCdpPage(browserPath, 9241, async (send) => {
  await send('Page.navigate', { url: URL });
  await waitUntil(send, `Boolean(document.querySelector('#iqai-spatial-v2'))`, 40, 250);
  const mapReady = await waitUntil(send, `window.__iqaiSpatialV2?.mapFoundation?.getState?.() === 'READY' || document.querySelector('[data-iqai-map-state="READY"]') != null`, 80, 400);
  const woaReady = await waitUntil(send, `window.__iqaiSpatialV2?.focusInstrument?.snapshot?.()?.ready === true`, 80, 400);
  await goTo(send, FIX.building.lng, FIX.building.lat);

  const building = await acquireClass(send, FIX.building, 'building');
  await shot(send, '01-building.png');
  const sidewalk = await acquireClass(send, FIX.sidewalk, 'sidewalk');
  await shot(send, '02-sidewalk.png');
  const park = await acquireClass(send, FIX.park, 'park');
  await shot(send, '03-park.png');
  await goTo(send, FIX.evaluation_unit.lng, FIX.evaluation_unit.lat, 19);
  await evaluateJson(send, `(async () => {
    return window.__iqaiSpatialV2.focusInstrument.ensureUevAround(${FIX.evaluation_unit.lat}, ${FIX.evaluation_unit.lng});
  })()`);
  await waitUntil(send, `Number(window.__iqaiSpatialV2.focusInstrument.snapshot()?.uev?.indexed || window.__iqaiSpatialV2.focusInstrument.snapshot()?.counts?.evaluation_unit || 0) > 0`, 30, 400);
  const uevCount = await evaluateJson(send, `window.__iqaiSpatialV2.focusInstrument.snapshot()?.uev || { indexed: window.__iqaiSpatialV2.focusInstrument.snapshot()?.counts?.evaluation_unit || 0 }`);
  const uev = await acquireClass(send, FIX.evaluation_unit, 'evaluation_unit');
  uev.indexed = uevCount?.indexed ?? uevCount?.count ?? uevCount;
  uev.uevStats = uevCount;
  await shot(send, '04-uev.png');

  const hydrantHidden = await evaluateJson(send, `(async () => {
    window.__iqaiSpatialV2.focusInstrument.clear();
    window.__iqaiSpatialV2.focusInstrument.setSourceVisible('hydrant', false);
    return window.__iqaiSpatialV2.focusInstrument.acquireAt(${FIX.hydrant.lat}, ${FIX.hydrant.lng});
  })()`);
  await evaluateJson(send, `window.__iqaiSpatialV2.focusInstrument.setSourceVisible('hydrant', true)`);
  await evaluateJson(send, `window.__iqaiSpatialV2.focusInstrument.setSourceVisible('traffic_signal', true)`);
  await evaluateJson(send, `window.__iqaiSpatialV2.execute('layers.set-visibility', { instanceId: 'woa-hydrant', visible: true })`);
  await evaluateJson(send, `window.__iqaiSpatialV2.execute('layers.set-visibility', { instanceId: 'woa-traffic_signal', visible: true })`);
  await waitUntil(send, `window.__iqaiSpatialV2.focusInstrument.layerSnapshot()?.sources?.find((row) => row.objectClass === 'hydrant')?.visible === true`, 20, 200);
  await waitUntil(send, `window.__iqaiSpatialV2.focusInstrument.layerSnapshot()?.sources?.find((row) => row.objectClass === 'traffic_signal')?.visible === true`, 20, 200);
  await sleep(400);
  const hydrant = await acquireClass(send, FIX.hydrant, 'hydrant');
  await shot(send, '05-hydrant.png');
  const signal = await acquireClass(send, FIX.traffic_signal, 'traffic_signal');
  await shot(send, '06-signal.png');

  const persistence = await evaluateJson(send, `(async () => {
    const locked = window.__iqaiSpatialV2.focusInstrument.getState();
    const afterHover = await window.__iqaiSpatialV2.focusInstrument.hoverAt(45.5088, -73.5544, { x: 80, y: 80 });
    return {
      lockedId: locked.objectRef?.id || null,
      afterId: afterHover.objectRef?.id || null,
      lockedClass: locked.acquiredClass || null
    };
  })()`);

  const inspector = {
    html: signal.inspectorHtml === true || hydrant.inspectorHtml === true || park.inspectorHtml === true,
    raw: true,
    rawOpen: signal.rawOpen === true || hydrant.rawOpen === true,
    kind: signal.acquiredClass || hydrant.acquiredClass || '',
    sheet: await evaluateJson(send, `document.querySelector('#iqai-spatial-v2')?.dataset?.iqaiSheet || ''`)
  };

  const addSet = await evaluateJson(send, `(async () => {
    const first = window.__iqaiSpatialV2.focusInstrument.addToSet();
    const dup = window.__iqaiSpatialV2.focusInstrument.addToSet();
    return { first, dup, count: window.__iqaiSpatialV2.focusInstrument.getState().collected.count };
  })()`);

  const overlap = await evaluateJson(send, `(async () => {
    window.__iqaiSpatialV2.focusInstrument.clear();
    const view = window.__iqaiSpatialV2.mapFoundation.getView();
    if (view?.goTo) await view.goTo({ center: [${FIX.overlap.lng}, ${FIX.overlap.lat}], zoom: 18 }, { animate: false });
    const hover = window.__iqaiSpatialV2.focusInstrument.hoverAt(${FIX.overlap.lat}, ${FIX.overlap.lng}, { x: 400, y: 300 });
    const acquired = await window.__iqaiSpatialV2.focusInstrument.acquireAt(${FIX.overlap.lat}, ${FIX.overlap.lng});
    return {
      hoverClass: hover?.candidate?.objectClass || null,
      acquiredClass: acquired?.acquiredClass || null,
      overlap: acquired?.overlap || hover?.overlap || null
    };
  })()`);

  const placeCamera = await evaluateJson(send, `(async () => {
    const before = window.__iqaiSpatialV2.focusInstrument.getState().objectRef?.id || null;
    await window.__iqaiSpatialV2.placeCamera.arm();
    const armed = window.__iqaiSpatialV2.focusInstrument.getState();
    window.__iqaiSpatialV2.placeCamera.placeAt(${CAM.longitude}, ${CAM.latitude});
    const afterPlace = window.__iqaiSpatialV2.focusInstrument.acquireAt(${FIX.building.lat}, ${FIX.building.lng});
    const cameras = window.__iqaiSpatialV2.placeCamera.snapshot();
    window.__iqaiSpatialV2.placeCamera.disarm();
    const afterDisarm = window.__iqaiSpatialV2.focusInstrument.getState().clickOwner;
    return {
      before,
      armedOwner: armed.clickOwner,
      acquireWhileArmed: afterPlace?.objectRef?.id || null,
      cameraCount: cameras?.cameras?.length || cameras?.count || null,
      afterDisarm
    };
  })()`);

  await evaluateJson(send, `(async () => {
    const placed = window.__iqaiSpatialV2.dropPin.placeFocus(${FIX.building.lng}, ${FIX.building.lat}, 'map');
    await Promise.race([placed, new Promise((resolve) => setTimeout(resolve, 4000))]);
    return true;
  })()`);
  const focus = await evaluateJson(send, `Boolean(window.__iqaiSpatialV2.dropPin?.snapshot?.()?.focus)`);

  const createBefore = await evaluateJson(send, `window.__iqaiSpatialV2.mapViewCreateCount || window.__iqaiSpatialV2.focusInstrument.getState().mapViewCreateCount`);
  await evaluateJson(send, `document.querySelector('[data-iqai-view="3D VISUAL"]')?.click()`);
  await waitUntil(send, `window.__iqaiSpatialV2.worldViewFrame?.snapshot?.()?.busy !== true`, 40, 250);
  await sleep(800);
  const visualOpen = await evaluateJson(send, `window.__iqaiSpatialV2.google3d?.snapshot?.()?.open === true || document.querySelector('[data-iqai-pane="3D VISUAL"]')?.hidden === false`);
  await evaluateJson(send, `void window.__iqaiSpatialV2.street360.open()`);
  await waitUntil(
    send,
    `['OPEN','UNAVAILABLE','OPENING'].includes(window.__iqaiSpatialV2.street360?.snapshot?.()?.stageState)`,
    50,
    500
  );
  const streetState = await evaluateJson(send, `window.__iqaiSpatialV2.street360?.snapshot?.()?.stageState || null`);
  const worldview = await evaluateJson(send, `{
    layout: window.__iqaiSpatialV2.worldViewFrame?.snapshot?.()?.layout || null,
    overlay: Boolean(document.querySelector('[data-iqai-worldview-overlay], #iqai-v2-worldview-overlay'))
  }`);
  const createAfter = await evaluateJson(send, `window.__iqaiSpatialV2.mapViewCreateCount || window.__iqaiSpatialV2.focusInstrument.getState().mapViewCreateCount`);
  const ais = await evaluateJson(send, `{
    env: Boolean(window.__IQAI_AIS_SPATIAL_STREAM),
    autostart: document.body?.innerText?.includes?.('AISStream') ? 'unknown' : 'off-default'
  }`);
  const layers = await evaluateJson(send, `window.__iqaiSpatialV2.focusInstrument.layerSnapshot()`);

  const verdicts = {
    BUILDING: building.acquiredClass === 'building' ? 'PASS' : 'FAIL',
    SIDEWALK: sidewalk.acquiredClass === 'sidewalk' ? 'PASS' : 'FAIL',
    PARK: park.acquiredClass === 'park' ? 'PASS' : 'FAIL',
    UEV: uev.acquiredClass === 'evaluation_unit' && String(uev.sourceId) === String(FIX.evaluation_unit.sourceId) ? 'PASS' : 'FAIL',
    HYDRANT: hydrant.acquiredClass === 'hydrant' ? 'PASS' : 'FAIL',
    TRAFFIC_SIGNAL: signal.acquiredClass === 'traffic_signal' ? 'PASS' : 'FAIL',
    GREEN_CANDIDATE: building.green || sidewalk.green || park.green ? 'PASS' : 'FAIL',
    RED_ACQUIRED_LOCK: building.red || hydrant.red || signal.red ? 'PASS' : 'FAIL',
    PERSISTENCE: persistence.lockedId && persistence.lockedId === persistence.afterId ? 'PASS' : 'FAIL',
    INSPECTOR_V2: inspector.html && inspector.sheet === 'open' ? 'PASS' : 'FAIL',
    ADD_TO_SET: addSet.first?.ok === true && addSet.dup?.ok === false ? 'PASS' : 'FAIL',
    OVERLAP: overlap.acquiredClass === 'building' ? 'PASS' : 'FAIL',
    RAW_SOURCE_COLLAPSED: inspector.html === true && inspector.rawOpen !== true ? 'PASS' : 'FAIL',
    LAYER_VISIBILITY: hydrantHidden?.acquiredClass !== 'hydrant' && hydrant.acquiredClass === 'hydrant' ? 'PASS' : 'FAIL',
    PLACE_CAMERA: placeCamera.armedOwner === 'place-camera' && placeCamera.afterDisarm === 'woa' ? 'PASS' : 'FAIL',
    FOCUS: focus === true ? 'PASS' : 'FAIL',
    WORLDVIEW: worldview.overlay === true || Number(worldview.layout) >= 1 ? 'PASS' : 'FAIL',
    GOOGLE_3D: visualOpen === true ? 'PASS' : 'FAIL',
    STREET360: ['OPEN', 'UNAVAILABLE', 'OPENING'].includes(streetState) ? 'PASS' : 'FAIL',
    MAPVIEW: createBefore === 1 && createAfter === 1 ? 'PASS' : 'FAIL'
  };
  const failed = Object.values(verdicts).filter((value) => value !== 'PASS');
  return {
    result: failed.length ? 'FAIL' : 'PASS',
    mapReady,
    woaReady,
    verdicts,
    building,
    sidewalk,
    park,
    uev,
    hydrantHidden: hydrantHidden?.acquiredClass || hydrantHidden?.objectRef?.kind || null,
    hydrant,
    signal,
    persistence,
    inspector,
    addSet,
    overlap,
    placeCamera,
    streetState,
    worldview,
    createBefore,
    createAfter,
    layers: layers?.sources?.map((row) => `${row.objectClass}:${row.visible}`) || null,
    ais
  };
});

fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify({
  result: report.result,
  verdicts: report.verdicts,
  mapViewCreateCount: report.createAfter,
  out: OUT
}, null, 2));
process.exit(report.result === 'PASS' ? 0 : 1);
