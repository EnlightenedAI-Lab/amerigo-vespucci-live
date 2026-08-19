/**
 * Live acceptance: 3D ANALYZE SceneView on :3047.
 * MAP / Focus / Google 3D / ANALYZE hits / measure / SensorPose / Street / MapView count.
 * Does not commit. No Portal writes.
 */
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'artifacts', 'spatial-v2-analyze-3d');
const PORT = 3047;
const FOCUS_DOWNTOWN = Object.freeze({ longitude: -73.56726, latitude: 45.50173 });
const FOCUS_OUTSIDE = Object.freeze({ longitude: -73.73312, latitude: 45.52354 });

function exists(file) {
  try { return fs.existsSync(file); } catch { return false; }
}

function findBrowser() {
  return [
    process.env.CHROME_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    process.env.EDGE_PATH,
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
  ].filter(Boolean).find((file) => exists(file)) || null;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sanitize(text) {
  return String(text || '')
    .replace(/key=[^&\s"']+/gi, 'key=REDACTED')
    .replace(/AIza[0-9A-Za-z_-]{20,}/g, 'REDACTED_KEY')
    .slice(0, 400);
}

function isPortOpen(port) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ port, host: '127.0.0.1' });
    socket.once('connect', () => { socket.end(); resolve(true); });
    socket.once('error', () => resolve(false));
    socket.setTimeout(1500, () => { socket.destroy(); resolve(false); });
  });
}

async function waitForJson(url, attempts = 40) {
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
    '--no-first-run',
    '--no-default-browser-check',
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
    const logs = [];
    const network = [];
    ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg.method === 'Runtime.consoleAPICalled') {
        const text = (msg.params?.args || [])
          .map((arg) => sanitize(arg.value || arg.description || ''))
          .join(' ');
        logs.push({ type: msg.params?.type, text });
      }
      if (msg.method === 'Runtime.exceptionThrown') {
        logs.push({
          type: 'exception',
          text: sanitize(msg.params?.exceptionDetails?.exception?.description || msg.params?.exceptionDetails?.text)
        });
      }
      if (msg.method === 'Network.responseReceived') {
        const url = String(msg.params?.response?.url || '');
        if (/Building_Montreal|Terrain3D|SceneServer|World_Imagery|worldtile|workers\/init|RemoteClient|@arcgis\/core\/assets/i.test(url)) {
          network.push({
            status: msg.params?.response?.status,
            mime: msg.params?.response?.mimeType || null,
            url: url.slice(0, 220)
          });
        }
      }
    });
    const send = (method, params = {}) => {
      nextId += 1;
      const id = nextId;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          ws.off('message', onMessage);
          reject(new Error(`${method}: timeout`));
        }, 180000);
        const onMessage = (raw) => {
          const msg = JSON.parse(raw.toString());
          if (msg.id !== id) return;
          clearTimeout(timer);
          ws.off('message', onMessage);
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
    await send('Network.setCacheDisabled', { cacheDisabled: true });
    const result = await fn(send, logs, network);
    ws.close();
    return result;
  } finally {
    child.kill();
  }
}

async function shot(send, name) {
  const result = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  const file = path.join(OUT, name);
  fs.writeFileSync(file, Buffer.from(result.data, 'base64'));
  return file;
}

async function evaluateJson(send, expression, awaitPromise = false) {
  const result = await send('Runtime.evaluate', {
    expression,
    awaitPromise,
    returnByValue: true
  });
  const value = result.result?.value;
  if (typeof value === 'string') {
    try { return JSON.parse(value); } catch { return { raw: value }; }
  }
  return value;
}

async function waitUntil(send, expression, attempts, delayMs) {
  for (let i = 0; i < attempts; i += 1) {
    const value = await evaluateJson(send, expression);
    if (value === true || value === 'true') return true;
    await sleep(delayMs);
  }
  return false;
}

