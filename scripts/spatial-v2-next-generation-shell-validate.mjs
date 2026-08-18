import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';
import { createServer } from '../src/server.js';
import { createPreviewConfig, createPreviewState } from '../src/demo-map-api.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'artifacts', 'spatial-v2-next-generation-shell-v1');
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

async function probeLiveV1Listener() {
  const worktree = path.resolve(ROOT).toLowerCase();
  if (!worktree.includes('amerigo-vespucci-live-v1')) {
    return { ok: false, foreign: true, reason: 'this is not the live-v1 worktree' };
  }
  try {
    const healthRes = await fetch('http://127.0.0.1:3000/health', { signal: AbortSignal.timeout(2000) });
    const raw = await healthRes.text();
    let health;
    try {
      health = JSON.parse(raw);
    } catch {
      return { ok: false, foreign: true, reason: 'port 3000 health is not IQAI JSON' };
    }
    if (!health?.ok || !health.spatialEngine) {
      return { ok: false, foreign: true, reason: 'port 3000 health is not IQAI spatial', health };
    }
    const v2 = await fetch('http://127.0.0.1:3000/spatial-v2/', { signal: AbortSignal.timeout(3000) }).then((r) => r.text());
    const v1 = await fetch('http://127.0.0.1:3000/spatial/', { signal: AbortSignal.timeout(3000) }).then((r) => r.text());
    if (!v2.includes('id="iqai-spatial-v2"') || !v2.includes('next-gen-v1')) {
      return { ok: false, foreign: true, reason: 'port 3000 is not this Spatial V2 shell', health };
    }
    if (v2.includes('/spatial/spatial.js')) {
      return { ok: false, foreign: true, reason: 'port 3000 V2 fused with V1', health };
    }
    if (!v1.includes('/spatial/spatial.js') || v1.includes('iqai-spatial-v2')) {
      return { ok: false, foreign: true, reason: 'port 3000 V1 is not independent', health };
    }
    return { ok: true, foreign: false, base: 'http://127.0.0.1:3000', health };
  } catch (error) {
    return { ok: false, foreign: false, reason: String(error?.message || error) };
  }
}

function displayChromeHonest(display) {
  if (!display) return false;
  const completed = display.guidedCompleted || [];
  const labels = display.displayLabels || [];
  const facts = display.facts || [];
  const factLabels = facts.map((item) => item.label);
  const chromeMatchesEngine = display.displayConfirmed
    ? display.operatorDisplay === 'DISPLAY_CONFIRMED'
      && display.explanationDisplay === 'DISPLAY_CONFIRMED'
      && completed.includes('SHOW_BEST_IMAGE')
    : !labels.includes('DISPLAY_CONFIRMED')
      && display.operatorDisplay !== 'DISPLAY_CONFIRMED'
      && display.explanationDisplay !== 'DISPLAY_CONFIRMED'
      && !completed.includes('SHOW_BEST_IMAGE')
      && (
        display.selectedId || display.activeId || (display.displayState && display.displayState !== 'NONE')
          ? display.operatorDisplay === 'DISPLAY NOT CONFIRMED'
            && display.explanationDisplay === 'DISPLAY NOT CONFIRMED'
          : display.operatorDisplay === 'NONE'
      );
  return chromeMatchesEngine
    && display.truthDisplayConfirmed === display.displayConfirmed
    && display.truthHasExperience === false
    && factLabels.includes('SELECTED')
    && factLabels.includes('ACTIVATED')
    && factLabels.includes('DISPLAY')
    && !factLabels.some((label) => label.includes('DISPLAYED'))
    && display.mapViewCreateCount === 1
    && display.diagnosticsVisible === false;
}

