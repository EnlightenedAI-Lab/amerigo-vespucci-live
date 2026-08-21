/**
 * Live proof: selected hydrant ObjectRef marker on existing Google 3D pane.
 * Does not touch Street 360. Does not commit, push, deploy, or restart :3047.
 */
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';
import { filterHydrantsWithin } from '../public/spatial-v2/map/woa/hydrant-within.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'artifacts', 'spatial-v2-google-3d-hydrant-marker');
const PORT = 3047;
const URL = `http://localhost:${PORT}/spatial-v2/?v=linked-hydrant-v1-g3d2`;
const SEARCH = '997 de la Commune Ouest, Montréal';
const COMMUNE = Object.freeze({ longitude: -73.553221995734, latitude: 45.494180980834 });
const HYDRANTS = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/spatial-v2/data/woa/hydrants.geojson'), 'utf8'));
const QUAY = filterHydrantsWithin(HYDRANTS, COMMUNE, 80).find((hit) => (
  /993-999 rue de la Commune Ouest/i.test(String(hit.feature?.properties?.source?.ADRESSE || ''))
));

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
    '--window-size=1600,1000',
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
    const send = (method, params = {}, timeoutMs = 45000) => {
      nextId += 1;
      const id = nextId;
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
    await send('Network.enable');
    await send('Input.enable').catch(() => null);
    await send('Network.setCacheDisabled', { cacheDisabled: true });
    const result = await fn(send);
    ws.close();
    return result;
  } finally {
    child.kill();
  }
}

async function shot(send, name) {
  try {
    const result = await send('Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: false,
      fromSurface: true
    });
    const file = path.join(OUT, name);
    fs.writeFileSync(file, Buffer.from(result.data, 'base64'));
    return file;
  } catch (error) {
    fs.writeFileSync(path.join(OUT, `${name}.error.txt`), String(error?.message || error));
    return null;
  }
}

async function evaluateJson(send, expression, timeoutMs = 45000) {
  const result = await send('Runtime.evaluate', {
    expression: `(async () => {
      const value = ${expression};
      return await value;
    })()`,
    returnByValue: true,
    awaitPromise: true
  }, timeoutMs);
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
  console.log(JSON.stringify({ error: '3047 not listening', result: 'FAIL' }));
  process.exit(1);
}

const browserPath = findBrowser();
if (!browserPath) {
  console.log(JSON.stringify({ error: 'No Chrome/Edge', result: 'FAIL' }));
  process.exit(1);
}

if (!QUAY?.sourceId) {
  console.log(JSON.stringify({ error: 'Quay hydrant not in coverage', result: 'FAIL' }));
  process.exit(1);
}