async function probe(send) {
  return evaluateJson(send, `JSON.stringify((() => {
    const api = window.__iqaiSpatialV2 || {};
    const world = api.world?.() || null;
    const analyze = api.analyze3d?.snapshot?.() || {};
    const visual = api.google3d?.snapshot?.() || {};
    const street = api.street360?.snapshot?.() || {};
    const switcher = api.viewSwitcher?.snapshot?.() || {};
    const canvas = document.querySelector('[data-iqai-analyze-3d-canvas]');
    const esri = canvas?.querySelector('.esri-view, canvas');
    const gmp = document.querySelector('gmp-map-3d');
    const status = document.querySelector('[data-iqai-analyze-3d-status]')?.textContent || '';
    const cameras = world?.cameras || null;
    return {
      spatialView: document.getElementById('iqai-spatial-v2')?.dataset.iqaiSpatialView || null,
      mapState: document.querySelector('[data-iqai-map-state]')?.getAttribute('data-iqai-map-state') || null,
      createCount: api.mapViewCreateCount ?? null,
      sceneViewCreateCount: analyze.sceneViewCreateCount ?? null,
      analyzeButton: Boolean(document.querySelector('[data-iqai-view="3D ANALYZE"]')),
      focus: api.dropPin?.snapshot?.().focus || null,
      worldFocus: world?.activeFocus || null,
      analyze: {
        open: analyze.open,
        stageState: analyze.stageState,
        loadPath: analyze.loadPath,
        webSceneItemId: analyze.webSceneItemId,
        buildingServiceUrl: analyze.buildingServiceUrl,
        coverageAvailable: analyze.coverageAvailable,
        coverageLabel: analyze.coverageLabel,
        buildingsReady: analyze.buildingsReady,
        hitCount: analyze.hitCount,
        hits: analyze.hits || [],
        measure: analyze.measure || null,
        sensorPose: analyze.sensorPose || null,
        error: analyze.error || null,
        renderDiagnostics: analyze.renderDiagnostics || null,
        worker: analyze.worker || null,
        attribution: analyze.attribution || null,
        canvas: canvas ? { w: canvas.clientWidth, h: canvas.clientHeight } : null,
        esri: esri ? { w: esri.clientWidth || esri.width, h: esri.clientHeight || esri.height } : null,
        status
      },
      visual: {
        open: visual.open,
        stageState: visual.stageState,
        maps3dLoaded: visual.maps3dLoaded,
        gmp: gmp ? { w: gmp.offsetWidth, h: gmp.offsetHeight } : null
      },
      street: {
        open: street.open,
        stageState: street.stageState,
        available: street.available
      },
      switcher: switcher.activeView || null,
      worldviewLayout: document.getElementById('iqai-spatial-v2')?.dataset.iqaiWorldviewLayout || null,
      camerasKind: cameras ? Object.keys(cameras) : null
    };
  })())`);
}

if (!(await isPortOpen(PORT))) {
  console.log(JSON.stringify({ error: '3047 not listening' }));
  process.exit(1);
}

const browserPath = findBrowser();
if (!browserPath) {
  console.log(JSON.stringify({ error: 'No Chrome/Edge browser found' }));
  process.exit(1);
}

