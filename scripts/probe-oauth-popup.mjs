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

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const events = [];
page.on('popup', (p) => events.push({ type: 'popup', url: p.url() }));
page.on('framenavigated', (f) => {
  if (f === page.mainFrame()) events.push({ type: 'nav', url: f.url() });
});

await page.goto(`${BASE}/spatial/`, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForSelector('.spatial-shell', { timeout: 15000 });
await page.waitForTimeout(10000);

const btnState = await page.evaluate(() => {
  const btn = document.querySelector('#spatial-sign-in');
  return {
    status: document.querySelector('[data-field="Status"]')?.textContent,
    btnHidden: btn?.hidden,
    btnDisplay: btn ? getComputedStyle(btn).display : null,
    btnExists: !!btn
  };
});
console.log('btnState', btnState);

const signInVisible = await page.locator('#spatial-sign-in').isVisible();
console.log('signInVisible', signInVisible);

if (signInVisible) {
  const popupPromise = page.waitForEvent('popup', { timeout: 20000 }).catch(() => null);
  await page.locator('#spatial-sign-in').click();
  const popup = await popupPromise;
  if (popup) {
    await popup.waitForLoadState('domcontentloaded', { timeout: 30000 }).catch(() => {});
    console.log('popup url', popup.url());
    await popup.waitForTimeout(5000);
    console.log('popup url after wait', popup.url());
    const inputs = await popup.locator('input').evaluateAll((els) => els.map((el) => ({
      name: el.name,
      id: el.id,
      type: el.type
    })));
    console.log('popup inputs', JSON.stringify(inputs));
    await popup.screenshot({ path: 'artifacts/oauth-popup-debug.png' }).catch(() => {});
  } else {
    console.log('no popup; main url', page.url());
  }
}

await page.waitForTimeout(5000);
console.log('status', await page.locator('[data-field="Status"]').textContent().catch(() => ''));
console.log('error', await page.locator('#spatial-detail-error').textContent().catch(() => ''));
console.log('diag', await page.evaluate(() => window.__iqaiSpatialV1Diagnostics?.() || null));
console.log('events', JSON.stringify(events.slice(-10)));

await browser.close();
