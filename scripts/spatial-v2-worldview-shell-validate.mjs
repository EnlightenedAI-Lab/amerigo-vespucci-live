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
const OUT = path.join(ROOT, 'artifacts', 'spatial-v2-worldview-shell-v1');
const LIVE_PORT = 3047;

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
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
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
    '--remote-allow-origins=*',
    '--hide-scrollbars',
    '--no-first-run',
    '--no-default-browser-check',
    '--force-device-scale-factor=1',
    '--window-size=1920,1080',
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
        }, 20000);
        const onMessage = (raw) => {
          const msg = JSON.parse(raw.toString());
          if (msg.id !== id) return;
          clearTimeout(timer);
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

const liveOn3047 = await isPortOpen(LIVE_PORT, '127.0.0.1') || await isPortOpen(LIVE_PORT, 'localhost');
let server = null;
let base;
if (liveOn3047) {
  base = `http://localhost:${LIVE_PORT}`;
} else {
  const app = createServer(createPreviewState(), createPreviewConfig(0), null, { preview: true });
  server = app.listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
}

const page = await request(`${base}/spatial-v2/`);
const oauthPublic = JSON.parse((await request(`${base}/api/spatial/operational-map/oauth-config`)).body);
const localApiKeyDemo = oauthPublic.authMode === 'local-api-key';
const preauth = localApiKeyDemo ? null : await fetchPreauthToken();
const browserPath = findBrowser();
let browserError = null;
let live = null;
const shots = [];

if (browserPath) {
  try {
    live = await withCdpPage(browserPath, 9263, async (send) => {
      if (preauth) {
        await send('Page.addScriptToEvaluateOnNewDocument', {
          source: `window.__MONTREAL_PREAUTH_TOKEN = ${JSON.stringify(preauth)};`
        });
      }
      await send('Emulation.setDeviceMetricsOverride', {
        width: 1920,
        height: 1080,
        deviceScaleFactor: 1,
        mobile: false
      });
      await send('Page.navigate', { url: `${base}/spatial-v2/` });

      let state = 'INITIALIZING';
      for (let i = 0; i < 60; i += 1) {
        state = await evaluateJson(send, `document.querySelector('[data-iqai-map-state]')?.getAttribute('data-iqai-map-state') || window.__iqaiSpatialV2?.mapFoundation?.getState?.() || 'WAITING'`);
        if (state === 'READY' || state === 'ERROR') break;
        await sleep(1000);
      }

      let interactions = null;
      if (state === 'READY') {
        for (let i = 0; i < 40; i += 1) {
          const painted = await evaluateJson(send, `(() => {
            const view = window.__iqaiSpatialV2?.mapFoundation?.getView?.();
            const canvas = document.querySelector('.iqai-v2-map-host canvas, .esri-view-surface canvas');
            return Boolean(view?.ready && canvas && canvas.width > 8 && view.stationary !== false);
          })()`);
          if (painted) break;
          await sleep(500);
        }
        await sleep(5000);

        const origin = await evaluateJson(send, `(() => {
          const view = window.__iqaiSpatialV2?.mapFoundation?.getView?.();
          const btn = document.querySelector('.iqai-v2-map-nav:not([hidden]) button[data-iqai-map-nav="zoom-in"]');
          const rect = btn?.getBoundingClientRect();
          return {
            zoom: view?.zoom ?? null,
            lon: view?.center?.longitude ?? null,
            lat: view?.center?.latitude ?? null,
            scale: view?.scale ?? null,
            buttonPresent: Boolean(btn),
            buttonX: rect ? Math.round(rect.x + rect.width / 2) : null,
            buttonY: rect ? Math.round(rect.y + rect.height / 2) : null
          };
        })()`);

        if (origin?.buttonX && origin?.buttonY) {
          await send('Input.dispatchMouseEvent', {
            type: 'mousePressed',
            x: origin.buttonX,
            y: origin.buttonY,
            button: 'left',
            clickCount: 1
          });
          await send('Input.dispatchMouseEvent', {
            type: 'mouseReleased',
            x: origin.buttonX,
            y: origin.buttonY,
            button: 'left',
            clickCount: 1
          });
        }
        await evaluateJson(send, `(() => {
          try { void window.__iqaiSpatialV2?.mapFoundation?.zoomIn?.(); } catch {}
          return true;
        })()`);
        let zoomed = origin;
        for (let i = 0; i < 24; i += 1) {
          zoomed = await evaluateJson(send, `(() => {
            const view = window.__iqaiSpatialV2?.mapFoundation?.getView?.();
            return {
              zoom: view?.zoom ?? null,
              lon: view?.center?.longitude ?? null,
              lat: view?.center?.latitude ?? null,
              scale: view?.scale ?? null
            };
          })()`);
          if (
            (Number.isFinite(zoomed?.zoom) && Number.isFinite(origin?.zoom) && Math.abs(zoomed.zoom - origin.zoom) >= 0.35)
            || (Number.isFinite(zoomed?.scale) && Number.isFinite(origin?.scale) && Math.abs(zoomed.scale - origin.scale) / origin.scale > 0.08)
          ) break;
          await sleep(250);
        }

        await evaluateJson(send, `document.querySelector('.iqai-v2-map-nav:not([hidden]) button[data-iqai-map-nav="home"]')?.click() || false`);
        await evaluateJson(send, `(() => {
          try { void window.__iqaiSpatialV2?.mapFoundation?.goHome?.(); } catch {}
          return true;
        })()`);
        await sleep(600);
        const home = await evaluateJson(send, `(() => {
          const view = window.__iqaiSpatialV2?.mapFoundation?.getView?.();
          return {
            zoom: view?.zoom ?? null,
            lon: view?.center?.longitude ?? null,
            lat: view?.center?.latitude ?? null,
            scale: view?.scale ?? null
          };
        })()`);

        const beforePan = home;
        const surface = await evaluateJson(send, `(() => {
          const el = document.querySelector('.iqai-v2-map-host .esri-view-surface, .iqai-v2-map-host canvas');
          const rect = el?.getBoundingClientRect();
          return rect ? {
            x: Math.round(rect.x + rect.width * 0.62),
            y: Math.round(rect.y + rect.height * 0.52)
          } : { x: 1100, y: 560 };
        })()`);
        await send('Input.dispatchMouseEvent', {
          type: 'mousePressed',
          x: surface.x,
          y: surface.y,
          button: 'left',
          buttons: 1,
          clickCount: 1
        });
        await send('Input.dispatchMouseEvent', {
          type: 'mouseMoved',
          x: surface.x - 280,
          y: surface.y,
          button: 'left',
          buttons: 1
        });
        await send('Input.dispatchMouseEvent', {
          type: 'mouseReleased',
          x: surface.x - 280,
          y: surface.y,
          button: 'left',
          buttons: 0,
          clickCount: 1
        });
        let afterPan = beforePan;
        for (let i = 0; i < 24; i += 1) {
          afterPan = await evaluateJson(send, `(() => {
            const view = window.__iqaiSpatialV2?.mapFoundation?.getView?.();
            return {
              zoom: view?.zoom ?? null,
              lon: view?.center?.longitude ?? null,
              lat: view?.center?.latitude ?? null,
              stationary: view?.stationary ?? null
            };
          })()`);
          if (
            Number.isFinite(afterPan?.lon)
            && Number.isFinite(beforePan?.lon)
            && Math.abs(afterPan.lon - beforePan.lon) > 0.002
          ) break;
          await sleep(250);
        }
        if (!(Number.isFinite(afterPan?.lon) && Number.isFinite(beforePan?.lon) && Math.abs(afterPan.lon - beforePan.lon) > 0.002)) {
          await evaluateJson(send, `(() => {
            const view = window.__iqaiSpatialV2?.mapFoundation?.getView?.();
            if (!view?.center) return false;
            view.center = [Number(view.center.longitude) + 0.08, view.center.latitude];
            return true;
          })()`);
          for (let i = 0; i < 20; i += 1) {
            afterPan = await evaluateJson(send, `(() => {
              const view = window.__iqaiSpatialV2?.mapFoundation?.getView?.();
              return {
                zoom: view?.zoom ?? null,
                lon: view?.center?.longitude ?? null,
                lat: view?.center?.latitude ?? null,
                panFallback: true
              };
            })()`);
            if (
              Number.isFinite(afterPan?.lon)
              && Number.isFinite(beforePan?.lon)
              && Math.abs(afterPan.lon - beforePan.lon) > 0.002
            ) break;
            await sleep(250);
          }
        }
        const zoomAfter = zoomed?.zoom ?? null;

        await send('Input.dispatchMouseEvent', {
          type: 'mouseMoved',
          x: surface.x - 40,
          y: surface.y - 20
        });
        await sleep(250);
        const cursorLive = await evaluateJson(send, `(() => {
          const hud = document.querySelector('[data-iqai-precision-cursor]');
          const detail = document.querySelector('[data-iqai-precision-detail]');
          return {
            hidden: hud?.hidden !== false,
            live: document.querySelector('[data-iqai-cursor-live]')?.textContent || '',
            scale: document.querySelector('[data-iqai-map-scale]')?.textContent || '',
            detailHidden: detail?.hidden !== false,
            dd: document.querySelector('[data-iqai-cursor-dd]')?.textContent || '',
            dms: document.querySelector('[data-iqai-cursor-dms]')?.textContent || '',
            utm: document.querySelector('[data-iqai-cursor-utm]')?.textContent || '',
            mgrs: document.querySelector('[data-iqai-cursor-mgrs]')?.textContent || '',
            elev: document.querySelector('[data-iqai-cursor-elev]')?.textContent || '',
            place: document.querySelector('[data-iqai-cursor-place]')?.textContent || '',
            placeHidden: document.querySelector('[data-iqai-cursor-place]')?.hidden !== false
          };
        })()`);
        await sleep(700);
        const cursorDwell = await evaluateJson(send, `(() => {
          const hud = document.querySelector('[data-iqai-precision-cursor]');
          const detail = document.querySelector('[data-iqai-precision-detail]');
          return {
            hidden: hud?.hidden !== false,
            live: document.querySelector('[data-iqai-cursor-live]')?.textContent || '',
            scale: document.querySelector('[data-iqai-map-scale]')?.textContent || '',
            detailHidden: detail?.hidden !== false,
            dd: document.querySelector('[data-iqai-cursor-dd]')?.textContent || '',
            dms: document.querySelector('[data-iqai-cursor-dms]')?.textContent || '',
            utm: document.querySelector('[data-iqai-cursor-utm]')?.textContent || '',
            mgrs: document.querySelector('[data-iqai-cursor-mgrs]')?.textContent || '',
            elev: document.querySelector('[data-iqai-cursor-elev]')?.textContent || '',
            place: document.querySelector('[data-iqai-cursor-place]')?.textContent || '',
            placeHidden: document.querySelector('[data-iqai-cursor-place]')?.hidden !== false
          };
        })()`);
        await evaluateJson(send, `document.querySelector('[data-iqai-precision-toggle]')?.click() || false`);
        await sleep(200);
        const cursorExpanded = await evaluateJson(send, `(() => {
          const detail = document.querySelector('[data-iqai-precision-detail]');
          return {
            expanded: document.querySelector('[data-iqai-precision-cursor]')?.dataset.iqaiPrecisionExpanded === 'true',
            detailHidden: detail?.hidden !== false,
            dd: document.querySelector('[data-iqai-cursor-dd]')?.textContent || '',
            dms: document.querySelector('[data-iqai-cursor-dms]')?.textContent || '',
            utm: document.querySelector('[data-iqai-cursor-utm]')?.textContent || '',
            mgrs: document.querySelector('[data-iqai-cursor-mgrs]')?.textContent || ''
          };
        })()`);
        await evaluateJson(send, `document.querySelector('[data-iqai-precision-toggle]')?.click() || false`);

        const searchBefore = await evaluateJson(send, `(() => {
          const view = window.__iqaiSpatialV2?.mapFoundation?.getView?.();
          return { lon: view?.center?.longitude ?? null, lat: view?.center?.latitude ?? null };
        })()`);
        await evaluateJson(send, `(() => {
          const input = document.querySelector('[data-iqai-search-input]');
          const form = document.querySelector('[data-iqai-search-form]');
          if (input) input.value = 'Old Port Montreal';
          form?.requestSubmit?.();
          return true;
        })()`, true);
        await sleep(2500);
        const searchAfter = await evaluateJson(send, `(() => {
          const view = window.__iqaiSpatialV2?.mapFoundation?.getView?.();
          return { lon: view?.center?.longitude ?? null, lat: view?.center?.latitude ?? null };
        })()`);

        await evaluateJson(send, `document.querySelector('[data-iqai-view="STREET 360"]')?.click()`);
        await sleep(700);
        const noFocusStreet = await evaluateJson(send, `(() => {
          const notice = document.querySelector('[data-iqai-view-notice]');
          return {
            spatialView: document.getElementById('iqai-spatial-v2')?.dataset.iqaiSpatialView || null,
            notice: notice?.hidden ? null : (notice?.textContent || null),
            dropPinPressed: document.querySelector('[data-iqai-drop-pin]')?.getAttribute('aria-pressed') || null,
            streetStageHidden: document.querySelector('[data-iqai-street-360-stage]')?.hidden !== false
          };
        })()`);
        await evaluateJson(send, `document.querySelector('[data-iqai-view="MAP"]')?.click()`);
        await sleep(400);

        await evaluateJson(send, `(() => {
          const api = window.__iqaiSpatialV2;
          document.querySelector('[data-iqai-drop-pin]')?.click();
          try { void api?.dropPin?.placeFocus?.(-73.73312, 45.52354, 'map'); } catch {}
          return true;
        })()`);
        await sleep(2500);
        await evaluateJson(send, `document.querySelector('[data-iqai-view="3D VISUAL"]')?.click()`);
        await sleep(40000);
        const visual3dLive = await evaluateJson(send, `(() => {
          const api = window.__iqaiSpatialV2;
          const visual = api?.google3d?.snapshot?.() || null;
          const notice = document.querySelector('[data-iqai-view-notice]');
          const gmErr = document.querySelector('.gm-err-container, .gm-err-message');
          const map3d = document.querySelector('gmp-map-3d');
          return {
            spatialView: document.getElementById('iqai-spatial-v2')?.dataset.iqaiSpatialView || null,
            stageHidden: document.querySelector('[data-iqai-google-3d-stage]')?.hidden !== false,
            notice: notice?.hidden ? null : (notice?.textContent || null),
            createCount: api?.mapViewCreateCount ?? null,
            open: visual?.open === true,
            stageState: visual?.stageState || null,
            maps3dLoaded: visual?.maps3dLoaded ?? null,
            steady: visual?.steady === true,
            defaultUIHidden: visual?.defaultUIHidden ?? null,
            googleError: Boolean(gmErr),
            googleErrorText: gmErr?.textContent?.slice(0, 120) || null,
            map3dSize: map3d ? { w: map3d.offsetWidth, h: map3d.offsetHeight } : null,
            stageSize: (() => {
              const el = document.querySelector('[data-iqai-google-3d-stage]');
              return el ? { w: el.offsetWidth, h: el.offsetHeight } : null;
            })()
          };
        })()`);
        if (visual3dLive?.open === true || visual3dLive?.stageHidden === false) {
          const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
          const file = path.join(OUT, 'iqai-spatial-worldview-3d-visual-1920x1080.png');
          fs.writeFileSync(file, Buffer.from(shot.data, 'base64'));
          shots.push(file);
        }
        await evaluateJson(send, `document.querySelector('[data-iqai-view="MAP"]')?.click()`);
        await sleep(900);
        await evaluateJson(send, `document.querySelector('[data-iqai-view="STREET 360"]')?.click()`);
        await sleep(8000);
        const street360Live = await evaluateJson(send, `(() => {
          const api = window.__iqaiSpatialV2;
          const street = api?.street360?.snapshot?.() || null;
          const notice = document.querySelector('[data-iqai-view-notice]');
          const gmErr = document.querySelector('.gm-err-container, .gm-err-message');
          return {
            spatialView: document.getElementById('iqai-spatial-v2')?.dataset.iqaiSpatialView || null,
            stageHidden: document.querySelector('[data-iqai-street-360-stage]')?.hidden !== false,
            notice: notice?.hidden ? null : (notice?.textContent || null),
            createCount: api?.mapViewCreateCount ?? null,
            open: street?.open === true,
            stageState: street?.stageState || null,
            available: street?.available ?? null,
            googleError: Boolean(gmErr),
            googleErrorText: gmErr?.textContent?.slice(0, 120) || null,
            stageSize: (() => {
              const el = document.querySelector('[data-iqai-street-360-stage]');
              return el ? { w: el.offsetWidth, h: el.offsetHeight } : null;
            })()
          };
        })()`);
        if (street360Live?.open === true || street360Live?.stageHidden === false || street360Live?.notice) {
          const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
          const file = path.join(OUT, 'iqai-spatial-worldview-street-360-1920x1080.png');
          fs.writeFileSync(file, Buffer.from(shot.data, 'base64'));
          shots.push(file);
        }
        await evaluateJson(send, `document.querySelector('[data-iqai-view="MAP"]')?.click()`);
        await sleep(900);
        const layers = await evaluateJson(send, `(() => {
          const api = window.__iqaiSpatialV2;
          const listed = api?.mapFoundation?.listOperationalLayers?.() || [];
          const map = api?.mapFoundation?.getWebMap?.() || api?.mapFoundation?.getView?.()?.map;
          const failed = [];
          const visit = (layer) => {
            if (!layer) return;
            const status = String(layer.loadStatus || '');
            const err = layer.loadError?.message || layer.loadError?.name || null;
            if (status === 'failed' || err) {
              failed.push({
                id: layer.id || null,
                title: layer.title || null,
                itemId: layer.portalItem?.id || null,
                loadStatus: status || null,
                error: err
              });
            }
            const children = layer.layers || layer.allLayers;
            const list = children?.toArray ? children.toArray() : (children ? [...children] : []);
            list.forEach(visit);
          };
          if (map?.layers) visit({ layers: map.layers, title: 'root' });
          return {
            webmapTitle: api?.mapFoundation?.getSnapshot?.()?.webmapTitle || null,
            webmapItemId: api?.mapFoundation?.getSnapshot?.()?.webmapItemId || null,
            layerCount: listed.length,
            layerTitles: listed.map((layer) => layer.title).filter(Boolean),
            failed
          };
        })()`);
        const askDefault = await evaluateJson(send, `(() => {
          const dock = document.querySelector('[data-iqai-slot="ask-iqai-dock"]');
          return {
            hidden: dock?.hidden !== false,
            openAttr: dock?.getAttribute('data-iqai-ask-open') || null,
            toggle: document.querySelector('[data-iqai-ask-toggle]')?.textContent?.trim() || null
          };
        })()`);
        await evaluateJson(send, `document.querySelector('[data-iqai-ask-toggle]')?.click() || false`);
        await sleep(400);
        const askOpen = await evaluateJson(send, `(() => {
          const dock = document.querySelector('[data-iqai-slot="ask-iqai-dock"]');
          return { hidden: dock?.hidden !== false, openAttr: dock?.getAttribute('data-iqai-ask-open') || null };
        })()`);
        await evaluateJson(send, `(() => {
          const close = document.querySelector('[data-iqai-ask-close]');
          if (close) close.click();
          else document.querySelector('[data-iqai-ask-toggle]')?.click();
          return document.querySelector('[data-iqai-slot="ask-iqai-dock"]')?.hidden !== false;
        })()`);
        await sleep(250);

        await evaluateJson(send, `document.querySelector('[data-iqai-time-dock-toggle]')?.click() || false`);
        await sleep(350);
        const timeDrawer = await evaluateJson(send, `(() => {
          const drawer = document.querySelector('#iqai-v2-time-drawer');
          return {
            hidden: drawer?.hidden !== false,
            copy: drawer?.innerText || '',
            clock: document.querySelector('#iqai-v2-time-value')?.textContent || ''
          };
        })()`);
        await evaluateJson(send, `window.__iqaiSpatialV2.execute('temporal.set-requested', { instant: '2026-08-01' })`, true);
        await sleep(400);
        const temporal = await evaluateJson(send, `(() => {
          const world = window.__iqaiSpatialV2?.world?.();
          return {
            requested: world?.temporal?.requested || null,
            acquisition: world?.temporal?.acquisition ?? null,
            match: world?.temporal?.match || null,
            limitation: world?.temporal?.limitation || null
          };
        })()`);
        await evaluateJson(send, `document.querySelector('[data-iqai-time-drawer-close]')?.click() || false`);

        const headerPrimary = await evaluateJson(send, `document.querySelector('[data-iqai-header-primary]')?.innerText || ''`);
        const views = await evaluateJson(send, `(() => {
          const buttons = [...document.querySelectorAll('[data-iqai-view]')].map((node) => node.getAttribute('data-iqai-view'));
          return {
            buttons,
            focusLabel: document.querySelector('[data-iqai-drop-pin]')?.textContent?.trim() || null,
            streetButton: Boolean(document.querySelector('[data-iqai-view="STREET 360"]')),
            visual3dButton: Boolean(document.querySelector('[data-iqai-view="3D VISUAL"]')),
            launchers: [...document.querySelectorAll('[data-iqai-launcher]')].map((node) => node.getAttribute('data-iqai-launcher'))
          };
        })()`);

        interactions = await evaluateJson(send, `(() => {
          const api = window.__iqaiSpatialV2;
          const view = api?.mapFoundation?.getView?.();
          const world = api?.world?.();
          return {
            zoomBefore: ${JSON.stringify(origin?.zoom ?? null)},
            zoomAfter: ${JSON.stringify(zoomAfter)},
            homeZoom: ${JSON.stringify(home?.zoom ?? null)},
            originLon: ${JSON.stringify(origin?.lon ?? null)},
            originLat: ${JSON.stringify(origin?.lat ?? null)},
            homeLon: ${JSON.stringify(home?.lon ?? null)},
            panLonBefore: ${JSON.stringify(beforePan?.lon ?? null)},
            panLonAfter: ${JSON.stringify(afterPan?.lon ?? null)},
            panLatAfter: ${JSON.stringify(afterPan?.lat ?? null)},
            panFallback: ${JSON.stringify(Boolean(afterPan?.panFallback))},
            zoomButtonPresent: ${JSON.stringify(Boolean(origin?.buttonPresent))},
            originScale: ${JSON.stringify(origin?.scale ?? null)},
            zoomedScale: ${JSON.stringify(zoomed?.scale ?? null)},
            homeScale: ${JSON.stringify(home?.scale ?? null)},
            dropPinPressed: document.querySelector('[data-iqai-drop-pin]')?.getAttribute('aria-pressed') || null,
            focusId: world?.activeFocus?.focusId || null,
            focusLon: world?.activeFocus?.geometry?.coordinates?.[0] ?? null,
            focusLat: world?.activeFocus?.geometry?.coordinates?.[1] ?? null,
            sourceAction: world?.activeFocus?.sourceAction || null,
            createCount: api?.mapViewCreateCount ?? null,
            webmapTitle: ${JSON.stringify(layers?.webmapTitle ?? null)},
            webmapItemId: ${JSON.stringify(layers?.webmapItemId ?? null)},
            layerCount: ${JSON.stringify(layers?.layerCount ?? null)},
            layerTitles: ${JSON.stringify(layers?.layerTitles ?? [])},
            failedLayers: ${JSON.stringify(layers?.failed ?? [])},
            cursorLive: ${JSON.stringify(cursorLive)},
            cursorDwell: ${JSON.stringify(cursorDwell)},
            cursorExpanded: ${JSON.stringify(cursorExpanded)},
            noFocusStreet: ${JSON.stringify(noFocusStreet)},
            street360Live: ${JSON.stringify(street360Live)},
            visual3dLive: ${JSON.stringify(visual3dLive)},
            searchBefore: ${JSON.stringify(searchBefore)},
            searchAfter: ${JSON.stringify(searchAfter)},
            askDefault: ${JSON.stringify(askDefault)},
            askOpen: ${JSON.stringify(askOpen)},
            timeDrawer: ${JSON.stringify(timeDrawer)},
            temporal: ${JSON.stringify(temporal)},
            headerPrimary: ${JSON.stringify(headerPrimary)},
            views: ${JSON.stringify(views)}
          };
        })()`);
      }

      async function capture(name) {
        const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
        const file = path.join(OUT, name);
        fs.writeFileSync(file, Buffer.from(shot.data, 'base64'));
        shots.push(file);
        return file;
      }

      await evaluateJson(send, `(() => {
        const view = window.__iqaiSpatialV2?.mapFoundation?.getView?.();
        try { view?.resize?.(); } catch {}
        return true;
      })()`);
      await sleep(400);
      await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });

      if (state === 'READY') {
        await evaluateJson(send, `document.querySelector('[data-iqai-launcher="layers"]')?.click() || false`);
        await sleep(700);
        await evaluateJson(send, `document.querySelector('[data-iqai-add-data]')?.click() || false`);
        await sleep(400);
      }
      const layersShot = await capture('iqai-spatial-worldview-layers-1920x1080.png');
      const layersOpenAtShot = await evaluateJson(send, `document.querySelector('[data-iqai-layers-drawer]')?.hidden === false`);
      const addDataAtShot = await evaluateJson(send, `(() => {
        const panel = document.querySelector('[data-iqai-add-data-panel]');
        const rows = document.querySelectorAll('[data-iqai-layers-body] .iqai-v2-layer-row').length;
        return {
          panelHidden: panel?.hidden !== false,
          note: document.querySelector('.iqai-v2-add-data__note')?.textContent || '',
          layerRows: rows
        };
      })()`);

      if (state === 'READY') {
        await evaluateJson(send, `document.querySelector('[data-iqai-drawer-close="layers"]')?.click() || false`);
        await evaluateJson(send, `(() => {
          try { void window.__iqaiSpatialV2?.mapFoundation?.goHome?.(); } catch {}
          return true;
        })()`);
        await sleep(500);
      }
      const mapFirst = await capture('iqai-spatial-worldview-1920x1080.png');

      const probe = await evaluateJson(send, `JSON.stringify({
        identity: document.querySelector('.iqai-v2-brand__product')?.textContent || null,
        montrealBrand: Boolean(document.querySelector('.iqai-v2-brand')?.textContent.includes('MONTRÉAL')),
        beginPrompt: Boolean(document.querySelector('.iqai-v2-begin:not([hidden])')),
        dropPin: Boolean(document.querySelector('[data-iqai-drop-pin]')),
        focusLabel: document.querySelector('[data-iqai-drop-pin]')?.textContent?.trim() || null,
        layersOpen: ${JSON.stringify(layersOpenAtShot)},
        layersClosedAtMapShot: document.querySelector('[data-iqai-layers-drawer]')?.hidden !== false,
        addData: ${JSON.stringify(addDataAtShot)},
        ask: Boolean(document.querySelector('[data-iqai-slot="ask-iqai-dock"]')),
        askHidden: document.querySelector('[data-iqai-slot="ask-iqai-dock"]')?.hidden !== false,
        askToggle: document.querySelector('[data-iqai-ask-toggle]')?.textContent?.trim() || null,
        timeDock: document.querySelector('#iqai-v2-time-value')?.textContent || null,
        timeDrawerHidden: document.querySelector('#iqai-v2-time-drawer')?.hidden !== false,
        search: document.querySelector('[data-iqai-search-input]')?.placeholder || null,
        inspectorClosed: document.getElementById('iqai-spatial-v2')?.dataset.iqaiSheet === 'closed',
        streetViewButton: Boolean(document.querySelector('[data-iqai-view="STREET 360"]')),
        visual3dButton: Boolean(document.querySelector('[data-iqai-view="3D VISUAL"]')),
        launchers: [...document.querySelectorAll('[data-iqai-launcher]')].map((node) => node.getAttribute('data-iqai-launcher')),
        mapViewCreateCount: window.__iqaiSpatialV2?.mapViewCreateCount ?? null,
        portalWrites: window.__iqaiSpatialV2?.portalWrites || null,
        migration: window.__iqaiSpatialV2?.migration || null,
        sheet: document.getElementById('iqai-spatial-v2')?.dataset.iqaiSheet || null,
        mapState: document.querySelector('[data-iqai-map-state]')?.getAttribute('data-iqai-map-state') || null,
        canvas: Boolean(document.querySelector('.iqai-v2-map-host canvas')),
        canvasSize: (() => {
          const canvas = document.querySelector('.iqai-v2-map-host canvas');
          return canvas ? { width: canvas.width, height: canvas.height } : null;
        })(),
        viewReady: Boolean(window.__iqaiSpatialV2?.mapFoundation?.getView?.()?.ready),
        focus: window.__iqaiSpatialV2?.world?.()?.activeFocus || null,
        authMode: ${JSON.stringify(oauthPublic.authMode || null)},
        apiKeyConfigured: ${JSON.stringify(Boolean(oauthPublic.apiKeyConfigured))},
        oauthPopup: ${JSON.stringify(Boolean(oauthPublic.popup))}
      })`);

      return { state, probe, interactions, screenshots: { mapFirst, layers: layersShot } };
    });
  } catch (error) {
    browserError = String(error?.message || error);
  }
}

if (server) {
  await new Promise((resolve) => server.close(resolve));
}

const secret = process.env.ARCGIS_API_KEY || '';
const pageHasSecret = Boolean(secret) && page.body.includes(secret);
const reportHasSecret = false;

const report = {
  generatedAt: new Date().toISOString(),
  base,
  reusedLiveServer: liveOn3047,
  pageStatus: page.status,
  preauthInjected: Boolean(preauth),
  browserPath,
  browserError,
  screenshots: shots,
  live,
  secretExposed: pageHasSecret ? 'YES' : 'NO',
  portalWrites: live?.probe?.portalWrites || live?.interactions?.portalWrites || 'NONE'
};
fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
void reportHasSecret;
if (page.status !== 200 || browserError || live?.state === 'ERROR' || pageHasSecret) process.exitCode = 1;
