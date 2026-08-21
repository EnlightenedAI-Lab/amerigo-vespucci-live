/**
 * Live proof: Camera Federation V1 on dedicated Spatial runtime :3052.
 * Does not touch :3047. Does not commit, push, deploy, or seed a fake camera DB.
 */
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'artifacts', 'spatial-v2-camera-federation-v1');
const PORT = 3052;
const URL = `http://localhost:${PORT}/spatial-v2/?v=camera-federation-v1`;
const SEARCH = '997 de la Commune Ouest, Montréal';
const HYDRANT_ID = '5011151';

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
    '--enable-webgl',
    '--ignore-gpu-blocklist',
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
    await send('Network.enable');
    await send('Network.setCacheDisabled', { cacheDisabled: true });
    const result = await fn(send);
    ws.close();
    return result;
  } finally {
    child.kill();
  }
}

async function shot(send, name) {
  const result = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  const file = path.join(OUT, name);
  fs.writeFileSync(file, Buffer.from(result.data, 'base64'));
  return file;
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

const live = await withCdpPage(browserPath, 9334, async (send) => {
  await send('Page.navigate', { url: URL });
  await send('Page.setLifecycleEventsEnabled', { enabled: true });
  await waitUntil(send, `Boolean(document.querySelector('#iqai-spatial-v2'))`, 40, 250);
  const ready = await waitUntil(
    send,
    `Boolean(window.__iqaiSpatialV2 && Number(window.__iqaiSpatialV2.mapViewCreateCount) >= 1)`,
    40,
    400
  );
  await sleep(1500);
  const boot = await shot(send, '01-boot.png');

  const search = await evaluateJson(send, `(async () => {
    const api = window.__iqaiSpatialV2;
    const pin = { longitude: -73.553221995734, latitude: 45.494180980834, address: ${JSON.stringify(SEARCH)} };
    const executed = await api.execute('focus.set', pin);
    const input = document.querySelector('[data-iqai-search-input]');
    if (input) input.value = pin.address;
    await api.cameraRelevance?.query?.(true);
    const world = api.world();
    const cam = api.cameraRelevance?.snapshot?.() || null;
    const surface = document.querySelector('[data-iqai-camera-relevance]');
    return {
      readyMap: document.querySelector('[data-iqai-map-state="READY"]') != null,
      searchOk: executed?.ok === true,
      address: pin.address,
      longitude: pin.longitude,
      latitude: pin.latitude,
      focusId: world.activeFocus?.focusId || null,
      focusKind: world.activeFocus?.geometry?.kind || null,
      focusLon: world.activeFocus?.geometry?.coordinates?.[0] ?? null,
      focusLat: world.activeFocus?.geometry?.coordinates?.[1] ?? null,
      selectionCount: world.selection?.objectRefs?.length || 0,
      mapViewCreateCount: api.mapViewCreateCount,
      cameraCount: cam?.cameraCount ?? null,
      relevantCount: cam?.relevantCount ?? null,
      emptyReason: cam?.emptyReason || null,
      honesty: cam?.honesty || null,
      visibilityTested: cam?.visibilityTested,
      observationClaim: cam?.observationClaim,
      targetSource: cam?.target?.source || null,
      surfaceMounted: Boolean(surface),
      surfaceText: surface?.innerText || null
    };
  })()`);
  const afterFocus = await shot(send, '02-focusref-point.png');

  const hydrant = await evaluateJson(send, `(async () => {
    const api = window.__iqaiSpatialV2;
    document.querySelector('[data-iqai-inspector-collapse]')?.click();
    let selected = null;
    try {
      selected = await Promise.race([
        api.hydrant.selectById(${JSON.stringify(HYDRANT_ID)}, 'MAP'),
        new Promise((_, reject) => setTimeout(() => reject(new Error('select-timeout')), 8000))
      ]);
    } catch {}
    await new Promise((r) => setTimeout(r, 1200));
    const record = api.hydrant.getRecord(${JSON.stringify(HYDRANT_ID)});
    try {
      const view = api.mapFoundation?.getView?.();
      if (view && record?.longitude && record?.latitude) {
        await Promise.race([
          view.goTo({ center: [record.longitude, record.latitude], zoom: 18 }),
          new Promise((resolve) => setTimeout(resolve, 3000))
        ]);
      }
    } catch {}
    await api.cameraRelevance?.query?.(true);
    const world = api.world();
    const cam = api.cameraRelevance?.snapshot?.() || null;
    const inspector = document.querySelector('[data-iqai-slot="selected-object-slot"]')?.innerText
      || document.querySelector('[data-iqai-slot="context-inspector"]')?.innerText
      || '';
    return {
      selectedOk: Boolean(selected?.objectRef || record?.objectRef),
      selectionId: world.selection?.objectRefs?.[0]?.id || null,
      selectionSchema: world.selection?.objectRefs?.[0]?.schemaId || null,
      inspectorHasHydrant: inspector.includes(${JSON.stringify(HYDRANT_ID)}),
      inspectorText: inspector.slice(0, 400),
      usesMunicipalCoords: cam?.target?.longitude === record?.longitude && cam?.target?.latitude === record?.latitude,
      recordLon: record?.longitude ?? null,
      recordLat: record?.latitude ?? null,
      coordinateSource: record?.coordinateSource || null,
      querySource: cam?.target?.source || null,
      queryLon: cam?.target?.longitude ?? null,
      queryLat: cam?.target?.latitude ?? null,
      cameraRefs: (cam?.results || []).map((item) => item.cameraRef),
      cameraCount: cam?.cameraCount ?? null,
      relevantCount: cam?.relevantCount ?? null,
      emptyReason: cam?.emptyReason || null,
      visibilityTested: cam?.visibilityTested,
      observationClaim: cam?.observationClaim,
      mapViewCreateCount: api.mapViewCreateCount,
      cameraInSelection: (world.selection?.objectRefs || []).some((ref) => ref.authority === 'iqai.camera')
    };
  })()`);
  const afterHydrant = await shot(send, '03-hydrant-selected.png');

  const nearmap = await evaluateJson(send, `(async () => {
    const api = window.__iqaiSpatialV2;
    await api.imageryCommand?.setMode?.('AERIAL');
    await new Promise((r) => setTimeout(r, 3500));
    const overlay = document.querySelector('[data-iqai-authored-camera], [data-iqai-hydrant-mark], [data-iqai-history-mark], [data-source-id="${HYDRANT_ID}"]');
    const marks = document.body.innerText.includes(${JSON.stringify(HYDRANT_ID)});
    const aerial = document.querySelector('[data-iqai-image-surface="AERIAL"]');
    const aerialPressed = aerial?.getAttribute('aria-pressed') === 'true';
    const badge = document.querySelector('[data-iqai-aerial-badge]')?.textContent || null;
    const graphics = Array.from(document.querySelectorAll('[data-iqai-hydrant-id], [data-source-id], [data-id-bi]'))
      .map((node) => node.getAttribute('data-iqai-hydrant-id') || node.getAttribute('data-source-id') || node.getAttribute('data-id-bi'))
      .filter(Boolean);
    return {
      aerialPressed,
      badge,
      overlayPresent: Boolean(overlay),
      textHasHydrant: marks,
      graphics,
      mapViewCreateCount: api.mapViewCreateCount,
      imageSurface: document.getElementById('iqai-spatial-v2')?.dataset?.iqaiImageSurface || null
    };
  })()`);
  const afterNearmap = await shot(send, '04-nearmap-hydrant.png');

  await evaluateJson(send, `(async () => {
    const api = window.__iqaiSpatialV2;
    await api.imageryCommand?.setMode?.('MAP');
    await new Promise((r) => setTimeout(r, 400));
    return true;
  })()`);

  return {
    ready,
    search,
    afterFocus,
    hydrant,
    afterHydrant,
    nearmap,
    afterNearmap,
    boot
  };
});

const report = {
  result: live.search?.focusId && live.hydrant?.selectionId === HYDRANT_ID && live.search?.mapViewCreateCount === 1
    ? 'PASS'
    : 'PARTIAL',
  port: PORT,
  url: URL,
  live,
  artifacts: OUT
};
fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
