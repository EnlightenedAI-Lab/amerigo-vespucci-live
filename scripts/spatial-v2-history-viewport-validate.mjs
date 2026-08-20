/**
 * Live acceptance: viewport-AOI HISTORY on Spatial :3047.
 * Does not commit. Leaves :3047 running.
 */
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'artifacts', 'spatial-v2-history-viewport-aoi');
const PORT = 3047;
const URL = `http://localhost:${PORT}/spatial-v2/?v=history-viewport-aoi-v1`;
const PLACE = { longitude: -73.5534, latitude: 45.5046, zoom: 17 };

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
        }, 180000);
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

function pass(ok) {
  return ok ? 'PASS' : 'FAIL';
}

if (!(await isPortOpen(PORT))) {
  console.log(JSON.stringify({ error: '3047 not listening', result: 'FAIL' }, null, 2));
  process.exit(1);
}

const browserPath = findBrowser();
if (!browserPath) {
  console.log(JSON.stringify({ error: 'No Chrome/Edge', result: 'FAIL' }, null, 2));
  process.exit(1);
}

const report = await withCdpPage(browserPath, 9253, async (send) => {
  const catalogUrls = [];
  send('Network.enable');
  await send('Emulation.setDeviceMetricsOverride', {
    width: 1440,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false
  });
  await send('Page.navigate', { url: URL });
  await waitUntil(send, `Boolean(document.querySelector('#iqai-spatial-v2'))`, 40, 250);
  const mapReady = await waitUntil(send, `Number.isFinite(window.__iqaiSpatialV2?.mapFoundation?.getView?.()?.center?.longitude) && Boolean(window.__iqaiSpatialV2?.imageryCommand?.setMode)`, 80, 400);

  await evaluateJson(send, `(async () => {
    const view = window.__iqaiSpatialV2?.mapFoundation?.getView?.();
    if (view && typeof view.goTo === 'function') {
      await view.goTo({ center: [${PLACE.longitude}, ${PLACE.latitude}], zoom: ${PLACE.zoom} }, { animate: false });
    }
    return true;
  })()`);
  await sleep(800);

  await evaluateJson(send, `window.__iqaiSpatialV2.imageryCommand.setMode('HISTORY')`);
  const historyReady = await waitUntil(send, `(() => {
    const h = window.__iqaiSpatialV2?.imageryCommand?.snapshot?.()?.history;
    return Boolean(h && h.open && (h.displayConfirmed === true || h.status === 'NO HISTORICAL IMAGES FOR THIS VIEW' || h.status === 'NETWORK UNAVAILABLE' || h.catalogueOnly === true));
  })()`, 80, 400);
  await sleep(600);
  const first = await evaluateJson(send, `(() => {
    const snap = window.__iqaiSpatialV2?.imageryCommand?.snapshot?.();
    const h = snap?.history || {};
    const bar = document.querySelector('[data-iqai-history-bar]');
    return {
      mode: snap?.mode || null,
      open: h.open === true,
      displayConfirmed: h.displayConfirmed === true,
      status: h.status || '',
      date: document.querySelector('[data-iqai-history-date]')?.textContent?.trim() || h.date || null,
      now: document.querySelector('[data-iqai-history-now]')?.textContent?.trim() || null,
      source: document.querySelector('[data-iqai-history-source]')?.textContent?.trim() || null,
      resolution: document.querySelector('[data-iqai-history-resolution]')?.textContent?.trim() || null,
      prev: Boolean(bar?.querySelector('[data-iqai-history-step="-1"]')),
      next: Boolean(bar?.querySelector('[data-iqai-history-step="1"]')),
      compare: Boolean(bar?.querySelector('[data-iqai-history-compare]')),
      library: Boolean(bar?.querySelector('[data-iqai-history-library-toggle]')),
      catalogueInBar: Boolean(bar?.querySelector('[data-iqai-history-catalogue]')),
      researchCatalogue: Boolean(document.querySelector('[data-iqai-history-library] [data-iqai-history-catalogue]')),
      aoi: h.aoi || null,
      viewpoint: h.viewpoint || null,
      dates: h.dates?.length || 0,
      oldChromeHidden: document.querySelector('[data-iqai-history-chrome]')?.hidden !== false
    };
  })()`);
  const firstShot = await shot(send, '01-history-best.png');

  const pan = await evaluateJson(send, `(async () => {
    const canvas = document.querySelector('[data-iqai-history-canvas-host] canvas')
      || document.querySelector('[data-iqai-history-canvas]');
    if (!canvas) return { found: false };
    const r = canvas.getBoundingClientRect();
    const x0 = r.x + r.width * 0.62;
    const y0 = r.y + r.height * 0.5;
    const x1 = x0 - 220;
    canvas.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, clientX: x0, clientY: y0, button: 0, buttons: 1, pointerId: 1, pointerType: 'mouse', isPrimary: true }));
    canvas.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, cancelable: true, clientX: x1, clientY: y0, button: 0, buttons: 1, pointerId: 1, pointerType: 'mouse', isPrimary: true }));
    canvas.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, clientX: x1, clientY: y0, button: 0, buttons: 0, pointerId: 1, pointerType: 'mouse', isPrimary: true }));
    return { found: true, width: r.width, height: r.height };
  })()`);
  await sleep(900);
  const afterPan = await evaluateJson(send, `(() => {
    const h = window.__iqaiSpatialV2?.imageryCommand?.snapshot?.()?.history || {};
    return {
      displayConfirmed: h.displayConfirmed === true,
      date: h.date || null,
      aoi: h.aoi || null,
      viewpoint: h.viewpoint || null,
      status: h.status || ''
    };
  })()`);
  const panShot = await shot(send, '02-history-after-pan.png');

  const beforeStep = afterPan;
  await evaluateJson(send, `window.__iqaiSpatialV2.imageryCommand.previous()`);
  await sleep(500);
  const afterPrev = await evaluateJson(send, `(() => {
    const h = window.__iqaiSpatialV2?.imageryCommand?.snapshot?.()?.history || {};
    return {
      date: h.date || null,
      viewpoint: h.viewpoint || null,
      displayConfirmed: h.displayConfirmed === true
    };
  })()`);
  await evaluateJson(send, `document.querySelector('[data-iqai-history-bar] [data-iqai-history-library-toggle]')?.click()`);
  await sleep(400);
  const library = await evaluateJson(send, `(() => {
    const h = window.__iqaiSpatialV2?.imageryCommand?.snapshot?.()?.history || {};
    const panel = document.querySelector('[data-iqai-history-library]');
    const rows = [...(panel?.querySelectorAll('[data-iqai-history-library-id]') || [])];
    const show = panel?.querySelector('[data-iqai-history-show-in-map]:not([disabled])');
    return {
      libraryOpen: h.libraryOpen === true,
      hidden: panel?.hidden === true,
      path: location.pathname,
      rows: rows.length,
      showLabel: show?.textContent?.trim() || null,
      showId: show?.getAttribute('data-iqai-history-show-in-map') || null,
      observationId: h.observationId || null,
      viewpoint: h.viewpoint || null,
      research: panel?.querySelector('[data-iqai-history-catalogue]')?.textContent?.trim() || null
    };
  })()`);
  const libraryShot = await shot(send, '03-history-library.png');
  await evaluateJson(send, `document.querySelector('[data-iqai-history-show-in-map]:not([disabled])')?.click()`);
  await sleep(700);
  const afterShow = await evaluateJson(send, `(() => {
    const h = window.__iqaiSpatialV2?.imageryCommand?.snapshot?.()?.history || {};
    const onGround = document.querySelector('[data-iqai-history-library] .is-ground');
    return {
      path: location.pathname,
      libraryOpen: h.libraryOpen === true,
      displayConfirmed: h.displayConfirmed === true,
      observationId: h.observationId || null,
      date: h.date || null,
      viewpoint: h.viewpoint || null,
      onGroundId: onGround?.getAttribute('data-iqai-history-library-id') || null,
      now: document.querySelector('[data-iqai-history-now]')?.textContent?.trim() || null
    };
  })()`);
  await evaluateJson(send, `document.querySelector('[data-iqai-history-bar] [data-iqai-history-compare]')?.click()`);
  await sleep(700);
  const compare = await evaluateJson(send, `(() => {
    const h = window.__iqaiSpatialV2?.imageryCommand?.snapshot?.()?.history || {};
    const btn = document.querySelector('[data-iqai-history-bar] [data-iqai-history-compare]');
    return {
      compareOn: h.compareOn === true,
      pressed: btn?.getAttribute('aria-pressed') === 'true',
      swipe: document.querySelector('[data-iqai-history-swipe]')?.hidden === false,
      displayConfirmed: h.displayConfirmed === true,
      viewpoint: h.viewpoint || null
    };
  })()`);
  const compareShot = await shot(send, '03-history-compare.png');

  await evaluateJson(send, `window.__iqaiSpatialV2.imageryCommand.setMode('MAP')`);
  await sleep(700);
  const back = await evaluateJson(send, `(() => {
    const snap = window.__iqaiSpatialV2?.imageryCommand?.snapshot?.();
    const view = window.__iqaiSpatialV2?.mapFoundation?.getView?.();
    return {
      mode: snap?.mode || null,
      longitude: view?.center?.longitude || null,
      latitude: view?.center?.latitude || null,
      zoom: view?.zoom || null
    };
  })()`);
  const backShot = await shot(send, '04-back-map.png');

  return {
    mapReady,
    historyReady,
    pan,
    first,
    afterPan,
    afterPrev,
    library,
    afterShow,
    compare,
    back,
    beforeStep,
    shots: { firstShot, panShot, libraryShot, compareShot, backShot }
  };
});

