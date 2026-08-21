/**
 * Live proof: Persistent planned camera inventory on :3052.
 * Uses PLACE CAMERA product APIs only. Does not write localStorage.
 * Does not restart :3047.
 */
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'artifacts', 'spatial-v2-planned-camera-inventory-v1');
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

function destinationAlongHeading(origin, headingDeg, meters) {
  const lat1 = Number(origin.latitude) * Math.PI / 180;
  const lon1 = Number(origin.longitude) * Math.PI / 180;
  const bearing = Number(headingDeg) * Math.PI / 180;
  const angular = Number(meters) / 6371000;
  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(angular)
    + Math.cos(lat1) * Math.sin(angular) * Math.cos(bearing)
  );
  const lon2 = lon1 + Math.atan2(
    Math.sin(bearing) * Math.sin(angular) * Math.cos(lat1),
    Math.cos(angular) - Math.sin(lat1) * Math.sin(lat2)
  );
  return {
    latitude: lat2 * 180 / Math.PI,
    longitude: ((lon2 * 180 / Math.PI + 540) % 360) - 180
  };
}

const CAMERAS = Object.freeze([
  {
    key: 'A',
    ...destinationAlongHeading(PIN, 0, 42),
    heading: 180,
    pitch: -8,
    heightAboveGround: 4,
    horizontalFov: 70
  },
  {
    key: 'B',
    ...destinationAlongHeading(PIN, 90, 48),
    heading: 270,
    pitch: -6,
    heightAboveGround: 6,
    horizontalFov: 80
  },
  {
    key: 'C',
    ...destinationAlongHeading(PIN, 270, 55),
    heading: 90,
    pitch: -10,
    heightAboveGround: 8,
    horizontalFov: 90
  }
]);

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

async function shot(send, name) {
  const result = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  const file = path.join(OUT, name);
  fs.writeFileSync(file, Buffer.from(result.data, 'base64'));
  return file;
}

