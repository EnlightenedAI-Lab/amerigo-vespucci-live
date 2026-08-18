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
const OUT = path.join(ROOT, 'artifacts', 'spatial-v2-street-360-v1');
const VIEWPORT = { width: 1920, height: 1080 };
const BASE = 'http://localhost:3000';
const LON = MONTREAL_OPERATIONAL_CENTER.longitude;
const LAT = MONTREAL_OPERATIONAL_CENTER.latitude;
const UNAVAILABLE_POINT = { longitude: -74.28, latitude: 45.22 };

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

if (!SHELL_INTEGRATION) {
  console.error('Street 360 live proof runs against the real Spatial V2 shell. Pass --shell.');
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
  if (!SHELL_INTEGRATION) throw new Error('Pass --shell to run the Montréal V2 STREET 360 proof.');
  if (!liveOn3000) throw new Error('localhost:3000 is not serving IQAI Spatial.');
  if (!browserKeyConfigured) {
    throw new Error('GOOGLE_MAPS_BROWSER_API_KEY is not present on /api/spatial/config.');
  }
  if (!browserPath) throw new Error('No supported Edge or Chrome browser found.');

  live = await withCdpPage(browserPath, 9374, async (send) => {
    const log = (message) => console.error(`[street-360] ${message}`);
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
    await send('Page.navigate', { url: `${BASE}/spatial-v2/` });
    const booted = await waitFor(send, `Boolean(${street}?.snapshot) && Boolean(${google3d}?.snapshot)`, 120, 250);
    if (!booted) throw new Error('Spatial V2 STREET 360 operator control did not boot.');
    await waitFor(send, `${street}.snapshot().mapViewExists === true`, 120, 500);

    const operatorReady = await waitFor(
      send,
      `window.__iqaiSpatialV2.mapFoundation.getSnapshot().state === 'READY'
        && Boolean(document.querySelector('[data-iqai-view="street-360"]'))
        && Boolean(window.__iqaiSpatialV2.viewSwitcher?.snapshot)`,
      160,
      500
    );
    if (!operatorReady) throw new Error('Spatial V2 map stage did not expose STREET 360.');

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
    const selectedFromMap = await waitFor(
      send,
      `${street}.snapshot().selectedPoint?.source === 'map-click'
        || ${google3d}.snapshot().selectedPoint?.source === 'map-click'`,
      40,
      250
    );
    if (!selectedFromMap) throw new Error('Map click did not establish the selected point.');
    await evaluate(send, `(() => {
      const point = ${google3d}.snapshot().selectedPoint || ${street}.snapshot().selectedPoint;
      if (point) ${street}.selectPoint(point.longitude, point.latitude, point.source);
      return true;
    })()`);
    const streetReady = await waitFor(
      send,
      `document.querySelector('[data-iqai-view="street-360"]')?.disabled === false`,
      40,
      250
    );
    if (!streetReady) throw new Error('STREET 360 action did not become available after point selection.');
    const selectedSet = await evaluateJson(send, `${street}.snapshot().selectedPoint`);
    const before = await evaluateJson(send, `${street}.snapshot()`);
    const uiBefore = await evaluateJson(send, `(() => {
      const visible = (el) => Boolean(el && !el.hidden && el.getBoundingClientRect().width > 0);
      const open = document.querySelector('[data-iqai-view="street-360"]');
      return {
        openVisible: visible(open),
        openEnabled: Boolean(open && !open.disabled),
        openLabel: open?.textContent?.trim() || null
      };
    })()`);
    const twoDShot = await capture(send, '01-montreal-2d-before-street-360.png');
    log(`2D mapViewCreateCount=${before?.mapViewCreateCount}`);

    await evaluate(send, `document.querySelector('[data-iqai-view="street-360"]')?.click()`);
    const openedFromUi = await waitFor(
      send,
      `${street}.snapshot().stageState === 'OPEN' && ${street}.snapshot().open === true`,
      180,
      500
    );
    if (!openedFromUi) {
      const snap = await evaluateJson(send, `${street}.snapshot()`);
      throw new Error(`STREET 360 did not open (${snap?.stageState || 'unknown'}: ${snap?.operatorStatus || snap?.error || 'no status'}).`);
    }
    await sleep(2500);
    const opened = await evaluateJson(send, `${street}.snapshot()`);
    const uiOpened = await evaluateJson(send, `(() => {
      const visible = (el) => Boolean(el && !el.hidden && el.getBoundingClientRect().width > 0);
      const street = document.querySelector('[data-iqai-view="street-360"]');
      const map = document.querySelector('[data-iqai-view="map"]');
      const visual = document.querySelector('[data-iqai-view="3d-visual"]');
      const notice = document.querySelector('[data-iqai-view-notice]');
      const buttons = [...document.querySelectorAll('button')].map((el) => el.textContent.trim());
      const body = document.body.innerText || '';
      return {
        titleVisible: visible(street) && street?.getAttribute('aria-pressed') === 'true',
        title: street?.textContent?.trim() || null,
        returnVisible: visible(map),
        returnLabel: map?.textContent?.trim() || null,
        visualVisible: visible(visual),
        status: notice?.hidden ? null : notice?.textContent?.trim() || null,
        dateLabel: notice?.hidden ? null : notice?.textContent?.trim() || null,
        idleStatus: null,
        pointPreservedButton: buttons.includes('POINT PRESERVED'),
        leakedPano: /panoId|StreetViewService|AIza[0-9A-Za-z_-]{20,}/i.test(body) === false ? false : true,
        nativeControls: Boolean(document.querySelector('.gm-iv-address, .gm-style, .gmnoprint'))
      };
    })()`);
    const streetShot = await capture(send, '02-montreal-street-360.png');

    const headingBefore = Number(opened?.pov?.heading);
    const afterLook = await evaluateJson(send, `${street}.look(90)`, true);
    await sleep(800);
    const lookShot = await capture(send, '03-montreal-street-360-look.png');
    const zoomBefore = Number(opened?.zoom);
    const afterZoom = await evaluateJson(send, `${street}.zoom(1)`, true);
    await sleep(600);
    const zoomShot = await capture(send, '04-montreal-street-360-zoom.png');
    const afterMove = await evaluateJson(send, `${street}.moveAlongCoverage()`, true);
    await sleep(1200);
    const moveShot = await capture(send, '05-montreal-street-360-move.png');
    const selectedDuring = await evaluateJson(send, `${street}.snapshot().selectedPoint`);

    await evaluate(send, `document.querySelector('[data-iqai-view="map"]')?.click()`);
    const returned = await waitFor(
      send,
      `${street}.snapshot().stageState === 'IDLE' && ${street}.snapshot().open === false`,
      80,
      250
    );
    if (!returned) throw new Error('MAP did not restore the 2D stage.');
    const after = await evaluateJson(send, `${street}.snapshot()`);
    const twoDAfterShot = await capture(send, '06-montreal-2d-after-street-360.png');

    await evaluate(send, `(() => {
      const point = ${street}.snapshot().selectedPoint;
      if (point) ${google3d}.selectPoint(point.longitude, point.latitude, point.source);
      return true;
    })()`);
    await waitFor(send, `document.querySelector('[data-iqai-view="3d-visual"]')?.disabled === false`, 40, 250);
    await evaluate(send, `document.querySelector('[data-iqai-view="3d-visual"]')?.click()`);
    const threeDOpened = await waitFor(
      send,
      `${google3d}.snapshot().stageState === 'OPEN' && ${google3d}.snapshot().open === true`,
      180,
      500
    );
    const threeD = await evaluateJson(send, `${google3d}.snapshot()`);
    const threeDUi = await evaluateJson(send, `(() => {
      const visible = (el) => Boolean(el && !el.hidden && el.getBoundingClientRect().width > 0);
      const nav = document.querySelector('[data-iqai-google-3d-nav]');
      const layers = document.querySelector('[data-iqai-google-3d-layers]');
      return {
        navVisible: visible(nav),
        layersVisible: visible(layers)
      };
    })()`);
    const threeDShot = await capture(send, '07-montreal-google-3d-after-street-360.png');
    await evaluateJson(send, `${google3d}.setReference(true)`, true).catch(() => null);
    await sleep(800);
    const referenceOn = await evaluateJson(send, `${google3d}.snapshot()`);
    await evaluate(send, `document.querySelector('[data-iqai-view="map"]')?.click()`);
    await waitFor(send, `${google3d}.snapshot().stageState === 'IDLE'`, 80, 250);
    const after3d = await evaluateJson(send, `${google3d}.snapshot()`);

    const unavailable = await evaluateJson(send, `(async () => {
      ${street}.selectPoint(${UNAVAILABLE_POINT.longitude}, ${UNAVAILABLE_POINT.latitude}, 'operator');
      return window.__iqaiSpatialV2.viewSwitcher.setView('street-360');
    })()`, true);
    const unavailableUi = await evaluateJson(send, `(() => {
      const notice = document.querySelector('[data-iqai-view-notice]');
      return {
        stageState: ${street}.snapshot().stageState,
        mapHostHidden: ${street}.snapshot().mapHostHidden,
        idleText: notice?.hidden ? null : notice?.textContent?.trim() || null
      };
    })()`);
    const unavailableShot = await capture(send, '08-montreal-street-360-unavailable.png');
    const groundAfter = await evaluateJson(send, `({
      ground: window.__iqaiSpatialV2.ground(),
      time: window.__iqaiSpatialV2.time(),
      map: window.__iqaiSpatialV2.mapFoundation.getSnapshot(),
      groundVisible: Boolean(document.querySelector('[data-iqai-operator-ground]')),
      mapNav: Boolean(document.querySelector('[data-iqai-map-nav]'))
    })`);

    return {
      selectedSet,
      before,
      opened,
      uiBefore,
      uiOpened,
      afterLook,
      afterZoom,
      afterMove,
      selectedDuring,
      after,
      headingBefore,
      zoomBefore,
      threeDOpened,
      threeD,
      threeDUi,
      referenceOn,
      after3d,
      unavailable,
      unavailableUi,
      groundAfter,
      screenshots: [
        twoDShot,
        streetShot,
        lookShot,
        zoomShot,
        moveShot,
        twoDAfterShot,
        threeDShot,
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
const selected = live?.opened?.selectedPoint || live?.selectedSet || { longitude: LON, latitude: LAT };
const selectedAfter = live?.after?.selectedPoint || null;
const selectedPointPreserved = Boolean(
  selected
  && selectedAfter
  && Math.abs(Number(selected.longitude) - Number(selectedAfter.longitude)) < 1e-7
  && Math.abs(Number(selected.latitude) - Number(selectedAfter.latitude)) < 1e-7
);
const selectedThroughMove = Boolean(
  selected
  && live?.selectedDuring
  && Math.abs(Number(selected.longitude) - Number(live.selectedDuring.longitude)) < 1e-7
  && Math.abs(Number(selected.latitude) - Number(live.selectedDuring.latitude)) < 1e-7
);
const lookAround = Number.isFinite(Number(live?.headingBefore))
  && Number.isFinite(Number(live?.afterLook?.pov?.heading))
  && Math.abs((((Number(live.afterLook.pov.heading) - Number(live.headingBefore)) % 360) + 360) % 360 - 90) <= 20;
const zoomWorked = Number.isFinite(Number(live?.zoomBefore))
  && Number.isFinite(Number(live?.afterZoom?.zoom))
  && Number(live.afterZoom.zoom) > Number(live.zoomBefore);
const movedAlongCoverage = live?.afterMove?.moved === true
  || (
    live?.opened?.panoramaPosition
    && live?.afterMove?.panoramaPosition
    && (
      Math.abs(Number(live.opened.panoramaPosition.latitude) - Number(live.afterMove.panoramaPosition.latitude)) > 0.00005
      || Math.abs(Number(live.opened.panoramaPosition.longitude) - Number(live.afterMove.panoramaPosition.longitude)) > 0.00005
    )
  );
const captureDate = live?.opened?.capture || {};
const captureHonest = captureDate.precision === 'UNKNOWN'
  || (captureDate.precision === 'MONTH' && !/-\d{2}-\d{2}$/.test(String(captureDate.text || '')))
  || captureDate.precision === 'YEAR'
  || captureDate.precision === 'DAY'
  || captureDate.precision === 'AS_PROVIDED';
const screenshotNamed = (fragment) => (live?.screenshots || []).find((file) => String(file).includes(fragment));
const pixels = screenshotNamed('02-montreal-street-360')
  ? pngStats(screenshotNamed('02-montreal-street-360'))
  : { error: 'no STREET 360 screenshot' };

const checks = {
  mapsJsConfigKey: browserKeyConfigured === true,
  selectedPointFromMapClick: live?.selectedSet?.source === 'map-click',
  street360ActionAvailable: live?.uiBefore?.openVisible === true && live?.uiBefore?.openEnabled === true
    && live?.uiBefore?.openLabel === 'STREET 360',
  panoramaOpened: live?.opened?.open === true && live?.opened?.renderer === 'StreetViewPanorama',
  productLabelVisible: live?.uiOpened?.title === 'STREET 360' && live?.uiOpened?.returnLabel === 'MAP'
    && live?.uiOpened?.titleVisible === true && live?.uiOpened?.pointPreservedButton !== true,
  noDebugLeak: live?.uiOpened?.leakedPano === false,
  lookAround,
  zoomWorked,
  movedAlongCoverage,
  captureDateHonest: captureHonest === true,
  selectedPointSurvived: selectedPointPreserved && selectedThroughMove,
  returnedToMap: live?.after?.open === false && live?.after?.mapHostHidden === false && live?.after?.mapViewExists === true,
  mapViewCountOne: live?.before?.mapViewCreateCount === 1
    && live?.after?.mapViewCreateCount === 1
    && live?.after3d?.mapViewCreateCount === 1
    && live?.after?.mapViewPreserved !== false,
  google3dStillOpens: live?.threeDOpened === true && live?.threeD?.open === true,
  google3dNavReference: live?.threeDUi?.navVisible === true
    && live?.threeDUi?.layersVisible === true
    && live?.referenceOn?.referenceEnabled === true,
  unavailableBehavior: live?.unavailableUi?.idleText === 'STREET 360 NOT AVAILABLE HERE'
    && live?.unavailableUi?.mapHostHidden === false
    && (live?.unavailable?.street360?.open === false || live?.unavailable?.open === false),
  nearmapWaybackRemain: Boolean(live?.groundAfter?.ground)
    && Boolean(live?.groundAfter?.time)
    && live?.groundAfter?.map?.state === 'READY',
  pixelsHaveContrast: Number(pixels?.contrast || 0) >= 24 && Number(pixels?.lumMax || 0) >= 40,
  montrealSelected: isGreaterMontrealLongitudeLatitude(selected?.longitude, selected?.latitude),
  noServerTilesKey: tilesKeyLeaked === false,
  noPortalWrite: portalWrite === false,
  twoDMapViewSurvived: live?.after?.mapViewExists === true && live?.after?.mapViewCreateCount === 1
};

const report = {
  generatedAt: new Date().toISOString(),
  spikeId: 'ARCGIS-MONTREAL-V2-STREET-360-PRODUCT-INTEGRATION-V1',
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
  opened: live?.opened || null,
  afterLook: live?.afterLook || null,
  afterZoom: live?.afterZoom || null,
  afterMove: live?.afterMove || null,
  after: live?.after || null,
  threeD: live?.threeD || null,
  unavailable: live?.unavailable || null,
  unavailableUi: live?.unavailableUi || null,
  groundAfter: live?.groundAfter || null,
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
  mapViewCreateCount: live?.after?.mapViewCreateCount ?? null
}, null, 2));
if (!report.pass) process.exitCode = 1;