function moved(a, b, min = 0.0002) {
  if (!a || !b) return false;
  return Math.abs(Number(a.longitude) - Number(b.longitude)) > min
    || Math.abs(Number(a.latitude) - Number(b.latitude)) > min;
}

function sameCamera(a, b, max = 0.00015) {
  if (!a || !b) return false;
  return Math.abs(Number(a.longitude) - Number(b.longitude)) < max
    && Math.abs(Number(a.latitude) - Number(b.latitude)) < max
    && Math.abs(Number(a.zoom) - Number(b.zoom)) < 0.2;
}

const bboxUsed = Number.isFinite(Number(report.first?.aoi?.xmin))
  && Number.isFinite(Number(report.first?.aoi?.xmax));
const chromeOk = report.first?.date
  && report.first?.source
  && report.first?.resolution
  && report.first?.prev
  && report.first?.next
  && report.first?.compare
  && report.first?.library
  && report.first?.catalogueInBar !== true
  && report.first?.researchCatalogue === true
  && String(report.first?.now || '').startsWith('HISTORY');
const panMoved = moved(report.first?.viewpoint, report.afterPan?.viewpoint)
  || (Number(report.first?.aoi?.xmin) !== Number(report.afterPan?.aoi?.xmin));
const rediscoverAfterPan = report.afterPan?.displayConfirmed === true
  && Number.isFinite(Number(report.afterPan?.aoi?.xmin))
  && (panMoved || report.pan?.found === true);
