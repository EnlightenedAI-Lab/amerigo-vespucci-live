import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'artifacts', 'spatial-v2-wayback-display-repair-v1');
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
  try { return fs.existsSync(file); } catch { return false; }
}

function findBrowser() {
  return [
    process.env.EDGE_PATH,
    process.env.CHROME_PATH,
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'
  ].filter(Boolean).find((file) => exists(file)) || null;
}

function isPortOpen(port) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ port, host: '127.0.0.1' });
    socket.once('connect', () => { socket.end(); resolve(true); });
    socket.once('error', () => resolve(false));
    socket.setTimeout(1500, () => { socket.destroy(); resolve(false); });
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

async function fetchPreauthToken() {
  const username = process.env.ARCGIS_USERNAME;
  const password = process.env.ARCGIS_PASSWORD;
  const portal = (process.env.ARCGIS_PORTAL_URL || 'https://www.arcgis.com').replace(/\/$/, '');
  if (!username || !password) return null;
  try {
    const params = new URLSearchParams({
      username, password, client: 'requestip', expiration: '60', f: 'json'
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

async function withCdpPage(browserPath, debugPort, fn) {
  fs.mkdirSync(OUT, { recursive: true });
  const userDataDir = fs.mkdtempSync(path.join(OUT, 'browser-'));
  const networkUrls = [];
  const networkFinished = [];
  const child = spawn(browserPath, [
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${userDataDir}`,
    '--window-size=1920,1080',
    '--no-first-run',
    '--no-default-browser-check',
    '--force-device-scale-factor=1',
    '--disable-background-timer-throttling',
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
      ws.once('open', () => { clearTimeout(timer); resolve(); });
      ws.once('error', (error) => { clearTimeout(timer); reject(error); });
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
    const requestIdToUrl = new Map();
    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (msg.method === 'Network.requestWillBeSent' && msg.params?.request?.url) {
          networkUrls.push(msg.params.request.url);
          requestIdToUrl.set(msg.params.requestId, msg.params.request.url);
        }
        if (msg.method === 'Network.responseReceived' && msg.params?.response) {
          const url = msg.params.response.url || requestIdToUrl.get(msg.params.requestId);
          if (url && /wayback|World_Imagery|tile/i.test(url)) {
            networkFinished.push({
              url,
              status: msg.params.response.status,
              mime: msg.params.response.mimeType || null
            });
          }
        }
      } catch { /* ignore */ }
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
        ws.send(JSON.stringify({ id, method, sessionId: attached.sessionId, params }));
      });
    };
    await send('Page.enable');
    await send('Runtime.enable');
    await send('Network.enable');
    const result = await fn(send, { networkUrls, networkFinished });
    if (result && typeof result === 'object') {
      result.networkUrls = networkUrls.slice();
      result.networkFinished = networkFinished.slice();
    }
    ws.close();
    return result;
  } finally {
    try { child.kill(); } catch { /* exited */ }
    if (child.pid) spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch { /* locked */ }
  }
}

async function evaluateJson(send, expression, awaitPromise = false) {
  const result = await send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise
  });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.text || result.exceptionDetails.exception?.description || 'Runtime.evaluate failed');
  }
  const value = result.result?.value;
  if (typeof value === 'string') {
    try { return JSON.parse(value); } catch { return value; }
  }
  return value;
}

const PIXEL_STATS = `(() => {
  const view = window.__iqaiSpatialV2?.mapFoundation?.getView?.();
  if (!view?.takeScreenshot) return Promise.resolve({ error: 'no takeScreenshot' });
  return Promise.race([
    view.takeScreenshot({ format: 'png' }),
    new Promise((_, reject) => setTimeout(() => reject(new Error('takeScreenshot timed out')), 12000))
  ]).then((captured) => {
    const dataUrl = captured?.dataUrl || '';
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const pixels = imageData.data;
        let r = 0; let g = 0; let b = 0; let a = 0; let count = 0; let min = 255; let max = 0;
        let opaque = 0;
        for (let i = 0; i < pixels.length; i += 16) {
          const lum = (pixels[i] + pixels[i + 1] + pixels[i + 2]) / 3;
          r += pixels[i]; g += pixels[i + 1]; b += pixels[i + 2]; a += pixels[i + 3];
          min = Math.min(min, lum); max = Math.max(max, lum); count += 1;
          if (pixels[i + 3] > 8) opaque += 1;
        }
        resolve({
          dataUrl,
          width: img.width,
          height: img.height,
          mean: [Math.round(r / count), Math.round(g / count), Math.round(b / count), Math.round(a / count)],
          lumMin: Math.round(min),
          lumMax: Math.round(max),
          contrast: Math.round(max - min),
          opaqueShare: count ? opaque / count : 0,
          byteLength: pixels.length
        });
      };
      img.onerror = () => reject(new Error('stats image failed'));
      img.src = dataUrl;
    });
  }).catch((error) => ({ error: String(error?.message || error) }));
})()`;

const PROBE = `(() => {
  const api = window.__iqaiSpatialV2;
  const view = api?.mapFoundation?.getView?.();
  const webmap = api?.mapFoundation?.getWebMap?.() || view?.map;
  const all = webmap?.allLayers?.toArray ? webmap.allLayers.toArray() : [];
  const lvs = view?.allLayerViews?.toArray ? view.allLayerViews.toArray() : [];
  const observation = all.find((layer) => layer.id === 'iqai-v2-imagery-time-observation');
  const probe = all.find((layer) => layer.id === 'iqai-v2-wayback-probe');
  const plane = all.find((layer) => layer.id === 'iqai-v2-imagery-plane');
  const canvas = document.querySelector('.iqai-v2-map-host canvas, .esri-view-surface canvas');
  const cs = canvas ? getComputedStyle(canvas) : null;
  const resources = performance.getEntriesByType('resource').map((entry) => entry.name);
  const waybackResources = resources.filter((name) => /wayback\\.maptiles/i.test(name));
  function layerInfo(layer) {
    if (!layer) return null;
    return {
      id: layer.id || null,
      title: layer.title || null,
      type: layer.type || layer.declaredClass || null,
      visible: layer.visible !== false,
      opacity: layer.opacity,
      loaded: Boolean(layer.loaded),
      loadStatus: layer.loadStatus || null,
      loadError: layer.loadError ? String(layer.loadError.message || layer.loadError) : null,
      parent: layer.parent?.id || layer.parent?.title || null,
      url: layer.urlTemplate || layer.url || null,
      spatialReference: layer.spatialReference?.wkid || layer.tileInfo?.spatialReference?.wkid || null,
      tileSize: layer.tileInfo?.size?.[0] || layer.tileInfo?.lods?.[0]?.resolution || null
    };
  }
  function lvInfo(layerId) {
    const lv = lvs.find((item) => item.layer?.id === layerId);
    if (!lv) return null;
    return {
      suspended: lv.suspended === true,
      updating: lv.updating === true,
      visible: lv.visible !== false,
      type: lv.declaredClass || lv.type || null
    };
  }
  return JSON.stringify({
    viewReady: Boolean(view?.ready),
    viewSr: view?.spatialReference?.wkid || null,
    scale: view?.scale || null,
    center: view?.center ? { lon: view.center.longitude, lat: view.center.latitude } : null,
    assetsPath: window.esriConfig?.assetsPath || null,
    canvas: canvas ? {
      width: canvas.width,
      height: canvas.height,
      cssWidth: cs?.width,
      cssHeight: cs?.height,
      opacity: cs?.opacity,
      visibility: cs?.visibility,
      display: cs?.display,
      zIndex: cs?.zIndex
    } : null,
    time: api?.time?.() ? {
      engineState: api.time().engineState,
      selectedId: api.time().selectedId,
      activeId: api.time().activeId,
      displayConfirmed: api.time().displayConfirmed ?? null,
      layerAttached: api.time().layerAttached ?? null,
      layerLoaded: api.time().layerLoaded ?? null
    } : null,
    observation: layerInfo(observation),
    observationLv: lvInfo('iqai-v2-imagery-time-observation'),
    probe: layerInfo(probe),
    probeLv: lvInfo('iqai-v2-wayback-probe'),
    portalLv: lvInfo('iqai-v2-wayback-portal-probe'),
    osmLv: lvInfo('iqai-v2-osm-probe'),
    layerViewErrors: window.__iqaiLayerViewErrors || [],
    viewFatal: view?.fatalError ? String(view.fatalError.message || view.fatalError) : null,
    viewUpdating: view?.updating === true,
    plane: layerInfo(plane),
    planeLv: lvInfo('iqai-v2-imagery-plane'),
    operational: (webmap?.layers?.toArray ? webmap.layers.toArray() : []).map((layer, index) => ({
      index,
      id: layer.id || null,
      title: layer.title || null,
      type: layer.type || null,
      visible: layer.visible !== false
    })),
    waybackResourceCount: waybackResources.length,
    waybackSample: waybackResources.slice(0, 5)
  });
})()`;

const EXPERIMENT = `(() => {
  const api = window.__iqaiSpatialV2;
  const view = api?.mapFoundation?.getView?.();
  const webmap = api?.mapFoundation?.getWebMap?.() || view?.map;
  if (!view || !webmap) return Promise.resolve({ error: 'no view' });
  const importArc = async (modPath) => {
    const mod = await window.$arcgis.import(modPath);
    return mod?.default || mod;
  };
  return (async () => {
    const WebTileLayer = await importArc('@arcgis/core/layers/WebTileLayer.js');
    const TileInfo = await importArc('@arcgis/core/layers/support/TileInfo.js');
    const existing = webmap.allLayers?.find?.((layer) => layer.id === 'iqai-v2-wayback-probe');
    if (existing) webmap.layers.remove(existing);
    const urlTemplate = 'https://wayback.maptiles.arcgis.com/arcgis/rest/services/World_Imagery/WMTS/1.0.0/default028mm/MapServer/tile/13161/{level}/{row}/{col}';
    async function waitLv(layer, ms = 8000) {
      try {
        const layerView = await Promise.race([
          view.whenLayerView(layer),
          new Promise((_, reject) => setTimeout(() => reject(new Error('whenLayerView timeout')), ms))
        ]);
        return { hasLayerView: true, suspended: layerView?.suspended === true, whenError: null };
      } catch (error) {
        return { hasLayerView: false, suspended: null, whenError: String(error?.message || error) };
      }
    }
    function addTop(layer) {
      const runtimeIndex = webmap.layers.findIndex((item) => item?.id === 'iqai-v2-runtime-plane');
      if (runtimeIndex >= 0) webmap.layers.add(layer, runtimeIndex);
      else webmap.layers.add(layer);
    }
    const layer = new WebTileLayer({
      id: 'iqai-v2-wayback-probe',
      title: 'Wayback probe 2018-01-08',
      urlTemplate,
      tileInfo: TileInfo.create(),
      visible: true,
      opacity: 1,
      listMode: 'show'
    });
    addTop(layer);
    await layer.load().catch(() => {});
    const webTile = {
      added: Boolean(webmap.allLayers.find((item) => item.id === 'iqai-v2-wayback-probe')),
      loaded: Boolean(layer.loaded),
      loadStatus: layer.loadStatus || null,
      loadError: layer.loadError ? String(layer.loadError.message || layer.loadError) : null,
      urlTemplate: layer.urlTemplate,
      ...(await waitLv(layer))
    };
    let portal = null;
    try {
      const Layer = await importArc('@arcgis/core/layers/Layer.js');
      const portalLayer = await Layer.fromPortalItem({
        portalItem: { id: 'd722c8eca54d4adb8087870f5ca0ef78' }
      });
      portalLayer.id = 'iqai-v2-wayback-portal-probe';
      portalLayer.visible = true;
      portalLayer.opacity = 1;
      addTop(portalLayer);
      await portalLayer.load().catch(() => {});
      portal = {
        type: portalLayer.type || portalLayer.declaredClass || null,
        loaded: Boolean(portalLayer.loaded),
        loadStatus: portalLayer.loadStatus || null,
        loadError: portalLayer.loadError ? String(portalLayer.loadError.message || portalLayer.loadError) : null,
        url: portalLayer.urlTemplate || portalLayer.url || null,
        ...(await waitLv(portalLayer, 12000))
      };
    } catch (error) {
      portal = { error: String(error?.message || error) };
    }
    let osm = null;
    try {
      const OpenStreetMapLayer = await importArc('@arcgis/core/layers/OpenStreetMapLayer.js');
      const osmLayer = new OpenStreetMapLayer({ id: 'iqai-v2-osm-probe', visible: true, opacity: 1 });
      addTop(osmLayer);
      osm = {
        loaded: Boolean(osmLayer.loaded),
        ...(await waitLv(osmLayer, 8000))
      };
    } catch (error) {
      osm = { error: String(error?.message || error) };
    }
    return { webTile, portal, osm, layerViewErrors: window.__iqaiLayerViewErrors || [] };
  })();
})()`;

function writeShot(name, stats) {
  if (!stats?.dataUrl || !String(stats.dataUrl).startsWith('data:image')) {
    return { name, file: null, error: stats?.error || 'no-dataUrl', ...stats, dataUrl: undefined };
  }
  const file = path.join(OUT, `${name}.png`);
  const buf = Buffer.from(String(stats.dataUrl).replace(/^data:image\/png;base64,/, ''), 'base64');
  fs.writeFileSync(file, buf);
  const { dataUrl, ...rest } = stats;
  return { name, file, bytes: buf.length, ...rest };
}

async function shotPage(send, name) {
  const captured = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  const file = path.join(OUT, `${name}.png`);
  const buf = Buffer.from(captured.data, 'base64');
  fs.writeFileSync(file, buf);
  return { name, file, bytes: buf.length };
}

if (!(await isPortOpen(3000))) throw new Error('Spatial server is not listening on port 3000.');
const browserPath = findBrowser();
if (!browserPath) throw new Error('Edge/Chrome not found.');
const preauth = await fetchPreauthToken();

const live = await withCdpPage(browserPath, 9267, async (send) => {
  const log = (message) => console.error(`[diagnose] ${message}`);
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
    width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false
  });
  await send('Page.navigate', { url: `${BASE}/spatial-v2/?imagery=wayback-diagnose` });
  let state = 'INITIALIZING';
  for (let i = 0; i < 60; i += 1) {
    state = await evaluateJson(send, 'window.__iqaiSpatialV2?.mapFoundation?.getState?.() || "WAITING"');
    if (state === 'READY' || state === 'ERROR') break;
    await sleep(1000);
  }
  if (state !== 'READY') return { state, error: 'Map foundation did not become READY' };
  log('READY');
  await evaluateJson(send, `(() => {
    window.__iqaiLayerViewErrors = [];
    const view = window.__iqaiSpatialV2?.mapFoundation?.getView?.();
    view?.on?.('layerview-create-error', (event) => {
      window.__iqaiLayerViewErrors.push({
        id: event.layer?.id || null,
        title: event.layer?.title || null,
        type: event.layer?.type || null,
        error: String(event.error?.message || event.error || 'layerview-create-error')
      });
    });
    const api = window.__iqaiSpatialV2;
    api.mapFoundation.goHome();
    return true;
  })()`);
  await sleep(2000);
  const before = await evaluateJson(send, PROBE);
  const beforeStats = writeShot('00-fresh-home', await evaluateJson(send, PIXEL_STATS, true));
  log(`fresh canvas=${JSON.stringify(before?.canvas)} lvErrors will follow`);

  const experiment = await evaluateJson(send, EXPERIMENT, true);
  await sleep(4000);
  const afterDirect = await evaluateJson(send, PROBE);
  const directStats = writeShot('01-direct-before-engine', await evaluateJson(send, PIXEL_STATS, true));
  const directPage = await shotPage(send, '01-direct-before-engine-page');
  const lvErrors = await evaluateJson(send, 'JSON.stringify(window.__iqaiLayerViewErrors || [])');
  log(`direct ${JSON.stringify(experiment)} lv=${JSON.stringify(afterDirect?.probeLv)} waybackRes=${afterDirect?.waybackResourceCount} errors=${JSON.stringify(lvErrors)}`);

  await evaluateJson(send, `(() => {
    document.querySelector('[data-iqai-plugin="imagery"]')?.click();
    return true;
  })()`);
  await sleep(800);
  const discover = await evaluateJson(send, `(() => {
    const api = window.__iqaiSpatialV2;
    api.setTimeEngineOptions({ aoiMode: 'viewport', requestedDate: '2018-06-15', providerFilter: 'wayback' });
    return api.discoverImageryTime().then(() => {
      const observations = api.time()?.observations || [];
      const pick = observations.find((item) => String(item.releaseDate || '').startsWith('2018'))
        || api.time()?.selected;
      return api.selectObservation(pick.id).then(() => api.activateObservation(pick.id)).then(() => ({
        count: observations.length,
        id: api.time()?.activeId || null,
        release: api.time()?.active?.releaseDate || null,
        url: api.time()?.active?.sourceIdentity?.itemURL || null
      }));
    });
  })()`, true);
  await sleep(4000);
  const afterEngine = await evaluateJson(send, PROBE);
  const engineStats = writeShot('02-engine-after-direct', await evaluateJson(send, PIXEL_STATS, true));
  const enginePage = await shotPage(send, '02-engine-after-direct-page');
  log(`engine lv=${JSON.stringify(afterEngine?.observationLv)} waybackRes=${afterEngine?.waybackResourceCount}`);

  return {
    state,
    discover,
    before,
    beforeStats,
    lvErrors,
    afterEngine,
    engineStats,
    enginePage,
    experiment,
    afterDirect,
    directStats,
    directPage
  };
});

function waybackHosts(urls) {
  return [...new Set((urls || []).filter((url) => /wayback\\.maptiles/i.test(url)).map((url) => {
    try { return new URL(url).host; } catch { return 'invalid'; }
  }))];
}

const report = {
  generatedAt: new Date().toISOString(),
  state: live?.state,
  error: live?.error || null,
  discover: live?.discover || null,
  experiment: live?.experiment || null,
  engine: {
    probe: live?.afterEngine || null,
    pixels: live?.engineStats || null,
    page: live?.enginePage || null
  },
  direct: {
    probe: live?.afterDirect || null,
    pixels: live?.directStats || null,
    page: live?.directPage || null
  },
  fresh: live?.before || null,
  freshPixels: live?.beforeStats || null,
  layerViewErrors: live?.lvErrors || [],
  black: live?.blackStats || null,
  waybackRequestHosts: waybackHosts(live?.networkUrls),
  waybackResponses: (live?.networkFinished || []).filter((item) => /wayback\\.maptiles/i.test(item.url)).slice(0, 12)
};

fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'diagnose-report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
