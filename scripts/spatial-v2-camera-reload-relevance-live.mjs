/**
 * Live proof: reload reconstructs Camera relevance from AUTO_PLAN targetFocus.
 * Guided Next BUILD is green only when relevant cameras exist. :3052 only.
 */
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'artifacts', 'spatial-v2-camera-reload-relevance-v1');
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
    } catch (error) { lastError = error; }
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
      const timeoutMs = method === 'Page.captureScreenshot' ? 90000 : 60000;
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
  const result = await send('Page.captureScreenshot', { format: 'jpeg', quality: 55 });
  const file = path.join(OUT, name.replace(/\.png$/i, '.jpg'));
  fs.writeFileSync(file, Buffer.from(result.data, 'base64'));
  return file;
}

const SNAP = `(() => {
  const api = window.__iqaiSpatialV2;
  const el = document.querySelector('[data-iqai-camera-wall]');
  const pane = document.querySelector('[data-iqai-pane="STREET 360"]');
  const mapPane = document.querySelector('[data-iqai-pane="MAP"]');
  const counts = document.querySelector('[data-iqai-camera-relevance-counts]');
  const build = document.querySelector('[data-iqai-camera-wall-build]');
  const guided = api.guidedNext?.snapshot?.() || {};
  const query = api.cameraRelevance?.snapshot?.() || {};
  const placed = api.placeCamera?.snapshot?.() || {};
    const wallSnap = api.cameraWall?.snapshot?.() || {};
    const wallState = wallSnap.wall || wallSnap;
  const frame = api.worldViewFrame?.snapshot?.() || {};
  const style = el ? getComputedStyle(el) : null;
  const rect = el?.getBoundingClientRect?.();
  const wr = rect;
  const pr = pane?.getBoundingClientRect?.();
  const contained = Boolean(wr && pr
    && wr.left >= pr.left - 2
    && wr.right <= pr.right + 2
    && wr.top >= pr.top - 2
    && wr.bottom <= pr.bottom + 2);
  return {
    available: Number(counts?.dataset.iqaiCameraRelevanceCount || query.cameraCount || 0),
    relevant: Number(counts?.dataset.iqaiCameraRelevanceRelevant || query.relevantCount || 0),
    countsText: counts?.textContent || null,
    queryTarget: document.querySelector('[data-iqai-camera-relevance]')?.dataset.iqaiCameraQueryTarget || null,
    queryEmptyReason: query.emptyReason || query.reason || null,
    guidedState: guided.state || null,
    guidedControl: guided.targetControl || null,
    guidedAction: document.querySelector('[data-iqai-guided-action]')?.textContent || guided.label || null,
    guidedGreen: document.querySelectorAll('[data-iqai-guided="next"]').length,
    buildDisabled: build?.disabled === true,
    buildGuided: build?.dataset.iqaiGuided || null,
    focusGuided: document.querySelector('.iqai-v2-focus-tool[data-iqai-drop-pin]')?.dataset.iqaiGuided || null,
    placedCount: placed.count ?? (placed.cameras || []).length,
    cameraIds: (placed.cameras || []).map((item) => item.cameraId),
    autoPlan: (placed.cameras || []).filter((item) => item.creationMode === 'AUTO_PLAN').length,
    leftover: (placed.cameras || []).some((item) => item.cameraId === 'camera-operator-leftover'),
    poses: (placed.cameras || []).map((item) => ({
      cameraId: item.cameraId,
      longitude: item.longitude,
      latitude: item.latitude,
      heading: item.heading,
      pitch: item.pitch,
      horizontalFov: item.horizontalFov
    })),
        wallOpen: wallState.open === true,
    wallHidden: el?.hidden === true,
    wallDisplay: style?.display || null,
    wallHeight: rect ? Math.round(rect.height) : 0,
    selectorCount: document.querySelectorAll('[data-iqai-camera-wall-selector]').length,
    heavyDomCount: document.querySelectorAll('[data-iqai-camera-wall-heavy-kind]').length,
    wallParentPane: el?.closest('[data-iqai-pane]')?.getAttribute('data-iqai-pane') || null,
    contained,
    streetPaneHidden: pane?.hidden === true,
    mapPaneHidden: mapPane?.hidden === true,
    layout: frame.layout || null,
    maximized: frame.maximized || null,
    layoutButtons: ['1', '2', '3', '4'].map((n) => Boolean(document.querySelector('[data-iqai-layout="' + n + '"]'))),
    cameraInSelection: (api.world?.()?.selection?.objectRefs || []).some((ref) => ref.authority === 'iqai.camera'),
    worldFocus: Boolean(api.world?.()?.activeFocus),
    mapViews: document.querySelectorAll('.esri-view').length,
    mapViewCreateCount: api.getMapViewCreateCount?.() ?? null
  };
})()`;

