/**
 * Browser verification for SPATIAL XRAY OPERATIONAL SELECTION V1.
 */
import { chromium } from 'playwright';

const BASE = process.env.PREVIEW_BASE || 'http://localhost:3000';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

const report = {
  xrayCategories: null,
  represented: null,
  checkboxes: false,
  chargingSelected: false,
  pharmacySelected: false,
  bothSelected: false,
  featuresMode: false,
  featuresRows: 0,
  chargingRemoved: false,
  clearWorked: false,
  errors: []
};

async function runCommand(prompt) {
  await page.locator('#spatial-command-input').fill(prompt);
  await page.locator('#spatial-command-run').click({ force: true });
  await page.waitForTimeout(10000);
}

async function openResultsTable() {
  const toggle = page.locator('#spatial-results-table-toggle');
  if (await toggle.isVisible()) {
    const pressed = await toggle.getAttribute('aria-pressed');
    if (pressed !== 'true') await toggle.click({ force: true });
    await page.waitForTimeout(500);
  }
}

async function categoryCheckboxCount() {
  return page.locator('.results-table-cat-check').count();
}

async function toggleCategory(categoryValue) {
  const input = page.locator(`.results-table-cat-check[data-category="${categoryValue}"]`);
  if (await input.count() === 0) return false;
  await input.click({ force: true });
  await page.waitForTimeout(3000);
  return true;
}

async function conversationState() {
  return page.evaluate(() => window.__IQAI_CONVERSATION_STATE__ || null);
}

async function selectedCategories() {
  const state = await conversationState();
  return state?.lastXraySelectedCategories || [];
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

  await runCommand('What amenities exist within 3 km of 997 de la Commune?');
  await page.waitForFunction(() => {
    const el = document.querySelector('#spatial-result-counter');
    return el && !el.hidden && /CATEGORIES/.test(el.textContent || '');
  }, { timeout: 60000 }).catch(() => {});
  await openResultsTable();

  const counter = await page.evaluate(() => {
    const el = document.querySelector('#spatial-result-counter');
    return el?.textContent?.trim() || '';
  });
  report.xrayCategories = counter.match(/(\d+)\s+CATEGORIES/)?.[1];
  report.represented = counter.match(/(\d+)\s+REPRESENTED/)?.[1];

  const checkboxCount = await categoryCheckboxCount();
  report.checkboxes = checkboxCount > 0;

  if (await toggleCategory('charging_station')) {
    const selected = await selectedCategories();
    report.chargingSelected = selected.includes('charging_station');
  }

  if (await toggleCategory('pharmacy')) {
    const selected = await selectedCategories();
    report.pharmacySelected = selected.includes('pharmacy');
    report.bothSelected = selected.includes('charging_station') && selected.includes('pharmacy');
  }

  await page.locator('[data-op="features"]').click({ force: true });
  await page.waitForTimeout(4000);
  report.featuresMode = await page.locator('.results-table-op-btn[data-op="features"].is-active').count() > 0;
  report.featuresRows = await page.locator('.results-table-row').count();

  await page.locator('[data-op="categories"]').click({ force: true });
  await page.waitForTimeout(1000);

  const chargingInput = page.locator('.results-table-cat-check[data-category="charging_station"]');
  if (await chargingInput.count() > 0 && await chargingInput.isChecked()) {
    await chargingInput.click({ force: true });
    await page.waitForTimeout(3000);
  }
  const selectedAfterUncheck = await selectedCategories();
  report.chargingRemoved = !selectedAfterUncheck.includes('charging_station')
    && selectedAfterUncheck.includes('pharmacy');

  await page.locator('[data-op="clear"]').click({ force: true });
  await page.waitForTimeout(3000);
  const selectedAfterClear = await selectedCategories();
  report.clearWorked = selectedAfterClear.length === 0;
  report.categoriesAfterClear = await categoryCheckboxCount();
} catch (error) {
  report.errors.push(String(error?.message || error));
}

await browser.close();

const pass = Boolean(
  Number(report.xrayCategories) >= 90
  && Number(report.represented) >= 6000
  && report.checkboxes
  && report.chargingSelected
  && report.bothSelected
  && report.featuresMode
  && report.featuresRows > 0
  && report.chargingRemoved
  && report.clearWorked
  && report.categoriesAfterClear > 0
  && report.errors.length === 0
);

console.log(JSON.stringify({ pass, report }, null, 2));
process.exit(pass ? 0 : 1);
