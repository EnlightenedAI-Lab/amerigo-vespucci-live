/**
 * Verify shell + SPVM layer listing after auth wait.
 */
import { chromium } from 'playwright';

const BASE = process.env.PREVIEW_BASE || 'http://localhost:3000';
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

const pageErrors = [];
page.on('pageerror', (err) => pageErrors.push(err.message));

await page.goto(`${BASE}/spatial/`, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForSelector('.spatial-shell', { timeout: 15000 });

const signIn = page.locator('#spatial-sign-in');
if (await signIn.isVisible({ timeout: 5000 }).catch(() => false)) {
  await signIn.click();
  await page.waitForTimeout(15000);
}
await page.waitForTimeout(12000);

const result = await page.evaluate(() => {
  const layerText = [...document.querySelectorAll(
    '#spatial-arcgis-layerlist calcite-list-item, #spatial-arcgis-layerlist .esri-layer-list__item, .esri-layer-list__item'
  )].map((el) => el.textContent || '').join('\n');
  const spvmListed = /SPVM.*Recent Crime/i.test(layerText);
  const spvmExplorer = document.querySelector('.spvm-explorer');
  return {
    shell: Boolean(document.querySelector('.spatial-shell')),
    brand: Boolean(document.querySelector('.spatial-brand')),
    layerPanel: Boolean(document.querySelector('#spatial-layer-panel')),
    commandBar: Boolean(document.querySelector('#spatial-command-bar')),
    mapHost: Boolean(document.querySelector('#spatial-map-host')),
    mapCanvas: document.querySelectorAll('#spatial-map-host canvas, #spatial-map-host .esri-view-root').length,
    spvmListed,
    spvmExplorerHidden: !spvmExplorer || spvmExplorer.hidden,
    layerSnippet: layerText.slice(0, 500)
  };
});

console.log(JSON.stringify({ pageErrors, result }, null, 2));
await browser.close();
