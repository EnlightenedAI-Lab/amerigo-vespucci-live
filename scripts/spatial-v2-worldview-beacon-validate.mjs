/**
 * Live acceptance: WorldView position beacon + Street 360 drive trace on :3047.
 * Does not commit. Does not activate historical imagery or ObjectRef.
 */
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'artifacts', 'spatial-v2-worldview-orientation');
const PORT = 3047;
const FOCUS_A = Object.freeze({ longitude: -73.5535, latitude: 45.5047 });
const MATCH_METERS = 40;

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

function offsetMeters(a, b) {
  if (!a || !b) return null;
  const lon1 = Number(a.longitude ?? a.lng);
  const lat1 = Number(a.latitude ?? a.lat);
  const lon2 = Number(b.longitude ?? b.lng);
  const lat2 = Number(b.latitude ?? b.lat);
  if (![lon1, lat1, lon2, lat2].every(Number.isFinite)) return null;
  const toRad = (degrees) => (degrees * Math.PI) / 180;
  const radius = 6371000;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const x = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * radius * Math.asin(Math.min(1, Math.sqrt(x)));
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
    });
    const send = (method, params = {}) => {
      nextId += 1;
      const id = nextId;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          ws.off('message', onMessage);
          reject(new Error(`${method}: timeout`));
        }, 90000);
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
    await sleep(250);
    await send('Page.enable');
    await send('Runtime.enable');
    await send('Network.enable');
    await send('Network.setCacheDisabled', { cacheDisabled: true });
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

