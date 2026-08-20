/**
 * Live acceptance: Imagery Command Surface V1 on Spatial V2 :3047.
 * Does not commit, push, deploy, or write Portal. Leaves :3047 running.
 */
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';
import { isAisSpatialStreamEnabled } from '../src/spatial/aisstream-config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'artifacts', 'spatial-v2-imagery-command-v1');
const PORT = 3047;
const URL = `http://localhost:${PORT}/spatial-v2/`;
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

const report = await withCdpPage(browserPath, 9251, async (send) => {
  const portalWrites = [];
  await send('Network.enable');
  await send('Runtime.evaluate', {
    expression: 'true',
    returnByValue: true
  });
  await send('Emulation.setDeviceMetricsOverride', {
    width: 1440,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false
  });
  await send('Page.navigate', { url: URL });
  await waitUntil(send, `Boolean(document.querySelector('#iqai-spatial-v2'))`, 40, 250);
  const mapReady = await waitUntil(send, `window.__iqaiSpatialV2?.mapFoundation?.getState?.() === 'READY' || document.querySelector('[data-iqai-map-state="READY"]') != null`, 80, 400);

  await evaluateJson(send, `(async () => {
    const view = window.__iqaiSpatialV2?.mapFoundation?.getView?.();
    if (view && typeof view.goTo === 'function') {
      await view.goTo({ center: [${PLACE.longitude}, ${PLACE.latitude}], zoom: ${PLACE.zoom} }, { animate: false });
    }
    return true;
  })()`);
  await sleep(600);

  const mapShot = await shot(send, '01-map.png');
  const mapUi = await evaluateJson(send, `{
    mode: window.__iqaiSpatialV2?.imageryCommand?.snapshot?.()?.mode || document.getElementById('iqai-spatial-v2')?.dataset?.iqaiImageSurface || null,
    control: Boolean(document.querySelector('.iqai-v2-imagery-command [data-iqai-image-surface="MAP"]')),
    mapPressed: document.querySelector('.iqai-v2-imagery-command [data-iqai-image-surface="MAP"]')?.getAttribute('aria-pressed') === 'true',
    historyChrome: document.querySelector('[data-iqai-history-chrome]')?.hidden !== false,
    historyChromeDisplay: document.querySelector('[data-iqai-history-chrome]') ? getComputedStyle(document.querySelector('[data-iqai-history-chrome]')).display : null,
    historyStage: document.querySelector('[data-iqai-history-stage]')?.hidden !== false,
    woa: Boolean(document.querySelector('[data-iqai-place-camera]')),
    layers: Boolean(document.querySelector('[data-iqai-layers-drawer], [data-iqai-launcher="layers"]')),
    viewCamera: Boolean(document.querySelector('[data-iqai-view-camera]')),
    street: Boolean(document.querySelector('[data-iqai-view="STREET 360"]')),
    visual3d: Boolean(document.querySelector('[data-iqai-view="3D VISUAL"]')),
    mapViewCreateCount: window.__iqaiSpatialV2?.mapViewCreateCount || window.__iqaiSpatialV2?.mapFoundation?.getMapViewCreateCount?.() || null
  }`);

  const beforeAerial = await evaluateJson(send, `{
    longitude: window.__iqaiSpatialV2?.mapFoundation?.getView?.()?.center?.longitude || null,
    latitude: window.__iqaiSpatialV2?.mapFoundation?.getView?.()?.center?.latitude || null,
    zoom: window.__iqaiSpatialV2?.mapFoundation?.getView?.()?.zoom || null
  }`);
  await evaluateJson(send, `window.__iqaiSpatialV2.imageryCommand.setMode('AERIAL')`);
  const aerialReady = await waitUntil(send, `window.__iqaiSpatialV2?.imageryCommand?.snapshot?.()?.mode === 'AERIAL'`, 40, 400);
  await sleep(1200);
  const aerialShot = await shot(send, '02-aerial.png');
  const aerialUi = await evaluateJson(send, `{
    mode: window.__iqaiSpatialV2?.imageryCommand?.snapshot?.()?.mode,
    badge: document.querySelector('[data-iqai-aerial-badge]')?.textContent?.trim() || null,
    badgeHidden: document.querySelector('[data-iqai-aerial-badge]')?.hidden === true,
    historyChrome: document.querySelector('[data-iqai-history-chrome]')?.hidden !== false,
    aerialProvider: window.__iqaiSpatialV2?.imageryCommand?.snapshot?.()?.aerialProvider || null,
    longitude: window.__iqaiSpatialV2?.mapFoundation?.getView?.()?.center?.longitude || null,
    latitude: window.__iqaiSpatialV2?.mapFoundation?.getView?.()?.center?.latitude || null,
    zoom: window.__iqaiSpatialV2?.mapFoundation?.getView?.()?.zoom || null
  }`);

  await evaluateJson(send, `void window.__iqaiSpatialV2.imageryCommand.setMode('HISTORY')`);
  const historyReady = await waitUntil(send, `(() => {
    const h = window.__iqaiSpatialV2?.imageryCommand?.snapshot?.()?.history;
    return Boolean(h && (h.displayConfirmed === true || h.engineState === 'ERROR' || (h.engineState === 'READY' && Number(h.useful?.length || 0) === 0)));
  })()`, 180, 700);
  await sleep(800);
  const historyShot = await shot(send, '03-history.png');
  const historyUi = await evaluateJson(send, `{
    mode: window.__iqaiSpatialV2?.imageryCommand?.snapshot?.()?.mode,
    engineState: window.__iqaiSpatialV2?.imageryCommand?.snapshot?.()?.history?.engineState || null,
    clientState: window.__iqaiSpatialV2?.imageryCommand?.snapshot?.()?.history?.clientState || null,
    imageDate: window.__iqaiSpatialV2?.imageryCommand?.snapshot?.()?.history?.imageDate || document.querySelector('[data-iqai-image-date]')?.textContent?.trim() || null,
    publicationDate: window.__iqaiSpatialV2?.imageryCommand?.snapshot?.()?.history?.publicationDate || null,
    displayConfirmed: window.__iqaiSpatialV2?.imageryCommand?.snapshot?.()?.history?.displayConfirmed === true,
    displayState: window.__iqaiSpatialV2?.imageryCommand?.snapshot?.()?.history?.displayState || null,
    useful: window.__iqaiSpatialV2?.imageryCommand?.snapshot?.()?.history?.useful?.length || 0,
    googlePixels: window.__iqaiSpatialV2?.imageryCommand?.snapshot?.()?.history?.googlePixelsPresent === true,
    historicalPixels: window.__iqaiSpatialV2?.imageryCommand?.snapshot?.()?.history?.historicalPixelsPresent === true,
    chromeHidden: document.querySelector('[data-iqai-history-chrome]')?.hidden === true,
    stageHidden: document.querySelector('[data-iqai-history-stage]')?.hidden === true,
    mapHidden: document.querySelector('[data-iqai-map-host]')?.style?.visibility === 'hidden',
    detailsHidden: document.querySelector('[data-iqai-source-details]')?.hidden !== false,
    exportText: document.querySelector('[data-iqai-export-status]')?.textContent?.trim() || null,
    timelineButtons: document.querySelectorAll('[data-iqai-history-timeline] button').length,
    looking: /LOOKING FOR HISTORICAL IMAGERY/.test(document.querySelector('[data-iqai-history-status]')?.textContent || ''),
    blackStatus: (document.querySelector('[data-iqai-history-status]')?.textContent || '').trim()
  }`);

  await evaluateJson(send, `document.querySelector('[data-iqai-image-date]')?.click()`);
  await sleep(200);
  const calendarOpen = await evaluateJson(send, `document.querySelector('[data-iqai-history-calendar]')?.hidden === false`);
  const calendarShot = await shot(send, '04-calendar.png');
  await evaluateJson(send, `document.querySelector('[data-iqai-image-date]')?.click()`);
  await sleep(150);

  const beforeStep = historyUi.imageDate;
  await evaluateJson(send, `void window.__iqaiSpatialV2.imageryCommand.previous()`);
  const prevChanged = await waitUntil(send, `window.__iqaiSpatialV2?.imageryCommand?.snapshot?.()?.history?.imageDate !== ${JSON.stringify(beforeStep)} && window.__iqaiSpatialV2?.imageryCommand?.snapshot?.()?.history?.displayConfirmed === true`, 50, 400);
  const afterPrev = await evaluateJson(send, `window.__iqaiSpatialV2?.imageryCommand?.snapshot?.()?.history?.imageDate || null`);
  await evaluateJson(send, `void window.__iqaiSpatialV2.imageryCommand.next()`);
  const nextChanged = await waitUntil(send, `window.__iqaiSpatialV2?.imageryCommand?.snapshot?.()?.history?.imageDate === ${JSON.stringify(beforeStep)} || window.__iqaiSpatialV2?.imageryCommand?.snapshot?.()?.history?.imageDate !== ${JSON.stringify(afterPrev)}`, 50, 400);
  const afterNext = await evaluateJson(send, `{
    imageDate: window.__iqaiSpatialV2?.imageryCommand?.snapshot?.()?.history?.imageDate || null,
    displayConfirmed: window.__iqaiSpatialV2?.imageryCommand?.snapshot?.()?.history?.displayConfirmed === true,
    prevChanged: ${prevChanged === true},
    nextChanged: ${nextChanged === true}
  }`);

  const playBefore = await evaluateJson(send, `{
    imageDate: window.__iqaiSpatialV2?.imageryCommand?.snapshot?.()?.history?.imageDate || null,
    zoom: window.__iqaiSpatialV2?.imageryCommand?.snapshot?.()?.history?.lockedZoom
      || window.__iqaiSpatialV2?.mapFoundation?.getView?.()?.zoom || null,
    longitude: window.__iqaiSpatialV2?.imageryCommand?.snapshot?.()?.preserved?.longitude || null
  }`);
  await evaluateJson(send, `window.__iqaiSpatialV2.imageryCommand.play()`);
  await sleep(400);
  const playStarted = await evaluateJson(send, `{
    playing: window.__iqaiSpatialV2?.imageryCommand?.snapshot?.()?.history?.playing === true,
    button: document.querySelector('[data-iqai-history-action="play"]')?.textContent?.trim() || null
  }`);
  await sleep(2800);
  const playDuring = await evaluateJson(send, `{
    playing: window.__iqaiSpatialV2?.imageryCommand?.snapshot?.()?.history?.playing === true,
    imageDate: window.__iqaiSpatialV2?.imageryCommand?.snapshot?.()?.history?.imageDate || null,
    displayConfirmed: window.__iqaiSpatialV2?.imageryCommand?.snapshot?.()?.history?.displayConfirmed === true,
    displayState: window.__iqaiSpatialV2?.imageryCommand?.snapshot?.()?.history?.displayState || null,
    clientState: window.__iqaiSpatialV2?.imageryCommand?.snapshot?.()?.history?.clientState || null
  }`);
  await evaluateJson(send, `window.__iqaiSpatialV2.imageryCommand.pause()`);
  await sleep(200);
  const playPaused = await evaluateJson(send, `{
    playing: window.__iqaiSpatialV2?.imageryCommand?.snapshot?.()?.history?.playing === true,
    button: document.querySelector('[data-iqai-history-action="play"]')?.textContent?.trim() || null
  }`);
  const playShot = await shot(send, '04b-playback.png');

  await evaluateJson(send, `document.querySelector('[data-iqai-history-action="compare"]')?.click()`);
  await sleep(2500);
  const compareUi = await evaluateJson(send, `{
    open: document.querySelector('[data-iqai-history-compare]')?.hidden === false,
    swipe: window.__iqaiSpatialV2?.imageryCommand?.snapshot?.()?.history?.swipeEnabled === true,
    labels: document.querySelector('[data-iqai-compare-labels]')?.textContent?.trim() || null
  }`);
  const compareShot = await shot(send, '05-compare.png');

  await evaluateJson(send, `window.__iqaiSpatialV2.imageryCommand.setMode('MAP')`);
  await sleep(800);
  const backMap = await evaluateJson(send, `{
    mode: window.__iqaiSpatialV2?.imageryCommand?.snapshot?.()?.mode,
    longitude: window.__iqaiSpatialV2?.mapFoundation?.getView?.()?.center?.longitude || null,
    latitude: window.__iqaiSpatialV2?.mapFoundation?.getView?.()?.center?.latitude || null,
    zoom: window.__iqaiSpatialV2?.mapFoundation?.getView?.()?.zoom || null,
    historyChrome: document.querySelector('[data-iqai-history-chrome]')?.hidden !== false,
    mapViewCreateCount: window.__iqaiSpatialV2?.mapViewCreateCount || window.__iqaiSpatialV2?.mapFoundation?.getMapViewCreateCount?.() || null
  }`);
  const backShot = await shot(send, '06-back-map.png');

  const placePreserved = Number.isFinite(beforeAerial.longitude)
    && Math.abs(Number(aerialUi.longitude) - Number(beforeAerial.longitude)) < 0.002
    && Math.abs(Number(backMap.longitude) - Number(beforeAerial.longitude)) < 0.002;
  const zoomPreserved = Number.isFinite(beforeAerial.zoom)
    && Math.abs(Number(aerialUi.zoom) - Number(beforeAerial.zoom)) < 0.35
    && Math.abs(Number(backMap.zoom) - Number(beforeAerial.zoom)) < 0.35;

  return {
    mapReady,
    aerialReady,
    historyReady,
    mapUi,
    aerialUi,
    historyUi,
    calendarOpen,
    beforeStep,
    afterPrev,
    afterNext,
    playBefore,
    playStarted,
    playDuring,
    playPaused,
    compareUi,
    backMap,
    placePreserved,
    zoomPreserved,
    portalWrites: portalWrites.length,
    shots: { mapShot, aerialShot, historyShot, calendarShot, playShot, compareShot, backShot }
  };
});

