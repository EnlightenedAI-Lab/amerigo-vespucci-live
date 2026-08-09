import { chromium } from 'playwright';

const BASE = process.env.PREVIEW_BASE || 'http://127.0.0.1:3000';
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
const target = `${BASE}/spatial/`;
await page.goto(target, { waitUntil: 'domcontentloaded' });
const pageUrl = page.url();
const origin = await page.evaluate(() => window.location.origin);
await page.waitForSelector('#spatial-sign-in', { timeout: 15000 });
const popupPromise = page.waitForEvent('popup', { timeout: 10000 }).catch(() => null);
await page.click('#spatial-sign-in');
const popup = await popupPromise;
let redirectUri = null;
let popupText = null;
if (popup) {
  await popup.waitForLoadState('domcontentloaded', { timeout: 15000 }).catch(() => {});
  const url = popup.url();
  const m = url.match(/redirect_uri=([^&]+)/);
  redirectUri = m ? decodeURIComponent(m[1]) : url;
  popupText = (await popup.locator('body').innerText().catch(() => '')).slice(0, 200);
  await popup.close();
}
console.log(JSON.stringify({ target, pageUrl, origin, redirectUri, popupText }, null, 2));
await browser.close();
