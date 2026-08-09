/**
 * Browser acceptance for SPVM workspace resize + maximize V1.
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
  await page.waitForTimeout(5000);
  await page.evaluate(() => {
    const reopen = document.querySelector('[data-reopen="bottom"]');
    if (reopen && !reopen.hidden) reopen.click();
  });
  await page.waitForTimeout(1000);
}

async function readState(page) {
  return page.evaluate(() => {
    const shell = document.querySelector('.spatial-shell');
    const geo = globalThis.__IQAI_WORKSPACE_GEOMETRY__?.getWorkspaceGeometry?.();
    const limits = globalThis.__IQAI_WORKSPACE_GEOMETRY__?.computeWorkspaceLimits?.();
    const shellStyle = shell ? getComputedStyle(shell) : getComputedStyle(document.documentElement);
    const bottom = parseInt(shellStyle.getPropertyValue('--spatial-bottom-height') || '0', 10);
    const tray = document.querySelector('.spatial-event-tray');
    const host = document.querySelector('.spvm-explorer-host');
    const body = document.querySelector('.spvm-workspace-body');
    const recordsScroll = document.querySelector('.spvm-records-host .results-table-scroll');
    const mapViewCount = window.__iqaiSpatialV1Diagnostics?.()?.mapViewCreateCount;
    return {
      bottom,
      geoMode: geo?.mode,
      limits,
      maximized: shell?.classList.contains('is-workspace-maximized'),
      collapsed: shell?.classList.contains('is-workspace-collapsed'),
      workspaceBottom: shell?.classList.contains('is-workspace-bottom'),
      trayHeight: tray?.clientHeight || 0,
      hostHeight: host?.clientHeight || 0,
      bodyHeight: body?.clientHeight || 0,
      bodyHidden: body?.hidden,
      recordsScrollHeight: recordsScroll?.clientHeight || 0,
      mapViewCreateCount: mapViewCount,
      innerHeight: window.innerHeight
    };
  });
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const pageErrors = [];
page.on('pageerror', (err) => pageErrors.push(err.message));

await page.goto(`${BASE}/spatial/`, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForSelector('.spatial-shell', { timeout: 15000 });
await waitAuth(page);

const mapViewBefore = await page.evaluate(() => window.__iqaiSpatialV1Diagnostics?.()?.mapViewCreateCount);

await activateSpvm(page);
const initial = await readState(page);

// TEST A — drag up
const splitter = page.locator('[data-resize="bottom"]');
const sb = await splitter.boundingBox();
if (sb) {
  await page.mouse.move(sb.x + sb.width / 2, sb.y + sb.height / 2);
  await page.mouse.down();
  await page.mouse.move(sb.x + sb.width / 2, sb.y - 280, { steps: 15 });
  await page.mouse.up();
  await page.waitForTimeout(600);
}
const draggedUp = await readState(page);
const testA = {
  bottom: draggedUp.bottom,
  maxLimit: draggedUp.limits?.max,
  pctOfInner: draggedUp.bottom / draggedUp.innerHeight,
  pass: draggedUp.bottom >= 500 && draggedUp.bottom >= (draggedUp.limits?.max || 0) * 0.75
};

// TEST B — drag down
if (sb) {
  await page.mouse.move(sb.x + sb.width / 2, sb.y - 280);
  await page.mouse.down();
  await page.mouse.move(sb.x + sb.width / 2, sb.y + 120, { steps: 15 });
  await page.mouse.up();
  await page.waitForTimeout(600);
}
const draggedDown = await readState(page);
const testB = {
  bottom: draggedDown.bottom,
  pass: draggedDown.bottom >= 180 && draggedDown.bottom <= 320
};

const heightBeforeMax = draggedDown.bottom;

// TEST C — maximize
await page.evaluate(() => {
  document.querySelector('[data-workspace-action="toggle-maximize"]')?.click();
});
await page.waitForTimeout(800);
const maximized = await readState(page);
const testC = {
  maximized: maximized.maximized,
  trayHeight: maximized.trayHeight,
  bodyHeight: maximized.bodyHeight,
  pass: maximized.maximized && maximized.trayHeight > maximized.innerHeight * 0.7
};

// TEST D — restore
await page.evaluate(() => {
  document.querySelector('[data-workspace-action="toggle-maximize"]')?.click();
});
await page.waitForTimeout(800);
const restored = await readState(page);
const testD = {
  bottom: restored.bottom,
  beforeMax: heightBeforeMax,
  delta: Math.abs(restored.bottom - heightBeforeMax),
  pass: !restored.maximized && Math.abs(restored.bottom - heightBeforeMax) <= 40
};

// TEST E — collapse
await page.evaluate(() => {
  document.querySelector('[data-workspace-action="collapse"]')?.click();
});
await page.waitForTimeout(600);
const collapsed = await readState(page);
const testE = {
  collapsed: collapsed.collapsed,
  bodyHidden: collapsed.bodyHidden,
  trayHeight: collapsed.trayHeight,
  pass: collapsed.collapsed && collapsed.bodyHidden && collapsed.trayHeight < 80
};

// TEST F — expand
await page.evaluate(() => {
  document.querySelector('[data-workspace-action="expand"]')?.click();
});
await page.waitForTimeout(600);
const expanded = await readState(page);
const testF = {
  bottom: expanded.bottom,
  pass: !expanded.collapsed && expanded.bottom >= 180
};

// TEST G — records full height
await page.evaluate(() => {
  document.querySelector('[data-spvm-tab="records"]')?.click();
  document.querySelector('[data-workspace-action="toggle-maximize"]')?.click();
});
await page.waitForTimeout(800);
const recordsMax = await readState(page);
const testG = {
  recordsScrollHeight: recordsMax.recordsScrollHeight,
  bodyHeight: recordsMax.bodyHeight,
  pass: recordsMax.recordsScrollHeight > 200
};

// TEST H — map preserved
const mapViewAfter = await page.evaluate(() => window.__iqaiSpatialV1Diagnostics?.()?.mapViewCreateCount);
const testH = {
  mapViewBefore,
  mapViewAfter,
  skipped: !mapViewBefore && !mapViewAfter,
  pass: (!mapViewBefore && !mapViewAfter)
    || (mapViewBefore === mapViewAfter && mapViewAfter === 1)
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
  testH
}, null, 2));

await browser.close();
