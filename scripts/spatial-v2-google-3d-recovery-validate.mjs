/**
 * Live acceptance for donor Google 3D recovery on :3047.
 * MAP + Focus, 3D, return MAP, repeat. Redacts keys.
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
const PORT = 3047;
const FOCUS = { lon: -73.73312, lat: 45.52354 };

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
    const result = await fn(send, logs);
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

async function probe(send) {
  const result = await send('Runtime.evaluate', {
    expression: `JSON.stringify({
      spatialView: document.getElementById('iqai-spatial-v2')?.dataset.iqaiSpatialView || null,
      mapState: document.querySelector('[data-iqai-map-state]')?.getAttribute('data-iqai-map-state') || null,
      iframe: Boolean(document.querySelector('iframe[data-iqai-google-3d-frame]')),
      gmp: (() => {
        const el = document.querySelector('gmp-map-3d');
        return el ? { w: el.offsetWidth, h: el.offsetHeight } : null;
      })(),
      gmErr: document.querySelector('.gm-err-message')?.textContent || null,
      authFail: Boolean(window.__iqaiGmAuthFailure),
      createCount: window.__iqaiSpatialV2?.mapViewCreateCount ?? null,
      focus: (() => {
        const f = window.__iqaiSpatialV2?.world?.()?.activeFocus || window.__iqaiSpatialV2?.dropPin?.snapshot?.()?.focus;
        const lon = f?.longitude ?? f?.geometry?.coordinates?.[0] ?? null;
        const lat = f?.latitude ?? f?.geometry?.coordinates?.[1] ?? null;
        return { lon, lat };
      })(),
      visual: (() => {
        const snap = window.__iqaiSpatialV2?.google3d?.snapshot?.() || {};
        return {
          open: snap.open,
          stageState: snap.stageState,
          maps3dLoaded: snap.maps3dLoaded,
          markerPresent: snap.markerPresent,
          error: snap.error || null
        };
      })()
    })`,
    returnByValue: true
  });
  try { return JSON.parse(result.result?.value || '{}'); } catch { return { raw: result.result?.value }; }
}

if (!(await isPortOpen(PORT))) {
  console.log(JSON.stringify({ error: '3047 not listening' }));
  process.exit(1);
}

const browserPath = findBrowser();
const live = await withCdpPage(browserPath, 9299, async (send, logs) => {
  await send('Page.addScriptToEvaluateOnNewDocument', {
    source: `window.gm_authFailure = function () { window.__iqaiGmAuthFailure = true; };`
  });
  await send('Page.navigate', { url: `http://localhost:${PORT}/spatial-v2/?v=3d-donor-1` });
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
  if (state !== 'READY') {
    return { state, screenshots: { map: await shot(send, 'recovery-map-focus.png') }, logs };
  }
  await send('Runtime.evaluate', {
    expression: `(() => { try { void window.__iqaiSpatialV2?.dropPin?.placeFocus?.(${FOCUS.lon}, ${FOCUS.lat}, 'map'); } catch {} return true; })()`,
    returnByValue: true
  });
  await sleep(1500);
  const mapFocus = await probe(send);
  const mapShot = await shot(send, 'recovery-map-focus.png');

  await send('Runtime.evaluate', {
    expression: `document.querySelector('[data-iqai-view="3D VISUAL"]')?.click()`,
    returnByValue: true
  });
  for (let i = 0; i < 25; i += 1) {
    const now = await probe(send);
    if (now.gmp || now.gmErr || now.visual?.stageState === 'ERROR') break;
    await sleep(1000);
  }
  await sleep(8000);
  const first3d = await probe(send);
  const first3dShot = await shot(send, 'recovery-3d.png');

  await send('Runtime.evaluate', {
    expression: `document.querySelector('[data-iqai-view="MAP"]')?.click()`,
    returnByValue: true
  });
  await sleep(2000);
  const returned = await probe(send);
  const returnedShot = await shot(send, 'recovery-map-return.png');

  await send('Runtime.evaluate', {
    expression: `document.querySelector('[data-iqai-view="3D VISUAL"]')?.click()`,
    returnByValue: true
  });
  await sleep(8000);
  const second3d = await probe(send);
  const second3dShot = await shot(send, 'recovery-3d-repeat.png');

  await send('Runtime.evaluate', {
    expression: `document.querySelector('[data-iqai-view="MAP"]')?.click()`,
    returnByValue: true
  });
  await sleep(1500);
  const finalMap = await probe(send);

  return {
    state,
    mapFocus,
    first3d,
    returned,
    second3d,
    finalMap,
    screenshots: {
      map: mapShot,
      visual3d: first3dShot,
      mapReturn: returnedShot,
      visual3dRepeat: second3dShot
    },
    googleErrorKinds: [...new Set(logs.flatMap((row) => row.kinds || []))],
    googleLogs: logs.filter((row) => row.kinds?.length || /google|maps js|oops|auth/i.test(row.text)).slice(0, 20)
  };
});

const report = { origin: `http://localhost:${PORT}/spatial-v2/`, live };
fs.writeFileSync(path.join(OUT, 'recovery-validate.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
