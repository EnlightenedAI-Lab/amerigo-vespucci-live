import { chromium } from 'playwright';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BASE = process.env.PREVIEW_BASE || 'http://localhost:3000';

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
  if (!popup) return;
  await popup.waitForLoadState('domcontentloaded', { timeout: 30000 }).catch(() => {});
  const userField = popup.locator('#user_username').first();
  await userField.waitFor({ state: 'visible', timeout: 20000 }).catch(() => {});
  if (arcgisUsername && await userField.isVisible().catch(() => false)) {
    await userField.fill(arcgisUsername);
    await popup.locator('#user_password').fill(arcgisPassword || '');
    await popup.locator('button[type="submit"], #signIn').first().click();
  }
  await popup.waitForEvent('close', { timeout: 120000 }).catch(() => {});
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const consoleErrors = [];
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });

await page.goto(`${BASE}/spatial/`, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForSelector('.spatial-shell', { timeout: 15000 });
await page.waitForTimeout(10000);

const signInBtn = page.locator('#spatial-sign-in');
if (await signInBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
  const popupPromise = page.waitForEvent('popup', { timeout: 20000 }).catch(() => null);
  await signInBtn.click();
  await completeArcgisPopup(await popupPromise);
  await page.waitForTimeout(5000);
}

await page.waitForFunction(() => window.__iqaiSpatialV1Diagnostics?.()?.mapViewCreateCount === 1, { timeout: 180000 }).catch(() => {});
await page.waitForTimeout(3000);

const mapVisible = await page.locator('#spatial-map-host .esri-view-root, #spatial-map-host canvas').count() > 0;
const layerItems = await page.locator('#spatial-arcgis-layerlist calcite-list-item, #spatial-arcgis-layerlist .esri-layer-list__item').count();
const systemIndicator = await page.locator('#spatial-system-indicator').textContent();
const detailError = await page.locator('#spatial-detail-error').textContent().catch(() => '');
const diag = await page.evaluate(() => window.__iqaiSpatialV1Diagnostics?.() || null);

// Trigger resize (was causing mapView.resize error)
await page.setViewportSize({ width: 1280, height: 900 });
await page.waitForTimeout(1500);
await page.evaluate(() => window.dispatchEvent(new Event('resize')));

let togglePass = false;
const trafficCheckbox = page.locator('#spatial-arcgis-layerlist calcite-list-item, #spatial-arcgis-layerlist .esri-layer-list__item').filter({ hasText: /traffic/i }).locator('calcite-checkbox, input[type="checkbox"]').first();
if (await trafficCheckbox.count() > 0) {
  const before = await trafficCheckbox.isChecked().catch(() => null);
  await trafficCheckbox.click({ force: true });
  await page.waitForTimeout(1000);
  const after = await trafficCheckbox.isChecked().catch(() => null);
  togglePass = before !== null && after !== null && before !== after;
} else {
  const anyCheckbox = page.locator('#spatial-arcgis-layerlist calcite-checkbox, #spatial-arcgis-layerlist input[type="checkbox"]').first();
  if (await anyCheckbox.count() > 0) {
    const before = await anyCheckbox.isChecked().catch(() => null);
    await anyCheckbox.click({ force: true });
    await page.waitForTimeout(1000);
    const after = await anyCheckbox.isChecked().catch(() => null);
    togglePass = before !== null && after !== null && before !== after;
  }
}

const errorAfterResize = await page.locator('#spatial-detail-error').textContent().catch(() => '');
const hasResizeError = /resize is not a function/i.test(detailError + errorAfterResize);

console.log(JSON.stringify({
  mapVisible,
  layerItems,
  togglePass,
  systemIndicator: systemIndicator?.trim(),
  detailError: (errorAfterResize || detailError || '').trim(),
  hasResizeError,
  diag,
  consoleErrors: consoleErrors.filter((e) => !/favicon/i.test(e))
}, null, 2));

await browser.close();

const ok = mapVisible && layerItems > 0 && togglePass && !hasResizeError
  && diag?.mapViewCreateCount === 1 && diag?.mapContainers === 1
  && !/ArcGIS error/i.test(systemIndicator || '');

process.exit(ok ? 0 : 1);
