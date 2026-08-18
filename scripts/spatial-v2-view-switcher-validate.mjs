import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import zlib from 'node:zlib';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';
import {
  MONTREAL_OPERATIONAL_CENTER,
  isGreaterMontrealLongitudeLatitude
} from '../public/spatial/montreal-operational-config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const SHELL_INTEGRATION = process.argv.includes('--shell');
const OUT = path.join(ROOT, 'artifacts', 'spatial-v2-view-switcher-v1');
const VIEWPORT = { width: 1920, height: 1080 };
const BASE = 'http://localhost:3000';
const LON = MONTREAL_OPERATIONAL_CENTER.longitude;
const LAT = MONTREAL_OPERATIONAL_CENTER.latitude;
const UNAVAILABLE_POINT = { longitude: -74.28, latitude: 45.22 };
const CDP_PORT = 9376;

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

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

function pngRgba(buffer) {
  if (!buffer || buffer[0] !== 0x89) throw new Error('not a PNG');
  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  const idats = [];
  while (offset + 12 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    offset += 12 + length;
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
    } else if (type === 'IDAT') {
      idats.push(data);
    } else if (type === 'IEND') break;
  }
  if (bitDepth !== 8) throw new Error(`unsupported PNG bitDepth ${bitDepth}`);
  const bpp = colorType === 6 ? 4 : colorType === 2 ? 3 : colorType === 0 ? 1 : 0;
  if (!bpp) throw new Error(`unsupported PNG colorType ${colorType}`);
  const raw = zlib.inflateSync(Buffer.concat(idats));
  const stride = width * bpp;
  const out = Buffer.alloc(width * height * 4);
  let src = 0;
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < height; y += 1) {
    const filter = raw[src];
    src += 1;
    const row = Buffer.from(raw.subarray(src, src + stride));
    src += stride;
    for (let i = 0; i < stride; i += 1) {
      const left = i >= bpp ? row[i - bpp] : 0;
      const up = prev[i];
      const upLeft = i >= bpp ? prev[i - bpp] : 0;
      let value = row[i];
      if (filter === 1) value = (value + left) & 255;
      else if (filter === 2) value = (value + up) & 255;
      else if (filter === 3) value = (value + Math.floor((left + up) / 2)) & 255;
      else if (filter === 4) value = (value + paeth(left, up, upLeft)) & 255;
      else if (filter !== 0) throw new Error(`unsupported PNG filter ${filter}`);
      row[i] = value;
    }
    prev = row;
    for (let x = 0; x < width; x += 1) {
      const o = (y * width + x) * 4;
      if (colorType === 6) {
        out[o] = row[x * 4];
        out[o + 1] = row[x * 4 + 1];
        out[o + 2] = row[x * 4 + 2];
        out[o + 3] = row[x * 4 + 3];
      } else if (colorType === 2) {
        out[o] = row[x * 3];
        out[o + 1] = row[x * 3 + 1];
        out[o + 2] = row[x * 3 + 2];
        out[o + 3] = 255;
      } else {
        out[o] = out[o + 1] = out[o + 2] = row[x];
        out[o + 3] = 255;
      }
    }
  }
  return { width, height, data: out };
}

function pngStats(filePath) {
  const png = pngRgba(fs.readFileSync(filePath));
  const { width, height, data } = png;
  const x0 = Math.floor(width * 0.2);
  const x1 = Math.floor(width * 0.8);
  const y0 = Math.floor(height * 0.2);
  const y1 = Math.floor(height * 0.85);
  let count = 0;
  let min = 255;
  let max = 0;
  let r = 0;
  let g = 0;
  let b = 0;
  for (let y = y0; y < y1; y += 2) {
    for (let x = x0; x < x1; x += 2) {
      const i = (y * width + x) * 4;
      const lum = (data[i] + data[i + 1] + data[i + 2]) / 3;
      r += data[i];
      g += data[i + 1];
      b += data[i + 2];
      min = Math.min(min, lum);
      max = Math.max(max, lum);
      count += 1;
    }
  }
  return {
    width,
    height,
    mean: [Math.round(r / count), Math.round(g / count), Math.round(b / count)],
    lumMin: Math.round(min),
    lumMax: Math.round(max),
    contrast: Math.round(max - min),
    sampleCount: count
  };
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
      result.consoles = consoles.slice(0, 40);
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
    throw new Error(response.exceptionDetails.text || 'Runtime evaluation failed');
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

async function clickMapCenter(send) {
  const mapRect = await evaluateJson(send, `(() => {
    const rect = document.querySelector('[data-iqai-map-host]')?.getBoundingClientRect();
    return rect ? { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 } : null;
  })()`);
  if (!mapRect) throw new Error('Spatial V2 map surface has no clickable bounds.');
  await send('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x: mapRect.x,
    y: mapRect.y,
    button: 'left',
    clickCount: 1
  });
  await send('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x: mapRect.x,
    y: mapRect.y,
    button: 'left',
    clickCount: 1
  });
  return mapRect;
}

