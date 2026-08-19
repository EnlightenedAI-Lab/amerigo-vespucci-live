import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';

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
  try { return fs.existsSync(file); } catch { return false; }
}

function findBrowser() {
  return [
    process.env.EDGE_PATH,
    process.env.CHROME_PATH,
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
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

function sanitize(text) {
  return String(text || '')
    .replace(/key=[^&\s"']+/gi, 'key=REDACTED')
    .replace(/AIza[0-9A-Za-z_-]{20,}/g, 'REDACTED_KEY')
    .slice(0, 240);
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
    ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg.method === 'Target.attachedToTarget') {
        const sid = msg.params?.sessionId;
        const info = msg.params?.targetInfo || {};
        logs.push({ type: 'info', text: sanitize(`attached ${info.type || ''} ${info.url || ''}`) });
        if (sid) {
          nextId += 1;
          ws.send(JSON.stringify({
            id: nextId,
            method: 'Runtime.enable',
            sessionId: sid,
            params: {}
          }));
        }
      }
      if (msg.method === 'Runtime.consoleAPICalled') {
        const text = (msg.params?.args || []).map((arg) => sanitize(arg.value || arg.description || '')).join(' ');
        logs.push({ type: msg.params?.type, text });
      }
      if (msg.method === 'Runtime.exceptionThrown') {
        logs.push({
          type: 'exception',
          text: sanitize(msg.params?.exceptionDetails?.text || msg.params?.exceptionDetails?.exception?.description)
        });
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
    await send('Target.setAutoAttach', {
      autoAttach: true,
      waitForDebuggerOnStart: false,
      flatten: true
    });
    const result = await fn(send, logs);
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

if (!(await isPortOpen(LIVE_PORT))) {
  console.log(JSON.stringify({ error: '3047 not listening' }));
  process.exit(1);
}

const config = JSON.parse((await request(`http://localhost:${LIVE_PORT}/api/spatial/config`)).body);
const browserPath = findBrowser();
const live = await withCdpPage(browserPath, 9271, async (send, logs) => {
  await send('Page.addScriptToEvaluateOnNewDocument', {
    source: `window.gm_authFailure = function () { window.__iqaiGmAuthFailure = true; };`
  });
  await send('Page.navigate', { url: `http://localhost:${LIVE_PORT}/spatial-v2/` });
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
      expression: `document.querySelector('[data-iqai-view="3D VISUAL"]')?.click()`,
      returnByValue: true
    });
  }
  let parsed = {};
  if (state === 'READY') {
    for (let i = 0; i < 55; i += 1) {
      const probe = await send('Runtime.evaluate', {
        expression: `JSON.stringify({
      origin: location.origin,
      spatialView: document.getElementById('iqai-spatial-v2')?.dataset.iqaiSpatialView || null,
      iframe: Boolean(document.querySelector('iframe[data-iqai-google-3d-frame]')),
      iframeSrc: document.querySelector('iframe[data-iqai-google-3d-frame]')?.getAttribute('src') || null,
      stage: (() => {
        const host = document.querySelector('[data-iqai-google-3d-stage]');
        return host ? { hidden: host.hidden, w: host.offsetWidth, h: host.offsetHeight } : null;
      })(),
      gmErrParent: Boolean(document.querySelector('.gm-err-container, .gm-err-message')),
      gmErrFrame: (() => {
        const frame = document.querySelector('iframe[data-iqai-google-3d-frame]');
        try {
          return Boolean(frame?.contentDocument?.querySelector('.gm-err-container, .gm-err-message'));
        } catch {
          return 'blocked';
        }
      })(),
      frame: (() => {
        const frame = document.querySelector('iframe[data-iqai-google-3d-frame]');
        try {
          const doc = frame?.contentDocument;
          const win = frame?.contentWindow;
          const el = doc?.querySelector('gmp-map-3d');
          return {
            hasDoc: Boolean(doc),
            ready: doc?.readyState || null,
            importLibrary: typeof win?.google?.maps?.importLibrary,
            phase: win?.__iqaiGoogle3dFrame?.phase || null,
            gmp: el ? { w: el.offsetWidth, h: el.offsetHeight } : null,
            authFail: Boolean(win?.__iqaiGmAuthFailure),
            bodyText: String(doc?.body?.innerText || '').slice(0, 160)
          };
        } catch (error) {
          return { hasDoc: false, error: String(error?.message || error) };
        }
      })(),
      notice: document.querySelector('[data-iqai-view-notice]')?.hidden ? null : (document.querySelector('[data-iqai-view-notice]')?.textContent || null),
      visual: (() => {
        const snap = window.__iqaiSpatialV2?.google3d?.snapshot?.() || {};
        return {
          open: snap.open,
          stageState: snap.stageState,
          maps3dLoaded: snap.maps3dLoaded,
          markerPresent: snap.markerPresent,
          steady: snap.steady,
          error: snap.error || null
        };
      })(),
      createCount: window.__iqaiSpatialV2?.mapViewCreateCount ?? null
    })`,
        returnByValue: true
      });
      try { parsed = JSON.parse(probe.result?.value || '{}'); } catch { parsed = { raw: probe.result?.value }; }
      const stageState = parsed.visual?.stageState;
      if (stageState === 'ERROR' || stageState === 'IDLE') break;
      if (stageState === 'OPEN' && parsed.visual?.steady === true) break;
      await sleep(1000);
    }
    if (parsed.visual?.stageState === 'OPEN' && parsed.visual?.steady !== true) {
      await sleep(15000);
      const probe = await send('Runtime.evaluate', {
        expression: `JSON.stringify({
      origin: location.origin,
      spatialView: document.getElementById('iqai-spatial-v2')?.dataset.iqaiSpatialView || null,
      iframe: Boolean(document.querySelector('iframe[data-iqai-google-3d-frame]')),
      iframeSrc: document.querySelector('iframe[data-iqai-google-3d-frame]')?.getAttribute('src') || null,
      stage: (() => {
        const host = document.querySelector('[data-iqai-google-3d-stage]');
        return host ? { hidden: host.hidden, w: host.offsetWidth, h: host.offsetHeight } : null;
      })(),
      gmErrParent: Boolean(document.querySelector('.gm-err-container, .gm-err-message')),
      gmErrFrame: (() => {
        const frame = document.querySelector('iframe[data-iqai-google-3d-frame]');
        try {
          return Boolean(frame?.contentDocument?.querySelector('.gm-err-container, .gm-err-message'));
        } catch {
          return 'blocked';
        }
      })(),
      frame: (() => {
        const frame = document.querySelector('iframe[data-iqai-google-3d-frame]');
        try {
          const doc = frame?.contentDocument;
          const win = frame?.contentWindow;
          const el = doc?.querySelector('gmp-map-3d');
          return {
            hasDoc: Boolean(doc),
            ready: doc?.readyState || null,
            importLibrary: typeof win?.google?.maps?.importLibrary,
            phase: win?.__iqaiGoogle3dFrame?.phase || null,
            gmp: el ? { w: el.offsetWidth, h: el.offsetHeight } : null,
            authFail: Boolean(win?.__iqaiGmAuthFailure),
            bodyText: String(doc?.body?.innerText || '').slice(0, 160)
          };
        } catch (error) {
          return { hasDoc: false, error: String(error?.message || error) };
        }
      })(),
      notice: document.querySelector('[data-iqai-view-notice]')?.hidden ? null : (document.querySelector('[data-iqai-view-notice]')?.textContent || null),
      visual: (() => {
        const snap = window.__iqaiSpatialV2?.google3d?.snapshot?.() || {};
        return {
          open: snap.open,
          stageState: snap.stageState,
          maps3dLoaded: snap.maps3dLoaded,
          markerPresent: snap.markerPresent,
          steady: snap.steady,
          error: snap.error || null
        };
      })(),
      createCount: window.__iqaiSpatialV2?.mapViewCreateCount ?? null
    })`,
        returnByValue: true
      });
      try { parsed = JSON.parse(probe.result?.value || '{}'); } catch { parsed = { raw: probe.result?.value }; }
    }
  }
  const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  const file = path.join(OUT, 'iqai-spatial-worldview-3d-frame-diagnose.png');
  fs.writeFileSync(file, Buffer.from(shot.data, 'base64'));
  return { state, parsed, screenshot: file, logs: logs.slice(0, 40), logCount: logs.length };
});

const report = {
  originUnderTest: `http://localhost:${LIVE_PORT}`,
  googleConfigured: Boolean(config?.streetLevelContext?.configured),
  googleKeyPresent: Boolean(config?.streetLevelContext?.googleMapsBrowserApiKey),
  live
};
fs.writeFileSync(path.join(OUT, 'google-paint-diagnose.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
