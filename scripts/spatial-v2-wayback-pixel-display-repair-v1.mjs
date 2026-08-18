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
    const send = (method, params = {}, timeoutMs = 90000) => {
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

async function evaluateJson(send, expression, awaitPromise = false, timeoutMs = 90000) {
  const result = await send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise
  }, timeoutMs);
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
  const surface = document.querySelector('.iqai-v2-map-host .esri-view-surface');
  const cs = canvas ? getComputedStyle(canvas) : null;
  const surfaceCs = surface ? getComputedStyle(surface) : null;
  const runtime = all.find((layer) => layer.id === 'iqai-v2-runtime-plane');
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
    cssInjected: Boolean(document.getElementById('iqai-v2-map-foundation-surface')),
    runtimeVisible: runtime ? runtime.visible !== false : null,
    canvas: canvas ? {
      width: canvas.width,
      height: canvas.height,
      cssWidth: cs?.width,
      cssHeight: cs?.height,
      opacity: cs?.opacity,
      visibility: cs?.visibility,
      display: cs?.display,
      zIndex: cs?.zIndex,
      boxSizing: cs?.boxSizing,
      surfaceBoxSizing: surfaceCs?.boxSizing
    } : null,
    time: api?.time?.() ? {
      engineState: api.time().engineState,
      selectedId: api.time().selectedId,
      activeId: api.time().activeId,
      displayConfirmed: api.time().displayConfirmed ?? null,
      displayState: api.time().displayState || null,
      layerAttached: api.time().layerAttached ?? null,
      layerLoaded: api.time().layerLoaded ?? null,
      layerViewReady: api.time().layerViewReady ?? null,
      networkConfirmed: api.time().networkConfirmed ?? null,
      displayEvidence: api.time().displayEvidence || null,
      acquisitionDate: api.time().active?.acquisitionDate ?? api.time().selected?.acquisitionDate ?? null,
      releaseDate: api.time().active?.releaseDate ?? api.time().selected?.releaseDate ?? null,
      dateKindUsed: api.time().active?.dateKindUsed || api.time().selected?.dateKindUsed || null
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

function differs(a, b) {
  if (!a || !b || a.error || b.error) return false;
  const meanDelta = [0, 1, 2].reduce((sum, i) => sum + Math.abs((a.mean?.[i] || 0) - (b.mean?.[i] || 0)), 0);
  return meanDelta >= 18 || Math.abs((a.contrast || 0) - (b.contrast || 0)) >= 12;
}

function painted(stats) {
  return Boolean(stats) && !stats.error && Number(stats.opaqueShare) >= 0.15 && Number(stats.contrast) >= 16;
}

if (!(await isPortOpen(3000))) throw new Error('Spatial server is not listening on port 3000.');
const browserPath = findBrowser();
if (!browserPath) throw new Error('Edge/Chrome not found.');
const preauth = await fetchPreauthToken();

const live = await withCdpPage(browserPath, 9271, async (send) => {
  const log = (message) => console.error(`[repair] ${message}`);
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
  await send('Page.navigate', { url: `${BASE}/spatial-v2/?imagery=wayback-repair` });
  let state = 'INITIALIZING';
  for (let i = 0; i < 70; i += 1) {
    state = await evaluateJson(send, 'window.__iqaiSpatialV2?.mapFoundation?.getState?.() || "WAITING"');
    if (state === 'READY' || state === 'ERROR') break;
    await sleep(1000);
  }
  if (state !== 'READY') {
    const snap = await evaluateJson(send, `(() => {
      const s = window.__iqaiSpatialV2?.mapFoundation?.getSnapshot?.();
      return s ? JSON.stringify(s) : null;
    })()`).catch(() => null);
    return { state, error: 'Map foundation did not become READY', snap };
  }
  log('READY');
  await evaluateJson(send, `(() => {
    const api = window.__iqaiSpatialV2;
    api.mapFoundation.goHome();
    api.commandCenter.setExperience('NORMAL');
    api.commandCenter.setActiveCapability('imagery');
    api.commandCenter.setImageryView('HISTORY');
    document.querySelector('[data-iqai-plugin="imagery"]')?.click();
    return true;
  })()`);
  await sleep(2000);

  const operator = await evaluateJson(send, `(() => {
    const api = window.__iqaiSpatialV2;
    api.setTimeEngineOptions({ aoiMode: 'viewport', requestedDate: '2018-06-15', providerFilter: 'wayback' });
    const date = document.querySelector('[data-iqai-operator-imagery-date]');
    if (date) {
      date.value = '2018-06-15';
      date.dispatchEvent(new Event('input', { bubbles: true }));
      date.dispatchEvent(new Event('change', { bubbles: true }));
    }
    return api.discoverImageryTime({
      aoiMode: 'viewport',
      requestedDate: '2018-06-15',
      providerFilter: 'wayback'
    }).then(() => {
      const time = api.time();
      return {
        engineState: time.engineState,
        selectedId: time.selectedId,
        activeId: time.activeId,
        displayState: time.displayState,
        displayConfirmed: time.displayConfirmed,
        layerAttached: time.layerAttached,
        layerLoaded: time.layerLoaded,
        layerViewReady: time.layerViewReady,
        networkConfirmed: time.networkConfirmed,
        release: time.active?.releaseDate || time.selected?.releaseDate || null,
        product: time.active?.productName || time.selected?.productName || null,
        acquisitionDate: time.active?.acquisitionDate ?? time.selected?.acquisitionDate ?? null,
        dateKindUsed: time.active?.dateKindUsed || time.selected?.dateKindUsed || null,
        mapViewCreateCount: api.mapFoundation.getMapViewCreateCount()
      };
    });
  })()`, true, 180000);

  for (let i = 0; i < 40; i += 1) {
    const ready = await evaluateJson(send, `(() => {
      const time = window.__iqaiSpatialV2?.time?.();
      return {
        displayConfirmed: time?.displayConfirmed === true,
        layerViewReady: time?.layerViewReady === true,
        networkConfirmed: time?.networkConfirmed === true
      };
    })()`, false, 15000);
    if (ready?.displayConfirmed) break;
    await sleep(500);
  }
  await sleep(1500);

  const pageA = await shotPage(send, 'normal-observation-a');
  const obsA = await evaluateJson(send, PROBE, false, 20000);
  let pixelsA = { name: 'observation-a', error: 'skipped' };
  try {
    pixelsA = writeShot('observation-a', await evaluateJson(send, PIXEL_STATS, true, 20000));
  } catch (error) {
    pixelsA = { name: 'observation-a', error: String(error?.message || error) };
  }
  log(`A lv=${JSON.stringify(obsA?.observationLv)} display=${obsA?.time?.displayConfirmed} tiles=${obsA?.waybackResourceCount} contrast=${pixelsA.contrast}`);

  const prev = await evaluateJson(send, `(() => window.__iqaiSpatialV2.previousObservation().then(() => {
    const time = window.__iqaiSpatialV2.time();
    return {
      activeId: time.activeId,
      release: time.active?.releaseDate || time.selected?.releaseDate || null,
      product: time.active?.productName || time.selected?.productName || null,
      displayConfirmed: time.displayConfirmed,
      displayState: time.displayState
    };
  }))()`, true, 120000);
  for (let i = 0; i < 40; i += 1) {
    const ready = await evaluateJson(send, `(() => window.__iqaiSpatialV2?.time?.()?.displayConfirmed === true)`, false, 15000);
    if (ready === true) break;
    await sleep(500);
  }
  await sleep(1500);
  const pageB = await shotPage(send, 'normal-observation-b');
  const obsB = await evaluateJson(send, PROBE, false, 20000);
  let pixelsB = { name: 'observation-b', error: 'skipped' };
  try {
    pixelsB = writeShot('observation-b', await evaluateJson(send, PIXEL_STATS, true, 20000));
  } catch (error) {
    pixelsB = { name: 'observation-b', error: String(error?.message || error) };
  }
  log(`B lv=${JSON.stringify(obsB?.observationLv)} display=${obsB?.time?.displayConfirmed} tiles=${obsB?.waybackResourceCount} contrast=${pixelsB.contrast}`);

  await evaluateJson(send, `(() => {
    document.querySelector('[data-iqai-experience="EXPERT"]')?.click();
    window.__iqaiSpatialV2.commandCenter.setExperience('EXPERT');
    window.__iqaiSpatialV2.commandCenter.setActiveCapability('imagery');
    document.querySelector('[data-iqai-plugin="imagery"]')?.click();
    document.querySelector('[data-iqai-operator-imagery-action="diagnostics"]')?.click();
    return true;
  })()`);
  await sleep(1500);
  const expertProbe = await evaluateJson(send, PROBE);
  const expertPixels = writeShot('expert-observation-b', await evaluateJson(send, PIXEL_STATS, true));
  const expertPage = await shotPage(send, 'expert-observation-b');

  await evaluateJson(send, `(() => {
    document.querySelector('[data-iqai-experience="NORMAL"]')?.click();
    window.__iqaiSpatialV2.commandCenter.setExperience('NORMAL');
    return true;
  })()`);
  await sleep(1000);
  const afterMode = await evaluateJson(send, PROBE);
  const afterModePixels = writeShot('normal-after-expert', await evaluateJson(send, PIXEL_STATS, true));
  const shellTruth = await evaluateJson(send, `(() => {
    const api = window.__iqaiSpatialV2;
    const operator = document.querySelector('[data-iqai-operator-imagery]');
    const explanation = document.querySelector('[data-iqai-explanation]');
    return {
      time: api.time(),
      truth: api.truth(),
      guided: api.commandCenter.guided(),
      operator: operator ? {
        displayConfirmed: operator.getAttribute('data-iqai-display-confirmed'),
        displayState: operator.getAttribute('data-iqai-display-state')
      } : null,
      explanation: explanation ? {
        displayConfirmed: explanation.getAttribute('data-iqai-display-confirmed'),
        displayState: explanation.getAttribute('data-iqai-display-state')
      } : null,
      guidedDom: [...document.querySelectorAll('[data-iqai-guided-next-action]')].map((node) => ({
        surface: node.getAttribute('data-iqai-guided-next-action'),
        step: node.getAttribute('data-iqai-guided-step'),
        recommended: node.getAttribute('data-iqai-guided-recommended')
      }))
    };
  })()`, false, 20000);

  return {
    state,
    operator,
    prev,
    obsA,
    pixelsA,
    pageA,
    obsB,
    pixelsB,
    pageB,
    expertProbe,
    expertPixels,
    expertPage,
    afterMode,
    afterModePixels,
    shellTruth
  };
});

function waybackHosts(urls) {
  return [...new Set((urls || []).filter((url) => /wayback\.maptiles/i.test(url)).map((url) => {
    try { return new URL(url).host; } catch { return 'invalid'; }
  }))];
}

function waybackTiles(finished) {
  return (finished || []).filter((item) => /wayback\.maptiles\.arcgis\.com\/.*\/tile\//i.test(item.url)).slice(0, 16);
}

const v1Response = await fetch(`${BASE}/spatial/`, { redirect: 'follow' });
const v1Html = await v1Response.text();
const finalTime = live?.shellTruth?.time || live?.afterMode?.time || null;
const finalGuided = live?.shellTruth?.guided || null;
const shellReflectsConfirmation = live?.shellTruth?.operator?.displayConfirmed === 'true'
  && live?.shellTruth?.operator?.displayState === 'DISPLAY_CONFIRMED'
  && live?.shellTruth?.explanation?.displayConfirmed === 'true'
  && live?.shellTruth?.explanation?.displayState === 'DISPLAY_CONFIRMED';
const guidedAdvanced = finalGuided?.currentStep !== 'SHOW_BEST_IMAGE'
  && finalGuided?.completedSteps?.includes?.('SHOW_BEST_IMAGE');
const portalWriteRequests = (live?.networkUrls || []).filter((url) => (
  /\/sharing\/rest\/content\/users\/.*\/(addItem|update|deleteItems|shareItems)/i.test(url)
));

const report = {
  generatedAt: new Date().toISOString(),
  state: live?.state,
  error: live?.error || null,
  snap: live?.snap || null,
  mapViewCreateCount: live?.obsA?.mapViewCreateCount || live?.operator?.mapViewCreateCount || null,
  operator: live?.operator || null,
  observationA: {
    id: live?.obsA?.time?.activeId || live?.operator?.activeId || null,
    release: live?.operator?.release || live?.obsA?.observation?.title || null,
    probe: live?.obsA || null,
    pixels: live?.pixelsA || null,
    page: live?.pageA || null
  },
  observationB: {
    id: live?.obsB?.time?.activeId || live?.prev?.activeId || null,
    release: live?.prev?.release || null,
    probe: live?.obsB || null,
    pixels: live?.pixelsB || null,
    page: live?.pageB || null
  },
  previousVisualChange: differs(live?.pixelsA, live?.pixelsB),
  pixelsPaintedA: painted(live?.pixelsA),
  pixelsPaintedB: painted(live?.pixelsB),
  displayConfirmedA: live?.obsA?.time?.displayConfirmed === true,
  displayConfirmedB: live?.obsB?.time?.displayConfirmed === true,
  layerViewA: live?.obsA?.observationLv || null,
  oneMapView: (live?.obsA?.time ? live?.operator?.mapViewCreateCount : live?.obsB?.time) === 1
    || live?.operator?.mapViewCreateCount === 1,
  expert: {
    probe: live?.expertProbe || null,
    pixels: live?.expertPixels || null,
    page: live?.expertPage || null,
    displayConfirmed: live?.expertProbe?.time?.displayConfirmed === true,
    activeUnchanged: (live?.expertProbe?.time?.activeId || null) === (live?.obsB?.time?.activeId || null)
  },
  normalAfterExpert: {
    probe: live?.afterMode || null,
    pixels: live?.afterModePixels || null,
    displayConfirmed: live?.afterMode?.time?.displayConfirmed === true,
    activeUnchanged: (live?.afterMode?.time?.activeId || null) === (live?.obsB?.time?.activeId || null)
  },
  final: {
    selectedId: finalTime?.selectedId || null,
    activeId: finalTime?.activeId || null,
    displayConfirmed: finalTime?.displayConfirmed === true,
    displayState: finalTime?.displayState || null,
    displayEvidence: finalTime?.displayEvidence || null,
    shellReflectsConfirmation,
    guidedAdvanced,
    guided: finalGuided,
    operator: live?.shellTruth?.operator || null,
    explanation: live?.shellTruth?.explanation || null,
    guidedDom: live?.shellTruth?.guidedDom || [],
    commandCenterTruth: live?.shellTruth?.truth || null
  },
  v1: {
    status: v1Response.status,
    independent: v1Response.ok
      && v1Html.includes('/spatial/spatial.js')
      && !v1Html.includes('iqai-spatial-v2')
  },
  portalWriteRequests,
  pass: finalTime?.displayConfirmed === true
    && finalTime?.displayState === 'DISPLAY_CONFIRMED'
    && finalTime?.displayEvidence?.confirmed === true
    && shellReflectsConfirmation
    && guidedAdvanced
    && live?.operator?.mapViewCreateCount === 1
    && v1Response.ok
    && v1Html.includes('/spatial/spatial.js')
    && !v1Html.includes('iqai-spatial-v2')
    && portalWriteRequests.length === 0,
  waybackRequestHosts: waybackHosts(live?.networkUrls),
  waybackTiles: waybackTiles(live?.networkFinished)
};

fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'qa-report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
if (!report.pass) process.exitCode = 1;
