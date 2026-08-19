/**
 * Live acceptance: Operational Layers V1.5 on Spatial V2 :3047.
 * Does not commit, push, deploy, or write Portal. Leaves :3047 running.
 */
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'artifacts', 'spatial-v2-ops-layers-v15');
const PORT = 3047;
const URL = `http://localhost:${PORT}/spatial-v2/`;
const FIX = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/spatial-v2/data/woa/catalog.json'), 'utf8')).fixtures;
const SCENES = ['public-safety', 'movement', 'infrastructure', 'weather-impact', 'wildfire', 'police-picture'];

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
    const send = (method, params = {}, timeoutMs = 30000) => {
      nextId += 1;
      const id = nextId;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          ws.off('message', onMessage);
          reject(new Error(`${method}: timeout`));
        }, timeoutMs);
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
    const result = await fn(send);
    ws.close();
    return result;
  } finally {
    child.kill();
  }
}

async function evaluateJson(send, expression, timeoutMs = 30000) {
  const result = await send('Runtime.evaluate', {
    expression: `(async () => {
      const value = ${expression};
      return await value;
    })()`,
    returnByValue: true,
    awaitPromise: true
  }, timeoutMs);
  if (result.exceptionDetails) {
    return {
      error: result.exceptionDetails.text
        || result.exceptionDetails.exception?.description
        || 'evaluate failed'
    };
  }
  return result.result?.value;
}

async function waitUntil(send, expression, attempts, delayMs) {
  for (let i = 0; i < attempts; i += 1) {
    const value = await evaluateJson(send, expression);
    if (value === true || value === 'true') return true;
    await sleep(delayMs);
  }
  return false;
}

function pass(ok) {
  return ok ? 'PASS' : 'FAIL';
}

async function goTo(send, lng, lat, zoom = 18) {
  await evaluateJson(send, `(async () => {
    const view = window.__iqaiSpatialV2?.mapFoundation?.getView?.();
    if (!view) return false;
    if (typeof view.goTo === 'function') {
      await view.goTo({ center: [${lng}, ${lat}], zoom: ${zoom} }, { animate: false });
    }
    await window.__iqaiSpatialV2.focusInstrument?.refreshUev?.({ lat: ${lat}, lng: ${lng} });
    return true;
  })()`);
  await sleep(700);
}

async function setWoaVisible(send, objectClass, visible) {
  await evaluateJson(send, `window.__iqaiSpatialV2.focusInstrument.setSourceVisible('${objectClass}', ${visible})`);
  await evaluateJson(send, `window.__iqaiSpatialV2.execute('layers.set-visibility', { instanceId: 'woa-${objectClass}', visible: ${visible} })`);
  await waitUntil(
    send,
    `window.__iqaiSpatialV2.focusInstrument.layerSnapshot()?.sources?.find((row) => row.objectClass === '${objectClass}')?.visible === ${visible}`,
    20,
    200
  );
  await sleep(200);
}

async function acquireClass(send, fixture) {
  await evaluateJson(send, `window.__iqaiSpatialV2.focusInstrument.clear()`);
  await goTo(send, fixture.lng, fixture.lat);
  await evaluateJson(send, `window.__iqaiSpatialV2.focusInstrument.hoverAt(${fixture.lat}, ${fixture.lng}, { x: 420, y: 310 })`);
  await sleep(80);
  await evaluateJson(send, `window.__iqaiSpatialV2.focusInstrument.dwellAt(${fixture.lat}, ${fixture.lng}, { x: 420, y: 310 })`);
  const acquired = await evaluateJson(send, `window.__iqaiSpatialV2.focusInstrument.acquireAt(${fixture.lat}, ${fixture.lng})`);
  await sleep(200);
  return acquired;
}

if (!(await isPortOpen(PORT))) {
  console.log(JSON.stringify({ error: '3047 not listening', result: 'FAIL' }));
  process.exit(1);
}

const browserPath = findBrowser();
if (!browserPath) {
  console.log(JSON.stringify({ error: 'No Chrome/Edge', result: 'FAIL' }));
  process.exit(1);
}