const report = await withCdpPage(browserPath, 9273, async (send) => {
  const step = async (name, fn) => {
    console.error(`[g3d-hydrant] ${name}`);
    return fn();
  };
  await step('navigate', () => send('Page.navigate', { url: URL }));
  await step('shell', () => waitUntil(send, `Boolean(document.querySelector('#iqai-spatial-v2'))`, 40, 250));
  const mapPresent = await step('map', () => waitUntil(send, `Number(window.__iqaiSpatialV2?.mapFoundation?.getMapViewCreateCount?.() || window.__iqaiSpatialV2?.mapViewCreateCount || 0) === 1`, 90, 400));
  if (!mapPresent) {
    return { mapPresent: false, error: 'MAPVIEW_NOT_CREATED' };
  }

  const searched = await step('search', () => evaluateJson(send, `(async () => {
    const input = document.querySelector('[data-iqai-search-input]');
    const form = document.querySelector('[data-iqai-search-form]');
    if (input) input.value = ${JSON.stringify(SEARCH)};
    form?.requestSubmit?.();
    await new Promise((resolve) => setTimeout(resolve, 4500));
    const world = window.__iqaiSpatialV2?.world?.() || null;
    return {
      status: document.querySelector('[data-iqai-search-status]')?.textContent || null,
      focusAddress: world?.activeFocus?.address || null,
      revision: world?.revision || null
    };
  })()`));
  await shot(send, '01-search-go.png');

  await step('ask-toggle', () => evaluateJson(send, `document.querySelector('[data-iqai-ask-toggle]')?.click()`));
  await sleep(300);
  await step('ask-execute', () => evaluateJson(send, `window.__iqaiSpatialV2.ask.execute({ text: 'Show hydrants within 500 m of here.' })`));
  await sleep(400);
  const confirmed = await step('ask-confirm', () => evaluateJson(send, `window.__iqaiSpatialV2.ask.confirm()`));
  await step('ask-painted', () => waitUntil(send, `Boolean(window.__iqaiSpatialV2?.governedMapAction?.snapshot?.()?.last?.count)`, 40, 250));
  await sleep(700);

  const selected = await step('select', () => evaluateJson(send, `(async () => {
    const expectedId = ${JSON.stringify(String(QUAY.sourceId))};
    window.__iqaiSpatialV2?.hydrant?.clearRecords?.();
    window.__iqaiSpatialV2?.hydrant?.attach?.();
    const committed = await window.__iqaiSpatialV2?.hydrant?.handleHit?.({ sourceId: expectedId }, 'MAP');
    await new Promise((resolve) => setTimeout(resolve, 250));
    const world = window.__iqaiSpatialV2?.world?.();
    const inspectorEl = document.querySelector('[data-iqai-hydrant-object]');
    return {
      committed: committed === true,
      selectionId: world?.selection?.objectRefs?.[0]?.id || null,
      namespace: world?.selection?.objectRefs?.[0]?.namespace || null,
      kind: world?.selection?.objectRefs?.[0]?.kind || null,
      inspectorId: inspectorEl?.getAttribute('data-iqai-hydrant-object') || null,
      focusAddress: world?.activeFocus?.address || null,
      mapViewCreateCount: Number(window.__iqaiSpatialV2?.mapFoundation?.getMapViewCreateCount?.() || 0),
      trace: (window.__iqaiHydrantTrace || []).map((item) => item.step)
    };
  })()`));
  await shot(send, '02-map-selected.png');

  const opened = await step('open-google-3d', () => evaluateJson(send, `(async () => {
    const api = window.__iqaiSpatialV2?.google3d;
    const before = api?.snapshot?.() || null;
    try {
      if (before?.stageState === 'OPENING') {
        const waitOpen = Date.now();
        while (Date.now() - waitOpen < 50000) {
          const live = api?.snapshot?.() || {};
          if (live.open === true || live.stageState === 'OPEN' || live.stageState === 'ERROR') break;
          await new Promise((resolve) => setTimeout(resolve, 400));
        }
      } else if (before?.stageState !== 'OPEN' && before?.open !== true) {
        await api.open();
      }
    } catch (error) {
      return {
        error: String(error?.message || error),
        before,
        after: api?.snapshot?.() || null
      };
    }
    const started = Date.now();
    while (Date.now() - started < 20000) {
      const snap = api?.snapshot?.() || {};
      if (snap.open === true && snap.hydrantMarker?.present === true) break;
      if (snap.stageState === 'ERROR') break;
      await new Promise((resolve) => setTimeout(resolve, 400));
    }
    const live = api?.snapshot?.() || {};
    if (live.open === true && live.hydrantMarker?.present !== true) {
      const record = window.__iqaiSpatialV2?.hydrant?.snapshot?.()?.selectedRecord;
      if (record) await api.lookAtHydrant(record, { fly: true }).catch(() => {});
      await new Promise((resolve) => setTimeout(resolve, 800));
    }
    const after = api?.snapshot?.() || null;
    const node = document.querySelector('[data-iqai-hydrant-id="${String(QUAY.sourceId)}"]')
      || document.querySelector('gmp-marker-3d-interactive, gmp-marker-3d');
    return {
      before,
      after: {
        open: after?.open === true,
        stageState: after?.stageState || null,
        maps3dLoaded: after?.maps3dLoaded === true,
        error: after?.error || null,
        hydrantMarker: after?.hydrantMarker || null
      },
      node: node ? {
        tag: node.tagName,
        id: node.getAttribute?.('data-iqai-hydrant-id') || node.dataset?.iqaiHydrantId || null,
        title: node.title || node.getAttribute?.('aria-label') || null,
        label: node.label || null
      } : null
    };
  })()`, 90000));
  await sleep(2500);
  await shot(send, '03-google-3d-hydrant-marker.png');

  let clicked = { skipped: true };
  if (opened?.after?.hydrantMarker?.clickable === true) {
    clicked = await step('click-marker', () => evaluateJson(send, `(async () => {
      const node = document.querySelector('[data-iqai-hydrant-id="${String(QUAY.sourceId)}"]');
      node?.dispatchEvent?.(new Event('gmp-click', { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 300));
      const world = window.__iqaiSpatialV2?.world?.();
      return {
        selectionId: world?.selection?.objectRefs?.[0]?.id || null,
        inspectorId: document.querySelector('[data-iqai-hydrant-object]')?.getAttribute('data-iqai-hydrant-object') || null,
        markerId: window.__iqaiSpatialV2?.google3d?.snapshot?.()?.hydrantMarker?.sourceId || null
      };
    })()`));
    await shot(send, '04-google-3d-marker-click.png');
  }

  const imagery = await evaluateJson(send, `({
    selectedId: window.__iqaiSpatialV2?.hydrant?.link?.()?.selectedId || null,
    objectRefId: window.__iqaiSpatialV2?.hydrant?.link?.()?.objectRef?.id || null
  })`);

  return {
    searched,
    confirmed,
    selected,
    opened,
    clicked,
    imagery,
    mapViewCreateCount: await evaluateJson(send, `Number(window.__iqaiSpatialV2?.mapFoundation?.getMapViewCreateCount?.() || 0)`)
  };
});

