import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(__dirname, '../public/spatial/intelligence-lab/screenshots-v3');
fs.mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
await page.goto('http://localhost:3000/spatial/intelligence-lab/', { waitUntil: 'networkidle', timeout: 120000 });
await page.waitForFunction(() => window.__iqaiIntelligenceLab, null, { timeout: 90000 });
await page.waitForTimeout(2500);

await page.locator('[data-mode="observed"]').click();
await page.waitForTimeout(1500);
await page.selectOption('#lab-recent-reports', '72h');
await page.waitForTimeout(2000);
await page.screenshot({ path: path.join(outDir, '01-observed-recent-72h.png') });

await page.locator('[data-mode="deviation"]').click();
await page.waitForTimeout(1500);
await page.screenshot({ path: path.join(outDir, '02-deviation-pdq-chart.png') });

await page.selectOption('#chart-scope', 'montreal');
await page.waitForTimeout(1000);
await page.screenshot({ path: path.join(outDir, '03-montreal-total-outlook.png') });

await page.locator('[data-mode="timeTravel"]').click();
await page.waitForTimeout(2000);
const sliderVisible = await page.locator('.time-slider-host:not(.lab-hidden) .esri-time-slider').count();
await page.screenshot({ path: path.join(outDir, '04-time-active.png') });

await page.locator('#explain-prompt-btn').click();
await page.waitForTimeout(500);
await page.screenshot({ path: path.join(outDir, '05-explain-this.png') });

console.log(JSON.stringify({ outDir, sliderVisible }, null, 2));
await browser.close();
