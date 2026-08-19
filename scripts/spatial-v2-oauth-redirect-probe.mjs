/**
 * Diagnose ArcGIS OAuth redirect_uri for WorldView on :3047.
 * Does not inject preauth. Does not write Portal.
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
const OUT = path.join(ROOT, 'artifacts', 'spatial-v2-oauth-redirect-probe');
const LIVE_PORT = 3047;

function exists(file) {
  try {
    return fs.existsSync(file);
  } catch {
    return false;
  }
}

function findBrowser() {
  return [
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
  ].find((file) => exists(file)) || null;
}

function isPortOpen(port) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ port, host: '127.0.0.1' });
    socket.once('connect', () => { socket.end(); resolve(true); });
    socket.once('error', () => resolve(false));
    socket.setTimeout(1500, () => { socket.destroy(); resolve(false); });
  });
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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function redirectFromUrl(url) {
  try {
    const parsed = new URL(url);
    const raw = parsed.searchParams.get('redirect_uri');
    return raw ? decodeURIComponent(raw) : null;
  } catch {
    const match = String(url).match(/redirect_uri=([^&]+)/i);
    return match ? decodeURIComponent(match[1]) : null;
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

fs.mkdirSync(OUT, { recursive: true });
const liveOn3047 = await isPortOpen(LIVE_PORT);
if (!liveOn3047) {
  console.log(JSON.stringify({ error: '3047 not listening' }, null, 2));
  process.exit(1);
}

const oauth = JSON.parse((await request(`http://localhost:${LIVE_PORT}/api/spatial/operational-map/oauth-config`)).body);
const browserPath = findBrowser();
const authorizeUrls = [];
const popupUrls = [];
let live = null;
let browserError = null;

if (browserPath) {
  try {
    const userDataDir = fs.mkdtempSync(path.join(OUT, 'browser-'));
    const debugPort = 9271;
    const child = spawn(browserPath, [
      `--remote-debugging-port=${debugPort}`,
      `--user-data-dir=${userDataDir}`,
      '--remote-allow-origins=*',
      '--no-first-run',
      '--no-default-browser-check',
      '--window-size=1280,800',
      'about:blank'
    ], { stdio: 'ignore' });
    try {
      const version = await waitForJson(`http://127.0.0.1:${debugPort}/json/version`);
      const ws = new WebSocket(version.webSocketDebuggerUrl);
      await new Promise((resolve, reject) => {
        ws.once('open', resolve);
        ws.once('error', reject);
      });
      ws.on('message', (raw) => {
        const msg = JSON.parse(raw.toString());
        const url = msg.params?.request?.url
          || msg.params?.targetInfo?.url
          || '';
        if (/oauth2\/authorize|invalid.?redirect|oauth-callback/i.test(url)) {
          authorizeUrls.push(url);
        }
        if (msg.method === 'Target.targetCreated' && msg.params?.targetInfo?.type === 'page') {
          popupUrls.push(msg.params.targetInfo.url || '');
        }
      });
      ws.send(JSON.stringify({ id: 1, method: 'Target.setDiscoverTargets', params: { discover: true } }));
      const created = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('createTarget timeout')), 8000);
        const onMessage = (raw) => {
          const msg = JSON.parse(raw.toString());
          if (msg.method === 'Target.targetCreated' && msg.params?.targetInfo?.type === 'page') {
            clearTimeout(timer);
            ws.off('message', onMessage);
            resolve(msg.params.targetInfo.targetId);
          }
        };
        ws.on('message', onMessage);
        ws.send(JSON.stringify({ id: 2, method: 'Target.createTarget', params: { url: 'about:blank' } }));
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
          params: { targetId: created, flatten: true }
        }));
      });
      let nextId = 10;
      const send = (method, params = {}) => {
        nextId += 1;
        const id = nextId;
        return new Promise((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error(`${method}: timeout`)), 20000);
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
      await send('Page.navigate', { url: `http://localhost:${LIVE_PORT}/spatial-v2/` });
      for (let i = 0; i < 25; i += 1) {
        live = await send('Runtime.evaluate', {
          expression: `JSON.stringify({
            mapState: document.querySelector('[data-iqai-map-state]')?.getAttribute('data-iqai-map-state') || null,
            error: document.querySelector('[data-iqai-map-error-message]')?.textContent || null,
            mapViewCreateCount: window.__iqaiSpatialV2?.mapViewCreateCount ?? 0,
            popupCallbackUrl: window.__iqaiSpatialV2 ? null : null
          })`,
          returnByValue: true
        });
        const parsed = JSON.parse(live.result?.value || '{}');
        live = parsed;
        if (authorizeUrls.length || parsed.mapState === 'READY' || parsed.mapState === 'ERROR') break;
        await sleep(1000);
      }
      const oauthFromPage = await send('Runtime.evaluate', {
        expression: `fetch('/api/spatial/operational-map/oauth-config',{cache:'no-store'}).then((r)=>r.json()).then((j)=>JSON.stringify({
          popupCallbackUrl: j.popupCallbackUrl,
          portalUrl: j.portalUrl,
          oauthAppId: j.oauthAppId
        }))`,
        awaitPromise: true,
        returnByValue: true
      });
      live.oauthFromPage = JSON.parse(oauthFromPage.result?.value || '{}');
      ws.close();
    } finally {
      child.kill();
    }
  } catch (error) {
    browserError = String(error?.message || error);
  }
}

const requested = [
  ...authorizeUrls.map(redirectFromUrl),
  oauth.popupCallbackUrl
].filter(Boolean);

const report = {
  generatedAt: new Date().toISOString(),
  oauthAppId: oauth.oauthAppId,
  portalUrl: oauth.portalUrl,
  requestedPopupCallbackUrl: oauth.popupCallbackUrl,
  redirectUrisHinted: oauth.redirectUris,
  authorizeUrls: [...new Set(authorizeUrls)].slice(0, 8),
  observedRedirectUris: [...new Set(requested)],
  popupUrls: [...new Set(popupUrls)].filter(Boolean).slice(0, 8),
  live,
  browserError
};
fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