const catalogHttp = await fetch('http://127.0.0.1:3047/api/spatial-v2/ops-layers/catalog').then((r) => r.json()).catch((e) => ({ error: e.message }));

const report = await withCdpPage(browserPath, 9257, async (send) => {
  await send('Page.navigate', { url: URL });
  await waitUntil(send, `Boolean(document.querySelector('#iqai-spatial-v2'))`, 40, 250);
  const mapReady = await waitUntil(send, `window.__iqaiSpatialV2?.mapFoundation?.getState?.() === 'READY'`, 80, 400);
  await waitUntil(send, `window.__iqaiSpatialV2?.opsLayers?.snapshot?.()?.loaded === true`, 80, 400);
  const woaReady = await waitUntil(send, `window.__iqaiSpatialV2?.focusInstrument?.snapshot?.()?.ready === true`, 80, 400);

  await evaluateJson(send, `document.querySelector('[data-iqai-launcher="layers"]')?.click()`);
  await sleep(400);
  const discoverUi = await evaluateJson(send, `{
    title: document.querySelector('[data-iqai-layers-drawer] h2')?.textContent || null,
    scenes: [...document.querySelectorAll('[data-iqai-scene]')].map((n) => n.getAttribute('data-iqai-scene')),
    allOff: Boolean(document.querySelector('[data-iqai-discover-action="all-off"]')),
    restore: Boolean(document.querySelector('[data-iqai-discover-action="restore"]')),
    solo: Boolean(document.querySelector('[data-iqai-discover-action="solo"]')),
    configure: Boolean(document.querySelector('[data-iqai-discover-action="configure"]')),
    families: [...document.querySelectorAll('[data-iqai-discover-family]')].map((n) => n.getAttribute('data-iqai-discover-family'))
  }`);

  const snap0 = await evaluateJson(send, `window.__iqaiSpatialV2.opsLayers.snapshot()`);
  const sceneResults = {};
  for (const id of SCENES) {
    const applied = await evaluateJson(send, `window.__iqaiSpatialV2.opsLayers.applyScene('${id}')`, 120000);
    const snap = await evaluateJson(send, `window.__iqaiSpatialV2.opsLayers.snapshot()`);
    sceneResults[id] = {
      applied: Boolean(applied?.id === id || snap?.activeSceneId === id),
      exact: snap?.sceneExact === true,
      visible: snap?.visible || [],
      briefForbidden: /risk score|threat score/i.test(JSON.stringify(snap?.brief?.facts || [])) === false
    };
  }

  await evaluateJson(send, `window.__iqaiSpatialV2.opsLayers.applyScene('public-safety')`, 120000);
  const beforeOff = await evaluateJson(send, `window.__iqaiSpatialV2.opsLayers.snapshot().visible`);
  await evaluateJson(send, `window.__iqaiSpatialV2.opsLayers.allOff()`, 120000);
  const afterOff = await evaluateJson(send, `window.__iqaiSpatialV2.opsLayers.snapshot()`);
  await evaluateJson(send, `window.__iqaiSpatialV2.opsLayers.restore()`, 120000);
  const afterRestore = await evaluateJson(send, `window.__iqaiSpatialV2.opsLayers.snapshot()`);
  await evaluateJson(send, `window.__iqaiSpatialV2.opsLayers.solo('fire')`, 120000);
  const afterSolo = await evaluateJson(send, `window.__iqaiSpatialV2.opsLayers.snapshot()`);
  const configured = ['recent-crime', 'pdq'];
  await evaluateJson(send, `(async () => {
    window.__iqaiSpatialV2.opsLayers.saveConfigure('public-safety', ${JSON.stringify(configured)});
    await window.__iqaiSpatialV2.opsLayers.applyScene('public-safety');
    return true;
  })()`, 120000);
  const afterConfig = await evaluateJson(send, `window.__iqaiSpatialV2.opsLayers.snapshot()`);
  await evaluateJson(send, `(async () => {
    window.__iqaiSpatialV2.opsLayers.resetConfigure('public-safety');
    await window.__iqaiSpatialV2.opsLayers.applyScene('public-safety');
    return true;
  })()`, 120000);

  await evaluateJson(send, `window.__iqaiSpatialV2.opsLayers.setVisible('fire', true)`, 60000);
  const infoOpen = await evaluateJson(send, `document.querySelector('[data-iqai-layer-info-open="fire"]')?.click() || true`);
  await sleep(300);
  const infoUi = await evaluateJson(send, `{
    open: Boolean(document.querySelector('[data-iqai-layer-info]')),
    text: document.querySelector('[data-iqai-layer-info]')?.innerText || ''
  }`);

  await evaluateJson(send, `window.__iqaiSpatialV2.opsLayers.allOff()`, 120000);
  await setWoaVisible(send, 'hydrant', false);
  await setWoaVisible(send, 'traffic_signal', false);
  const hydrantHidden = await acquireClass(send, FIX.hydrant);
  await setWoaVisible(send, 'hydrant', true);
  await setWoaVisible(send, 'traffic_signal', false);
  const hydrant = await acquireClass(send, FIX.hydrant);
  await setWoaVisible(send, 'hydrant', false);
  await setWoaVisible(send, 'traffic_signal', true);
  const signal = await acquireClass(send, FIX.traffic_signal);

  const woa = await evaluateJson(send, `window.__iqaiSpatialV2.focusInstrument.getState()?.objectRef?.kind || window.__iqaiSpatialV2.focusInstrument.snapshot?.()?.acquired?.objectClass || null`);
  await evaluateJson(send, `window.__iqaiSpatialV2.placeCamera?.arm?.()`);
  const placeArmed = await evaluateJson(send, `window.__iqaiSpatialV2.placeCamera?.snapshot?.()?.armed === true || window.__iqaiSpatialV2.focusInstrument.getState()?.clickOwner === 'place-camera'`);
  await evaluateJson(send, `window.__iqaiSpatialV2.placeCamera?.disarm?.()`);
  const focusOk = await evaluateJson(send, `Boolean(window.__iqaiSpatialV2.dropPin)`);
  const createBefore = await evaluateJson(send, `window.__iqaiSpatialV2.mapViewCreateCount`);
  await evaluateJson(send, `document.querySelector('[data-iqai-view="3D VISUAL"]')?.click()`);
  await sleep(800);
  const visualOpen = await evaluateJson(send, `window.__iqaiSpatialV2.google3d?.snapshot?.()?.open === true || document.querySelector('[data-iqai-pane="3D VISUAL"]')?.hidden === false`);
  await evaluateJson(send, `void window.__iqaiSpatialV2.street360.open()`);
  await waitUntil(send, `['OPEN','UNAVAILABLE','OPENING'].includes(window.__iqaiSpatialV2.street360?.snapshot?.()?.stageState)`, 40, 400);
  const streetState = await evaluateJson(send, `window.__iqaiSpatialV2.street360?.snapshot?.()?.stageState || null`);
  const createAfter = await evaluateJson(send, `window.__iqaiSpatialV2.mapViewCreateCount`);
  const ais = await evaluateJson(send, `{
    env: Boolean(window.__IQAI_AIS_SPATIAL_STREAM),
    autostart: document.body?.innerText?.includes?.('AISStream') ? 'unknown' : 'off-default'
  }`);
  const blocked = (snap0?.blocked || []).map((row) => `${row.id}:${row.status}`);

  const verdicts = {
    'LAYERS / DISCOVER': pass(discoverUi?.title?.includes('DISCOVER') && discoverUi.scenes?.includes('public-safety')),
    'PUBLIC SAFETY': pass(sceneResults['public-safety']?.applied && sceneResults['public-safety']?.briefForbidden),
    MOVEMENT: pass(sceneResults.movement?.applied && sceneResults.movement?.briefForbidden),
    INFRASTRUCTURE: pass(sceneResults.infrastructure?.applied && sceneResults.infrastructure?.briefForbidden),
    'WEATHER IMPACT': pass(sceneResults['weather-impact']?.applied && sceneResults['weather-impact']?.briefForbidden),
    WILDFIRE: pass(sceneResults.wildfire?.applied && sceneResults.wildfire?.briefForbidden),
    'POLICE PICTURE': pass(sceneResults['police-picture']?.applied && sceneResults['police-picture']?.briefForbidden),
    'ALL OFF': pass(Array.isArray(beforeOff) && beforeOff.length > 0 && afterOff?.visible?.length === 0),
    RESTORE: pass(Array.isArray(afterRestore?.visible) && afterRestore.visible.length === beforeOff.length),
    SOLO: pass(afterSolo?.visible?.length === 1 && afterSolo.visible[0] === 'fire'),
    CONFIGURE: pass(Array.isArray(afterConfig?.visible) && afterConfig.visible.length === 2 && afterConfig.visible.includes('recent-crime')),
    'LAYER INFO': pass(Boolean(infoUi?.text) && /WHAT IS THIS|STATUS|SOURCE|LIMIT/i.test(infoUi.text)),
    'INTELLIGENCE BRIEF': pass(Object.values(sceneResults).every((row) => row.briefForbidden)),
    'HYDRANT VISIBILITY + WOA ACQUIRE': pass(hydrantHidden?.acquiredClass !== 'hydrant' && (hydrant?.acquiredClass === 'hydrant' || hydrant?.objectRef?.kind === 'hydrant')),
    'TRAFFIC SIGNAL VISIBILITY + WOA ACQUIRE': pass(signal?.acquiredClass === 'traffic_signal' || signal?.objectRef?.kind === 'traffic_signal'),
    'WOA REGRESSION': pass(Boolean(woa) || hydrant?.acquiredClass === 'hydrant'),
    'PLACE CAMERA': pass(placeArmed === true),
    FOCUS: pass(focusOk === true),
    STREET360: pass(['OPEN', 'UNAVAILABLE', 'OPENING'].includes(streetState)),
    'GOOGLE 3D VISUAL': pass(visualOpen === true),
    WORLDVIEW: pass(true)
  };

  return {
    mapReady,
    woaReady,
    discoverUi,
    sceneResults,
    beforeOff,
    afterOff: afterOff?.visible,
    afterRestore: afterRestore?.visible,
    afterSolo: afterSolo?.visible,
    afterConfig: afterConfig?.visible,
    infoUi,
    hydrantHidden: hydrantHidden?.acquiredClass || hydrantHidden?.objectRef?.kind || null,
    hydrant: hydrant?.acquiredClass || hydrant?.objectRef?.kind || null,
    signal: signal?.acquiredClass || signal?.objectRef?.kind || null,
    placeArmed,
    streetState,
    visualOpen,
    createBefore,
    createAfter,
    ais,
    blocked,
    solarPresent: snap0?.solarPresent === true,
    hydrantInCatalog: snap0?.hydrantInCatalog === true,
    verdicts
  };
});

const worldViewPass = report.createBefore === 1 && report.createAfter === 1;
report.verdicts.WORLDVIEW = worldViewPass ? 'PASS' : 'FAIL';
report.verdicts.MAPVIEW = worldViewPass ? 'PASS' : 'FAIL';
const failed = Object.values(report.verdicts).filter((value) => value !== 'PASS');
const out = {
  result: failed.length ? (failed.length <= 4 ? 'PARTIAL' : 'FAIL') : 'PASS',
  catalogHttp: {
    ok: catalogHttp?.ok !== false && Array.isArray(catalogHttp?.layers),
    layerCount: catalogHttp?.layers?.length || 0,
    error: catalogHttp?.error || catalogHttp?.message || null
  },
  ...report
};
fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(out, null, 2));
console.log(JSON.stringify({
  result: out.result,
  verdicts: out.verdicts,
  mapViewCreateCount: out.createAfter,
  ais: out.ais,
  out: OUT
}, null, 2));
process.exit(out.result === 'FAIL' ? 1 : 0);
