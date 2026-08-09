import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(__dirname, '../public/spatial/intelligence-lab/screenshots-v2');
fs.mkdirSync(outDir, { recursive: true });

const modes = [
  ['deviation', '01-deviation'],
  ['observed', '02-observed'],
  ['composition', '03-composition'],
  ['bivariate', '04-bivariate'],
  ['timeTravel', '05-time'],
  ['forecastError', '06-forecast-error']
];

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
await page.goto('http://localhost:3000/spatial/intelligence-lab/', { waitUntil: 'networkidle', timeout: 120000 });
await page.waitForFunction(() => window.__iqaiIntelligenceLab, null, { timeout: 90000 });
await page.waitForTimeout(3000);

for (const [mode, file] of modes) {
  await page.locator(`[data-mode="${mode}"]`).click();
  await page.waitForTimeout(2200);
  await page.screenshot({ path: path.join(outDir, `${file}.png`) });
  console.log('captured', file);
}

await browser.close();
console.log('screenshots:', outDir);