const marker = report.opened?.after?.hydrantMarker || {};
const selectedOk = report.selected?.selectionId === String(QUAY.sourceId)
  && report.selected?.inspectorId === String(QUAY.sourceId)
  && report.selected?.namespace === 'ville-montreal'
  && /997 de la Commune/i.test(String(report.selected?.focusAddress || report.searched?.focusAddress || ''));
const markerOk = marker.present === true
  && marker.sourceId === String(QUAY.sourceId)
  && /VILLE INVENTORY POSITION/.test(String(marker.label || ''))
  && Math.abs(Number(marker.longitude) - Number(QUAY.feature.geometry.coordinates[0])) < 1e-8
  && Math.abs(Number(marker.latitude) - Number(QUAY.feature.geometry.coordinates[1])) < 1e-8;
const clickOk = report.clicked?.skipped === true
  || report.clicked?.selectionId === String(QUAY.sourceId);
const pass = selectedOk
  && markerOk
  && clickOk
  && Number(report.mapViewCreateCount) === 1
  && report.confirmed?.result?.mapExecuted === true;

const out = {
  result: pass ? 'PASS' : (selectedOk ? 'PARTIAL' : 'FAIL'),
  note: 'Google 3D hydrant marker is a Ville inventory position, not a Google-detected hydrant.',
  search: SEARCH,
  quayHydrant: {
    idBi: QUAY.sourceId,
    address: '993-999 rue de la Commune Ouest',
    longitude: QUAY.feature.geometry.coordinates[0],
    latitude: QUAY.feature.geometry.coordinates[1]
  },
  selected: report.selected,
  google3d: report.opened,
  clicked: report.clicked,
  imagery: report.imagery,
  mapViewCreateCount: report.mapViewCreateCount,
  markerOk,
  selectedOk,
  artifacts: OUT
};

console.log(JSON.stringify(out, null, 2));
process.exit(pass ? 0 : 1);
