import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'artifacts', 'spatial-v2-imagery-pixel-proof');
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

function secretHits(text) {
  const value = String(text || '');
  return {
    apikeyQuery: /apikey=/i.test(value),
    apikeyPath: /apikey\/[A-Za-z0-9-]+/i.test(value)
  };
}

function hostsFrom(urls) {
  return [...new Set((urls || []).map((url) => {
    try { return new URL(url).host; } catch { return null; }
  }).filter(Boolean))];
}

function contrastProven(stats) {
  if (!stats || stats.error) return false;
  return Number(stats.contrast) >= 24 && Number(stats.bytes || 0) > 12000;
}

function differsFrom(a, b) {
  if (!a || !b || a.error || b.error) return false;
  const meanDelta = ['r', 'g', 'b'].reduce((sum, _, i) => sum + Math.abs((a.mean?.[i] || 0) - (b.mean?.[i] || 0)), 0);
  return meanDelta >= 30 || Math.abs((a.contrast || 0) - (b.contrast || 0)) >= 20 || Math.abs((a.bytes || 0) - (b.bytes || 0)) >= 8000;
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
    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (msg.method === 'Network.requestWillBeSent' && msg.params?.request?.url) {
          networkUrls.push(msg.params.request.url);
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
    const result = await fn(send, { networkUrls });
    if (result && typeof result === 'object') result.networkUrls = networkUrls.slice();
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
    throw new Error(result.exceptionDetails.text || 'Runtime.evaluate failed');
  }
  const value = result.result?.value;
  if (typeof value === 'string') {
    try { return JSON.parse(value); } catch { return value; }
  }
  return value;
}

const PROBE = `(() => {
  const api = window.__iqaiSpatialV2;
  const view = api?.mapFoundation?.getView?.();
  const webmap = api?.mapFoundation?.getWebMap?.() || view?.map;
  const all = webmap?.allLayers?.toArray ? webmap.allLayers.toArray() : [];
  const lvs = view?.allLayerViews?.toArray ? view.allLayerViews.toArray() : [];
  const resources = performance.getEntriesByType('resource').map((entry) => entry.name);
  const imagery = resources.filter((name) => /wms|GetMap|wayback|World_Imagery|tile\\/|nearmap/i.test(name));
  const observation = all.find((layer) => layer.id === 'iqai-v2-imagery-time-observation');
  const observationLv = lvs.find((lv) => lv.layer?.id === 'iqai-v2-imagery-time-observation');
  const wms = all.find((layer) => layer.id === 'iqai-ground-nearmap-wms');
  const wmsLv = lvs.find((lv) => lv.layer?.id === 'iqai-ground-nearmap-wms');
  return JSON.stringify({
    ground: api?.ground?.()?.currentMode || null,
    timeActive: api?.time?.()?.active?.productName || api?.time?.()?.activeId || null,
    center: view?.center ? { lon: view.center.longitude, lat: view.center.latitude } : null,
    scale: view?.scale || null,
    viewReady: Boolean(view?.ready),
    mapViewCreateCount: api?.mapFoundation?.getMapViewCreateCount?.() || 0,
    authoredLayerCount: api?.mapFoundation?.getAuthoredLayerIds?.()?.length || null,
    background: webmap?.background?.color ? [...webmap.background.color.toRgb?.() || []] : null,
    observation: observation ? {
      id: observation.id,
      type: observation.type,
      visible: observation.visible !== false,
      loaded: Boolean(observation.loaded),
      url: observation.urlTemplate || observation.url || null,
      loadError: observation.loadError ? String(observation.loadError.message || observation.loadError) : null
    } : null,
    observationLv: observationLv ? {
      suspended: observationLv.suspended === true,
      updating: observationLv.updating === true,
      visible: observationLv.visible !== false
    } : null,
    wms: wms ? {
      id: wms.id,
      visible: wms.visible !== false,
      loaded: Boolean(wms.loaded),
      url: wms.url || null,
      loadError: wms.loadError ? String(wms.loadError.message || wms.loadError) : null
    } : null,
    wmsLv: wmsLv ? {
      suspended: wmsLv.suspended === true,
      updating: wmsLv.updating === true,
      visible: wmsLv.visible !== false
    } : null,
    visibleLayers: all.filter((layer) => layer.visible !== false).slice(0, 30).map((layer, index) => ({
      index,
      id: layer.id || null,
      title: layer.title || null,
      type: layer.type || null,
      opacity: layer.opacity,
      parent: layer.parent?.id || layer.parent?.title || null
    })),
    imageryHosts: imagery.map((name) => { try { return new URL(name).host; } catch { return 'invalid'; } })
  });
})()`;

