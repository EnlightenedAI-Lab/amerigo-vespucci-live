import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';
import { createServer } from '../src/server.js';
import { createPreviewConfig, createPreviewState } from '../src/demo-map-api.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'artifacts', 'spatial-v2-map-foundation-v1');
const VIEWPORTS = [
  { name: '3840x2160', width: 3840, height: 2160 },
  { name: '2560x1440', width: 2560, height: 1440 },
  { name: '1920x1080', width: 1920, height: 1080 }
];

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  for (const line of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (!process.env[key]) process.env[key] = value;
  }
}

loadEnvFile(path.join(ROOT, '.env'));

function exists(file) {
  try {
    return fs.existsSync(file);
  } catch {
    return false;
  }
}

function findBrowser() {
  const candidates = [
    process.env.EDGE_PATH,
    process.env.CHROME_PATH,
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'
  ].filter(Boolean);
  return candidates.find((file) => exists(file)) || null;
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

function request(url) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { timeout: 8000 }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve({
        status: res.statusCode,
        body: Buffer.concat(chunks).toString('utf8')
      }));
    });
    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`timeout ${url}`));
    });
    req.on('error', reject);
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
    const res = await fetch(`${portal}/sharing/rest/generateToken`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
      signal: AbortSignal.timeout(12000)
    });
    const data = await res.json().catch(() => ({}));
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
    '--headless=new',
    '--hide-scrollbars',
    '--no-first-run',
    '--no-default-browser-check',
    '--force-device-scale-factor=1',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
    '--enable-webgl',
    '--use-angle=swiftshader',
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
        const onMessage = (raw) => {
          const msg = JSON.parse(raw.toString());
          if (msg.id !== id) return;
          ws.off('message', onMessage);
          if (msg.error) reject(new Error(`${method}: ${JSON.stringify(msg.error)}`));
          else resolve(msg.result);
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
    await send('Runtime.enable');
    const result = await fn(send);
    ws.close();
    return result;
  } finally {
    child.kill();
  }
}

async function evaluateJson(send, expression, awaitPromise = false) {
  const result = await send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise
  });
  const value = result.result?.value;
  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }
  return value;
}

fs.mkdirSync(OUT, { recursive: true });

const liveOn3000 = await isPortOpen(3000, '127.0.0.1') || await isPortOpen(3000, 'localhost');
let server = null;
let base;
if (liveOn3000) {
  base = 'http://localhost:3000';
} else {
  const app = createServer(createPreviewState(), createPreviewConfig(0), null, { preview: true });
  server = app.listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
}

const httpChecks = {
  v1: await request(`${base}/spatial/`),
  v2: await request(`${base}/spatial-v2/`)
};

const preauth = await fetchPreauthToken();
const browserPath = findBrowser();
const shots = [];
let browserError = null;
let live = null;

if (browserPath) {
  try {
    live = await withCdpPage(browserPath, 9244, async (send) => {
      if (preauth) {
        await send('Page.addScriptToEvaluateOnNewDocument', {
          source: `window.__MONTREAL_PREAUTH_TOKEN = ${JSON.stringify(preauth)};`
        });
      }

      await send('Emulation.setDeviceMetricsOverride', {
        width: 3840,
        height: 2160,
        deviceScaleFactor: 1,
        mobile: false
      });
      await send('Page.navigate', { url: `${base}/spatial-v2/?map=foundation` });

      let state = 'INITIALIZING';
      for (let i = 0; i < 45; i += 1) {
        state = await evaluateJson(send, 'window.__iqaiSpatialV2?.mapFoundation?.getState?.() || "WAITING"');
        if (state === 'READY' || state === 'ERROR') break;
        await sleep(1000);
      }

      if (state === 'READY') {
        for (let i = 0; i < 30; i += 1) {
          const painted = await evaluateJson(send, `(() => {
            const view = window.__iqaiSpatialV2?.mapFoundation?.getView?.();
            const canvas = document.querySelector(".iqai-v2-map-host canvas, .esri-view-surface canvas");
            return Boolean(view?.ready && canvas && (view.stationary !== false));
          })()`);
          if (painted) break;
          await sleep(500);
        }
        await sleep(2500);
      }

      const snapshot = await evaluateJson(
        send,
        'JSON.stringify(window.__iqaiSpatialV2?.mapFoundation?.getSnapshot?.() || {})'
      );
      const measure4k = await evaluateJson(send, 'JSON.stringify(window.__iqaiSpatialV2.measure())');

      let interactions = null;
      if (state === 'READY') {
        interactions = await evaluateJson(send, `(() => {
          const api = window.__iqaiSpatialV2.mapFoundation;
          const view = api.getView();
          return (async () => {
            const before = view.zoom;
            await api.zoomIn();
            const afterIn = view.zoom;
            await api.zoomOut();
            const afterOut = view.zoom;
            await api.goHome();
            document.querySelector('[data-iqai-capability="point"]')?.click();
            document.querySelector('[data-iqai-capability="vision"]')?.click();
            document.querySelector('[data-iqai-capability="map"]')?.click();
            return {
              zoomBefore: before,
              zoomAfterIn: afterIn,
              zoomAfterOut: afterOut,
              createCountAfterClicks: api.getMapViewCreateCount(),
              popupEnabled: view.popupEnabled,
              canPan: view.navigation?.browserTouchPanEnabled !== false,
              authoredLayerCount: api.getAuthoredLayerIds().length,
              runtimeLayerCount: api.getRuntimePlane()?.layers?.length || 0,
              runtimePlaneId: api.getRuntimePlane()?.id || null
            };
          })();
        })()`, true);
      }

      const shot4k = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
      const file4k = path.join(OUT, 'spatial-v2-map-foundation-3840x2160.png');
      fs.writeFileSync(file4k, Buffer.from(shot4k.data, 'base64'));
      shots.push(file4k);

      const compositions = [{ viewport: '3840x2160', measure: measure4k, state }];
      for (const viewport of VIEWPORTS.slice(1)) {
        await send('Emulation.setDeviceMetricsOverride', {
          width: viewport.width,
          height: viewport.height,
          deviceScaleFactor: 1,
          mobile: false
        });
        await sleep(600);
        const measure = await evaluateJson(send, 'JSON.stringify(window.__iqaiSpatialV2.measure())');
        const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
        const file = path.join(OUT, `spatial-v2-map-foundation-${viewport.name}.png`);
        fs.writeFileSync(file, Buffer.from(shot.data, 'base64'));
        shots.push(file);
        compositions.push({ viewport: viewport.name, measure, state });
      }

      const v1 = await request(`${base}/spatial/`);
      return { state, snapshot, interactions, compositions, v1StillSpatialJs: v1.body.includes('/spatial/spatial.js') };
    });
  } catch (error) {
    browserError = String(error?.message || error);
  }
}

if (server) {
  await new Promise((resolve) => server.close(resolve));
}

const report = {
  generatedAt: new Date().toISOString(),
  base,
  reusedLiveServer: liveOn3000,
  preauthInjected: Boolean(preauth),
  routes: {
    v1: { status: httpChecks.v1.status, hasV1Runtime: httpChecks.v1.body.includes('/spatial/spatial.js') },
    v2: { status: httpChecks.v2.status, hasV2Shell: httpChecks.v2.body.includes('iqai-spatial-v2') }
  },
  browserPath,
  browserError,
  screenshots: shots,
  live
};

fs.writeFileSync(path.join(OUT, 'qa-report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
