import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';
import { createServer } from '../src/server.js';
import { createPreviewConfig, createPreviewState } from '../src/demo-map-api.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'artifacts', 'spatial-v2-operator-ground-header-v1');
const VIEWPORT = { width: 3840, height: 2160 };

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
    `--window-size=${VIEWPORT.width},${VIEWPORT.height}`,
    '--window-position=0,0',
    '--no-first-run',
    '--no-default-browser-check',
    '--force-device-scale-factor=1',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
    '--enable-webgl',
    '--ignore-gpu-blocklist',
    'about:blank'
  ], { stdio: 'ignore' });

  try {
    const version = await waitForJson(`http://127.0.0.1:${debugPort}/json/version`);
    const ws = new WebSocket(version.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('CDP websocket timed out')), 8000);
      ws.once('open', () => {
        clearTimeout(timer);
        resolve();
      });
      ws.once('error', (error) => {
        clearTimeout(timer);
        reject(error);
      });
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
    const send = (method, params = {}, timeoutMs = 40000) => {
      nextId += 1;
      const id = nextId;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          ws.off('message', onMessage);
          reject(new Error(`${method} timed out`));
        }, timeoutMs);
        const onMessage = (raw) => {
          const message = JSON.parse(raw.toString());
          if (message.id !== id) return;
          ws.off('message', onMessage);
          clearTimeout(timer);
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
    try {
      child.kill();
    } catch {
      // already exited
    }
    if (child.pid) {
      spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    }
    await sleep(400);
    try {
      fs.rmSync(userDataDir, { recursive: true, force: true });
    } catch {
      // browser profile may still be locked
    }
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
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
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
  }, 20000);
  const file = path.join(OUT, fileName);
  fs.writeFileSync(file, Buffer.from(shot.data, 'base64'));
  return file;
}

const PIXEL_STATS = `(() => {
  const view = window.__iqaiSpatialV2?.mapFoundation?.getView?.();
  if (!view?.takeScreenshot) return Promise.resolve(null);
  return Promise.race([
    view.takeScreenshot({ format: 'jpg', quality: 60 }),
    new Promise((_, reject) => setTimeout(() => reject(new Error('pixel stats timed out')), 10000))
  ]).then((captured) => {
    const dataUrl = captured?.dataUrl || '';
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = Math.min(img.width, 480);
        canvas.height = Math.min(img.height, 270);
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
        let r = 0;
        let g = 0;
        let b = 0;
        let count = 0;
        let min = 255;
        let max = 0;
        for (let i = 0; i < pixels.length; i += 16) {
          const lum = (pixels[i] + pixels[i + 1] + pixels[i + 2]) / 3;
          r += pixels[i];
          g += pixels[i + 1];
          b += pixels[i + 2];
          min = Math.min(min, lum);
          max = Math.max(max, lum);
          count += 1;
        }
        resolve({
          width: img.width,
          height: img.height,
          mean: [Math.round(r / count), Math.round(g / count), Math.round(b / count)],
          lumMin: Math.round(min),
          lumMax: Math.round(max),
          contrast: Math.round(max - min)
        });
      };
      img.onerror = () => reject(new Error('pixel stats image failed'));
      img.src = dataUrl;
    });
  }).catch((error) => ({ error: String(error?.message || error) }));
})()`;

