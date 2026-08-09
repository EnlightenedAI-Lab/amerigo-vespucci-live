/**
 * Real-browser SPVM pipeline diagnostic — authenticated session required.
 */
import { chromium } from 'playwright';

const BASE = process.env.PREVIEW_BASE || 'http://localhost:3000';

async function waitAuth(page) {
  const signIn = page.locator('#spatial-sign-in');
  if (await signIn.isVisible({ timeout: 5000 }).catch(() => false)) {
    await signIn.click();
    await page.waitForTimeout(20000);
  }
  await page.waitForTimeout(15000);
  await page.evaluate(() => document.querySelector('.esri-identity-modal')?.remove());
  try {
    await page.waitForFunction(async () => {
      const mod = await import('/spatial/spvm-recent-crime.js');
      return Boolean(mod.getSpvmLayer?.());
    }, { timeout: 120000 });
  } catch {
    // continue
  }
}

async function turnSpvmOn(page) {
  await page.evaluate(async () => {
    const mod = await import('/spatial/spvm-recent-crime.js');
    mod.syncSpvmVisibility?.(true);
  });
  await page.waitForTimeout(5000);
  await page.evaluate(() => {
    document.querySelector('[data-reopen="bottom"]')?.click();
  });
  await page.waitForTimeout(3000);
}

async function runDiagnostic(page) {
  return page.evaluate(async () => {
    const { getSpvmLayer } = await import('/spatial/spvm-recent-crime.js');
    const filterMod = await import('/spatial/spvm-crime-filter.js');
    const taxMod = await import('/spatial/spvm-crime-taxonomy.js');
    const explorerMod = await import('/spatial/spvm-crime-explorer.js');
    const { getMapView } = await import('/spatial/spatial-arcgis-runtime.js');

    const layer = getSpvmLayer();
    const view = getMapView();
    const state = filterMod.createDefaultSpvmFilterState();
    const defaultExpr = filterMod.buildSpvmDefinitionExpression(state);

    const out = {
      layerRegistered: Boolean(layer),
      layerVisible: layer?.visible ?? false,
      layerLoaded: layer?.loaded ?? false,
      sourceUrl: layer?.url || null,
      layerFields: [],
      sampleAttributes: null,
      dateFieldType: null,
      defaultDefinitionExpression: defaultExpr,
      queryAllCount: null,
      queryDefExprCount: null,
      explorerAllGraphics: explorerMod.getSpvmSourceFeatureCount?.() || 0,
      analytics30D: null,
      analytics7D: null,
      analytics90D: null,
      layerViewExists: false,
      layerViewSuspended: null,
      layerViewUpdating: null,
      parentVisible: null,
      opacity: layer?.opacity,
      minScale: layer?.minScale,
      maxScale: layer?.maxScale,
      featureReductionType: layer?.featureReduction?.type || null,
      bypass1to1Visible: null,
      bypass1to1QueryCount: null,
      recordsTableRows: document.querySelectorAll('.spvm-records-host .results-table tbody tr').length,
      workspaceMetrics: document.querySelector('[data-spvm-metrics]')?.textContent?.trim() || '',
      dataStatus: explorerMod.getSpvmDataStatus?.() || 'UNKNOWN',
      errors: []
    };

    if (!layer) return out;

    try {
      if (!layer.loaded) await layer.load();
      out.layerLoaded = layer.loaded;
      out.layerFields = (layer.fields || []).map((f) => ({
        name: f.name,
        type: f.type,
        alias: f.alias
      }));
      out.dateFieldType = layer.fields?.find((f) => f.name === 'date')?.type || null;

      const qAll = layer.createQuery();
      qAll.where = '1=1';
      qAll.outFields = ['*'];
      qAll.returnGeometry = false;
      const savedExpr = layer.definitionExpression;
      layer.definitionExpression = null;
      const allResult = await layer.queryFeatures(qAll);
      out.queryAllCount = allResult.features?.length ?? 0;
      if (allResult.features?.[0]?.attributes) {
        out.sampleAttributes = { ...allResult.features[0].attributes };
      }

      layer.definitionExpression = defaultExpr;
      const qDef = layer.createQuery();
      qDef.where = '1=1';
      qDef.outFields = ['*'];
      qDef.returnGeometry = false;
      const defResult = await layer.queryFeatures(qDef);
      out.queryDefExprCount = defResult.features?.length ?? 0;

      const jsState30 = filterMod.createDefaultSpvmFilterState();
      jsState30.windowDays = 30;
      const jsState7 = filterMod.createDefaultSpvmFilterState();
      jsState7.windowDays = 7;
      const jsState90 = filterMod.createDefaultSpvmFilterState();
      jsState90.windowDays = 90;
      const graphics = allResult.features || [];
      out.analytics30D = filterMod.computeSpvmAnalytics(graphics, jsState30).total;
      out.analytics7D = filterMod.computeSpvmAnalytics(graphics, jsState7).total;
      out.analytics90D = filterMod.computeSpvmAnalytics(graphics, jsState90).total;

      // 1=1 bypass visibility test
      layer.definitionExpression = '1=1';
      await new Promise((r) => setTimeout(r, 500));
      const bypassQ = layer.createQuery();
      bypassQ.where = '1=1';
      bypassQ.returnGeometry = false;
      const bypassResult = await layer.queryFeatures(bypassQ);
      out.bypass1to1QueryCount = bypassResult.features?.length ?? 0;

      if (view) {
        try {
          const lv = await view.whenLayerView(layer);
          out.layerViewExists = Boolean(lv);
          out.layerViewSuspended = lv?.suspended;
          out.layerViewUpdating = lv?.updating;
          out.bypass1to1Visible = !lv?.suspended && layer.visible && (bypassResult.features?.length || 0) > 0;
        } catch (e) {
          out.errors.push(`layerView: ${e?.message || e}`);
        }
      }

      out.parentVisible = layer.parent?.visible ?? null;
      layer.definitionExpression = savedExpr;
    } catch (e) {
      out.errors.push(e?.message || String(e));
    }

    return out;
  });
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const pageErrors = [];
page.on('pageerror', (err) => pageErrors.push(err.message));

await page.goto(`${BASE}/spatial/`, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForSelector('.spatial-shell', { timeout: 15000 });
await waitAuth(page);
await turnSpvmOn(page);

// Allow explorer activation to finish
await page.waitForTimeout(10000);

const diagnostic = await runDiagnostic(page);

console.log(JSON.stringify({ pageErrors, diagnostic }, null, 2));
await browser.close();
