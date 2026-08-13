#!/usr/bin/env node
/**
 * Visual QA for Point Intelligence Area Acquisition.
 * Live Spatial product at http://localhost:3000/spatial/.
 */
import { chromium } from 'playwright';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  isPortOpen,
  startSpatialServer,
  waitForHttp
} from './lib/spatial-server.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const ARTIFACT_DIR = resolve(REPO_ROOT, 'artifacts', 'pi-area-acquisition');
const AUTH_PROFILE_DIR = resolve(REPO_ROOT, '.playwright-auth', 'montreal');
const AUTH_READY_MARKER = resolve(AUTH_PROFILE_DIR, '.auth-ready.json');
const SPATIAL_PORT = Number(process.env.SPATIAL_PORT || 3000);
const BASE = process.env.SPATIAL_URL || `http://localhost:${SPATIAL_PORT}`;
const HEADED = process.env.HEADED === '1';

const DOWNTOWN_AOI = {
  type: 'Polygon',
  coordinates: [[
    [-73.608, 45.493],
    [-73.568, 45.493],
    [-73.568, 45.522],
    [-73.608, 45.522],
    [-73.608, 45.493]
  ]]
};

function loadEnvFile(path) {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (!process.env[key]) process.env[key] = value;
  }
}

loadEnvFile(resolve(REPO_ROOT, '.env'));
mkdirSync(ARTIFACT_DIR, { recursive: true });

async function fetchPreauthToken() {
  const username = process.env.ARCGIS_USERNAME;
  const password = process.env.ARCGIS_PASSWORD;
  const portal = (process.env.ARCGIS_PORTAL_URL || 'https://www.arcgis.com').replace(/\/$/, '');
  if (!username || !password) return null;
  const params = new URLSearchParams({
    username,
    password,
    client: 'requestip',
    expiration: '60',
    f: 'json'
  });
  const res = await fetch(`${portal}/sharing/rest/generateToken`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString()
  });
  const data = await res.json().catch(() => ({}));
  return data.token ? { token: data.token, expires: data.expires } : null;
}

async function waitForMapReady(page, timeoutMs = 180000) {
  return page.waitForFunction(() => {
    const canvas = document.querySelector('#spatial-map-host canvas');
    const layers = document.querySelectorAll('#spatial-layer-tree .layer-row input[type="checkbox"]');
    const catalog = window.__IQAI_WEBMAP_LAYER_CATALOG__?.layers?.length || 0;
    const operational = window.__IQAI_APP_SHELL__?.mapOperational !== false;
    return Boolean(canvas && layers.length > 0 && catalog > 5 && operational);
  }, { timeout: timeoutMs }).catch(() => false);
}

async function shot(page, name) {
  const full = resolve(ARTIFACT_DIR, `${name}.png`);
  const map = resolve(ARTIFACT_DIR, `${name}-map.png`);
  await page.screenshot({ path: full, fullPage: false });
  const host = page.locator('#spatial-map-host');
  if (await host.count()) {
    await host.screenshot({ path: map }).catch(() => {});
  }
  return { full, map };
}

async function mapScreen(page, longitude, latitude) {
  return page.evaluate(async ({ longitude, latitude }) => {
    const runtime = await import('/spatial/spatial-arcgis-runtime.js');
    const Point = await runtime.importArc('@arcgis/core/geometry/Point.js');
    const view = runtime.getMapView();
    const host = document.querySelector('#spatial-map-host');
    const rect = host.getBoundingClientRect();
    const screen = view.toScreen(new Point({ longitude, latitude }));
    if (!screen) return null;
    return { x: rect.left + screen.x, y: rect.top + screen.y };
  }, { longitude, latitude });
}

