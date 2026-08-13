#!/usr/bin/env node
/**
 * Visual QA for Point Intelligence evidence-driven acquisition footprint.
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
const ORIGIN = { longitude: -73.5673, latitude: 45.5017 };

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

  const browser = await chromium.launch({
    headless: !HEADED,
    slowMo: HEADED ? 40 : 0,
    args: ['--disable-http-cache']
  });
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

  await page.evaluate(async (origin) => {
    const runtime = await import('/spatial/spatial-arcgis-runtime.js');
    const view = runtime.getMapView();
    await view.goTo({ center: [origin.longitude, origin.latitude], scale: 60000 }, { duration: 200 });
  }, ORIGIN);

  const controls = await page.evaluate(async () => {
    const service = await import('/spatial/point-intelligence-service.js');
    service.setPointIntelligenceModeEnabled(true);
    service.setPointIntelligenceAcquisitionMode('AUTO');
    return {
      enabled: service.isPointIntelligenceModeEnabled(),
      mode: service.getPointIntelligenceAcquisitionMode(),
      hasPoint: Boolean(document.querySelector('[data-pi-acq="POINT"]')),
      hasAuto: Boolean(document.querySelector('[data-pi-acq="AUTO"]')),
      hasDraw: Boolean(document.querySelector('[data-pi-acq="AREA"]')),
      drawToolsVisible: !document.querySelector('#spatial-pi-area')?.hidden
    };
  });
  report.controls = controls;

  await page.evaluate(async (origin) => {
    const service = await import('/spatial/point-intelligence-service.js');
    window.__PI_AUTO_QUERY = service.runPointIntelligenceQuery(origin, { force: true });
  }, ORIGIN);

  await page.waitForFunction(async () => {
    const runtime = await import('/spatial/spatial-arcgis-runtime.js');
    const view = runtime.getMapView();
    const layer = view?.map?.findLayerById('iqai-point-intel-click');
    return (layer?.graphics?.length || 0) > 0;
  }, { timeout: 20000 });

  report.screenshots.originImmediate = await shot(page, 'A-click-origin');
  report.screenshots.orangeMarker = await shot(page, 'B-orange-acquisition-origin');

  const acquired = await page.evaluate(async () => {
    const response = await window.__PI_AUTO_QUERY;
    const stations = await import('/spatial/point-intelligence-station-layer.js');
    const aoi = await import('/spatial/point-intelligence-aoi-layer.js');
    const records = stations.getCurrentStationRecords();
    return {
      bundleState: response?.bundleState || response?.queryState || null,
      acquisition: {
        mode: response?.acquisition?.mode || null,
        method: response?.acquisition?.method || null,
        meaning: response?.acquisition?.meaning || null,
        summary: response?.acquisition?.summary || null,
        performance: response?.acquisition?.performance || null,
        origin: response?.acquisition?.origin || null
      },
      layers: aoi.getAcquisitionLayerState(),
      stationCount: records.length,
      stations: records.map((row) => ({
        assetKey: row.assetKey,
        family: row.family,
        stationId: row.stationId,
        freshnessClass: row.freshnessClass,
        acquisitionRole: row.acquisitionRole || null,
        aoiClassification: row.aoiClassification,
        queryOriginDistanceMeters: row.queryOriginDistanceMeters ?? row.distanceMeters,
        longitude: row.longitude,
        latitude: row.latitude,
        observationId: row.observationId,
        primaryLabel: row.primaryLabel,
        primaryValue: row.primaryValue,
        channels: (row.channels || []).map((channel) => channel.family),
        sourceFamilies: row.sourceFamilies || []
      }))
    };
  });
  report.acquired = acquired;
  await page.waitForTimeout(500);

  const stations = acquired.stations || [];
  const farthest = [...stations].sort((a, b) => (
    (b.queryOriginDistanceMeters || 0) - (a.queryOriginDistanceMeters || 0)
  ))[0] || null;
  const hydro = stations.find((row) => row.family === 'hydrometric' && row.primaryValue != null)
    || stations.find((row) => row.family === 'hydrometric');
  const swob = stations.find((row) => row.family === 'weather');
  const climate = stations.find((row) => row.family === 'climate' || (row.channels || []).includes('climate'));
  const citypage = stations.find((row) => row.family === 'weather-current');
  const air = stations.find((row) => row.family === 'air-quality');
  report.familyPresence = {
    weather: Boolean(swob),
    hydrometric: Boolean(hydro),
    climate: Boolean(climate),
    weatherCurrent: Boolean(citypage),
    airQuality: Boolean(air)
  };

  await page.evaluate(async (origin) => {
    const runtime = await import('/spatial/spatial-arcgis-runtime.js');
    const view = runtime.getMapView();
    await view.goTo({ center: [origin.longitude, origin.latitude], scale: 140000 }, { duration: 240 });
  }, ORIGIN);
  await page.waitForTimeout(280);
  report.screenshots.perimeter = await shot(page, 'C-automatic-perimeter');
  report.screenshots.mesh = await shot(page, 'D-visible-technical-mesh');

  async function goToStation(station, scale) {
    if (!station) return;
    await page.evaluate(async ({ station: target, scale: nextScale }) => {
      const runtime = await import('/spatial/spatial-arcgis-runtime.js');
      const view = runtime.getMapView();
      await view.goTo({ center: [target.longitude, target.latitude], scale: nextScale }, { duration: 200 });
    }, { station, scale });
    await page.waitForTimeout(220);
  }

  if (swob) {
    await goToStation(swob, 8000);
    report.screenshots.weather = await shot(page, 'E-weather-evidence');
  }
  if (hydro) {
    await goToStation(hydro, 8000);
    report.screenshots.hydrometric = await shot(page, 'F-hydrometric-evidence');
  }
  if (air) {
    await goToStation(air, 8000);
    report.screenshots.airQuality = await shot(page, 'G-air-quality-evidence');
  } else {
    report.notes.push('AQHI / air-quality: NO DATA in this query');
  }
  const climateOrCity = climate || citypage;
  if (climateOrCity) {
    await goToStation(climateOrCity, 8000);
    report.screenshots.climateCurrentWeather = await shot(page, 'H-climate-current-weather-evidence');
  }

  if (farthest) {
    await page.evaluate(async ({ origin, farthest: target }) => {
      const runtime = await import('/spatial/spatial-arcgis-runtime.js');
      const Extent = await runtime.importArc('@arcgis/core/geometry/Extent.js');
      const view = runtime.getMapView();
      await view.goTo(new Extent({
        xmin: Math.min(origin.longitude, target.longitude) - 0.04,
        ymin: Math.min(origin.latitude, target.latitude) - 0.04,
        xmax: Math.max(origin.longitude, target.longitude) + 0.04,
        ymax: Math.max(origin.latitude, target.latitude) + 0.04,
        spatialReference: { wkid: 4326 }
      }), { duration: 240 });
    }, { origin: ORIGIN, farthest });
    await page.waitForTimeout(280);
    report.screenshots.farthest = await shot(page, 'I-farthest-station-extends-footprint');
  }

  await page.evaluate(async (origin) => {
    const runtime = await import('/spatial/spatial-arcgis-runtime.js');
    const view = runtime.getMapView();
    await view.goTo({ center: [origin.longitude, origin.latitude], scale: 220000 }, { duration: 240 });
  }, ORIGIN);
  await page.waitForTimeout(280);
  report.screenshots.regional = await shot(page, 'J-regional-evidence-constellation');

  const localTarget = swob || hydro || stations[0];
  if (localTarget) {
    await goToStation(localTarget, 4500);
    report.screenshots.local = await shot(page, 'K-local-engineered-station');
  }

  report.manualDrawingRequired = false;
  report.sketchActive = await page.evaluate(async () => {
    const area = await import('/spatial/point-intelligence-area-controller.js');
    return area.isPointIntelligenceAreaSketchActive();
  });

  async function hoverStation(station, scale = 5000) {
    if (!station) return null;
    await page.evaluate(async ({ station: target, scale: nextScale }) => {
      const runtime = await import('/spatial/spatial-arcgis-runtime.js');
      const stationsMod = await import('/spatial/point-intelligence-station-layer.js');
      const view = runtime.getMapView();
      await view.goTo({ center: [target.longitude, target.latitude], scale: nextScale }, { duration: 200 });
      await stationsMod.previewPointIntelligenceStationHover(target.assetKey, { x: 24, y: 80 });
    }, { station, scale });
    await page.waitForTimeout(180);
    return page.evaluate(() => {
      const hover = document.querySelector('.pi-station-hover');
      return hover && !hover.hidden ? hover.textContent.trim() : null;
    });
  }

  report.hover = {
    weather: await hoverStation(swob),
    hydrometric: await hoverStation(hydro),
    climate: await hoverStation(climate && climate.assetKey !== swob?.assetKey ? climate : null),
    weatherCurrent: await hoverStation(citypage),
    airQuality: await hoverStation(air)
  };
  const hoverShotTarget = swob || hydro || citypage;
  if (hoverShotTarget) {
    await hoverStation(hoverShotTarget, 5000);
    report.screenshots.hoverWeather = await shot(page, 'L-hover-weather');
  }
  if (hydro) {
    await hoverStation(hydro, 5000);
    report.screenshots.hoverHydro = await shot(page, 'L2-hover-hydrometric');
  }
  if (citypage) {
    await hoverStation(citypage, 5000);
    report.screenshots.hoverCitypage = await shot(page, 'L3-hover-current-weather');
  } else if (climate && climate.assetKey !== swob?.assetKey) {
    await hoverStation(climate, 5000);
    report.screenshots.hoverClimate = await shot(page, 'L3-hover-climate');
  }

  report.screenshots.summary = await shot(page, 'M-acquisition-summary');

  if (hoverShotTarget?.observationId) {
    await page.evaluate(async (observationId) => {
      const focus = await import('/spatial/point-intelligence-focus-controller.js');
      await focus.focusEvidenceFromMap({ observationId });
    }, hoverShotTarget.observationId);
    await page.waitForTimeout(300);
    report.inspector = await page.evaluate(() => {
      const inspector = document.querySelector('#lif-inspector-host');
      return inspector && !inspector.hidden ? inspector.textContent.slice(0, 1400) : null;
    });
  }

  const cleared = await page.evaluate(async () => {
    const area = await import('/spatial/point-intelligence-area-controller.js');
    const aoi = await import('/spatial/point-intelligence-aoi-layer.js');
    const stationsMod = await import('/spatial/point-intelligence-station-layer.js');
    const layer = await import('/spatial/point-intelligence-layer.js');
    await area.clearAcquisition();
    await new Promise((resolve) => setTimeout(resolve, 350));
    return {
      layers: aoi.getAcquisitionLayerState(),
      stationCount: stationsMod.getCurrentStationRecords().length,
      map: layer.getPointIntelligenceLayerState()
    };
  });
  await page.evaluate(async (origin) => {
    const runtime = await import('/spatial/spatial-arcgis-runtime.js');
    const view = runtime.getMapView();
    await view.goTo({ center: [origin.longitude, origin.latitude], scale: 60000 }, { duration: 200 });
  }, ORIGIN);
  report.cleared = cleared;
  report.screenshots.clear = await shot(page, 'N-clear');

  const pointRegression = await page.evaluate(async (origin) => {
    const service = await import('/spatial/point-intelligence-service.js');
    const aoi = await import('/spatial/point-intelligence-aoi-layer.js');
    service.setPointIntelligenceAcquisitionMode('POINT');
    const response = await service.runPointIntelligenceQuery(origin, { force: true });
    return {
      mode: service.getPointIntelligenceAcquisitionMode(),
      resultCount: response?.results?.length || 0,
      acquisitionMode: response?.acquisition?.mode || null,
      footprint: aoi.getAcquisitionLayerState().footprintGraphics
    };
  }, ORIGIN);
  report.quickPoint = pointRegression;

  const drawRegression = await page.evaluate(async () => {
    const service = await import('/spatial/point-intelligence-service.js');
    service.setPointIntelligenceAcquisitionMode('AREA');
    return {
      mode: service.getPointIntelligenceAcquisitionMode(),
      drawToolsVisible: !document.querySelector('#spatial-pi-area')?.hidden,
      hasPolygon: Boolean(document.querySelector('[data-pi-draw="polygon"]')),
      hasRectangle: Boolean(document.querySelector('[data-pi-draw="rectangle"]'))
    };
  });
  report.manualArea = drawRegression;

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
