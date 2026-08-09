/**
 * Verify IQAI Spatial shell loads after SPVM explorer patch (no auth required for shell DOM).
 */
import { chromium } from 'playwright';

const BASE = process.env.PREVIEW_BASE || 'http://localhost:3000';
const RELOADS = 3;

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

const pageErrors = [];
const consoleErrors = [];
const failedModules = [];

page.on('pageerror', (err) => pageErrors.push(err.message));
page.on('console', (msg) => {
  if (msg.type() === 'error') consoleErrors.push(msg.text());
});
page.on('response', (res) => {
  const url = res.url();
  if (res.status() >= 400 && /\.js(\?|$)/i.test(url) && url.includes('/spatial/')) {
    failedModules.push(`${res.status()} ${url}`);
  }
});

async function shellCheck() {
  return page.evaluate(() => ({
    brand: Boolean(document.querySelector('.spatial-brand')),
    nav: document.querySelectorAll('.spatial-nav-item').length,
    layerPanel: Boolean(document.querySelector('#spatial-layer-panel')),
    commandBar: Boolean(document.querySelector('#spatial-command-bar')),
    mapHost: Boolean(document.querySelector('#spatial-map-host')),
    shell: Boolean(document.querySelector('.spatial-shell')),
    spvmExplorerHidden: (() => {
      const el = document.querySelector('.spvm-explorer');
      return !el || el.hidden;
    })()
  }));
}

const reloadResults = [];

for (let i = 0; i < RELOADS; i += 1) {
  if (i === 0) {
    await page.goto(`${BASE}/spatial/`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  } else {
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
  }
  await page.waitForTimeout(2000);
  const check = await shellCheck();
  reloadResults.push(check);
}

const spvmListed = await page.evaluate(() => {
  const items = [...document.querySelectorAll('#spatial-arcgis-layerlist calcite-list-item, #spatial-arcgis-layerlist .esri-layer-list__item')];
  return items.some((el) => /SPVM.*Recent Crime/i.test(el.textContent || ''));
}).catch(() => false);

await browser.close();

const shellOk = reloadResults.every((r) =>
  r.shell && r.brand && r.nav >= 3 && r.layerPanel && r.commandBar && r.mapHost
);

const startupHidden = reloadResults.every((r) => r.spvmExplorerHidden);

console.log(JSON.stringify({
  firstFatalError: pageErrors[0] || consoleErrors.find((e) => /failed|error|404/i.test(e)) || null,
  pageErrors,
  consoleErrors: consoleErrors.slice(0, 10),
  failedModules,
  reloadResults,
  shellOk,
  startupHidden,
  spvmListed,
  threeReloads: reloadResults.filter((r) => r.shell).length === RELOADS
}, null, 2));

process.exit(shellOk && reloadResults.length === RELOADS ? 0 : 1);
