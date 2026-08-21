/**
 * Live proof: visualization-first 3-UP Camera Wall on :3052 at 1920x1080.
 * TARGET → GENERATE → three 360 panes. Does not restart :3047.
 */
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'artifacts', 'spatial-v2-camera-tri-view-v1');
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
      const timeoutMs = method === 'Page.captureScreenshot' || method === 'Runtime.evaluate' ? 60000 : 25000;
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
    const result = await send('Page.captureScreenshot', { format: 'jpeg', quality: 70 });
    const file = path.join(OUT, name);
    fs.writeFileSync(file, Buffer.from(result.data, 'base64'));
    return file;
  } catch (error) {
    return { error: String(error?.message || error) };
  }
}

const SNAP = `(() => {
  const api = window.__iqaiSpatialV2;
  const well = document.querySelector('.iqai-v2-worldview-frame') || document.querySelector('.iqai-v2-stage__well');
  const frame = api.worldViewFrame?.snapshot?.() || {};
  const wallSnap = api.cameraWall?.snapshot?.() || {};
  const wallEl = document.querySelector('[data-iqai-camera-wall]');
  const pane = document.querySelector('[data-iqai-pane="STREET 360"]');
  const mapPane = document.querySelector('[data-iqai-pane="MAP"]');
  const visualPane = document.querySelector('[data-iqai-pane="3D VISUAL"]');
  const wr = wallEl && !wallEl.hidden ? wallEl.getBoundingClientRect() : null;
  const pr = pane && !pane.hidden ? pane.getBoundingClientRect() : null;
  const mr = mapPane && !mapPane.hidden ? mapPane.getBoundingClientRect() : null;
  const vr = well ? well.getBoundingClientRect() : null;
  const stages = [...document.querySelectorAll('[data-iqai-camera-wall-pane-stage]')];
  const panes = [...document.querySelectorAll('[data-iqai-camera-wall-pane]')].filter((el) => el.hidden !== true);
  const placed = api.placeCamera?.snapshot?.() || {};
  const guided = api.guidedNext?.snapshot?.() || {};
  const mapPct = vr && mr ? Math.round((mr.height / vr.height) * 100) : null;
  const cameraPct = vr && pr ? Math.round((pr.height / vr.height) * 100) : null;
  const stageHeights = stages.map((el) => Math.round(el.getBoundingClientRect().height));
  const blackGap = wr ? Math.max(0, Math.round(wr.height - (panes[0]?.getBoundingClientRect?.().height || 0) - 48)) : null;
  return {
    layout: frame.layout || null,
    cameraViz: frame.cameraViz === true || document.querySelector('[data-iqai-view-host]')?.dataset.iqaiCameraViz === 'true',
    maximized: frame.maximized || null,
    mapPaneHidden: mapPane?.hidden === true,
    streetPaneHidden: pane?.hidden === true,
    visualPaneHidden: visualPane?.hidden === true || visualPane?.offsetParent === null,
    wallHidden: wallEl?.hidden === true,
    wallLayout: wallEl?.dataset.iqaiCameraWallLayout || null,
    paneCount: document.querySelectorAll('[data-iqai-camera-wall-pane]').length,
    visiblePaneCount: panes.length,
    selectorCount: document.querySelectorAll('[data-iqai-camera-wall-selector]').length,
    cameraIds: [...document.querySelectorAll('[data-iqai-camera-wall-id]')].map((el) => el.getAttribute('data-iqai-camera-wall-id')),
    providers: [...document.querySelectorAll('[data-iqai-camera-wall-selector-provider]')].map((el) => el.textContent.trim()),
    captures: [...document.querySelectorAll('[data-iqai-camera-wall-selector-captured]')].map((el) => el.textContent.trim()),
    heavyDomCount: document.querySelectorAll('[data-iqai-camera-wall-heavy-kind]').length,
    previewCount: document.querySelectorAll('[data-iqai-camera-wall-preview]').length,
    unavailableCount: document.querySelectorAll('[data-iqai-camera-wall-unavailable]').length,
    liveDecoders: wallSnap.liveDecoders ?? null,
    maxHeavyViewers: wallSnap.wall?.maxHeavyViewers ?? null,
    enlargedSlotId: wallSnap.wall?.enlargedSlotId || null,
    heavyReport: wallSnap.heavyReport || null,
    stageHeights,
    mapPct,
    cameraPct,
    blackGap,
    restoreVisible: document.querySelector('[data-iqai-camera-wall-restore-tri]')?.hidden === false,
    placeCameraHidden: document.querySelector('[data-iqai-place-camera]')?.hidden !== false,
    manualPresent: Boolean(document.querySelector('[data-iqai-camera-manual]')),
    guidedState: guided.state || null,
    guidedLabel: guided.label || null,
    placedCount: placed.count ?? (placed.cameras || []).length,
    expert: placed.expert === true,
    cameras: (placed.cameras || []).map((item) => ({
      cameraId: item.cameraId,
      longitude: item.longitude,
      latitude: item.latitude,
      heading: item.heading,
      pitch: item.pitch,
      horizontalFov: item.horizontalFov
    })),
    cameraInSelection: (api.world?.()?.selection?.objectRefs || []).some((ref) => ref.authority === 'iqai.camera'),
    mapViews: document.querySelectorAll('.esri-view').length,
    viewport: { width: window.innerWidth, height: window.innerHeight }
  };
})()`;

