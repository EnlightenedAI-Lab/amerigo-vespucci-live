/**
 * Browser verification for XRAY CATEGORY VISIBILITY CONTROL V1.
 */
import { chromium } from 'playwright';

const BASE = process.env.PREVIEW_BASE || 'http://localhost:3000';
const PROMPT = 'tell me what kinds of amenities are around 997 de la commune within 2km';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

const report = {
  initialAllChecked: false,
  initialStatus: null,
  totalCategories: null,
  hideOne: false,
  hideOneStatus: null,
  pubInLegendAfterHide: false,
  reselectOne: false,
  clearAll: false,
  clearAllStatus: null,
  selectAll: false,
  selectAllStatus: null,
  paginationPersist: false,
  featuresModeScoped: false,
  errors: []
};

async function runCommand(prompt) {
  await page.locator('#spatial-command-input').fill(prompt);
  await page.locator('#spatial-command-run').click({ force: true });
  await page.waitForTimeout(12000);
}

async function openResultsTable() {
  const toggle = page.locator('#spatial-results-table-toggle');
  if (await toggle.isVisible()) {
    const pressed = await toggle.getAttribute('aria-pressed');
    if (pressed !== 'true') await toggle.click({ force: true });
    await page.waitForTimeout(800);
  }
}

async function visibilityStatus() {
  const el = page.locator('.results-table-visibility-status');
  if (!(await el.isVisible().catch(() => false))) return null;
  return (await el.textContent())?.trim() || null;
}

async function selectedCategories() {
  const state = await page.evaluate(() => window.__IQAI_CONVERSATION_STATE__ || null);
  return state?.lastXraySelectedCategories || [];
}

async function allCheckboxesChecked() {
  const inputs = page.locator('.results-table-cat-check');
  const count = await inputs.count();
  if (!count) return false;
  for (let i = 0; i < count; i += 1) {
    if (!(await inputs.nth(i).isChecked())) return false;
  }
  return true;
}

async function legendContains(categoryValue) {
  return page.locator('.operational-legend-label').evaluateAll((nodes, value) => {
    const needle = String(value).replace(/_/g, ' ').toLowerCase();
    return nodes.some((node) => (node.textContent || '').toLowerCase().includes(needle));
  }, categoryValue);
}

async function findCategoryOnPage(categoryValue) {
  const input = page.locator(`.results-table-cat-check[data-category="${categoryValue}"]`);
  if (await input.count() > 0) return input;
  const next = page.locator('.results-table-page-next');
  for (let pageNum = 0; pageNum < 10; pageNum += 1) {
    if (await next.isDisabled()) break;
    await next.click({ force: true });
    await page.waitForTimeout(500);
    if (await input.count() > 0) return input;
  }
  return null;
}

async function goToFirstPage() {
  const prev = page.locator('.results-table-page-prev');
  for (let i = 0; i < 15; i += 1) {
    if (await prev.isDisabled()) return;
    await prev.click({ force: true });
    await page.waitForTimeout(400);
  }
}

