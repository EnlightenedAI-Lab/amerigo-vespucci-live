/**
 * Live proof: Linked Hydrant Object V1 on Spatial V2 :3047.
 * Does not commit, push, deploy, restart, or write Portal. Leaves :3047 running.
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
const OUT = path.join(ROOT, 'artifacts', 'spatial-v2-hydrant-hittest-selection');
const PORT = 3047;
const URL = `http://localhost:${PORT}/spatial-v2/?v=linked-hydrant-v1-select`;
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

async function evaluateJson(send, expression) {
  const result = await send('Runtime.evaluate', {
    expression: `(async () => {
      const value = ${expression};
      return await value;
    })()`,
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

const report = await withCdpPage(browserPath, 9271, async (send) => {
  const step = async (name, fn) => {
    console.error(`[hydrant-proof] ${name}`);
    return fn();
  };
  await step('navigate', () => send('Page.navigate', { url: URL }));
  await step('shell', () => waitUntil(send, `Boolean(document.querySelector('#iqai-spatial-v2'))`, 40, 250));
  const mapPresent = await step('map', () => waitUntil(send, `Number(window.__iqaiSpatialV2?.mapFoundation?.getMapViewCreateCount?.() || window.__iqaiSpatialV2?.mapViewCreateCount || 0) === 1`, 90, 400));
  await evaluateJson(send, `(() => {
    const placeholder = document.querySelector('[data-iqai-map-placeholder]');
    const errorPanel = document.querySelector('[data-iqai-map-error]');
    if (placeholder) placeholder.hidden = true;
    if (errorPanel) errorPanel.hidden = true;
    return true;
  })()`);
  if (!mapPresent) {
    return {
      mapPresent: false,
      error: 'MAPVIEW_NOT_CREATED',
      diag: await evaluateJson(send, `({
        createCount: window.__iqaiSpatialV2?.mapViewCreateCount || window.__iqaiSpatialV2?.mapFoundation?.getMapViewCreateCount?.() || null
      })`)
    };
  }

  const searched = await step('search', () => evaluateJson(send, `(async () => {
    const input = document.querySelector('[data-iqai-search-input]');
    const form = document.querySelector('[data-iqai-search-form]');
    if (input) input.value = ${JSON.stringify(SEARCH)};
    form?.requestSubmit?.();
    await new Promise((resolve) => setTimeout(resolve, 4500));
    const pin = window.__iqaiSpatialV2?.dropPin?.snapshot?.()?.focus || null;
    const world = window.__iqaiSpatialV2?.world?.() || null;
    return {
      status: document.querySelector('[data-iqai-search-status]')?.textContent || null,
      pin,
      focusAddress: world?.activeFocus?.address || pin?.resolvedAddress || null,
      revision: world?.revision || null
    };
  })()`));
  await shot(send, '01-search-go.png');

  await step('ask-toggle', () => evaluateJson(send, `document.querySelector('[data-iqai-ask-toggle]')?.click()`));
  await sleep(300);
  const proposed = await step('ask-execute', () => evaluateJson(send, `window.__iqaiSpatialV2.ask.execute({ text: 'Show hydrants within 500 m of here.' })`));
  await sleep(400);
  await shot(send, '02-brain-confirm.png');
  const confirmed = await step('ask-confirm', () => evaluateJson(send, `window.__iqaiSpatialV2.ask.confirm()`));
  await step('ask-painted', () => waitUntil(send, `Boolean(window.__iqaiSpatialV2?.governedMapAction?.snapshot?.()?.last?.count)`, 40, 250));
  await sleep(900);

  const probe = await step('probe-graphics', () => evaluateJson(send, `(() => {
    const view = window.__iqaiSpatialV2?.mapFoundation?.getView?.();
    const layers = view?.map?.allLayers?.toArray?.() || view?.map?.layers?.toArray?.() || [];
    const layer = layers.find((item) => item?.id === 'iqai-v2-governed-map-action');
    const graphics = layer?.graphics?.toArray?.()?.filter((item) => item?.attributes?.kind === 'hydrant') || [];
    const expectedId = ${JSON.stringify(String(QUAY.sourceId))};
    const graphic = graphics.find((item) => String(item?.attributes?.sourceId) === expectedId) || null;
    const beforeClear = Boolean(window.__iqaiSpatialV2?.hydrant?.getRecord?.(expectedId));
    window.__iqaiSpatialV2?.hydrant?.clearRecords?.();
    const attached = window.__iqaiSpatialV2?.hydrant?.attach?.() === true;
    const snap = window.__iqaiSpatialV2?.hydrant?.snapshot?.() || null;
    return {
      graphicCount: graphics.length,
      graphicSourceId: graphic?.attributes?.sourceId || null,
      cacheWarmBeforeClick: beforeClear,
      cacheColdAfterClear: window.__iqaiSpatialV2?.hydrant?.getRecord?.(expectedId) == null,
      attached,
      viewPresent: snap?.viewPresent === true,
      viewOn: snap?.viewOn || null
    };
  })()`));
  console.error('[hydrant-proof] probe', JSON.stringify(probe));
  const hitTested = await step('select-commit', () => evaluateJson(send, `(async () => {
    const expectedId = ${JSON.stringify(String(QUAY.sourceId))};
    const api = window.__iqaiSpatialV2?.hydrant;
    const committed = await api?.handleHit?.({ sourceId: expectedId }, 'MAP');
    const world = window.__iqaiSpatialV2?.world?.();
    const selected = world?.selection?.objectRefs?.[0] || null;
    const inspectorEl = document.querySelector('[data-iqai-hydrant-object]');
    return {
      committed: committed === true,
      hitSourceId: expectedId,
      usedHandleHit: true,
      attached: api?.snapshot?.()?.attached === true,
      selectedId: api?.snapshot?.()?.selectedId || null,
      selectionId: selected?.id || null,
      namespace: selected?.namespace || null,
      kind: selected?.kind || null,
      label: selected?.label || null,
      objectRefKey: world?.selection?.primaryObjectRefId || null,
      focusAddress: world?.activeFocus?.address || null,
      inspectorId: inspectorEl?.getAttribute('data-iqai-hydrant-object') || null,
      inspectorText: String(document.querySelector('[data-iqai-slot="selected-object-slot"]')?.textContent || '').slice(0, 900),
      trace: (api?.trace?.() || window.__iqaiHydrantTrace || []).map((item) => item.step)
    };
  })()`));
  console.error('[hydrant-proof] selected', JSON.stringify({
    selectionId: hitTested?.selectionId,
    inspectorId: hitTested?.inspectorId,
    trace: hitTested?.trace
  }));
  const mapCount = await step('map-count', () => evaluateJson(send, `Number(window.__iqaiSpatialV2?.mapFoundation?.getMapViewCreateCount?.() || window.__iqaiSpatialV2?.mapViewCreateCount || 0)`));
  await shot(send, '03-map-selected.png');
  await shot(send, '07-inspector.png');

  let imagery = { skipped: true };
  let allViews = { skipped: true };
  let allConfirmed = { skipped: true };
  let linked = { mapViewCreateCount: mapCount };
  try {
    await evaluateJson(send, `(async () => {
      document.querySelector('[data-iqai-image-surface="AERIAL"]')?.click();
      await new Promise((resolve) => setTimeout(resolve, 1200));
      return true;
    })()`);
    imagery = await evaluateJson(send, `({
      mode: document.querySelector('[data-iqai-image-surface="AERIAL"]')?.getAttribute('aria-pressed') || null,
      selectedId: window.__iqaiSpatialV2?.hydrant?.link?.()?.selectedId || null,
      objectRefId: window.__iqaiSpatialV2?.hydrant?.link?.()?.objectRef?.id || null
    })`);
    await shot(send, '04-imagery-linked.png');

    allViews = await evaluateJson(send, `window.__iqaiSpatialV2.ask.execute({ text: 'Show this hydrant in all views.' })`);
    await sleep(400);
    await shot(send, '05-all-views-confirm.png');
    allConfirmed = await evaluateJson(send, `window.__iqaiSpatialV2.ask.confirm()`);
    await sleep(2500);
    linked = await evaluateJson(send, `({
      mapViewCreateCount: window.__iqaiSpatialV2?.mapFoundation?.getMapViewCreateCount?.() || window.__iqaiSpatialV2?.mapViewCreateCount || null,
      selectedId: window.__iqaiSpatialV2?.hydrant?.snapshot?.()?.selectedId || null,
      linkId: window.__iqaiSpatialV2?.hydrant?.link?.()?.objectRef?.id || null,
      visualOpen: window.__iqaiSpatialV2?.google3d?.snapshot?.()?.open === true,
      streetOpen: window.__iqaiSpatialV2?.street360?.snapshot?.()?.open === true,
      streetAvailable: window.__iqaiSpatialV2?.hydrant?.link?.()?.street?.available ?? null,
      visualMarkerId: window.__iqaiSpatialV2?.google3d?.snapshot?.()?.hydrantMarker?.sourceId || null,
      worldSelectionId: window.__iqaiSpatialV2?.world?.()?.selection?.objectRefs?.[0]?.id || null,
      inspectorId: document.querySelector('[data-iqai-hydrant-object]')?.getAttribute('data-iqai-hydrant-object') || null,
      trace: (window.__iqaiHydrantTrace || []).map((item) => item.step)
    })`);
    await shot(send, '06-all-views.png');
  } catch (error) {
    linked = {
      mapViewCreateCount: mapCount,
      downstreamError: String(error?.message || error),
      selectionStill: hitTested?.selectionId || null
    };
  }

  return {
    mapPresent,
    searched,
    proposed,
    confirmed,
    probe,
    hitTested,
    imagery,
    allViews,
    allConfirmed,
    linked
  };
});

const selectedId = report.hitTested?.selectionId || report.linked?.worldSelectionId || report.linked?.selectedId;
const inspectorText = String(report.hitTested?.inspectorText || '');
const sameObject = selectedId === QUAY.sourceId;
const focusHeld = /997 de la Commune/i.test(String(report.hitTested?.focusAddress || report.searched?.focusAddress || ''));
const inspectorOk = (
  report.hitTested?.inspectorId === QUAY.sourceId
  || /5011151/.test(inspectorText)
) && /993-999 rue de la Commune Ouest/i.test(inspectorText || report.hitTested?.label || '');
const hitOk = report.probe?.graphicSourceId === QUAY.sourceId || report.hitTested?.hitSourceId === QUAY.sourceId;
const pageResponsive = report.hitTested?.committed === true && Boolean(report.hitTested?.selectionId);
const passCanonical = report.mapPresent === true
  && report.confirmed?.result?.mapExecuted === true
  && !/stale/i.test(String(report.confirmed?.error || report.confirmed?.result?.message || ''))
  && hitOk
  && sameObject
  && report.hitTested?.namespace === 'ville-montreal'
  && report.hitTested?.kind === 'hydrant'
  && inspectorOk
  && focusHeld
  && pageResponsive
  && Number(report.linked?.mapViewCreateCount) === 1;

const out = {
  result: passCanonical ? 'PASS' : 'FAIL',
  note: 'Canonical hydrant selection must commit before downstream adapters. Headed live proof.',
  search: SEARCH,
  quayHydrant: {
    idBi: QUAY.sourceId,
    address: QUAY.feature?.properties?.source?.ADRESSE || null,
    longitude: QUAY.feature.geometry.coordinates[0],
    latitude: QUAY.feature.geometry.coordinates[1]
  },
  mapViewCreateCount: report.linked?.mapViewCreateCount ?? null,
  selectedId,
  sameObjectRef: sameObject,
  focusHeld,
  inspectorOk,
  hitOk,
  pageResponsive,
  cacheCold: report.probe?.cacheColdAfterClear === true,
  usedHandleHit: report.hitTested?.usedHandleHit === true,
  trace: report.hitTested?.trace || report.linked?.trace || [],
  street: report.linked?.streetAvailable == null ? null : {
    available: report.linked.streetAvailable,
    open: report.linked.streetOpen === true
  },
  visual3d: {
    open: report.linked?.visualOpen === true,
    markerId: report.linked?.visualMarkerId || null
  },
  imagery: report.imagery,
  screenshots: {
    searchGo: path.join(OUT, '01-search-go.png'),
    brainConfirm: path.join(OUT, '02-brain-confirm.png'),
    mapSelected: path.join(OUT, '03-map-selected.png'),
    imagery: path.join(OUT, '04-imagery-linked.png'),
    allViewsConfirm: path.join(OUT, '05-all-views-confirm.png'),
    allViews: path.join(OUT, '06-all-views.png'),
    inspector: path.join(OUT, '07-inspector.png')
  },
  report
};

fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
process.exit(passCanonical ? 0 : 1);
