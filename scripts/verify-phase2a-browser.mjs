import { chromium } from 'playwright';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BASE = process.env.PREVIEW_BASE || 'http://localhost:3000';
const PROMPT = 'Map fire stations within 3 km of 6939 Décarie Boulevard.';

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
loadEnvFile(resolve(__dirname, '../../amerigo-vespucci-live/.env'));

const arcgisUsername = process.env.ARCGIS_USERNAME;
const arcgisPassword = process.env.ARCGIS_PASSWORD;

async function completeArcgisPopup(popup) {
  if (!popup) return false;
  await popup.waitForLoadState('domcontentloaded', { timeout: 30000 }).catch(() => {});
  const userField = popup.locator('#user_username, input[name="username"]').first();
  await userField.waitFor({ state: 'visible', timeout: 20000 }).catch(() => {});
  if (arcgisUsername && await userField.isVisible().catch(() => false)) {
    await userField.fill(arcgisUsername);
    const passField = popup.locator('#user_password, input[name="password"]').first();
    if (await passField.isVisible({ timeout: 5000 }).catch(() => false)) {
      await passField.fill(arcgisPassword || '');
    }
    const submit = popup.locator('button[type="submit"], input[type="submit"], #signIn').first();
    if (await submit.isVisible({ timeout: 3000 }).catch(() => false)) {
      await submit.click();
    }
  }
  await popup.waitForEvent('close', { timeout: 120000 }).catch(() => {});
  return true;
}

async function signInIfNeeded(page) {
  await page.locator('#spatial-sign-in').waitFor({ state: 'visible', timeout: 20000 }).catch(() => {});
  const btn = page.locator('#spatial-sign-in');
  if (!await btn.isVisible().catch(() => false)) return;
  const popupPromise = page.waitForEvent('popup', { timeout: 20000 }).catch(() => null);
  await btn.click();
  const popup = await popupPromise;
  await completeArcgisPopup(popup);
  await page.waitForTimeout(3000);
}

async function runMapCommand(page) {
  await page.locator('#spatial-command-input').fill(PROMPT);
  await page.locator('#spatial-command-run').click();
  await page.waitForFunction(() => {
    const status = document.querySelector('[data-field="Status"]')?.textContent;
    return status === 'Controlled';
  }, { timeout: 60000 });
  await page.waitForTimeout(2000);
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const consoleErrors = [];
const xaiRequests = [];

page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
page.on('request', (req) => {
  const url = req.url();
  if (/xai|grok|api\.x\.ai/i.test(url)) xaiRequests.push(url);
});

await page.goto(`${BASE}/spatial/`, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForSelector('.spatial-shell', { timeout: 15000 });
await page.waitForTimeout(10000);
await signInIfNeeded(page);

await page.waitForFunction(() => {
  const diag = window.__iqaiSpatialV1Diagnostics?.();
  return diag?.mapViewCreateCount === 1;
}, { timeout: 240000 }).catch(() => {});

const signInStillVisible = await page.locator('#spatial-sign-in').isVisible().catch(() => false);
if (signInStillVisible) {
  await signInIfNeeded(page);
  await page.waitForFunction(() => {
    const diag = window.__iqaiSpatialV1Diagnostics?.();
    return diag?.mapViewCreateCount === 1;
  }, { timeout: 240000 }).catch(() => {});
}

const mapVisible = await page.locator('#spatial-map-host .esri-view-root, #spatial-map-host canvas').count() > 0;
const systemIndicator = await page.locator('#spatial-system-indicator').textContent();

let threeRunsPass = true;
let resultCount = 0;
let runtimeLayerVisible = false;
let togglePass = false;

for (let i = 0; i < 3; i++) {
  try {
    await runMapCommand(page);
    resultCount = Number(await page.locator('[data-field="Freshness"]').textContent()) || 0;
    const layerText = await page.locator('#spatial-arcgis-layerlist').innerText();
    runtimeLayerVisible = /IQAI — Fire Stations within 3 km/i.test(layerText);
    if (!runtimeLayerVisible || resultCount <= 0) threeRunsPass = false;
  } catch {
    threeRunsPass = false;
  }
}

const checkbox = page.locator('#spatial-arcgis-layerlist calcite-checkbox, #spatial-arcgis-layerlist input[type="checkbox"]').filter({ hasText: /IQAI/i }).first();
if (await checkbox.count() === 0) {
  const anyCheckbox = page.locator('#spatial-arcgis-layerlist calcite-checkbox, #spatial-arcgis-layerlist input[type="checkbox"]').last();
  if (await anyCheckbox.count() > 0) {
    const before = await anyCheckbox.isChecked().catch(() => null);
    await anyCheckbox.click({ force: true });
    await page.waitForTimeout(1500);
    const after = await anyCheckbox.isChecked().catch(() => null);
    togglePass = before !== null && after !== null && before !== after;
  }
} else {
  const before = await checkbox.isChecked().catch(() => null);
  await checkbox.click({ force: true });
  await page.waitForTimeout(1500);
  const after = await checkbox.isChecked().catch(() => null);
  togglePass = before !== null && after !== null && before !== after;
}

const diag = await page.evaluate(() => window.__iqaiSpatialV1Diagnostics?.() || null);
const model = await page.locator('[data-field="Model"]').textContent();
const aiCost = await page.locator('[data-field="AI Cost"]').textContent();

const browserPass = mapVisible
  && resultCount > 0
  && runtimeLayerVisible
  && togglePass
  && threeRunsPass
  && diag?.mapViewCreateCount === 1
  && diag?.mapContainers === 1
  && model === 'None'
  && aiCost === '$0.00'
  && xaiRequests.length === 0;

console.log(JSON.stringify({
  browserPass,
  resultCount,
  runtimeLayerVisible,
  togglePass,
  threeRunsPass,
  xaiCalls: xaiRequests.length,
  aiCost,
  mapViewCount: diag?.mapViewCreateCount ?? 0,
  mapContainerCount: diag?.mapContainers ?? 0,
  arcgisStatusDisplay: systemIndicator?.trim(),
  model,
  consoleErrors: consoleErrors.filter((e) => !/favicon/i.test(e)),
  xaiRequests
}, null, 2));

await browser.close();
process.exit(browserPass ? 0 : 1);
