/**
 * Live proof: compact selectors + large active 360 viewer on :3052.
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
const OUT = path.join(ROOT, 'artifacts', 'spatial-v2-camera-wall-large-viewer-v1');
const PORT = 3052;
const URL = `http://localhost:${PORT}/spatial-v2/?v=camera-federation-v1`;
const PIN = Object.freeze({
  longitude: -73.553221995734,
  latitude: 45.494180980834
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
    console.error('LIVE chrome version ok');
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
      const timeoutMs = method === 'Page.captureScreenshot' ? 60000 : 20000;
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

async function shot(send, name) {
  try {
    const result = await send('Page.captureScreenshot', { format: 'png' });
    const file = path.join(OUT, name);
    fs.writeFileSync(file, Buffer.from(result.data, 'base64'));
    return file;
  } catch (error) {
    return { error: String(error?.message || error) };
  }
}

const SNAPSHOT_EXPR = `(() => {
  const api = window.__iqaiSpatialV2;
  const wall = api.cameraWall?.snapshot?.() || {};
  const query = api.cameraRelevance?.snapshot?.() || {};
  const placed = api.placeCamera?.snapshot?.() || {};
  const world = api.world();
  const stage = document.querySelector('[data-iqai-camera-wall-heavy-stage]');
  const selector = document.querySelector('[data-iqai-camera-wall-selector]');
  const selectorThumb = document.querySelector('[data-iqai-camera-wall-selector-thumb]');
  return {
    available: query.cameraCount ?? null,
    relevant: query.relevantCount ?? null,
    placedCount: placed.count ?? null,
    cameras: (placed.cameras || []).map((item) => ({
      cameraId: item.cameraId,
      longitude: item.longitude,
      latitude: item.latitude,
      heading: item.heading,
      pitch: item.pitch,
      horizontalFov: item.horizontalFov,
      modelId: item.modelId || null
    })),
    wallOpen: wall.wall?.open === true,
    slotCount: wall.wall?.slotCount ?? null,
    selectorCount: document.querySelectorAll('[data-iqai-camera-wall-selector]').length,
    layout: wall.layout || document.querySelector('[data-iqai-camera-wall]')?.getAttribute('data-iqai-camera-wall-layout') || null,
    activeSlotId: wall.wall?.activeSlotId || null,
    activeCamera: document.querySelector('[data-iqai-camera-wall-active-camera]')?.textContent || null,
    activeProvider: document.querySelector('[data-iqai-camera-wall-active-provider]')?.textContent || null,
    virtualViewText: document.querySelector('[data-iqai-camera-wall-virtual-view]')?.textContent || null,
    truthText: document.querySelector('[data-iqai-camera-wall-heavy-label]')?.textContent || null,
    poseTruth: document.querySelector('[data-iqai-camera-wall-pose-truth]')?.textContent || null,
    maxHeavyViewers: wall.representations?.maxHeavyViewers ?? wall.wall?.maxHeavyViewers ?? null,
    heavyDomCount: document.querySelectorAll('[data-iqai-camera-wall-heavy-kind]').length,
    heavyKind: document.querySelector('[data-iqai-camera-wall-heavy-kind]')?.getAttribute('data-iqai-camera-wall-heavy-kind') || null,
    liveDecoders: wall.liveDecoders ?? null,
    stageHeightPx: stage ? Math.round(stage.getBoundingClientRect().height) : null,
    selectorHeightPx: selector ? Math.round(selector.getBoundingClientRect().height) : null,
    selectorThumbHeightPx: selectorThumb ? Math.round(selectorThumb.getBoundingClientRect().height) : null,
    viewport: { width: window.innerWidth, height: window.innerHeight },
    cameraInSelection: (world.selection?.objectRefs || []).some((ref) => ref.authority === 'iqai.camera'),
    visibilityTested: query.visibilityTested,
    observationClaim: query.observationClaim,
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

console.error('LIVE start', { PORT, URL, browserPath });

let live;
try {
  live = await withCdpPage(browserPath, 9371, async (send) => {
  console.error('LIVE navigate');
  await send('Page.navigate', { url: URL });
  console.error('LIVE waiting for Spatial API');
  const apiReady = await waitUntil(send, `Boolean(window.__iqaiSpatialV2 && window.__iqaiSpatialV2.dropPin && window.__iqaiSpatialV2.cameraWall)`, 60, 200);
  console.error('LIVE apiReady', apiReady);

  await evaluateJson(send, `(async () => {
    document.querySelector('[data-iqai-drop-pin]')?.click();
    await window.__iqaiSpatialV2.dropPin.placeFromSearch({
      longitude: ${PIN.longitude},
      latitude: ${PIN.latitude},
      address: '997 de la Commune Ouest, Montréal'
    });
    return true;
  })()`);
  await waitUntil(
    send,
    `Boolean(window.__iqaiSpatialV2.world()?.activeFocus?.longitude || window.__iqaiSpatialV2.world()?.activeFocus?.geometry)`,
    40,
    200
  );

  await evaluateJson(send, `document.querySelector('[data-iqai-camera-coverage-generate]')?.click(); true`);
  await waitUntil(
    send,
    `window.__iqaiSpatialV2.placeCamera?.snapshot?.()?.count === 3
      && document.querySelectorAll('[data-iqai-camera-wall-selector]').length === 3`,
    80,
    400
  );
  await waitUntil(
    send,
    `Boolean(document.querySelector('[data-iqai-camera-wall-heavy-kind]'))`,
    50,
    400
  );
  await sleep(8000);
  console.error('LIVE snapshot after generate');

  const afterGenerate = await evaluateJson(send, SNAPSHOT_EXPR);
  console.error('LIVE afterGenerate keys', afterGenerate && Object.keys(afterGenerate));
  const poseBeforeView = afterGenerate?.cameras || [];
  console.error('LIVE screenshot 01');
  const shotWall = await shot(send, '01-large-active-360.png');

  const afterPan = await evaluateJson(send, `(() => {
    window.__iqaiSpatialV2.cameraWall.applyVirtualView({
      heading: 42,
      pitch: 10,
      zoom: 2
    });
    return {
      virtualViewText: document.querySelector('[data-iqai-camera-wall-virtual-view]')?.textContent || null
    };
  })()`);
  await sleep(1200);
  const afterView = await evaluateJson(send, SNAPSHOT_EXPR);
  console.error('LIVE screenshot 02');
  const shotPanned = await shot(send, '02-virtual-pan-tilt-zoom.png');

  const switched02 = await evaluateJson(send, `(() => {
    const slots = Array.from(document.querySelectorAll('[data-iqai-camera-wall-selector]'));
    slots[1]?.click();
    return slots[1]?.getAttribute('data-iqai-camera-wall-slot') || null;
  })()`);
  await sleep(3500);
  const after02 = await evaluateJson(send, SNAPSHOT_EXPR);
  const shot02 = await shot(send, '03-camera-02.png');

  const switched03 = await evaluateJson(send, `(() => {
    const slots = Array.from(document.querySelectorAll('[data-iqai-camera-wall-selector]'));
    slots[2]?.click();
    return slots[2]?.getAttribute('data-iqai-camera-wall-slot') || null;
  })()`);
  await sleep(3500);
  const after03 = await evaluateJson(send, SNAPSHOT_EXPR);
  const shot03 = await shot(send, '04-camera-03.png');

  const switched01 = await evaluateJson(send, `(() => {
    const slots = Array.from(document.querySelectorAll('[data-iqai-camera-wall-selector]'));
    slots[0]?.click();
    return slots[0]?.getAttribute('data-iqai-camera-wall-slot') || null;
  })()`);
  await sleep(2500);
  const after01again = await evaluateJson(send, SNAPSHOT_EXPR);

  await evaluateJson(send, `document.querySelector('[data-iqai-camera-wall-close]')?.click(); true`);
  await sleep(800);
  const afterClose = await evaluateJson(send, SNAPSHOT_EXPR);
  const shotClose = await shot(send, '05-close-wall-cameras-preserved.png');

  return {
    afterGenerate,
    afterPan,
    afterView,
    poseBeforeView,
    switched02,
    after02,
    switched03,
    after03,
    switched01,
    after01again,
    afterClose,
    shots: { shotWall, shotPanned, shot02, shot03, shotClose }
  };
  });
} catch (error) {
  console.log(JSON.stringify({ RESULT: 'FAIL', error: String(error?.stack || error?.message || error) }));
  process.exit(1);
}

const poseUnchanged = JSON.stringify(live.afterGenerate?.cameras)
  === JSON.stringify(live.afterView?.cameras)
  && JSON.stringify(live.afterGenerate?.cameras) === JSON.stringify(live.after02?.cameras)
  && JSON.stringify(live.afterGenerate?.cameras) === JSON.stringify(live.after03?.cameras);
const viewerLarger = Number(live.afterGenerate?.stageHeightPx) >= 350
  && Number(live.afterGenerate?.stageHeightPx) <= 520
  && Number(live.afterGenerate?.stageHeightPx) > Number(live.afterGenerate?.selectorHeightPx || 0);
const heavyOne = live.afterGenerate?.heavyDomCount === 1
  && live.after02?.heavyDomCount === 1
  && live.after03?.heavyDomCount === 1
  && live.after01again?.heavyDomCount === 1;
const pass = live.afterGenerate?.available === 3
  && live.afterGenerate?.relevant === 3
  && live.afterGenerate?.selectorCount === 3
  && live.afterGenerate?.layout === 'master-detail'
  && viewerLarger
  && live.afterGenerate?.maxHeavyViewers === 1
  && heavyOne
  && poseUnchanged
  && live.afterGenerate?.visibilityTested === false
  && live.afterGenerate?.observationClaim === false
  && live.afterGenerate?.cameraInSelection === false
  && live.afterClose?.placedCount === 3
  && live.afterClose?.wallOpen === false
  && /VIRTUAL VIEW/.test(live.afterGenerate?.virtualViewText || '')
  && /NOT CAMERA FEED/.test(live.afterGenerate?.truthText || '');

const report = {
  RESULT: pass ? 'PASS' : 'FAIL',
  viewerLarger,
  poseUnchanged,
  heavyOne,
  live
};
try {
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  console.log(JSON.stringify({ RESULT: 'FAIL', error: String(error?.message || error) }));
  process.exit(1);
}
