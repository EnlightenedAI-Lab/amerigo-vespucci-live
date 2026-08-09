/**
 * Browser acceptance for IQAI Active Workspace + SPVM Intelligence Shell V1.
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
  await page.evaluate(() => {
    document.querySelector('.esri-identity-modal')?.remove();
  });
  try {
    await page.waitForFunction(async () => {
      const mod = await import('/spatial/spvm-recent-crime.js');
      return Boolean(mod.getSpvmLayer?.());
    }, { timeout: 120000 });
  } catch {
    // continue with partial verification
  }
}

async function clickSpvmTab(page, tabId) {
  await page.evaluate((id) => {
    const btn = document.querySelector(`[data-spvm-tab="${id}"]`);
    if (btn) btn.click();
  }, tabId);
  await page.waitForTimeout(400);
}

async function toggleSpvmLayer(page, on) {
  const toggled = await page.evaluate(async (shouldOn) => {
    try {
      const mod = await import('/spatial/spvm-recent-crime.js');
      if (mod.syncSpvmVisibility) {
        mod.syncSpvmVisibility(shouldOn);
        return { ok: true, method: 'syncSpvmVisibility' };
      }
    } catch (error) {
      return { ok: false, error: error?.message || String(error) };
    }
    return { ok: false };
  }, on);

  if (!toggled.ok) {
    const layerList = page.locator('#spatial-arcgis-layerlist');
    await layerList.waitFor({ timeout: 30000 });
    const publicSafety = page.getByText('Public Safety', { exact: false }).first();
    if (await publicSafety.isVisible({ timeout: 5000 }).catch(() => false)) {
      await publicSafety.click();
      await page.waitForTimeout(800);
    }
    const item = page.locator(
      '#spatial-arcgis-layerlist calcite-list-item, .esri-layer-list__item'
    ).filter({ hasText: /SPVM.*Recent Crime/i }).first();
    await item.waitFor({ timeout: 30000 });
    const checkbox = item.locator('calcite-checkbox, input[type="checkbox"]').first();
    const checked = await checkbox.isChecked().catch(() => false);
    if (on && !checked) await checkbox.click();
    if (!on && checked) await checkbox.click();
  }
  await page.waitForTimeout(5000);
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const pageErrors = [];
page.on('pageerror', (err) => pageErrors.push(err.message));

await page.goto(`${BASE}/spatial/`, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForSelector('.spatial-shell', { timeout: 15000 });
await waitAuth(page);

const testA = await page.evaluate(() => {
  const trayTitle = document.querySelector('#spatial-event-tray-title')?.textContent || '';
  const workspace = window.__IQAI_WORKSPACE__?.activeWorkspace
    || (typeof window.getWorkspaceContext === 'function' ? window.getWorkspaceContext()?.activeWorkspace : null);
  return {
    normalTray: trayTitle.includes('EXECUTION LEDGER'),
    noSpvmWorkspace: !document.querySelector('.spvm-workspace:not([hidden])'),
    workspace: workspace || 'NONE'
  };
});

await toggleSpvmLayer(page, true);

await page.evaluate(() => {
  const reopen = document.querySelector('[data-reopen="bottom"]');
  if (reopen && !reopen.hidden) reopen.click();
});
await page.waitForTimeout(1000);

const testB = await page.evaluate(() => {
  const ctx = globalThis.__IQAI_WORKSPACE__?.getWorkspaceContext?.();
  const metrics = document.querySelector('[data-spvm-metrics]')?.textContent || '';
  const tabs = [...document.querySelectorAll('[data-spvm-tab]')].map((el) => el.textContent?.trim());
  const trayTitle = document.querySelector('#spatial-event-tray-title')?.textContent || '';
  const host = document.querySelector('.spvm-explorer-host');
  const hostHeight = host?.clientHeight || 0;
  const trayBody = document.querySelector('.event-tray-body');
  const bodyHeight = trayBody?.clientHeight || 0;
  const fillRatio = bodyHeight > 0 ? hostHeight / bodyHeight : 0;
  return {
    trayTitle,
    metrics,
    tabs,
    hostHeight,
    bodyHeight,
    fillRatio,
    workspaceClass: document.querySelector('.spatial-event-tray')?.classList.contains('is-spvm-workspace'),
    activeWorkspace: ctx?.activeWorkspace || 'NONE'
  };
});

const testC = await page.evaluate(() => {
  const sections = {
    stm: document.querySelector('#spatial-stm-live-section')?.hidden,
    aircraft: document.querySelector('#spatial-aircraft-live-section')?.hidden,
    vessels: document.querySelector('#spatial-vessels-live-section')?.hidden,
    hydro: document.querySelector('#spatial-hydro-outages-section')?.hidden,
    spvm: !document.querySelector('#spatial-spvm-workspace-section')?.hidden
  };
  return sections;
});

// Click first crime on map if popup works
let testD = { selectedCrime: false, hasPlaceholders: false };
try {
  const mapHost = page.locator('#spatial-map-host');
  const box = await mapHost.boundingBox();
  if (box) {
    await page.mouse.click(box.x + box.width * 0.55, box.y + box.height * 0.45);
    await page.waitForTimeout(2000);
    testD = await page.evaluate(() => {
      const html = document.querySelector('#spatial-selected-feature')?.innerHTML || '';
      return {
        selectedCrime: html.includes('SELECTED CRIME'),
        hasPlaceholders: html.includes('LOCAL CONTEXT') && html.includes('RELATED SIGNALS'),
        snippet: html.slice(0, 300)
      };
    });
  }
} catch {
  // optional
}

const tabResults = {};
for (const tab of ['overview', 'time', 'categories', 'records', 'relationships']) {
  await clickSpvmTab(page, tab);
  tabResults[tab] = await page.evaluate((tabId) => {
    const panel = document.querySelector(`[data-tab-panel="${tabId}"]`);
    return {
      visible: panel && !panel.hidden,
      height: panel?.clientHeight || 0,
      hasContent: (panel?.textContent || '').trim().length > 10
    };
  }, tab);
}

const bottomHeightBefore = await page.evaluate(() => {
  const shell = document.querySelector('.spatial-shell');
  const style = shell ? getComputedStyle(shell) : getComputedStyle(document.documentElement);
  return parseInt(style.getPropertyValue('--spatial-bottom-height') || '0', 10);
});

// Resize bottom panel up
const splitter = page.locator('[data-resize="bottom"]');
if (await splitter.count()) {
  const sb = await splitter.boundingBox();
  if (sb) {
    await page.mouse.move(sb.x + sb.width / 2, sb.y + sb.height / 2);
    await page.mouse.down();
    await page.mouse.move(sb.x + sb.width / 2, sb.y - 120, { steps: 10 });
    await page.mouse.up();
    await page.waitForTimeout(500);
  }
}

const testF = await page.evaluate(() => {
  const shell = document.querySelector('.spatial-shell');
  const style = shell ? getComputedStyle(shell) : getComputedStyle(document.documentElement);
  const bottom = parseInt(style.getPropertyValue('--spatial-bottom-height') || '0', 10);
  const workspaceBottom = shell?.classList.contains('is-workspace-bottom');
  const limits = globalThis.__IQAI_WORKSPACE_GEOMETRY__?.computeWorkspaceLimits?.();
  const maxAllowed = workspaceBottom
    ? (limits?.max || Math.round(window.innerHeight * 0.85))
    : Math.round(window.innerHeight * 0.45);
  return {
    bottomHeight: bottom,
    minOk: bottom >= 300,
    maxOk: bottom <= maxAllowed + 20,
    workspaceBottom
  };
});

await toggleSpvmLayer(page, false);
await page.waitForTimeout(3000);

const testG = await page.evaluate(() => ({
  trayTitle: document.querySelector('#spatial-event-tray-title')?.textContent || '',
  spvmHidden: !document.querySelector('.spvm-workspace:not([hidden])'),
  notWorkspaceTray: !document.querySelector('.spatial-event-tray')?.classList.contains('is-spvm-workspace')
}));

// Amenity x-ray
await page.evaluate(() => document.querySelector('.esri-identity-modal')?.remove());
const commandInput = page.locator('#spatial-command-input, .spatial-command-input, textarea').first();
await commandInput.fill('coffee shops within 1 km of downtown montreal');
await page.keyboard.press('Enter');
await page.waitForTimeout(15000);

const testH = await page.evaluate(() => {
  const resultsOpen = document.querySelector('#spatial-results-table-host')?.hidden === false;
  const trayTitle = document.querySelector('#spatial-event-tray-title')?.textContent || '';
  return {
    resultsOpen,
    ledgerTray: trayTitle.includes('EXECUTION') || trayTitle.includes('LEDGER'),
    hasResultsTable: Boolean(document.querySelector('.results-table-panel'))
  };
});

console.log(JSON.stringify({
  pageErrors,
  testA,
  testB,
  testC,
  testD,
  tabResults,
  bottomHeightBefore,
  testF,
  testG,
  testH
}, null, 2));

await browser.close();