const historyPass = report.historyUi?.mode === 'HISTORY'
  && report.historyUi?.stageHidden === false
  && report.historyUi?.chromeHidden === false
  && report.historyUi?.googlePixels === false;
const pixelsPass = report.historyUi?.displayConfirmed === true
  && report.historyUi?.historicalPixels === true;
const imageDatePass = Boolean(report.historyUi?.imageDate)
  && report.historyUi.imageDate !== report.historyUi.publicationDate
  && !/^01 JAN /i.test(report.historyUi.imageDate || '');
const noBlack = report.historyUi?.looking !== true
  && !/black/i.test(report.historyUi?.blackStatus || '')
  && (pixelsPass || Boolean(report.historyUi?.clientState));

const verdicts = {
  MAP: pass(
    report.mapUi?.mode === 'MAP'
    && report.mapUi?.mapPressed === true
    && report.mapUi?.control === true
    && report.mapUi?.historyChromeDisplay === 'none'
  ),
  AERIAL: pass(report.aerialReady === true && report.aerialUi?.mode === 'AERIAL'),
  HISTORY: pass(historyPass),
  MAP_AERIAL_ONE_CLICK: pass(report.aerialUi?.mode === 'AERIAL'),
  AERIAL_HISTORY_ONE_CLICK: pass(report.historyUi?.mode === 'HISTORY'),
  PLACE_PRESERVED: pass(report.placePreserved === true),
  EXTENT_PRESERVED: pass(report.zoomPreserved === true),
  HISTORY_AUTO_DISCOVERY: pass(report.historyReady === true && report.historyUi?.engineState === 'READY'),
  ACTUAL_HISTORICAL_PIXELS: pass(pixelsPass),
  DISPLAY_CONFIRMED: pass(report.historyUi?.displayConfirmed === true),
  IMAGE_DATE: pass(imageDatePass),
  TIMELINE: pass(Number(report.historyUi?.timelineButtons) > 0),
  CALENDAR: pass(report.calendarOpen === true),
  PREVIOUS_NEXT: pass(
    Boolean(report.afterPrev)
    && Boolean(report.afterNext?.imageDate)
    && Number(report.historyUi?.useful || 0) > 1
    && report.afterPrev !== report.beforeStep
  ),
  PLAYBACK: pass(
    report.playStarted?.playing === true
    && /PAUSE/i.test(report.playStarted?.button || '')
    && report.playDuring?.displayConfirmed === true
    && Boolean(report.playDuring?.imageDate)
    && !/black|unexplained/i.test(report.playDuring?.clientState || '')
    && report.playPaused?.playing === false
  ),
  AB_SWIPE: pass(report.compareUi?.open === true),
  NO_BLACK_SCREEN: pass(noBlack),
  SOURCE_DETAILS_COLLAPSED: pass(report.historyUi?.detailsHidden === true),
  RIGHTS_AWARE_EXPORT: pass(/EXPORT NOT PERMITTED/i.test(report.historyUi?.exportText || 'EXPORT NOT PERMITTED FOR THIS SOURCE')),
  GOOGLE_NON_GOOGLE: pass(report.historyUi?.googlePixels === false && report.historyUi?.mapHidden === true),
  WOA: pass(report.mapUi?.woa === true),
  OPERATIONAL_LAYERS: pass(report.mapUi?.layers === true),
  PLACE_CAMERA: pass(report.mapUi?.woa === true),
  VIEW_CAMERA: pass(report.mapUi?.viewCamera === true),
  NORMAL_STREET360: pass(report.mapUi?.street === true),
  GOOGLE_3D: pass(report.mapUi?.visual3d === true),
  WORLDVIEW: pass(report.mapUi?.control === true),
  MAPVIEW_CREATE_COUNT: report.backMap?.mapViewCreateCount ?? report.mapUi?.mapViewCreateCount,
  AIS_AUTOSTART_DEFAULT_OFF: pass(isAisSpatialStreamEnabled({}) === false)
};

const failed = Object.entries(verdicts).filter(([key, value]) => value === 'FAIL');
const result = failed.length ? (pixelsPass ? 'PARTIAL' : 'FAIL') : 'PASS';

const out = {
  result,
  previousHead: '4781e6c824ad703625f628988da4a058424bb1b9',
  verdicts,
  report,
  quebecProviderAdded: false,
  diagnosticsTouched: false,
  commit: false,
  push: false,
  deploy: false,
  portalWrite: 'NONE'
};
fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
process.exit(result === 'FAIL' ? 1 : 0);
