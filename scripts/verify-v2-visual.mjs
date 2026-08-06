import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { startPreviewServer } from '../src/preview.js';

const OUT = join(process.cwd(), 'artifacts', 'vespucci-v2');
mkdirSync(OUT, { recursive: true });

const PORT = Number(process.env.PREVIEW_PORT || 3011);
let server;
if (!process.env.PREVIEW_PORT) {
  server = startPreviewServer(PORT);
  await new Promise((r) => setTimeout(r, 1500));
}
const BASE = `http://127.0.0.1:${PORT}`;

const browser = await chromium.launch({ headless: true });
const shots = [];
const report = { checks: [] };

async function capture(name, viewport, action) {
  const page = await browser.newPage({ viewport });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${BASE}/?v2=1`, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForSelector('#iqai-v2-app:not(.hidden)', { timeout: 30000 });
  if (action) await action(page);
  await page.waitForTimeout(10000);
  const file = join(OUT, `${name}.png`);
  await page.screenshot({ path: file, fullPage: false });
  shots.push(file);
  const nfn = await page.locator('.iqai-badge-nfn').count();
  const err = await page.locator('#iqai-boot-error:not(.hidden)').count();
  const check = { name, file, notForNavigationVisible: nfn > 0, bootError: err > 0, consoleErrors: errors.length };
  report.checks.push(check);
  console.log(JSON.stringify(check));
  await page.close();
}

await capture('desktop-navigation', { width: 1440, height: 900 });
await capture('mobile-navigation', { width: 390, height: 844 });

await capture('desktop-ocean', { width: 1440, height: 900 }, async (page) => {
  await page.locator('.iqai-mode-btn[data-mode="ocean"]').click({ force: true });
  await page.waitForTimeout(2000);
});

await capture('desktop-satellite', { width: 1440, height: 900 }, async (page) => {
  await page.locator('.iqai-mode-btn[data-mode="satellite"]').click({ force: true });
});

await capture('desktop-intelligence', { width: 1440, height: 900 }, async (page) => {
  await page.locator('.iqai-mode-btn[data-mode="intelligence"]').click({ force: true });
});

await capture('mobile-ocean-sheet', { width: 390, height: 844 }, async (page) => {
  await page.locator('.iqai-mode-btn[data-mode="ocean"]').click({ force: true });
});

// Keyboard mode switching
{
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(`${BASE}/?v2=1`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.iqai-mode-btn[data-mode="weather"]');
  await page.locator('.iqai-mode-btn[data-mode="weather"]').focus();
  await page.keyboard.press('Space');
  await page.waitForTimeout(1500);
  const mode = await page.locator('#iqai-active-mode').textContent();
  report.checks.push({ name: 'keyboard-weather-mode', ok: /weather/i.test(mode || '') });
  await page.close();
}

await browser.close();
if (server) server.close();

report.screenshotPaths = shots;
report.ok = report.checks.every((c) => c.notForNavigationVisible !== false && c.bootError !== true);
console.log(JSON.stringify(report, null, 2));
process.exitCode = report.ok ? 0 : 1;