function visuallyClosed(snap) {
  return snap?.wallHidden === true
    && snap?.wallDisplay === 'none'
    && Number(snap?.wallHeight || 0) === 0
    && snap?.wallOpen !== true;
}

function visuallyOpen(snap) {
  return snap?.wallHidden === false
    && snap?.wallDisplay !== 'none'
    && Number(snap?.selectorCount || 0) === 3
    && Number(snap?.wallHeight || 0) > 0
    && snap?.wallParentPane === 'STREET 360'
    && snap?.contained === true;
}

if (!(await isPortOpen(PORT))) {
  console.log(JSON.stringify({ RESULT: 'FAIL', error: '3052 not listening' }));
  process.exit(1);
}
const browserPath = findBrowser();
if (!browserPath) {
  console.log(JSON.stringify({ RESULT: 'FAIL', error: 'No Chrome/Edge' }));
  process.exit(1);
}

console.error('LIVE start', { PORT, URL, browserPath });
let live;
try {
  live = await withCdpPage(browserPath, 9380, async (send) => {
    await send('Page.navigate', { url: URL });
    await waitUntil(send, `Boolean(window.__iqaiSpatialV2 && window.__iqaiSpatialV2.dropPin && window.__iqaiSpatialV2.cameraWall && window.__iqaiSpatialV2.guidedNext)`, 80, 200);
    await waitUntil(send, `document.querySelectorAll('.esri-view').length === 1`, 50, 250);

    await evaluateJson(send, `(async () => {
      document.querySelector('[data-iqai-drop-pin]')?.click();
      await window.__iqaiSpatialV2.dropPin.placeFromSearch({
        longitude: ${PIN.longitude},
        latitude: ${PIN.latitude},
        address: '997 de la Commune Ouest, Montréal'
      });
      return true;
    })()`);
    await waitUntil(send, `Boolean(window.__iqaiSpatialV2.world()?.activeFocus)`, 40, 200);
    await evaluateJson(send, `document.querySelector('[data-iqai-camera-coverage-generate]')?.click(); true`);
    await waitUntil(send, `window.__iqaiSpatialV2.placeCamera?.snapshot?.()?.count >= 3
      && document.querySelector('[data-iqai-camera-wall]')?.hidden === false`, 90, 400);
    await evaluateJson(send, `window.__iqaiSpatialV2.placeCamera.placeAt(0, 0, {
      cameraId: 'camera-operator-leftover',
      heading: 0,
      pitch: 0,
      heightAboveGround: 3,
      horizontalFov: 70
    }); true`);
    await evaluateJson(send, `document.querySelector('[data-iqai-camera-command-close]')?.click()
      || document.querySelector('[data-iqai-camera-wall-close]')?.click(); true`);
    await waitUntil(send, `(() => {
      const el = document.querySelector('[data-iqai-camera-wall]');
      return el?.hidden === true && getComputedStyle(el).display === 'none';
    })()`, 40, 150);

    async function reloadAndRebuild(prefix) {
      await send('Page.reload', { ignoreCache: true });
      await waitUntil(send, `Boolean(window.__iqaiSpatialV2 && window.__iqaiSpatialV2.cameraWall && window.__iqaiSpatialV2.cameraRelevance && window.__iqaiSpatialV2.guidedNext)`, 80, 200);
      await waitUntil(send, `document.querySelectorAll('.esri-view').length === 1`, 80, 250);
      await waitUntil(send, `window.__iqaiSpatialV2.placeCamera?.snapshot?.()?.count >= 4`, 80, 250);
      await waitUntil(send, `Number(document.querySelector('[data-iqai-camera-relevance-counts]')?.dataset.iqaiCameraRelevanceRelevant || 0) > 0
        && document.querySelector('[data-iqai-camera-relevance-counts]')?.textContent?.includes('0 RELEVANT') !== true`, 80, 250);
      await waitUntil(send, `document.querySelector('[data-iqai-guided-action]')?.textContent?.includes('OPEN CAMERA WALL') === true
        && document.querySelector('[data-iqai-camera-wall-build]')?.disabled === false`, 80, 250);
      await sleep(600);
      const afterReload = await evaluateJson(send, SNAP);
      const shotReload = await shot(send, prefix + '-reload.jpg');

      await evaluateJson(send, `document.querySelector('[data-iqai-camera-wall-build]')?.click(); true`);
      await waitUntil(send, `document.querySelector('[data-iqai-camera-wall]')?.hidden === false
        && document.querySelectorAll('[data-iqai-camera-wall-selector]').length === 3
        && document.querySelector('[data-iqai-pane="STREET 360"]')?.hidden === false`, 90, 300);
      await sleep(1800);
      const afterBuild = await evaluateJson(send, SNAP);
      const shotBuild = await shot(send, prefix + '-build.jpg');

      await evaluateJson(send, `document.querySelector('[data-iqai-camera-command-close]')?.click()
        || document.querySelector('[data-iqai-camera-wall-close]')?.click(); true`);
      await waitUntil(send, `(() => {
        const el = document.querySelector('[data-iqai-camera-wall]');
        return el?.hidden === true && getComputedStyle(el).display === 'none';
      })()`, 40, 150);
      const afterClose = await evaluateJson(send, SNAP);
      const shotClose = await shot(send, prefix + '-close.jpg');
      return { afterReload, afterBuild, afterClose, shotReload, shotBuild, shotClose };
    }

    const first = await reloadAndRebuild('01');
    const second = await reloadAndRebuild('02');

    await evaluateJson(send, `document.querySelector('[data-iqai-camera-coverage-clear]')?.click(); true`);
    await waitUntil(send, `window.__iqaiSpatialV2.placeCamera?.snapshot?.()?.cameras?.every?.((item) => item.creationMode !== 'AUTO_PLAN') === true`, 40, 200);
    await waitUntil(send, `document.querySelector('[data-iqai-guided-action]')?.textContent?.includes('CHOOSE TARGET') === true`, 40, 200);
    await sleep(500);
    const noTarget = await evaluateJson(send, SNAP);
    const shotNoTarget = await shot(send, '03-no-target.jpg');

    return { first, second, noTarget, shotNoTarget };
  });
} catch (error) {
  console.log(JSON.stringify({ RESULT: 'FAIL', error: String(error?.stack || error?.message || error) }));
  process.exit(1);
}

