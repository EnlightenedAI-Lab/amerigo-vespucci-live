import { chromium } from 'playwright';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BASE = process.env.SPATIAL_URL || 'http://localhost:3456';

const errors = [];
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

page.on('pageerror', (err) => errors.push(String(err)));

await page.goto(`${BASE}/spatial/?v=${Date.now()}`, { waitUntil: 'networkidle', timeout: 60000 });
await page.waitForTimeout(8000);

// Simulate setMapLedger path without full ArcGIS auth
const simulated = await page.evaluate(() => {
  try {
    const mapResult = {
      supported: true,
      summary: { matchedFeatures: 2000, execution: 'Deterministic GIS', action: 'WITHIN' },
      features: new Array(2000).fill({}),
      datasetResults: [{ matchedFeatures: 2000 }]
    };
    // Trigger the same code path AppShell uses after a map command
    const tray = document.querySelector('#spatial-event-tray');
    if (!tray) return { ok: false, reason: 'no event tray' };
    return { ok: true, note: 'tray present — run command in browser for full test' };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
});

await page.fill('#spatial-deterministic-input', 'map amenities within 3km of 997 de la commune');
await page.locator('#spatial-deterministic-run').click({ force: true });
await page.waitForTimeout(25000);

const tdz = errors.filter((e) => /Cannot access 'total' before initialization/i.test(e));
const runtime = await page.evaluate(() => ({
  inspect: window.__IQAI_RUNTIME_LAYER_INSPECT__ || null,
  detailError: document.querySelector('#spatial-detail-error')?.textContent?.trim() || '',
  detFeedback: document.querySelector('#spatial-deterministic-feedback')?.textContent?.trim() || '',
  resultsTab: document.querySelector('.context-dock__tab[data-tab="RESULTS"]')?.textContent?.trim() || '',
  lastResult: document.querySelector('#spatial-last-operation')?.textContent?.trim() || ''
}));

await page.screenshot({ path: resolve(__dirname, '../artifacts/verify-tdz-fix-amenities.png'), fullPage: false });

const report = {
  base: BASE,
  tdzErrors: tdz,
  allPageErrors: errors,
  simulated,
  runtime,
  pass: tdz.length === 0
};

console.log(JSON.stringify(report, null, 2));
await browser.close();
process.exit(tdz.length ? 1 : 0);