const UI_SNAPSHOT = `(() => {
  const visible = (el) => Boolean(el && !el.hidden && el.getBoundingClientRect().width > 0);
  const rectOf = (el) => {
    if (!visible(el)) return null;
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) };
  };
  const overlaps = (a, b) => Boolean(
    a && b
    && a.x < b.x + b.width
    && a.x + a.width > b.x
    && a.y < b.y + b.height
    && a.y + a.height > b.y
  );
  const view = document.querySelector('[data-iqai-view-switcher]');
  const notice = document.querySelector('[data-iqai-view-notice]');
  const ask = document.querySelector('[data-iqai-slot="ask-iqai-dock"]');
  const controls3d = document.querySelector('[data-iqai-google-3d-controls]');
  const buttons = [...document.querySelectorAll('button')].map((el) => ({
    text: el.textContent.replace(/\\s+/g, ' ').trim(),
    pressed: el.getAttribute('aria-pressed'),
    disabled: el.disabled,
    visible: visible(el)
  }));
  const viewRect = rectOf(view);
  const askRect = rectOf(ask);
  const controls3dRect = rectOf(controls3d);
  return {
    activeView: window.__iqaiSpatialV2?.viewSwitcher?.snapshot?.().activeView || null,
    pendingView: window.__iqaiSpatialV2?.viewSwitcher?.snapshot?.().pendingView || null,
    notice: notice?.hidden ? null : notice?.textContent?.trim() || null,
    noticeKind: notice?.hidden ? null : notice?.dataset?.iqaiViewNoticeKind || null,
    viewVisible: visible(view),
    viewLabels: [...(view?.querySelectorAll('[data-iqai-view]') || [])].map((el) => el.textContent.trim()),
    streetPressed: document.querySelector('[data-iqai-view="street-360"]')?.getAttribute('aria-pressed') === 'true',
    visualPressed: document.querySelector('[data-iqai-view="3d-visual"]')?.getAttribute('aria-pressed') === 'true',
    mapPressed: document.querySelector('[data-iqai-view="map"]')?.getAttribute('aria-pressed') === 'true',
    analyzeDisabled: document.querySelector('[data-iqai-view="3d-analyze"]')?.disabled === true,
    pointPreservedButton: buttons.some((btn) => btn.visible && btn.text === 'POINT PRESERVED'),
    open3dButton: buttons.some((btn) => btn.visible && btn.text === 'OPEN 3D'),
    streetOpenButton: buttons.some((btn) => btn.visible && btn.text === 'STREET 360' && btn.pressed !== 'true' && btn.pressed !== 'false'),
    leakedDebug: /panoId|StreetViewService|API terms|AIza[0-9A-Za-z_-]{20,}/i.test(document.body.innerText || ''),
    askOverlap: overlaps(viewRect, askRect) || overlaps(controls3dRect, askRect),
    viewRect,
    askRect,
    controls3dRect,
    askVisible: visible(ask),
    nativeStreet: Boolean(document.querySelector('.gm-iv-address, .gm-style, .gmnoprint')),
    native3d: Boolean(document.querySelector('gmp-map-3d')),
    navVisible: visible(document.querySelector('[data-iqai-google-3d-nav]')),
    layersVisible: visible(document.querySelector('[data-iqai-google-3d-layers]'))
  };
})()`;

if (!SHELL_INTEGRATION) {
  console.error('VIEW switcher live proof runs against the real Spatial V2 shell. Pass --shell.');
  process.exitCode = 1;
}

fs.mkdirSync(OUT, { recursive: true });