function reloadPass(cycle) {
  return visuallyClosed(cycle.afterReload)
    && cycle.afterReload?.placedCount >= 4
    && cycle.afterReload?.autoPlan === 3
    && cycle.afterReload?.relevant > 0
    && cycle.afterReload?.relevant === 3
    && cycle.afterReload?.guidedControl === 'BUILD_RELEVANT_WALL'
    && String(cycle.afterReload?.guidedAction || '').includes('OPEN CAMERA WALL')
    && cycle.afterReload?.buildDisabled === false
    && cycle.afterReload?.worldFocus !== true
    && visuallyOpen(cycle.afterBuild)
    && cycle.afterBuild?.selectorCount === 3
    && cycle.afterBuild?.heavyDomCount <= 1
    && cycle.afterBuild?.contained === true
    && cycle.afterBuild?.wallParentPane === 'STREET 360'
    && cycle.afterBuild?.layoutButtons?.every(Boolean)
    && cycle.afterBuild?.cameraInSelection !== true
    && visuallyClosed(cycle.afterClose)
    && cycle.afterClose?.placedCount >= 4
    && cycle.afterClose?.autoPlan === 3
    && Number(cycle.afterReload?.mapViews || 0) === 1
    && Number(cycle.afterBuild?.mapViews || 0) === 1;
}

const pass = reloadPass(live.first)
  && reloadPass(live.second)
  && live.noTarget?.leftover === true
  && live.noTarget?.autoPlan === 0
  && live.noTarget?.guidedControl === 'FOCUS'
  && String(live.noTarget?.guidedAction || '').includes('CHOOSE TARGET')
  && live.noTarget?.buildDisabled === true
  && live.noTarget?.buildGuided !== 'next'
  && visuallyClosed(live.noTarget);

const report = {
  RESULT: pass ? 'PASS' : 'FAIL',
  first: live.first,
  second: live.second,
  noTarget: live.noTarget,
  shots: {
    firstReload: live.first?.shotReload,
    firstBuild: live.first?.shotBuild,
    firstClose: live.first?.shotClose,
    secondReload: live.second?.shotReload,
    secondBuild: live.second?.shotBuild,
    secondClose: live.second?.shotClose,
    noTarget: live.shotNoTarget
  }
};
fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
