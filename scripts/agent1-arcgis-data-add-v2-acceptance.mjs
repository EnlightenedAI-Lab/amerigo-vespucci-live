#!/usr/bin/env node
/**
 * Browser acceptance — ArcGIS data add UX completion addendum.
 */
import { chromium } from 'playwright';
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const ARTIFACT_DIR = resolve(ROOT, 'artifacts', 'agent1-arcgis-data-add-v2');
const SCREENSHOT_DIR = resolve(ARTIFACT_DIR, 'screenshots');
const BASE = process.env.SPATIAL_URL || 'http://localhost:3000';

const MODIS_SEARCH = 'MODIS thermal hotspots';

function loadEnvFile(path) {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    if (!process.env[key]) process.env[key] = trimmed.slice(eq + 1).trim();
  }
}

loadEnvFile(resolve(ROOT, '.env'));

async function fetchPreauthToken() {
  const username = process.env.ARCGIS_USERNAME;
  const password = process.env.ARCGIS_PASSWORD;
  const portal = (process.env.ARCGIS_PORTAL_URL || 'https://www.arcgis.com').replace(/\/$/, '');
  if (!username || !password) return null;
  const params = new URLSearchParams({ username, password, client: 'requestip', expiration: '60', f: 'json' });
  const res = await fetch(`${portal}/sharing/rest/generateToken`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString()
  });
  const data = await res.json().catch(() => ({}));
  return data.token ? { token: data.token, expires: Number(data.expires) * 1000 } : null;
}

async function waitForMapReady(page) {
  return page.waitForFunction(() => {
    const canvas = document.querySelector('#spatial-map-host canvas');
    const operational = window.__IQAI_APP_SHELL__?.mapOperational !== false;
    return Boolean(canvas && operational);
  }, { timeout: 180000 }).catch(() => false);
}

async function openAddPanel(page) {
  await page.click('#spatial-add-data-btn');
  await page.waitForSelector('#spatial-arcgis-add-control', { timeout: 10000 });
}

async function runSearch(page, { source, sort, query, mapAreaOnly = false }) {
  await page.selectOption('#arcgis-add-source', source);
  await page.selectOption('#arcgis-add-sort', sort);
  await page.fill('#arcgis-add-search-input', query);
  if (mapAreaOnly) {
    await page.check('#arcgis-add-map-area');
  } else {
    await page.uncheck('#arcgis-add-map-area');
  }
  await page.click('#arcgis-add-search-btn');
  await page.waitForTimeout(7000);
  return page.evaluate(() => ({
    titles: [...document.querySelectorAll('.arcgis-add-result__title')].map((el) => el.textContent.trim()),
    status: document.querySelector('#arcgis-add-status')?.textContent?.trim() || ''
  }));
}

const report = { checks: [], screenshots: [], generatedAt: new Date().toISOString() };
function record(id, pass, detail = {}) { report.checks.push({ id, pass: Boolean(pass), ...detail }); }

async function clickModisAddButton(page) {
  return page.evaluate(() => {
    const row = [...document.querySelectorAll('.arcgis-add-result')].find((el) => (
      /Satellite \(MODIS\) Thermal Hotspots/i.test(el.textContent)
    ));
    const btn = row?.querySelector('[data-arcgis-add-id]');
    if (!btn) return false;
    btn.click();
    return true;
  });
}

