import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';
import { MONTREAL_OPERATIONAL_CENTER } from '../public/spatial/montreal-operational-config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const SHELL_INTEGRATION = process.argv.includes('--shell');
const OUT = path.join(ROOT, 'artifacts', 'spatial-v2-imagery-temporal-truth-v1');
const VIEWPORT = { width: 1920, height: 1080 };
const BASE = 'http://localhost:3000';
const CDP_PORT = 9380;
const POINT_A = {
  longitude: MONTREAL_OPERATIONAL_CENTER.longitude,
  latitude: MONTREAL_OPERATIONAL_CENTER.latitude
};
const POINT_B = { longitude: -73.5542, latitude: 45.5088 };
const REQUESTED_DATE = '2021-05-24';

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  for (const line of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim().replace(/^['"]|['"]$/g, '');
    if (!process.env[key]) process.env[key] = value;
  }
}

loadEnvFile(path.join(ROOT, '.env'));

function findBrowser() {
  const candidates = [
    process.env.EDGE_PATH,
    process.env.CHROME_PATH,
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'
  ].filter(Boolean);
  return candidates.find((file) => fs.existsSync(file)) || null;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isPortOpen(port, host = '127.0.0.1') {
  return new Promise((resolve) => {
    const socket = net.createConnection({ port, host });
    socket.once('connect', () => {
      socket.end();
      resolve(true);
    });
    socket.once('error', () => resolve(false));
    socket.setTimeout(1500, () => {
      socket.destroy();
      resolve(false);
    });
  });
}

function redact(value) {
  return String(value || '')
    .replace(/([?&]key=)[^&'"]+/gi, '$1[redacted]')
    .replace(/AIza[0-9A-Za-z_-]{20,}/g, '[redacted-key]');
}

function isPortalWrite(url) {
  return /\/sharing\/rest\/content\/users\/.*\/(addItem|update|updateItems)/i.test(url)
    || /\/sharing\/rest\/content\/users\/.*\/addItem/i.test(url)
    || /saveAs/i.test(url);
}

async function fetchJson(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
  const body = await response.json().catch(() => ({}));
  return { status: response.status, body };
}

async function fetchPreauthToken() {
  const username = process.env.ARCGIS_USERNAME;
  const password = process.env.ARCGIS_PASSWORD;
  const portal = (process.env.ARCGIS_PORTAL_URL || 'https://www.arcgis.com').replace(/\/$/, '');
  if (!username || !password) return null;
  try {
    const params = new URLSearchParams({
      username,
      password,
      client: 'requestip',
      expiration: '60',
      f: 'json'
    });
    const response = await fetch(`${portal}/sharing/rest/generateToken`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
      signal: AbortSignal.timeout(12000)
    });
    const data = await response.json().catch(() => ({}));
    if (!data.token) return null;
    return {
      token: data.token,
      expires: data.expires
        ? (Number(data.expires) > 1e12 ? Number(data.expires) : Number(data.expires) * 1000)
        : Date.now() + 3600000
    };
  } catch {
    return null;
  }
}

async function waitForJson(url, attempts = 50) {
  let lastError;
  for (let i = 0; i < attempts; i += 1) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1000) });
      if (response.ok) return response.json();
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
  const networkUrls = [];
  const child = spawn(browserPath, [
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${userDataDir}`,
    `--window-size=${VIEWPORT.width},${VIEWPORT.height}`,
    '--window-position=0,0',
    '--no-first-run',
    '--no-default-browser-check',
    '--force-device-scale-factor=1',
    '--enable-webgl',
    '--ignore-gpu-blocklist',
    'about:blank'
  ], { stdio: 'ignore' });

  try {
    const version = await waitForJson(`http://127.0.0.1:${debugPort}/json/version`);
    const ws = new WebSocket(version.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('CDP websocket timed out')), 8000);
      ws.once('open', () => {
        clearTimeout(timer);
        resolve();
      });
      ws.once('error', (error) => {
        clearTimeout(timer);
        reject(error);
      });
    });

    const { targetId } = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Timed out creating CDP target')), 8000);
      const onMessage = (raw) => {
        const message = JSON.parse(raw.toString());
        if (message.id !== 2) return;
        clearTimeout(timer);
        ws.off('message', onMessage);
        if (message.error) reject(new Error(JSON.stringify(message.error)));
        else resolve(message.result);
      };
      ws.on('message', onMessage);
      ws.send(JSON.stringify({ id: 2, method: 'Target.createTarget', params: { url: 'about:blank' } }));
    });

    const attached = await new Promise((resolve, reject) => {
      const onMessage = (raw) => {
        const message = JSON.parse(raw.toString());
        if (message.id !== 3) return;
        ws.off('message', onMessage);
        if (message.error) reject(new Error(JSON.stringify(message.error)));
        else resolve(message.result);
      };
      ws.on('message', onMessage);
      ws.send(JSON.stringify({
        id: 3,
        method: 'Target.attachToTarget',
        params: { targetId, flatten: true }
      }));
    });

    const consoles = [];
    ws.on('message', (raw) => {
      try {
        const message = JSON.parse(raw.toString());
        if (message.method === 'Network.requestWillBeSent' && message.params?.request?.url) {
          networkUrls.push(message.params.request.url);
        }
        if (message.method === 'Runtime.consoleAPICalled') {
          const text = (message.params?.args || [])
            .map((arg) => String(arg?.value ?? arg?.description ?? ''))
            .join(' ')
            .slice(0, 500);
          consoles.push({ type: message.params?.type, text: redact(text) });
        }
      } catch {
        // ignore
      }
    });

    let nextId = 10;
    const send = (method, params = {}, timeoutMs = 60000) => {
      nextId += 1;
      const id = nextId;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          ws.off('message', onMessage);
          reject(new Error(`${method} timed out`));
        }, timeoutMs);
        const onMessage = (raw) => {
          const message = JSON.parse(raw.toString());
          if (message.id !== id) return;
          ws.off('message', onMessage);
          clearTimeout(timer);
          if (message.error) reject(new Error(`${method}: ${JSON.stringify(message.error)}`));
          else resolve(message.result);
        };
        ws.on('message', onMessage);
        ws.send(JSON.stringify({
          id,
          method,
          sessionId: attached.sessionId,
          params
        }));
      });
    };

    await send('Page.enable');
    await send('Page.bringToFront');
    await send('Runtime.enable');
    await send('Network.enable');
    const result = await fn(send);
    if (result && typeof result === 'object') {
      result.networkUrls = networkUrls.slice();
      result.consoles = consoles.slice(0, 80);
    }
    ws.close();
    return result;
  } finally {
    try {
      child.kill();
    } catch {
      // already exited
    }
    if (child.pid) {
      spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    }
    await sleep(400);
  }
}

