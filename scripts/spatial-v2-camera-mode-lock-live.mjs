/**
 * Live proof: locked Camera Mode, labeled recovery, BACK TO MAIN VIEW, overlay contrast on :3052.
 */
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'artifacts', 'spatial-v2-camera-mode-lock-v1');
const PORT = 3052;
const URL = `http://localhost:${PORT}/spatial-v2/?v=camera-federation-v1`;
const TARGET = Object.freeze({
  longitude: -73.553221995734,
  latitude: 45.494180980834,
  address: '997 de la Commune Ouest, Montréal'
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
  const frame = api.worldViewFrame?.snapshot?.() || {};
  const wall = api.cameraWall?.snapshot?.() || {};
  const bar = document.querySelector('[data-iqai-camera-mode-bar]');
  const back = document.querySelector('[data-iqai-camera-mode-bar] [data-iqai-camera-back-main]');
  const recovery = document.querySelector('[data-iqai-camera-pane-recovery]');
  const layouts = [...document.querySelectorAll('[data-iqai-layout]')].map((btn) => ({
    id: btn.getAttribute('data-iqai-layout'),
    disabled: btn.disabled === true,
    title: btn.title || ''
  }));
  const planned = document.querySelector('#iqai-v2-place-camera-overlay');
  return {
    cameraViz: frame.cameraViz === true,
    layout: frame.layout || null,
    pairView: frame.pairView || null,
    modeBarHidden: bar?.hidden === true,
    modeText: bar?.querySelector('[data-iqai-camera-mode-indicator]')?.textContent || null,
    backVisible: bar?.hidden !== true && Boolean(back),
    backLabel: back?.textContent?.trim() || null,
    layouts,
    layoutLocked: layouts.every((btn) => btn.disabled === true && btn.title === 'CAMERA MODE ACTIVE — USE BACK TO MAIN VIEW'),
    recoveryHidden: recovery?.hidden !== false,
    recoveryState: recovery?.querySelector('[data-iqai-camera-pane-state]')?.textContent || null,
    recoveryKind: recovery?.getAttribute('data-iqai-camera-pane-kind') || null,
    loadingLabels: [...document.querySelectorAll('[data-iqai-viewer-state]')].map((el) => el.textContent.trim()),
    wallOpen: wall.wall?.open === true || wall.open === true,
    slotCount: wall.wall?.slotCount || wall.slotCount || 0,
    enlarged: wall.wall?.enlargedSlotId || wall.enlargedSlotId || null,
    plannedCount: api.placeCamera?.snapshot?.()?.count ?? null,
    glyphs: planned?.querySelectorAll('[data-iqai-planned-camera-glyph]').length || 0,
    wedges: planned?.querySelectorAll('[data-iqai-planned-fov]').length || 0,
    anchors: planned?.querySelectorAll('[data-iqai-planned-camera-anchor]').length || 0,
    nodes: planned?.querySelectorAll('[data-iqai-plan-boundary-node]').length || 0,
    targets: planned?.querySelectorAll('[data-iqai-coverage-target]').length || 0,
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
  live = await withCdpPage(browserPath, 9426, async (send) => {
    const shots = {};
    const mark = (name) => console.error(`live: ${name}`);
    mark('navigate');
    await send('Page.navigate', { url: URL });
    await sleep(2000);
    await send('Runtime.enable');
    await waitUntil(send, `Boolean(window.__iqaiSpatialV2 && window.__iqaiSpatialV2.worldViewFrame)`, 80, 200);

    mark('plan');
    await evaluateJson(send, `window.__iqaiSpatialV2.cameraRelevance.enterPlanCameras(); true`);
    await evaluateJson(send, `void window.__iqaiSpatialV2.dropPin.placeFromSearch({
      longitude: ${TARGET.longitude},
      latitude: ${TARGET.latitude},
      address: ${JSON.stringify(TARGET.address)}
    }); true`);
    await waitUntil(send, `Boolean(window.__iqaiSpatialV2.world()?.activeFocus)`, 30, 150);
    await evaluateJson(send, `window.__iqaiSpatialV2.cameraCoverage.generate(); true`);
    await waitUntil(send, `(window.__iqaiSpatialV2.placeCamera?.snapshot?.()?.count || 0) >= 3`, 20, 150);
    await evaluateJson(send, `void window.__iqaiSpatialV2.cameraWall.close(); true`).catch(() => null);
    await sleep(500);
    const workspace = await evaluateJson(send, SNAP);
    shots.workspace = await shot(send, '01-planned.jpg');

    mark('empty-viz');
    await evaluateJson(send, `window.__iqaiSpatialV2.worldViewFrame.enterCameraVisualization(); true`);
    await sleep(400);
    const emptyViz = await evaluateJson(send, SNAP);
    shots.empty = await shot(send, '02-recovery.jpg');

    mark('layout-noop');
    const layoutBefore = emptyViz.layout;
    await evaluateJson(send, `(() => {
      document.querySelector('[data-iqai-layout="2"]')?.click();
      document.querySelector('[data-iqai-layout="3"]')?.click();
      document.querySelector('[data-iqai-layout="4"]')?.click();
      window.__iqaiSpatialV2.worldViewFrame.setLayout(4);
      return true;
    })()`);
    await sleep(300);
    const afterClick = await evaluateJson(send, SNAP);

    mark('back-from-empty');
    await evaluateJson(send, `document.querySelector('[data-iqai-camera-back-main]')?.click(); true`);
    await sleep(700);
    const afterEmptyBack = await evaluateJson(send, SNAP);
    shots.afterEmptyBack = await shot(send, '03-back-from-recovery.jpg');

    mark('reenter-wall');
    await evaluateJson(send, `window.__iqaiSpatialV2.cameraRelevance.enterPlanCameras(); true`);
    await evaluateJson(send, `void window.__iqaiSpatialV2.cameraWall.build(); true`).catch(() => null);
    await sleep(1800);
    const viz = await evaluateJson(send, SNAP);
    shots.viz = await shot(send, '04-camera-mode.jpg');

    mark('esc-enlarge');
    await evaluateJson(send, `(() => {
      const btn = document.querySelector('[data-iqai-camera-wall-enlarge]');
      if (btn) btn.click();
      return true;
    })()`);
    await sleep(600);
    const enlarged = await evaluateJson(send, SNAP);
    shots.enlarged = await shot(send, '05-enlarged.jpg');
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await sleep(700);
    const restored = await evaluateJson(send, SNAP);
    shots.restored = await shot(send, '06-esc-3up.jpg');

    mark('esc-exit');
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await sleep(800);
    const afterEsc = await evaluateJson(send, SNAP);
    shots.afterEsc = await shot(send, '07-esc-exit.jpg');

    mark('reenter-overlays');
    await evaluateJson(send, `window.__iqaiSpatialV2.worldViewFrame.enterCameraVisualization(); true`);
    await sleep(500);
    const reentered = await evaluateJson(send, SNAP);
    shots.reentered = await shot(send, '08-reenter.jpg');
    await evaluateJson(send, `document.querySelector('[data-iqai-camera-back-main]')?.click(); true`);
    await sleep(600);
    const after = await evaluateJson(send, SNAP);
    shots.after = await shot(send, '09-final-main.jpg');

    return {
      workspace,
      emptyViz,
      layoutBefore,
      afterClick,
      afterEmptyBack,
      viz,
      enlarged,
      restored,
      afterEsc,
      reentered,
      after,
      shots
    };
  });
} catch (error) {
  console.log(JSON.stringify({ error: String(error), result: 'FAIL' }));
  process.exit(1);
}

const {
  workspace,
  emptyViz,
  layoutBefore,
  afterClick,
  afterEmptyBack,
  viz,
  enlarged,
  restored,
  afterEsc,
  reentered,
  after
} = live;
const lockPass = emptyViz?.cameraViz === true && emptyViz?.layoutLocked === true && emptyViz?.backVisible === true;
const noopPass = afterClick?.layout === layoutBefore && afterClick?.cameraViz === true;
const recoveryPass = emptyViz?.recoveryHidden === false && /NO CAMERA VIEW ACTIVE|CAMERA MODE READY/.test(emptyViz?.recoveryState || '');
const backPass = afterEmptyBack?.cameraViz === false && afterEmptyBack?.modeBarHidden === true;
const esc3upPass = Boolean(enlarged?.enlarged) && !restored?.enlarged && restored?.cameraViz === true;
const escExitPass = afterEsc?.cameraViz === false;
const camerasPass = (after?.plannedCount || 0) >= 3 && (reentered?.plannedCount || 0) >= 3;
const overlayPass = (reentered?.glyphs || 0) >= 1 || (workspace?.glyphs || 0) >= 1 || (reentered?.anchors || 0) >= 1;
const result = lockPass && noopPass && recoveryPass && backPass && esc3upPass && escExitPass && camerasPass
  ? (overlayPass ? 'PASS' : 'PARTIAL')
  : 'PARTIAL';

console.log(JSON.stringify({
  result,
  lockPass,
  noopPass,
  recoveryPass,
  backPass,
  esc3upPass,
  escExitPass,
  camerasPass,
  overlayPass,
  workspace,
  emptyViz,
  afterClick,
  afterEmptyBack,
  viz,
  enlarged,
  restored,
  afterEsc,
  reentered,
  after,
  shots: live.shots,
  out: OUT
}, null, 2));