async function evaluateJson(send, expression) {
  const result = await send('Runtime.evaluate', {
    expression: `(async () => {
      const value = ${expression};
      const resolved = await value;
      if (typeof resolved === 'string') {
        try { return JSON.parse(resolved); } catch { return resolved; }
      }
      return resolved;
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

async function probe(send) {
  return evaluateJson(send, `JSON.stringify((() => {
    const api = window.__iqaiSpatialV2;
    const street = api?.street360?.snapshot?.() || {};
    const visual = api?.google3d?.snapshot?.() || {};
    const nav = api?.worldviewNavigation?.snapshot?.() || null;
    const beacon = api?.worldviewBeacon?.snapshot?.() || {};
    const traversal = api?.traversal?.snapshot?.() || {};
    const world = api?.world?.();
    const pose = beacon.pose || beacon.beacon || (street.panoramaPosition
      ? {
          longitude: street.panoramaPosition.longitude,
          latitude: street.panoramaPosition.latitude,
          heading: street.pov?.heading ?? null,
          sourceView: 'STREET 360'
        }
      : null);
    return {
      layout: api?.worldViewFrame?.snapshot?.()?.layout || null,
      maximized: api?.worldViewFrame?.snapshot?.()?.maximized || null,
      createCount: api?.mapViewCreateCount ?? null,
      requested: world?.temporal?.requested?.instantOrInterval || null,
      acquisition: world?.temporal?.acquisition || null,
      currentOnly: visual.displayedAcquisitionLabel || visual.temporalMode || null,
      streetOpen: street.open === true,
      streetState: street.stageState || null,
      streetHeading: street.pov?.heading ?? null,
      streetPitch: street.pov?.pitch ?? null,
      streetZoom: street.zoom ?? null,
      linksCount: street.linksCount ?? 0,
      panorama: street.panoramaPosition || null,
      visualOpen: visual.open === true,
      camera3d: visual.camera || null,
      cameraInstrument: (() => {
        const node = document.querySelector('#iqai-v2-camera-instrument');
        return {
          present: Boolean(node) && node.hidden !== true,
          text: node?.textContent || null,
          hidden: node?.hidden ?? null
        };
      })(),
      nav,
      pose,
      heading: pose?.heading ?? street.pov?.heading ?? null,
      mapScale: nav?.scale ?? null,
      mapViewScale: api?.mapFoundation?.getView?.()?.scale ?? null,
      mapViewZoom: api?.mapFoundation?.getView?.()?.zoom ?? null,
      lastNavApply: api?.mapFoundation?.getView?.()?.__iqaiLastNavApply || null,
      mapViewCenter: {
        longitude: api?.mapFoundation?.getView?.()?.center?.longitude ?? null,
        latitude: api?.mapFoundation?.getView?.()?.center?.latitude ?? null
      },
      rangeMeters: nav?.rangeMeters ?? null,
      points: traversal.points?.length || 0,
      distanceMeters: traversal.distanceMeters || 0,
      sessionId: traversal.sessionId || null,
      clearDisabled: document.querySelector('[data-iqai-clear-trace]')?.disabled ?? null,
      focus: api?.dropPin?.snapshot?.()?.focus || null,
      overlay: (() => {
        const mapView = api?.mapFoundation?.getView?.();
        const svg = mapView?.container?.querySelector?.('#iqai-v2-worldview-overlay');
        const compass = document.querySelector('#iqai-v2-north-instrument');
        const look = svg?.querySelector?.('[data-iqai-kind="WORLDVIEW_LOOK"]');
        const dirMarks = svg?.querySelectorAll?.('[data-iqai-trace-dir]')?.length || 0;
        const render = beacon.render || {};
        return {
          path: 'svg',
          svgPresent: Boolean(svg),
          compassPresent: Boolean(compass),
          compassText: compass?.textContent || null,
          lookPresent: Boolean(look) || render.lookPresent === true,
          traceDirCount: dirMarks,
          childCount: svg?.childNodes?.length ?? render.childCount ?? null,
          screen: render.screen || null,
          northUp: render.northUp ?? null,
          rotation: mapView?.rotation ?? render.rotation ?? null,
          lookHeading: beacon.look?.heading ?? null,
          beaconOnMap: Boolean(svg)
        };
      })()
    };
  })())`);
}

if (!(await isPortOpen(PORT))) {
  console.log(JSON.stringify({ error: '3047 not listening' }));
  process.exit(1);
}

const browserPath = findBrowser();
const live = await withCdpPage(browserPath, 9329, async (send, logs) => {
  await send('Page.navigate', { url: `http://localhost:${PORT}/spatial-v2/?v=worldview-orientation-v12` });
  await send('Page.bringToFront');
  const ready = await waitUntil(
    send,
    `document.querySelector('[data-iqai-map-state]')?.getAttribute('data-iqai-map-state') === 'READY'
      && Boolean(window.__iqaiSpatialV2?.worldViewFrame?.setLayout)
      && Boolean(window.__iqaiSpatialV2?.dropPin?.placeFocus)`,
    50,
    1000
  );
  if (!ready) {
    return { ready: false, probe: await probe(send), screenshots: { fail: await shot(send, 'fail-not-ready.png') } };
  }

  await evaluateJson(send, `void window.__iqaiSpatialV2.dropPin.placeFocus(${FOCUS_A.longitude}, ${FOCUS_A.latitude}, 'map')`);
  await waitUntil(send, `Boolean(window.__iqaiSpatialV2.dropPin.snapshot().focus)`, 20, 250);
  await evaluateJson(send, `void window.__iqaiSpatialV2.worldViewFrame.setLayout(1)`);
  await waitUntil(
    send,
    `Number(window.__iqaiSpatialV2.mapFoundation?.getView?.()?.scale) > 0`,
    16,
    250
  );
  await waitUntil(
    send,
    `window.__iqaiSpatialV2.mapFoundation.getView().updating === false`,
    40,
    200
  );
  await sleep(2800);
  await waitUntil(
    send,
    `window.__iqaiSpatialV2.mapFoundation.getView().updating === false
      && Number(window.__iqaiSpatialV2.mapFoundation.getView().scale) > 0`,
    20,
    250
  );
  await evaluateJson(send, `void window.__iqaiSpatialV2.worldviewBeacon.refresh()`);
  await sleep(400);
  const mapOnly = await probe(send);
  const compassShot = await shot(send, '01-map-compass.png');
  await evaluateJson(send, `window.__iqaiSpatialV2.mapFoundation.getView().rotation = 35`);
  await sleep(350);
  const rotatedMap = await probe(send);
  await evaluateJson(send, `window.__iqaiSpatialV2.worldviewBeacon.resetNorth()`);
  await sleep(500);
  const northReset = await probe(send);

  await evaluateJson(send, `void window.__iqaiSpatialV2.worldViewFrame.setLayout(2)`);
  await waitUntil(
    send,
    `window.__iqaiSpatialV2.street360.snapshot().stageState === 'OPEN' || window.__iqaiSpatialV2.street360.snapshot().stageState === 'UNAVAILABLE'`,
    50,
    1000
  );
  await sleep(2000);
  await waitUntil(
    send,
    `Boolean(window.__iqaiSpatialV2.worldviewBeacon?.snapshot?.()?.pose)
      || Boolean(window.__iqaiSpatialV2.street360.snapshot().panoramaPosition)`,
    20,
    250
  );
  await waitUntil(
    send,
    `Number(window.__iqaiSpatialV2.mapFoundation?.getView?.()?.scale) > 0
      && Number(window.__iqaiSpatialV2.mapFoundation.getView().scale) <= 20000`,
    16,
    250
  );
  await waitUntil(
    send,
    `window.__iqaiSpatialV2.mapFoundation.getView().updating === false`,
    40,
    200
  );
  await sleep(600);
  const testA = await probe(send);
  const testAShot = await shot(send, '02-street-zero-travel.png');
  if (testA.streetState !== 'OPEN') {
    return {
      ready: true,
      streetUnavailable: true,
      testA,
      screenshots: { testA: testAShot },
      googleErrorKinds: [...new Set(logs.flatMap((row) => row.kinds))]
    };
  }

  const headingBefore = testA.heading ?? testA.streetHeading;
  const pointsBefore = testA.points;
  await evaluateJson(send, `window.__iqaiSpatialV2.street360.look(55, 0)`);
  await sleep(800);
  const testB = await probe(send);
  const testBShot = await shot(send, '03-look-direction.png');

  await waitUntil(
    send,
    `Number(window.__iqaiSpatialV2.street360.snapshot().linksCount || 0) > 0
      || Boolean(window.__iqaiSpatialV2.street360.snapshot().panoPresent)`,
    20,
    250
  );
  const hopResults = [];
  let hops = 0;
  for (let i = 0; i < 16; i += 1) {
    const before = await probe(send);
    if ((before?.points || 0) >= 5) break;
    if (i === 3 && (before?.points || 0) < 2) {
      await evaluateJson(send, `window.__iqaiSpatialV2.street360.look(90, 0)`);
      await sleep(400);
    }
    const moved = await evaluateJson(send, `window.__iqaiSpatialV2.street360.moveAlongCoverage()`);
    hopResults.push({
      moved: moved?.moved === true,
      error: moved?.error || null,
      panoId: moved?.panoId || null
    });
    hops += moved?.moved === true ? 1 : 0;
    await sleep(950);
  }
  await sleep(700);
  const testC = await probe(send);
  const testCShot = await shot(send, '04-directional-trace.png');

  await evaluateJson(send, `window.__iqaiSpatialV2.street360.look(40, 0)`);
  await sleep(700);
  const rotateAfterDrive = await probe(send);

  await evaluateJson(send, `window.__iqaiSpatialV2.street360.look(180, 0)`);
  await sleep(800);
  await evaluateJson(send, `void window.__iqaiSpatialV2.worldviewBeacon.refresh()`);
  const lookBack = await probe(send);
  const lookBackShot = await shot(send, '05-look-back-history-preserved.png');

  await evaluateJson(send, `void window.__iqaiSpatialV2.worldViewFrame.setLayout(3)`);
  await waitUntil(send, `window.__iqaiSpatialV2.google3d.snapshot().stageState === 'OPEN'`, 50, 1000);
  await waitUntil(
    send,
    `Number.isFinite(Number(window.__iqaiSpatialV2.google3d.snapshot()?.camera?.heading))
      && Number.isFinite(Number(window.__iqaiSpatialV2.google3d.snapshot()?.camera?.tilt))`,
    30,
    250
  );
  await sleep(3200);
  await evaluateJson(send, `void window.__iqaiSpatialV2.worldviewBeacon.refresh()`);
  const testD = await probe(send);
  const testDShot = await shot(send, '06-3d-orientation.png');
  const heading3dBefore = Number(testD?.camera3d?.heading);
  const tilt3dBefore = Number(testD?.camera3d?.tilt);
  await evaluateJson(send, `window.__iqaiSpatialV2.google3d.nudgeHeading(40)`);
  await sleep(700);
  await evaluateJson(send, `window.__iqaiSpatialV2.google3d.nudgeTilt(-12)`);
  await sleep(700);
  await evaluateJson(send, `void window.__iqaiSpatialV2.worldviewBeacon.refresh()`);
  const after3dMove = await probe(send);
  const testDTiltShot = await shot(send, '07-3d-tilt-heading.png');

  await evaluateJson(send, `void window.__iqaiSpatialV2.worldViewFrame.closePane('3D VISUAL')`);
  await waitUntil(
    send,
    `window.__iqaiSpatialV2.google3d.snapshot().stageState === 'IDLE'
      || window.__iqaiSpatialV2.worldViewFrame.snapshot().layout === 2`,
    20,
    250
  );
  await sleep(1600);
  const after3dClose = await probe(send);

  await evaluateJson(send, `void window.__iqaiSpatialV2.worldViewFrame.setLayout(3)`);
  await waitUntil(send, `window.__iqaiSpatialV2.google3d.snapshot().stageState === 'OPEN'`, 50, 1000);
  await sleep(2200);
  const after3dReopen = await probe(send);
  const testEShot = await shot(send, 'layout-restore.png');

  await sleep(3800);
  let continued = { moved: false };
  let afterContinue = after3dReopen;
  for (let i = 0; i < 4 && (afterContinue?.points || 0) <= (after3dReopen?.points || 0); i += 1) {
    continued = await evaluateJson(send, `window.__iqaiSpatialV2.street360.moveAlongCoverage()`);
    await sleep(1000);
    afterContinue = await probe(send);
  }

  await evaluateJson(send, `void window.__iqaiSpatialV2.worldViewFrame.maximize('STREET 360')`);
  await sleep(500);
  const maximized = await probe(send);
  await evaluateJson(send, `void window.__iqaiSpatialV2.worldViewFrame.restore()`);
  await sleep(500);
  const testE = await probe(send);

  const navBeforeClear = testE.nav;
  await evaluateJson(send, `window.__iqaiSpatialV2.traversal.clear()`);
  await sleep(400);
  const testF = await probe(send);
  const testFShot = await shot(send, '08-clear-trace.png');

  return {
    ready: true,
    headingBefore,
    pointsBefore,
    hops,
    hopResults,
    mapOnly,
    rotatedMap,
    northReset,
    lookBack,
    rotateAfterDrive,
    heading3dBefore,
    tilt3dBefore,
    after3dMove,
    after3dClose,
    after3dReopen,
    continued,
    afterContinue,
    navBeforeClear,
    testA,
    testB,
    testC,
    testD,
    maximized,
    testE,
    testF,
    googleErrorKinds: [...new Set(logs.flatMap((row) => row.kinds))],
    screenshots: {
      compass: compassShot,
      testA: testAShot,
      testB: testBShot,
      testC: testCShot,
      lookBack: lookBackShot,
      testD: testDShot,
      testDTilt: testDTiltShot,
      testE: testEShot,
      testF: testFShot
    }
  };
});

const beaconOffset = offsetMeters(live.testA?.pose, live.testA?.panorama);
const headingAfter = live.testB?.heading ?? live.testB?.streetHeading;
const headingRotated = Number.isFinite(Number(headingAfter))
  && Number.isFinite(Number(live.headingBefore))
  && Math.abs(((Number(headingAfter) - Number(live.headingBefore) + 540) % 360) - 180) > 10;
const headingDidNotGrow = (live.testB?.points || 0) <= (live.pointsBefore || 0);
const rotateAfterDriveOk = (live.rotateAfterDrive?.points || 0) === (live.testC?.points || 0);
const lookBackDidNotGrow = (live.lookBack?.points || 0) === (live.testC?.points || 0);
const lookBackRotated = Number.isFinite(Number(live.lookBack?.heading))
  && Number.isFinite(Number(live.rotateAfterDrive?.heading))
  && Math.abs(((Number(live.lookBack.heading) - Number(live.rotateAfterDrive.heading) + 540) % 360) - 180) > 90;
const compassPresent = live.mapOnly?.overlay?.compassPresent === true
  || live.testA?.overlay?.compassPresent === true;
const compassLabels = /N/.test(live.mapOnly?.overlay?.compassText || live.testA?.overlay?.compassText || '')
  && /E/.test(live.mapOnly?.overlay?.compassText || live.testA?.overlay?.compassText || '')
  && /S/.test(live.mapOnly?.overlay?.compassText || live.testA?.overlay?.compassText || '')
  && /W/.test(live.mapOnly?.overlay?.compassText || live.testA?.overlay?.compassText || '')
  && /TRUE/.test(live.mapOnly?.overlay?.compassText || live.testA?.overlay?.compassText || '');
const northResetOk = Number(live.rotatedMap?.overlay?.rotation) > 10
  && Math.abs(Number(live.northReset?.overlay?.rotation) || 0) < 1.5;
const zeroTravelLook = (live.testA?.points || 0) <= 1
  && live.testA?.overlay?.lookPresent === true
  && live.testA?.overlay?.compassPresent === true;
const directionalTrace = (live.testC?.overlay?.traceDirCount || 0) >= 1
  && (live.testC?.overlay?.traceDirCount || 0) <= 2;
const camera3dPresent = live.testD?.cameraInstrument?.present === true
  || /CAMERA/.test(live.testD?.cameraInstrument?.text || '');
const heading3dChanged = Number.isFinite(Number(live.after3dMove?.camera3d?.heading))
  && Number.isFinite(Number(live.heading3dBefore))
  && ((d) => (d > 180 ? 360 - d : d))(
    Math.abs(Number(live.after3dMove.camera3d.heading) - Number(live.heading3dBefore)) % 360
  ) > 12;
const tilt3dChanged = Number.isFinite(Number(live.after3dMove?.camera3d?.tilt))
  && Number.isFinite(Number(live.tilt3dBefore))
  && Math.abs(Number(live.after3dMove.camera3d.tilt) - Number(live.tilt3dBefore)) > 4;
const false3dMove = (live.after3dMove?.points || 0) === (live.testD?.points || 0);
const clearKeepsOrientation = (live.testF?.points || 0) === 0
  && live.testF?.overlay?.lookPresent === true
  && live.testF?.overlay?.compassPresent === true;
const usefulRange = Number(live.testC?.rangeMeters ?? live.testA?.rangeMeters);
const mapViewScale = Number(live.testC?.mapViewScale ?? live.testA?.mapViewScale);
const usefulScale = Number.isFinite(usefulRange) && usefulRange > 0 && usefulRange <= 720
  && Number.isFinite(mapViewScale) && mapViewScale > 0 && mapViewScale <= 20000;
const false3dOpen = (live.testD?.points || 0) === (live.rotateAfterDrive?.points || live.testC?.points || 0);
const false3dClose = (live.after3dClose?.points || 0) === (live.testD?.points || 0);
const false3dReopen = (live.after3dReopen?.points || 0) === (live.after3dClose?.points || live.testD?.points || 0);
const continueOk = (live.afterContinue?.points || 0) > (live.after3dReopen?.points || 0)
  && live.continued?.moved === true;
const clearOk = (live.testF?.points || 0) === 0
  && Boolean(live.testF?.pose)
  && live.testF?.nav
  && offsetMeters(live.testF.nav, live.navBeforeClear) != null
  && offsetMeters(live.testF.nav, live.navBeforeClear) < MATCH_METERS;

const report = {
  origin: `http://localhost:${PORT}/spatial-v2/`,
  ready: live.ready,
  streetUnavailable: live.streetUnavailable === true,
  beaconOffsetMeters: beaconOffset,
  headingRotated,
  headingDidNotGrow,
  hops: live.hops,
  hopResults: live.hopResults,
  drivePoints: live.testC?.points,
  driveDistance: live.testC?.distanceMeters,
  usefulRangeMeters: usefulRange,
  mapViewScale,
  mapViewCenter: live.testC?.mapViewCenter || live.testA?.mapViewCenter || null,
  lastNavApply: live.testC?.lastNavApply || live.testA?.lastNavApply || null,
  overlay: live.testC?.overlay || live.testA?.overlay || null,
  compassPresent,
  compassLabels,
  northResetOk,
  zeroTravelLook,
  lookBackDidNotGrow,
  lookBackRotated,
  directionalTrace,
  camera3dPresent,
  heading3dChanged,
  tilt3dChanged,
  false3dMove,
  clearKeepsOrientation,
  usefulScale,
  rotateAfterDriveOk,
  false3dOpen,
  false3dClose,
  false3dReopen,
  continueOk,
  layout3: live.testD?.layout === 3 && live.testD?.visualOpen === true,
  maximizeSurvive: (live.maximized?.points || 0) === (live.testC?.points || 0)
    || (live.testE?.points || 0) >= 1,
  restoreSurvive: (live.testE?.points || 0) >= 1,
  clearOk,
  createCount: live.testF?.createCount ?? live.testA?.createCount,
  requested: live.testF?.requested ?? live.testA?.requested,
  acquisition: live.testF?.acquisition ?? live.testA?.acquisition,
  currentOnly: live.testD?.currentOnly,
  focusPreserved: Boolean(live.testF?.focus || live.testA?.focus),
  authError: Boolean(live.googleErrorKinds?.length),
  screenshots: live.screenshots,
  live
};

fs.writeFileSync(path.join(OUT, 'worldview-orientation-validate.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify({
  ready: report.ready,
  streetUnavailable: report.streetUnavailable,
  beaconOffsetMeters: report.beaconOffsetMeters,
  headingRotated: report.headingRotated,
  headingDidNotGrow: report.headingDidNotGrow,
  hops: report.hops,
  hopResults: report.hopResults,
  drivePoints: report.drivePoints,
  driveDistance: report.driveDistance,
  usefulRangeMeters: report.usefulRangeMeters,
  mapViewScale: report.mapViewScale,
  usefulScale: report.usefulScale,
  overlay: report.overlay,
  compassPresent: report.compassPresent,
  compassLabels: report.compassLabels,
  northResetOk: report.northResetOk,
  zeroTravelLook: report.zeroTravelLook,
  lookBackDidNotGrow: report.lookBackDidNotGrow,
  lookBackRotated: report.lookBackRotated,
  directionalTrace: report.directionalTrace,
  camera3dPresent: report.camera3dPresent,
  heading3dChanged: report.heading3dChanged,
  tilt3dChanged: report.tilt3dChanged,
  false3dMove: report.false3dMove,
  clearKeepsOrientation: report.clearKeepsOrientation,
  rotateAfterDriveOk: report.rotateAfterDriveOk,
  false3dOpen: report.false3dOpen,
  false3dReopen: report.false3dReopen,
  continueOk: report.continueOk,
  layout3: report.layout3,
  maximizeSurvive: report.maximizeSurvive,
  restoreSurvive: report.restoreSurvive,
  clearOk: report.clearOk,
  createCount: report.createCount,
  authError: report.authError,
  screenshots: report.screenshots
}, null, 2));

if (
  !live.ready
  || live.streetUnavailable
  || report.createCount !== 1
  || report.authError
  || !(beaconOffset != null && beaconOffset <= MATCH_METERS)
  || !headingRotated
  || !headingDidNotGrow
  || (live.testC?.points || 0) < 5
  || !usefulScale
  || !rotateAfterDriveOk
  || !false3dOpen
  || !false3dReopen
  || !continueOk
  || !report.layout3
  || !report.clearOk
  || !compassPresent
  || !compassLabels
  || !northResetOk
  || !zeroTravelLook
  || !lookBackDidNotGrow
  || !lookBackRotated
  || !directionalTrace
  || !camera3dPresent
  || !heading3dChanged
  || !tilt3dChanged
  || !false3dMove
  || !clearKeepsOrientation
) {
  process.exitCode = 1;
}