async function main() {
  const report = {
    startedAt: new Date().toISOString(),
    url: `${BASE}/spatial/`,
    mapReady: false,
    screenshots: {},
    notes: []
  };

  let spatialChild = null;
  if (!(await isPortOpen(SPATIAL_PORT))) {
    spatialChild = startSpatialServer(REPO_ROOT);
    const ready = await waitForHttp(`${BASE}/api/spatial/runtime-info`, 90000);
    if (!ready) {
      report.error = 'Spatial server did not become ready';
      writeFileSync(resolve(ARTIFACT_DIR, 'latest.json'), `${JSON.stringify(report, null, 2)}\n`);
      process.exit(1);
    }
    report.startedServer = true;
    report.serverPid = spatialChild.pid;
  } else {
    report.startedServer = false;
  }

  const runtime = await fetch(`${BASE}/api/spatial/runtime-info`).then((res) => res.json()).catch(() => ({}));
  report.runtime = {
    gitHead: runtime.gitHead,
    gitBranch: runtime.gitBranch,
    gitDirty: runtime.gitDirty,
    serverPid: runtime.serverPid,
    runtimeBuildId: runtime.runtimeBuildId,
    spatialSourceFingerprint: runtime.spatialSourceFingerprint,
    repoPath: runtime.repoPath
  };

  const preauth = (process.env.ARCGIS_USERNAME && process.env.ARCGIS_PASSWORD)
    ? await fetchPreauthToken()
    : null;

  const browser = await chromium.launch({ headless: !HEADED, slowMo: HEADED ? 40 : 0 });
  let context;
  let page;
  if (preauth) {
    context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    page = await context.newPage();
    await page.addInitScript((tokenData) => {
      window.__MONTREAL_PREAUTH_TOKEN = tokenData;
    }, preauth);
    report.auth = 'preauth-token';
  } else if (existsSync(AUTH_READY_MARKER)) {
    context = await chromium.launchPersistentContext(AUTH_PROFILE_DIR, {
      headless: !HEADED,
      viewport: { width: 1440, height: 900 }
    });
    page = context.pages()[0] || await context.newPage();
    report.auth = 'playwright-profile';
  } else {
    context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    page = await context.newPage();
    report.auth = 'none';
    report.notes.push('No ArcGIS preauth token or Playwright auth profile');
  }

  page.setDefaultTimeout(120000);
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(String(error?.message || error)));
  await page.goto(`${BASE}/spatial/?v=${Date.now()}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  report.mapReady = Boolean(await waitForMapReady(page, 180000));
  report.pageErrors = pageErrors.slice(0, 12);

  if (!report.mapReady) {
    report.error = 'Map not operational — cannot complete visual QA';
    report.screenshots.boot = await shot(page, '00-boot');
    writeFileSync(resolve(ARTIFACT_DIR, 'latest.json'), `${JSON.stringify(report, null, 2)}\n`);
    console.log(JSON.stringify(report, null, 2));
    await browser.close();
    process.exit(1);
  }

  await page.evaluate(async () => {
    const runtime = await import('/spatial/spatial-arcgis-runtime.js');
    const view = runtime.getMapView();
    await view.goTo({ center: [-73.5673, 45.5017], scale: 80000 }, { duration: 200 });
  });

  const ready = await page.evaluate(async () => {
    const service = await import('/spatial/point-intelligence-service.js');
    service.setPointIntelligenceModeEnabled(true);
    service.setPointIntelligenceAcquisitionMode('AREA');
    return {
      enabled: service.isPointIntelligenceModeEnabled(),
      mode: service.getPointIntelligenceAcquisitionMode(),
      hasPointButton: Boolean(document.querySelector('[data-pi-acq="POINT"]')),
      hasAreaButton: Boolean(document.querySelector('[data-pi-acq="AREA"]')),
      hasDraw: Boolean(document.querySelector('[data-pi-area="draw"]')),
      hasClear: Boolean(document.querySelector('[data-pi-area="clear"]'))
    };
  });
  report.controls = ready;
  report.screenshots.empty = await shot(page, 'A-empty-before-acquisition');

  await page.evaluate(async () => {
    const runtime = await import('/spatial/spatial-arcgis-runtime.js');
    const view = runtime.getMapView();
    await view.goTo({ center: [-73.588, 45.507], scale: 45000 }, { duration: 200 });
  });
  const drawState = await page.evaluate(async () => {
    const runtime = await import('/spatial/spatial-arcgis-runtime.js');
    const area = await import('/spatial/point-intelligence-area-controller.js');
    runtime.getMapView()?.container?.focus?.();
    const ok = await area.startDraw('polygon');
    return { ok, active: area.isPointIntelligenceAreaSketchActive() };
  });
  report.drawState = drawState;
  await page.waitForTimeout(400);
  const mapBox = await page.locator('#spatial-map-host').boundingBox();
  if (mapBox) {
    const clicks = [
      [0.32, 0.38],
      [0.62, 0.38],
      [0.62, 0.68],
      [0.32, 0.68]
    ];
    for (const [fx, fy] of clicks) {
      await page.mouse.click(mapBox.x + mapBox.width * fx, mapBox.y + mapBox.height * fy);
      await page.waitForTimeout(220);
    }
  }
  report.screenshots.drawing = await shot(page, 'B-polygon-drawing');

  await page.evaluate(async () => {
    const area = await import('/spatial/point-intelligence-area-controller.js');
    await area.cancelAreaSketch();
  });

  const acquired = await page.evaluate(async (polygon) => {
    const area = await import('/spatial/point-intelligence-area-controller.js');
    const stations = await import('/spatial/point-intelligence-station-layer.js');
    const aoi = await import('/spatial/point-intelligence-aoi-layer.js');
    const started = performance.now();
    const response = await area.acquirePolygon(polygon);
    const records = stations.getCurrentStationRecords();
    const layers = aoi.getAcquisitionLayerState();
    return {
      ms: Math.round(performance.now() - started),
      bundleState: response?.bundleState || response?.queryState || null,
      acquisition: {
        mode: response?.acquisition?.mode || null,
        summary: response?.acquisition?.summary || null,
        performance: response?.acquisition?.performance || null,
        plan: response?.acquisition?.plan || null
      },
      layers,
      stationCount: records.length,
      stations: records.map((row) => ({
        assetKey: row.assetKey,
        family: row.family,
        stationId: row.stationId,
        freshnessClass: row.freshnessClass,
        aoiClassification: row.aoiClassification,
        aoiBoundaryDistanceMeters: row.aoiBoundaryDistanceMeters,
        longitude: row.longitude,
        latitude: row.latitude,
        observationId: row.observationId,
        primaryLabel: row.primaryLabel,
        primaryValue: row.primaryValue,
        clickDistanceMeters: row.distanceMeters
      }))
    };
  }, DOWNTOWN_AOI);
  report.acquired = acquired;
  await page.waitForTimeout(500);
  await page.evaluate(() => {
    document.querySelector('.pi-acquisition-summary')?.scrollIntoView({ block: 'center' });
    document.querySelector('#spatial-point-intelligence-results')?.scrollIntoView({ block: 'nearest' });
  });
  report.screenshots.mesh = await shot(page, 'C-acquisition-mesh');
  report.screenshots.extent = await shot(page, 'F-extent-aoi-and-external');

  const inside = (acquired.stations || []).find((row) => row.aoiClassification === 'INSIDE_AOI');
  const external = (acquired.stations || []).find((row) => row.aoiClassification === 'SUPPORTING_EXTERNAL');

  if (inside) {
    await page.evaluate(async (target) => {
      const runtime = await import('/spatial/spatial-arcgis-runtime.js');
      const view = runtime.getMapView();
      await view.goTo({ center: [target.longitude, target.latitude], scale: 22000 }, { duration: 200 });
    }, inside);
    report.screenshots.inside = await shot(page, 'D-sensors-inside-aoi');
  }

  if (external) {
    await page.evaluate(async (target) => {
      const runtime = await import('/spatial/spatial-arcgis-runtime.js');
      const view = runtime.getMapView();
      await view.goTo({ center: [target.longitude, target.latitude], scale: 28000 }, { duration: 200 });
    }, external);
    report.screenshots.external = await shot(page, 'E-external-supporting-sensor');
  }

  async function hoverStation(station, scale = 4000) {
    if (!station) return null;
    await page.evaluate(async ({ station: target, scale: nextScale }) => {
      const runtime = await import('/spatial/spatial-arcgis-runtime.js');
      const Point = await runtime.importArc('@arcgis/core/geometry/Point.js');
      const view = runtime.getMapView();
      await view.goTo({ center: [target.longitude, target.latitude], scale: nextScale }, { duration: 200 });
      const screen = view.toScreen(new Point({
        longitude: target.longitude,
        latitude: target.latitude
      }));
      if (screen) {
        view.emit('pointer-move', {
          x: screen.x,
          y: screen.y,
          button: 0,
          buttons: 0,
          pointerType: 'mouse'
        });
      }
    }, { station, scale });
    await page.waitForTimeout(250);
    const screen = await mapScreen(page, station.longitude, station.latitude);
    if (screen?.x) {
      await page.mouse.move(screen.x, screen.y);
      await page.waitForTimeout(220);
    }
    let text = await page.evaluate(() => {
      const hover = document.querySelector('.pi-station-hover');
      return hover && !hover.hidden ? hover.textContent.trim() : null;
    });
    if (!text && station.assetKey) {
      await page.evaluate(async (assetKey) => {
        const stations = await import('/spatial/point-intelligence-station-layer.js');
        stations.previewPointIntelligenceStationHover(assetKey, { x: 24, y: 80 });
      }, station.assetKey);
      await page.waitForTimeout(120);
      text = await page.evaluate(() => {
        const hover = document.querySelector('.pi-station-hover');
        return hover && !hover.hidden ? hover.textContent.trim() : null;
      });
    }
    return text;
  }

  if (inside) {
    report.hoverInside = await hoverStation(inside);
    report.screenshots.hoverInside = await shot(page, 'G-hover-inside');
  }
  if (external) {
    report.hoverExternal = await hoverStation(external);
    report.screenshots.hoverExternal = await shot(page, 'H-hover-external');
    await page.evaluate(async (observationId) => {
      const focus = await import('/spatial/point-intelligence-focus-controller.js');
      await focus.focusEvidenceFromMap({
        observationId,
        family: 'hydrometric-measurement'
      });
    }, external.observationId);
    await page.waitForTimeout(350);
    report.connector = await page.evaluate(async () => {
      const aoi = await import('/spatial/point-intelligence-aoi-layer.js');
      const inspector = document.querySelector('#lif-inspector-host');
      return {
        layers: aoi.getAcquisitionLayerState(),
        inspectorText: inspector && !inspector.hidden ? inspector.textContent.slice(0, 1200) : null
      };
    });
    report.screenshots.selectedExternal = await shot(page, 'I-selected-external-connector');
  }

  const closeTarget = inside || external;
  if (closeTarget) {
    await page.evaluate(async (target) => {
      const runtime = await import('/spatial/spatial-arcgis-runtime.js');
      const view = runtime.getMapView();
      await view.goTo({ center: [target.longitude, target.latitude], scale: 4000 }, { duration: 200 });
    }, closeTarget);
    report.screenshots.closeCim = await shot(page, 'J-close-scale-cim');
  }

  const cleared = await page.evaluate(async () => {
    const area = await import('/spatial/point-intelligence-area-controller.js');
    const aoi = await import('/spatial/point-intelligence-aoi-layer.js');
    const stations = await import('/spatial/point-intelligence-station-layer.js');
    const layer = await import('/spatial/point-intelligence-layer.js');
    await area.clearAcquisition();
    await new Promise((resolve) => setTimeout(resolve, 350));
    return {
      layers: aoi.getAcquisitionLayerState(),
      stationCount: stations.getCurrentStationRecords().length,
      map: layer.getPointIntelligenceLayerState()
    };
  });
  await page.evaluate(async () => {
    const runtime = await import('/spatial/spatial-arcgis-runtime.js');
    const view = runtime.getMapView();
    await view.goTo({ center: [-73.5673, 45.5017], scale: 80000 }, { duration: 200 });
  });
  report.cleared = cleared;
  report.screenshots.clear = await shot(page, 'K-clear-acquisition');

  const quickPoint = await page.evaluate(async () => {
    const service = await import('/spatial/point-intelligence-service.js');
    service.setPointIntelligenceAcquisitionMode('POINT');
    const started = performance.now();
    const response = await service.runPointIntelligenceQuery({
      longitude: -73.5673,
      latitude: 45.5017
    }, { force: true });
    const aoi = await import('/spatial/point-intelligence-aoi-layer.js');
    return {
      ms: Math.round(performance.now() - started),
      bundleState: response?.bundleState || response?.queryState || null,
      resultCount: response?.results?.length || 0,
      acquisitionMode: response?.acquisition?.mode || null,
      footprint: aoi.getAcquisitionLayerState().footprintGraphics
    };
  });
  report.quickPoint = quickPoint;

  const off = await page.evaluate(async () => {
    const service = await import('/spatial/point-intelligence-service.js');
    const layer = await import('/spatial/point-intelligence-layer.js');
    const aoi = await import('/spatial/point-intelligence-aoi-layer.js');
    service.setPointIntelligenceModeEnabled(false);
    await new Promise((resolve) => setTimeout(resolve, 300));
    return {
      layers: layer.getPointIntelligenceLayerState(),
      aoi: aoi.getAcquisitionLayerState()
    };
  });
  report.piOff = off;

  report.pageErrors = pageErrors.slice(0, 16);
  report.finishedAt = new Date().toISOString();
  writeFileSync(resolve(ARTIFACT_DIR, 'latest.json'), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
  await browser.close();
}

await main();
