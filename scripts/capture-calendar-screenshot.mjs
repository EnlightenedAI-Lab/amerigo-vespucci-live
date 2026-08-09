import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(__dirname, '../public/spatial/intelligence-lab/screenshots-calendar');
fs.mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
await page.goto('http://localhost:3000/spatial/intelligence-lab/', { waitUntil: 'networkidle', timeout: 120000 });
await page.waitForFunction(() => window.__iqaiIntelligenceLab, null, { timeout: 90000 });
await page.waitForTimeout(3000);

await page.screenshot({ path: path.join(outDir, '01-calendar-month.png'), fullPage: false });

const dataEnd = await page.evaluate(() => window.__iqaiIntelligenceLab.state.reportDate);
const endDate = await page.evaluate(async () => {
  const r = await fetch('/api/spatial/spvm/crime-90d').then((x) => x.json());
  let max = '';
  for (const f of r.features) {
    const d = f.properties.date;
    if (d > max) max = d;
  }
  return max;
});

await page.evaluate((d) => {
  const btn = document.querySelector(`[data-cal-day="${d}"]`);
  if (btn) btn.click();
}, endDate);
await page.waitForTimeout(2000);

const summary = await page.evaluate(() => ({
  reportDate: window.__iqaiIntelligenceLab.state.reportDate,
  count: window.__iqaiIntelligenceLab.filteredFeatures().length,
  header: document.getElementById('reported-activity-header')?.textContent?.slice(0, 120)
}));

await page.screenshot({ path: path.join(outDir, '02-selected-day.png'), fullPage: false });

console.log(JSON.stringify({ outDir, endDate, summary }, null, 2));
await browser.close();
