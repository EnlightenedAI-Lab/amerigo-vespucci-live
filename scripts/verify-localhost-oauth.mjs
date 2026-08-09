import { chromium } from 'playwright';

const BASE = 'http://localhost:3000';
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const consoleErrors = [];
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });

await page.goto(`${BASE}/spatial/`, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForSelector('.spatial-shell', { timeout: 15000 });

async function attemptAuth() {
  if (!(await page.locator('#spatial-sign-in').isVisible().catch(() => false))) return;
  const popupPromise = page.waitForEvent('popup', { timeout: 10000 }).catch(() => null);
  await page.click('#spatial-sign-in');
  const popup = await popupPromise;
  if (popup) {
    await popup.waitForEvent('close', { timeout: 60000 }).catch(() => {});
  }
  await page.waitForTimeout(5000);
}

const runs = [];
for (let i = 0; i < 3; i += 1) {
  if (i > 0) await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.spatial-shell', { timeout: 15000 });
  await attemptAuth();
  await page.waitForTimeout(12000);
  runs.push({
    load: i + 1,
    mapVisible: await page.locator('#spatial-map-host .esri-view-root, #spatial-map-host canvas').count() > 0,
    layout: await page.evaluate(() => {
      const lb = document.querySelector('.spatial-sidebar-left')?.getBoundingClientRect();
      const cb = document.querySelector('.spatial-center')?.getBoundingClientRect();
      const rb = document.querySelector('.spatial-sidebar-right')?.getBoundingClientRect();
      return lb && cb && rb && lb.right <= cb.left + 2 && cb.right <= rb.left + 2;
    }),
    diagnostics: await page.evaluate(() => window.__iqaiSpatialV1Diagnostics?.() || null),
    status: await page.locator('[data-field="Status"]').textContent(),
    error: await page.locator('#spatial-detail-error').textContent().catch(() => '')
  });
}

console.log(JSON.stringify({ base: BASE, runs, consoleErrors }, null, 2));
await browser.close();

const ok = runs.every((r) => r.mapVisible && r.layout && r.diagnostics?.mapViewCreateCount === 1);
process.exit(ok ? 0 : 1);
