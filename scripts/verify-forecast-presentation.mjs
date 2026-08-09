/**
 * Visual/presentation verification — header branding + forecast discoverability.
 */
import { chromium } from 'playwright';
import { buildHistoryWithOutlook, OUTLOOK_END } from '../public/spatial/intelligence-lab/lab-outlook.js';
import { LabDataStore } from '../public/spatial/intelligence-lab/lab-data.js';

const base = 'http://localhost:3000';
const [manifest, panel, f1Forecasts, f1Advantage] = await Promise.all([
  fetch(`${base}/api/spatial/intelligence-lab/manifest`).then((r) => r.json()),
  fetch(`${base}/api/spatial/intelligence-lab/panel`).then((r) => r.json()),
  fetch(`${base}/api/spatial/intelligence-lab/f1-forecasts`).then((r) => r.json()),
  fetch(`${base}/api/spatial/intelligence-lab/f1-model-advantage`).then((r) => r.json())
]);
const store = new LabDataStore(manifest, panel, f1Forecasts, f1Advantage);
const built = buildHistoryWithOutlook(store, null, store.categories[0], 'B2', 52, 'eoy2027');

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
await page.goto(`${base}/spatial/intelligence-lab/`, { waitUntil: 'networkidle', timeout: 120000 });
await page.waitForFunction(() => window.__iqaiIntelligenceLab, null, { timeout: 90000 });
await page.waitForTimeout(3000);

const header = await page.evaluate(() => ({
  product: document.querySelector('.iqai-spatial-brand__product')?.textContent?.trim(),
  workspace: document.querySelector('.iqai-spatial-brand__workspace')?.textContent?.trim(),
  lockupText: document.querySelector('.iqai-spatial-brand__lockup')?.textContent?.replace(/\s+/g, ' ').trim(),
  hasLogo: !!document.querySelector('.iqai-spatial-brand__logo')
}));

await page.evaluate(() => document.querySelector('[data-mode="forecast"]')?.click());
await page.waitForTimeout(2500);

const forecast = await page.evaluate(() => ({
  horizonActive: document.querySelector('.chart-horizon-tab.is-active')?.textContent?.trim(),
  stripVisible: !document.getElementById('chart-forecast-strip')?.classList.contains('lab-hidden'),
  status: document.getElementById('chart-horizon-status')?.textContent?.trim(),
  xLabels: [...document.querySelectorAll('.chart-axis--x')].map((n) => n.textContent.trim()),
  observedLabel: document.querySelector('.chart-observed-label')?.textContent?.trim(),
  outlookLabel: document.querySelector('.chart-forecast-label')?.textContent?.trim(),
  f1Banner: document.getElementById('lab-f1-banner')?.textContent?.replace(/\s+/g, ' ').trim(),
  drawerExpanded: !document.getElementById('chart-drawer')?.classList.contains('is-collapsed'),
  forecastMode: document.body.querySelector('#app-body')?.classList.contains('is-forecast-mode')
}));

await page.screenshot({
  path: 'artifacts/verify-forecast-presentation.png',
  fullPage: false
});

console.log(JSON.stringify({
  header,
  forecast,
  nodeForecast: {
    outlookEnd: OUTLOOK_END,
    finalForecastWeek: built.finalForecastWeek
  }
}, null, 2));

await browser.close();

const failures = [];
if (header.product !== 'SPATIAL') failures.push(`header product should be SPATIAL, got ${header.product}`);
if (header.lockupText?.includes('IQAI SPATIAL')) failures.push('duplicate IQAI text in lockup');
if (!forecast.stripVisible) failures.push('forecast strip hidden');
if (forecast.horizonActive !== 'END 2027') failures.push(`active horizon ${forecast.horizonActive}`);
if (!forecast.status?.includes('DEC 2027')) failures.push('status label missing DEC 2027');
if (!forecast.xLabels.includes('Dec 2027')) failures.push(`x-axis missing Dec 2027: ${forecast.xLabels.join(', ')}`);
if (!forecast.xLabels.includes('Jan 2027')) failures.push('x-axis missing Jan 2027');
if (built.finalForecastWeek !== '2027-12-27') failures.push(`final week ${built.finalForecastWeek}`);
if (!forecast.drawerExpanded) failures.push('chart drawer collapsed');

if (failures.length) {
  console.error('FAILED:', failures.join('; '));
  process.exit(1);
}
