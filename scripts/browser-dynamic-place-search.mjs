/**
 * Browser proof: dynamic place results map, click, CLEAR, RESET.
 * Uses live http://localhost:3000/spatial/. Does not restart Alberta.
 */
import { chromium } from 'playwright';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const AUTH_PROFILE_DIR = resolve(REPO_ROOT, '.playwright-auth', 'montreal');
const ARTIFACT_DIR = resolve(REPO_ROOT, 'artifacts', 'dynamic-place-search');
const BASE = process.env.SPATIAL_URL || 'http://localhost:3000';
const HEADED = process.env.HEADED === '1';

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
  if (!data.token) return null;
  return {
    token: data.token,
    expires: data.expires
      ? (Number(data.expires) > 1e12 ? Number(data.expires) : Number(data.expires) * 1000)
      : Date.now() + 3600000
  };
}

async function waitForMapReady(page, timeoutMs = 90000) {
  page.setDefaultTimeout(timeoutMs);
  return page.waitForFunction(() => {
    const canvas = document.querySelector('#spatial-map-host canvas');
    const app = window.__IQAI_APP_SHELL__;
    return Boolean(canvas && app?.runAiMapCommand && app.mapOperational !== false);
  }, null, { timeout: timeoutMs }).catch(() => false);
}

function inspectMapState() {
  const webMap = window.__IQAI_APP_SHELL__?.webMap
    || window.__IQAI_MAP_VIEW__?.map
    || null;
  const layers = webMap?.layers?.toArray?.() || [];
  const runtime = layers
    .filter((layer) => String(layer.id || '').startsWith('iqai-'))
    .map((layer) => ({
      id: layer.id,
      title: layer.title,
      listMode: layer.listMode,
      popupEnabled: layer.popupEnabled
    }));
  const catalog = (window.__IQAI_WEBMAP_LAYER_CATALOG__?.layers || []).map((entry) => ({
    catalogId: entry.catalogId,
    title: entry.title
  }));
  const det = window.__IQAI_DETERMINISTIC_LAYER__;
  return {
    lastPlace: window.__IQAI_LAST_DYNAMIC_PLACE_SEARCH__ || null,
    runtime,
    catalogHasStarbucks: catalog.some((entry) => /starbucks/i.test(entry.title || '')),
    catalogIqaiCount: catalog.filter((entry) => String(entry.catalogId || '').startsWith('iqai')).length,
    resultLayerTitle: det?.title || null,
    resultPopupEnabled: Boolean(det?.popupEnabled),
    resultGraphicCount: det?.source?.items?.length
      ?? det?.source?.length
      ?? null
  };
}

const preauth = await fetchPreauthToken();
let browser;
let page;
if (preauth) {
  browser = await chromium.launch({ headless: !HEADED });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  page = await context.newPage();
  await page.addInitScript((tokenData) => {
    window.__MONTREAL_PREAUTH_TOKEN = tokenData;
  }, preauth);
} else if (existsSync(AUTH_PROFILE_DIR)) {
  const context = await chromium.launchPersistentContext(AUTH_PROFILE_DIR, {
    headless: !HEADED,
    viewport: { width: 1440, height: 900 }
  });
  page = context.pages()[0] || await context.newPage();
  browser = context;
} else {
  browser = await chromium.launch({ headless: !HEADED });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  page = await context.newPage();
}

