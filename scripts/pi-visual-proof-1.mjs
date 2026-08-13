#!/usr/bin/env node
/**
 * Visual QA for Point Intelligence hydrometric + SWOB observation-object proof.
 * Uses the live Spatial product at http://localhost:3000/spatial/.
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
import { buildProofStationRecords } from '../public/spatial/point-intelligence-station-model.js';
import { adaptBundleResponse } from '../public/spatial/point-intelligence-bundle.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const ARTIFACT_DIR = resolve(REPO_ROOT, 'artifacts', 'pi-visual-proof-1');
const AUTH_PROFILE_DIR = resolve(REPO_ROOT, '.playwright-auth', 'montreal');
const AUTH_READY_MARKER = resolve(AUTH_PROFILE_DIR, '.auth-ready.json');
const SPATIAL_PORT = Number(process.env.SPATIAL_PORT || 3000);
const BASE = process.env.SPATIAL_URL || `http://localhost:${SPATIAL_PORT}`;
const HEADED = process.env.HEADED === '1';
const MONTREAL = { longitude: -73.5673, latitude: 45.5017 };

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

async function queryLiveBundle() {
  const started = Date.now();
  const res = await fetch(`${BASE}/api/spatial/point-intelligence/query-bundle`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      geometry: { type: 'Point', coordinates: [MONTREAL.longitude, MONTREAL.latitude] },
      radiusMeters: 3000,
      informationFamilies: 'AUTO',
      temporalIntent: { mode: 'LATEST' }
    })
  });
  const body = await res.json().catch(() => ({}));
  const adapted = adaptBundleResponse(body, MONTREAL, 1);
  const results = Array.isArray(adapted.results) ? adapted.results : [];
  const stations = buildProofStationRecords(results);
  const hydroKeys = new Map();
  const swobKeys = new Map();
  for (const result of results) {
    const family = result.category || result.nativeCollectionId;
    if (family === 'hydrometric' || family === 'hydrometric-measurement') {
      const id = result.properties?.STATION_NUMBER || result.nativeRecordId;
      hydroKeys.set(String(id), (hydroKeys.get(String(id)) || 0) + 1);
    }
    if (family === 'weather') {
      const id = result.properties?.['tc_id-value'] || result.nativeRecordId;
      swobKeys.set(String(id), (swobKeys.get(String(id)) || 0) + 1);
    }
  }
  return {
    http: res.status,
    ms: Date.now() - started,
    bundleState: adapted.bundleState || body.bundleState || body.queryState || null,
    resultCount: results.length,
    familyStatus: Object.fromEntries(
      Object.entries(body.families || {}).map(([key, value]) => [
        key,
        { status: value.status || value.queryState, count: value.resultCount ?? value.results?.length ?? 0 }
      ])
    ),
    stationCount: stations.length,
    hydroStations: stations.filter((row) => row.family === 'hydrometric').length,
    weatherStations: stations.filter((row) => row.family === 'weather').length,
    freshness: Object.fromEntries(
      stations.map((row) => [row.assetKey, { freshness: row.freshnessClass, primary: row.primaryLabel, unit: row.primaryUnit, trend: Boolean(row.trend) }])
    ),
    collapse: {
      hydroRawDistinct: hydroKeys.size,
      weatherRawDistinctNativeOrTc: swobKeys.size,
      stationObjects: stations.length
    }
  };
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
    serverStartedAt: runtime.serverStartedAt,
    runtimeBuildId: runtime.runtimeBuildId,
    spatialSourceFingerprint: runtime.spatialSourceFingerprint,
    repoPath: runtime.repoPath
  };
  report.liveBundle = await queryLiveBundle();

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
  report.screenshots.boot = await shot(page, '00-boot');

  if (!report.mapReady) {
    report.error = 'Map not operational — cannot complete visual QA';
    writeFileSync(resolve(ARTIFACT_DIR, 'latest.json'), `${JSON.stringify(report, null, 2)}\n`);
    console.log(JSON.stringify(report, null, 2));
    await browser.close();
    process.exit(1);
  }

  const query = await page.evaluate(async (point) => {
    const service = await import('/spatial/point-intelligence-service.js');
    const layer = await import('/spatial/point-intelligence-layer.js');
    const stations = await import('/spatial/point-intelligence-station-layer.js');
    const runtime = await import('/spatial/spatial-arcgis-runtime.js');
    service.setPointIntelligenceModeEnabled(true);
    const started = performance.now();
    const response = await service.runPointIntelligenceQuery(point, { force: true });
    const view = runtime.getMapView();
    const records = stations.getCurrentStationRecords();
    const stationLayer = stations.getPointIntelligenceStationLayer();
    const rendererType = stationLayer?.renderer?.declaredClass || stationLayer?.renderer?.type || null;
    let featureCount = records.length;
    try {
      featureCount = (await stationLayer?.queryFeatureCount?.()) ?? records.length;
    } catch {
      // ignore
    }
    const layerState = layer.getPointIntelligenceLayerState();
    return {
      ms: Math.round(performance.now() - started),
      bundleState: response?.bundleState || response?.queryState || null,
      resultCount: response?.results?.length || 0,
      layers: {
        clickGraphics: layerState.clickGraphics,
        resultGraphics: layerState.resultGraphics,
        stationFeatures: layerState.stationFeatures,
        accounting: layerState.mapPresentation?.accounting || null
      },
      stationCount: records.length,
      featureCount,
      rendererType,
      scale: view?.scale || null,
      stations: records.map((row) => ({
        assetKey: row.assetKey,
        family: row.family,
        stationId: row.stationId,
        freshnessClass: row.freshnessClass,
        primaryLabel: row.primaryLabel,
        primaryValue: row.primaryValue,
        primaryUnit: row.primaryUnit,
        trend: Boolean(row.trend),
        qualityState: row.qualityState,
        longitude: row.longitude,
        latitude: row.latitude,
        observationId: row.observationId
      }))
    };
  }, MONTREAL);
  report.query = query;
  report.screenshots.regional = await shot(page, 'A-regional');

  const hydro = (query.stations || []).find((row) => row.family === 'hydrometric' && row.primaryValue != null)
    || (query.stations || []).find((row) => row.family === 'hydrometric');
  const weather = (query.stations || []).find((row) => row.family === 'weather' && row.primaryValue != null)
    || (query.stations || []).find((row) => row.family === 'weather');
  const stale = (query.stations || []).find((row) => row.freshnessClass === 'STALE' || row.freshnessClass === 'REGISTRY');

  async function goToStation(station, scale) {
    if (!station) return false;
    return page.evaluate(async ({ station: target, scale: nextScale }) => {
      const runtime = await import('/spatial/spatial-arcgis-runtime.js');
      const view = runtime.getMapView();
      await view.goTo({
        center: [target.longitude, target.latitude],
        scale: nextScale
      }, { duration: 200 });
      return view.scale;
    }, { station, scale });
  }

  await page.evaluate(async () => {
    const runtime = await import('/spatial/spatial-arcgis-runtime.js');
    const view = runtime.getMapView();
    await view.goTo({ center: [-73.5673, 45.5017], scale: 160000 }, { duration: 200 });
  });
  report.screenshots.regionalScale = await shot(page, 'A-montreal-regional');

  await page.evaluate(async () => {
    const runtime = await import('/spatial/spatial-arcgis-runtime.js');
    const view = runtime.getMapView();
    await view.goTo({ center: [-73.5673, 45.5017], scale: 18000 }, { duration: 200 });
  });
  report.screenshots.local = await shot(page, 'B-local-neighbourhood');

  if (hydro) {
    report.scales = report.scales || {};
    report.scales.hydroPoint = await goToStation(hydro, 4000);
    report.screenshots.hydroClose = await shot(page, 'C-hydro-station-scale');
    await page.evaluate(async (observationId) => {
      const focus = await import('/spatial/point-intelligence-focus-controller.js');
      await focus.focusEvidenceFromMap({
        observationId,
        family: 'hydrometric-measurement'
      });
      document.querySelector('#spatial-point-intelligence-results')?.scrollIntoView({ block: 'center' });
      document.querySelector('#lif-inspector-host')?.scrollIntoView({ block: 'center' });
    }, hydro.observationId);
    await page.waitForTimeout(400);
    report.screenshots.hydroSelected = await shot(page, 'E-selected-hydrometric');
    const hoverPoint = await page.evaluate(async (target) => {
      const runtime = await import('/spatial/spatial-arcgis-runtime.js');
      const Point = await runtime.importArc('@arcgis/core/geometry/Point.js');
      const view = runtime.getMapView();
      const host = document.querySelector('#spatial-map-host');
      const rect = host.getBoundingClientRect();
      const screen = view.toScreen(new Point({
        longitude: target.longitude,
        latitude: target.latitude
      }));
      if (!screen) return null;
      return { x: rect.left + screen.x, y: rect.top + screen.y };
    }, hydro);
    if (hoverPoint?.x) {
      await page.mouse.move(hoverPoint.x, hoverPoint.y);
      await page.waitForTimeout(120);
      report.screenshots.hydroHover = await shot(page, 'hover-hydrometric');
    }
  }

  if (weather) {
    report.scales = report.scales || {};
    report.scales.weatherPoint = await goToStation(weather, 4000);
    report.screenshots.weatherClose = await shot(page, 'C-swob-station-scale');
    await page.evaluate(async (observationId) => {
      const focus = await import('/spatial/point-intelligence-focus-controller.js');
      await focus.focusEvidenceFromMap({
        observationId,
        family: 'weather'
      });
      document.querySelector('#spatial-point-intelligence-results')?.scrollIntoView({ block: 'center' });
      document.querySelector('#lif-inspector-host')?.scrollIntoView({ block: 'center' });
    }, weather.observationId);
    await page.waitForTimeout(400);
    report.screenshots.weatherSelected = await shot(page, 'F-selected-swob');
    const hoverPoint = await page.evaluate(async (target) => {
      const runtime = await import('/spatial/spatial-arcgis-runtime.js');
      const Point = await runtime.importArc('@arcgis/core/geometry/Point.js');
      const view = runtime.getMapView();
      const host = document.querySelector('#spatial-map-host');
      const rect = host.getBoundingClientRect();
      const screen = view.toScreen(new Point({
        longitude: target.longitude,
        latitude: target.latitude
      }));
      if (!screen) return null;
      return { x: rect.left + screen.x, y: rect.top + screen.y };
    }, weather);
    if (hoverPoint?.x) {
      await page.mouse.move(hoverPoint.x, hoverPoint.y);
      await page.waitForTimeout(120);
      report.screenshots.weatherHover = await shot(page, 'hover-swob');
    }
  }

  if (stale) {
    await goToStation(stale, 8000);
    report.screenshots.stale = await shot(page, 'G-stale-or-registry');
  }

  await page.evaluate(async () => {
    const runtime = await import('/spatial/spatial-arcgis-runtime.js');
    const view = runtime.getMapView();
    await view.goTo({ center: [-73.5673, 45.5017], scale: 28000 }, { duration: 200 });
  });
  report.screenshots.multiStation = await shot(page, 'D-multiple-stations');

  const inspector = await page.evaluate(() => {
    const panel = document.querySelector('#spatial-point-intelligence-results');
    const inspectorHost = document.querySelector('#lif-inspector-host');
    const hover = document.querySelector('.pi-station-hover');
    const text = `${panel?.textContent || ''} ${inspectorHost?.textContent || ''}`;
    return {
      hasLif: /Point Intelligence/i.test(text),
      hasEvidenceInspector: /Evidence inspector/i.test(text),
      hasPopup: Boolean(document.querySelector('.esri-popup:not(.esri-hidden)')),
      legend: Boolean(document.querySelector('.pi-station-legend')),
      hoverVisible: Boolean(hover && !hover.hidden),
      hoverText: hover && !hover.hidden ? hover.textContent.trim() : null,
      inspectorOpen: Boolean(inspectorHost && !inspectorHost.hidden && inspectorHost.innerHTML.trim())
    };
  });
  report.inspector = inspector;

  const off = await page.evaluate(async () => {
    const service = await import('/spatial/point-intelligence-service.js');
    const layer = await import('/spatial/point-intelligence-layer.js');
    service.setPointIntelligenceModeEnabled(false);
    await new Promise((resolve) => setTimeout(resolve, 400));
    return layer.getPointIntelligenceLayerState();
  });
  report.piOff = off;
  report.screenshots.piOff = await shot(page, 'H-pi-off');

  report.headerIntact = await page.evaluate(() => Boolean(document.querySelector('.iqai-spatial-header, header, #spatial-app')));
  report.finishedAt = new Date().toISOString();
  writeFileSync(resolve(ARTIFACT_DIR, 'latest.json'), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
  await browser.close();
}

await main();
