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
const OUT = path.join(
  ROOT,
  'artifacts',
  SHELL_INTEGRATION
    ? 'spatial-v2-google-maps-js-3d-product-v1'
    : 'spatial-v2-google-maps-js-3d-v2'
);
const VIEWPORT = { width: 1920, height: 1080 };
const BASE = 'http://localhost:3000';
const LON = MONTREAL_OPERATIONAL_CENTER.longitude;
const LAT = MONTREAL_OPERATIONAL_CENTER.latitude;

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
    } else if (type === 'IEND') {
      break;
    }
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
  const x0 = Math.floor(width * 0.18);
  const x1 = Math.floor(width * 0.82);
  const y0 = Math.floor(height * 0.18);
  const y1 = Math.floor(height * 0.88);
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
    const googleResponses = [];
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
        if (message.method === 'Log.entryAdded' && message.params?.entry?.text) {
          consoles.push({
            type: message.params.entry.level,
            text: redact(String(message.params.entry.text).slice(0, 500))
          });
        }
        if (message.method === 'Network.responseReceived') {
          const url = String(message.params?.response?.url || '');
          if (/googleapis\.com|gstatic\.com|keyhole/i.test(url)) {
            googleResponses.push({
              status: message.params.response.status,
              url: redact(url).slice(0, 220)
            });
          }
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
    await send('Log.enable').catch(() => ({}));
    const result = await fn(send);
    if (result && typeof result === 'object') {
      result.networkUrls = networkUrls.slice();
      result.consoles = consoles.slice(0, 40);
      result.googleResponses = googleResponses.slice(0, 50);
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
    try {
      fs.rmSync(userDataDir, { recursive: true, force: true });
    } catch {
      // browser profile may still be locked
    }
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

fs.mkdirSync(OUT, { recursive: true });

const liveOn3000 = await isPortOpen(3000, '127.0.0.1') || await isPortOpen(3000, 'localhost');
const config = liveOn3000
  ? await fetchJson(`${BASE}/api/spatial/config`).catch((error) => ({ status: 0, body: { error: String(error?.message || error) } }))
  : { status: 0, body: {} };
const browserKeyConfigured = Boolean(config.body?.streetLevelContext?.googleMapsBrowserApiKey);
const tilesKey = String(process.env.GOOGLE_MAP_TILES_API_KEY || '').trim();
const browserPath = findBrowser();
const preauth = await fetchPreauthToken();
let browserError = null;
let live = null;

try {
  if (!liveOn3000) throw new Error('localhost:3000 is not serving IQAI Spatial.');
  if (!browserKeyConfigured) {
    throw new Error('GOOGLE_MAPS_BROWSER_API_KEY is not present on /api/spatial/config. Recycle local preview.js so .env is loaded.');
  }
  if (!browserPath) throw new Error('No supported Edge or Chrome browser found.');
  live = await withCdpPage(browserPath, 9371, async (send) => {
    const log = (message) => console.error(`[google-maps-js-3d] ${message}`);
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
    const apiExpression = SHELL_INTEGRATION
      ? 'window.__iqaiSpatialV2?.google3d'
      : 'window.__iqaiGooglePhotorealistic3d';
    const targetUrl = SHELL_INTEGRATION
      ? `${BASE}/spatial-v2/`
      : `${BASE}/spatial-v2/google-photorealistic-3d-proof.html?lon=${LON}&lat=${LAT}`;
    await send('Page.navigate', { url: targetUrl });
    const booted = await waitFor(send, `Boolean(${apiExpression}?.snapshot)`, 120, 250);
    if (!booted) {
      throw new Error(SHELL_INTEGRATION
        ? 'Spatial V2 Google 3D operator control did not boot.'
        : 'Google Maps JS 3D proof page did not boot.');
    }
    await waitFor(
      send,
      `${apiExpression}.snapshot().mapViewExists === true`,
      120,
      500
    );
    let selectedSet = null;
    if (SHELL_INTEGRATION) {
      const operatorReady = await waitFor(
        send,
        `window.__iqaiSpatialV2.mapFoundation.getSnapshot().state === 'READY'
          && document.querySelector('[data-iqai-google-3d-open]')?.disabled === false`,
        160,
        500
      );
      if (!operatorReady) throw new Error('Spatial V2 map stage did not enable OPEN 3D.');
      const mapRect = await evaluateJson(send, `(() => {
        const rect = document.querySelector('[data-iqai-map-host]')?.getBoundingClientRect();
        return rect ? {
          x: rect.x + rect.width / 2,
          y: rect.y + rect.height / 2
        } : null;
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
        `${apiExpression}.snapshot().selectedPoint?.source === 'map-click'`,
        40,
        250
      );
      if (!selectedFromMap) throw new Error('Map click did not establish the Google 3D selected point.');
      selectedSet = await evaluateJson(send, `${apiExpression}.snapshot().selectedPoint`);
    }
    const before = await evaluateJson(send, `${apiExpression}.snapshot()`);
    const shellBefore = SHELL_INTEGRATION
      ? await evaluateJson(send, `({
          command: window.__iqaiSpatialV2.commandCenter.getSnapshot(),
          ground: window.__iqaiSpatialV2.ground(),
          time: window.__iqaiSpatialV2.time(),
          map: window.__iqaiSpatialV2.mapFoundation.getSnapshot()
        })`)
      : null;
    const uiBefore = SHELL_INTEGRATION
      ? await evaluateJson(send, `(() => {
          const visible = (el) => Boolean(el && !el.hidden && el.getBoundingClientRect().width > 0);
          const open = document.querySelector('[data-iqai-google-3d-open]');
          const returned = document.querySelector('[data-iqai-google-3d-return]');
          const title = document.querySelector('[data-iqai-google-3d-title]');
          return {
            openVisible: visible(open),
            openEnabled: Boolean(open && !open.disabled),
            returnVisible: visible(returned),
            titleVisible: visible(title),
            title: title?.textContent?.trim() || null
          };
        })()`)
      : null;
    log(`2D mapViewCreateCount=${before?.mapViewCreateCount} exists=${before?.mapViewExists}`);
    const twoDShot = await capture(send, '01-montreal-2d-before-3d.png');

    let openedWait;
    if (SHELL_INTEGRATION) {
      await evaluate(send, `(() => {
        document.querySelector('[data-iqai-google-3d-open]')?.click();
        return true;
      })()`);
      const openedFromUi = await waitFor(
        send,
        `${apiExpression}.snapshot().stageState === 'OPEN' && ${apiExpression}.snapshot().steady === true`,
        180,
        500
      );
      openedWait = await evaluateJson(send, `${apiExpression}.snapshot()`);
      if (!openedFromUi) log(`OPEN 3D settled as ${openedWait?.stageState || 'UNKNOWN'}: ${openedWait?.error || 'not steady'}`);
    } else {
      openedWait = await evaluateJson(send, `(async () => {
        return ${apiExpression}.open();
      })()`, true, 80000);
    }
    await sleep(SHELL_INTEGRATION ? 12000 : 50000);
    const threeDShot = await capture(send, '02-montreal-google-maps-js-3d.png');
    const opened = await evaluateJson(send, `${apiExpression}.snapshot()`);
    const uiOpened = SHELL_INTEGRATION
      ? await evaluateJson(send, `(() => {
          const visible = (el) => Boolean(el && !el.hidden && el.getBoundingClientRect().width > 0);
          const returned = document.querySelector('[data-iqai-google-3d-return]');
          const title = document.querySelector('[data-iqai-google-3d-title]');
          return {
            returnVisible: visible(returned),
            titleVisible: visible(title),
            title: title?.textContent?.trim() || null,
            mapHostVisibility: document.querySelector('[data-iqai-map-host]')?.style?.visibility || ''
          };
        })()`)
      : null;
    const map3dDom = await evaluateJson(send, `(() => {
      const el = document.querySelector('gmp-map-3d');
      return {
        present: Boolean(el),
        width: el ? Math.round(el.getBoundingClientRect().width) : 0,
        height: el ? Math.round(el.getBoundingClientRect().height) : 0
      };
    })()`);
    log(`3D open=${opened?.open} maps3d=${opened?.maps3dLoaded} renderer=${opened?.renderer} mode=${opened?.mode} marker=${opened?.markerPresent} error=${opened?.error || ''}`);
    const headingBefore = Number(opened?.camera?.heading);
    const nudged = await evaluateJson(send, `(async () => {
      return ${apiExpression}.nudgeHeading(32);
    })()`, true, 20000).catch((error) => ({ error: String(error?.message || error) }));
    await sleep(4500);
    const afterNudge = await evaluateJson(send, `${apiExpression}.snapshot()`);
    const threeDNavShot = await capture(send, '02b-montreal-google-maps-js-3d-heading.png');

    let returned;
    if (SHELL_INTEGRATION && opened?.stageState === 'OPEN') {
      await evaluate(send, `(() => {
        document.querySelector('[data-iqai-google-3d-return]')?.click();
        return true;
      })()`);
      const returnedFromUi = await waitFor(
        send,
        `${apiExpression}.snapshot().stageState === 'IDLE' && ${apiExpression}.snapshot().open === false`,
        80,
        250
      );
      if (!returnedFromUi) throw new Error('RETURN TO 2D did not restore the product map stage.');
      returned = await evaluateJson(send, `${apiExpression}.snapshot()`);
    } else if (SHELL_INTEGRATION) {
      returned = await evaluateJson(send, `(async () => {
        return ${apiExpression}.close();
      })()`, true, 20000);
    } else {
      returned = await evaluateJson(send, `(async () => {
        return ${apiExpression}.close();
      })()`, true, 20000);
    }
    await sleep(800);
    const after = await evaluateJson(send, `${apiExpression}.snapshot()`);
    const shellAfter = SHELL_INTEGRATION
      ? await evaluateJson(send, `({
          command: window.__iqaiSpatialV2.commandCenter.getSnapshot(),
          ground: window.__iqaiSpatialV2.ground(),
          time: window.__iqaiSpatialV2.time(),
          map: window.__iqaiSpatialV2.mapFoundation.getSnapshot()
        })`)
      : null;
    const uiAfter = SHELL_INTEGRATION
      ? await evaluateJson(send, `(() => {
          const visible = (el) => Boolean(el && !el.hidden && el.getBoundingClientRect().width > 0);
          const open = document.querySelector('[data-iqai-google-3d-open]');
          const returned = document.querySelector('[data-iqai-google-3d-return]');
          return {
            openVisible: visible(open),
            returnVisible: visible(returned),
            mapHostVisibility: document.querySelector('[data-iqai-map-host]')?.style?.visibility || ''
          };
        })()`)
      : null;
    const twoDAfterShot = await capture(send, '03-montreal-2d-after-return.png');
    log(`return open=${after?.open} mapViewCreateCount=${after?.mapViewCreateCount} gmp=${Boolean(await evaluate(send, 'Boolean(document.querySelector("gmp-map-3d"))'))}`);

    return {
      before,
      selectedSet,
      shellBefore,
      uiBefore,
      openedWait,
      opened,
      uiOpened,
      map3dDom,
      nudged,
      headingBefore,
      afterNudge,
      returned,
      after,
      shellAfter,
      uiAfter,
      screenshots: [twoDShot, threeDShot, threeDNavShot, twoDAfterShot]
    };
  });
} catch (error) {
  browserError = String(error?.message || error);
}

const networkUrls = live?.networkUrls || [];
const tilesKeyLeaked = Boolean(tilesKey) && networkUrls.some((url) => url.includes(tilesKey));
const networkHosts = [...new Set(networkUrls.map((url) => {
  try {
    return new URL(url).host;
  } catch {
    return 'invalid';
  }
}))];
const mapsJsLoadedNet = networkUrls.some((url) => /maps\.googleapis\.com\/maps\/api\/js/i.test(url));
const maps3dNet = networkUrls.some((url) => /maps3d|photorealistic|gstatic\.com\/.*map/i.test(url));
const proxy3dTiles = networkUrls.some((url) => /\/api\/spatial-v2\/google\/3dtiles\//i.test(url));
const portalWrite = networkUrls.some((url) => /\/sharing\/rest\/content\/users\/.*\/(addItem|update)/i.test(url));
const nearmapNet = networkUrls.some((url) => /nearmap/i.test(url));
const waybackNet = networkUrls.some((url) => /wayback/i.test(url));
const selected = live?.opened?.selectedPoint || live?.before?.mapCenter || { longitude: LON, latitude: LAT };
const camera = live?.opened?.camera || null;
const headingChanged = Number.isFinite(live?.headingBefore)
  && Number.isFinite(Number(live?.afterNudge?.camera?.heading))
  && Math.abs((((Number(live.afterNudge.camera.heading) - live.headingBefore) + 540) % 360) - 180) >= 10;
const selectedAfter = live?.after?.selectedPoint || null;
const selectedPointPreserved = Boolean(
  selected
  && selectedAfter
  && Math.abs(Number(selected.longitude) - Number(selectedAfter.longitude)) < 1e-7
  && Math.abs(Number(selected.latitude) - Number(selectedAfter.latitude)) < 1e-7
);
const shellStatePreserved = !SHELL_INTEGRATION || Boolean(
  live?.shellBefore
  && live?.shellAfter
  && live.shellBefore.command?.experience === live.shellAfter.command?.experience
  && live.shellBefore.command?.activeCapability === live.shellAfter.command?.activeCapability
  && live.shellBefore.command?.imageryView === live.shellAfter.command?.imageryView
  && live.shellBefore.ground?.currentMode === live.shellAfter.ground?.currentMode
);
const pixels = live?.screenshots?.[1]
  ? pngStats(live.screenshots[1])
  : { error: 'no 3D screenshot' };
const pixelsNav = live?.screenshots?.[2]
  ? pngStats(live.screenshots[2])
  : { error: 'no heading screenshot' };

const checks = {
  mapsJsConfigKey: browserKeyConfigured === true,
  mapsJsLoaded: live?.opened?.mapsJsLoaded === true || mapsJsLoadedNet === true,
  maps3dLoaded: live?.opened?.maps3dLoaded === true,
  map3dElement: live?.opened?.renderer === 'Map3DElement' && live?.map3dDom?.present === true,
  montrealSelected: isGreaterMontrealLongitudeLatitude(selected?.longitude, selected?.latitude),
  selectedPointFromMapClick: !SHELL_INTEGRATION || live?.selectedSet?.source === 'map-click',
  cameraTilted: Number(camera?.tilt) >= 50 && Number(camera?.tilt) <= 80,
  markerPresent: live?.opened?.markerPresent === true,
  renderReachedSteady: live?.opened?.steady === true && !live?.opened?.error,
  headingNavigated: headingChanged === true,
  openActionVisible: !SHELL_INTEGRATION
    || (live?.uiBefore?.openVisible === true && live?.uiBefore?.openEnabled === true),
  productLabelVisible: !SHELL_INTEGRATION
    || (
      live?.uiOpened?.titleVisible === true
      && live?.uiOpened?.title === 'GOOGLE PHOTOREALISTIC 3D'
    ),
  returnActionVisible: !SHELL_INTEGRATION || live?.uiOpened?.returnVisible === true,
  pixelsHaveContrast: Number(pixels?.contrast || 0) >= 24 && Number(pixels?.lumMax || 0) >= 40,
  navigationPixelsHaveContrast: Number(pixelsNav?.contrast || 0) >= 24
    && Number(pixelsNav?.lumMax || 0) >= 80,
  mapViewPreserved: live?.before?.mapViewCreateCount === 1
    && live?.after?.mapViewCreateCount === 1
    && live?.after?.mapViewPreserved !== false,
  returnedTo2d: live?.after?.open === false && live?.after?.mapViewExists === true && live?.after?.mapHostHidden === false,
  selectedPointSurvived: selectedPointPreserved,
  shellStatePreserved,
  nearmapAndWaybackOperational: !SHELL_INTEGRATION || (nearmapNet === true && waybackNet === true),
  noServerTilesKey: tilesKeyLeaked === false,
  noProxy3dTiles: proxy3dTiles === false,
  noPortalWrite: portalWrite === false,
  twoDMapViewSurvived: live?.after?.mapViewExists === true && live?.after?.mapViewCreateCount === 1
};

const report = {
  generatedAt: new Date().toISOString(),
  spikeId: SHELL_INTEGRATION
    ? 'ARCGIS-GOOGLE-MAPS-JS-3D-PRODUCT-INTEGRATION-V1'
    : 'ARCGIS-P0-GOOGLE-MAPS-JS-PHOTOREALISTIC-3D-MONTREAL-V2',
  target: SHELL_INTEGRATION ? 'spatial-v2-product-shell' : 'isolated-proof',
  viewport: VIEWPORT,
  base: BASE,
  liveOn3000,
  browserKeyConfigured,
  browserPath,
  preauthInjected: Boolean(preauth),
  browserError,
  selectedPoint: selected,
  operatorSelection: live?.selectedSet || null,
  camera,
  map3dDom: live?.map3dDom || null,
  headingBefore: live?.headingBefore ?? null,
  headingAfter: live?.afterNudge?.camera?.heading ?? null,
  pixels,
  pixelsNav,
  networkHosts,
  networkSamples: networkUrls.slice(0, 24).map(redact),
  mapsJsLoadedNet,
  maps3dNet,
  proxy3dTiles,
  tilesKeyLeaked,
  waybackNet,
  nearmapNet,
  consoles: live?.consoles || [],
  googleResponses: live?.googleResponses || [],
  screenshots: live?.screenshots || [],
  shellBefore: live?.shellBefore || null,
  shellAfter: live?.shellAfter || null,
  uiBefore: live?.uiBefore || null,
  uiOpened: live?.uiOpened || null,
  uiAfter: live?.uiAfter || null,
  opened: live?.opened || null,
  after: live?.after || null,
  checks,
  pass: Boolean(!browserError && Object.values(checks).every(Boolean))
};

fs.writeFileSync(path.join(OUT, 'qa-report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
if (!report.pass) process.exitCode = 1;
