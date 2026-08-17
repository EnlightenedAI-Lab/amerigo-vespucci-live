import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';
import { createServer } from '../src/server.js';
import { createPreviewConfig, createPreviewState } from '../src/demo-map-api.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'artifacts', 'spatial-v2-command-center-foundation-v1');
const VIEWPORTS = [
  { name: '3840x2160', width: 3840, height: 2160 },
  { name: '2560x1440', width: 2560, height: 1440 },
  { name: '1920x1080', width: 1920, height: 1080 }
];

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

function findBrowser() {
  const candidates = [
    process.env.EDGE_PATH,
    process.env.CHROME_PATH,
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'
  ].filter(Boolean);
  return candidates.find((file) => fs.existsSync(file)) || null;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchPreauthToken() {
  const username = process.env.ARCGIS_USERNAME;
  const password = process.env.ARCGIS_PASSWORD;
  const portal = (process.env.ARCGIS_PORTAL_URL || 'https://www.arcgis.com').replace(/\/$/, '');
  if (!username || !password) return null;
  try {
    const params = new URLSearchParams({
      username,
      password,
      client: 'requestip',
      expiration: '60',
      f: 'json'
    });
    const response = await fetch(`${portal}/sharing/rest/generateToken`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
      signal: AbortSignal.timeout(12000)
    });
    const data = await response.json().catch(() => ({}));
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

async function waitForJson(url, attempts = 60) {
  let lastError;
  for (let i = 0; i < attempts; i += 1) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1000) });
      if (response.ok) return response.json();
    } catch (error) {
      lastError = error;
    }
    await sleep(100);
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
    '--hide-scrollbars',
    '--no-first-run',
    '--no-default-browser-check',
    '--force-device-scale-factor=1',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
    '--enable-webgl',
    '--use-angle=swiftshader',
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
      const timer = setTimeout(() => reject(new Error('Timed out creating CDP target')), 8000);
      const onMessage = (raw) => {
        const message = JSON.parse(raw.toString());
        if (message.method === 'Target.targetCreated' && message.params?.targetInfo?.type === 'page') {
          clearTimeout(timer);
          ws.off('message', onMessage);
          resolve({ targetId: message.params.targetInfo.targetId });
        }
      };
      ws.on('message', onMessage);
      ws.send(JSON.stringify({ id: 1, method: 'Target.setDiscoverTargets', params: { discover: true } }));
      ws.send(JSON.stringify({ id: 2, method: 'Target.createTarget', params: { url: 'about:blank' } }));
    });

    const attached = await new Promise((resolve, reject) => {
      const onMessage = (raw) => {
        const message = JSON.parse(raw.toString());
        if (message.id !== 3) return;
        ws.off('message', onMessage);
        if (message.error) reject(new Error(JSON.stringify(message.error)));
        else resolve(message.result);
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
          const message = JSON.parse(raw.toString());
          if (message.id !== id) return;
          ws.off('message', onMessage);
          if (message.error) reject(new Error(`${method}: ${JSON.stringify(message.error)}`));
          else resolve(message.result);
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
    await sleep(200);
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
}

async function evaluate(send, expression, awaitPromise = false) {
  const response = await send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise
  });
  if (response.exceptionDetails) {
    throw new Error(response.exceptionDetails.text || 'Runtime evaluation failed');
  }
  return response.result?.value;
}

async function evaluateJson(send, expression, awaitPromise = false) {
  const wrapped = awaitPromise
    ? `(async () => JSON.stringify(await (${expression})))()`
    : `JSON.stringify(${expression})`;
  const value = await evaluate(send, wrapped, awaitPromise);
  return value ? JSON.parse(value) : null;
}

async function waitFor(send, expression, attempts = 80, waitMs = 250) {
  for (let i = 0; i < attempts; i += 1) {
    if (await evaluate(send, expression)) return true;
    await sleep(waitMs);
  }
  return false;
}

async function capture(send, fileName) {
  const shot = await send('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: false
  });
  const file = path.join(OUT, fileName);
  fs.writeFileSync(file, Buffer.from(shot.data, 'base64'));
  return file;
}

fs.mkdirSync(OUT, { recursive: true });
const app = createServer(createPreviewState(), createPreviewConfig(0), null, { preview: true });
const server = app.listen(0);
const port = server.address().port;
const base = `http://127.0.0.1:${port}`;
const browserPath = findBrowser();
const preauth = await fetchPreauthToken();
let browserError = null;
let live = null;

