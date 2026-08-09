/**
 * Browser acceptance for SPVM workspace data sync + tab isolation V1.
 */
import { chromium } from 'playwright';

const BASE = process.env.PREVIEW_BASE || 'http://localhost:3000';

async function waitAuth(page) {
  const signIn = page.locator('#spatial-sign-in');
  if (await signIn.isVisible({ timeout: 5000 }).catch(() => false)) {
    await signIn.click();
    await page.waitForTimeout(15000);
  }
  await page.waitForTimeout(15000);
  await page.evaluate(() => document.querySelector('.esri-identity-modal')?.remove());
  try {
    await page.waitForFunction(async () => {
      const mod = await import('/spatial/spvm-recent-crime.js');
      return Boolean(mod.getSpvmLayer?.());
    }, { timeout: 120000 });
  } catch {
    // partial
  }
}

async function activateSpvm(page) {
  await page.evaluate(async () => {
    const mod = await import('/spatial/spvm-recent-crime.js');
    if (mod.syncSpvmVisibility) mod.syncSpvmVisibility(true);
  });
  await page.waitForTimeout(3000);
  await page.evaluate(() => {
    const reopen = document.querySelector('[data-reopen="bottom"]');
    if (reopen && !reopen.hidden) reopen.click();
  });
  await page.waitForFunction(async () => {
    const explorer = await import('/spatial/spvm-crime-explorer.js');
    const count = explorer.getSpvmSourceFeatureCount?.() || 0;
    const status = explorer.getSpvmDataStatus?.() || 'IDLE';
    return count > 0 && status === 'READY_WITH_DATA';
  }, { timeout: 120000 });
  await page.waitForTimeout(1000);
}

async function clickTab(page, tabId) {
  await page.evaluate((id) => {
    document.querySelector(`[data-spvm-tab="${id}"]`)?.click();
  }, tabId);
  await page.waitForTimeout(500);
}

async function readWorkspace(page) {
  return page.evaluate(async () => {
    const explorer = await import('/spatial/spvm-crime-explorer.js');
    const metrics = document.querySelector('[data-spvm-metrics]')?.textContent?.trim() || '';
    const panels = [...document.querySelectorAll('[data-tab-panel]')].map((panel) => ({
      id: panel.dataset.tabPanel,
      hidden: panel.hidden,
      height: panel.clientHeight,
      textLen: (panel.textContent || '').trim().length
    }));
    const visiblePanels = panels.filter((p) => !p.hidden);
    const state = explorer.getSpvmFilterState?.();
    const analytics = explorer.getAnalytics?.();
    return {
      metrics,
      panels,
      visiblePanelCount: visiblePanels.length,
      visiblePanelIds: visiblePanels.map((p) => p.id),
      sourceCount: explorer.getSpvmSourceFeatureCount?.() || 0,
      dataStatus: explorer.getSpvmDataStatus?.() || 'IDLE',
      windowDays: state?.windowDays,
      filteredTotal: analytics?.total ?? 0,
      categoryRowsWithCount: (analytics?.categoryRows || []).filter((r) => r.count > 0).length,
      timelineDays: (analytics?.timelineRows || []).filter((r) => r.count > 0).length,
      recordsRows: document.querySelectorAll('.spvm-records-host .results-table tbody tr').length,
      overviewText: document.querySelector('[data-tab-panel="overview"]')?.textContent?.slice(0, 200) || '',
      timeText: document.querySelector('[data-tab-panel="time"]')?.textContent?.slice(0, 200) || '',
      categoriesText: document.querySelector('[data-tab-panel="categories"]')?.textContent?.slice(0, 200) || '',
      recordsText: document.querySelector('[data-tab-panel="records"]')?.textContent?.slice(0, 200) || '',
      relationshipsText: document.querySelector('[data-tab-panel="relationships"]')?.textContent?.slice(0, 200) || ''
    };
  });
}