function queryExpression(label) {
  return `(async () => {
    const api = window.__iqaiSpatialV2;
    const pin = ${JSON.stringify(PIN)};
    const focusRef = {
      schemaId: 'iqai.spatial.focus-ref/1.0.0',
      focusId: 'live-planned-inventory',
      geometry: { kind: 'POINT', coordinates: [pin.longitude, pin.latitude] },
      sourceView: 'MAP',
      sourceAction: 'DROP_PIN',
      revision: 1,
      establishedAt: '2026-08-21T12:00:00.000Z'
    };
    await Promise.race([
      api.execute('camera.query-relevant', { focusRef }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('query-timeout')), 8000))
    ]).catch((error) => ({ ok: false, error: String(error && error.message || error) }));
    const world = api.world();
    const cam = api.cameraRelevance?.snapshot?.() || null;
    const placed = api.placeCamera?.snapshot?.() || null;
    const surface = document.querySelector('[data-iqai-camera-relevance]');
    return {
      label: ${JSON.stringify(label)},
      mapViewCreateCount: api.mapViewCreateCount,
      overlayCount: document.querySelectorAll('[data-iqai-authored-camera]').length,
      overlayIds: Array.from(document.querySelectorAll('[data-iqai-authored-camera]'))
        .map((node) => node.getAttribute('data-iqai-authored-camera')),
      wedgeCount: document.querySelectorAll('[data-iqai-camera-wedge]').length,
      placedCount: placed?.count ?? null,
      placedIds: (placed?.cameras || []).map((item) => item.cameraId),
      qualification: (placed?.cameras || []).map((item) => item.planningLabel || item.qualification),
      installed: (placed?.cameras || []).map((item) => item.installed),
      coordinates: (placed?.cameras || []).map((item) => ({
        cameraId: item.cameraId,
        longitude: item.longitude,
        latitude: item.latitude,
        heading: item.heading,
        pitch: item.pitch,
        heightAboveGround: item.heightAboveGround,
        horizontalFov: item.horizontalFov
      })),
      persistenceKind: placed?.persistenceKind || null,
      ownership: placed?.ownership || null,
      available: cam?.cameraCount ?? null,
      relevant: cam?.relevantCount ?? null,
      emptyReason: cam?.emptyReason || null,
      visibilityTested: cam?.visibilityTested,
      observationClaim: cam?.observationClaim,
      honesty: cam?.honesty || null,
      cameraInSelection: (world.selection?.objectRefs || []).some((ref) => ref.authority === 'iqai.camera'),
      selectionCount: world.selection?.objectRefs?.length || 0,
      results: (cam?.relevant || cam?.results || []).map((item) => ({
        cameraId: item.cameraId,
        cameraRef: item.cameraRef,
        qualification: item.qualification,
        planDistanceM: item.planDistanceM,
        targetBearingDeg: item.targetBearingDeg,
        fovIntersects: item.fovIntersects,
        pixelDensityLabel: item.pixelDensityLabel,
        designBand: item.designBand,
        visibilityTested: item.visibilityTested,
        observationClaim: item.observationClaim
      })),
      surfaceText: surface?.innerText || null
    };
  })()`;
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

const live = await withCdpPage(browserPath, 9338, async (send) => {
  await send('Page.navigate', { url: URL });
  const apiReady = await waitUntil(
    send,
    `Boolean(window.__iqaiSpatialV2 && window.__iqaiSpatialV2.placeCamera)`,
    60,
    200
  );
  await waitUntil(
    send,
    `Boolean(window.__iqaiSpatialV2 && Number(window.__iqaiSpatialV2.mapViewCreateCount) >= 1)`,
    40,
    400
  );

  const authored = await evaluateJson(send, `(async () => {
    const api = window.__iqaiSpatialV2;
    api.placeCamera.reset();
    await api.placeCamera.arm();
    const specs = ${JSON.stringify(CAMERAS)};
    const created = [];
    for (const spec of specs) {
      const camera = api.placeCamera.placeAt(spec.longitude, spec.latitude, {
        heading: spec.heading,
        pitch: spec.pitch,
        heightAboveGround: spec.heightAboveGround,
        horizontalFov: spec.horizontalFov
      });
      created.push({
        key: spec.key,
        cameraId: camera.cameraId,
        longitude: camera.longitude,
        latitude: camera.latitude,
        heading: camera.heading,
        pitch: camera.pitch,
        heightAboveGround: camera.heightAboveGround,
        horizontalFov: camera.horizontalFov,
        planningLabel: camera.planningLabel,
        installed: camera.installed
      });
    }
    const edited = api.placeCamera.updateActive({ heading: 92 });
    const last = created[created.length - 1];
    if (last && edited) last.heading = edited.heading;
    api.placeCamera.paint?.();
    return {
      created,
      count: api.placeCamera.snapshot().count,
      usedLocalStorageApi: false
    };
  })()`);

  const afterAuthor = await evaluateJson(send, queryExpression('after-author'));
  const shotAuthor = await shot(send, '01-authored-three.png');

  await send('Page.reload', { ignoreCache: true });
  await waitUntil(
    send,
    `Boolean(window.__iqaiSpatialV2 && window.__iqaiSpatialV2.placeCamera)`,
    60,
    200
  );
  await waitUntil(
    send,
    `Boolean(window.__iqaiSpatialV2 && Number(window.__iqaiSpatialV2.placeCamera.snapshot().count) === 3)`,
    30,
    200
  );
  const afterReload = await evaluateJson(send, queryExpression('after-reload'));
  const shotReload = await shot(send, '02-after-reload.png');

  const deleted = await evaluateJson(send, `(() => {
    const api = window.__iqaiSpatialV2;
    const ids = (api.placeCamera.snapshot().cameras || []).map((item) => item.cameraId);
    const removeId = ids[ids.length - 1];
    api.placeCamera.select(removeId);
    api.placeCamera.deleteActive();
    return {
      removed: removeId,
      remaining: (api.placeCamera.snapshot().cameras || []).map((item) => item.cameraId)
    };
  })()`);

  await send('Page.reload', { ignoreCache: true });
  await waitUntil(
    send,
    `Boolean(window.__iqaiSpatialV2 && window.__iqaiSpatialV2.placeCamera)`,
    60,
    200
  );
  await waitUntil(
    send,
    `Boolean(window.__iqaiSpatialV2 && Number(window.__iqaiSpatialV2.placeCamera.snapshot().count) === 2)`,
    30,
    200
  );
  const afterDeleteReload = await evaluateJson(send, queryExpression('after-delete-reload'));
  const shotDelete = await shot(send, '03-after-delete-reload.png');

  return {
    apiReady,
    authored,
    afterAuthor,
    afterReload,
    deleted,
    afterDeleteReload,
    shots: { shotAuthor, shotReload, shotDelete }
  };
});

const idsAuthor = live.afterAuthor?.placedIds || [];
const idsReload = live.afterReload?.placedIds || [];
const idsDelete = live.afterDeleteReload?.placedIds || [];
const sameAfterReload = idsAuthor.length === 3
  && idsAuthor.every((id) => idsReload.includes(id))
  && idsReload.length === 3;
const deleteHeld = idsDelete.length === 2
  && live.deleted?.removed
  && !idsDelete.includes(live.deleted.removed)
  && idsAuthor.filter((id) => id !== live.deleted.removed).every((id) => idsDelete.includes(id));

const report = {
  RESULT: live.afterAuthor?.available === 3
    && live.afterAuthor?.relevant >= 1
    && sameAfterReload
    && deleteHeld
    && live.afterAuthor?.cameraInSelection === false
    && live.afterAuthor?.visibilityTested === false
    ? 'PASS'
    : 'PARTIAL',
  port: PORT,
  url: URL,
  sameAfterReload,
  deleteHeld,
  live
};
fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