const live = await withCdpPage(browserPath, 9322, async (send, logs, network) => {
  await send('Page.navigate', { url: `http://localhost:${PORT}/spatial-v2/?v=analyze-3d-2` });
  await send('Page.bringToFront');
  const ready = await waitUntil(
    send,
    `document.querySelector('[data-iqai-map-state]')?.getAttribute('data-iqai-map-state') === 'READY'
      && Boolean(window.__iqaiSpatialV2?.dropPin?.placeFocus)
      && Boolean(window.__iqaiSpatialV2?.analyze3d?.snapshot)`,
    50,
    1000
  );
  if (!ready) {
    return { ready: false, probe: await probe(send), screenshots: { fail: await shot(send, 'fail-not-ready.png') }, logs };
  }

  const mapReady = await probe(send);
  const mapShot = await shot(send, '01-map.png');

  await evaluateJson(send, `void window.__iqaiSpatialV2.dropPin.placeFocus(${FOCUS_DOWNTOWN.longitude}, ${FOCUS_DOWNTOWN.latitude}, 'map')`);
  await waitUntil(
    send,
    `(() => {
      const f = window.__iqaiSpatialV2?.dropPin?.snapshot?.().focus;
      return Boolean(f) && Math.abs(f.longitude - ${FOCUS_DOWNTOWN.longitude}) < 1e-5;
    })()`,
    20,
    250
  );
  await sleep(400);
  const focusReady = await probe(send);

  await evaluateJson(send, `void window.__iqaiSpatialV2.worldViewFrame.openSupporting('3D VISUAL')`);
  await waitUntil(send, `window.__iqaiSpatialV2?.google3d?.snapshot?.().stageState === 'OPEN'`, 70, 1000);
  await sleep(2500);
  const googleOpen = await probe(send);
  const googleShot = await shot(send, '02-google-3d-visual.png');

  await evaluateJson(send, `void window.__iqaiSpatialV2.worldViewFrame.openSupporting('MAP')`);
  await waitUntil(send, `window.__iqaiSpatialV2?.google3d?.snapshot?.().open !== true`, 20, 250);
  await sleep(600);

  await evaluateJson(send, `void window.__iqaiSpatialV2.viewSwitcher.setView('3D ANALYZE')`);
  await waitUntil(
    send,
    `(() => {
      const s = window.__iqaiSpatialV2?.analyze3d?.snapshot?.() || {};
      return s.stageState === 'OPEN' || s.stageState === 'UNAVAILABLE' || s.stageState === 'ERROR';
    })()`,
    90,
    1000
  );
  await waitUntil(
    send,
    `(() => {
      const s = window.__iqaiSpatialV2?.analyze3d?.snapshot?.() || {};
      const pose = s.sensorPose || {};
      return s.stageState === 'OPEN' && Number(pose.z) > 60;
    })()`,
    40,
    1000
  );
  await sleep(8000);
  const analyzeOpen = await probe(send);
  const analyzeShot = await shot(send, '03-analyze-3d.png');

  const samples = [
    [0.5, 0.48], [0.42, 0.52], [0.58, 0.5], [0.36, 0.44], [0.64, 0.46],
    [0.5, 0.38], [0.46, 0.58], [0.54, 0.42]
  ];
  const hits = [];
  const seen = new Set();
  for (const [x, y] of samples) {
    if (hits.length >= 3) break;
    let hit = null;
    try {
      hit = await evaluateJson(send, `JSON.stringify(await (async () => {
        const api = window.__iqaiSpatialV2?.analyze3d;
        const canvas = document.querySelector('[data-iqai-analyze-3d-canvas]');
        if (!api?.pickAndRecord || !canvas) return null;
        return api.pickAndRecord(canvas.clientWidth * ${x}, canvas.clientHeight * ${y});
      })())`, true);
    } catch {
      hit = null;
    }
    if (!hit || typeof hit !== 'object' || !Number.isFinite(hit.longitude)) continue;
    const key = String(hit.objectId ?? hit.buildingFID ?? hit.buildingShellFID ?? `${hit.longitude.toFixed(5)},${hit.latitude.toFixed(5)}`);
    if (seen.has(key)) continue;
    seen.add(key);
    hits.push(hit);
  }
  const afterHits = await probe(send);
  const hitsShot = await shot(send, '04-analyze-hits.png');

  const sensorPose = afterHits?.analyze?.sensorPose || null;

  await evaluateJson(send, `void window.__iqaiSpatialV2.viewSwitcher.setView('MAP')`);
  await waitUntil(
    send,
    `window.__iqaiSpatialV2?.analyze3d?.snapshot?.().stageState === 'IDLE'`,
    20,
    250
  );
  await sleep(700);
  const mapAfter = await probe(send);
  const mapAfterShot = await shot(send, '05-map-after.png');

  await evaluateJson(send, `void window.__iqaiSpatialV2.worldViewFrame.openSupporting('STREET 360')`);
  await waitUntil(
    send,
    `(() => { const s = window.__iqaiSpatialV2?.street360?.snapshot?.() || {}; return s.stageState === 'OPEN' || s.stageState === 'UNAVAILABLE' || s.stageState === 'ERROR'; })()`,
    40,
    1000
  );
  await sleep(1500);
  const street = await probe(send);
  const streetShot = await shot(send, '06-street-360.png');

  await evaluateJson(send, `void window.__iqaiSpatialV2.viewSwitcher.setView('MAP')`);
  await sleep(500);

  await evaluateJson(send, `void window.__iqaiSpatialV2.worldViewFrame.setLayout(2)`);
  await waitUntil(
    send,
    `document.getElementById('iqai-spatial-v2')?.dataset.iqaiWorldviewLayout === '2'`,
    20,
    250
  );
  await sleep(800);
  const worldview = await probe(send);
  const worldviewShot = await shot(send, '07-worldview.png');
  await evaluateJson(send, `void window.__iqaiSpatialV2.worldViewFrame.setLayout(1)`);
  await sleep(400);

  await evaluateJson(send, `void window.__iqaiSpatialV2.dropPin.placeFocus(${FOCUS_OUTSIDE.longitude}, ${FOCUS_OUTSIDE.latitude}, 'map')`);
  await sleep(400);
  await evaluateJson(send, `void window.__iqaiSpatialV2.viewSwitcher.setView('3D ANALYZE')`);
  await waitUntil(
    send,
    `window.__iqaiSpatialV2?.analyze3d?.snapshot?.().stageState === 'UNAVAILABLE'`,
    20,
    400
  );
  const outside = await probe(send);
  const outsideShot = await shot(send, '08-outside-coverage.png');

  await evaluateJson(send, `void window.__iqaiSpatialV2.viewSwitcher.setView('MAP')`);
  await sleep(400);
  const finalMap = await probe(send);

  return {
    ready: true,
    mapReady,
    focusReady,
    googleOpen,
    analyzeOpen,
    hits: Array.isArray(hits) ? hits : [],
    afterHits,
    sensorPose,
    mapAfter,
    street,
    worldview,
    outside,
    finalMap,
    screenshots: {
      map: mapShot,
      google: googleShot,
      analyze: analyzeShot,
      hits: hitsShot,
      mapAfter: mapAfterShot,
      street: streetShot,
      worldview: worldviewShot,
      outside: outsideShot
    },
    logs: logs.slice(0, 40),
    network: (network || []).slice(0, 80)
  };
});