const liveOn3000 = await isPortOpen(3000, '127.0.0.1') || await isPortOpen(3000, 'localhost');
const config = liveOn3000
  ? await fetchJson(`${BASE}/api/spatial/config`).catch((error) => ({
    status: 0,
    body: { error: String(error?.message || error) }
  }))
  : { status: 0, body: {} };
const browserKeyConfigured = Boolean(config.body?.streetLevelContext?.googleMapsBrowserApiKey);
const tilesKey = String(process.env.GOOGLE_MAP_TILES_API_KEY || '').trim();
const browserPath = findBrowser();
const preauth = await fetchPreauthToken();
let browserError = null;
let live = null;

try {
  if (!SHELL_INTEGRATION) throw new Error('Pass --shell to run the Spatial V2 VIEW switcher proof.');
  if (!liveOn3000) throw new Error('localhost:3000 is not serving IQAI Spatial.');
  if (!browserKeyConfigured) {
    throw new Error('GOOGLE_MAPS_BROWSER_API_KEY is not present on /api/spatial/config.');
  }
  if (!browserPath) throw new Error('No supported Edge or Chrome browser found.');

  live = await withCdpPage(browserPath, CDP_PORT, async (send) => {
    const log = (message) => console.error(`[view-switcher] ${message}`);
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
    const street = 'window.__iqaiSpatialV2?.street360';
    const google3d = 'window.__iqaiSpatialV2?.google3d';
    const view = 'window.__iqaiSpatialV2?.viewSwitcher';
    await send('Page.navigate', { url: `${BASE}/spatial-v2/` });
    const booted = await waitFor(
      send,
      `Boolean(${street}?.snapshot) && Boolean(${google3d}?.snapshot) && Boolean(${view}?.snapshot)`,
      120,
      250
    );
    if (!booted) throw new Error('Spatial V2 VIEW switcher did not boot.');
    const operatorReady = await waitFor(
      send,
      `window.__iqaiSpatialV2.mapFoundation.getSnapshot().state === 'READY'
        && Boolean(document.querySelector('[data-iqai-view-switcher]'))`,
      160,
      500
    );
    if (!operatorReady) throw new Error('Spatial V2 map stage did not expose VIEW.');

    const uiBoot = await evaluateJson(send, UI_SNAPSHOT);
    const twoDShot = await capture(send, '01-map-before-point.png');

    await evaluate(send, `document.querySelector('[data-iqai-view="street-360"]')?.click()`);
    const noPointReady = await waitFor(
      send,
      `${view}.snapshot().pendingView === 'street-360'
        && document.querySelector('[data-iqai-view-notice]')?.textContent?.includes('SELECT A POINT FOR STREET 360')`,
      40,
      250
    );
    if (!noPointReady) throw new Error('STREET 360 without a point did not show SELECT A POINT FOR STREET 360.');
    const noPointUi = await evaluateJson(send, UI_SNAPSHOT);
    const noPointShot = await capture(send, '02-select-a-point-for-street-360.png');

    await clickMapCenter(send);
    let sawLoading = false;
    for (let i = 0; i < 40; i += 1) {
      const notice = await evaluate(send, `document.querySelector('[data-iqai-view-notice]')?.textContent || ''`);
      if (String(notice).includes('LOADING STREET 360')) sawLoading = true;
      const opened = await evaluate(send, `${street}.snapshot().open === true && ${street}.snapshot().stageState === 'OPEN'`).catch(() => false);
      if (opened) break;
      await sleep(250);
    }
    const noPointOpened = await waitFor(
      send,
      `${street}.snapshot().stageState === 'OPEN' && ${street}.snapshot().open === true`,
      120,
      500
    );
    if (!noPointOpened) {
      const snap = await evaluateJson(send, `${street}.snapshot()`);
      throw new Error(`No-point map click did not open STREET 360 (${snap?.stageState || 'unknown'}).`);
    }
    await sleep(2000);
    const afterNoPoint = await evaluateJson(send, `${street}.snapshot()`);
    const afterNoPointView = await evaluateJson(send, `${view}.snapshot()`);
    const afterNoPointUi = await evaluateJson(send, UI_SNAPSHOT);
    const streetFromClickShot = await capture(send, '03-street-360-from-map-click.png');

    const headingBefore = Number(afterNoPoint?.pov?.heading);
    const afterLook = await evaluateJson(send, `${street}.look(90)`, true);
    await sleep(600);
    const afterZoom = await evaluateJson(send, `${street}.zoom(1)`, true);
    const afterMove = await evaluateJson(send, `${street}.moveAlongCoverage()`, true);

    await evaluate(send, `document.querySelector('[data-iqai-view="3d-visual"]')?.click()`);
    let sawLoading3d = false;
    for (let i = 0; i < 40; i += 1) {
      const notice = await evaluate(send, `document.querySelector('[data-iqai-view-notice]')?.textContent || ''`);
      if (String(notice).includes('LOADING 3D VISUAL')) sawLoading3d = true;
      const opened = await evaluate(send, `${google3d}.snapshot().open === true && ${google3d}.snapshot().stageState === 'OPEN'`).catch(() => false);
      if (opened) break;
      await sleep(250);
    }
    const threeDOpened = await waitFor(
      send,
      `${google3d}.snapshot().stageState === 'OPEN' && ${google3d}.snapshot().open === true`,
      180,
      500
    );
    if (!threeDOpened) {
      const snap = await evaluateJson(send, `${google3d}.snapshot()`);
      throw new Error(`3D VISUAL did not open from STREET 360 (${snap?.stageState || 'unknown'}).`);
    }
    await sleep(2500);
    const after3d = await evaluateJson(send, `${google3d}.snapshot()`);
    const after3dUi = await evaluateJson(send, UI_SNAPSHOT);
    const threeDShot = await capture(send, '04-3d-visual-from-street-360.png');
    await evaluateJson(send, `${google3d}.setReference(true)`, true).catch(() => null);
    await sleep(600);
    const referenceOn = await evaluateJson(send, `${google3d}.snapshot()`);

    await evaluate(send, `document.querySelector('[data-iqai-view="street-360"]')?.click()`);
    const streetFrom3d = await waitFor(
      send,
      `${street}.snapshot().stageState === 'OPEN' && ${street}.snapshot().open === true
        && ${google3d}.snapshot().open === false`,
      180,
      500
    );
    if (!streetFrom3d) throw new Error('STREET 360 did not open from 3D VISUAL.');
    await sleep(1500);
    const afterStreetFrom3d = await evaluateJson(send, `${street}.snapshot()`);
    const afterStreetFrom3dUi = await evaluateJson(send, UI_SNAPSHOT);
    const streetFrom3dShot = await capture(send, '05-street-360-from-3d-visual.png');

    await evaluate(send, `document.querySelector('[data-iqai-view="map"]')?.click()`);
    const returnedMap = await waitFor(
      send,
      `${street}.snapshot().open === false && ${google3d}.snapshot().open === false
        && ${view}.snapshot().activeView === 'map'`,
      80,
      250
    );
    if (!returnedMap) throw new Error('MAP did not restore the ArcGIS MapView.');
    const afterMap = await evaluateJson(send, `${street}.snapshot()`);
    const mapUi = await evaluateJson(send, UI_SNAPSHOT);
    const mapShot = await capture(send, '06-map-restored.png');

    await evaluate(send, `document.querySelector('[data-iqai-view="street-360"]')?.click()`);
    const mapToStreet = await waitFor(
      send,
      `${street}.snapshot().stageState === 'OPEN' && ${street}.snapshot().open === true`,
      120,
      500
    );
    if (!mapToStreet) throw new Error('MAP → STREET 360 did not open in one click.');
    const mapToStreetSnap = await evaluateJson(send, `${street}.snapshot()`);
    await evaluate(send, `document.querySelector('[data-iqai-view="map"]')?.click()`);
    await waitFor(send, `${view}.snapshot().activeView === 'map'`, 80, 250);

    const unavailable = await evaluateJson(send, `(async () => {
      ${street}.selectPoint(${UNAVAILABLE_POINT.longitude}, ${UNAVAILABLE_POINT.latitude}, 'operator');
      return ${view}.setView('street-360');
    })()`, true);
    await sleep(800);
    const unavailableUi = await evaluateJson(send, UI_SNAPSHOT);
    const unavailableStreet = await evaluateJson(send, `${street}.snapshot()`);
    const unavailableShot = await capture(send, '07-street-360-unavailable.png');

    const groundAfter = await evaluateJson(send, `({
      ground: window.__iqaiSpatialV2.ground(),
      time: window.__iqaiSpatialV2.time(),
      map: window.__iqaiSpatialV2.mapFoundation.getSnapshot(),
      mapViewCreateCount: ${street}.snapshot().mapViewCreateCount
    })`);

    return {
      uiBoot,
      noPointUi,
      afterNoPoint,
      afterNoPointView,
      afterNoPointUi,
      sawLoading,
      sawLoading3d,
      headingBefore,
      afterLook,
      afterZoom,
      afterMove,
      after3d,
      after3dUi,
      referenceOn,
      afterStreetFrom3d,
      afterStreetFrom3dUi,
      afterMap,
      mapUi,
      mapToStreetSnap,
      unavailable,
      unavailableUi,
      unavailableStreet,
      groundAfter,
      screenshots: [
        twoDShot,
        noPointShot,
        streetFromClickShot,
        threeDShot,
        streetFrom3dShot,
        mapShot,
        unavailableShot
      ]
    };
  });
} catch (error) {
  browserError = String(error?.message || error);
}