const SHOT_STATS = `(() => {
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
        const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
        let r = 0; let g = 0; let b = 0; let count = 0; let min = 255; let max = 0;
        for (let i = 0; i < pixels.length; i += 16) {
          const lum = (pixels[i] + pixels[i + 1] + pixels[i + 2]) / 3;
          r += pixels[i]; g += pixels[i + 1]; b += pixels[i + 2];
          min = Math.min(min, lum); max = Math.max(max, lum); count += 1;
        }
        resolve({
          dataUrl,
          width: img.width,
          height: img.height,
          mean: [Math.round(r / count), Math.round(g / count), Math.round(b / count)],
          lumMin: Math.round(min),
          lumMax: Math.round(max),
          contrast: Math.round(max - min)
        });
      };
      img.onerror = () => reject(new Error('stats image failed'));
      img.src = dataUrl;
    });
  }).catch((error) => ({ error: String(error?.message || error) }));
})()`;

function writeShot(name, stats) {
  if (!stats?.dataUrl || !String(stats.dataUrl).startsWith('data:image')) {
    return { name, file: null, bytes: 0, error: stats?.error || 'no-dataUrl', ...stats, dataUrl: undefined };
  }
  const file = path.join(OUT, `${name}.png`);
  const buf = Buffer.from(String(stats.dataUrl).replace(/^data:image\/png;base64,/, ''), 'base64');
  fs.writeFileSync(file, buf);
  return {
    name,
    file,
    bytes: buf.length,
    width: stats.width,
    height: stats.height,
    mean: stats.mean,
    lumMin: stats.lumMin,
    lumMax: stats.lumMax,
    contrast: stats.contrast
  };
}

if (!(await isPortOpen(3000))) throw new Error('Spatial server is not listening on port 3000.');
const browserPath = findBrowser();
if (!browserPath) throw new Error('Edge/Chrome not found.');
const preauth = await fetchPreauthToken();

const live = await withCdpPage(browserPath, 9261, async (send) => {
  const log = (message) => console.error(`[pixel] ${message}`);
  if (preauth) {
    await send('Page.addScriptToEvaluateOnNewDocument', {
      source: `window.__MONTREAL_PREAUTH_TOKEN = ${JSON.stringify(preauth)};`
    });
  }
  await send('Emulation.setDeviceMetricsOverride', {
    width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false
  });
  await send('Page.navigate', { url: `${BASE}/spatial-v2/?imagery=pixel-proof` });
  let state = 'INITIALIZING';
  for (let i = 0; i < 60; i += 1) {
    state = await evaluateJson(send, 'window.__iqaiSpatialV2?.mapFoundation?.getState?.() || "WAITING"');
    if (state === 'READY' || state === 'ERROR') break;
    await sleep(1000);
  }
  if (state !== 'READY') return { state, error: 'Map foundation did not become READY' };
  log('READY');
  await evaluateJson(send, `(() => {
    const api = window.__iqaiSpatialV2;
    api.mapFoundation.goHome();
    document.querySelector('[data-iqai-plugin="imagery"]')?.click();
    return true;
  })()`);
  await sleep(1500);

  async function capture(label, action) {
    if (action) await evaluateJson(send, action, true).catch((error) => ({ error: String(error?.message || error) }));
    await sleep(2500);
    const stats = await evaluateJson(send, SHOT_STATS, true).catch((error) => ({ error: String(error?.message || error) }));
    const probe = await evaluateJson(send, PROBE);
    const shot = writeShot(label, stats);
    log(`${label} contrast=${shot.contrast} bytes=${shot.bytes} mean=${JSON.stringify(shot.mean)}`);
    return { shot, probe };
  }

  const black = await capture('00-black', `(() => window.__iqaiSpatialV2.setGroundMode('PURE_BLACK').then(() => true))()`);
  const white = await capture('01-white', `(() => window.__iqaiSpatialV2.setGroundMode('PURE_WHITE').then(() => true))()`);
  const esri = await capture('02-esri-world', `(() => window.__iqaiSpatialV2.setGroundMode('ESRI_WORLD_IMAGERY').then(() => true))()`);
  const black2 = await capture('03-black-baseline', `(() => window.__iqaiSpatialV2.setGroundMode('PURE_BLACK').then(() => true))()`);

  const discover = await evaluateJson(send, `(() => {
    const api = window.__iqaiSpatialV2;
    api.setTimeEngineOptions({ aoiMode: 'viewport', requestedDate: '2018-06-15', providerFilter: 'wayback' });
    return api.discoverImageryTime().then(() => {
      const observations = api.time()?.observations || [];
      const pick = observations.find((item) => String(item.releaseDate || '').startsWith('2018'))
        || api.time()?.selected;
      if (!pick?.id) return { error: 'No historical Wayback release found' };
      return api.selectObservation(pick.id).then(() => api.activateObservation(pick.id)).then(() => ({
        count: api.time()?.observations?.length || 0,
        active: api.time()?.active?.productName || null,
        release: api.time()?.active?.releaseDate || null,
        id: api.time()?.activeId || null
      }));
    });
  })()`, true);
  const activate = await capture('04-wayback-activate');
  const prev = await evaluateJson(send, `(() => window.__iqaiSpatialV2.previousObservation().then(() => ({
    active: window.__iqaiSpatialV2.time()?.active?.productName || null,
    release: window.__iqaiSpatialV2.time()?.active?.releaseDate || null
  })))()`, true);
  const prevShot = await capture('05-wayback-prev');
  const next = await evaluateJson(send, `(() => window.__iqaiSpatialV2.nextObservation().then(() => ({
    active: window.__iqaiSpatialV2.time()?.active?.productName || null,
    release: window.__iqaiSpatialV2.time()?.active?.releaseDate || null
  })))()`, true);
  const nextShot = await capture('06-wayback-next');

  await evaluateJson(send, `(() => window.__iqaiSpatialV2.deactivateObservation().then(() => true))()`, true).catch(() => null);
  const nearmap = await capture('07-nearmap', `(() => window.__iqaiSpatialV2.setGroundMode('NEARMAP').then(() => window.__iqaiSpatialV2.ground()))()`);

  const secrets = await evaluateJson(send, `(() => JSON.stringify({
    html: document.documentElement?.innerHTML || '',
    readout: document.querySelector('[data-iqai-time-readout]')?.textContent || '',
    provenance: document.querySelector('[data-iqai-region="provenance-slot"]')?.innerText || '',
    resources: performance.getEntriesByType('resource').map((entry) => entry.name).join('\\n')
  }))()`);

  return {
    state,
    black,
    white,
    esri,
    black2,
    discover,
    activate,
    prev,
    prevShot,
    next,
    nextShot,
    nearmap,
    secrets
  };
});

