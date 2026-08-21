/**
 * Live proof: Camera Wall provider representations on :3052.
 * Does not write localStorage. Does not restart :3047.
 */
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'artifacts', 'spatial-v2-camera-wall-representations-v1');
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
  { key: 'A', ...destinationAlongHeading(PIN, 0, 42), heading: 180, pitch: -8, heightAboveGround: 4, horizontalFov: 70 },
  { key: 'B', ...destinationAlongHeading(PIN, 90, 48), heading: 270, pitch: -6, heightAboveGround: 6, horizontalFov: 80 },
  { key: 'C', ...destinationAlongHeading(PIN, 270, 55), heading: 90, pitch: -10, heightAboveGround: 8, horizontalFov: 90 }
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
  const reps = wall.representations || {};
  const placed = api.placeCamera?.snapshot?.() || {};
  const query = api.cameraRelevance?.snapshot?.() || {};
  const world = api.world();
  return {
    available: query.cameraCount ?? null,
    relevant: query.relevantCount ?? null,
    placedCount: placed.count ?? null,
    poses: (placed.cameras || []).map((item) => ({
      cameraId: item.cameraId,
      longitude: item.longitude,
      latitude: item.latitude,
      heading: item.heading,
      horizontalFov: item.horizontalFov
    })),
    wallOpen: wall.wall?.open === true,
    slotCount: wall.wall?.slotCount ?? null,
    activeSlotId: wall.wall?.activeSlotId || null,
    maxHeavyViewers: wall.representations?.maxHeavyViewers ?? wall.wall?.maxHeavyViewers ?? null,
    liveDecoders: wall.representations?.liveDecoders ?? null,
    heavySlotId: wall.representations?.heavySlotId || null,
    heavyDomCount: document.querySelectorAll('[data-iqai-camera-wall-heavy-kind]').length,
    cameraInSelection: (world.selection?.objectRefs || []).some((ref) => ref.authority === 'iqai.camera'),
    focus: world.activeFocus ? {
      longitude: world.activeFocus.longitude,
      latitude: world.activeFocus.latitude,
      sourceType: world.activeFocus.sourceType || world.activeFocus.source || null
    } : null,
    heavyKind: document.querySelector('[data-iqai-camera-wall-heavy-kind]')?.getAttribute('data-iqai-camera-wall-heavy-kind') || null,
    visibilityTested: query.visibilityTested,
    observationClaim: query.observationClaim,
    slots: (reps.slots || []).map((item) => ({
      slotId: item.slotId,
      cameraRef: item.cameraRef,
      selected: item.selected,
      availability: item.availability,
      heavy: item.heavy,
      provider: item.representation?.provider || null,
      providerId: item.representation?.providerId || null,
      representationType: item.representation?.representationType || null,
      cameraCoordinate: item.cameraCoordinate || null,
      captureCoordinate: item.representation?.captureCoordinate || null,
      captureOffset: item.representation?.distanceMeters ?? null,
      capturedAt: item.representation?.capturedAt || null,
      mapillaryStatus: item.mapillaryStatus || null,
      googleId: item.google?.providerId || null,
      mapillaryId: item.mapillary?.providerId || null,
      mapillaryType: item.mapillary?.representationType || null
    })),
    wallText: document.querySelector('[data-iqai-camera-wall]')?.innerText || null
  };
})()`;

if (!(await isPortOpen(PORT))) {
  console.log(JSON.stringify({ error: '3052 not listening', result: 'FAIL' }));
  process.exit(1);
}

let providerStatus = null;
try {
  providerStatus = await fetch('http://localhost:3052/spatial-v2/api/camera-providers/status', { cache: 'no-store' })
    .then((res) => res.json());
} catch (error) {
  providerStatus = { error: String(error?.message || error) };
}

const browserPath = findBrowser();
if (!browserPath) {
  console.log(JSON.stringify({ error: 'No Chrome/Edge', result: 'FAIL' }));
  process.exit(1);
}

const live = await withCdpPage(browserPath, 9355, async (send) => {
  await send('Page.navigate', { url: URL });
  await waitUntil(send, `document.readyState === 'complete'`, 40, 250);
  await waitUntil(
    send,
    `Boolean(window.__iqaiSpatialV2 && window.__iqaiSpatialV2.placeCamera && window.__iqaiSpatialV2.cameraWall)`,
    60,
    200
  );

  const camerasReady = await evaluateJson(send, `(async () => {
    const api = window.__iqaiSpatialV2;
    const existing = api.placeCamera.snapshot();
    if ((existing.count || 0) < 3) {
      await api.placeCamera.arm();
      const specs = ${JSON.stringify(CAMERAS)};
      const needed = Math.max(0, 3 - (existing.count || 0));
      for (const spec of specs.slice(0, needed)) {
        api.placeCamera.placeAt(spec.longitude, spec.latitude, {
          heading: spec.heading,
          pitch: spec.pitch,
          heightAboveGround: spec.heightAboveGround,
          horizontalFov: spec.horizontalFov
        });
      }
      api.placeCamera.paint?.();
    }
    document.querySelector('[data-iqai-drop-pin]')?.click();
    const focus = await api.dropPin.placeFromSearch({
      longitude: ${PIN.longitude},
      latitude: ${PIN.latitude},
      address: '997 de la Commune Ouest, Montréal'
    });
    return {
      count: api.placeCamera.snapshot().count,
      reused: (existing.count || 0) >= 3,
      focusLongitude: focus?.longitude ?? null,
      focusLatitude: focus?.latitude ?? null,
      sourceType: focus?.sourceType || null
    };
  })()`);

  await evaluateJson(send, SNAPSHOT_EXPR);

  const built = await evaluateJson(send, `(async () => {
    document.querySelector('[data-iqai-camera-wall-build]')?.click();
    for (let i = 0; i < 80; i += 1) {
      const snap = window.__iqaiSpatialV2.cameraWall?.snapshot?.();
      const slots = snap?.representations?.slots || [];
      const ready = snap?.wall?.open
        && snap?.wall?.slotCount === 3
        && slots.length === 3
        && slots.every((item) => item.cameraCoordinate);
      if (ready) return true;
      await new Promise((resolve) => setTimeout(resolve, 400));
    }
    return Boolean(window.__iqaiSpatialV2.cameraWall?.snapshot?.()?.wall?.open);
  })()`);

  await waitUntil(
    send,
    `document.querySelector('[data-iqai-camera-wall-heavy-kind]') != null`,
    20,
    500
  );
  await sleep(2500);
  const afterBuild = await evaluateJson(send, SNAPSHOT_EXPR);
  const shotWall = await shot(send, '01-wall-representations.png');

  const mapillaryClicked = await evaluateJson(send, `(() => {
    const slot = document.querySelector('[data-iqai-camera-wall-slot]');
    const button = slot?.querySelector('[data-iqai-camera-wall-provider="MAPILLARY"]:not([disabled])');
    button?.click();
    return Boolean(button);
  })()`);
  await waitUntil(
    send,
    `document.querySelector('[data-iqai-camera-wall-heavy-kind="mapillary"]') != null`,
    24,
    500
  );
  await sleep(2000);
  const afterMapillary = await evaluateJson(send, SNAPSHOT_EXPR);
  const shotMapillary = await shot(send, '03-mapillary-active.png');

  const switched = await evaluateJson(send, `(() => {
    const slots = Array.from(document.querySelectorAll('[data-iqai-camera-wall-slot]'));
    const second = slots[1] || slots[0];
    second?.click();
    return second?.getAttribute('data-iqai-camera-wall-slot') || null;
  })()`);
  await waitUntil(
    send,
    `document.querySelector('[data-iqai-camera-wall-heavy-kind="google"]') != null`,
    24,
    500
  );
  await sleep(2000);
  const afterSwitch = await evaluateJson(send, SNAPSHOT_EXPR);
  const shotSwitch = await shot(send, '02-active-slot-switch.png');

  return {
    camerasReady,
    built,
    afterBuild,
    mapillaryClicked,
    afterMapillary,
    switched,
    afterSwitch,
    shots: { shotWall, shotMapillary, shotSwitch }
  };
});

const slots = live.afterBuild?.slots || [];
const pixels = slots.some((item) => item.providerId)
  || Boolean(live.afterBuild?.wallText?.includes('GOOGLE STREET360'))
  || Boolean(live.afterBuild?.wallText?.includes('MAPILLARY'));
const oneHeavy = (live.afterBuild?.heavyDomCount || 0) <= 1
  && (live.afterSwitch?.heavyDomCount || 0) <= 1;
const poseImmutable = JSON.stringify(live.afterBuild?.poses) === JSON.stringify(live.afterSwitch?.poses);
const switchOk = live.afterSwitch?.activeSlotId
  && live.afterSwitch.activeSlotId !== live.afterBuild?.activeSlotId;

const googlePass = slots.some((item) => item.provider === 'GOOGLE_STREET360' && item.providerId)
  || (live.afterBuild?.slots || []).some((item) => item.googleId);
const mapillaryPass = (live.afterMapillary?.slots || []).some((item) => item.provider === 'MAPILLARY' && item.providerId)
  || (live.afterBuild?.slots || []).some((item) => item.mapillaryId);
const mapillaryCredential = providerStatus?.credentials?.mapillaryCredentialRequired === true
  || slots.some((item) => item.mapillaryStatus === 'MAPILLARY_CREDENTIAL_REQUIRED');

const pass = live.afterBuild?.available === 3
  && live.afterBuild?.relevant === 3
  && live.afterBuild?.slotCount === 3
  && pixels
  && oneHeavy
  && poseImmutable
  && live.afterBuild?.cameraInSelection === false
  && live.afterBuild?.visibilityTested === false
  && live.afterBuild?.observationClaim === false;

const report = {
  RESULT: pass ? (googlePass && mapillaryPass ? 'PASS' : 'PARTIAL') : 'FAIL',
  providerStatus,
  googlePass,
  mapillaryPass,
  mapillaryCredential,
  poseImmutable,
  switchOk,
  oneHeavy,
  live
};
fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