const networkUrls = live?.networkUrls || [];
const tilesKeyLeaked = Boolean(tilesKey) && networkUrls.some((url) => url.includes(tilesKey));
const portalWrite = networkUrls.some((url) => /\/sharing\/rest\/content\/users\/.*\/(addItem|update)/i.test(url));
const selected = live?.afterNoPoint?.selectedPoint || live?.mapToStreetSnap?.selectedPoint || { longitude: LON, latitude: LAT };
const selectedAfter3d = live?.after3d?.selectedPoint || null;
const selectedAfterStreetFrom3d = live?.afterStreetFrom3d?.selectedPoint || null;
const samePoint = (a, b) => Boolean(
  a && b
  && Math.abs(Number(a.longitude) - Number(b.longitude)) < 1e-7
  && Math.abs(Number(a.latitude) - Number(b.latitude)) < 1e-7
);
const lookAround = Number.isFinite(Number(live?.headingBefore))
  && Number.isFinite(Number(live?.afterLook?.pov?.heading))
  && Math.abs((((Number(live.afterLook.pov.heading) - Number(live.headingBefore)) % 360) + 360) % 360 - 90) <= 20;
const zoomWorked = Number.isFinite(Number(live?.afterNoPoint?.zoom))
  && Number.isFinite(Number(live?.afterZoom?.zoom))
  && Number(live.afterZoom.zoom) > Number(live.afterNoPoint.zoom);
