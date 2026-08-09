import { chromium } from 'playwright';

const BASE = process.env.PREVIEW_BASE || 'http://127.0.0.1:3000';
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto(`${BASE}/spatial/`, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForSelector('.spatial-shell', { timeout: 15000 });
await page.waitForTimeout(15000);
const signInVisible = await page.locator('#spatial-sign-in').isVisible().catch(() => false);
let popupInfo = null;
if (signInVisible) {
  const popupPromise = page.waitForEvent('popup', { timeout: 10000 }).catch(() => null);
  await page.click('#spatial-sign-in');
  const popup = await popupPromise;
  if (popup) {
    await popup.waitForLoadState('domcontentloaded', { timeout: 15000 }).catch(() => {});
    popupInfo = { url: popup.url(), text: (await popup.locator('body').innerText().catch(() => '')).slice(0, 400) };
    await popup.close();
    await page.waitForTimeout(8000);
  }
}
console.log(JSON.stringify({
  base: BASE,
  signInVisible,
  popupInfo,
  mapVisible: await page.locator('#spatial-map-host .esri-view-root, #spatial-map-host canvas').count() > 0,
  status: await page.locator('[data-field="Status"]').textContent(),
  error: await page.locator('#spatial-detail-error').textContent().catch(() => ''),
  diagnostics: await page.evaluate(() => window.__iqaiSpatialV1Diagnostics?.() || null),
  oauthCallback: (await fetch(`${BASE}/api/spatial/operational-map/oauth-config`).then((r) => r.json())).popupCallbackUrl
}, null, 2));
await browser.close();
