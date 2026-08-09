import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(__dirname, '../public/spatial/intelligence-lab/screenshots-v5');
fs.mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
const report = { errors: [] };

page.on('pageerror', (e) => report.errors.push(e.message));

await page.goto('http://localhost:3000/spatial/intelligence-lab/', { waitUntil: 'networkidle', timeout: 120000 });
await page.waitForFunction(() => window.__iqaiIntelligenceLab, null, { timeout: 90000 });
await page.waitForTimeout(3000);

await page.locator('[data-mode="observed"]').click();
await page.waitForTimeout(1500);
await page.screenshot({ path: path.join(outDir, '01-observed-pdq-labels.png') });

await page.selectOption('#lab-time-window', '24h');
await page.selectOption('#lab-gis-mode', 'incidents');
await page.waitForTimeout(2500);
await page.screenshot({ path: path.join(outDir, '02-recent-24h-incidents.png') });

await page.selectOption('#lab-time-window', '72h');
await page.selectOption('#lab-gis-mode', 'heatmap');
await page.waitForTimeout(2500);
await page.screenshot({ path: path.join(outDir, '03-72h-heatmap.png') });

await page.selectOption('#lab-gis-mode', 'grid');
await page.waitForTimeout(2000);
await page.screenshot({ path: path.join(outDir, '04-grid-density.png') });

await page.locator('[data-mode="composition"]').click();
await page.selectOption('#lab-time-window', 'off');
await page.selectOption('#lab-gis-mode', 'pdqAnalytics');
await page.waitForTimeout(2000);
await page.screenshot({ path: path.join(outDir, '05-composition.png') });

await page.selectOption('#chart-scope', 'pdq');
await page.selectOption('#chart-horizon', 'eoy2027');
await page.waitForTimeout(1000);
await page.screenshot({ path: path.join(outDir, '06-pdq-2027-outlook.png') });

await page.selectOption('#chart-scope', 'montreal');
await page.waitForTimeout(1000);
await page.screenshot({ path: path.join(outDir, '07-montreal-2027-outlook.png') });

await page.locator('[data-mode="timeTravel"]').click();
await page.waitForTimeout(2500);
report.timeSlider = await page.locator('.time-slider-host:not(.lab-hidden) .esri-time-slider').count();
await page.screenshot({ path: path.join(outDir, '08-time-active.png') });

await page.selectOption('#lab-time-window', '72h');
await page.selectOption('#lab-gis-mode', 'incidents');
await page.waitForTimeout(2000);
await page.click('#view-records-btn');
await page.waitForTimeout(800);
await page.screenshot({ path: path.join(outDir, '09-records-drawer.png') });

await page.click('#explain-prompt-btn');
await page.waitForTimeout(600);
await page.screenshot({ path: path.join(outDir, '10-ask-iqai.png') });

await page.locator('input[data-layer="arrondBoundaries"]').check();
await page.locator('input[data-layer="arrondLabels"]').check();
await page.waitForTimeout(1500);
await page.screenshot({ path: path.join(outDir, '11-pdq-arrond-boundaries.png') });

report.diagnostics = await page.evaluate(() => window.__iqaiIntelligenceLab.diagnostics());
report.outDir = outDir;
console.log(JSON.stringify(report, null, 2));
await browser.close();