try {
  await page.goto(`${BASE}/spatial/`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForSelector('.spatial-shell', { timeout: 15000 });
  const signIn = page.locator('#spatial-sign-in');
  if (await signIn.isVisible({ timeout: 5000 }).catch(() => false)) {
    await signIn.click();
    await page.waitForTimeout(15000);
  }
  await page.waitForTimeout(12000);
  await page.waitForFunction(() => window.__iqaiSpatialV1Diagnostics?.()?.mapViewCreateCount === 1, { timeout: 180000 }).catch(() => {});
  await page.waitForSelector('#spatial-command-run:not([disabled])', { timeout: 120000 }).catch(() => {});

  await runCommand(PROMPT);
  await page.waitForFunction(() => {
    const el = document.querySelector('#spatial-result-counter');
    return el && !el.hidden && /CATEGORIES/.test(el.textContent || '');
  }, { timeout: 90000 }).catch(() => {});
  await openResultsTable();

  const counter = await page.evaluate(() => document.querySelector('#spatial-result-counter')?.textContent?.trim() || '');
  report.totalCategories = Number(counter.match(/(\d+)\s+CATEGORIES/)?.[1] || 0);

  report.initialAllChecked = await allCheckboxesChecked();
  report.initialStatus = await visibilityStatus();

  const pubInput = await findCategoryOnPage('pub');
  if (pubInput) {
    await pubInput.click({ force: true });
    await page.waitForTimeout(4000);
    const selected = await selectedCategories();
    report.hideOne = !selected.includes('pub') && selected.length === report.totalCategories - 1;
    report.hideOneStatus = await visibilityStatus();
    report.pubInLegendAfterHide = await legendContains('pub');

    await pubInput.click({ force: true });
    await page.waitForTimeout(4000);
    const selectedAgain = await selectedCategories();
    report.reselectOne = selectedAgain.includes('pub') && selectedAgain.length === report.totalCategories;
  }

  await page.locator('[data-op="clear"]').click({ force: true });
  await page.waitForTimeout(4000);
  const afterClear = await selectedCategories();
  report.clearAll = afterClear.length === 0 && !(await allCheckboxesChecked());
  report.clearAllStatus = await visibilityStatus();

  await page.locator('[data-op="show_all"]').click({ force: true });
  await page.waitForTimeout(5000);
  const afterSelectAll = await selectedCategories();
  report.selectAll = afterSelectAll.length === report.totalCategories && await allCheckboxesChecked();
  report.selectAllStatus = await visibilityStatus();

  // Pagination: hide a category on page 2+, navigate away, return
  await goToFirstPage();
  const next = page.locator('.results-table-page-next');
  if (!(await next.isDisabled())) {
    await next.click({ force: true });
    await page.waitForTimeout(600);
    const page2Input = page.locator('.results-table-cat-check').first();
    const catValue = await page2Input.getAttribute('data-category');
    if (catValue && await page2Input.isChecked()) {
      await page2Input.click({ force: true });
      await page.waitForTimeout(3000);
      await goToFirstPage();
      await next.click({ force: true });
      await page.waitForTimeout(600);
      const page2InputAgain = page.locator(`.results-table-cat-check[data-category="${catValue}"]`);
      const stillHidden = page2InputAgain.count() > 0 && !(await page2InputAgain.isChecked());
      const selectedAfterNav = await selectedCategories();
      report.paginationPersist = stillHidden && !selectedAfterNav.includes(catValue);
    }
  }

  // FEATURES mode uses visible scope
  await page.locator('[data-op="show_all"]').click({ force: true });
  await page.waitForTimeout(3000);
  const pubAgain = await findCategoryOnPage('pub');
  if (pubAgain) {
    await pubAgain.click({ force: true });
    await page.waitForTimeout(3000);
  }
  await page.locator('[data-op="features"]').click({ force: true });
  await page.waitForTimeout(5000);
  const featureCategories = await page.evaluate(() => {
    const rows = document.querySelectorAll('.results-table-row');
    const cats = new Set();
    rows.forEach((tr) => {
      const cells = tr.querySelectorAll('td');
      cells.forEach((td) => {
        const text = (td.textContent || '').trim();
        if (text === 'pub') cats.add(text);
      });
    });
    return [...cats];
  });
  report.featuresModeScoped = !featureCategories.includes('pub');
} catch (error) {
  report.errors.push(String(error?.message || error));
}

await browser.close();

const pass = Boolean(
  report.initialAllChecked
  && report.initialStatus === `${report.totalCategories} / ${report.totalCategories} visible`
  && report.totalCategories >= 70
  && report.hideOne
  && report.hideOneStatus === `${report.totalCategories - 1} / ${report.totalCategories} visible`
  && !report.pubInLegendAfterHide
  && report.reselectOne
  && report.clearAll
  && report.clearAllStatus === `0 / ${report.totalCategories} visible`
  && report.selectAll
  && report.selectAllStatus === `${report.totalCategories} / ${report.totalCategories} visible`
  && report.paginationPersist
  && report.featuresModeScoped
  && report.errors.length === 0
);

console.log(JSON.stringify({ pass, report }, null, 2));
process.exit(pass ? 0 : 1);
