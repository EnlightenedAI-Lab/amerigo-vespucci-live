/**
 * Live proof: GENERATE CAMERA COVERAGE on :3052.
 * FocusRef through product DROP PIN. No manual heading. Does not restart :3047.
 */
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'artifacts', 'spatial-v2-camera-coverage-plan-v1');
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
      ws.send(JSON.stringify({ id: 3, method: 'Target.attachToTarget', params: { targetId, flatten: true } }));
    });
    let nextId = 10;
    const send = (method, params = {}) => {
      nextId += 1;
      const id = nextId;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          ws.off('message', onMessage);
          reject(new Error(`${method}: timeout`));
        }, 90000);
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
      width: 1440,
      height: 900,
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
  return {
    available: query.cameraCount ?? null,
    relevant: query.relevantCount ?? null,
    placedCount: placed.count ?? null,
    cameras: (placed.cameras || []).map((item) => ({
      cameraId: item.cameraId,
      creationMode: item.creationMode || null,
      planId: item.planId || null,
      longitude: item.longitude,
      latitude: item.latitude,
      heading: item.heading,
      pitch: item.pitch,
      pitchQualification: item.pitchQualification || null,
      horizontalFov: item.horizontalFov,
      modelId: item.modelId || null,
      planningLabel: item.planningLabel || null
    })),
    wallOpen: wall.wall?.open === true || wall.open === true,
    slotCount: wall.wall?.slotCount ?? wall.slotCount ?? null,
    activeSlotId: wall.wall?.activeSlotId || wall.activeSlotId || null,
    maxHeavyViewers: wall.representations?.maxHeavyViewers ?? wall.wall?.maxHeavyViewers ?? wall.maxHeavyViewers ?? null,
    heavyDomCount: document.querySelectorAll('[data-iqai-camera-wall-heavy-kind]').length,
    providerIds: (wall.representations?.slots || []).map((item) => item.representation?.providerId || null),
    cameraInSelection: (world.selection?.objectRefs || []).some((ref) => ref.authority === 'iqai.camera'),
    visibilityTested: query.visibilityTested,
    observationClaim: query.observationClaim,
    generatePresent: Boolean(document.querySelector('[data-iqai-camera-coverage-generate]')),
    statusText: document.querySelector('[data-iqai-camera-coverage-status]')?.textContent || null,
    wallText: document.querySelector('[data-iqai-camera-wall]')?.innerText || null
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

const live = await withCdpPage(browserPath, 9361, async (send) => {
  await send('Page.navigate', { url: URL });
  await waitUntil(send, `document.readyState === 'complete'`, 40, 250);
  await waitUntil(
    send,
    `Boolean(window.__iqaiSpatialV2 && window.__iqaiSpatialV2.dropPin && window.__iqaiSpatialV2.cameraWall)`,
    60,
    200
  );

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

  const beforeGenerate = await evaluateJson(send, SNAPSHOT_EXPR);
  await evaluateJson(send, `document.querySelector('[data-iqai-camera-coverage-generate]')?.click(); true`);
  await waitUntil(
    send,
    `window.__iqaiSpatialV2.placeCamera?.snapshot?.()?.count === 3
      && (window.__iqaiSpatialV2.cameraWall?.snapshot?.()?.wall?.slotCount === 3
        || window.__iqaiSpatialV2.cameraWall?.snapshot?.()?.slotCount === 3)`,
    80,
    400
  );
  await sleep(4000);
  const afterGenerate = await evaluateJson(send, SNAPSHOT_EXPR);
  const shotGenerated = await shot(send, '01-generate-coverage.png');

  const switched = await evaluateJson(send, `(() => {
    const slots = Array.from(document.querySelectorAll('[data-iqai-camera-wall-slot]'));
    slots[1]?.click();
    return slots[1]?.getAttribute('data-iqai-camera-wall-slot') || null;
  })()`);
  await sleep(2500);
  const afterSwitch = await evaluateJson(send, SNAPSHOT_EXPR);
  const shotSwitch = await shot(send, '02-active-slot-switch.png');

  await evaluateJson(send, `document.querySelector('[data-iqai-camera-coverage-clear]')?.click(); true`);
  await waitUntil(
    send,
    `window.__iqaiSpatialV2.placeCamera?.snapshot?.()?.count === 0`,
    30,
    250
  );
  const afterClear = await evaluateJson(send, SNAPSHOT_EXPR);
  const shotClear = await shot(send, '03-clear-generated-plan.png');

  return { beforeGenerate, afterGenerate, switched, afterSwitch, afterClear, shots: { shotGenerated, shotSwitch, shotClear } };
});

const cameras = live.afterGenerate?.cameras || [];
const allAimed = cameras.length === 3
  && cameras.every((item) => item.creationMode === 'AUTO_PLAN')
  && cameras.every((item) => Number.isFinite(item.heading));
const poseImmutable = JSON.stringify(live.afterGenerate?.cameras) === JSON.stringify(live.afterSwitch?.cameras);
const pass = live.afterGenerate?.available === 3
  && live.afterGenerate?.relevant === 3
  && live.afterGenerate?.slotCount === 3
  && allAimed
  && live.afterClear?.placedCount === 0
  && poseImmutable
  && live.afterGenerate?.visibilityTested === false
  && live.afterGenerate?.observationClaim === false
  && live.afterGenerate?.cameraInSelection === false;

const report = {
  RESULT: pass ? 'PASS' : 'FAIL',
  poseImmutable,
  live
};
fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
