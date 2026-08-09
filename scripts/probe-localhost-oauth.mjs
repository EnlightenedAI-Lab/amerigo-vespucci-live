import { chromium } from 'playwright';

const BASE = process.env.TEST_BASE || 'http://localhost:3000';
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto(`${BASE}/spatial/`, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForSelector('#spatial-sign-in', { timeout: 15000 });
const popup = await Promise.all([
  page.waitForEvent('popup', { timeout: 10000 }).catch(() => null),
  page.click('#spatial-sign-in')
]).then(([p]) => p);
let redirect = null;
let popupText = null;
if (popup) {
  await popup.waitForLoadState('domcontentloaded', { timeout: 15000 }).catch(() => {});
  const url = popup.url();
  const m = url.match(/redirect_uri=([^&]+)/);
  redirect = m ? decodeURIComponent(m[1]) : url;
  popupText = (await popup.locator('body').innerText().catch(() => '')).slice(0, 250);
  await popup.close();
}
await page.waitForTimeout(15000);
console.log(JSON.stringify({
  base: BASE,
  origin: await page.evaluate(() => window.location.origin),
  redirect,
  popupText,
  mapVisible: await page.locator('#spatial-map-host .esri-view-root, #spatial-map-host canvas').count() > 0,
  status: await page.locator('[data-field="Status"]').textContent(),
  error: await page.locator('#spatial-detail-error').textContent().catch(() => ''),
  diagnostics: await page.evaluate(() => window.__iqaiSpatialV1Diagnostics?.() || null)
}, null, 2));
await browser.close();
