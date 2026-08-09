/**
 * Finalization verification — right rail Ask IQAI + desktop launchers.
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const desktop = process.env.USERPROFILE
  ? fs.existsSync(path.join(process.env.USERPROFILE, 'OneDrive', 'Desktop'))
    ? path.join(process.env.USERPROFILE, 'OneDrive', 'Desktop')
    : path.join(process.env.USERPROFILE, 'Desktop')
  : null;

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
await page.goto('http://localhost:3000/spatial/intelligence-lab/', { waitUntil: 'networkidle', timeout: 120000 });
await page.waitForFunction(() => window.__iqaiIntelligenceLab, null, { timeout: 90000 });
await page.waitForTimeout(2000);

const rail = await page.evaluate(() => ({
  disclosureSummaries: [...document.querySelectorAll('.intel-panel details summary')].map((el) => el.textContent.trim()),
  hasAskInput: !!document.querySelector('#explain-input'),
  hasAskButton: !!document.querySelector('#explain-submit'),
  hasChips: document.querySelectorAll('.explain-chip, .explain-chips').length,
  hasChartInfoBtn: !!document.querySelector('.chart-info-btn'),
  metricsVisible: !!document.querySelector('#metric-cards')?.textContent?.trim(),
  responseHidden: document.querySelector('#explain-response')?.classList.contains('lab-hidden')
}));

await page.fill('#explain-input', 'What does the recent expectation number represent in this PDQ view?');
await page.click('#explain-submit');
await page.waitForFunction(() => {
  const el = document.querySelector('#explain-response');
  return el && !el.classList.contains('is-loading') && el.textContent && el.textContent !== 'Thinking…';
}, null, { timeout: 120000 });

const ask = await page.evaluate(() => ({
  answer: document.querySelector('#explain-response')?.textContent?.trim() || '',
  answerLength: document.querySelector('#explain-response')?.textContent?.trim().length || 0
}));

await browser.close();

const shortcuts = desktop
  ? ['IQAI Spatial - Investigation.lnk', 'IQAI Spatial - Intelligence.lnk'].map((name) => ({
    name,
    path: path.join(desktop, name),
    exists: fs.existsSync(path.join(desktop, name))
  }))
  : [];

const intelligenceProbe = await fetch('http://localhost:3000/spatial/').then((r) => ({
  ok: r.ok,
  status: r.status,
  hasSpatialShell: false
})).then(async (base) => {
  const html = await fetch('http://localhost:3000/spatial/').then((r) => r.text());
  return { ...base, hasSpatialShell: html.includes('spatial-app') };
});

const report = { rail, ask, shortcuts, intelligenceProbe, iconExists: fs.existsSync(path.join(projectRoot, 'assets/launchers/iqai-spatial.ico')) };
console.log(JSON.stringify(report, null, 2));

const failures = [];
if (rail.disclosureSummaries.length) failures.push('disclosure sections still visible');
if (!rail.hasAskInput || !rail.hasAskButton) failures.push('ask iqai controls missing');
if (rail.hasChips || rail.hasChartInfoBtn) failures.push('example UI still present');
if (!rail.responseHidden) failures.push('response should start hidden');
if (ask.answerLength < 20) failures.push('ask response too short');
if (!shortcuts.every((s) => s.exists)) failures.push('desktop shortcuts missing');
if (!intelligenceProbe.hasSpatialShell) failures.push('intelligence route invalid');
if (!report.iconExists) failures.push('launcher icon missing');

if (failures.length) {
  console.error('FAILED:', failures.join('; '));
  process.exit(1);
}
