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

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

await page.goto(`${BASE}/spatial/`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.spatial-shell');
await page.waitForTimeout(8000);

const popupPromise = page.waitForEvent('popup', { timeout: 20000 });
await page.locator('#spatial-sign-in').click();
const popup = await popupPromise;

await popup.waitForLoadState('domcontentloaded');
await popup.locator('#user_username').waitFor({ state: 'visible', timeout: 20000 });
await popup.locator('#user_username').fill(arcgisUsername);
await popup.locator('#user_password').fill(arcgisPassword);
await popup.locator('button[type="submit"], input[type="submit"], #signIn').first().click();

for (let i = 0; i < 30; i++) {
  await popup.waitForTimeout(2000);
  const url = popup.url();
  const bodyText = await popup.locator('body').innerText().catch(() => '');
  const closed = popup.isClosed();
  console.log(`tick ${i}`, { closed, url, bodySnippet: bodyText.slice(0, 200).replace(/\s+/g, ' ') });
  if (closed) break;
}

console.log('main status', await page.locator('[data-field="Status"]').textContent());
console.log('main error', await page.locator('#spatial-detail-error').textContent().catch(() => ''));
console.log('diag', await page.evaluate(() => window.__iqaiSpatialV1Diagnostics?.() || null));

await browser.close();
