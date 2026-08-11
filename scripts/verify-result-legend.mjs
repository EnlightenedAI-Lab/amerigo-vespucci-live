/**
 * Browser verification: result-scoped legend with source symbols.
 */
import { chromium } from 'playwright';
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ARTIFACTS = resolve(__dirname, '../artifacts');

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

loadEnvFile(resolve(__dirname, '../.env'));

const BASE = process.env.SPATIAL_URL || 'http://localhost:3000';
const HEADED = process.env.HEADED === '1';
const MANUAL_AUTH_MS = Number(process.env.MANUAL_AUTH_MS || 120000);

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
  const data = await res.json();
  if (!data.token) return null;
  return { token: data.token, expires: data.expires ? Number(data.expires) * 1000 : Date.now() + 3600000 };
}

async function waitForMapReady(page) {
  return page.waitForFunction(() => {
    const canvas = document.querySelector('#spatial-map-host canvas');
    const layers = document.querySelectorAll('#spatial-layer-tree .layer-row input[type="checkbox"]');
    return Boolean(canvas && layers.length > 0);
  }, { timeout: MANUAL_AUTH_MS }).catch(() => false);
}

async function runAmenitiesCommand(page, prompt) {
  await page.fill('#spatial-deterministic-input', prompt);
  await page.locator('#spatial-deterministic-run').click({ force: true });
  await page.waitForTimeout(28000);
  return page.evaluate(() => {
    const legend = window.__IQAI_RESULT_LEGEND__;
    const renderer = window.__IQAI_RESULT_RENDERER__;
    const diagnostic = window.__IQAI_LEGEND_DIAGNOSTIC__;
    const chips = [...document.querySelectorAll('.results-category-chip')].map((chip) => ({
      text: chip.textContent?.trim() || '',
      hasImg: Boolean(chip.querySelector('img.results-category-chip__symbol')),
      imgSrc: chip.querySelector('img.results-category-chip__symbol')?.getAttribute('src')?.slice(0, 40) || null,
      category: chip.dataset.category ?? null,
      unmatched: Boolean(chip.querySelector('.results-category-chip__symbol--unmatched')),
      missing: Boolean(chip.querySelector('.results-category-chip__symbol--missing'))
    }));
    const tableMeta = document.querySelector('.results-table-meta')?.textContent?.trim() || '';
    return { legend, renderer, diagnostic, chips, tableMeta };
  });
}

const report = { base: BASE, headed: HEADED };

const browser = await chromium.launch({ headless: !HEADED, slowMo: HEADED ? 60 : 0 });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

const preauth = await fetchPreauthToken();
if (preauth) {
  await page.addInitScript((tokenData) => {
    window.__MONTREAL_PREAUTH_TOKEN = tokenData;
  }, preauth);
}

await page.goto(`${BASE}/spatial/?v=${Date.now()}`, { waitUntil: 'networkidle', timeout: 90000 });
const mapReady = await waitForMapReady(page);
report.mapReady = Boolean(mapReady);

if (!mapReady) {
  report.error = 'Map not ready — sign in or set ARCGIS_USERNAME/ARCGIS_PASSWORD';
  writeFileSync(resolve(ARTIFACTS, 'verify-result-legend-report.json'), JSON.stringify(report, null, 2));
  await browser.close();
  console.log(JSON.stringify(report, null, 2));
  process.exit(1);
}

report.amenities3km = await runAmenitiesCommand(page, 'map amenities within 3km of 997 de la commune');
await page.screenshot({ path: resolve(ARTIFACTS, 'verify-result-legend-all.png'), fullPage: false });

const benchChip = page.locator('.results-category-chip[data-category="bench"]');
if (await benchChip.count()) {
  await benchChip.click();
  await page.waitForTimeout(2000);
  report.benchFilter = await page.evaluate(() => ({
    renderer: window.__IQAI_RESULT_RENDERER__,
    tableMeta: document.querySelector('.results-table-meta')?.textContent?.trim() || '',
    chips: document.querySelectorAll('.results-category-chip').length
  }));
  await page.screenshot({ path: resolve(ARTIFACTS, 'verify-result-legend-bench.png'), fullPage: false });
}

report.amenities500m = await runAmenitiesCommand(page, 'map amenities within 500m of 997 de la commune');

writeFileSync(resolve(ARTIFACTS, 'verify-result-legend-report.json'), JSON.stringify(report, null, 2));
await browser.close();
console.log(JSON.stringify(report, null, 2));
