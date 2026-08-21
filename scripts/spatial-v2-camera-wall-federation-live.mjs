/**
 * Live proof: Relevant Camera Wall V1 on :3052.
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
const OUT = path.join(ROOT, 'artifacts', 'spatial-v2-camera-wall-federation-v1');
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
        }, 45000);
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
    const logs = [];
    ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg.method === 'Runtime.exceptionThrown') {
        logs.push({
          type: 'exception',
          text: msg.params?.exceptionDetails?.text
            || msg.params?.exceptionDetails?.exception?.description
            || 'exception'
        });
      }
      if (msg.method === 'Runtime.consoleAPICalled') {
        logs.push({
          type: 'console',
          level: msg.params?.type,
          text: (msg.params?.args || []).map((arg) => arg.value || arg.description || '').join(' ')
        });
      }
    });
    const result = await fn(send, logs);
    ws.close();
    return { ...result, logs };
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

const SNAPSHOT_EXPR = `(async () => {
  const api = window.__iqaiSpatialV2;
  const pin = ${JSON.stringify(PIN)};
  const focusRef = {
    schemaId: 'iqai.spatial.focus-ref/1.0.0',
    focusId: 'live-camera-wall',
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
  const wall = api.cameraWall?.snapshot?.() || null;
  const placed = api.placeCamera?.snapshot?.() || null;
  const wallEl = document.querySelector('[data-iqai-camera-wall]');
  const buildEl = document.querySelector('[data-iqai-camera-wall-build]');
  return {
    mapViewCreateCount: api.mapViewCreateCount,
    overlayCount: document.querySelectorAll('[data-iqai-authored-camera]').length,
    placedCount: placed?.count ?? null,
    placedIds: (placed?.cameras || []).map((item) => item.cameraId),
    poses: (placed?.cameras || []).map((item) => ({
      cameraId: item.cameraId,
      longitude: item.longitude,
      latitude: item.latitude,
      heading: item.heading,
      pitch: item.pitch,
      heightAboveGround: item.heightAboveGround,
      horizontalFov: item.horizontalFov
    })),
    available: cam?.cameraCount ?? null,
    relevant: cam?.relevantCount ?? null,
    visibilityTested: cam?.visibilityTested,
    observationClaim: cam?.observationClaim,
    cameraInSelection: (world.selection?.objectRefs || []).some((ref) => ref.authority === 'iqai.camera'),
    selectionCount: world.selection?.objectRefs?.length || 0,
    results: (cam?.relevant || []).map((item) => ({
      cameraId: item.cameraId,
      qualification: item.qualification,
      planDistanceM: item.planDistanceM,
      targetBearingLabel: item.targetBearingLabel,
      cameraHeadingLabel: item.cameraHeadingLabel,
      fovIntersects: item.fovIntersects,
      pixelDensityLabel: item.pixelDensityLabel,
      designBandLabel: item.designBandLabel,
      visibilityTested: item.visibilityTested,
      observationClaim: item.observationClaim
    })),
    wallOpen: wall?.open === true,
    wallSlotCount: wall?.slotCount ?? null,
    wallLayout: wall?.layout ?? null,
    wallPersistence: wall?.persistence || null,
    wallMutatesPose: wall?.mutatesCameraPose,
    viewSlotIds: (wall?.slots || []).map((slot) => slot.slotId),
    assignedCameraRefs: (wall?.slots || []).map((slot) => slot.cameraRef),
    activeSlotId: wall?.activeSlotId || null,
    wallMounted: Boolean(wallEl),
    buildMounted: Boolean(buildEl),
    wallHidden: wallEl?.hidden === true,
    wallText: wallEl?.innerText || null,
    buildText: buildEl?.textContent || null
  };
})()`;

if (!(await isPortOpen(PORT))) {
  console.log(JSON.stringify({ error: '3052 not listening', result: 'FAIL' }));
  process.exit(1);
}
if (await isPortOpen(3047) === false) {
  console.log(JSON.stringify({ warning: '3047 not listening (source Spatial)', result: 'CONTINUE' }));
}

const browserPath = findBrowser();
if (!browserPath) {
  console.log(JSON.stringify({ error: 'No Chrome/Edge', result: 'FAIL' }));
  process.exit(1);
}

const live = await withCdpPage(browserPath, 9352, async (send, logs) => {
  await send('Page.navigate', { url: URL });
  await waitUntil(
    send,
    `document.readyState === 'complete'`,
    40,
    250
  );
  const bootProbe = await evaluateJson(send, `({
    href: location.href,
    ready: document.readyState,
    hasApi: Boolean(window.__iqaiSpatialV2),
    keys: window.__iqaiSpatialV2 ? Object.keys(window.__iqaiSpatialV2) : [],
    hasWall: Boolean(window.__iqaiSpatialV2 && window.__iqaiSpatialV2.cameraWall),
    hasPlace: Boolean(window.__iqaiSpatialV2 && window.__iqaiSpatialV2.placeCamera)
  })`);
  await waitUntil(
    send,
    `Boolean(window.__iqaiSpatialV2 && window.__iqaiSpatialV2.placeCamera && window.__iqaiSpatialV2.cameraWall)`,
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
        heading: camera.heading,
        horizontalFov: camera.horizontalFov,
        planningLabel: camera.planningLabel
      });
    }
    api.placeCamera.paint?.();
    return { created, count: api.placeCamera.snapshot().count, usedLocalStorageApi: false };
  })()`);

  const focused = await evaluateJson(send, `(async () => {
    const api = window.__iqaiSpatialV2;
    const pin = ${JSON.stringify(PIN)};
    await api.dropPin.placeFromSearch({
      longitude: pin.longitude,
      latitude: pin.latitude,
      address: '997 de la Commune Ouest, Montréal'
    });
    return {
      focusId: api.world()?.activeFocus?.focusId || null,
      coords: api.world()?.activeFocus?.geometry?.coordinates || null
    };
  })()`);

  const afterAuthor = await evaluateJson(send, SNAPSHOT_EXPR);
  const shotAuthor = await shot(send, '01-three-planned-cameras.png');

  const built = await evaluateJson(send, `(async () => {
    const button = document.querySelector('[data-iqai-camera-wall-build]');
    button?.click();
    for (let i = 0; i < 20; i += 1) {
      const wall = window.__iqaiSpatialV2.cameraWall?.snapshot?.();
      if (wall?.open && wall?.slotCount > 0) return true;
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
    return Boolean(window.__iqaiSpatialV2.cameraWall?.snapshot?.()?.open);
  })()`);
  const afterBuild = await evaluateJson(send, SNAPSHOT_EXPR);
  const shotWall = await shot(send, '02-relevant-wall-open.png');

  const posesBeforeSelect = afterBuild?.poses || [];
  const selected = await evaluateJson(send, `(() => {
    const slots = Array.from(document.querySelectorAll('[data-iqai-camera-wall-slot]'));
    const second = slots[1] || slots[0];
    second?.click();
    const wall = window.__iqaiSpatialV2.cameraWall?.snapshot?.() || null;
    return {
      clicked: second?.getAttribute('data-iqai-camera-wall-slot') || null,
      activeSlotId: wall?.activeSlotId || null
    };
  })()`);
  const afterSelect = await evaluateJson(send, SNAPSHOT_EXPR);
  const shotActive = await shot(send, '03-active-slot.png');

  const closed = await evaluateJson(send, `(() => {
    document.querySelector('[data-iqai-camera-wall-close]')?.click();
    return window.__iqaiSpatialV2.cameraWall?.snapshot?.() || null;
  })()`);
  const afterClose = await evaluateJson(send, SNAPSHOT_EXPR);
  const shotClosed = await shot(send, '04-wall-closed-cameras-remain.png');

  await send('Page.reload', { ignoreCache: true });
  await waitUntil(
    send,
    `Boolean(window.__iqaiSpatialV2 && window.__iqaiSpatialV2.placeCamera && window.__iqaiSpatialV2.cameraWall)`,
    60,
    200
  );
  await waitUntil(
    send,
    `Boolean(window.__iqaiSpatialV2 && Number(window.__iqaiSpatialV2.placeCamera.snapshot().count) === 3)`,
    30,
    200
  );
  const afterReload = await evaluateJson(send, SNAPSHOT_EXPR);
  const shotReload = await shot(send, '05-reload-cameras-wall-session-reset.png');

  return {
    bootProbe,
    logs,
    authored,
    focused,
    afterAuthor,
    built,
    afterBuild,
    selected,
    posesBeforeSelect,
    afterSelect,
    closed,
    afterClose,
    afterReload,
    shots: { shotAuthor, shotWall, shotActive, shotClosed, shotReload }
  };
});

function posesEqual(a = [], b = []) {
  if (a.length !== b.length) return false;
  return a.every((item, index) => {
    const other = b[index];
    return item.cameraId === other.cameraId
      && item.longitude === other.longitude
      && item.latitude === other.latitude
      && item.heading === other.heading
      && item.pitch === other.pitch
      && item.heightAboveGround === other.heightAboveGround
      && item.horizontalFov === other.horizontalFov;
  });
}

const wallSlots = live.afterBuild?.viewSlotIds || [];
const assigned = live.afterBuild?.assignedCameraRefs || [];
const poseImmutable = posesEqual(live.afterBuild?.poses, live.afterSelect?.poses)
  && posesEqual(live.afterAuthor?.poses, live.afterClose?.poses);
const idsPersist = (live.afterAuthor?.placedIds || []).length === 3
  && (live.afterClose?.placedIds || []).join() === (live.afterAuthor?.placedIds || []).join()
  && (live.afterReload?.placedIds || []).join() === (live.afterAuthor?.placedIds || []).join();

const pass = live.afterAuthor?.available === 3
  && live.afterAuthor?.relevant === 3
  && live.afterBuild?.wallOpen === true
  && live.afterBuild?.wallSlotCount === 3
  && wallSlots.length === 3
  && assigned.length === 3
  && assigned.every((id) => (live.afterAuthor?.placedIds || []).includes(id))
  && wallSlots.every((id) => String(id).startsWith('view-slot-'))
  && live.afterBuild?.wallText?.includes('PLANNED · NOT INSTALLED')
  && live.afterBuild?.wallText?.includes('VISIBILITY NOT TESTED')
  && live.afterBuild?.wallText?.includes('2D PLAN-VIEW GEOMETRY')
  && live.afterBuild?.cameraInSelection === false
  && live.afterClose?.wallOpen === false
  && live.afterReload?.wallOpen === false
  && live.afterReload?.placedCount === 3
  && poseImmutable
  && idsPersist
  && live.authored?.usedLocalStorageApi === false;

const report = {
  RESULT: pass ? 'PASS' : 'PARTIAL',
  port: PORT,
  url: URL,
  poseImmutable,
  idsPersist,
  live
};
fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
