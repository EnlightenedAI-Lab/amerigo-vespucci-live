/**
 * Verification for investigation cleanup pass (logo, explain removal, case form, forecast).
 */
import { chromium } from 'playwright';
import { validateCaseCoverage } from '../public/spatial/intelligence-lab/lab-case.js';
import { buildHistoryWithOutlook, OUTLOOK_END } from '../public/spatial/intelligence-lab/lab-outlook.js';
import { LabDataStore } from '../public/spatial/intelligence-lab/lab-data.js';

const emptyCoverage = validateCaseCoverage({ latitude: '', longitude: '' }, []);
if (emptyCoverage.warning) {
  console.error('FAIL: empty form should not warn', emptyCoverage);
  process.exit(1);
}

let nodeForecast = null;
try {
  const base = 'http://localhost:3000';
  const [manifest, panel, f1Forecasts, f1Advantage] = await Promise.all([
    fetch(`${base}/api/spatial/intelligence-lab/manifest`).then((r) => r.json()),
    fetch(`${base}/api/spatial/intelligence-lab/panel`).then((r) => r.json()),
    fetch(`${base}/api/spatial/intelligence-lab/f1-forecasts`).then((r) => r.json()),
    fetch(`${base}/api/spatial/intelligence-lab/f1-model-advantage`).then((r) => r.json())
  ]);
  const store = new LabDataStore(manifest, panel, f1Forecasts, f1Advantage);
  const built = buildHistoryWithOutlook(store, null, store.categories[0], 'B2', 52, 'eoy2027');
  nodeForecast = {
    outlookEnd: OUTLOOK_END,
    finalForecastWeek: built.finalForecastWeek,
    outlookCount: built.series.filter((s) => s.phase === 'outlook').length,
    lastObservedWeek: built.lastObservedWeek
  };
} catch (err) {
  nodeForecast = { error: String(err.message || err) };
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
await page.goto('http://localhost:3000/spatial/intelligence-lab/', { waitUntil: 'networkidle', timeout: 120000 });
await page.waitForFunction(() => window.__iqaiIntelligenceLab, null, { timeout: 90000 });
await page.waitForTimeout(3000);

const brand = await page.evaluate(() => ({
  logo: document.querySelector('.iqai-spatial-brand__logo')?.getAttribute('src'),
  product: document.querySelector('.iqai-spatial-brand__product')?.textContent,
  explainPanel: !!document.querySelector('.explain-panel')
}));

await page.evaluate(() => document.getElementById('case-create-dialog').showModal());
await page.waitForTimeout(300);
const modal = await page.evaluate(() => ({
  coverageHidden: document.querySelector('#case-coverage-warn')?.classList.contains('lab-hidden'),
  coverageText: document.querySelector('#case-coverage-warn')?.textContent?.trim() || '',
  banners: [...document.querySelectorAll('.case-form-banner, .case-form-banner-inline')].map((e) => e.textContent.trim())
}));

await page.evaluate(() => {
  const dlg = document.getElementById('case-create-dialog');
  if (dlg?.open) dlg.close();
  document.querySelector('[data-mode="forecast"]')?.click();
});
await page.waitForTimeout(3000);
const forecast = await page.evaluate(() => ({
  horizon: document.getElementById('chart-horizon')?.value,
  horizons: [...document.getElementById('chart-horizon')?.options || []].map((o) => o.value),
  outlookBadge: document.getElementById('outlook-badge')?.textContent?.slice(0, 80),
  chartHasOutlookLegend: !!document.querySelector('.lg-outlook'),
  chartTitle: document.querySelector('.history-chart__title')?.textContent || ''
}));

await page.evaluate(() => {
  document.getElementById('case-create-dialog').close();
  return window.__iqaiIntelligenceLab.openSampleCase();
});
await page.waitForTimeout(5000);

const golden = await page.evaluate(() => {
  const ws = window.__iqaiIntelligenceLab.caseWorkspace();
  return { nearby: ws?.relatedReports?.length || 0, coverage: ws?.coverage?.insideCoverage };
});

const canvas = await page.locator('#lab-map-host canvas').first().boundingBox();
const poly = canvas
  ? await page.evaluate(([cx, cy]) => window.__iqaiIntelligenceLab.simulateMapClick(cx, cy), [
    canvas.x + canvas.width * 0.62,
    canvas.y + canvas.height * 0.55
  ])
  : { selected: [] };

const report = { brand, modal, forecast, nodeForecast, golden, poly, emptyCoverage };
console.log(JSON.stringify(report, null, 2));
await browser.close();

const failures = [];
if (!brand.logo?.includes('iqai-logo')) failures.push('logo missing');
if (brand.explainPanel) failures.push('explain panel still present');
if (!modal.coverageHidden || modal.coverageText) failures.push('empty form shows coverage warning');
if (modal.banners.length !== 1) failures.push(`expected 1 synthetic banner, got ${modal.banners.length}`);
if (!forecast.horizons.includes('eoy2027')) failures.push('missing End 2027 horizon');
if (nodeForecast.finalForecastWeek !== '2027-12-27') {
  failures.push(`final forecast week expected 2027-12-27, got ${nodeForecast.finalForecastWeek}`);
}
if (nodeForecast.outlookEnd !== '2027-12-27') failures.push('outlook end mismatch');
if (golden.nearby < 5) failures.push(`golden demo reports low: ${golden.nearby}`);
if (!poly.selected?.length) failures.push('polygon click failed');

if (failures.length) {
  console.error('FAILED:', failures.join('; '));
  process.exit(1);
}
