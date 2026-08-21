/**
 * Live proof: simple Camera operator mode + black-viewer recovery on :3052.
 */
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'artifacts', 'spatial-v2-camera-simple-mode-v1');
const PORT = 3052;
const URL = `http://localhost:${PORT}/spatial-v2/?v=camera-federation-v1`;
const A = Object.freeze({ longitude: -73.553221995734, latitude: 45.494180980834, address: '997 de la Commune Ouest, Montréal' });
const B = Object.freeze({ longitude: -73.55345, latitude: 45.49442, address: 'Building interior near de la Commune' });

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
  const raw = await send('Page.captureScreenshot', { format: 'jpeg', quality: 70 });
  const file = path.join(OUT, name);
  fs.writeFileSync(file, Buffer.from(raw.data, 'base64'));
  return file;
}

const SNAP = `(() => {
  const api = window.__iqaiSpatialV2 || {};
  const wall = api.cameraWall?.snapshot?.() || {};
  const frame = api.worldViewFrame?.snapshot?.() || {};
  const panes = [...document.querySelectorAll('[data-iqai-camera-wall-pane]')].map((pane) => {
    const state = pane.querySelector('[data-iqai-viewer-state]')?.getAttribute('data-iqai-viewer-state') || null;
    const label = pane.querySelector('[data-iqai-viewer-state]')?.textContent || null;
    return {
      id: pane.getAttribute('data-iqai-camera-wall-pane'),
      hidden: pane.hidden === true,
      parked: pane.classList.contains('is-parked'),
      enlarged: pane.classList.contains('is-enlarged'),
      state,
      label,
      tiles: Boolean(pane.querySelector('.gm-style, canvas, iframe, img')),
      unexplainedBlack: pane.hidden !== true
        && !pane.classList.contains('is-parked')
        && !pane.querySelector('.gm-style, canvas, iframe, img')
        && state !== 'SEARCHING'
        && state !== 'LOADING'
        && state !== 'RETRYING'
        && state !== 'UNAVAILABLE'
    };
  });
  const chooser = [...document.querySelectorAll('[data-iqai-camera-chooser] .iqai-v2-camera-chooser__title')]
    .map((el) => el.textContent.trim());
  return {
    operatorMode: api.cameraOperatorMode?.get?.() || document.querySelector('[data-iqai-camera-relevance]')?.dataset.iqaiCameraOperatorMode || null,
    chooser,
    chooserVisible: document.querySelector('[data-iqai-camera-chooser]')?.hidden !== true,
    lookAroundVisible: document.querySelector('[data-iqai-camera-look-around-controls]')?.hidden === false,
    planVisible: document.querySelector('[data-iqai-camera-plan-controls]')?.hidden === false,
    generateVisible: document.querySelector('[data-iqai-camera-coverage-generate]')?.offsetParent !== null,
    buildWallVisible: document.querySelector('[data-iqai-camera-wall-build]')?.offsetParent !== null,
    changeTarget: Boolean(document.querySelector('[data-iqai-camera-change-target]')),
    exitMode: Boolean(document.querySelector('[data-iqai-camera-exit-mode]')),
    visualStatus: document.querySelector('[data-iqai-visual-coverage-status]')?.textContent || null,
    cameraViz: frame.cameraViz === true,
    layout: frame.layout || null,
    visual3dHidden: document.querySelector('[data-iqai-pane="3D VISUAL"]')?.hidden === true,
    wallOpen: wall.wall?.open === true,
    slotCount: wall.wall?.slotCount || 0,
    labels: [...document.querySelectorAll('[data-iqai-camera-wall-selector-label]')].map((el) => el.textContent.trim()),
    providers: [...document.querySelectorAll('[data-iqai-camera-wall-selector-provider]')].map((el) => el.textContent.trim()),
    panes,
    unexplainedBlackCount: panes.filter((pane) => pane.unexplainedBlack).length,
    liveDecoders: wall.liveDecoders || 0,
    viewerStates: wall.viewerStates || [],
    visual: api.visualCoverage?.snapshot?.() || null,
    searching: api.visualCoverage?.searching?.() === true,
    placedCount: api.placeCamera?.snapshot?.()?.count ?? null,
    mapViewCreateCount: api.mapViewCreateCount || null,
    mapViews: document.querySelectorAll('.esri-view').length,
    cameraInSelection: (api.world?.()?.selection?.objectRefs || []).some((ref) => ref.authority === 'iqai.camera')
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
  live = await withCdpPage(browserPath, 9411, async (send) => {
    const progress = [];
    const mark = (name) => {
      progress.push(name);
      console.error(`live: ${name}`);
    };

    mark('navigate');
    await send('Page.navigate', { url: URL });
    await sleep(2500);
    await send('Runtime.enable');
    mark('runtime');
    const ping = await send('Runtime.evaluate', { expression: '1+1', returnByValue: true });
    console.error('live: ping', JSON.stringify(ping));
    mark('wait-api');
    await waitUntil(send, `Boolean(window.__iqaiSpatialV2 && window.__iqaiSpatialV2.worldViewFrame && window.__iqaiSpatialV2.cameraWall)`, 80, 200);
    await sleep(800);
    const entry = await evaluateJson(send, SNAP);
    mark('entry');
    const shotEntry = await shot(send, '01-camera-entry.jpg');

    await evaluateJson(send, `document.querySelector('[data-iqai-camera-look-around]')?.click() ?? window.__iqaiSpatialV2.cameraRelevance.enterLookAround(); true`);
    await waitUntil(send, `window.__iqaiSpatialV2.cameraOperatorMode?.get?.() === 'LOOK_AROUND'`, 20, 150);
    const afterLook = await evaluateJson(send, SNAP);
    mark('look-around');
    const shotLook = await shot(send, '02-look-around-armed.jpg');

    await evaluateJson(send, `void window.__iqaiSpatialV2.dropPin.placeFromSearch({
      longitude: ${A.longitude},
      latitude: ${A.latitude},
      address: ${JSON.stringify(A.address)}
    }); true`);
    await waitUntil(send, `Boolean(window.__iqaiSpatialV2.world()?.activeFocus)`, 40, 200);
    await waitUntil(send, `window.__iqaiSpatialV2.visualCoverage?.searching?.() === true || window.__iqaiSpatialV2.cameraWall?.snapshot?.()?.wall?.open === true || window.__iqaiSpatialV2.visualCoverage?.snapshot?.()?.ok === true`, 50, 300);
    const searching = await evaluateJson(send, SNAP);
    mark('searching');
    const shotSearch = await shot(send, '03-finding-street-views.jpg');
    try {
      await waitUntil(send, `document.querySelectorAll('[data-iqai-camera-wall-pane]').length >= 1`, 60, 500);
    } catch (error) {
      console.error('live: wall wait', String(error));
    }
    await sleep(2500);
    let tri = await evaluateJson(send, SNAP).catch(() => searching);
    mark('tri');
    let shotTri = null;
    let enlarged = tri;
    let restored = tri;
    let retarget = tri;
    let exited = entry;
    let plan = entry;
    let shotMax = null;
    let shotRestore = null;
    let shotRetarget = null;
    let shotExit = null;
    let shotPlan = null;
    try {
      shotTri = await shot(send, '04-3up-ready.jpg');
      await evaluateJson(send, `document.querySelector('[data-iqai-camera-wall-enlarge]')?.click(); true`);
      await sleep(1200);
      enlarged = await evaluateJson(send, SNAP);
      shotMax = await shot(send, '05-maximize-view.jpg');
      await evaluateJson(send, `document.querySelector('[data-iqai-camera-wall-restore-tri]')?.click(); true`);
      await sleep(1400);
      restored = await evaluateJson(send, SNAP);
      shotRestore = await shot(send, '06-restore-3up.jpg');
      await evaluateJson(send, `document.querySelector('[data-iqai-camera-change-target]')?.click(); true`);
      await sleep(400);
      await evaluateJson(send, `void window.__iqaiSpatialV2.dropPin.placeFromSearch({
        longitude: ${B.longitude},
        latitude: ${B.latitude},
        address: ${JSON.stringify(B.address)}
      }); true`);
      await sleep(4000);
      retarget = await evaluateJson(send, SNAP);
      shotRetarget = await shot(send, '07-change-target.jpg');
      await evaluateJson(send, `document.querySelector('[data-iqai-camera-exit-mode]')?.click(); true`);
      await sleep(800);
      exited = await evaluateJson(send, SNAP);
      shotExit = await shot(send, '08-exit-camera-mode.jpg');
      await evaluateJson(send, `document.querySelector('[data-iqai-camera-plan-cameras]')?.click(); true`);
      await sleep(300);
      await evaluateJson(send, `window.__iqaiSpatialV2.placeCamera.placeAt(-73.5542, 45.4946, { heading: 45, horizontalFov: 70 })?.cameraId || null`);
      await evaluateJson(send, `document.querySelector('[data-iqai-camera-coverage-generate]')?.click(); true`);
      await sleep(800);
      plan = await evaluateJson(send, SNAP);
      shotPlan = await shot(send, '09-plan-cameras.jpg');
    } catch (error) {
      console.error('live: later-flow', String(error));
    }

    return {
      progress,
      entry,
      afterLook,
      searching,
      tri,
      enlarged,
      restored,
      retarget,
      exited,
      plan,
      shots: {
        shotEntry, shotLook, shotSearch, shotTri, shotMax, shotRestore, shotRetarget, shotExit, shotPlan
      }
    };
  });
} catch (error) {
  console.error(String(error?.stack || error));
  console.log(JSON.stringify({ error: String(error?.stack || error), result: 'FAIL' }));
  process.exit(1);
}

const unexplained = [
  live.tri?.unexplainedBlackCount,
  live.enlarged?.unexplainedBlackCount,
  live.restored?.unexplainedBlackCount,
  live.retarget?.unexplainedBlackCount
].some((count) => Number(count) > 0);

const pass = live.entry?.chooser?.join('|') === 'LOOK AROUND A LOCATION|PLAN CAMERAS'
  && live.afterLook?.operatorMode === 'LOOK_AROUND'
  && live.afterLook?.generateVisible !== true
  && live.tri?.wallOpen === true
  && live.tri?.slotCount >= 1
  && live.restored?.slotCount >= 1
  && live.exited?.cameraViz !== true
  && live.exited?.chooserVisible === true
  && live.plan?.placedCount >= 3
  && live.plan?.mapViews === 1
  && unexplained !== true;

fs.writeFileSync(path.join(OUT, 'result.json'), JSON.stringify({ result: pass ? 'PASS' : 'PARTIAL', live }, null, 2));
console.log(JSON.stringify({
  result: pass ? 'PASS' : 'PARTIAL',
  chooser: live.entry?.chooser,
  lookAround: live.afterLook?.operatorMode,
  triSlots: live.tri?.slotCount,
  unexplainedBlack: {
    tri: live.tri?.unexplainedBlackCount,
    enlarged: live.enlarged?.unexplainedBlackCount,
    restored: live.restored?.unexplainedBlackCount,
    retarget: live.retarget?.unexplainedBlackCount
  },
  exitChooser: live.exited?.chooserVisible,
  planCount: live.plan?.placedCount,
  mapViews: live.plan?.mapViews,
  shots: live.shots
}, null, 2));