const movedAlongCoverage = live?.afterMove?.moved === true
  || (
    live?.afterNoPoint?.panoramaPosition
    && live?.afterMove?.panoramaPosition
    && (
      Math.abs(Number(live.afterNoPoint.panoramaPosition.latitude) - Number(live.afterMove.panoramaPosition.latitude)) > 0.00005
      || Math.abs(Number(live.afterNoPoint.panoramaPosition.longitude) - Number(live.afterMove.panoramaPosition.longitude)) > 0.00005
    )
  );
const captureDate = live?.afterNoPoint?.capture || {};
const captureHonest = captureDate.precision === 'UNKNOWN'
  || (captureDate.precision === 'MONTH' && !/-\d{2}-\d{2}$/.test(String(captureDate.text || '')))
  || captureDate.precision === 'YEAR'
  || captureDate.precision === 'DAY'
  || captureDate.precision === 'AS_PROVIDED';
const screenshotNamed = (fragment) => (live?.screenshots || []).find((file) => String(file).includes(fragment));
const pixels = screenshotNamed('03-street-360-from-map-click')
  ? pngStats(screenshotNamed('03-street-360-from-map-click'))
  : { error: 'no STREET 360 screenshot' };

const checks = {
  mapsJsConfigKey: browserKeyConfigured === true,
  viewSwitcherPresent: live?.uiBoot?.viewVisible === true
    && Array.isArray(live?.uiBoot?.viewLabels)
    && live.uiBoot.viewLabels.includes('MAP')
    && live.uiBoot.viewLabels.includes('STREET 360')
    && live.uiBoot.viewLabels.includes('3D VISUAL')
    && live.uiBoot.viewLabels.includes('3D ANALYZE')
    && live?.uiBoot?.analyzeDisabled === true,
  noPointFlow: live?.noPointUi?.notice === 'SELECT A POINT FOR STREET 360'
    && live?.afterNoPoint?.open === true
    && live?.afterNoPointView?.activeView === 'street-360',
  mapToStreet360: live?.mapToStreetSnap?.open === true && live?.mapToStreetSnap?.renderer === 'StreetViewPanorama',
  streetTo3d: live?.after3d?.open === true && samePoint(selected, selectedAfter3d),
  threeDToStreet: live?.afterStreetFrom3d?.open === true && samePoint(selected, selectedAfterStreetFrom3d),
  mapRestored: live?.afterMap?.open === false && live?.afterMap?.mapHostHidden === false
    && live?.mapUi?.activeView === 'map',
  loadingOrOpened: live?.sawLoading === true || live?.afterNoPoint?.open === true,
  unavailableBehavior: live?.unavailableUi?.notice === 'STREET 360 NOT AVAILABLE HERE'
    && live?.unavailableUi?.activeView === 'map'
    && live?.unavailableStreet?.mapHostHidden === false
    && live?.unavailableStreet?.open === false,
  noPointPreservedButton: live?.uiBoot?.pointPreservedButton !== true
    && live?.afterNoPointUi?.pointPreservedButton !== true
    && live?.mapUi?.pointPreservedButton !== true,
  noDuplicateOpen3d: live?.uiBoot?.open3dButton !== true && live?.mapUi?.open3dButton !== true,
  askOverlap: live?.mapUi?.askOverlap !== true && live?.uiBoot?.askOverlap !== true,
  mapViewCountOne: live?.afterNoPoint?.mapViewCreateCount === 1
    && live?.after3d?.mapViewCreateCount === 1
    && live?.afterMap?.mapViewCreateCount === 1,
  lookAround,
  zoomWorked,
  movedAlongCoverage,
  captureDateHonest: captureHonest === true,
  google3dNavReference: live?.after3dUi?.navVisible === true
    && live?.after3dUi?.layersVisible === true
    && live?.referenceOn?.referenceEnabled === true,
  specialistViewStays: live?.afterNoPointUi?.viewVisible === true
    && live?.afterNoPointUi?.streetPressed === true
    && live?.after3dUi?.viewVisible === true
    && live?.after3dUi?.visualPressed === true,
  noDebugLeak: live?.afterNoPointUi?.leakedDebug === false,
  pixelsHaveContrast: Number(pixels?.contrast || 0) >= 24 && Number(pixels?.lumMax || 0) >= 40,
  montrealSelected: isGreaterMontrealLongitudeLatitude(selected?.longitude, selected?.latitude),
  noServerTilesKey: tilesKeyLeaked === false,
  noPortalWrite: portalWrite === false,
  nearmapWaybackRemain: Boolean(live?.groundAfter?.ground)
    && Boolean(live?.groundAfter?.time)
    && live?.groundAfter?.map?.state === 'READY'
};

