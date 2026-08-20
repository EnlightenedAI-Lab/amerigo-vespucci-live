/**
 * Live proof: BRAIN → governed MAP action V1 on Spatial V2 :3047.
 * Does not commit, push, deploy, restart, or write Portal. Leaves :3047 running.
 */
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';
import { filterHydrantsWithin } from '../public/spatial-v2/map/woa/hydrant-within.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'artifacts', 'spatial-v2-governed-map-action-v1');
const PORT = 3047;
const URL = `http://localhost:${PORT}/spatial-v2/`;
const HERE = Object.freeze({ longitude: -73.56832, latitude: 45.50169 });
const COMMAND = 'Show hydrants within 500 m of here.';
const HYDRANTS = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/spatial-v2/data/woa/hydrants.geojson'), 'utf8'));
const EXPECTED = filterHydrantsWithin(HYDRANTS, HERE, 500);

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
    const send = (method, params = {}) => {
      nextId += 1;
      const id = nextId;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          ws.off('message', onMessage);
          reject(new Error(`${method}: timeout`));
        }, 30000);
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
    const result = await fn(send);
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

async function evaluateJson(send, expression) {
  const result = await send('Runtime.evaluate', {
    expression: `(async () => {
      const value = ${expression};
      return await value;
    })()`,
    returnByValue: true,
    awaitPromise: true
  });
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

if (!(await isPortOpen(PORT))) {
  console.log(JSON.stringify({ error: '3047 not listening', result: 'FAIL' }));
  process.exit(1);
}

const browserPath = findBrowser();
if (!browserPath) {
  console.log(JSON.stringify({ error: 'No Chrome/Edge', result: 'FAIL' }));
  process.exit(1);
}

const report = await withCdpPage(browserPath, 9257, async (send) => {
  await send('Page.navigate', { url: URL });
  await waitUntil(send, `Boolean(document.querySelector('#iqai-spatial-v2'))`, 40, 250);
  const mapPresent = await waitUntil(send, `Number(window.__iqaiSpatialV2?.mapFoundation?.getMapViewCreateCount?.() || window.__iqaiSpatialV2?.mapViewCreateCount || 0) === 1`, 90, 400);
  const mapReady = await waitUntil(send, `window.__iqaiSpatialV2?.mapFoundation?.getState?.() === 'READY' || document.querySelector('[data-iqai-map-state="READY"]') != null`, 8, 400);
  if (!mapPresent) {
    const diag = await evaluateJson(send, `({
      createCount: window.__iqaiSpatialV2?.mapViewCreateCount || window.__iqaiSpatialV2?.mapFoundation?.getMapViewCreateCount?.() || null,
      foundation: window.__iqaiSpatialV2?.mapFoundation?.getState?.() || null,
      attr: document.querySelector('[data-iqai-map-state]')?.getAttribute('data-iqai-map-state') || null
    })`);
    return { mapReady: false, mapPresent: false, error: 'MAPVIEW_NOT_CREATED', diag };
  }
  await evaluateJson(send, `(async () => {
    const view = window.__iqaiSpatialV2?.mapFoundation?.getView?.();
    if (view?.goTo) {
      await view.goTo({ center: [${HERE.longitude}, ${HERE.latitude}], zoom: 16 }, { animate: false });
    }
    await window.__iqaiSpatialV2?.dropPin?.placeFromSearch?.({
      longitude: ${HERE.longitude},
      latitude: ${HERE.latitude},
      address: 'Montreal operator pin'
    });
    document.querySelector('[data-iqai-ask-toggle]')?.click();
    const input = document.querySelector('[data-iqai-ask-form] [name="ask"]');
    if (input) input.value = ${JSON.stringify(COMMAND)};
    return true;
  })()`);
  await sleep(400);
  const beforeAsk = await evaluateJson(send, `({
    mapViewCreateCount: window.__iqaiSpatialV2?.mapFoundation?.getMapViewCreateCount?.() || window.__iqaiSpatialV2?.mapViewCreateCount || null,
    pending: window.__iqaiSpatialV2?.governedMapAction?.snapshot?.()?.pending || null,
    last: window.__iqaiSpatialV2?.governedMapAction?.snapshot?.()?.last || null,
    readout: document.querySelector('[data-iqai-governed-map-readout]')?.textContent || null,
    confirmOpen: document.querySelector('[data-iqai-ask-confirm]')?.hidden === false,
    remoteSensing: Boolean(document.querySelector('[data-iqai-remote-sensing-toggle]')),
    brain: Boolean(document.querySelector('[data-iqai-brain-host], [data-iqai-slot="ask-iqai-dock"]')),
    pin: window.__iqaiSpatialV2?.dropPin?.snapshot?.()?.focus || null
  })`);
  const proposed = await evaluateJson(send, `window.__iqaiSpatialV2.ask.execute(${JSON.stringify({ text: COMMAND })})`);
  await sleep(250);
  const confirmation = await evaluateJson(send, `({
    title: document.querySelector('[data-iqai-ask-confirm-title]')?.textContent || null,
    status: document.querySelector('[data-iqai-ask-status]')?.textContent || null,
    confirmOpen: document.querySelector('[data-iqai-ask-confirm]')?.hidden === false,
    pending: window.__iqaiSpatialV2?.governedMapAction?.snapshot?.()?.pending || null,
    last: window.__iqaiSpatialV2?.governedMapAction?.snapshot?.()?.last || null,
    readout: document.querySelector('[data-iqai-governed-map-readout]')?.textContent || null
  })`);
  await shot(send, '01-confirmation.png');
  await evaluateJson(send, `(async () => {
    const button = document.querySelector('[data-iqai-ask-confirm-yes]');
    if (button) {
      button.click();
      await new Promise((resolve) => setTimeout(resolve, 250));
      return 'clicked';
    }
    await window.__iqaiSpatialV2.ask.confirm();
    return 'api';
  })()`);
  await waitUntil(send, `Boolean(window.__iqaiSpatialV2?.governedMapAction?.snapshot?.()?.last?.count)`, 40, 250);
  await sleep(800);
  await evaluateJson(send, `(() => {
    const placeholder = document.querySelector('[data-iqai-map-placeholder]');
    const errorPanel = document.querySelector('[data-iqai-map-error]');
    if (placeholder) placeholder.hidden = true;
    if (errorPanel) errorPanel.hidden = true;
    return true;
  })()`);
  await sleep(400);
  const after = await evaluateJson(send, `({
    mapViewCreateCount: window.__iqaiSpatialV2?.mapFoundation?.getMapViewCreateCount?.() || window.__iqaiSpatialV2?.mapViewCreateCount || null,
    last: window.__iqaiSpatialV2?.governedMapAction?.snapshot?.()?.last || null,
    pending: window.__iqaiSpatialV2?.governedMapAction?.snapshot?.()?.pending || null,
    readout: document.querySelector('[data-iqai-governed-map-readout]')?.textContent || null,
    overlay: document.querySelector('#iqai-v2-governed-map-action, [data-iqai-governed-map-readout]') != null,
    remoteSensing: Boolean(document.querySelector('[data-iqai-remote-sensing-toggle]')),
    brain: Boolean(document.querySelector('[data-iqai-brain-host], [data-iqai-slot="ask-iqai-dock"]')),
    askState: document.querySelector('[data-iqai-ask-status]')?.textContent || null,
    confirmHidden: document.querySelector('[data-iqai-ask-confirm]')?.hidden !== false
  })`);
  await shot(send, '02-executed.png');
  return { mapReady, mapPresent, beforeAsk, proposed, confirmation, after };
});

const count = report?.after?.last?.count;
const source = report?.after?.last?.source || {};
const confirmationTitle = report?.confirmation?.title || report?.proposed?.result?.confirmationTitle;
const silent = report?.confirmation?.last == null && report?.confirmation?.readout == null;
const pass = (report.mapPresent === true || report.mapReady === true)
  && report.after?.mapViewCreateCount === 1
  && confirmationTitle === 'SHOW HYDRANTS WITHIN 500 M'
  && report.confirmation?.confirmOpen === true
  && silent === true
  && count === EXPECTED.length
  && EXPECTED.length > 0
  && source.provider === 'Ville de Montréal'
  && /Bornes d'incendie/.test(source.dataset || '')
  && String(report.after?.readout || '').includes('500 M')
  && Number(report.after?.last?.paint?.graphicCount) >= count + 1
  && report.after?.remoteSensing === true
  && report.after?.brain === true;

const out = {
  result: pass ? 'PASS' : 'FAIL',
  command: COMMAND,
  expectedCount: EXPECTED.length,
  liveCount: count ?? null,
  source,
  confirmationTitle: confirmationTitle || null,
  mapViewCreateCount: report.after?.mapViewCreateCount ?? report.beforeAsk?.mapViewCreateCount ?? null,
  silentUntilConfirm: silent,
  remoteSensing: report.after?.remoteSensing === true,
  brain: report.after?.brain === true,
  screenshots: {
    confirmation: path.join(OUT, '01-confirmation.png'),
    executed: path.join(OUT, '02-executed.png')
  },
  report
};

fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
process.exit(pass ? 0 : 1);
