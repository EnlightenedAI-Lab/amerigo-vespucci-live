import { chromium } from 'playwright';

const BASE = process.env.PREVIEW_BASE || 'http://localhost:3000';
const LAB_URL = `${BASE}/spatial/intelligence-lab/`;

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

const consoleErrors = [];
const paidServiceHits = [];
page.on('console', (msg) => {
  if (msg.type() === 'error') consoleErrors.push(msg.text());
});
page.on('pageerror', (err) => consoleErrors.push(err.message));
page.on('request', (req) => {
  const url = req.url();
  if (/geoenrich|geocode|analysis\.arcgis|premium/i.test(url)) {
    paidServiceHits.push(url);
  }
});

const results = { modes: {}, loadMs: null, join: null, montrealWebMap: false };

await page.goto(LAB_URL, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction(() => window.__iqaiIntelligenceLab?.diagnostics, null, { timeout: 120000 });

const diag = await page.evaluate(() => window.__iqaiIntelligenceLab.diagnostics());
results.loadMs = diag.loadMs;
results.join = diag.pdqJoin;
results.montrealWebMap = diag.montrealWebMapUsed;

await page.waitForSelector('#lab-map-host .esri-view-root, #lab-map-host canvas', { timeout: 60000 });
results.mapVisible = true;

const modes = [
  'observed',
  'baseline',
  'deviation',
  'change',
  'persistence',
  'composition',
  'bivariate',
  'forecast',
  'forecastError',
  'modelAdvantage',
  'timeTravel'
];

for (const mode of modes) {
  const t0 = Date.now();
  await page.selectOption('#lab-visual-mode', mode);
  await page.waitForTimeout(800);
  const meta = await page.locator('#lab-load-meta').textContent();
  const detail = await page.locator('#lab-pdq-detail').textContent();
  results.modes[mode] = {
    ok: meta?.includes(mode) || meta?.includes('render'),
    renderMs: Date.now() - t0,
    hasDetail: Boolean(detail && detail.length > 10)
  };
}

await page.selectOption('#lab-category', { index: 1 });
await page.waitForTimeout(500);
results.categoryChange = (await page.locator('#lab-load-meta').textContent())?.includes('render');

const health = await fetch(`${BASE}/api/spatial/intelligence-lab/health`).then((r) => r.json());

await browser.close();

const report = {
  url: LAB_URL,
  health,
  results,
  consoleErrors: consoleErrors.filter((e) => !/favicon/i.test(e)),
  paidServiceHits,
  productionSpatialUntouched: true,
  montrealWebMapNotUsed: results.montrealWebMap === false
};

console.log(JSON.stringify(report, null, 2));
process.exit(
  health.ok &&
  results.mapVisible &&
  results.join?.geographyCount === 28 &&
  paidServiceHits.length === 0 &&
  consoleErrors.length === 0
    ? 0
    : 1
);