async function setWindowDays(page, days) {
  await page.evaluate((d) => {
    document.querySelector(`[data-window="${d}"]`)?.click();
  }, days);
  await page.waitForTimeout(800);
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const pageErrors = [];
page.on('pageerror', (err) => pageErrors.push(err.message));

await page.goto(`${BASE}/spatial/`, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForSelector('.spatial-shell', { timeout: 15000 });
await waitAuth(page);
await activateSpvm(page);

const initial = await readWorkspace(page);
const testA = {
  sourceCount: initial.sourceCount,
  filtered30D: initial.windowDays === 30 ? initial.filteredTotal : null,
  metrics: initial.metrics,
  pass: initial.sourceCount > 1000
    && initial.filteredTotal > 500
    && !/0 REPORTS/.test(initial.metrics)
};

await clickTab(page, 'overview');
const overview = await readWorkspace(page);
const testB = {
  visiblePanelIds: overview.visiblePanelIds,
  mappedCount: overview.filteredTotal,
  pass: overview.visiblePanelCount === 1
    && overview.visiblePanelIds[0] === 'overview'
    && overview.filteredTotal > 500
};

await clickTab(page, 'time');
const time = await readWorkspace(page);
const testC = {
  visiblePanelIds: time.visiblePanelIds,
  timelineDays: time.timelineDays,
  pass: time.visiblePanelCount === 1
    && time.visiblePanelIds[0] === 'time'
    && time.timelineDays > 0
};

await clickTab(page, 'categories');
const categories = await readWorkspace(page);
const testD = {
  visiblePanelIds: categories.visiblePanelIds,
  categoryRowsWithCount: categories.categoryRowsWithCount,
  pass: categories.visiblePanelCount === 1
    && categories.visiblePanelIds[0] === 'categories'
    && categories.categoryRowsWithCount > 0
};

await clickTab(page, 'records');
const records = await readWorkspace(page);
const testE = {
  visiblePanelIds: records.visiblePanelIds,
  recordsRows: records.recordsRows,
  pass: records.visiblePanelCount === 1
    && records.visiblePanelIds[0] === 'records'
    && records.recordsRows > 50
};

await clickTab(page, 'relationships');
const relationships = await readWorkspace(page);
const testF = {
  visiblePanelIds: relationships.visiblePanelIds,
  pass: relationships.visiblePanelCount === 1
    && relationships.visiblePanelIds[0] === 'relationships'
    && /coming in next phase/i.test(relationships.relationshipsText)
};

await setWindowDays(page, 7);
const day7 = await readWorkspace(page);
await setWindowDays(page, 90);
const day90 = await readWorkspace(page);
const testG = {
  count7D: day7.filteredTotal,
  count90D: day90.filteredTotal,
  pass: day7.filteredTotal > 0
    && day90.filteredTotal > day7.filteredTotal
    && day90.filteredTotal > initial.filteredTotal
};

await clickTab(page, 'overview');
await page.evaluate(() => {
  document.querySelector('[data-workspace-action="toggle-maximize"]')?.click();
});
await page.waitForTimeout(800);
const maximized = await readWorkspace(page);
await page.evaluate(() => {
  document.querySelector('[data-workspace-action="toggle-maximize"]')?.click();
});
await page.waitForTimeout(800);
const restored = await readWorkspace(page);

const testH = {
  maxTotal: maximized.filteredTotal,
  restoredTotal: restored.filteredTotal,
  pass: maximized.filteredTotal > 500 && restored.filteredTotal === maximized.filteredTotal
};

const counts = {
  '30D': initial.filteredTotal,
  '7D': day7.filteredTotal,
  '90D': day90.filteredTotal
};

console.log(JSON.stringify({
  pageErrors,
  initial,
  testA,
  testB,
  testC,
  testD,
  testE,
  testF,
  testG,
  testH,
  counts,
  tabIsolation: [testB, testC, testD, testE, testF].every((t) => t.pass),
  filterSync: testG.pass,
  loadingStates: !/0 REPORTS/.test(initial.metrics) || initial.dataStatus === 'LOADING',
  overallPass: [testA, testB, testC, testD, testE, testF, testG, testH].every((t) => t.pass)
}, null, 2));

await browser.close();
