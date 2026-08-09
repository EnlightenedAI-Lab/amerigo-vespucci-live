/**
 * Demo case workspace + grid hover verification.
 */
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(__dirname, '../public/spatial/intelligence-lab/screenshots-case-workspace');
fs.mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
await page.goto('http://localhost:3000/spatial/intelligence-lab/', { waitUntil: 'networkidle', timeout: 120000 });
await page.waitForFunction(() => window.__iqaiIntelligenceLab, null, { timeout: 90000 });
await page.waitForTimeout(2500);

// Grid hover must not show undefined in non-grid modes
const modes = ['incidents', 'heatmap', 'pdqAnalytics'];
const gridHoverTexts = [];
for (const mode of modes) {
  await page.selectOption('#lab-gis-mode', mode === 'pdqAnalytics' ? 'pdqAnalytics' : mode);
  await page.selectOption('#lab-time-window', mode === 'pdqAnalytics' ? 'off' : '72h');
  await page.waitForTimeout(1500);
  const hoverText = await page.evaluate(async () => {
    const view = window.__iqaiIntelligenceLab?.diagnostics?.();
    const host = document.querySelector('.lab-hover-card');
    return { mode: view?.gisDisplayMode, gridHover: view?.gridHoverEnabled, card: host?.classList.contains('lab-hidden') ? '' : host?.textContent };
  });
  gridHoverTexts.push(hoverText);
  await page.mouse.move(800, 400);
  await page.waitForTimeout(300);
  const cardAfterMove = await page.evaluate(() => document.querySelector('.lab-hover-card')?.textContent || '');
  if (/undefined reports|Dominant: —/.test(cardAfterMove)) {
    gridHoverTexts.push({ error: `bad hover in ${mode}: ${cardAfterMove}` });
  }
}

await page.evaluate(() => window.__iqaiIntelligenceLab.openSampleCase());
await page.waitForTimeout(4000);
await page.screenshot({ path: path.join(outDir, '01-case-open.png'), fullPage: false });

const caseVisible = await page.evaluate(() => {
  const host = document.querySelector('#case-workspace-host');
  return host && !host.classList.contains('lab-hidden') && host.textContent.includes('SYNTHETIC');
});

await page.fill('#explain-input', 'Summarize this case.');
await page.click('#explain-submit');
await page.waitForFunction(() => {
  const el = document.querySelector('#explain-response');
  return el && !el.classList.contains('is-loading') && el.textContent.length > 30;
}, null, { timeout: 90000 });
const caseSummary = await page.locator('#explain-response').textContent();
await page.screenshot({ path: path.join(outDir, '02-case-ask-iqai.png') });

const pinResult = await page.evaluate(() => {
  const btn = document.querySelector('.case-pin-btn');
  if (!btn) return { pinned: false };
  btn.click();
  return { pinned: document.querySelector('.case-related-card.is-pinned') != null };
});

const report = {
  gridHoverTexts,
  caseVisible,
  caseSummary: caseSummary?.slice(0, 300),
  pinResult,
  outDir
};
console.log(JSON.stringify(report, null, 2));
await browser.close();

if (!caseVisible || gridHoverTexts.some((g) => g.error)) process.exit(1);