function posesEqual(a, b) {
  return JSON.stringify(a || []) === JSON.stringify(b || []);
}

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
  live = await withCdpPage(browserPath, 9382, async (send) => {
    await send('Page.navigate', { url: URL });
    await waitUntil(send, `Boolean(window.__iqaiSpatialV2 && window.__iqaiSpatialV2.worldViewFrame && window.__iqaiSpatialV2.cameraWall)`, 80, 200);
    await waitUntil(send, `document.querySelectorAll('.esri-view').length === 1`, 50, 250);
    await waitUntil(send, `document.querySelector('[data-iqai-view-host]')?.dataset.iqaiMapState !== 'INITIALIZING'`, 60, 250);
    await sleep(800);
    const before = await evaluateJson(send, SNAP);
    const shot01 = await shot(send, '01-before-wall.jpg');

    await evaluateJson(send, `(async () => {
      await window.__iqaiSpatialV2.dropPin.placeFromSearch({
        longitude: ${PIN.longitude},
        latitude: ${PIN.latitude},
        address: '997 de la Commune Ouest, Montréal'
      });
      return true;
    })()`);
    await waitUntil(send, `Boolean(window.__iqaiSpatialV2.world()?.activeFocus)`, 40, 200);
    const afterTarget = await evaluateJson(send, SNAP);
    await evaluateJson(send, `document.querySelector('[data-iqai-camera-coverage-generate]')?.click(); true`);
    await waitUntil(
      send,
      `window.__iqaiSpatialV2.placeCamera?.snapshot?.()?.count === 3
        && document.querySelectorAll('[data-iqai-camera-wall-pane]').length === 3
        && document.querySelector('[data-iqai-camera-wall]')?.hidden === false`,
      90,
      400
    );
    await waitUntil(
      send,
      `document.querySelectorAll('[data-iqai-camera-wall-selector-provider]').length === 3`,
      40,
      250
    );
    await sleep(7000);
    const opened = await evaluateJson(send, SNAP);
    const shot02 = await shot(send, '02-tri-view-open.jpg');
    const poses = opened?.cameras || [];

    await evaluateJson(send, `document.querySelector('[data-iqai-camera-wall-selector="1"]')?.click(); true`);
    await sleep(400);
    await evaluateJson(send, `document.querySelector('[data-iqai-camera-wall-selector="2"]')?.click(); true`);
    await sleep(400);
    await evaluateJson(send, `document.querySelector('[data-iqai-camera-wall-selector="3"]')?.click(); true`);
    await evaluateJson(send, `window.__iqaiSpatialV2.cameraWall.applyVirtualView({ heading: 40, pitch: 8, zoom: 2 }); true`);
    await sleep(400);
    const interacted = await evaluateJson(send, SNAP);

    await evaluateJson(send, `document.querySelector('[data-iqai-camera-wall-selector="2"] [data-iqai-camera-wall-enlarge]')?.click(); true`);
    await waitUntil(
      send,
      `Boolean(window.__iqaiSpatialV2.cameraWall?.snapshot?.()?.wall?.enlargedSlotId)`,
      40,
      150
    );
    await sleep(1200);
    const enlarged = await evaluateJson(send, SNAP);
    const shot03 = await shot(send, '03-camera-02-enlarged.jpg');

    await evaluateJson(send, `document.querySelector('[data-iqai-camera-wall-restore-tri]')?.click(); true`);
    await waitUntil(
      send,
      `window.__iqaiSpatialV2.cameraWall?.snapshot?.()?.wall?.enlargedSlotId == null
        && document.querySelectorAll('[data-iqai-camera-wall-pane]').length === 3`,
      40,
      150
    );
    await sleep(1000);
    const restored = await evaluateJson(send, SNAP);
    const shot04 = await shot(send, '04-restore-3up.jpg');

    await evaluateJson(send, `document.querySelector('[data-iqai-camera-wall-close]')?.click(); true`);
    await waitUntil(
      send,
      `document.querySelector('[data-iqai-camera-wall]')?.hidden === true`,
      40,
      150
    );
    await sleep(800);
    const closed = await evaluateJson(send, SNAP);
    const shot05 = await shot(send, '05-close-wall.jpg');

    await evaluateJson(send, `document.querySelector('[data-iqai-camera-wall-build]')?.click(); true`);
    await waitUntil(
      send,
      `document.querySelector('[data-iqai-camera-wall]')?.hidden === false
        && document.querySelectorAll('[data-iqai-camera-wall-pane]').length === 3`,
      60,
      250
    );
    await sleep(1500);
    const reopened = await evaluateJson(send, SNAP);
    const shot06 = await shot(send, '06-reopen-3up.jpg');

    return {
      before,
      afterTarget,
      opened,
      interacted,
      enlarged,
      restored,
      closed,
      reopened,
      poses,
      shots: { shot01, shot02, shot03, shot04, shot05, shot06 }
    };
  });
} catch (error) {
  fs.mkdirSync(OUT, { recursive: true });
  const report = { RESULT: 'FAIL', error: String(error?.message || error) };
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  process.exit(1);
}

