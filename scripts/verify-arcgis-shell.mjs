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

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const consoleErrors = [];
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });

await page.goto(`${BASE}/spatial/`, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForSelector('.spatial-shell', { timeout: 15000 });
await page.waitForTimeout(8000);
await signInIfNeeded(page);

await page.waitForFunction(() => {
  const diag = window.__iqaiSpatialV1Diagnostics?.();
  return diag?.mapViewCreateCount === 1;
}, { timeout: 120000 }).catch(() => {});

await page.waitForTimeout(5000);

const mapVisible = await page.locator('#spatial-map-host .esri-view-root, #spatial-map-host canvas').count() > 0;
const layerItems = await page.locator('#spatial-arcgis-layerlist calcite-list-item, #spatial-arcgis-layerlist .esri-layer-list__item').count();
const diag = await page.evaluate(() => window.__iqaiSpatialV1Diagnostics?.() || null);

let togglePass = false;
const checkbox = page.locator('#spatial-arcgis-layerlist calcite-checkbox, #spatial-arcgis-layerlist input[type="checkbox"]').first();
if (await checkbox.count() > 0) {
  const before = await checkbox.isChecked().catch(() => null);
  await checkbox.click({ force: true });
  await page.waitForTimeout(1500);
  const after = await checkbox.isChecked().catch(() => null);
  togglePass = before !== null && after !== null && before !== after;
}

const statusText = await page.locator('[data-field="Status"]').textContent().catch(() => '');
const errorText = await page.locator('#spatial-detail-error').textContent().catch(() => '');

console.log(JSON.stringify({
  base: BASE,
  mapVisible,
  layerItems,
  togglePass,
  diagnostics: diag,
  status: statusText,
  error: errorText,
  consoleErrors: consoleErrors.filter((e) => !/favicon/i.test(e))
}, null, 2));

await browser.close();

const ok = mapVisible && layerItems > 0 && togglePass
  && diag?.mapViewCreateCount === 1
  && diag?.webMapCreateCount === 1
  && diag?.mapContainers === 1;

process.exit(ok ? 0 : 1);