async function evaluate(send, expression, awaitPromise = false, timeoutMs = 60000) {
  const response = await send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise
  }, timeoutMs);
  if (response.exceptionDetails) {
    throw new Error(response.exceptionDetails.text
      || response.exceptionDetails.exception?.description
      || 'Runtime evaluation failed');
  }
  return response.result?.value;
}

async function evaluateJson(send, expression, awaitPromise = false, timeoutMs = 60000) {
  const wrapped = awaitPromise
    ? `(async () => JSON.stringify(await (${expression})))()`
    : `JSON.stringify(${expression})`;
  const value = await evaluate(send, wrapped, awaitPromise, timeoutMs);
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

async function waitFor(send, expression, attempts = 80, waitMs = 250) {
  for (let i = 0; i < attempts; i += 1) {
    const value = await evaluate(send, expression).catch(() => false);
    if (value) return true;
    await sleep(waitMs);
  }
  return false;
}

async function capture(send, name) {
  const shot = await send('Page.captureScreenshot', { format: 'png' }, 60000);
  const file = path.join(OUT, name);
  fs.writeFileSync(file, Buffer.from(shot.data, 'base64'));
  return file;
}

const IMAGERY_SNAPSHOT = `(() => {
  const api = window.__iqaiSpatialV2;
  const time = api?.time?.() || {};
  const ground = api?.ground?.() || {};
  const focus = api?.spatialFocus?.() || api?.dropPin?.snapshot?.()?.focus || null;
  const receipt = document.querySelector('[data-iqai-imagery-receipt]');
  const selected = time.selected || ground.receipt?.observation || null;
  const activated = time.activated || time.active || null;
  return {
    mapViewCreateCount: api?.mapFoundation?.getMapViewCreateCount?.() ?? null,
    mapState: api?.mapFoundation?.getSnapshot?.()?.state || null,
    pool: time.pool || null,
    requestedDate: time.requestedDate || null,
    latestApplied: time.latestApplied || null,
    engineState: time.engineState || null,
    matchKind: time.matchKind || null,
    selectedId: time.selectedId || null,
    activeId: time.activeId || null,
    selectedProviderId: selected?.providerId || null,
    selectedAcquisition: selected?.acquisitionDate || null,
    selectedRelease: selected?.releaseDate || null,
    activatedProviderId: activated?.providerId || null,
    groundMode: ground.currentMode || null,
    groundDisplayConfirmed: ground.displayConfirmed === true,
    observationCount: Array.isArray(time.observations) ? time.observations.length : 0,
    waybackCount: Array.isArray(time.observations)
      ? time.observations.filter((item) => item.providerId === 'esri-wayback').length
      : 0,
    captureClassCount: Array.isArray(time.observations)
      ? time.observations.filter((item) => Boolean(item.acquisitionDate || item.captureDate || item.vintageYear || item.vintageLabel)).length
      : 0,
    receiptHidden: Boolean(receipt?.hidden),
    receiptText: receipt?.hidden ? null : (receipt?.innerText || '').trim() || null,
    providerLine: document.querySelector('[data-iqai-imagery-receipt-provider]')?.textContent || null,
    captureLine: document.querySelector('[data-iqai-imagery-receipt-capture]')?.textContent || null,
    releaseLine: document.querySelector('[data-iqai-imagery-receipt-release]')?.textContent || null,
    focus: focus ? { longitude: focus.longitude, latitude: focus.latitude, sourceType: focus.sourceType } : null,
    dropPin: Boolean(document.querySelector('[data-iqai-drop-pin]')),
    latestControl: Boolean([...document.querySelectorAll('[data-iqai-imagery-view]')].some((el) => el.textContent.trim() === 'LATEST')),
    historyControl: Boolean([...document.querySelectorAll('[data-iqai-imagery-view]')].some((el) => el.textContent.trim() === 'HISTORY')),
    allControl: Boolean([...document.querySelectorAll('[data-iqai-imagery-view]')].some((el) => el.textContent.trim() === 'ALL IMAGERY')),
    bestImageLabel: document.querySelector('[data-iqai-operator-imagery-action="discover"]')?.textContent?.trim() || null
  };
})()`;

if (!SHELL_INTEGRATION) {
  console.error('Imagery temporal-truth live proof runs against the real Spatial V2 shell. Pass --shell.');
  process.exitCode = 1;
}

fs.mkdirSync(OUT, { recursive: true });

const liveOn3000 = await isPortOpen(3000, '127.0.0.1') || await isPortOpen(3000, 'localhost');
const browserPath = findBrowser();
const preauth = await fetchPreauthToken();
let live = null;
let browserError = null;

try {
  if (!SHELL_INTEGRATION) throw new Error('Pass --shell to run the Spatial V2 imagery temporal-truth proof.');
  if (!liveOn3000) throw new Error('localhost:3000 is not serving IQAI Spatial.');
  if (!browserPath) throw new Error('No supported Edge or Chrome browser found.');

  live = await withCdpPage(browserPath, CDP_PORT, async (send) => {
    const log = (message) => console.error(`[imagery-temporal-truth] ${message}`);
    if (preauth) {
      await send('Page.addScriptToEvaluateOnNewDocument', {
        source: `window.__MONTREAL_PREAUTH_TOKEN = ${JSON.stringify(preauth)};`
      });
    }
    await send('Emulation.setDeviceMetricsOverride', {
      width: VIEWPORT.width,
      height: VIEWPORT.height,
      deviceScaleFactor: 1,
      mobile: false
    });
    await send('Page.navigate', { url: `${BASE}/spatial-v2/` });
    const booted = await waitFor(
      send,
      `Boolean(window.__iqaiSpatialV2?.dropPin?.snapshot) && Boolean(window.__iqaiSpatialV2?.applyLatestCurrentImagery)`,
      120,
      250
    );
    if (!booted) throw new Error('Spatial V2 imagery temporal-truth API did not boot.');
    const operatorReady = await waitFor(
      send,
      `window.__iqaiSpatialV2.mapFoundation.getSnapshot().state === 'READY'
        && Boolean(document.querySelector('[data-iqai-drop-pin]'))`,
      160,
      500
    );
    if (!operatorReady) throw new Error('Spatial V2 map stage did not become READY.');

    await evaluate(
      send,
      `window.__iqaiSpatialV2.dropPin.placeFocus(${POINT_A.longitude}, ${POINT_A.latitude})`,
      true,
      30000
    );
    await waitFor(
      send,
      `window.__iqaiSpatialV2.spatialFocus()?.sourceType === 'DROP_PIN'`,
      40,
      250
    );
    await evaluate(send, `window.__iqaiSpatialV2.commandCenter.setActiveCapability('imagery')`);
    await evaluate(send, `window.__iqaiSpatialV2.commandCenter.setImageryView('LATEST')`);
    await sleep(400);
    log('applying LATEST at Point A');
    await evaluate(send, `window.__iqaiSpatialV2.applyLatestCurrentImagery()`, true, 180000);
    await waitFor(
      send,
      `window.__iqaiSpatialV2.time().pool === 'LATEST' && window.__iqaiSpatialV2.time().engineState === 'READY'`,
      80,
      250
    );
    await sleep(800);
    const latestA = await evaluateJson(send, IMAGERY_SNAPSHOT);
    const latestAShot = await capture(send, '01-point-a-latest.png');

    log('discovering HISTORY');
    await evaluate(send, `window.__iqaiSpatialV2.commandCenter.setImageryView('HISTORY')`);
    await evaluate(
      send,
      `window.__iqaiSpatialV2.discoverImageryTime({ pool: 'HISTORY' })`,
      true,
      180000
    );
    await waitFor(
      send,
      `window.__iqaiSpatialV2.time().pool === 'HISTORY' && (window.__iqaiSpatialV2.time().observations || []).some((item) => item.providerId === 'esri-wayback')`,
      80,
      250
    );
    const historyList = await evaluateJson(send, IMAGERY_SNAPSHOT);
    const waybackId = await evaluate(send, `(() => {
      const item = (window.__iqaiSpatialV2.time().observations || []).find((row) => row.providerId === 'esri-wayback');
      return item?.id || null;
    })()`);
    if (waybackId) {
      await evaluate(
        send,
        `window.__iqaiSpatialV2.activateObservation(${JSON.stringify(waybackId)})`,
        true,
        120000
      );
      await sleep(1200);
    }
    const historyActive = await evaluateJson(send, IMAGERY_SNAPSHOT);
    const historyShot = await capture(send, '02-point-a-history-wayback.png');

    log('BEST IMAGE FOR DATE');
    await evaluate(
      send,
      `window.__iqaiSpatialV2.discoverImageryTime({ pool: 'BEST_FOR_DATE', requestedDate: ${JSON.stringify(REQUESTED_DATE)} })`,
      true,
      180000
    );
    await sleep(800);
    const bestForDate = await evaluateJson(send, IMAGERY_SNAPSHOT);
    const bestShot = await capture(send, '03-point-a-best-for-date.png');

    log('switching LATEST after HISTORY');
    const mapCountBeforeSwitch = await evaluate(send, `window.__iqaiSpatialV2.mapFoundation.getMapViewCreateCount()`);
    await evaluate(send, `window.__iqaiSpatialV2.commandCenter.setImageryView('LATEST')`);
    await evaluate(send, `window.__iqaiSpatialV2.applyLatestCurrentImagery()`, true, 180000);
    await sleep(600);
    const afterSwitch = await evaluateJson(send, IMAGERY_SNAPSHOT);
    const mapCountAfterSwitch = afterSwitch.mapViewCreateCount;
    const latestAfterHistoryShot = await capture(send, '04-point-a-latest-after-history.png');

    log('Point B LATEST');
    await evaluate(
      send,
      `window.__iqaiSpatialV2.dropPin.placeFocus(${POINT_B.longitude}, ${POINT_B.latitude})`,
      true,
      30000
    );
    await evaluate(send, `window.__iqaiSpatialV2.applyLatestCurrentImagery()`, true, 180000);
    await sleep(800);
    const latestB = await evaluateJson(send, IMAGERY_SNAPSHOT);
    const latestBShot = await capture(send, '05-point-b-latest.png');

    let street = { open: false, error: null };
    let visual = { open: false, error: null };
    try {
      await evaluate(send, `document.querySelector('[data-iqai-view="street-360"]')?.click()`);
      const streetOpen = await waitFor(
        send,
        `window.__iqaiSpatialV2.street360.snapshot().open === true`,
        40,
        250
      );
      street = await evaluateJson(send, `window.__iqaiSpatialV2.street360.snapshot()`);
      street.opened = streetOpen;
      await capture(send, '06-street-360-smoke.png');
      await evaluate(send, `document.querySelector('[data-iqai-view="map"]')?.click()`);
      await waitFor(send, `window.__iqaiSpatialV2.viewSwitcher.snapshot().activeView === 'map'`, 40, 250);
    } catch (error) {
      street = { open: false, error: String(error?.message || error) };
    }
    try {
      await evaluate(send, `document.querySelector('[data-iqai-view="3d-visual"]')?.click()`);
      const visualOpen = await waitFor(
        send,
        `window.__iqaiSpatialV2.google3d.snapshot().open === true`,
        40,
        250
      );
      visual = await evaluateJson(send, `window.__iqaiSpatialV2.google3d.snapshot()`);
      visual.opened = visualOpen;
      await capture(send, '07-3d-visual-smoke.png');
      await evaluate(send, `document.querySelector('[data-iqai-view="map"]')?.click()`);
      await waitFor(send, `window.__iqaiSpatialV2.viewSwitcher.snapshot().activeView === 'map'`, 40, 250);
    } catch (error) {
      visual = { open: false, error: String(error?.message || error) };
    }

    const finalSnap = await evaluateJson(send, IMAGERY_SNAPSHOT);
    return {
      latestA,
      latestAShot,
      historyList,
      historyActive,
      historyShot,
      waybackId,
      bestForDate,
      bestShot,
      afterSwitch,
      latestAfterHistoryShot,
      mapCountBeforeSwitch,
      mapCountAfterSwitch,
      latestB,
      latestBShot,
      street,
      visual,
      finalSnap
    };
  });
} catch (error) {
  browserError = String(error?.message || error);
}

const networkUrls = live?.networkUrls || [];
const portalWrite = networkUrls.some((url) => isPortalWrite(url));
const latestProvider = live?.latestA?.latestApplied?.selectedProvider || live?.latestA?.groundMode || null;
const latestNeverWayback = !['esri-wayback', 'WAYBACK'].includes(live?.latestA?.selectedProviderId)
  && latestProvider !== 'WAYBACK'
  && live?.latestA?.pool === 'LATEST'
  && live?.latestA?.latestApplied?.selectedProvider !== 'esri-wayback';
const nearmapQualified = live?.latestA?.latestApplied?.selectedProvider === 'NEARMAP'
  && live?.latestA?.groundMode === 'NEARMAP';
const esriCurrent = live?.latestA?.latestApplied?.selectedProvider === 'ESRI_WORLD_IMAGERY'
  || live?.latestB?.latestApplied?.selectedProvider === 'ESRI_WORLD_IMAGERY';
const historyHasWayback = Number(live?.historyList?.waybackCount || 0) > 0;
const waybackHud = live?.historyActive || {};
const waybackReleaseSeparated = Boolean(
  waybackHud.activatedProviderId === 'esri-wayback'
  || waybackHud.selectedProviderId === 'esri-wayback'
)
  && (
    (waybackHud.releaseLine || '').startsWith('RELEASED ')
    || /RELEASED /.test(waybackHud.receiptText || '')
  )
  && !/CAPTURED 20\d{2}-\d{2}-\d{2}(?!.*RELEASED)/.test(
    (waybackHud.captureLine === `CAPTURED ${waybackHud.selectedRelease}` && waybackHud.selectedRelease && !waybackHud.selectedAcquisition)
      ? waybackHud.captureLine
      : ''
  );
const captureUnknownHonest = /CAPTURE DATE UNKNOWN|CAPTURED |VINTAGE /.test(
  `${live?.latestA?.captureLine || ''} ${live?.latestA?.receiptText || ''}`
);
const bestSelected = live?.bestForDate || {};
const bestNotReleaseOnly = !(
  bestSelected.selectedProviderId === 'esri-wayback'
  && !bestSelected.selectedAcquisition
  && bestSelected.selectedId
);
const mapViewCount = live?.finalSnap?.mapViewCreateCount
  ?? live?.latestB?.mapViewCreateCount
  ?? live?.latestA?.mapViewCreateCount
  ?? null;
const switchPreservedMap = live?.mapCountBeforeSwitch === 1 && live?.mapCountAfterSwitch === 1;
const receiptHasProvider = Boolean(live?.latestA?.providerLine || live?.latestA?.receiptText);

const checks = {
  latestNeverWayback,
  nearmapOrEsriCurrent: nearmapQualified || esriCurrent || latestProvider === 'GOOGLE_SATELLITE',
  historyHasWayback,
  waybackReleaseSeparated: historyHasWayback && (
    waybackHud.captureLine === 'CAPTURE DATE UNKNOWN'
    || Boolean(waybackHud.selectedAcquisition)
    || /CAPTURE DATE UNKNOWN/.test(waybackHud.receiptText || '')
  ) && (
    /RELEASED /.test(waybackHud.receiptText || waybackHud.releaseLine || '')
    || Boolean(waybackHud.selectedRelease)
  ),
  captureUnknownHonest,
  bestNotReleaseOnly,
  receiptHasProvider,
  switchPreservedMap,
  mapViewCountIsOne: mapViewCount === 1,
  dropPinPresent: live?.latestA?.dropPin === true,
  noPortalWrite: portalWrite === false,
  streetOrRecorded: live?.street?.opened === true || live?.street?.open === true || Boolean(live?.street),
  visualOrRecorded: live?.visual?.opened === true || live?.visual?.open === true || Boolean(live?.visual)
};

const failed = [
  ['latestNeverWayback', checks.latestNeverWayback],
  ['currentFallbackNotWayback', checks.nearmapOrEsriCurrent],
  ['historyHasWayback', checks.historyHasWayback],
  ['waybackReleaseSeparated', checks.waybackReleaseSeparated],
  ['captureUnknownHonest', checks.captureUnknownHonest],
  ['bestNotReleaseOnly', checks.bestNotReleaseOnly],
  ['receiptHasProvider', checks.receiptHasProvider],
  ['switchPreservedMap', checks.switchPreservedMap],
  ['mapViewCountIsOne', checks.mapViewCountIsOne],
  ['dropPinPresent', checks.dropPinPresent],
  ['noPortalWrite', checks.noPortalWrite]
].filter(([, ok]) => !ok).map(([name]) => name);

const result = browserError || !live
  ? 'FAIL'
  : (failed.length ? 'PARTIAL' : 'PASS');

const report = {
  result,
  browserError,
  failed,
  checks,
  latestProvider,
  latestA: live?.latestA || null,
  latestB: live?.latestB || null,
  historyList: live?.historyList || null,
  historyActive: live?.historyActive || null,
  bestForDate: live?.bestForDate || null,
  afterSwitch: live?.afterSwitch || null,
  street: live?.street || null,
  visual: live?.visual || null,
  mapViewCreateCount: mapViewCount,
  portalWrite,
  shots: {
    latestA: live?.latestAShot || null,
    history: live?.historyShot || null,
    bestForDate: live?.bestShot || null,
    latestAfterHistory: live?.latestAfterHistoryShot || null,
    latestB: live?.latestBShot || null
  },
  consoles: live?.consoles || []
};

fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify({
  result,
  failed,
  latestProvider,
  mapViewCreateCount: mapViewCount,
  portalWrite,
  out: OUT
}, null, 2));
if (result !== 'PASS') process.exitCode = result === 'PARTIAL' ? 2 : 1;