const CHROME_PROBE = `(() => {
  const primary = document.querySelector('[data-iqai-header-primary]');
  const detail = document.querySelector('[data-iqai-system-status-detail]');
  const ground = document.querySelector('[data-iqai-operator-ground]');
  const select = document.querySelector('[data-iqai-operator-ground-select]');
  const status = document.querySelector('[data-iqai-operator-ground-status]');
  const api = window.__iqaiSpatialV2;
  const groundSnap = api?.ground?.() || null;
  const timeSnap = api?.time?.() || null;
  const command = api?.commandCenter?.getSnapshot?.() || null;
  const truth = api?.truth?.() || null;
  const options = select ? [...select.options].map((item) => ({ value: item.value, label: item.textContent.trim() })) : [];
  return {
    experience: command?.experience || null,
    activeCapability: command?.activeCapability || null,
    systemStatusOpen: command?.systemStatusOpen === true,
    primaryText: primary?.innerText || '',
    compactStatus: document.querySelector('[data-iqai-system-status-value]')?.textContent || '',
    detailHidden: detail?.hidden !== false,
    detailText: detail?.innerText || '',
    groundHidden: ground?.hidden !== false,
    groundLabel: ground?.querySelector('.iqai-v2-operator-ground__label')?.textContent?.trim() || '',
    groundSelectValue: select?.value || null,
    groundStatus: status?.textContent || '',
    groundOptions: options,
    mapState: api?.mapFoundation?.getState?.() || null,
    mapViewCreateCount: api?.mapFoundation?.getMapViewCreateCount?.() ?? null,
    groundMode: groundSnap?.currentMode || null,
    groundApplyState: groundSnap?.applyState || null,
    groundDisplayConfirmed: groundSnap?.displayConfirmed === true,
    groundError: groundSnap?.error || null,
    timeDisplayConfirmed: timeSnap?.displayConfirmed === true,
    truthHasExperience: Boolean(truth && 'experience' in truth),
    truthHasSystemStatusOpen: Boolean(truth && 'systemStatusOpen' in truth),
    truthDisplayConfirmed: truth?.displayConfirmed === true,
    truthGroundDisplayConfirmed: truth?.groundDisplayConfirmed === true
  };
})()`;

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
  live = await withCdpPage(browserPath, 9351, async (send) => {
    const log = (message) => console.error(`[operator-ground-header] ${message}`);
    if (preauth) {
      await send('Page.addScriptToEvaluateOnNewDocument', {
        source: `window.__MONTREAL_PREAUTH_TOKEN = ${JSON.stringify(preauth)};`
      });
    }
    await send('Page.addScriptToEvaluateOnNewDocument', {
      source: `(function() {
        const orig = HTMLCanvasElement.prototype.getContext;
        HTMLCanvasElement.prototype.getContext = function(type, attrs) {
          if (type === 'webgl' || type === 'webgl2' || type === 'experimental-webgl') {
            attrs = Object.assign({}, attrs || {}, { preserveDrawingBuffer: true });
          }
          return orig.call(this, type, attrs);
        };
      })();`
    });
    await send('Emulation.setDeviceMetricsOverride', {
      width: VIEWPORT.width,
      height: VIEWPORT.height,
      deviceScaleFactor: 1,
      mobile: false
    });
    await send('Page.navigate', { url: `${base}/spatial-v2/?qa=operator-ground-header-v1` });
    const shellMounted = await waitFor(
      send,
      'Boolean(window.__iqaiSpatialV2?.commandCenter && document.querySelector("[data-iqai-slot=\\"map-stage\\"]"))'
    );
    if (!shellMounted) throw new Error('Command center did not mount.');

    await waitFor(
      send,
      '["READY", "ERROR"].includes(window.__iqaiSpatialV2.mapFoundation.getState())',
      180,
      500
    );
    const mapState = await evaluate(send, 'window.__iqaiSpatialV2.mapFoundation.getState()');
    if (mapState !== 'READY') throw new Error(`Map foundation settled ${mapState}`);
    await waitFor(
      send,
      'document.querySelector("[data-iqai-operator-ground]") && document.querySelector("[data-iqai-operator-ground]").hidden === false',
      80,
      250
    );
    log('map READY, GROUND overlay visible');
    await waitFor(
      send,
      'window.__iqaiSpatialV2.ground().applyState === "READY" || window.__iqaiSpatialV2.ground().applyState === "ERROR"',
      80,
      250
    );

    let home = null;
    for (let i = 0; i < 12; i += 1) {
      try {
        home = await evaluateJson(send, `(() => {
          const api = window.__iqaiSpatialV2;
          const view = api?.mapFoundation?.getView?.();
          if (!view) return Promise.resolve({ ok: false });
          return api.mapFoundation.goHome().then(() => {
            const lon = view.center?.longitude;
            const lat = view.center?.latitude;
            return {
              ok: lon >= -74.3 && lon <= -73.2 && lat >= 45.2 && lat <= 45.9,
              lon,
              lat,
              scale: view.scale
            };
          });
        })()`, true);
      } catch (error) {
        home = { ok: false, error: String(error?.message || error) };
      }
      if (home?.ok) break;
      await sleep(750);
    }
    log(`home ${home?.ok ? 'ok' : 'miss'} ${home?.lon || ''} ${home?.lat || ''}`);
    await waitFor(
      send,
      `(() => {
        const view = window.__iqaiSpatialV2?.mapFoundation?.getView?.();
        const canvas = document.querySelector('.iqai-v2-map-host canvas, .esri-view-surface canvas');
        return Boolean(view?.ready && canvas && canvas.width > 8);
      })()`,
      40,
      500
    );
    await sleep(1500);

    const setGroundViaControl = async (modeId) => {
      await waitFor(
        send,
        'document.querySelector("[data-iqai-operator-ground-select]") && document.querySelector("[data-iqai-operator-ground-select]").disabled === false',
        80,
        250
      );
      return evaluateJson(send, `(async () => {
        const select = document.querySelector('[data-iqai-operator-ground-select]');
        if (!select) return { ok: false, error: 'GROUND select missing' };
        const option = [...select.options].find((item) => item.value === ${JSON.stringify(modeId)});
        if (!option) return { ok: false, error: 'option missing' };
        select.disabled = false;
        select.value = ${JSON.stringify(modeId)};
        select.dispatchEvent(new Event('change', { bubbles: true }));
        return { ok: true, value: select.value };
      })()`, true);
    };

    const waitGround = async (predicate, attempts = 90, waitMs = 500) => {
      for (let i = 0; i < attempts; i += 1) {
        const snap = await evaluateJson(send, `(() => {
          const ground = window.__iqaiSpatialV2.ground();
          return {
            currentMode: ground.currentMode,
            applyState: ground.applyState,
            displayConfirmed: ground.displayConfirmed === true,
            error: ground.error || null
          };
        })()`);
        if (predicate(snap)) return snap;
        await sleep(waitMs);
      }
      return evaluateJson(send, `(() => {
        const ground = window.__iqaiSpatialV2.ground();
        return {
          currentMode: ground.currentMode,
          applyState: ground.applyState,
          displayConfirmed: ground.displayConfirmed === true,
          error: ground.error || null,
          timeout: true
        };
      })()`);
    };

    const normalChrome = await evaluateJson(send, CHROME_PROBE);
    const normalShot = await capture(send, '01-normal-ground-header-closed-3840x2160.png');

    await evaluate(send, 'document.querySelector(\'[data-iqai-experience="EXPERT"]\').click()');
    await sleep(250);
    const expertChrome = await evaluateJson(send, CHROME_PROBE);
    const expertShot = await capture(send, '02-expert-ground-3840x2160.png');

    const nearmapClick = await setGroundViaControl('NEARMAP');
    const nearmapGround = await waitGround((snap) => (
      ['READY', 'ERROR'].includes(snap.applyState)
      && (
        (snap.currentMode === 'NEARMAP' && snap.displayConfirmed === true)
        || snap.applyState === 'ERROR'
      )
    ), 150, 500);
    await sleep(1200);
    const nearmapChrome = await evaluateJson(send, CHROME_PROBE);
    const nearmapPixels = await evaluateJson(send, PIXEL_STATS, true).catch((error) => ({
      error: String(error?.message || error)
    }));
    const nearmapShot = await capture(send, '03-nearmap-current-ground-3840x2160.png');
    log(`nearmap ${nearmapGround?.currentMode} ${nearmapGround?.applyState} confirmed=${nearmapGround?.displayConfirmed}`);

    const authoredClick = await setGroundViaControl('AUTHORED_WEBMAP');
    const authoredGround = await waitGround((snap) => (
      snap.currentMode === 'AUTHORED_WEBMAP'
      && ['READY', 'ERROR'].includes(snap.applyState)
    ), 90, 500);
    await sleep(800);
    const authoredChrome = await evaluateJson(send, CHROME_PROBE);
    const authoredPixels = await evaluateJson(send, PIXEL_STATS, true).catch((error) => ({
      error: String(error?.message || error)
    }));
    const authoredShot = await capture(send, '04-authored-map-restore-3840x2160.png');
    log(`authored ${authoredGround?.currentMode} ${authoredGround?.applyState}`);

    const selectable = {};
    for (const modeId of ['ESRI_WORLD_IMAGERY', 'PURE_BLACK', 'PURE_WHITE']) {
      const clicked = await setGroundViaControl(modeId);
      const settled = await waitGround((snap) => (
        ['READY', 'ERROR'].includes(snap.applyState)
        && (snap.currentMode === modeId || snap.applyState === 'ERROR')
      ), 90, 500);
      selectable[modeId] = {
        clicked,
        currentMode: settled.currentMode,
        applyState: settled.applyState,
        error: settled.error || null,
        optionPresent: Boolean(clicked?.ok)
      };
      log(`${modeId} ${settled.currentMode} ${settled.applyState}`);
    }
    await setGroundViaControl('AUTHORED_WEBMAP');
    await waitGround((snap) => snap.currentMode === 'AUTHORED_WEBMAP' && ['READY', 'ERROR'].includes(snap.applyState), 90, 500);

    await evaluate(send, 'document.querySelector(\'[data-iqai-experience="NORMAL"]\').click()');
    await sleep(200);
    const closedHeader = await evaluateJson(send, CHROME_PROBE);
    const closedShot = await capture(send, '05-primary-header-closed-3840x2160.png');

    await evaluate(send, 'document.querySelector("[data-iqai-system-status]").click()');
    await sleep(200);
    const openHeader = await evaluateJson(send, CHROME_PROBE);
    const openShot = await capture(send, '06-system-status-open-3840x2160.png');

    const mapViewCreateCount = await evaluate(send, 'window.__iqaiSpatialV2.mapFoundation.getMapViewCreateCount()');

    const optionIds = (normalChrome.groundOptions || []).map((item) => item.value);
    const checks = {
      groundVisibleNormal: normalChrome.groundHidden === false && normalChrome.groundLabel === 'GROUND',
      groundVisibleExpert: expertChrome.groundHidden === false && expertChrome.experience === 'EXPERT',
      groundVisibleWhileMapCapability: normalChrome.activeCapability === 'map' && normalChrome.groundHidden === false,
      nearmapChosenViaControl: nearmapClick?.ok === true && nearmapClick?.value === 'NEARMAP',
      nearmapDisplayConfirmed: nearmapGround?.currentMode === 'NEARMAP'
        && nearmapGround?.displayConfirmed === true
        && nearmapChrome.groundDisplayConfirmed === true,
      nearmapPixelsVisible: Number(nearmapPixels?.contrast || 0) >= 16
        && Array.isArray(nearmapPixels?.mean)
        && !(nearmapPixels.mean[0] < 8 && nearmapPixels.mean[1] < 8 && nearmapPixels.mean[2] < 8),
      operatorUsesGroundSnapshot: nearmapChrome.groundDisplayConfirmed === true
        && nearmapChrome.truthGroundDisplayConfirmed === true
        && nearmapChrome.truthDisplayConfirmed === nearmapChrome.timeDisplayConfirmed,
      authoredRestored: authoredGround?.currentMode === 'AUTHORED_WEBMAP'
        && authoredGround?.applyState === 'READY',
      esriSelectable: selectable.ESRI_WORLD_IMAGERY?.optionPresent === true,
      blackSelectable: selectable.PURE_BLACK?.optionPresent === true,
      whiteSelectable: selectable.PURE_WHITE?.optionPresent === true,
      operatorAllowlist: optionIds.includes('NEARMAP')
        && optionIds.includes('ESRI_WORLD_IMAGERY')
        && optionIds.includes('AUTHORED_WEBMAP')
        && optionIds.includes('PURE_BLACK')
        && optionIds.includes('PURE_WHITE')
        && !optionIds.includes('GOOGLE_SATELLITE')
        && !optionIds.includes('LOCAL_HIGHRES'),
      primaryNoEmail: closedHeader.primaryText.includes('@') === false,
      primaryNoConnectionClutter: !/NOT CONNECTED/.test(closedHeader.primaryText)
        && !/AGOL \/ PORTAL/.test(closedHeader.primaryText)
        && !/LOCAL AI/.test(closedHeader.primaryText),
      primaryIdentity: /IQAI SPATIAL/.test(closedHeader.primaryText)
        && /MONTRÉAL/.test(closedHeader.primaryText)
        && /SYSTEM STATUS/.test(closedHeader.primaryText)
        && /NORMAL/.test(closedHeader.primaryText)
        && /EXPERT/.test(closedHeader.primaryText),
      compactFromMap: closedHeader.compactStatus === 'MAP READY',
      systemStatusClosedHidesDetail: closedHeader.detailHidden === true,
      systemStatusOpensDiagnostics: openHeader.detailHidden === false
        && /NOT CONNECTED/.test(openHeader.detailText)
        && /SHELL ONLY/.test(openHeader.detailText),
      oneMapView: mapViewCreateCount === 1,
      presentationStateExcluded: closedHeader.truthHasExperience === false
        && closedHeader.truthHasSystemStatusOpen === false
    };

    return {
      mapState,
      mapViewCreateCount,
      home,
      normalChrome,
      expertChrome,
      nearmapClick,
      nearmapGround,
      nearmapChrome,
      nearmapPixels,
      authoredClick,
      authoredGround,
      authoredChrome,
      authoredPixels,
      selectable,
      closedHeader,
      openHeader,
      screenshots: [normalShot, expertShot, nearmapShot, authoredShot, closedShot, openShot],
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
  lockId: 'TB-LOCK-20260817-MTL-OPERATOR-GROUND-HEADER-V1',
  viewport: VIEWPORT,
  headed: true,
  base,
  browserPath,
  preauthInjected: Boolean(preauth),
  browserError,
  live,
  pass: Boolean(live?.pass && !browserError)
};

fs.writeFileSync(path.join(OUT, 'qa-report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
if (!report.pass) process.exitCode = 1;
