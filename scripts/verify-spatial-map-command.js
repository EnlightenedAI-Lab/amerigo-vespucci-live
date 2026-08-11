/**
 * Headless smoke test: MAP COMMAND must not throw "executed is not defined".
 * Requires preview server on localhost:3000 and may need ArcGIS session for full query.
 */
import { chromium } from 'playwright';

const BASE = process.env.SPATIAL_BASE_URL || 'http://localhost:3000/spatial/';
const PROMPT = 'map amenities within 3km of 997 de la commune';

const errors = [];
const pageErrors = [];

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();

page.on('pageerror', (err) => pageErrors.push(String(err)));
page.on('console', (msg) => {
  if (msg.type() === 'error') errors.push(msg.text());
});

await page.goto(BASE, { waitUntil: 'networkidle', timeout: 120000 });

await page.waitForSelector('#spatial-deterministic-input', { timeout: 60000 });
await page.fill('#spatial-deterministic-input', PROMPT);
await page.click('#spatial-deterministic-run');

await page.waitForTimeout(45000);

const feedback = await page.locator('#spatial-deterministic-feedback').textContent().catch(() => '');
const hasExecutedError = [...pageErrors, ...errors, feedback].some((text) => (
  String(text).includes('executed is not defined')
));

const accounting = await page.evaluate(() => window.__IQAI_DETERMINISTIC_RESULT_ACCOUNTING__ || null);
const renderer = await page.evaluate(() => window.__IQAI_RESULT_RENDERER__ || null);

console.log(JSON.stringify({
  feedback: feedback?.trim() || null,
  hasExecutedError,
  pageErrors,
  consoleErrors: errors.slice(0, 5),
  accounting,
  rendererMode: renderer?.mode || null,
  matchedFeatures: accounting?.totalMatchingObjectIds ?? null
}, null, 2));

await browser.close();
process.exit(hasExecutedError ? 1 : 0);