const report = {
  generatedAt: new Date().toISOString(),
  spikeId: 'ARCGIS-MONTREAL-V2-STREET-360-DIRECT-VIEW-SWITCH-V1',
  target: 'spatial-v2-product-shell',
  viewport: VIEWPORT,
  base: BASE,
  liveOn3000,
  browserKeyConfigured,
  browserPath,
  preauthInjected: Boolean(preauth),
  browserError,
  selectedPoint: selected,
  capture: captureDate,
  afterNoPoint: live?.afterNoPoint || null,
  after3d: live?.after3d || null,
  afterStreetFrom3d: live?.afterStreetFrom3d || null,
  afterMap: live?.afterMap || null,
  unavailable: live?.unavailable || null,
  unavailableUi: live?.unavailableUi || null,
  mapUi: live?.mapUi || null,
  sawLoading: live?.sawLoading || false,
  sawLoading3d: live?.sawLoading3d || false,
  pixels,
  screenshots: (live?.screenshots || []).map((file) => path.basename(file)),
  consoles: live?.consoles || [],
  checks,
  pass: Object.values(checks).every(Boolean) && !browserError
};

fs.writeFileSync(path.join(OUT, 'qa-report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify({
  pass: report.pass,
  browserError,
  checks,
  screenshots: report.screenshots,
  capture: captureDate,
  mapViewCreateCount: live?.afterMap?.mapViewCreateCount ?? null
}, null, 2));
if (!report.pass) process.exitCode = 1;