const heavy = live.opened?.heavyDomCount || 0;
const budget = live.opened?.maxHeavyViewers || 0;
const fallback = heavy < 3;
const pass = live.before?.wallHidden === true
  && live.afterTarget?.placedCount === 0
  && live.opened?.placedCount === 3
  && live.opened?.wallHidden === false
  && live.opened?.visiblePaneCount === 3
  && live.opened?.cameraViz === true
  && live.opened?.visualPaneHidden === true
  && live.opened?.mapPaneHidden === false
  && live.opened?.mapPct >= 25
  && live.opened?.mapPct <= 40
  && live.opened?.cameraPct >= 55
  && live.opened?.placeCameraHidden === true
  && live.opened?.manualPresent === true
  && live.opened?.mapViews === 1
  && live.opened?.cameraInSelection !== true
  && budget <= 3
  && heavy <= 3
  && live.enlarged?.visiblePaneCount === 1
  && live.enlarged?.restoreVisible === true
  && live.restored?.visiblePaneCount === 3
  && live.restored?.enlargedSlotId == null
  && live.closed?.wallHidden === true
  && live.closed?.cameraViz !== true
  && live.reopened?.visiblePaneCount === 3
  && live.reopened?.mapViews === 1
  && posesEqual(live.poses, live.interacted?.cameras);

const report = {
  RESULT: pass ? (fallback ? 'PARTIAL' : 'PASS') : 'FAIL',
  HEAVY_VIEWER_TEST: {
    requestedBudget: 3,
    actualHeavyCount: heavy,
    liveDecoders: live.opened?.liveDecoders,
    report: live.opened?.heavyReport,
    fallback
  },
  live
};
fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify({
  RESULT: report.RESULT,
  targetClicks: 1,
  cameraViz: live.opened?.cameraViz,
  mapPct: live.opened?.mapPct,
  cameraPct: live.opened?.cameraPct,
  visualHidden: live.opened?.visualPaneHidden,
  panes: live.opened?.visiblePaneCount,
  heavy,
  budget,
  fallback,
  enlarged: live.enlarged?.visiblePaneCount,
  restored: live.restored?.visiblePaneCount,
  closedViz: live.closed?.cameraViz,
  reopened: live.reopened?.visiblePaneCount,
  mapViews: live.reopened?.mapViews,
  shots: live.shots
}, null, 2));
