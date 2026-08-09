import { chromium } from 'playwright';

const BASE = process.env.PREVIEW_BASE || 'http://localhost:3000';
const PROMPT = 'Map fire stations within 3 km of 6939 Décarie Boulevard.';
const xaiRequests = [];

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('request', (req) => {
  if (/xai|grok|api\.x\.ai/i.test(req.url())) xaiRequests.push(req.url());
});

await page.goto(`${BASE}/spatial/`, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForSelector('.spatial-shell', { timeout: 15000 });
await page.waitForFunction(() => window.__iqaiSpatialV1Diagnostics?.()?.mapViewCreateCount === 1, { timeout: 180000 }).catch(() => {});

const input = page.locator('#spatial-command-input');
await input.fill(PROMPT);
await page.waitForTimeout(200);

const runEnabled = await page.locator('#spatial-command-run').isEnabled();
await page.locator('#spatial-command-run').click();

await page.waitForFunction(() => {
  const freshness = document.querySelector('[data-field="Freshness"]')?.textContent;
  return freshness === '6';
}, { timeout: 60000 }).catch(() => {});

await page.waitForTimeout(2000);

const resultCount = Number(await page.locator('[data-field="Freshness"]').textContent().catch(() => '0'));
const layerText = await page.locator('#spatial-arcgis-layerlist').innerText();
const layerListed = /IQAI — Fire Stations within 3 km/i.test(layerText);

let togglePass = false;
const iqaiCheckbox = page.locator('#spatial-arcgis-layerlist calcite-list-item, #spatial-arcgis-layerlist .esri-layer-list__item').filter({ hasText: /IQAI/i }).locator('calcite-checkbox, input[type="checkbox"]').first();
if (await iqaiCheckbox.count() > 0) {
  const before = await iqaiCheckbox.isChecked().catch(() => null);
  await iqaiCheckbox.click({ force: true });
  await page.waitForTimeout(1000);
  const after = await iqaiCheckbox.isChecked().catch(() => null);
  togglePass = before !== null && after !== null && before !== after;
}

const diag = await page.evaluate(() => window.__iqaiSpatialV1Diagnostics?.() || null);
const mapVisible = await page.locator('#spatial-map-host .esri-view-root, #spatial-map-host canvas').count() > 0;

console.log(JSON.stringify({
  runEnabled,
  resultCount,
  sixStations: resultCount === 6,
  layerListed,
  togglePass,
  mapVisible,
  mapViewCount: diag?.mapViewCreateCount ?? 0,
  xaiCalls: xaiRequests.length
}, null, 2));

await browser.close();