const out = { pass: false };
try {
  await page.goto(`${BASE}/spatial/?nocache=${Date.now()}`, {
    waitUntil: 'domcontentloaded',
    timeout: 60000
  });
  out.ready = Boolean(await waitForMapReady(page));
  if (!out.ready) {
    out.snap = await page.evaluate(() => ({
      app: Boolean(window.__IQAI_APP_SHELL__),
      runAiMap: Boolean(window.__IQAI_APP_SHELL__?.runAiMapCommand),
      operational: window.__IQAI_APP_SHELL__?.mapOperational ?? null,
      canvas: Boolean(document.querySelector('#spatial-map-host canvas')),
      hasPreauth: Boolean(window.__MONTREAL_PREAUTH_TOKEN?.token),
      title: document.title,
      signInVisible: Boolean(document.querySelector('[data-signin], .sign-in, #spatial-signin-btn'))
    })).catch((error) => ({ evalError: error.message }));
    await page.screenshot({ path: resolve(ARTIFACT_DIR, 'map-not-ready.png'), fullPage: false }).catch(() => {});
    throw new Error('Map not ready');
  }

  out.search = await page.evaluate(async () => {
    const app = window.__IQAI_APP_SHELL__;
    const result = await app.runAiMapCommand('map Starbucks within 2 km of 997 de la Commune');
    return {
      rejected: Boolean(result?.rejected),
      mapped: Boolean(result?.gisExecuted),
      status: result?.placePoi?.status || null,
      route: result?.placePoi?.route || null,
      resultCount: result?.placePoi?.places?.length ?? 0,
      layerTitle: result?.placePoi?.layerTitle || null,
      provider: result?.placePoi?.provider?.service || null
    };
  });
  await page.waitForTimeout(1500);
  out.afterSearch = await page.evaluate(inspectMapState);
  await page.screenshot({ path: resolve(ARTIFACT_DIR, 'starbucks-mapped.png'), fullPage: false }).catch(() => {});

  out.click = await page.evaluate(async () => {
    const view = window.__IQAI_MAP_VIEW__;
    const layer = window.__IQAI_DETERMINISTIC_LAYER__;
    const graphic = layer?.source?.items?.[0] || layer?.graphics?.items?.[0] || null;
    if (!view || !graphic) return { opened: false, reason: 'no-graphic' };
    await view.openPopup({ features: [graphic], location: graphic.geometry });
    return {
      opened: Boolean(view.popup?.visible),
      title: view.popup?.title || graphic.attributes?.name || null,
      popupEnabled: Boolean(layer.popupEnabled)
    };
  });

  out.clear = await page.evaluate(async () => {
    const app = window.__IQAI_APP_SHELL__;
    await app.runAiMapCommand('clear map');
    const webMap = window.__IQAI_MAP_VIEW__?.map;
    const layers = webMap?.layers?.toArray?.() || [];
    return {
      runtimeRemaining: layers.filter((layer) => String(layer.id || '').startsWith('iqai-')).map((layer) => layer.id),
      deterministicLayer: Boolean(window.__IQAI_DETERMINISTIC_LAYER__)
    };
  });

  await page.evaluate(async () => {
    const app = window.__IQAI_APP_SHELL__;
    await app.runAiMapCommand('map Starbucks within 2 km of 997 de la Commune');
  });
  await page.waitForTimeout(1200);
  out.reset = await page.evaluate(async () => {
    const app = window.__IQAI_APP_SHELL__;
    await app.runAiMapCommand('reset map');
    const webMap = window.__IQAI_MAP_VIEW__?.map;
    const layers = webMap?.layers?.toArray?.() || [];
    return {
      runtimeRemaining: layers.filter((layer) => String(layer.id || '').startsWith('iqai-')).map((layer) => layer.id),
      deterministicLayer: Boolean(window.__IQAI_DETERMINISTIC_LAYER__)
    };
  });

  out.pass = out.search?.route === 'DYNAMIC_PLACE_SEARCH'
    && out.search?.resultCount > 0
    && out.search?.mapped === true
    && /AI MAP · Starbucks/i.test(out.afterSearch?.resultLayerTitle || out.search?.layerTitle || '')
    && out.afterSearch?.resultPopupEnabled === true
    && out.afterSearch?.catalogHasStarbucks === false
    && out.click?.popupEnabled === true
    && Array.isArray(out.clear?.runtimeRemaining) && out.clear.runtimeRemaining.length === 0
    && Array.isArray(out.reset?.runtimeRemaining) && out.reset.runtimeRemaining.length === 0;
} catch (error) {
  out.error = error.message;
} finally {
  if (browser?.close) await browser.close();
}

writeFileSync(resolve(ARTIFACT_DIR, 'browser.json'), `${JSON.stringify(out, null, 2)}\n`);
console.log(JSON.stringify(out, null, 2));
process.exit(out.pass ? 0 : 1);
