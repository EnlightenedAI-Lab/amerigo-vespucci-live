import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';
import { createServer } from '../src/server.js';
import { createPreviewConfig, createPreviewState } from '../src/demo-map-api.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'artifacts', 'spatial-v2-shell-v1');
const VIEWPORTS = [
  { name: '3840x2160', width: 3840, height: 2160, expectNoPageScroll: true },
  { name: '2560x1440', width: 2560, height: 1440, expectNoPageScroll: false },
  { name: '1920x1080', width: 1920, height: 1080, expectNoPageScroll: false }
];

function exists(file) {
  try {
    return fs.existsSync(file);
  } catch {
    return false;
  }
}

function findBrowser() {
  const candidates = [
    process.env.EDGE_PATH,
    process.env.CHROME_PATH,
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'
  ].filter(Boolean);
  return candidates.find((file) => exists(file)) || null;
}

function request(port, urlPath) {
  return new Promise((resolve, reject) => {
    http.get(`http://127.0.0.1:${port}${urlPath}`, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve({
        status: res.statusCode,
        body: Buffer.concat(chunks).toString('utf8')
      }));
    }).on('error', reject);
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForJson(url, attempts = 50) {
  let lastError;
  for (let i = 0; i < attempts; i += 1) {
    try {
      const res = await fetch(url);
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
    '--headless=new',
    '--disable-gpu',
    '--hide-scrollbars',
    '--no-first-run',
    '--no-default-browser-check',
    '--force-device-scale-factor=1',
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
        const onMessage = (raw) => {
          const msg = JSON.parse(raw.toString());
          if (msg.id !== id) return;
          ws.off('message', onMessage);
          if (msg.error) reject(new Error(`${method}: ${JSON.stringify(msg.error)}`));
          else resolve(msg.result);
        };
        ws.on('message', onMessage);
        ws.send(JSON.stringify({
          id,
          method,
          sessionId: attached.sessionId,
          params
        }));
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

async function waitForShell(send) {
  for (let i = 0; i < 50; i += 1) {
    const result = await send('Runtime.evaluate', {
      expression: 'Boolean(window.__iqaiSpatialV2 && document.querySelector("[data-iqai-slot=\\"map-stage\\"]"))',
      returnByValue: true
    });
    if (result.result?.value === true) return;
    await sleep(100);
  }
  throw new Error('V2 shell did not mount');
}

fs.mkdirSync(OUT, { recursive: true });

const app = createServer(createPreviewState(), createPreviewConfig(0), null, { preview: true });
const server = app.listen(0);
const port = server.address().port;
const base = `http://127.0.0.1:${port}`;

const httpChecks = {
  v1: await request(port, '/spatial/'),
  v1Index: await request(port, '/spatial/index.html'),
  v2: await request(port, '/spatial-v2/'),
  v2Css: await request(port, '/spatial-v2/iqai-spatial-v2.css'),
  v2Js: await request(port, '/spatial-v2/spatial-v2.js')
};

const browserPath = findBrowser();
const shots = [];
const compositions = [];
let browserError = null;

if (browserPath) {
  try {
    await withCdpPage(browserPath, 9229, async (send) => {
      for (const viewport of VIEWPORTS) {
        await send('Emulation.setDeviceMetricsOverride', {
          width: viewport.width,
          height: viewport.height,
          deviceScaleFactor: 1,
          mobile: false
        });
        await send('Page.navigate', { url: `${base}/spatial-v2/?qa=${viewport.name}` });
        await waitForShell(send);
        await sleep(250);
        const measured = await send('Runtime.evaluate', {
          expression: 'JSON.stringify(window.__iqaiSpatialV2.measure())',
          returnByValue: true
        });
        const shot = await send('Page.captureScreenshot', {
          format: 'png',
          captureBeyondViewport: false
        });
        const file = path.join(OUT, `spatial-v2-shell-${viewport.name}.png`);
        fs.writeFileSync(file, Buffer.from(shot.data, 'base64'));
        shots.push(file);
        compositions.push({
          viewport: viewport.name,
          expectNoPageScroll: viewport.expectNoPageScroll,
          measure: measured.result?.value ? JSON.parse(measured.result.value) : null
        });
      }
    });
  } catch (error) {
    browserError = String(error?.message || error);
  }
}

await new Promise((resolve) => server.close(resolve));

const report = {
  generatedAt: new Date().toISOString(),
  routes: {
    v1: {
      status: httpChecks.v1.status,
      hasV1Runtime: httpChecks.v1.body.includes('/spatial/spatial.js'),
      leakedV2: httpChecks.v1.body.includes('iqai-spatial-v2')
    },
    v1Index: { status: httpChecks.v1Index.status },
    v2: {
      status: httpChecks.v2.status,
      hasV2Shell: httpChecks.v2.body.includes('iqai-spatial-v2'),
      leakedV1Runtime: httpChecks.v2.body.includes('/spatial/spatial.js')
    },
    v2Css: { status: httpChecks.v2Css.status },
    v2Js: { status: httpChecks.v2Js.status }
  },
  browserPath,
  browserError,
  screenshots: shots,
  compositions
};

fs.writeFileSync(path.join(OUT, 'qa-report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
