/**
 * Live proof: Camera donor population on :3052.
 * Does not restart :3047. Does not seed cameras. Does not wait on tile settle.
 */
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'artifacts', 'spatial-v2-camera-population-v1');
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
    await send('Network.setCacheDisabled', { cacheDisabled: true });
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

if (!(await isPortOpen(PORT))) {
  console.log(JSON.stringify({ error: '3052 not listening', result: 'FAIL' }));
  process.exit(1);
}

const browserPath = findBrowser();
if (!browserPath) {
  console.log(JSON.stringify({ error: 'No Chrome/Edge', result: 'FAIL' }));
  process.exit(1);
}

const live = await withCdpPage(browserPath, 9337, async (send) => {
  await send('Page.navigate', { url: URL });
  const apiReady = await waitUntil(
    send,
    `Boolean(window.__iqaiSpatialV2 && typeof window.__iqaiSpatialV2.execute === 'function')`,
    50,
    200
  );
  const boot = await evaluateJson(send, `(() => {
    const api = window.__iqaiSpatialV2;
    const surface = document.querySelector('[data-iqai-camera-relevance]');
    return {
      apiReady: Boolean(api),
      mapViewCreateCount: api?.mapViewCreateCount ?? null,
      surfaceMounted: Boolean(surface),
      surfaceText: surface?.innerText || null
    };
  })()`);
  const queried = await evaluateJson(send, `(async () => {
    const api = window.__iqaiSpatialV2;
    const pin = ${JSON.stringify(PIN)};
    const focusRef = {
      schemaId: 'iqai.spatial.focus-ref/1.0.0',
      focusId: 'live-camera-population-proof',
      geometry: { kind: 'POINT', coordinates: [pin.longitude, pin.latitude] },
      sourceView: 'MAP',
      sourceAction: 'DROP_PIN',
      revision: 1,
      establishedAt: '2026-08-21T11:30:00.000Z'
    };
    const executed = await Promise.race([
      api.execute('camera.query-relevant', { focusRef }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('query-timeout')), 8000))
    ]).catch((error) => ({ ok: false, error: String(error && error.message || error) }));
    const world = api.world();
    const cam = api.cameraRelevance?.snapshot?.() || null;
    const surface = document.querySelector('[data-iqai-camera-relevance]');
    return {
      executedOk: executed?.ok === true,
      executeError: executed?.error || null,
      selectionCount: world.selection?.objectRefs?.length || 0,
      cameraInSelection: (world.selection?.objectRefs || []).some((ref) => ref.authority === 'iqai.camera'),
      mapViewCreateCount: api.mapViewCreateCount,
      cameraCount: cam?.cameraCount ?? null,
      donorQualifiedCount: cam?.donorQualifiedCount ?? null,
      relevantCount: cam?.relevantCount ?? null,
      emptyReason: cam?.emptyReason || null,
      donorEmptyReason: cam?.donorEmptyReason || null,
      honesty: cam?.honesty || null,
      visibilityTested: cam?.visibilityTested,
      observationClaim: cam?.observationClaim,
      targetSource: cam?.target?.source || null,
      targetLon: cam?.target?.longitude ?? null,
      targetLat: cam?.target?.latitude ?? null,
      cameraRefs: (cam?.results || []).map((item) => item.cameraRef),
      surfaceText: surface?.innerText || null
    };
  })()`);
  const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  const file = path.join(OUT, '01-empty-population.png');
  fs.writeFileSync(file, Buffer.from(shot.data, 'base64'));
  return { apiReady, boot, queried, screenshot: file };
});

const report = {
  RESULT: live.queried?.cameraCount === 0
    && live.queried?.relevantCount === 0
    && live.queried?.emptyReason === 'NO QUALIFIED PERSISTENT CAMERA POPULATION'
    && live.queried?.mapViewCreateCount === 1
    && live.queried?.cameraInSelection === false
    ? 'PARTIAL_EMPTY_POPULATION_PROVEN'
    : 'PARTIAL',
  port: PORT,
  url: URL,
  live
};
fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
