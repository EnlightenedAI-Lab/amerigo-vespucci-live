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
const OUT = path.join(ROOT, 'artifacts', 'spatial-v2-imagery-operator-flow-v1');
const VIEWPORT = { width: 1920, height: 1080 };
const BASE = 'http://localhost:3000';
const CDP_PORT = 9381;
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

async function clickMapAt(send, fx, fy) {
  const mapRect = await evaluateJson(send, `(() => {
    const rect = document.querySelector('[data-iqai-map-host]')?.getBoundingClientRect();
    return rect ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : null;
  })()`);
  if (!mapRect) throw new Error('Spatial V2 map surface has no clickable bounds.');
  const x = mapRect.x + mapRect.width * fx;
  const y = mapRect.y + mapRect.height * fy;
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
  await send('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x,
    y,
    button: 'left',
    clickCount: 1
  });
  await send('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x,
    y,
    button: 'left',
    clickCount: 1
  });
  return { x, y };
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
    selectedLabel: document.querySelector('.iqai-v2-operator-imagery__facts dd')?.textContent || null,
    selectedFact: [...document.querySelectorAll('.iqai-v2-operator-imagery__facts div')].map((row) => ({
      dt: row.querySelector('dt')?.textContent?.trim() || null,
      dd: row.querySelector('dd')?.textContent?.trim() || null
    })),
    prompt: document.querySelector('[data-iqai-operator-imagery-prompt]')?.textContent?.trim() || null,
    groundLabel: document.querySelector('[data-iqai-operator-ground]')?.innerText?.trim() || null,
    dropPin: Boolean(document.querySelector('[data-iqai-drop-pin]')),
    latestControl: Boolean([...document.querySelectorAll('[data-iqai-imagery-view]')].some((el) => el.textContent.trim() === 'LATEST')),
    historyControl: Boolean([...document.querySelectorAll('[data-iqai-imagery-view]')].some((el) => el.textContent.trim() === 'HISTORY')),
    allControl: Boolean([...document.querySelectorAll('[data-iqai-imagery-view]')].some((el) => el.textContent.trim() === 'ALL IMAGERY')),
    bestImageLabel: document.querySelector('[data-iqai-operator-imagery-action="discover"]')?.textContent?.trim() || null
  };
})()`;

if (!SHELL_INTEGRATION) {
  console.error('Imagery operator-flow live proof runs against the real Spatial V2 shell. Pass --shell.');
  process.exitCode = 1;
}

fs.mkdirSync(OUT, { recursive: true });

const liveOn3000 = await isPortOpen(3000, '127.0.0.1') || await isPortOpen(3000, 'localhost');
const browserPath = findBrowser();
const preauth = await fetchPreauthToken();
let live = null;
let browserError = null;

try {
  if (!SHELL_INTEGRATION) throw new Error('Pass --shell to run the Spatial V2 imagery operator-flow proof.');
  if (!liveOn3000) throw new Error('localhost:3000 is not serving IQAI Spatial.');
  if (!browserPath) throw new Error('No supported Edge or Chrome browser found.');

  live = await withCdpPage(browserPath, CDP_PORT, async (send) => {
    const log = (message) => console.error(`[imagery-operator-flow] ${message}`);
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
      `Boolean(window.__iqaiSpatialV2?.dropPin?.snapshot) && Boolean(document.querySelector('[data-iqai-drop-pin]'))`,
      120,
      250
    );
    if (!booted) throw new Error('Spatial V2 DROP PIN control did not boot.');
    const operatorReady = await waitFor(
      send,
      `window.__iqaiSpatialV2.mapFoundation.getSnapshot().state === 'READY'`,
      160,
      500
    );
    if (!operatorReady) throw new Error('Spatial V2 map stage did not become READY.');

    const before = await evaluateJson(send, IMAGERY_SNAPSHOT);
    const beforeShot = await capture(send, '01-before-operator-flow.png');

    log('DROP PIN click then map click');
    await evaluate(send, `document.querySelector('[data-iqai-drop-pin]')?.click()`);
    const armed = await waitFor(
      send,
      `document.querySelector('.iqai-v2-stage__well')?.classList.contains('is-drop-pin') === true`,
      20,
      200
    );
    if (!armed) throw new Error('DROP PIN did not enter placement mode.');
    await clickMapAt(send, 0.48, 0.52);
    const pinReady = await waitFor(
      send,
      `window.__iqaiSpatialV2.spatialFocus()?.sourceType === 'DROP_PIN'`,
      40,
      250
    );
    if (!pinReady) throw new Error('DROP PIN click did not create ACTIVE SPATIAL FOCUS.');
    await sleep(600);
    const afterPin = await evaluateJson(send, IMAGERY_SNAPSHOT);
    const pinShot = await capture(send, '02-drop-pin.png');

    log('open IMAGERY then click LATEST');
    await evaluate(send, `document.querySelector('[data-iqai-plugin="imagery"]')?.click()`);
    const imageryOpen = await waitFor(
      send,
      `Boolean(document.querySelector('[data-iqai-imagery-view="LATEST"]'))`,
      40,
      250
    );
    if (!imageryOpen) throw new Error('IMAGERY did not expose the LATEST control.');
    await evaluate(send, `document.querySelector('[data-iqai-imagery-view="LATEST"]')?.click()`);
    const latestReady = await waitFor(
      send,
      `(() => {
        const receipt = document.querySelector('[data-iqai-imagery-receipt]');
        const hidden = receipt?.hasAttribute('hidden');
        const provider = document.querySelector('[data-iqai-imagery-receipt-provider]')?.textContent || '';
        const capture = document.querySelector('[data-iqai-imagery-receipt-capture]')?.textContent || '';
        const ground = window.__iqaiSpatialV2.ground();
        return hidden !== true
          && ground.currentMode === 'NEARMAP'
          && provider.indexOf('NEARMAP') >= 0
          && provider.indexOf('CURRENT') >= 0
          && capture.indexOf('CAPTURE DATE UNKNOWN') >= 0;
      })()`,
      120,
      500
    );
    if (!latestReady) {
      const failedLatest = await evaluateJson(send, IMAGERY_SNAPSHOT);
      throw new Error(`LATEST click did not show Nearmap current receipt: ${JSON.stringify({
        groundMode: failedLatest.groundMode,
        receiptText: failedLatest.receiptText,
        pool: failedLatest.pool,
        limitation: failedLatest.latestApplied
      })}`);
    }
    await sleep(800);
    const latestClick = await evaluateJson(send, IMAGERY_SNAPSHOT);
    const latestShot = await capture(send, '03-latest-click.png');

    log('SHOW BEST IMAGE with no requested date');
    await evaluate(send, `document.querySelector('[data-iqai-operator-imagery-action="discover"]')?.click()`);
    await waitFor(
      send,
      `(() => {
        const provider = document.querySelector('[data-iqai-imagery-receipt-provider]')?.textContent || '';
        return window.__iqaiSpatialV2.ground().currentMode === 'NEARMAP'
          && provider.indexOf('NEARMAP') >= 0
          && provider.indexOf('CURRENT') >= 0;
      })()`,
      80,
      400
    );
    await sleep(400);
    const bestImage = await evaluateJson(send, IMAGERY_SNAPSHOT);
    const bestShot = await capture(send, '04-show-best-image.png');

    log('HISTORY click must not auto-activate Wayback');
    await evaluate(send, `document.querySelector('[data-iqai-imagery-view="HISTORY"]')?.click()`);
    const historyListed = await waitFor(
      send,
      `Boolean(document.querySelector('[data-iqai-observation-provider="esri-wayback"]'))
        && window.__iqaiSpatialV2.time().pool === 'HISTORY'`,
      80,
      500
    );
    if (!historyListed) throw new Error('HISTORY click did not list Wayback observations.');
    await sleep(400);
    const historyList = await evaluateJson(send, IMAGERY_SNAPSHOT);
    const historyListShot = await capture(send, '05-history-list.png');

    log('operator asks for a Wayback observation');
    await evaluate(send, `document.querySelector('[data-iqai-observation-provider="esri-wayback"]')?.click()`);
    const waybackReady = await waitFor(
      send,
      `(() => {
        const provider = document.querySelector('[data-iqai-imagery-receipt-provider]')?.textContent || '';
        const capture = document.querySelector('[data-iqai-imagery-receipt-capture]')?.textContent || '';
        const release = document.querySelector('[data-iqai-imagery-receipt-release]')?.textContent || '';
        return provider.indexOf('ESRI WAYBACK') >= 0
          && window.__iqaiSpatialV2.ground().currentMode !== 'NEARMAP'
          && (capture.indexOf('CAPTURED') >= 0 || capture.indexOf('CAPTURE DATE UNKNOWN') >= 0)
          && release.indexOf('RELEASED') >= 0;
      })()`,
      80,
      500
    );
    if (!waybackReady) throw new Error('Choosing a HISTORY observation did not show capture and release on the map receipt.');
    await sleep(800);
    const historyActive = await evaluateJson(send, IMAGERY_SNAPSHOT);
    const historyShot = await capture(send, '06-history-wayback.png');

    const mapViewCreateCount = await evaluate(send, `window.__iqaiSpatialV2.mapFoundation.getMapViewCreateCount()`);
    return {
      before,
      beforeShot,
      afterPin,
      pinShot,
      latestClick,
      latestShot,
      bestImage,
      bestShot,
      historyList,
      historyListShot,
      historyActive,
      historyShot,
      mapViewCreateCount
    };
  });
} catch (error) {
  browserError = String(error?.message || error);
}

const networkUrls = live?.networkUrls || [];
const portalWrite = networkUrls.some((url) => isPortalWrite(url));
const latest = live?.latestClick || {};
const best = live?.bestImage || {};
const historyList = live?.historyList || {};
const historyActive = live?.historyActive || {};
const selectedSource = (latest.selectedFact || []).find((row) => row.dt === 'SOURCE')?.dd || null;
const selectedLabel = (latest.selectedFact || []).find((row) => row.dt === 'SELECTED')?.dd || null;
const activatedLabel = (latest.selectedFact || []).find((row) => row.dt === 'ACTIVATED')?.dd || null;

const nearmapVisible = latest.groundMode === 'NEARMAP'
  && String(latest.providerLine || latest.receiptText || '').includes('NEARMAP')
  && String(latest.providerLine || latest.receiptText || '').includes('CURRENT');
const mapReceiptVisible = latest.receiptHidden === false
  && String(latest.providerLine || '').includes('NEARMAP')
  && String(latest.captureLine || latest.receiptText || '').includes('CAPTURE DATE UNKNOWN');
const latestNotAuthored = latest.groundMode === 'NEARMAP'
  && !/AUTHORED/.test(selectedSource || '');
const bestSame = best.groundMode === latest.groundMode
  && String(best.providerLine || best.receiptText || '').includes('NEARMAP');
const historyDidNotAutoActivate = historyList.activeId == null
  && historyList.activatedProviderId == null
  && Number(historyList.waybackCount || 0) > 0;
const historyNoCredentialLeak = !/API_KEY|_SECRET|_TOKEN/.test(historyList.prompt || '')
  && !/API_KEY|_SECRET|_TOKEN/.test(JSON.stringify(historyList.selectedFact || []));
const historyClearedCurrentGround = historyActive.groundMode !== 'NEARMAP'
  && historyActive.groundMode !== 'GOOGLE_SATELLITE';
const historyWaybackReceipt = /ESRI WAYBACK/.test(historyActive.receiptText || '')
  && /RELEASED /.test(historyActive.receiptText || historyActive.releaseLine || '')
  && (/CAPTURED /.test(historyActive.receiptText || historyActive.captureLine || '')
    || /CAPTURE DATE UNKNOWN/.test(historyActive.receiptText || historyActive.captureLine || ''));

const checks = {
  dropPinCreatedFocus: live?.afterPin?.focus?.sourceType === 'DROP_PIN',
  nearmapVisible,
  mapReceiptVisible,
  latestNotAuthored,
  selectedIsNearmapCurrent: /NEARMAP/.test(selectedLabel || ''),
  activatedIsNearmapCurrent: /NEARMAP/.test(activatedLabel || ''),
  bestSame,
  historyDidNotAutoActivate,
  historyNoCredentialLeak,
  historyClearedCurrentGround,
  historyWaybackReceipt,
  mapViewCountIsOne: live?.mapViewCreateCount === 1,
  noPortalWrite: portalWrite === false
};

const failed = Object.entries(checks).filter(([, ok]) => !ok).map(([name]) => name);
const result = browserError || !live ? 'FAIL' : (failed.length ? 'PARTIAL' : 'PASS');

const report = {
  result,
  browserError,
  failed,
  checks,
  selectedSource,
  selectedLabel,
  activatedLabel,
  latestClick: latest,
  bestImage: best,
  historyList,
  historyActive,
  mapViewCreateCount: live?.mapViewCreateCount ?? null,
  portalWrite,
  shots: {
    before: live?.beforeShot || null,
    dropPin: live?.pinShot || null,
    latestClick: live?.latestShot || null,
    showBestImage: live?.bestShot || null,
    historyList: live?.historyListShot || null,
    historyWayback: live?.historyShot || null
  },
  consoles: live?.consoles || []
};

fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify({
  result,
  failed,
  nearmapVisible,
  mapReceiptVisible,
  mapViewCreateCount: live?.mapViewCreateCount ?? null,
  portalWrite,
  out: OUT
}, null, 2));
if (result !== 'PASS') process.exitCode = result === 'PARTIAL' ? 2 : 1;