const prevKeptCamera = sameCamera(report.afterPan?.viewpoint, report.afterPrev?.viewpoint);
const libraryInSpatial = report.library?.libraryOpen === true
  && report.library?.hidden !== true
  && String(report.library?.path || '').includes('/spatial-v2')
  && Number(report.library?.rows) > 0;
const showedInMap = !report.library?.showId
  || (
    report.afterShow?.observationId === report.library.showId
    && report.afterShow?.onGroundId === report.library.showId
    && sameCamera(report.library?.viewpoint, report.afterShow?.viewpoint)
    && String(report.afterShow?.path || '').includes('/spatial-v2')
  );
const leaveAtHistory = sameCamera(report.compare?.viewpoint || report.afterShow?.viewpoint || report.afterPan?.viewpoint, {
  longitude: report.back?.longitude,
  latitude: report.back?.latitude,
  zoom: report.back?.zoom
}, 0.002);

const verdicts = {
  MAP_READY: pass(report.mapReady === true),
  HISTORY_OPEN: pass(report.first?.mode === 'HISTORY' && report.first?.open === true),
  BEST_PAINTED: pass(report.first?.displayConfirmed === true),
  VIEWPORT_BBOX: pass(bboxUsed),
  CHROME: pass(chromeOk),
  OLD_CHROME_HIDDEN: pass(report.first?.oldChromeHidden === true),
  PAN_KEEPS_CAMERA_MOVE: pass(panMoved),
  REDISCOVER_AFTER_PAN: pass(rediscoverAfterPan),
  PREV_KEEPS_CAMERA: pass(prevKeptCamera),
  LIBRARY_IN_SPATIAL: pass(libraryInSpatial),
  SHOW_IN_MAP: pass(showedInMap),
  COMPARE: pass(report.compare?.compareOn === true || report.compare?.pressed === true),
  LEAVE_AT_LAST_VIEW: pass(leaveAtHistory && report.back?.mode === 'MAP')
};

const failed = Object.values(verdicts).some((value) => value !== 'PASS');
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify({ verdicts, report }, null, 2));
console.log(JSON.stringify({ result: failed ? 'FAIL' : 'PASS', verdicts, first: report.first, afterPan: report.afterPan, afterPrev: report.afterPrev, compare: report.compare, back: report.back }, null, 2));
process.exit(failed ? 1 : 0);
