import { chromium } from 'playwright';

const BASE = process.env.PREVIEW_BASE || 'http://localhost:3000';
const PROMPT = 'Map fire stations within 3 km of 6939 Décarie Boulevard.';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

const consoleErrors = [];
page.on('console', (msg) => {
  if (msg.type() === 'error') consoleErrors.push(msg.text());
});
page.on('pageerror', (err) => consoleErrors.push(err.message));

await page.goto(`${BASE}/spatial/`, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForSelector('.spatial-shell', { timeout: 15000 });

const signIn = page.locator('#spatial-sign-in');
if (await signIn.isVisible({ timeout: 5000 }).catch(() => false)) {
  await signIn.click();
  await page.waitForTimeout(18000);
}
await page.waitForTimeout(8000);

await page.evaluate(() => {
  document.querySelector('.esri-identity-modal')?.remove();
});

const domStructure = await page.evaluate(() => ({
  splitters: document.querySelectorAll('[data-resize]').length,
  collapseButtons: document.querySelectorAll('[data-collapse]').length,
  reopenButtons: document.querySelectorAll('[data-reopen]').length,
  selectedHeading: document.querySelector('#spatial-selected-section .detail-section-heading')?.textContent?.trim(),
  queryHeading: document.querySelector('#spatial-query-section .detail-section-heading')?.textContent?.trim(),
  iqaiFieldCount: document.querySelectorAll('.detail-grid-iqai [data-field]').length
}));

// Use PanelLayout drag API for splitter resize tests
const resizePanels = await page.evaluate(() => {
  const shell = document.querySelector('.spatial-shell');
  const mapHostsBefore = document.querySelectorAll('[data-spatial-map-host]').length;
  shell.style.setProperty('--spatial-left-width', '240px');
  shell.style.setProperty('--spatial-right-width', '360px');
  shell.style.setProperty('--spatial-bottom-height', '180px');
  const left = getComputedStyle(shell).getPropertyValue('--spatial-left-width').trim();
  const right = getComputedStyle(shell).getPropertyValue('--spatial-right-width').trim();
  const bottom = getComputedStyle(shell).getPropertyValue('--spatial-bottom-height').trim();
  const mapHostsAfter = document.querySelectorAll('[data-spatial-map-host]').length;
  const leftRect = document.querySelector('.spatial-sidebar-left')?.getBoundingClientRect().width ?? 0;
  const rightRect = document.querySelector('.spatial-sidebar-right')?.getBoundingClientRect().width ?? 0;
  return {
    left,
    right,
    bottom,
    leftRect,
    rightRect,
    mapHostsBefore,
    mapHostsAfter,
    pass: left === '240px' && right === '360px' && bottom === '180px' && mapHostsBefore === 1 && mapHostsAfter === 1
      && leftRect >= 230 && rightRect >= 350
  };
});

async function collapseCycle(panel) {
  const collapseSelector = panel === 'left'
    ? '#spatial-layer-panel [data-collapse="left"]'
    : panel === 'right'
      ? '#spatial-detail-panel [data-collapse="right"]'
      : '#spatial-event-tray [data-collapse="bottom"]';
  const reopenSelector = `[data-reopen="${panel}"]`;
  await page.locator(collapseSelector).click();
  await page.waitForTimeout(250);
  const collapsed = await page.evaluate((p) => {
    const shell = document.querySelector('.spatial-shell');
    if (p === 'left') return shell.classList.contains('is-left-collapsed');
    if (p === 'right') return shell.classList.contains('is-right-collapsed');
    return shell.classList.contains('is-bottom-collapsed');
  }, panel);
  await page.locator(reopenSelector).click();
  await page.waitForTimeout(250);
  const reopened = await page.evaluate((p) => {
    const shell = document.querySelector('.spatial-shell');
    if (p === 'left') return !shell.classList.contains('is-left-collapsed');
    if (p === 'right') return !shell.classList.contains('is-right-collapsed');
    return !shell.classList.contains('is-bottom-collapsed');
  }, panel);
  return { collapsed, reopened };
}

const splitterDrag = await page.evaluate(() => {
  const leftBefore = document.querySelector('.spatial-sidebar-left')?.getBoundingClientRect().width ?? 0;
  const splitter = document.querySelector('[data-resize="left"]');
  if (!splitter) return { pass: false, reason: 'no splitter' };
  const rect = splitter.getBoundingClientRect();
  splitter.dispatchEvent(new PointerEvent('pointerdown', {
    clientX: rect.left + 2,
    clientY: rect.top + 2,
    bubbles: true,
    pointerId: 1,
    pointerType: 'mouse',
    isPrimary: true
  }));
  window.dispatchEvent(new PointerEvent('pointermove', {
    clientX: rect.left + 50,
    clientY: rect.top + 2,
    bubbles: true,
    pointerId: 1,
    pointerType: 'mouse',
    isPrimary: true
  }));
  window.dispatchEvent(new PointerEvent('pointerup', {
    bubbles: true,
    pointerId: 1,
    pointerType: 'mouse',
    isPrimary: true
  }));
  const leftAfter = document.querySelector('.spatial-sidebar-left')?.getBoundingClientRect().width ?? 0;
  return {
    leftBefore,
    leftAfter,
    pass: leftAfter > leftBefore + 15,
    mapHosts: document.querySelectorAll('[data-spatial-map-host]').length
  };
});
const collapseRight = await collapseCycle('right');
const collapseLeft = await collapseCycle('left');
const collapseBottom = await collapseCycle('bottom');

const mapOperational = await page.evaluate(() => {
  const map = document.querySelector('#spatial-map-host .esri-view-root, #spatial-map-host canvas');
  return !!map;
});

let fireQuery = {
  ran: false,
  stationCount: 0,
  has79: false,
  stations: [],
  currentQueryPass: false,
  iqaiPass: false,
  selectedFeaturePass: false,
  mapViewCount: 0,
  xaiCalls: 0
};

if (mapOperational) {
  await page.fill('#spatial-command-input', PROMPT);
  await page.click('#spatial-command-run');
  await page.waitForTimeout(12000);

  fireQuery = await page.evaluate(() => {
    const status = document.querySelector('[data-field="Status"]')?.textContent?.trim();
    const execution = document.querySelector('[data-field="Execution"]')?.textContent?.trim();
    const source = document.querySelector('[data-field="Source"]')?.textContent?.trim();
    const spatialOp = document.querySelector('[data-field="Spatial operation"]')?.textContent?.trim();
    const resultCount = document.querySelector('[data-field="Result count"]')?.textContent?.trim();
    const model = document.querySelector('[data-field="Model"]')?.textContent?.trim();
    const aiCost = document.querySelector('[data-field="AI Cost"]')?.textContent?.trim();
    const prompt = document.querySelector('#spatial-current-query .detail-item-value')?.textContent?.trim();
    const radius = Array.from(document.querySelectorAll('#spatial-current-query .detail-item-value')).map((el) => el.textContent?.trim());
    const diagnostics = window.__iqaiSpatialV1Diagnostics?.() || {};
    const layerTitles = Array.from(document.querySelectorAll('#spatial-arcgis-layerlist calcite-list-item, #spatial-arcgis-layerlist .esri-layer-list__item'))
      .map((el) => el.textContent?.trim()).filter(Boolean);
    const runtimeLayer = layerTitles.some((t) => /IQAI.*Fire Stations/i.test(t));
    const stationGraphics = document.querySelectorAll('#spatial-map-host .esri-view-surface').length;

    return {
      ran: true,
      status,
      execution,
      source,
      spatialOp,
      resultCount,
      model,
      aiCost,
      promptText: prompt,
      radiusValues: radius,
      currentQueryPass: prompt?.includes('6939') && radius.some((v) => v === '3 km') && resultCount === '5',
      iqaiPass: status === 'Controlled' && execution === 'Deterministic GIS' && source === 'Ville de Montréal'
        && spatialOp === 'Within 3 km' && model === 'None' && aiCost === '$0.00' && resultCount === '5',
      mapViewCount: diagnostics.mapViewCreateCount ?? 0,
      mapContainers: diagnostics.mapContainers ?? 0,
      runtimeLayer,
      stationGraphics,
      selectedMuted: document.querySelector('#spatial-selected-feature .detail-muted')?.textContent?.trim()
    };
  });

  const mapResult = await page.evaluate(async (p) => {
    const res = await fetch('/api/spatial/map', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: p })
    });
    return res.json();
  }, PROMPT);

  fireQuery.stations = mapResult.features?.map((f) => f.stationNumber) || [];
  fireQuery.stationCount = mapResult.summary?.matchedFeatures ?? 0;
  fireQuery.has79 = fireQuery.stations.includes('79');
  fireQuery.summary = mapResult.summary;

  if (fireQuery.runtimeLayer) {
    await page.click('#spatial-map-host', { position: { x: 720, y: 400 } });
    await page.waitForTimeout(1500);
    const selected = await page.evaluate(() => {
      const items = Array.from(document.querySelectorAll('#spatial-selected-feature .detail-item-label')).map((el, i) => ({
        label: el.textContent?.trim(),
        value: el.parentElement?.querySelector('.detail-item-value')?.textContent?.trim()
      }));
      return items;
    });
    fireQuery.selectedItems = selected;
    fireQuery.selectedFeaturePass = selected.some((i) => i.label === 'Station' && i.value?.startsWith('Station '))
      && selected.some((i) => i.label === 'Operational status' && i.value === 'Active');
  }
}

const result = {
  domStructure,
  resizePanels,
  splitterDrag,
  collapseLeft,
  collapseRight,
  collapseBottom,
  mapOperational,
  fireQuery,
  consoleErrors: consoleErrors.filter((e) => !/favicon/i.test(e))
};

console.log(JSON.stringify(result, null, 2));
await browser.close();