fs.mkdirSync(OUT, { recursive: true });
const liveProbe = await probeLiveV1Listener();
if (liveProbe.foreign) {
  const report = {
    generatedAt: new Date().toISOString(),
    base: 'http://127.0.0.1:3000',
    browserPath: findBrowser(),
    preauthInjected: false,
    browserError: `REFUSED foreign 3000: ${liveProbe.reason}`,
    live: null,
    liveProbe,
    usedLiveListener: false,
    pass: false
  };
  fs.writeFileSync(path.join(OUT, 'qa-report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  process.exit(1);
}

let server = null;
let base = liveProbe.ok ? liveProbe.base : null;
let usedLiveListener = Boolean(liveProbe.ok);
if (!usedLiveListener) {
  const app = createServer(createPreviewState(), createPreviewConfig(0), null, { preview: true });
  server = app.listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
}
const browserPath = findBrowser();
const preauth = await fetchPreauthToken();
let browserError = null;
let live = null;

try {
  if (!browserPath) throw new Error('No supported Edge or Chrome browser found.');
  live = await withCdpPage(browserPath, 9281, async (send) => {
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
    await send('Page.navigate', { url: `${base}/spatial-v2/?qa=next-generation-shell-v1` });
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

    const restNormal4k = await capture(send, 'next-gen-normal-3840x2160.png');
    await evaluate(send, `document.querySelector('[data-iqai-experience="EXPERT"]').click()`);
    await sleep(120);
    const restExpert4k = await capture(send, 'next-gen-expert-3840x2160.png');
    await evaluate(send, `document.querySelector('[data-iqai-experience="NORMAL"]').click()`);

    const empty = await submitAsk('');
    const unmatched = await submitAsk('make an unsupported operational decision');
    const unavailable = await submitAsk('show vegetation health');
    const routed = await submitAsk('latest imagery');

    const workflow = await evaluateJson(send, `(() => {
      window.__iqaiSpatialV2.commandCenter.setImageryView('HISTORY');
      const guidedNormal = window.__iqaiSpatialV2.commandCenter.guided();
      const truthNormal = window.__iqaiSpatialV2.truth();
      document.querySelector('[data-iqai-experience="EXPERT"]').click();
      const guidedExpert = window.__iqaiSpatialV2.commandCenter.guided();
      const truthExpert = window.__iqaiSpatialV2.truth();
      const diagnosticsButton = document.querySelector('[data-iqai-operator-imagery-action="diagnostics"]');
      diagnosticsButton?.click();
      const diagnosticsVisible = Boolean(
        document.querySelector('[data-iqai-imagery-panel]')
        && !document.querySelector('[data-iqai-imagery-dock]')?.hidden
      );
      const guidedWithDiagnostics = window.__iqaiSpatialV2.commandCenter.guided();
      const truthWithDiagnostics = window.__iqaiSpatialV2.truth();
      const inspectorGuided = Boolean(document.querySelector('[data-iqai-guided-next-action="inspector"]'));
      const stageGuided = Boolean(document.querySelector('[data-iqai-guided-next-action="stage"]'));
      const nextControl = document.querySelector('[data-iqai-next="true"]');
      document.querySelector('[data-iqai-experience="NORMAL"]').click();
      const guidedBack = window.__iqaiSpatialV2.commandCenter.guided();
      return {
        guidedNormal,
        guidedExpert,
        guidedWithDiagnostics,
        guidedBack,
        truthNormal,
        truthExpert,
        truthWithDiagnostics,
        diagnosticsButtonPresent: Boolean(diagnosticsButton),
        diagnosticsVisible,
        inspectorGuided,
        stageGuided,
        nextControl: nextControl ? (nextControl.getAttribute('data-iqai-operator-imagery-date') != null ? 'CHOOSE_DATE' : nextControl.getAttribute('data-iqai-operator-imagery-action')) : null,
        sheet: document.getElementById('iqai-spatial-v2')?.dataset.iqaiSheet,
        experience: window.__iqaiSpatialV2.commandCenter.getSnapshot().experience
      };
    })()`);

    await send('Emulation.setDeviceMetricsOverride', {
      width: 3840,
      height: 2160,
      deviceScaleFactor: 1,
      mobile: false
    });
    await sleep(150);
    const workflowShot = await capture(send, 'next-gen-workflow-history-3840x2160.png');

    await evaluate(send, `window.__iqaiSpatialV2.commandCenter.setExperience('NORMAL')`);
    await evaluate(send, `window.__iqaiSpatialV2.commandCenter.setImageryView('LATEST')`);
    await sleep(200);
    await evaluate(send, `(async () => {
      try { await window.__iqaiSpatialV2.discoverImageryTime(); } catch (error) { return String(error?.message || error); }
      return 'ok';
    })()`, true);
    await sleep(800);
    const displayTruth = await evaluateJson(send, `(() => {
      const time = window.__iqaiSpatialV2.time();
      const truth = window.__iqaiSpatialV2.truth();
      const guided = window.__iqaiSpatialV2.commandCenter.guided();
      const facts = [...document.querySelectorAll('[data-iqai-operator-imagery] dt')].map((dt) => ({
        label: dt.textContent.trim(),
        value: dt.nextElementSibling?.textContent?.trim() || ''
      }));
      return {
        selectedId: time.selectedId || null,
        activeId: time.activeId || null,
        displayConfirmed: time.displayConfirmed === true,
        displayState: time.displayState || 'NONE',
        truthDisplayConfirmed: truth.displayConfirmed === true,
        truthDisplayState: truth.displayState || null,
        truthHasExperience: Object.prototype.hasOwnProperty.call(truth, 'experience'),
        guidedCurrentStep: guided.currentStep,
        guidedCompleted: guided.completedSteps,
        displayLabels: [...document.querySelectorAll('[data-iqai-display-label]')].map((node) => node.textContent.trim()),
        operatorDisplay: document.querySelector('[data-iqai-operator-imagery] [data-iqai-display-label]')?.textContent?.trim() || '',
        explanationDisplay: document.querySelector('[data-iqai-explanation] [data-iqai-display-label]')?.textContent?.trim() || '',
        operatorState: document.querySelector('[data-iqai-operator-imagery]')?.getAttribute('data-iqai-display-state') || '',
        facts,
        diagnosticsVisible: Boolean(
          document.querySelector('[data-iqai-imagery-panel]')
          && !document.querySelector('[data-iqai-imagery-dock]')?.hidden
        ),
        mapViewCreateCount: window.__iqaiSpatialV2.mapFoundation.getMapViewCreateCount(),
        mapState: window.__iqaiSpatialV2.mapFoundation.getState()
      };
    })()`);
    const displayShot = await capture(send, 'next-gen-display-truth-3840x2160.png');

    const compositions = [];
    const screenshots = [restNormal4k, restExpert4k, workflowShot, displayShot];
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
        const app = document.getElementById('iqai-spatial-v2');
        const rail = document.querySelector('[data-iqai-slot="capability-rail"]');
        const inspector = document.querySelector('[data-iqai-slot="context-inspector"]');
        const ask = document.querySelector('[data-iqai-slot="ask-iqai-dock"]');
        const askInput = document.querySelector('.iqai-v2-ask__input');
        const future = [...document.querySelectorAll('[data-iqai-future-imagery-action]')];
        const appStyle = getComputedStyle(app);
        return {
          measure,
          gridColumns: appStyle.gridTemplateColumns,
          launcherClass: rail?.className || '',
          railButtons: rail?.querySelectorAll('[data-iqai-capability], [data-iqai-plugin]').length || 0,
          askClientHeight: ask?.clientHeight || 0,
          askInputWidth: askInput?.clientWidth || 0,
          askLabelVisible: Boolean(document.querySelector('.iqai-v2-ask__label')?.getClientRects().length),
          inspectorOpen: app?.dataset.iqaiSheet === 'open',
          inspectorClientWidth: inspector?.clientWidth || 0,
          futureControls: future.map((item) => ({
            action: item.dataset.iqaiFutureImageryAction,
            disabled: item.disabled,
            text: item.textContent.trim()
          })),
          aiStatus: document.querySelector('.iqai-v2-explanation__connection')?.textContent || '',
          guidedStep: document.querySelector('[data-iqai-guided-next-action="stage"]')?.getAttribute('data-iqai-guided-step') || '',
          nextPresent: Boolean(document.querySelector('[data-iqai-next="true"]')),
          mapState: window.__iqaiSpatialV2.mapFoundation.getState(),
          mapViewCreateCount: window.__iqaiSpatialV2.mapFoundation.getMapViewCreateCount(),
          activeCapability: window.__iqaiSpatialV2.commandCenter.getSnapshot().activeCapability,
          experience: window.__iqaiSpatialV2.commandCenter.getSnapshot().experience
        };
      })()`);
      if (viewport.name === '1920x1080') {
        screenshots.push(await capture(send, 'next-gen-normal-1920x1080.png'));
      }
      const measure = metrics.measure;
      const checks = {
        newGenerationGrid: String(metrics.gridColumns).trim().split(/\s+/).length === 1,
        overlayLauncher: metrics.launcherClass.includes('iqai-v2-launcher'),
        mapDominant: measure.mapStageShare > 0.82
          && measure.regions.stage.width >= measure.viewport.width - 8,
        noPageOverflow: !measure.pageScroll.documentOverflowY && !measure.pageScroll.bodyOverflowY,
        askObvious: metrics.askLabelVisible && metrics.askClientHeight >= 70 && metrics.askInputWidth >= 520,
        capabilityAccess: metrics.railButtons >= 8,
        inspectorContextual: metrics.inspectorOpen === true && metrics.inspectorClientWidth >= 240,
        imageryContextVisible: metrics.activeCapability === 'imagery',
        guidedVisible: metrics.guidedStep.length > 0 && metrics.nextPresent,
        futureControlsHonest: metrics.futureControls.length === 4
          && metrics.futureControls.every((control) => control.disabled)
          && metrics.futureControls.every((control) => /COMING LATER|NOT AVAILABLE|ENTITLEMENT REQUIRED/.test(control.text)),
        aiHonest: /NOT CONNECTED/.test(metrics.aiStatus),
        oneMapView: metrics.mapState === 'READY' && metrics.mapViewCreateCount === 1,
        normalExperience: metrics.experience === 'NORMAL'
      };
      compositions.push({ viewport: viewport.name, metrics, checks, pass: Object.values(checks).every(Boolean) });
    }

    const routeChecks = {
      v1: await fetch(`${base}/spatial/`).then((response) => response.text()),
      v2: await fetch(`${base}/spatial-v2/`).then((response) => response.text())
    };
    const truthEqual = (left, right) => JSON.stringify(left) === JSON.stringify(right);
    const guidedEqual = (left, right) => left?.workflowId === right?.workflowId
      && left?.currentStep === right?.currentStep
      && left?.recommendedAction === right?.recommendedAction
      && JSON.stringify(left?.completedSteps) === JSON.stringify(right?.completedSteps);
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
      sameTruthState: truthEqual(workflow.truthNormal, workflow.truthExpert)
        && truthEqual(workflow.truthNormal, workflow.truthWithDiagnostics),
      sameGuidedState: guidedEqual(workflow.guidedNormal, workflow.guidedExpert)
        && guidedEqual(workflow.guidedNormal, workflow.guidedWithDiagnostics)
        && guidedEqual(workflow.guidedNormal, workflow.guidedBack)
        && workflow.guidedNormal?.currentStep === 'CHOOSE_DATE',
      guidedInBothSurfaces: workflow.inspectorGuided && workflow.stageGuided,
      expertDiagnostics: workflow.diagnosticsButtonPresent && workflow.diagnosticsVisible,
      displayChromeHonest: displayChromeHonest(displayTruth),
      selectedNotDisplayed: displayTruth?.operatorDisplay !== 'DISPLAYED'
        && !(displayTruth?.selectedId && displayTruth?.operatorDisplay === 'DISPLAY_CONFIRMED' && displayTruth?.displayConfirmed !== true),
      v1Independent: routeChecks.v1.includes('/spatial/spatial.js')
        && !routeChecks.v1.includes('iqai-spatial-v2'),
      v2Independent: routeChecks.v2.includes('next-gen-v1')
        && !routeChecks.v2.includes('/spatial/spatial.js'),
      newShellTitle: routeChecks.v2.includes('IQAI Spatial — Instrument'),
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
      workflow,
      displayTruth,
      compositions,
      screenshots,
      checks,
      pass: Object.values(checks).every(Boolean)
    };
  });
} catch (error) {
  browserError = String(error?.message || error);
} finally {
  if (server) {
    await new Promise((resolve) => server.close(resolve));
  }
}

const report = {
  generatedAt: new Date().toISOString(),
  base,
  usedLiveListener,
  liveProbe,
  browserPath,
  preauthInjected: Boolean(preauth),
  browserError,
  live,
  pass: Boolean(live?.pass && !browserError)
};

fs.writeFileSync(path.join(OUT, 'qa-report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
process.exit(report.pass ? 0 : 1);
