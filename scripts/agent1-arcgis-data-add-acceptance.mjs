#!/usr/bin/env node
/**
 * Browser acceptance for ADD ARCGIS DATA against live stack on port 3000.
 */
import { chromium } from 'playwright';
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const ARTIFACT_DIR = resolve(ROOT, 'artifacts', 'agent1-arcgis-data-add');
const SCREENSHOT_DIR = resolve(ARTIFACT_DIR, 'screenshots');
const BASE = process.env.SPATIAL_URL || 'http://localhost:3000';

const MONTREAL_FIRE_STATIONS = 'https://services9.arcgis.com/KAS2Ol4X7Ca0Dta5/arcgis/rest/services/Greater_Montreal_Fire_Stations/FeatureServer/0';
const INVALID_INPUT = 'https://example.com/not-a-valid-arcgis-service';

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
  const params = new URLSearchParams({
    username, password, client: 'requestip', expiration: '60', f: 'json'
  });
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
    const layers = document.querySelectorAll('#spatial-layer-tree .layer-row input[type="checkbox"]');
    const operational = window.__IQAI_APP_SHELL__?.mapOperational !== false;
    return Boolean(canvas && layers.length > 0 && operational);
  }, { timeout: 180000 }).catch(() => false);
}

const report = { checks: [], screenshots: [], generatedAt: new Date().toISOString() };
function record(id, pass, detail = {}) {
  report.checks.push({ id, pass, ...detail });
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const preauth = await fetchPreauthToken();
if (preauth) {
  await page.addInitScript((tokenData) => { window.__MONTREAL_PREAUTH_TOKEN = tokenData; }, preauth);
}

await page.goto(`${BASE}/spatial/?v=${Date.now()}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
const mapReady = await waitForMapReady(page);
record('map_ready', mapReady);
if (!mapReady) {
  writeArtifacts(report);
  await browser.close();
  process.exit(1);
}

await page.click('#spatial-add-data-btn');
await page.waitForSelector('#spatial-arcgis-add-control', { timeout: 10000 });

// TEST A — Search
await page.fill('#arcgis-add-search-input', 'Montreal bike');
await page.click('#arcgis-add-search-btn');
await page.waitForTimeout(8000);
const searchMeta = await page.evaluate(() => ({
  resultCount: document.querySelectorAll('.arcgis-add-result').length,
  status: document.querySelector('#arcgis-add-status')?.textContent?.trim() || '',
  firstTitle: document.querySelector('.arcgis-add-result__title')?.textContent?.trim() || ''
}));
record('search_results', searchMeta.resultCount > 0, searchMeta);
await page.screenshot({ path: resolve(SCREENSHOT_DIR, 'A-search-results.png'), fullPage: false });
report.screenshots.push('A-search-results.png');

if (searchMeta.resultCount > 0) {
  await page.click('[data-arcgis-add-id]');
  await page.waitForTimeout(15000);
}
const searchAdd = await page.evaluate(() => {
  const added = [...document.querySelectorAll('.layer-group__title')]
    .some((el) => el.textContent.includes('Added ArcGIS data'));
  const status = document.querySelector('#arcgis-add-status')?.textContent?.trim() || '';
  const userLayer = [...document.querySelectorAll('.layer-row__title')].map((el) => el.textContent.trim());
  return { added, status, userLayerCount: userLayer.length };
});
record('search_add_to_map', searchAdd.added || /Added/i.test(searchAdd.status), searchAdd);
await page.screenshot({ path: resolve(SCREENSHOT_DIR, 'B-search-added.png'), fullPage: false });
report.screenshots.push('B-search-added.png');

// TEST B/C — Direct REST service
await page.fill('#arcgis-add-direct-input', MONTREAL_FIRE_STATIONS);
await page.click('#arcgis-add-direct-btn');
await page.waitForTimeout(15000);
const directAdd = await page.evaluate(() => ({
  status: document.querySelector('#arcgis-add-status')?.textContent?.trim() || '',
  addedGroup: [...document.querySelectorAll('.layer-group__title')]
    .some((el) => el.textContent.includes('Added ArcGIS data')),
  fireLayer: [...document.querySelectorAll('.layer-row__title')]
    .some((el) => /fire/i.test(el.textContent))
}));
record('direct_featureserver', /Added|Already added/i.test(directAdd.status) && directAdd.fireLayer, directAdd);

await page.fill('#arcgis-add-direct-input', MONTREAL_FIRE_STATIONS);
await page.click('#arcgis-add-direct-btn');
await page.waitForTimeout(3000);
const duplicate = await page.evaluate(() => document.querySelector('#arcgis-add-status')?.textContent?.trim() || '');
record('duplicate_prevented', /Already added/i.test(duplicate), { status: duplicate });
await page.screenshot({ path: resolve(SCREENSHOT_DIR, 'C-direct-featureserver.png'), fullPage: false });
report.screenshots.push('C-direct-featureserver.png');

// TEST D — invalid input
await page.fill('#arcgis-add-direct-input', INVALID_INPUT);
await page.click('#arcgis-add-direct-btn');
await page.waitForTimeout(2000);
const invalid = await page.evaluate(() => ({
  status: document.querySelector('#arcgis-add-status')?.textContent?.trim() || '',
  mapCanvas: Boolean(document.querySelector('#spatial-map-host canvas'))
}));
record('invalid_input_error', /not a supported|valid ArcGIS|unsupported/i.test(invalid.status) && invalid.mapCanvas, invalid);
await page.screenshot({ path: resolve(SCREENSHOT_DIR, 'D-invalid-input.png'), fullPage: false });
report.screenshots.push('D-invalid-input.png');

// Visibility toggle on added layer
const toggle = await page.evaluate(async () => {
  const row = [...document.querySelectorAll('.layer-row')].find((el) => /fire/i.test(el.textContent));
  const checkbox = row?.querySelector('input[type="checkbox"]');
  if (!checkbox) return { found: false };
  const before = checkbox.checked;
  checkbox.click();
  await new Promise((r) => setTimeout(r, 800));
  return { found: true, before, after: checkbox.checked, changed: before !== checkbox.checked };
});
record('visibility_toggle', toggle.found && toggle.changed, toggle);

// TEST E — core modes still present
const modes = await page.evaluate(() => ({
  mapCommand: Boolean(document.querySelector('#spatial-deterministic-input')),
  aiMap: Boolean(document.querySelector('#spatial-ai-input')),
  pi: Boolean(document.querySelector('#spatial-point-intelligence-section')),
  owi: Boolean(document.querySelector('#spatial-open-world-intelligence'))
}));
record('existing_modes_intact', modes.mapCommand && modes.aiMap && modes.pi && modes.owi, modes);
await page.screenshot({ path: resolve(SCREENSHOT_DIR, 'E-final-state.png'), fullPage: false });
report.screenshots.push('E-final-state.png');

await browser.close();

const failed = report.checks.filter((c) => !c.pass);
report.state = failed.length ? 'PARTIAL' : 'PASS';
report.pass = report.checks.length - failed.length;
report.total = report.checks.length;
writeArtifacts(report);
console.log(JSON.stringify(report, null, 2));
process.exit(failed.length ? 1 : 0);

function writeArtifacts(payload) {
  mkdirSync(SCREENSHOT_DIR, { recursive: true });
  writeFileSync(resolve(ARTIFACT_DIR, 'latest.json'), `${JSON.stringify(payload, null, 2)}\n`);
}
