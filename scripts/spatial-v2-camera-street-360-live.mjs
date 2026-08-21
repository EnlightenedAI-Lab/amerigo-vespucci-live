/**
 * Live proof: real Street 360 coverage around three Montréal targets on :3052.
 * Does not restart :3047. Does not mint CameraRefs for provider viewpoints.
 */
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'artifacts', 'spatial-v2-camera-street-360-v1');
const PORT = 3052;
const URL = `http://localhost:${PORT}/spatial-v2/?v=camera-federation-v1`;

const TARGETS = Object.freeze([
  {
    id: 'A',
    name: 'building-footprint',
    address: 'Building interior near 997 de la Commune Ouest',
    longitude: -73.55345,
    latitude: 45.49442
  },
  {
    id: 'B',
    name: 'street-intersection',
    address: '997 de la Commune Ouest, Montréal',
    longitude: -73.553221995734,
    latitude: 45.494180980834
  },
  {
    id: 'C',
    name: 'plaza-block-interior',
    address: 'Block interior north of de la Commune',
    longitude: -73.55405,
    latitude: 45.49485
  }
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
    awaitPromise: true,
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
  const visual = api.visualCoverage?.snapshot?.() || null;
  const wall = api.cameraWall?.snapshot?.() || {};
  const placed = api.placeCamera?.snapshot?.() || {};
  const guided = api.guidedNext?.snapshot?.() || {};
  const labels = [...document.querySelectorAll('[data-iqai-camera-wall-selector-label]')].map((el) => el.textContent.trim());
  const overlay = document.querySelector('[data-iqai-visual-coverage-overlay]');
  return {
    planCamerasLabel: document.querySelector('[data-iqai-camera-workflow="plan"] .iqai-v2-camera-workflow__title')?.textContent || null,
    view360Label: document.querySelector('[data-iqai-camera-workflow="view360"] .iqai-v2-camera-workflow__title')?.textContent || null,
    generatePresent: Boolean(document.querySelector('[data-iqai-camera-coverage-generate]')),
    placeCameraPlanPresent: Boolean(document.querySelector('[data-iqai-camera-plan-place]')),
    visualBuildPresent: Boolean(document.querySelector('[data-iqai-visual-coverage-build]')),
    visualStatus: document.querySelector('[data-iqai-visual-coverage-status]')?.textContent || null,
    retargetVisible: document.querySelector('[data-iqai-visual-coverage-retarget]')?.hidden === false,
    focus: api.world?.()?.activeFocus || null,
    visual,
    wallSource: wall.wall?.source || null,
    wallOpen: wall.wall?.open === true,
    slotCount: wall.wall?.slotCount || 0,
    cameraRefs: (wall.wall?.cameraRefs || []).map((ref) => ref?.cameraId || ref),
    labels,
    providers: [...document.querySelectorAll('[data-iqai-camera-wall-selector-provider]')].map((el) => el.textContent.trim()),
    overlayIcons: overlay ? overlay.querySelectorAll('[data-iqai-visual-viewpoint-icon]').length : 0,
    viewDirectionLabels: overlay ? [...overlay.querySelectorAll('[data-iqai-view-direction-label]')].map((el) => el.textContent) : [],
    placedCount: placed.count ?? (placed.cameras || []).length,
    guidedLabel: guided.label || null,
    cameraInSelection: (api.world?.()?.selection?.objectRefs || []).some((ref) => ref.authority === 'iqai.camera'),
    mapViews: document.querySelectorAll('.esri-view').length,
    mapViewCreateCount: api.mapViewCreateCount || null
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
  live = await withCdpPage(browserPath, 9387, async (send) => {
    await send('Page.navigate', { url: URL });
    await waitUntil(send, `Boolean(window.__iqaiSpatialV2 && window.__iqaiSpatialV2.worldViewFrame && window.__iqaiSpatialV2.cameraWall)`, 80, 200);
    await waitUntil(send, `document.querySelectorAll('.esri-view').length === 1`, 50, 250);
    await sleep(800);
    const ui = await evaluateJson(send, SNAP);
    const shot00 = await shot(send, '00-camera-workflows.jpg');
    const targets = [];
    for (const target of TARGETS) {
      await evaluateJson(send, `document.querySelector('[data-iqai-camera-command-close]')?.click(); true`);
      await sleep(400);
      const started = Date.now();
      await evaluateJson(send, `(async () => {
        await window.__iqaiSpatialV2.dropPin.placeFromSearch({
          longitude: ${target.longitude},
          latitude: ${target.latitude},
          address: ${JSON.stringify(target.address)}
        });
        return true;
      })()`);
      await waitUntil(send, `Boolean(window.__iqaiSpatialV2.world()?.activeFocus)`, 40, 200);
      const afterFocus = await evaluateJson(send, SNAP);
      await evaluateJson(send, `document.querySelector('[data-iqai-visual-coverage-build]')?.click(); true`);
      await waitUntil(
        send,
        `(() => {
          const api = window.__iqaiSpatialV2.visualCoverage;
          const snap = api?.snapshot?.();
          return api && api.searching() !== true
            && snap
            && Math.abs(Number(snap.target?.latitude) - ${target.latitude}) < 0.00002;
        })()`,
        120,
        500
      );
      await sleep(2500);
      const afterBuild = await evaluateJson(send, SNAP);
      const lookupMs = Date.now() - started;
      const shotFile = await shot(send, `${target.id.toLowerCase()}-${target.name}.jpg`);
      const selected = (afterBuild.visual?.selected || []).map((item) => ({
        viewpointId: item.viewpointId,
        provider: item.provider,
        providerId: item.providerId,
        captureCoordinate: item.captureCoordinate,
        captureDate: item.captureDate,
        distanceM: item.distanceM,
        bearingFromTargetDeg: item.bearingFromTargetDeg,
        viewHeadingTowardTarget: item.viewHeadingTowardTarget,
        cameraRef: item.cameraRef
      }));
      targets.push({
        id: target.id,
        name: target.name,
        target,
        clicks: 1,
        lookupMs,
        chosenRadiusM: afterBuild.visual?.chosenRadiusM || null,
        searchedRadiiM: afterBuild.visual?.searchedRadiiM || [],
        googleCount: afterBuild.visual?.googleCount || 0,
        mapillaryCount: afterBuild.visual?.mapillaryCount || 0,
        selected,
        wallOpen: afterBuild.wallOpen,
        slotCount: afterBuild.slotCount,
        cameraRefs: afterBuild.cameraRefs,
        labels: afterBuild.labels,
        overlayIcons: afterBuild.overlayIcons,
        viewDirectionLabels: afterBuild.viewDirectionLabels,
        guidedLabel: afterBuild.guidedLabel,
        visualStatus: afterBuild.visualStatus,
        afterFocusHasPin: Boolean(afterFocus.focus),
        shot: shotFile
      });
    }

    await evaluateJson(send, `document.querySelector('[data-iqai-camera-command-close]')?.click(); true`);
    await sleep(400);
    await evaluateJson(send, `document.querySelector('[data-iqai-camera-coverage-generate]')?.click(); true`);
    await waitUntil(
      send,
      `window.__iqaiSpatialV2.placeCamera?.snapshot?.()?.count >= 3`,
      50,
      250
    );
    const afterPlan = await evaluateJson(send, SNAP);
    const shotPlan = await shot(send, 'plan-cameras-preserved.jpg');
    await evaluateJson(send, `(async () => {
      const placed = window.__iqaiSpatialV2.placeCamera.placeAt(-73.5542, 45.4946, { heading: 45, horizontalFov: 70 });
      return placed?.cameraId || null;
    })()`);
    const afterPlace = await evaluateJson(send, SNAP);

    return {
      ui,
      shot00,
      targets,
      plan: {
        afterGenerateCount: afterPlan.placedCount,
        afterManualCount: afterPlace.placedCount,
        generatePresent: afterPlan.generatePresent,
        shot: shotPlan
      },
      mapViewCreateCount: afterPlace.mapViewCreateCount,
      mapViews: afterPlace.mapViews,
      cameraInSelection: afterPlace.cameraInSelection
    };
  });
} catch (error) {
  console.log(JSON.stringify({ error: String(error?.message || error), result: 'FAIL' }));
  process.exit(1);
}

const found = (live.targets || []).filter((row) => (row.selected || []).length > 0);
const identities = (live.targets || []).every((row) => (row.cameraRefs || []).length === 0 && (row.selected || []).every((item) => !item.cameraRef));
const planOk = (live.plan?.afterGenerateCount || 0) >= 3 && (live.plan?.afterManualCount || 0) > (live.plan?.afterGenerateCount || 0);
const pass = found.length >= 2 && identities && planOk && live.mapViews === 1;

fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify({ result: pass ? 'PASS' : 'PARTIAL', live }, null, 2));
console.log(JSON.stringify({
  result: pass ? 'PASS' : 'PARTIAL',
  found: found.length,
  identities,
  planOk,
  mapViews: live.mapViews,
  artifacts: OUT
}, null, 2));
process.exit(pass ? 0 : 1);
