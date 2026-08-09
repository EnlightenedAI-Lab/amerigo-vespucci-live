import { chromium } from 'playwright';

const BASE = process.env.PREVIEW_BASE || 'http://localhost:3000';
const RELOADS = 2;

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

const consoleErrors = [];
const networkFailures = [];
page.on('console', (msg) => {
  if (msg.type() === 'error') consoleErrors.push(msg.text());
});
page.on('pageerror', (err) => consoleErrors.push(err.message));
page.on('response', (res) => {
  const url = res.url();
  if (res.status() >= 400 && /arcgis|oauth|spatial\/operational-map/i.test(url)) {
    networkFailures.push(`${res.status()} ${url}`);
  }
});

async function measureLayout() {
  return page.evaluate(() => {
    const left = document.querySelector('.spatial-sidebar-left');
    const center = document.querySelector('.spatial-center');
    const right = document.querySelector('.spatial-sidebar-right');
    const tray = document.querySelector('.spatial-event-tray');
    const map = document.querySelector('#spatial-map-host');
    const lb = left?.getBoundingClientRect();
    const cb = center?.getBoundingClientRect();
    const rb = right?.getBoundingClientRect();
    const tb = tray?.getBoundingClientRect();
    const mb = map?.getBoundingClientRect();
    const threeColumn = lb && cb && rb
      && lb.right <= cb.left + 2
      && cb.right <= rb.left + 2
      && lb.width >= 150 && rb.width >= 240
      && cb.width > lb.width && cb.width > rb.width;
    const trayBottom = tb && tray && tray.getBoundingClientRect().top >= (cb?.bottom || 0) - 4;
    const mapDominant = mb && cb && mb.height > 200 && mb.width > 400;
    return {
      threeColumn,
      trayBottom,
      mapDominant,
      leftWidth: lb?.width ?? 0,
      centerWidth: cb?.width ?? 0,
      rightWidth: rb?.width ?? 0,
      mapHeight: mb?.height ?? 0
    };
  });
}

async function loadAndAuth() {
  await page.goto(`${BASE}/spatial/`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForSelector('.spatial-shell', { timeout: 15000 });
  const signIn = page.locator('#spatial-sign-in');
  if (await signIn.isVisible({ timeout: 5000 }).catch(() => false)) {
    await signIn.click();
    await page.waitForTimeout(15000);
  }
  await page.waitForTimeout(12000);
}

const runs = [];
await loadAndAuth();
runs.push({
  load: 1,
  layout: await measureLayout(),
  mapVisible: await page.locator('#spatial-map-host .esri-view-root, #spatial-map-host canvas').count() > 0,
  diagnostics: await page.evaluate(() => window.__iqaiSpatialV1Diagnostics?.() || null),
  status: await page.locator('[data-field="Status"]').textContent(),
  error: await page.locator('#spatial-detail-error').textContent().catch(() => ''),
  oauthConfig: await fetch(`${BASE}/api/spatial/operational-map/oauth-config`).then((r) => r.json())
});

for (let i = 0; i < RELOADS; i += 1) {
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.spatial-shell', { timeout: 15000 });
  if (await page.locator('#spatial-sign-in').isVisible({ timeout: 3000 }).catch(() => false)) {
    await page.locator('#spatial-sign-in').click();
    await page.waitForTimeout(12000);
  }
  await page.waitForTimeout(10000);
  runs.push({
    load: i + 2,
    layout: await measureLayout(),
    mapVisible: await page.locator('#spatial-map-host .esri-view-root, #spatial-map-host canvas').count() > 0,
    diagnostics: await page.evaluate(() => window.__iqaiSpatialV1Diagnostics?.() || null),
    status: await page.locator('[data-field="Status"]').textContent(),
    error: await page.locator('#spatial-detail-error').textContent().catch(() => '')
  });
}

const result = {
  base: BASE,
  runs,
  consoleErrors: consoleErrors.filter((e) => !/favicon/i.test(e)),
  networkFailures
};

console.log(JSON.stringify(result, null, 2));
await browser.close();

const last = runs[runs.length - 1];
const layoutOk = runs.every((r) => r.layout?.threeColumn && r.layout?.mapDominant && r.layout?.trayBottom);
const arcgisOk = runs.every((r) => r.mapVisible && r.diagnostics?.mapViewCreateCount === 1 && r.diagnostics?.mapContainers === 1);
const noError = runs.every((r) => !String(r.error || '').trim() || r.mapVisible);

if (!layoutOk || !arcgisOk || !noError) {
  console.error('Spatial V1 shell foundation verification FAILED');
  process.exit(1);
}