try {
  if (!browserPath) throw new Error('No supported Edge or Chrome browser found.');
  live = await withCdpPage(browserPath, 9274, async (send) => {
    if (preauth) {
      await send('Page.addScriptToEvaluateOnNewDocument', {
        source: `window.__MONTREAL_PREAUTH_TOKEN = ${JSON.stringify(preauth)};`
      });
    }
    await send('Emulation.setDeviceMetricsOverride', {
      width: 3840,
      height: 2160,
      deviceScaleFactor: 1,
      mobile: false
    });
    await send('Page.navigate', { url: `${base}/spatial-v2/?qa=command-center-foundation-v1` });
    const shellMounted = await waitFor(
      send,
      'Boolean(window.__iqaiSpatialV2?.commandCenter && document.querySelector("[data-iqai-slot=\\"map-stage\\"]"))'
    );
    if (!shellMounted) throw new Error('Command center did not mount.');

    await waitFor(
      send,
      '["READY", "ERROR"].includes(window.__iqaiSpatialV2.mapFoundation.getState())',
      120,
      500
    );
    if (await evaluate(send, 'window.__iqaiSpatialV2.mapFoundation.getState() === "READY"')) {
      await waitFor(
        send,
        '["READY", "ERROR"].includes(window.__iqaiSpatialV2.ground().applyState) && ["READY", "ERROR"].includes(window.__iqaiSpatialV2.time().engineState)',
        80,
        250
      );
    }

    const submitAsk = async (text) => evaluateJson(send, `(async () => {
      const before = window.__iqaiSpatialV2.ask.getLastReceipt()?.attempt || 0;
      const input = document.querySelector('[name="ask"]');
      input.value = ${JSON.stringify(text)};
      document.querySelector('[data-iqai-ask-form]').requestSubmit();
      for (let i = 0; i < 50; i += 1) {
        const receipt = window.__iqaiSpatialV2.ask.getLastReceipt();
        if (receipt?.attempt > before) {
          return {
            receipt,
            status: document.querySelector('[data-iqai-ask-status]')?.textContent || ''
          };
        }
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      return { receipt: null, status: 'TIMEOUT' };
    })()`, true);

    const empty = await submitAsk('');
    const unmatched = await submitAsk('make an unsupported operational decision');
    const unavailable = await submitAsk('show vegetation health');
    const routed = await submitAsk('latest imagery');

    const parity = await evaluateJson(send, `(() => {
      const truthBefore = window.__iqaiSpatialV2.truth();
      document.querySelector('[data-iqai-experience="EXPERT"]').click();
      const truthExpert = window.__iqaiSpatialV2.truth();
      const diagnosticsButton = document.querySelector('[data-iqai-operator-imagery-action="diagnostics"]');
      diagnosticsButton?.click();
      const diagnosticsVisible = Boolean(
        document.querySelector('[data-iqai-imagery-panel]')
        && !document.querySelector('[data-iqai-imagery-dock]')?.hidden
      );
      const truthWithDiagnostics = window.__iqaiSpatialV2.truth();
      document.querySelector('[data-iqai-experience="NORMAL"]').click();
      const truthNormal = window.__iqaiSpatialV2.truth();
      return {
        truthBefore,
        truthExpert,
        truthWithDiagnostics,
        truthNormal,
        diagnosticsButtonPresent: Boolean(diagnosticsButton),
        diagnosticsVisible,
        diagnosticsClosedInNormal: document.querySelector('[data-iqai-imagery-dock]')?.hidden === true,
        experience: window.__iqaiSpatialV2.commandCenter.getSnapshot().experience
      };
    })()`);

    await evaluate(send, `(() => {
      document.querySelector('[data-iqai-experience="EXPERT"]').click();
      document.querySelector('[data-iqai-operator-imagery-action="diagnostics"]')?.click();
    })()`);
    await sleep(100);
    const expertScreenshot = await capture(send, 'command-center-expert-3840x2160.png');
    await evaluate(send, `document.querySelector('[data-iqai-experience="NORMAL"]').click()`);

    const compositions = [];
    const screenshots = [expertScreenshot];
    for (const viewport of VIEWPORTS) {
      await send('Emulation.setDeviceMetricsOverride', {
        width: viewport.width,
        height: viewport.height,
        deviceScaleFactor: 1,
        mobile: false
      });
      await sleep(250);
      const metrics = await evaluateJson(send, `(() => {
        const measure = window.__iqaiSpatialV2.measure();
        const rail = document.querySelector('[data-iqai-slot="capability-rail"]');
        const inspector = document.querySelector('[data-iqai-slot="context-inspector"]');
        const ask = document.querySelector('[data-iqai-slot="ask-iqai-dock"]');
        const askInput = document.querySelector('.iqai-v2-ask__input');
        const future = [...document.querySelectorAll('[data-iqai-future-imagery-action]')];
        return {
          measure,
          railButtons: rail?.querySelectorAll('button').length || 0,
          railClientWidth: rail?.clientWidth || 0,
          railClientHeight: rail?.clientHeight || 0,
          inspectorClientWidth: inspector?.clientWidth || 0,
          inspectorVisible: getComputedStyle(inspector).display !== 'none',
          askClientHeight: ask?.clientHeight || 0,
          askInputWidth: askInput?.clientWidth || 0,
          askLabelVisible: Boolean(document.querySelector('.iqai-v2-ask__label')?.getClientRects().length),
          futureControls: future.map((item) => ({
            action: item.dataset.iqaiFutureImageryAction,
            disabled: item.disabled,
            text: item.textContent.trim()
          })),
          aiStatus: document.querySelector('.iqai-v2-explanation__connection')?.textContent || '',
          mapState: window.__iqaiSpatialV2.mapFoundation.getState(),
          mapViewCreateCount: window.__iqaiSpatialV2.mapFoundation.getMapViewCreateCount(),
          activeCapability: window.__iqaiSpatialV2.commandCenter.getSnapshot().activeCapability,
          experience: window.__iqaiSpatialV2.commandCenter.getSnapshot().experience
        };
      })()`);
      screenshots.push(await capture(send, `command-center-normal-${viewport.name}.png`));
      const measure = metrics.measure;
      const checks = {
        mapDominant: measure.mapStageShare > 0.5
          && measure.regions.stage.width > measure.regions.rail.width + measure.regions.inspector.width,
        noPageOverflow: !measure.pageScroll.documentOverflowY && !measure.pageScroll.bodyOverflowY,
        askObvious: metrics.askLabelVisible && metrics.askClientHeight >= 100 && metrics.askInputWidth >= 600,
        inspectorReadable: metrics.inspectorVisible && metrics.inspectorClientWidth >= 259,
        railUsable: metrics.railButtons >= 8 && metrics.railClientWidth >= 219 && metrics.railClientHeight >= 500,
        normalExperience: metrics.experience === 'NORMAL',
        imageryContextVisible: metrics.activeCapability === 'imagery',
        futureControlsHonest: metrics.futureControls.length === 4
          && metrics.futureControls.every((control) => control.disabled)
          && metrics.futureControls.every((control) => /COMING LATER|NOT AVAILABLE|ENTITLEMENT REQUIRED/.test(control.text)),
        aiHonest: /NOT CONNECTED/.test(metrics.aiStatus),
        oneMapView: metrics.mapState === 'READY' && metrics.mapViewCreateCount === 1
      };
      compositions.push({ viewport: viewport.name, metrics, checks, pass: Object.values(checks).every(Boolean) });
    }

    const routeChecks = {
      v1: await fetch(`${base}/spatial/`).then((response) => response.text()),
      v2: await fetch(`${base}/spatial-v2/`).then((response) => response.text())
    };
    const truthEqual = (left, right) => JSON.stringify(left) === JSON.stringify(right);
    const checks = {
      emptyUnrouted: empty.receipt?.state === 'UNROUTED'
        && empty.receipt?.reason === 'EMPTY_INPUT'
        && empty.receipt?.executed === false,
      unmatchedUnrouted: unmatched.receipt?.state === 'UNROUTED'
        && unmatched.receipt?.reason === 'NO_CAPABILITY_MATCH'
        && unmatched.receipt?.capabilityId == null,
      recognizedUnavailable: unavailable.receipt?.state === 'UNAVAILABLE'
        && unavailable.receipt?.capabilityId === 'analysis'
        && unavailable.receipt?.executed === false,
      imageryRouted: routed.receipt?.state === 'ROUTED'
        && routed.receipt?.capabilityId === 'imagery'
        && routed.receipt?.result?.engineExecuted === false,
      sameTruthState: truthEqual(parity.truthBefore, parity.truthExpert)
        && truthEqual(parity.truthBefore, parity.truthWithDiagnostics)
        && truthEqual(parity.truthBefore, parity.truthNormal),
      expertDiagnostics: parity.diagnosticsButtonPresent && parity.diagnosticsVisible,
      normalClosesDiagnostics: parity.diagnosticsClosedInNormal && parity.experience === 'NORMAL',
      v1Independent: routeChecks.v1.includes('/spatial/spatial.js')
        && !routeChecks.v1.includes('iqai-spatial-v2'),
      v2Independent: routeChecks.v2.includes('iqai-spatial-v2')
        && !routeChecks.v2.includes('/spatial/spatial.js'),
      allViewports: compositions.every((entry) => entry.pass)
    };
    return {
      mapState: await evaluate(send, 'window.__iqaiSpatialV2.mapFoundation.getState()'),
      mapViewCreateCount: await evaluate(send, 'window.__iqaiSpatialV2.mapFoundation.getMapViewCreateCount()'),
      groundState: await evaluate(send, 'window.__iqaiSpatialV2.ground().applyState'),
      timeEngineState: await evaluate(send, 'window.__iqaiSpatialV2.time().engineState'),
      empty,
      unmatched,
      unavailable,
      routed,
      parity,
      compositions,
      screenshots,
      checks,
      pass: Object.values(checks).every(Boolean)
    };
  });
} catch (error) {
  browserError = String(error?.message || error);
} finally {
  await new Promise((resolve) => server.close(resolve));
}

const report = {
  generatedAt: new Date().toISOString(),
  base,
  browserPath,
  preauthInjected: Boolean(preauth),
  browserError,
  live,
  pass: Boolean(live?.pass && !browserError)
};

fs.writeFileSync(path.join(OUT, 'qa-report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
process.exit(report.pass ? 0 : 1);
