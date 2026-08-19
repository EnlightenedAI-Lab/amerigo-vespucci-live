/**
 * Forensic capture of the live Google Maps JS error for 3D recovery.
 * Redacts keys. Does not change product code.
 */
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'artifacts', 'spatial-v2-google-3d-recovery');
const PORT = Number(process.env.FORENSIC_PORT || 3047);
const VIEW_CLICK = process.env.FORENSIC_VIEW
  || (PORT === 3000 ? '[data-iqai-view="3d-visual"]' : '[data-iqai-view="3D VISUAL"]');

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

function errorKinds(text) {
  const hay = String(text || '');
  return [
    'RefererNotAllowedMapError',
    'InvalidKeyMapError',
    'ApiNotActivatedMapError',
    'BillingNotEnabledMapError',
    'ExpiredKeyMapError',
    'DeletedKeyMapError',
    'ClientIdAndAppIdMismatchMapError',
    'UnauthorizedURLForClientIdMapError',
    'InvalidKeyOrUnauthorizedURLMapError',
    'MalformedOriginOrPathMapError',
    'ProjectDeniedMapError',
    'ApiTargetBlockedMapError',
    'gm_authFailure'
  ].filter((kind) => hay.includes(kind));
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

function isPortOpen(port) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ port, host: '127.0.0.1' });
    socket.once('connect', () => { socket.end(); resolve(true); });
    socket.once('error', () => resolve(false));
    socket.setTimeout(1500, () => { socket.destroy(); resolve(false); });
  });
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
        logs.push({ type: msg.params?.type, text, kinds: errorKinds(text) });
      }
      if (msg.method === 'Runtime.exceptionThrown') {
        const text = sanitize(
          msg.params?.exceptionDetails?.text
          || msg.params?.exceptionDetails?.exception?.description
        );
        logs.push({ type: 'exception', text, kinds: errorKinds(text) });
      }
      if (msg.method === 'Network.requestWillBeSent') {
        const url = sanitize(msg.params?.request?.url || '');
        if (/maps\.googleapis|maps\.gstatic|google\.com\/maps/i.test(url)) {
          network.push({
            type: 'request',
            method: msg.params?.request?.method,
            url: url.slice(0, 280)
          });
        }
      }
      if (msg.method === 'Network.responseReceived') {
        const url = sanitize(msg.params?.response?.url || '');
        if (/maps\.googleapis|maps\.gstatic|google\.com\/maps/i.test(url)) {
          network.push({
            type: 'response',
            status: msg.params?.response?.status,
            url: url.slice(0, 280)
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
        }, 25000);
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
    const result = await fn(send, logs, network);
    ws.close();
    return result;
  } finally {
    child.kill();
  }
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
    req.on('timeout', () => { req.destroy(); reject(new Error(`timeout ${url}`)); });
    req.on('error', reject);
  });
}

if (!(await isPortOpen(PORT))) {
  console.log(JSON.stringify({ error: `${PORT} not listening` }));
  process.exit(1);
}

const config = JSON.parse((await request(`http://localhost:${PORT}/api/spatial/config`)).body);
const key = String(config?.streetLevelContext?.googleMapsBrowserApiKey || '').trim();
const browserPath = findBrowser();
const live = await withCdpPage(browserPath, 9288 + PORT, async (send, logs, network) => {
  await send('Page.addScriptToEvaluateOnNewDocument', {
    source: `window.gm_authFailure = function () { window.__iqaiGmAuthFailure = true; };`
  });
  await send('Page.navigate', { url: `http://localhost:${PORT}/spatial-v2/` });
  let state = 'INITIALIZING';
  for (let i = 0; i < 45; i += 1) {
    const result = await send('Runtime.evaluate', {
      expression: `document.querySelector('[data-iqai-map-state]')?.getAttribute('data-iqai-map-state') || 'WAITING'`,
      returnByValue: true
    });
    state = result.result?.value || 'WAITING';
    if (state === 'READY' || state === 'ERROR') break;
    await sleep(1000);
  }
  if (state === 'READY') {
    await send('Runtime.evaluate', {
      expression: `(() => { try { void window.__iqaiSpatialV2?.dropPin?.placeFocus?.(-73.73312, 45.52354, 'map'); } catch {} return true; })()`,
      returnByValue: true
    });
    await sleep(1500);
    await send('Runtime.evaluate', {
      expression: `document.querySelector(${JSON.stringify(VIEW_CLICK)})?.click()`,
      returnByValue: true
    });
    await sleep(12000);
  }
  const probe = await send('Runtime.evaluate', {
    expression: `JSON.stringify({
      origin: location.origin,
      href: location.href,
      spatialView: document.getElementById('iqai-spatial-v2')?.dataset.iqaiSpatialView || null,
      authFail: Boolean(window.__iqaiGmAuthFailure),
      gmErr: document.querySelector('.gm-err-message')?.textContent || null,
      gmErrFrame: (() => {
        const frame = document.querySelector('iframe[data-iqai-google-3d-frame]');
        try {
          return frame?.contentDocument?.querySelector('.gm-err-message')?.textContent || null;
        } catch {
          return 'blocked';
        }
      })(),
      iframe: Boolean(document.querySelector('iframe[data-iqai-google-3d-frame]')),
      gmpParent: Boolean(document.querySelector('gmp-map-3d')),
      gmpFrame: Boolean(document.querySelector('iframe[data-iqai-google-3d-frame]')?.contentDocument?.querySelector('gmp-map-3d')),
      createCount: window.__iqaiSpatialV2?.mapViewCreateCount ?? null,
      visual: window.__iqaiSpatialV2?.google3d?.snapshot?.() || null
    })`,
    returnByValue: true
  });
  let parsed = {};
  try { parsed = JSON.parse(probe.result?.value || '{}'); } catch { parsed = { raw: probe.result?.value }; }
  if (parsed.visual) {
    parsed.visual = {
      open: parsed.visual.open,
      stageState: parsed.visual.stageState,
      maps3dLoaded: parsed.visual.maps3dLoaded,
      markerPresent: parsed.visual.markerPresent,
      steady: parsed.visual.steady,
      error: parsed.visual.error || null
    };
  }
  const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  const file = path.join(OUT, `forensic-${PORT}-3d.png`);
  fs.writeFileSync(file, Buffer.from(shot.data, 'base64'));
  const kinds = [...new Set(logs.flatMap((row) => row.kinds || []))];
  return {
    state,
    parsed,
    screenshot: file,
    googleErrorKinds: kinds,
    googleLogs: logs.filter((row) => row.kinds?.length || /google|maps js|oops|auth/i.test(row.text)).slice(0, 30),
    network: network.slice(0, 40),
    logCount: logs.length
  };
});

const report = {
  originUnderTest: `http://localhost:${PORT}/spatial-v2/`,
  viewClick: VIEW_CLICK,
  googleConfigured: Boolean(config?.streetLevelContext?.configured),
  googleKeyLen: key.length,
  googleKeyTail: key ? key.slice(-4) : null,
  live
};
fs.writeFileSync(path.join(OUT, `forensic-${PORT}.json`), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
