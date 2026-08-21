/**
 * Live proof: high-contrast planned cameras + per-pane street-date search on :3052.
 */
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'artifacts', 'spatial-v2-camera-capture-date-v1');
const PORT = 3052;
const URL = `http://localhost:${PORT}/spatial-v2/?v=camera-federation-v1`;
const TARGET = Object.freeze({
  longitude: -73.553221995734,
  latitude: 45.494180980834,
  address: '997 de la Commune Ouest, Montréal'
});

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

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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
    '--disable-session-crashed-bubble',
    '--disable-infobars',
    '--disable-gpu',
    '--window-size=1920,1080',
    'about:blank'
  ], { stdio: 'ignore' });
  try {
    const version = await waitForJson(`http://127.0.0.1:${debugPort}/json/version`);
    const ws = new WebSocket(version.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('CDP websocket timeout')), 15000);
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
      ws.send(JSON.stringify({ id: 3, method: 'Target.attachToTarget', params: { targetId, flatten: true } }));
    });
    let nextId = 10;
    const send = (method, params = {}) => {
      nextId += 1;
      const id = nextId;
      const timeoutMs = method === 'Page.captureScreenshot' || method === 'Runtime.evaluate' ? 20000 : 15000;
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
    await send('Network.setCacheDisabled', { cacheDisabled: true });
    await send('Emulation.setDeviceMetricsOverride', {
      width: 1920,
      height: 1080,
      deviceScaleFactor: 1,
      mobile: false
    });
    const result = await fn(send);
    ws.close();
    return result;
  } finally {
    child.kill();
  }
}

async function evaluateJson(send, expression) {
  const result = await send('Runtime.evaluate', {
    expression,
    awaitPromise: false,
    returnByValue: true
  });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.text || 'evaluate failed');
  }
  return result.result?.value;
}

async function waitUntil(send, expression, attempts, delayMs) {
  let last;
  for (let i = 0; i < attempts; i += 1) {
    last = await evaluateJson(send, expression);
    if (last) return last;
    await sleep(delayMs);
  }
  throw new Error(`waitUntil failed: ${expression} last=${JSON.stringify(last)}`);
}

async function shot(send, name) {
  const raw = await send('Page.captureScreenshot', { format: 'jpeg', quality: 70 });
  const file = path.join(OUT, name);
  fs.writeFileSync(file, Buffer.from(raw.data, 'base64'));
  return file;
}

const SNAP = `(() => {
  const overlay = document.querySelector('#iqai-v2-place-camera-overlay');
  const housing = overlay?.querySelector('[data-iqai-planned-camera-glyph] rect');
  const halo = overlay?.querySelector('[data-iqai-planned-camera-halo]');
  const label = overlay?.querySelector('[data-iqai-planned-camera-label]');
  const date = document.querySelector('[data-iqai-camera-date]');
  const input = document.querySelector('[data-iqai-camera-date-input]');
  return {
    glyphs: overlay?.querySelectorAll('[data-iqai-planned-camera-glyph]').length || 0,
    fill: housing?.getAttribute('fill') || null,
    stroke: housing?.getAttribute('stroke') || null,
    halo: halo?.getAttribute('stroke') || null,
    labelFill: label?.getAttribute('fill') || null,
    labelStroke: label?.getAttribute('stroke') || null,
    printPlan: Boolean(document.querySelector('[data-iqai-camera-plan-print]')),
    dateChrome: Boolean(date),
    dateInput: Boolean(input),
    dateDisabled: input?.disabled === true,
    year: date?.querySelector('.iqai-v2-camera-date__year')?.textContent || null,
    honesty: date?.querySelector('.iqai-v2-camera-date__honesty')?.textContent || null,
    years: [...(date?.querySelectorAll('[data-iqai-camera-date-year]') || [])].map((el) => el.textContent.trim()),
    wallOpen: window.__iqaiSpatialV2?.cameraWall?.snapshot?.()?.wall?.open === true
      || window.__iqaiSpatialV2?.cameraWall?.snapshot?.()?.open === true,
    plannedCount: window.__iqaiSpatialV2?.placeCamera?.snapshot?.()?.count ?? 0,
    mapViews: document.querySelectorAll('.esri-view').length
  };
})()`;

if (!(await isPortOpen(PORT))) {
  console.log(JSON.stringify({ error: '3052 not listening', result: 'FAIL' }));
  process.exit(1);
}

const browserPath = findBrowser();
if (!browserPath) {
  console.log(JSON.stringify({ error: 'No Chrome/Edge', result: 'FAIL' }));
  process.exit(1);
}

let live;
try {
  live = await withCdpPage(browserPath, 9431, async (send) => {
    const shots = {};
    await send('Page.navigate', { url: URL });
    await sleep(2000);
    await send('Runtime.enable');
    await waitUntil(send, 'Boolean(window.__iqaiSpatialV2 && window.__iqaiSpatialV2.worldViewFrame)', 80, 200);
    await evaluateJson(send, 'window.__iqaiSpatialV2.cameraRelevance.enterPlanCameras(); true');
    await evaluateJson(send, `void window.__iqaiSpatialV2.dropPin.placeFromSearch({
      longitude: ${TARGET.longitude},
      latitude: ${TARGET.latitude},
      address: ${JSON.stringify(TARGET.address)}
    }); true`);
    await waitUntil(send, 'Boolean(window.__iqaiSpatialV2.world()?.activeFocus)', 30, 150);
    await evaluateJson(send, 'window.__iqaiSpatialV2.cameraCoverage.generate(); true');
    await waitUntil(send, '(window.__iqaiSpatialV2.placeCamera?.snapshot?.()?.count || 0) >= 3', 20, 150);
    await sleep(800);
    const planned = await evaluateJson(send, SNAP);
    shots.planned = await shot(send, '01-high-contrast-cameras.jpg');
    await evaluateJson(send, 'void window.__iqaiSpatialV2.cameraWall.build(); true').catch(() => null);
    await waitUntil(send, `(${SNAP}).dateInput === true`, 25, 200);
    await sleep(800);
    const wall = await evaluateJson(send, SNAP);
    shots.wall = await shot(send, '02-date-search.jpg');
    await evaluateJson(send, `document.querySelector('[data-iqai-camera-wall-enlarge]')?.click(); true`);
    await sleep(700);
    await waitUntil(send, `(${SNAP}).glyphs >= 1`, 20, 200).catch(() => null);
    const enlarged = await evaluateJson(send, SNAP);
    shots.enlarged = await shot(send, '03-enlarged-calendar.jpg');
    return { planned, wall, enlarged, shots };
  });
} catch (error) {
  console.log(JSON.stringify({ error: String(error), result: 'FAIL' }));
  process.exit(1);
}

const contrastPass = live.enlarged?.fill === '#f4f0ea' && live.enlarged?.stroke === '#0b0d10';
const glyphPass = (live.enlarged?.glyphs || live.planned?.glyphs || 0) >= 1;
const datePass = live.wall?.dateChrome === true && live.wall?.dateInput === true && live.wall?.printPlan === true;
const honestyPass = /STREET PHOTO DATE|THIS CAPTURE ONLY|NO DATED STREET/.test(
  live.enlarged?.honesty || live.wall?.honesty || ''
);
const result = glyphPass && contrastPass && datePass && honestyPass ? 'PASS' : 'PARTIAL';

console.log(JSON.stringify({
  result,
  glyphPass,
  contrastPass,
  datePass,
  honestyPass,
  planned: live.planned,
  wall: live.wall,
  enlarged: live.enlarged,
  shots: live.shots,
  out: OUT
}, null, 2));
