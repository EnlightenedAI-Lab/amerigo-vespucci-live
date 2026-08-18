import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'artifacts', 'spatial-v2-imagery-live-acceptance');
const BASE = process.env.SPATIAL_URL?.replace(/\/$/, '') || 'http://localhost:3000';

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

function request(urlPath) {
  return new Promise((resolve, reject) => {
    const req = http.get(`${BASE}${urlPath}`, { timeout: 12000 }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve({
        status: res.statusCode,
        headers: res.headers,
        body: Buffer.concat(chunks)
      }));
    });
    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`timeout ${urlPath}`));
    });
    req.on('error', reject);
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function scrub(value) {
  return String(value || '')
    .replace(/apikey\/[A-Za-z0-9-]+/gi, 'apikey/[redacted]')
    .replace(/apikey=[^&\s"'<>]+/gi, 'apikey=[redacted]')
    .replace(/token=[^&\s]+/gi, 'token=[redacted]');
}

function secretHits(text) {
  const value = String(text || '');
  return {
    apikeyQuery: /apikey=/i.test(value),
    apikeyPath: /apikey\/[A-Za-z0-9-]+/i.test(value),
    wmsUrlEnv: /NEARMAP_WMS_URL/.test(value),
    apiKeyEnv: /NEARMAP_API_KEY/.test(value)
  };
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
  const networkUrls = [];
  const child = spawn(browserPath, [
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${userDataDir}`,
    '--window-size=1920,1080',
    '--disable-background-timer-throttling',
    '--no-first-run',
    '--no-default-browser-check',
    '--force-device-scale-factor=1',
    '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
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

    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (msg.method === 'Network.requestWillBeSent' && msg.params?.request?.url) {
          networkUrls.push(msg.params.request.url);
        }
      } catch {
        // ignore non-JSON
      }
    });

    let nextId = 10;
    const send = (method, params = {}, timeoutMs = 40000) => {
      nextId += 1;
      const id = nextId;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          ws.off('message', onMessage);
          reject(new Error(`${method} timed out`));
        }, timeoutMs);
        const onMessage = (raw) => {
          const msg = JSON.parse(raw.toString());
          if (msg.id !== id) return;
          ws.off('message', onMessage);
          clearTimeout(timer);
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
    await send('Network.enable');
    const result = await fn(send, { networkUrls });
    if (result && typeof result === 'object') {
      result.networkUrls = networkUrls.slice();
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
    try {
      fs.rmSync(userDataDir, { recursive: true, force: true });
    } catch {
      // browser profile may still be locked briefly
    }
  }
}

async function evaluateJson(send, expression, awaitPromise = false) {
  const result = await send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise
  });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.text || 'Runtime.evaluate failed');
  }
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

async function shot(send, name) {
  const captured = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  const file = path.join(OUT, `${name}.png`);
  fs.writeFileSync(file, Buffer.from(captured.data, 'base64'));
  return { name, file, bytes: Buffer.from(captured.data, 'base64').length };
}

async function shotMap(send, name) {
  try {
    const dataUrl = await evaluateJson(send, `(() => {
      const view = window.__iqaiSpatialV2?.mapFoundation?.getView?.();
      if (!view?.takeScreenshot) return Promise.resolve(null);
      return Promise.race([
        view.takeScreenshot({ format: 'jpg', quality: 70 }).then((captured) => captured?.dataUrl || null),
        new Promise((resolve) => setTimeout(() => resolve(null), 10000))
      ]);
    })()`, true);
    if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image')) {
      return { name: `${name}-map`, file: null, bytes: 0, error: 'no-map-screenshot' };
    }
    const file = path.join(OUT, `${name}-map.jpg`);
    const buf = Buffer.from(dataUrl.replace(/^data:image\/jpeg;base64,/, '').replace(/^data:image\/jpg;base64,/, ''), 'base64');
    fs.writeFileSync(file, buf);
    return { name: `${name}-map`, file, bytes: buf.length };
  } catch (error) {
    return { name: `${name}-map`, file: null, bytes: 0, error: String(error?.message || error) };
  }
}

const PIXEL_STATS = `(() => {
  const view = window.__iqaiSpatialV2?.mapFoundation?.getView?.();
  if (!view?.takeScreenshot) return Promise.resolve(null);
  return Promise.race([
    view.takeScreenshot({ format: 'jpg', quality: 60 }),
    new Promise((_, reject) => setTimeout(() => reject(new Error('pixel stats timed out')), 10000))
  ]).then((captured) => {
    const dataUrl = captured?.dataUrl || '';
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = Math.min(img.width, 480);
        canvas.height = Math.min(img.height, 270);
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
        let r = 0;
        let g = 0;
        let b = 0;
        let count = 0;
        let min = 255;
        let max = 0;
        for (let i = 0; i < pixels.length; i += 16) {
          const lum = (pixels[i] + pixels[i + 1] + pixels[i + 2]) / 3;
          r += pixels[i];
          g += pixels[i + 1];
          b += pixels[i + 2];
          min = Math.min(min, lum);
          max = Math.max(max, lum);
          count += 1;
        }
        resolve({
          width: img.width,
          height: img.height,
          mean: [Math.round(r / count), Math.round(g / count), Math.round(b / count)],
          lumMin: Math.round(min),
          lumMax: Math.round(max),
          contrast: Math.round(max - min)
        });
      };
      img.onerror = () => reject(new Error('pixel stats image failed'));
      img.src = dataUrl;
    });
  }).catch((error) => ({ error: String(error?.message || error) }));
})()`;

const DIAGNOSTICS = `(() => {
  const api = window.__iqaiSpatialV2;
  const view = api?.mapFoundation?.getView?.();
  const webmap = api?.mapFoundation?.getWebMap?.() || view?.map;
  const plane = webmap?.layers?.find?.((layer) => layer.id === 'iqai-v2-imagery-plane');
  const kids = plane?.layers?.toArray ? plane.layers.toArray() : [];
  const bases = webmap?.basemap?.baseLayers?.toArray ? webmap.basemap.baseLayers.toArray() : [];
  const authored = (webmap?.layers?.toArray ? webmap.layers.toArray() : []).map((layer, index) => ({
    index,
    id: layer.id || null,
    title: layer.title || null,
    visible: layer.visible !== false,
    opacity: layer.opacity,
    type: layer.type || layer.declaredClass || null
  }));
  const attr = document.querySelector('.esri-attribution')?.innerText || document.querySelector('.esri-attribution__sources')?.textContent || null;
  const readout = document.querySelector('[data-iqai-time-readout]')?.textContent || null;
  const groundNote = document.querySelector('[data-iqai-imagery-ground-note]')?.textContent || null;
  const provenance = document.querySelector('[data-iqai-region="provenance-slot"]')?.innerText || null;
  const resources = performance.getEntriesByType('resource').map((entry) => entry.name);
  const canvas = document.querySelector('.iqai-v2-map-host canvas, .esri-view-surface canvas');
  const layerViews = (view?.allLayerViews?.toArray ? view.allLayerViews.toArray() : []).slice(0, 20).map((lv) => ({
    id: lv.layer?.id || null,
    title: lv.layer?.title || null,
    suspended: lv.suspended === true,
    updating: lv.updating === true,
    visible: lv.visible !== false
  }));
  const tileResources = resources.filter((name) => /wms|wayback|GetMap|nearmap|tile\\//i.test(name)).slice(0, 40);
  return JSON.stringify({
    mapState: api?.mapFoundation?.getState?.() || null,
    mapViewCreateCount: api?.mapFoundation?.getMapViewCreateCount?.() || 0,
    viewReady: Boolean(view?.ready),
    canvas: canvas ? { width: canvas.width, height: canvas.height } : null,
    layerViews,
    center: view?.center ? { lon: view.center.longitude, lat: view.center.latitude } : null,
    scale: view?.scale || null,
    zoom: view?.zoom || null,
    basemapId: webmap?.basemap?.id || null,
    basemapTitle: webmap?.basemap?.title || null,
    baseLayers: bases.map((layer) => ({
      id: layer.id || null,
      title: layer.title || null,
      type: layer.type || layer.declaredClass || null,
      url: layer.url || layer.urlTemplate || null,
      loaded: Boolean(layer.loaded),
      visible: layer.visible !== false
    })),
    imageryPlane: plane ? {
      id: plane.id,
      visible: plane.visible !== false,
      opacity: plane.opacity,
      index: authored.find((item) => item.id === 'iqai-v2-imagery-plane')?.index ?? null,
      children: kids.map((layer) => ({
        id: layer.id || null,
        title: layer.title || null,
        type: layer.type || layer.declaredClass || null,
        url: layer.url || layer.urlTemplate || null,
        visible: layer.visible !== false,
        loaded: Boolean(layer.loaded)
      }))
    } : null,
    authored,
    attribution: attr,
    readout,
    groundNote,
    provenance,
    ground: api?.ground?.() || null,
    time: api?.time?.() ? {
      engineState: api.time().engineState,
      requestedDate: api.time().requestedDate,
      observationCount: api.time().observations?.length || 0,
      selectedId: api.time().selectedId,
      activeId: api.time().activeId,
      selected: api.time().selected ? {
        id: api.time().selected.id,
        productName: api.time().selected.productName,
        releaseDate: api.time().selected.releaseDate,
        acquisitionDate: api.time().selected.acquisitionDate,
        dateKindUsed: api.time().selected.dateKindUsed,
        providerId: api.time().selected.providerId
      } : null,
      active: api.time().active ? {
        id: api.time().active.id,
        productName: api.time().active.productName,
        releaseDate: api.time().active.releaseDate,
        acquisitionDate: api.time().active.acquisitionDate
      } : null,
      entitlements: api.time().entitlements,
      error: api.time().error,
      limitation: api.time().limitation
    } : null,
    secrets: {
      page: null,
      tileResourceCount: tileResources.length,
      tileResourceHosts: tileResources.map((name) => {
        try { return new URL(name).host; } catch { return 'invalid'; }
      })
    }
  });
})()`;

const liveOn3000 = await isPortOpen(3000);
if (!liveOn3000) {
  throw new Error('Spatial server is not listening on port 3000.');
}

const wmsStatus = await request('/api/spatial-v2/imagery/nearmap/wms/status');
const wmsStatusBody = JSON.parse(wmsStatus.body.toString('utf8'));
const v1 = await request('/spatial/');
const v2 = await request('/spatial-v2/');
const proxyCaps = await request('/api/spatial-v2/imagery/nearmap/wms?SERVICE=WMS&REQUEST=GetCapabilities&VERSION=1.1.1');
const proxyCapsText = proxyCaps.body.toString('utf8');

const browserPath = findBrowser();
if (!browserPath) throw new Error('Edge/Chrome not found for live visual acceptance.');
const preauth = await fetchPreauthToken();

const live = await withCdpPage(browserPath, 9253, async (send) => {
  const log = (message) => console.error(`[live] ${message}`);
  log('browser attached');
  if (preauth) {
    await send('Page.addScriptToEvaluateOnNewDocument', {
      source: `window.__MONTREAL_PREAUTH_TOKEN = ${JSON.stringify(preauth)};`
    });
  }
  await send('Page.addScriptToEvaluateOnNewDocument', {
    source: `(function() {
      const orig = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function(type, attrs) {
        if (type === 'webgl' || type === 'webgl2' || type === 'experimental-webgl') {
          attrs = Object.assign({}, attrs || {}, { preserveDrawingBuffer: true });
        }
        return orig.call(this, type, attrs);
      };
    })();`
  });
  await send('Emulation.setDeviceMetricsOverride', {
    width: 1920,
    height: 1080,
    deviceScaleFactor: 1,
    mobile: false
  });
  await send('Page.navigate', { url: `${BASE}/spatial-v2/?imagery=live` });
  log('navigated');

  let state = 'INITIALIZING';
  for (let i = 0; i < 60; i += 1) {
    state = await evaluateJson(send, 'window.__iqaiSpatialV2?.mapFoundation?.getState?.() || "WAITING"');
    if (state === 'READY' || state === 'ERROR') break;
    await sleep(1000);
  }
  if (state !== 'READY') {
    return { state, error: 'Map foundation did not become READY' };
  }
  log(`map ${state}`);
  for (let i = 0; i < 40; i += 1) {
    const painted = await evaluateJson(send, `(() => {
      const view = window.__iqaiSpatialV2?.mapFoundation?.getView?.();
      const canvas = document.querySelector('.iqai-v2-map-host canvas, .esri-view-surface canvas');
      return Boolean(view?.ready && canvas && canvas.width > 8);
    })()`);
    if (painted) break;
    await sleep(500);
  }
  let home = null;
  for (let i = 0; i < 12; i += 1) {
    try {
      home = await evaluateJson(send, `(() => {
        const api = window.__iqaiSpatialV2;
        const view = api?.mapFoundation?.getView?.();
        if (!view) return Promise.resolve({ ok: false });
        return api.mapFoundation.goHome().then(() => {
          const lon = view.center?.longitude;
          const lat = view.center?.latitude;
          return {
            ok: lon >= -74.3 && lon <= -73.2 && lat >= 45.2 && lat <= 45.9,
            lon,
            lat,
            scale: view.scale
          };
        });
      })()`, true);
    } catch (error) {
      home = { ok: false, error: String(error?.message || error) };
    }
    if (home?.ok) break;
    await sleep(750);
  }
  log(`home ${home?.ok ? 'ok' : 'miss'} ${home?.lon || ''} ${home?.lat || ''}`);
  await sleep(2500);
  for (let i = 0; i < 20; i += 1) {
    const booted = await evaluateJson(send, 'Boolean(window.__iqaiSpatialV2?.setGroundMode && document.querySelector("[data-iqai-plugin=imagery]"))');
    if (booted) break;
    await sleep(500);
  }

  await evaluateJson(send, `(() => {
    document.querySelector('[data-iqai-plugin="imagery"]')?.click();
    return true;
  })()`);
  await sleep(400);

  const before = await evaluateJson(send, DIAGNOSTICS);
  log('authored diagnostics');
  const authoredShot = await shot(send, '00-authored-home');
  const authoredMapShot = await shotMap(send, '00-authored-home');
  const authoredPixels = await evaluateJson(send, PIXEL_STATS, true).catch((error) => ({ error: String(error?.message || error) }));
  const nearmap = await evaluateJson(send, `(() => {
    const api = window.__iqaiSpatialV2;
    return api.setGroundMode('NEARMAP').then(() => api.ground()).catch((error) => ({
      applyState: api.ground()?.applyState,
      error: String(error?.message || error)
    }));
  })()`, true);
  for (let i = 0; i < 20; i += 1) {
    const wms = await evaluateJson(send, `(() => {
      const view = window.__iqaiSpatialV2?.mapFoundation?.getView?.();
      const list = view?.allLayerViews?.toArray ? view.allLayerViews.toArray() : [];
      const lv = list.find((item) => item.layer?.id === 'iqai-ground-nearmap-wms');
      return lv ? { suspended: lv.suspended === true, updating: lv.updating === true } : null;
    })()`);
    if (wms && wms.suspended !== true && wms.updating !== true) break;
    await sleep(500);
  }
  await sleep(2000);
  const afterNearmap = await evaluateJson(send, DIAGNOSTICS);
  const nearmapShot = await shot(send, '01-nearmap-ground');
  const nearmapMapShot = await shotMap(send, '01-nearmap-ground');
  const nearmapPixels = await evaluateJson(send, PIXEL_STATS, true).catch((error) => ({ error: String(error?.message || error) }));
  log(`nearmap ${nearmap?.applyState || nearmapPixels?.error || 'done'}`);

  const pageSecrets = await evaluateJson(send, `(() => {
    const html = document.documentElement?.innerHTML || '';
    const text = document.body?.innerText || '';
    const resources = performance.getEntriesByType('resource').map((entry) => entry.name).join('\\n');
    const readout = document.querySelector('[data-iqai-time-readout]')?.textContent || '';
    const provenance = document.querySelector('[data-iqai-region="provenance-slot"]')?.innerText || '';
    return JSON.stringify({ html, text, resources, readout, provenance });
  })()`);

  const discover = await evaluateJson(send, `(() => {
    const api = window.__iqaiSpatialV2;
    api.setTimeEngineOptions({ aoiMode: 'viewport', requestedDate: '2018-06-15', providerFilter: 'wayback' });
    return api.discoverImageryTime().then(() => api.time()).catch((error) => ({
      engineState: api.time()?.engineState,
      error: String(error?.message || error),
      observations: api.time()?.observations || []
    }));
  })()`, true);

  const picked = await evaluateJson(send, `(() => {
    const api = window.__iqaiSpatialV2;
    const observations = api.time()?.observations || [];
    const pick = observations.find((item) => String(item.releaseDate || '').startsWith('2018'))
      || observations.find((item) => String(item.releaseDate || '').startsWith('2020'))
      || observations.find((item) => String(item.releaseDate || '') <= '2020-12-31')
      || api.time()?.selected;
    if (!pick?.id) return Promise.resolve({ error: 'No historical Wayback release found' });
    return api.selectObservation(pick.id).then(() => api.activateObservation(pick.id)).then(() => api.time()).catch((error) => ({
      engineState: api.time()?.engineState,
      error: String(error?.message || error),
      selectedId: api.time()?.selectedId,
      activeId: api.time()?.activeId
    }));
  })()`, true);
  for (let i = 0; i < 20; i += 1) {
    const timeLv = await evaluateJson(send, `(() => {
      const view = window.__iqaiSpatialV2?.mapFoundation?.getView?.();
      const list = view?.allLayerViews?.toArray ? view.allLayerViews.toArray() : [];
      const lv = list.find((item) => item.layer?.id === 'iqai-v2-imagery-time-observation');
      return lv ? { suspended: lv.suspended === true, updating: lv.updating === true } : null;
    })()`);
    if (timeLv && timeLv.suspended !== true && timeLv.updating !== true) break;
    await sleep(500);
  }
  await sleep(1500);
  const afterActivate = await evaluateJson(send, DIAGNOSTICS);
  const activateShot = await shot(send, '02-wayback-activate');
  const activateMapShot = await shotMap(send, '02-wayback-activate');
  const activatePixels = await evaluateJson(send, PIXEL_STATS, true).catch((error) => ({ error: String(error?.message || error) }));
  log(`activate ${picked?.activeId || picked?.error || 'done'}`);

  const prev = await evaluateJson(send, `(() => {
    const api = window.__iqaiSpatialV2;
    return api.previousObservation().then(() => api.time()).catch((error) => ({
      engineState: api.time()?.engineState,
      error: String(error?.message || error),
      activeId: api.time()?.activeId
    }));
  })()`, true);
  await sleep(2500);
  const afterPrev = await evaluateJson(send, DIAGNOSTICS);
  const prevShot = await shot(send, '03-wayback-prev');
  const prevMapShot = await shotMap(send, '03-wayback-prev');
  const prevPixels = await evaluateJson(send, PIXEL_STATS, true).catch((error) => ({ error: String(error?.message || error) }));

  const next = await evaluateJson(send, `(() => {
    const api = window.__iqaiSpatialV2;
    return api.nextObservation().then(() => api.time()).catch((error) => ({
      engineState: api.time()?.engineState,
      error: String(error?.message || error),
      activeId: api.time()?.activeId
    }));
  })()`, true);
  await sleep(2500);
  const afterNext = await evaluateJson(send, DIAGNOSTICS);
  const nextShot = await shot(send, '04-wayback-next');
  const nextMapShot = await shotMap(send, '04-wayback-next');
  const nextPixels = await evaluateJson(send, PIXEL_STATS, true).catch((error) => ({ error: String(error?.message || error) }));

  return {
    state,
    home,
    before,
    authoredShot,
    authoredMapShot,
    authoredPixels,
    nearmap,
    afterNearmap,
    nearmapShot,
    nearmapMapShot,
    nearmapPixels,
    pageSecrets,
    discover,
    picked,
    afterActivate,
    activateShot,
    activateMapShot,
    activatePixels,
    prev,
    afterPrev,
    prevShot,
    prevMapShot,
    prevPixels,
    next,
    afterNext,
    nextShot,
    nextMapShot,
    nextPixels
  };
});

function summarizeTime(block) {
  const time = block?.time || {};
  return {
    engineState: time.engineState,
    count: time.observationCount,
    selected: time.selected?.productName || time.selectedId || null,
    selectedRelease: time.selected?.releaseDate || null,
    active: time.active?.productName || time.activeId || null,
    activeRelease: time.active?.releaseDate || null,
    error: time.error || null
  };
}

const secretScan = {
  proxyCapabilities: secretHits(proxyCapsText),
  page: secretHits(live?.pageSecrets?.html),
  pageText: secretHits(live?.pageSecrets?.text),
  resources: secretHits(live?.pageSecrets?.resources),
  readout: secretHits(live?.pageSecrets?.readout),
  provenance: secretHits(live?.pageSecrets?.provenance),
  wmsStatusBody: secretHits(JSON.stringify(wmsStatusBody)),
  network: secretHits((live?.networkUrls || []).join('\n'))
};

const networkHosts = [...new Set((live?.networkUrls || []).map((url) => {
  try {
    return new URL(url).host;
  } catch {
    return 'invalid';
  }
}))];

const report = {
  generatedAt: new Date().toISOString(),
  base: BASE,
  routes: {
    v1: { status: v1.status, hasV1Runtime: v1.body.toString('utf8').includes('/spatial/spatial.js') },
    v2: { status: v2.status, hasV2Shell: v2.body.toString('utf8').includes('iqai-spatial-v2') },
    wmsStatus: { status: wmsStatus.status, entitlement: wmsStatusBody.entitlement, historical: wmsStatusBody.historical, defaultLayer: wmsStatusBody.defaultLayer },
    proxyCaps: {
      status: proxyCaps.status,
      hasUpstreamHost: /api\.nearmap\.com\/wms/i.test(proxyCapsText),
      hasSecret: /apikey\/(?!\[redacted\])[A-Za-z0-9-]+/i.test(proxyCapsText)
    }
  },
  secretScan,
  live: live && {
    mapState: live.state,
    home: live.home || null,
    pixels: {
      authored: live.authoredPixels || null,
      nearmap: live.nearmapPixels || null,
      activate: live.activatePixels || null,
      previous: live.prevPixels || null,
      next: live.nextPixels || null
    },
    nearmapApply: {
      applyState: live.nearmap?.applyState || live.afterNearmap?.ground?.applyState,
      error: live.nearmap?.error || live.afterNearmap?.ground?.error || null,
      mode: live.afterNearmap?.ground?.currentMode,
      dateKind: live.afterNearmap?.ground?.receipt?.observation?.dateKindUsed || null,
      acquisitionDate: live.afterNearmap?.ground?.receipt?.observation?.acquisitionDate ?? null,
      basemapId: live.afterNearmap?.basemapId,
      baseLayers: live.afterNearmap?.baseLayers,
      attribution: live.afterNearmap?.attribution,
      camera: { center: live.afterNearmap?.center, scale: live.afterNearmap?.scale }
    },
    discover: summarizeTime({ time: {
      engineState: live.discover?.engineState,
      observationCount: live.discover?.observations?.length,
      selectedId: live.discover?.selectedId,
      selected: live.discover?.selected,
      activeId: live.discover?.activeId,
      error: live.discover?.error
    } }),
    activate: summarizeTime(live.afterActivate),
    previous: summarizeTime(live.afterPrev),
    next: summarizeTime(live.afterNext),
    mapViewCreateCount: live.afterNext?.mapViewCreateCount || live.afterNearmap?.mapViewCreateCount,
    canvas: live.afterNearmap?.canvas || live.before?.canvas,
    viewReady: live.afterNearmap?.viewReady,
    tileHosts: live.afterNearmap?.secrets?.tileResourceHosts || live.afterActivate?.secrets?.tileResourceHosts,
    networkHosts,
    layerViews: live.afterActivate?.layerViews || live.afterNearmap?.layerViews,
    cameraBefore: live.before?.center,
    cameraAfterNearmap: live.afterNearmap?.center,
    cameraAfterActivate: live.afterActivate?.center,
    imageryPlane: live.afterActivate?.imageryPlane,
    authoredLayerCount: live.afterActivate?.authored?.length || null,
    screenshots: [
      live.authoredShot,
      live.authoredMapShot,
      live.nearmapShot,
      live.nearmapMapShot,
      live.activateShot,
      live.activateMapShot,
      live.prevShot,
      live.prevMapShot,
      live.nextShot,
      live.nextMapShot
    ].filter(Boolean),
    errors: {
      discover: live.discover?.error || null,
      activate: live.picked?.error || live.afterActivate?.time?.error || null,
      prev: live.prev?.error || null,
      next: live.next?.error || null,
      live: live.error || null
    }
  }
};

fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'qa-report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify({
  ...report,
  live: report.live && {
    ...report.live,
    // keep screenshots paths; drop huge authored lists from console
    authoredLayerCount: report.live.authoredLayerCount
  }
}, null, 2));