const report = {
  generatedAt: new Date().toISOString(),
  rendererAlive: differsFrom(live?.black?.shot, live?.white?.shot) || contrastProven(live?.white?.shot),
  esriPaints: contrastProven(live?.esri?.shot) && differsFrom(live?.black2?.shot, live?.esri?.shot),
  wayback: {
    discover: live?.discover,
    activate: live?.activate?.probe?.timeActive || live?.discover?.active,
    prev: live?.prev,
    next: live?.next,
    vsBlack: differsFrom(live?.black2?.shot, live?.activate?.shot),
    prevDiffers: differsFrom(live?.activate?.shot, live?.prevShot?.shot),
    nextDiffers: differsFrom(live?.prevShot?.shot, live?.nextShot?.shot),
    observationLv: live?.activate?.probe?.observationLv,
    observation: live?.activate?.probe?.observation,
    hosts: live?.activate?.probe?.imageryHosts
  },
  nearmap: {
    ground: live?.nearmap?.probe?.ground,
    vsBlack: differsFrom(live?.black2?.shot, live?.nearmap?.shot),
    wmsLv: live?.nearmap?.probe?.wmsLv,
    wms: live?.nearmap?.probe?.wms,
    hosts: live?.nearmap?.probe?.imageryHosts,
    secrets: {
      html: secretHits(live?.secrets?.html),
      readout: secretHits(live?.secrets?.readout),
      provenance: secretHits(live?.secrets?.provenance),
      resources: secretHits(live?.secrets?.resources),
      network: secretHits((live?.networkUrls || []).join('\n'))
    }
  },
  shots: {
    black: live?.black?.shot,
    white: live?.white?.shot,
    esri: live?.esri?.shot,
    black2: live?.black2?.shot,
    activate: live?.activate?.shot,
    prev: live?.prevShot?.shot,
    next: live?.nextShot?.shot,
    nearmap: live?.nearmap?.shot
  },
  camera: live?.nearmap?.probe?.center || live?.activate?.probe?.center,
  mapViewCreateCount: live?.nearmap?.probe?.mapViewCreateCount,
  authoredLayerCount: live?.nearmap?.probe?.authoredLayerCount,
  visibleLayers: live?.nearmap?.probe?.visibleLayers || live?.activate?.probe?.visibleLayers,
  networkHosts: hostsFrom(live?.networkUrls),
  error: live?.error || null
};

fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'pixel-report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
