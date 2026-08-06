import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { startPreviewServer } from '../src/preview.js';

const OUT = join(process.cwd(), 'artifacts', 'vespucci-classic');
mkdirSync(OUT, { recursive: true });

const PORT = Number(process.env.PREVIEW_PORT || 3020);
let server;
if (!process.env.PREVIEW_PORT) {
  server = startPreviewServer(PORT);
  await new Promise((r) => setTimeout(r, 1500));
}
const BASE = `http://127.0.0.1:${PORT}`;

const browser = await chromium.launch({ headless: true });
const shots = [];
const checks = [];

async function shot(name, viewport, action) {
  const page = await browser.newPage({ viewport });
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForSelector('#app:not(.hidden)', { timeout: 30000 });
  await page.waitForTimeout(3000);
  if (action) await action(page);
  await page.waitForTimeout(action ? 8000 : 2000);
  const file = join(OUT, `${name}.png`);
  await page.screenshot({ path: file, fullPage: false });
  shots.push(file);
  const classic = await page.locator('h1:has-text("Amerigo Vespucci")').count();
  const v2hidden = await page.locator('#iqai-v2-app.hidden').count();
  const layersBtn = await page.locator('.btn-spatial-layers').count();
  checks.push({ name, file, classicVisible: classic > 0, v2Hidden: v2hidden > 0, layersButton: layersBtn > 0 });
  console.log(JSON.stringify(checks[checks.length - 1]));
  await page.close();
}

await shot('desktop-default-off', { width: 1440, height: 900 });

await shot('desktop-layers-panel', { width: 1440, height: 900 }, async (page) => {
  await page.locator('#tracker-controls .btn-spatial-layers').click({ force: true });
});

async function toggleLayer(page, key) {
  await page.evaluate((layerKey) => {
    const root = document.getElementById('spatial-layers-root');
    root?.classList.remove('hidden');
    root?.setAttribute('aria-hidden', 'false');
    const input = document.querySelector(`input[data-spatial-layer="${layerKey}"]`);
    if (input && !input.checked) {
      input.checked = true;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }, key);
}

await shot('desktop-currents', { width: 1440, height: 900 }, async (page) => {
  await toggleLayer(page, 'currents');
  await page.click('#btn-mode-ocean');
  await page.waitForTimeout(6000);
});

await shot('desktop-waves', { width: 1440, height: 900 }, async (page) => {
  await page.click('#btn-mode-ocean');
  await page.waitForTimeout(4000);
  await toggleLayer(page, 'waves');
  await page.waitForTimeout(6000);
});

await shot('desktop-satellite', { width: 1440, height: 900 }, async (page) => {
  await page.click('#btn-mode-ocean');
  await toggleLayer(page, 'satellite');
  await page.waitForTimeout(6000);
});

await shot('desktop-maritime', { width: 1440, height: 900 }, async (page) => {
  await toggleLayer(page, 'maritime');
  await page.waitForTimeout(3000);
});

await shot('mobile-default', { width: 390, height: 844 });

await shot('mobile-layers-sheet', { width: 390, height: 844 }, async (page) => {
  await page.locator('#tracker-controls .btn-spatial-layers').click({ force: true });
});

await browser.close();
if (server) server.close();

const ok = checks.every((c) => c.classicVisible && c.v2Hidden && c.layersButton);
console.log(JSON.stringify({ ok, checks, screenshotPaths: shots }, null, 2));
process.exitCode = ok ? 0 : 1;