const hits = live.hits || [];
const distinct = new Set(hits.map((hit) => String(hit.objectId ?? hit.buildingFID ?? hit.buildingShellFID ?? `${hit.longitude},${hit.latitude}`)));
const measure = live.afterHits?.analyze?.measure || null;
const pose = live.sensorPose || live.afterHits?.analyze?.sensorPose || null;
const report = {
  origin: `http://localhost:${PORT}/spatial-v2/`,
  ready: live.ready === true,
  map: live.mapReady?.mapState === 'READY',
  focus: Boolean(live.focusReady?.focus),
  google3d: live.googleOpen?.visual?.open === true && (live.googleOpen?.visual?.gmp?.w || 0) > 200,
  analyzeMounted: live.analyzeOpen?.analyzeButton === true && (live.analyzeOpen?.analyze?.open === true || live.analyzeOpen?.analyze?.stageState === 'OPEN'),
  webScene: live.analyzeOpen?.analyze?.webSceneItemId === '63a16e0c9f364d0fab9d55f40bf71771'
    && (live.analyzeOpen?.analyze?.loadPath === 'WEBSCENE' || live.analyzeOpen?.analyze?.loadPath === 'SCENE_LAYER_DIRECT'),
  analyzeError: live.analyzeOpen?.analyze?.error || null,
  analyzeState: live.analyzeOpen?.analyze?.stageState || null,
  loadPath: live.analyzeOpen?.analyze?.loadPath || null,
  buildingMontreal: String(live.analyzeOpen?.analyze?.buildingServiceUrl || '').includes('Building_Montreal')
    || live.analyzeOpen?.analyze?.loadPath === 'WEBSCENE',
  downtownRender: live.analyzeOpen?.analyze?.buildingsReady === true
    && (live.analyzeOpen?.analyze?.canvas?.w || 0) > 200,
  realHits: distinct.size >= 3,
  realXY: hits.filter((hit) => Number.isFinite(hit.longitude) && Number.isFinite(hit.latitude)).length >= 3,
  realZ: hits.filter((hit) => Number.isFinite(hit.z)).length >= 3,
  sourceId: hits.some((hit) => hit.objectId != null || hit.buildingFID || hit.buildingShellFID),
  sourceAttributes: hits.some((hit) => hit.attributes && Object.keys(hit.attributes).length > 0),
  provenance: hits.length >= 3 && hits.every((hit) => /City of Montréal|Esri/i.test(hit.provenance || '')),
  direct3d: Number.isFinite(measure?.direct3dMeters),
  horizontal: Number.isFinite(measure?.horizontalMeters),
  vertical: Number.isFinite(measure?.verticalMeters),
  sensorPose: Boolean(pose?.schemaId === 'iqai.spatial.sensor-pose/1.0.0' && pose.source === 'SCENE_CAMERA_SAMPLE'),
  mapAfter: live.mapAfter?.mapState === 'READY',
  street: live.street?.street?.open === true || live.street?.street?.stageState === 'OPEN',
  worldview: live.worldview?.worldviewLayout === '2',
  outsideCoverage: live.outside?.analyze?.stageState === 'UNAVAILABLE'
    && /ANALYTICAL 3D COVERAGE UNAVAILABLE/.test(live.outside?.analyze?.status || live.outside?.analyze?.coverageLabel || ''),
  createCount: live.finalMap?.createCount ?? live.mapAfter?.createCount ?? null,
  i3sRequests: (live.network || []).filter((row) => /Building_Montreal/i.test(row.url || '')).length,
  i3sChildRequests: (live.network || []).filter((row) => /Building_Montreal/i.test(row.url || '') && /nodes\/(?!root)/i.test(row.url || '')).length,
  i3sGeometryRequests: (live.network || []).filter((row) => /Building_Montreal/i.test(row.url || '') && /geometr|texture|features\//i.test(row.url || '')).length,
  workerInitRequests: (live.network || []).filter((row) => /workers\/init\.js/i.test(row.url || '')),
  terrainRequests: (live.network || []).filter((row) => /Terrain3D/i.test(row.url || '')).length,
  renderDiagnostics: live.analyzeOpen?.analyze?.renderDiagnostics || null,
  hits,
  measure,
  pose,
  screenshots: live.screenshots
};

const pass = report.ready
  && report.map
  && report.focus
  && report.google3d
  && report.analyzeMounted
  && report.webScene
  && report.buildingMontreal
  && report.downtownRender
  && report.realHits
  && report.realXY
  && report.realZ
  && report.sourceId
  && report.provenance
  && report.direct3d
  && report.horizontal
  && report.vertical
  && report.sensorPose
  && report.mapAfter
  && report.street
  && report.worldview
  && report.outsideCoverage
  && report.createCount === 1;

fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'analyze-3d-validate.json'), JSON.stringify({ pass, report, live }, null, 2));
console.log(JSON.stringify({
  pass,
  map: report.map,
  focus: report.focus,
  google3d: report.google3d,
  analyzeMounted: report.analyzeMounted,
  analyzeState: report.analyzeState,
  analyzeError: report.analyzeError,
  loadPath: report.loadPath,
  webScene: report.webScene,
  buildingMontreal: report.buildingMontreal,
  downtownRender: report.downtownRender,
  outsideCoverage: report.outsideCoverage,
  realHits: report.realHits,
  hitCount: hits.length,
  distinct: distinct.size,
  realXY: report.realXY,
  realZ: report.realZ,
  sourceId: report.sourceId,
  sourceAttributes: report.sourceAttributes,
  provenance: report.provenance,
  direct3d: report.direct3d,
  horizontal: report.horizontal,
  vertical: report.vertical,
  sensorPose: report.sensorPose,
  mapAfter: report.mapAfter,
  street: report.street,
  worldview: report.worldview,
  createCount: report.createCount,
  i3sRequests: report.i3sRequests,
  i3sChildRequests: report.i3sChildRequests,
  i3sGeometryRequests: report.i3sGeometryRequests,
  workerInitRequests: report.workerInitRequests,
  worker: live.analyzeOpen?.analyze?.worker || null,
  terrainRequests: report.terrainRequests,
  renderDiagnostics: report.renderDiagnostics,
  measure,
  screenshots: report.screenshots
}, null, 2));
if (!pass) process.exitCode = 1;