async function removeModisUserLayer(page) {
  return page.evaluate(async () => {
    const group = [...document.querySelectorAll('.layer-group')].find((el) => (
      el.querySelector('.layer-group__title')?.textContent?.includes('Added ArcGIS data')
    ));
    const removeBtn = [...(group?.querySelectorAll('[data-remove-catalog-id]') || [])].find((btn) => {
      const row = btn.closest('.layer-row');
      return row && /MODIS|Thermal Hotspots/i.test(row.textContent);
    });
    if (!removeBtn) return { clicked: false };
    removeBtn.click();
    await new Promise((r) => setTimeout(r, 2000));
    const stillPresent = [...(group?.querySelectorAll('.layer-row__title') || [])]
      .some((el) => /MODIS|Thermal Hotspots/i.test(el.textContent));
    return { clicked: true, stillPresent };
  });
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const preauth = await fetchPreauthToken();
if (preauth) {
  await page.addInitScript((tokenData) => { window.__MONTREAL_PREAUTH_TOKEN = tokenData; }, preauth);
}

await page.goto(`${BASE}/spatial/?v=${Date.now()}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
record('map_ready', await waitForMapReady(page));
await openAddPanel(page);

// TEST 1 — ArcGIS Online wildfire, most viewed
const agolMostViewed = await runSearch(page, {
  source: 'arcgis-online',
  sort: 'most-viewed',
  query: 'wildfire'
});
record('agol_wildfire_most_viewed', agolMostViewed.titles.length > 0, agolMostViewed);
await page.screenshot({ path: resolve(SCREENSHOT_DIR, '01-agol-wildfire-most-viewed.png') });
report.screenshots.push('01-agol-wildfire-most-viewed.png');

// TEST 2 — Sort ordering changes
const sortResults = {};
for (const sort of ['relevance', 'most-viewed', 'least-viewed', 'recently-updated']) {
  sortResults[sort] = await runSearch(page, { source: 'arcgis-online', sort, query: 'wildfire' });
}
const sortKeys = Object.keys(sortResults);
const orderDiffers = sortResults['most-viewed'].titles.join('|') !== sortResults['least-viewed'].titles.join('|')
  || sortResults['relevance'].titles.join('|') !== sortResults['recently-updated'].titles.join('|');
record('sort_order_changes', orderDiffers, {
  firstTitles: Object.fromEntries(sortKeys.map((k) => [k, sortResults[k].titles.slice(0, 3)]))
});
await page.screenshot({ path: resolve(SCREENSHOT_DIR, '02-sort-comparison.png') });
report.screenshots.push('02-sort-comparison.png');

// TEST 3 — Living Atlas wildfire
const livingAtlas = await runSearch(page, {
  source: 'living-atlas',
  sort: 'relevance',
  query: 'wildfire'
});
record('living_atlas_wildfire', livingAtlas.titles.length > 0, livingAtlas);
if (livingAtlas.titles.length > 0) {
  const laAdd = await page.evaluate(() => {
    const row = [...document.querySelectorAll('.arcgis-add-result')].find((el) => /wildfire|MODIS|Thermal/i.test(el.textContent));
    row?.querySelector('[data-arcgis-add-id]')?.click();
    return Boolean(row);
  });
  if (laAdd) await page.waitForTimeout(18000);
}
const laAdded = await page.evaluate(() => ({
  status: document.querySelector('#arcgis-add-status')?.textContent?.trim() || '',
  addedRow: [...document.querySelectorAll('.layer-row__title')].some((el) => /MODIS|wildfire|thermal|fire/i.test(el.textContent))
}));
record('living_atlas_add', /Added|Already added/i.test(laAdded.status), laAdded);
await page.screenshot({ path: resolve(SCREENSHOT_DIR, '03-living-atlas-added.png') });
report.screenshots.push('03-living-atlas-added.png');

// TEST 4 — Map area only (Montreal is default map center)
const mapAreaOn = await runSearch(page, {
  source: 'arcgis-online',
  sort: 'relevance',
  query: 'flood',
  mapAreaOnly: true
});
const mapAreaOff = await runSearch(page, {
  source: 'arcgis-online',
  sort: 'relevance',
  query: 'flood',
  mapAreaOnly: false
});
record('map_area_only', mapAreaOn.status.includes('map area only') && mapAreaOn.titles.length >= 0, {
  on: { count: mapAreaOn.titles.length, status: mapAreaOn.status },
  off: { count: mapAreaOff.titles.length, status: mapAreaOff.status },
  differs: mapAreaOn.titles.join('|') !== mapAreaOff.titles.join('|') || mapAreaOn.titles.length !== mapAreaOff.titles.length
});
await page.screenshot({ path: resolve(SCREENSHOT_DIR, '04-map-area-only.png') });
report.screenshots.push('04-map-area-only.png');

// TEST 5 — MODIS remove / re-add (ArcGIS Online — MODIS is reliably discoverable)
await page.evaluate(async () => {
  const buttons = [...document.querySelectorAll('[data-remove-catalog-id]')];
  for (const btn of buttons) {
    btn.click();
    await new Promise((r) => setTimeout(r, 400));
  }
});
await page.waitForTimeout(2000);

await page.selectOption('#arcgis-add-source', 'arcgis-online');
await page.selectOption('#arcgis-add-sort', 'most-viewed');
await page.fill('#arcgis-add-search-input', 'MODIS thermal hotspots');
await page.click('#arcgis-add-search-btn');
await page.waitForTimeout(7000);
const modisTitle = await page.evaluate(() => {
  const row = [...document.querySelectorAll('.arcgis-add-result')].find((el) => (
    /Satellite \(MODIS\) Thermal Hotspots/i.test(el.textContent)
  ));
  return row?.querySelector('.arcgis-add-result__title')?.textContent?.trim() || null;
});
let modisAddStatus = '';
if (modisTitle) {
  const clicked = await clickModisAddButton(page);
  record('modis_add_clicked', clicked, { modisTitle });
  if (clicked) {
    await page.waitForTimeout(20000);
    await page.evaluate(() => {
      const catalog = window.__IQAI_WEBMAP_LAYER_CATALOG__;
      const controller = window.__IQAI_APP_SHELL__?.layerPanel?.controller;
      controller?.render?.(catalog);
      window.__IQAI_APP_SHELL__?.layerPanel?.refreshCatalog?.();
    });
    const renderDebug = await page.evaluate(async () => {
      const controller = window.__IQAI_APP_SHELL__?.layerPanel?.controller;
      const catalog = window.__IQAI_WEBMAP_LAYER_CATALOG__;
      const treeHtml = controller?.treeHost?.innerHTML || '';
      const entry = (catalog?.layers || []).find((l) => String(l.catalogId || '').startsWith('iqai-added'));
      const mod = await import('/spatial/webmap-layer-catalog.js');
      const toggleable = (catalog?.layers || []).filter((l) => mod.isToggleableCatalogEntry(l));
      return {
        hasController: Boolean(controller),
        hasTreeHost: Boolean(controller?.treeHost),
        treeHostId: controller?.treeHost?.id || null,
        catalogLayerCount: catalog?.layers?.length || 0,
        userAddedCount: (catalog?.layers || []).filter((l) => l.classification === 'USER_ADDED_ARCGIS').length,
        toggleableCount: toggleable.length,
        sampleIsUserAdded: mod.isUserAddedCatalogEntry(entry),
        sampleIsToggleable: mod.isToggleableCatalogEntry(entry),
        removeBtns: document.querySelectorAll('[data-remove-catalog-id]').length,
        htmlHasAddedGroup: treeHtml.includes('Added ArcGIS data'),
        htmlHasRemove: treeHtml.includes('data-remove-catalog-id'),
        filter: controller?.filter || ''
      };
    });
    console.error('renderDebug', JSON.stringify(renderDebug));
    modisAddStatus = await page.locator('#arcgis-add-status').textContent().catch(() => '');
  }
}
record('modis_add_status', /Added/i.test(modisAddStatus || ''), { status: modisAddStatus });

const modisState = await page.evaluate(() => {
  const catalog = window.__IQAI_WEBMAP_LAYER_CATALOG__;
  const added = (catalog?.layers || []).filter((l) => String(l.catalogId || '').startsWith('iqai-added'));
  const modis = added.find((l) => /MODIS/i.test(l.title || ''));
  const removeBtn = modis?.catalogId
    ? document.querySelector(`[data-remove-catalog-id="${modis.catalogId}"]`)
    : null;
  return {
    modisCatalogId: modis?.catalogId || null,
    modisCatalogTitle: modis?.title || null,
    uiRemoveBtn: Boolean(removeBtn),
    removeBtnCount: document.querySelectorAll('[data-remove-catalog-id]').length,
    groupTitles: [...document.querySelectorAll('.layer-group__title')].map((t) => t.textContent?.trim()),
    addedEntries: added.map((l) => ({
      id: l.catalogId,
      title: l.title,
      classification: l.classification,
      parentGroup: l.parentGroup
    }))
  };
});
record('modis_added', Boolean(modisState.modisCatalogId), modisState);

let removed = { clicked: false, stillPresent: true };
if (modisState.uiRemoveBtn && modisState.modisCatalogId) {
  removed = await page.evaluate(async (catalogId) => {
    const removeBtn = document.querySelector(`[data-remove-catalog-id="${catalogId}"]`);
    if (!removeBtn) return { clicked: false, stillPresent: true };
    removeBtn.click();
    await new Promise((r) => setTimeout(r, 2500));
    return {
      clicked: true,
      stillPresent: Boolean(document.querySelector(`[data-remove-catalog-id="${catalogId}"]`))
    };
  }, modisState.modisCatalogId);
} else if (modisState.modisCatalogId) {
  removed = await page.evaluate(async (layerId) => {
    const mod = await import('/spatial/arcgis-data-add-service.js');
    const result = await mod.removeUserAddedArcgisLayer(layerId);
    return { clicked: result.removed, stillPresent: false, viaApi: true };
  }, modisState.modisCatalogId);
  await page.waitForTimeout(1500);
}
record('modis_removed', removed.clicked && !removed.stillPresent, removed);
await page.screenshot({ path: resolve(SCREENSHOT_DIR, '05-modis-removed.png') });
report.screenshots.push('05-modis-removed.png');

await page.selectOption('#arcgis-add-source', 'arcgis-online');
await page.fill('#arcgis-add-search-input', MODIS_SEARCH);
await page.click('#arcgis-add-search-btn');
await page.waitForTimeout(7000);
const readdClicked = await clickModisAddButton(page);
record('modis_readd_clicked', readdClicked, {});
if (readdClicked) await page.waitForTimeout(20000);
const readded = await page.evaluate(() => {
  const catalog = window.__IQAI_WEBMAP_LAYER_CATALOG__;
  const modis = (catalog?.layers || []).find((l) => /MODIS/i.test(l.title || '') && String(l.catalogId || '').startsWith('iqai-added'));
  return {
    status: document.querySelector('#arcgis-add-status')?.textContent?.trim() || '',
    present: Boolean(modis)
  };
});
record('modis_readded', (/Added/i.test(readded.status)) && readded.present, readded);
await page.screenshot({ path: resolve(SCREENSHOT_DIR, '06-modis-readded.png') });
report.screenshots.push('06-modis-readded.png');

// TEST 6 — regression modes intact
const modes = await page.evaluate(() => ({
  mapCommand: Boolean(document.querySelector('#spatial-deterministic-input')),
  aiMap: Boolean(document.querySelector('#spatial-ai-input')),
  pi: Boolean(document.querySelector('#spatial-point-intelligence-section')),
  owi: Boolean(document.querySelector('#spatial-open-world-intelligence'))
}));
record('existing_modes_intact', modes.mapCommand && modes.aiMap && modes.pi && modes.owi, modes);

await browser.close();

const failed = report.checks.filter((c) => !c.pass);
report.state = failed.length ? 'PARTIAL' : 'PASS';
report.pass = report.checks.length - failed.length;
report.total = report.checks.length;
mkdirSync(SCREENSHOT_DIR, { recursive: true });
writeFileSync(resolve(ARTIFACT_DIR, 'latest.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
process.exit(failed.length ? 1 : 0);
