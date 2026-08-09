/**
 * Layer control acceptance matrix — intelligence lab geography toggles.
 */
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(__dirname, '../public/spatial/intelligence-lab/screenshots-layer-debug');
fs.mkdirSync(outDir, { recursive: true });

const STATES = {
  A: { pdqShading: false, pdqBoundaries: false, pdqLabels: false, arrondBoundaries: false, arrondLabels: false, recentReports: true },
  B: { pdqShading: false, pdqBoundaries: true, pdqLabels: true, arrondBoundaries: false, arrondLabels: false, recentReports: false },
  C: { pdqShading: false, pdqBoundaries: false, pdqLabels: false, arrondBoundaries: true, arrondLabels: true, recentReports: false },
  D: { pdqShading: false, pdqBoundaries: true, pdqLabels: true, arrondBoundaries: true, arrondLabels: true, recentReports: false },
  E: { pdqShading: true, pdqBoundaries: true, pdqLabels: true, arrondBoundaries: false, arrondLabels: false, recentReports: true }
};

async function setLayers(page, layers) {
  for (const [key, checked] of Object.entries(layers)) {
    const input = page.locator(`input[data-layer="${key}"]`);
    const isChecked = await input.isChecked();
    if (isChecked !== checked) await input.click();
  }
  await page.waitForTimeout(1500);
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
await page.goto('http://localhost:3000/spatial/intelligence-lab/', { waitUntil: 'networkidle', timeout: 120000 });
await page.waitForFunction(() => window.__iqaiIntelligenceLab, null, { timeout: 90000 });
await page.waitForTimeout(2500);

const report = { states: {}, pass: {} };

for (const [id, layers] of Object.entries(STATES)) {
  await page.selectOption('#lab-time-window', layers.recentReports ? '72h' : 'off');
  await page.selectOption('#lab-gis-mode', layers.recentReports ? 'incidents' : 'pdqAnalytics');
  await setLayers(page, layers);
  const diag = await page.evaluate(() => window.__iqaiIntelligenceLab.getLayerDiagnostics());
  report.states[id] = { layers, diag };

  const v = layers;
  const d = diag;
  report.pass[id] = {
    pdqVisible: d.pdqVisible === (v.pdqShading || v.pdqBoundaries || v.pdqLabels),
    pdqLabels: d.pdqLabelsVisible === (v.pdqLabels && (v.pdqShading || v.pdqBoundaries || v.pdqLabels)),
    arrondVisible: d.arrondVisible === (v.arrondBoundaries || v.arrondLabels),
    arrondLabels: d.arrondLabelsVisible === (v.arrondLabels && (v.arrondBoundaries || v.arrondLabels)),
    spvm: layers.recentReports ? d.spvmVisible === true : d.spvmVisible !== true
  };

  await page.screenshot({ path: path.join(outDir, `state-${id}.png`) });
}

await setLayers(page, STATES.E);
for (const mode of ['incidents', 'heatmap', 'grid', 'pdqAnalytics']) {
  await page.selectOption('#lab-gis-mode', mode);
  await page.waitForTimeout(1200);
  const diag = await page.evaluate(() => window.__iqaiIntelligenceLab.getLayerDiagnostics());
  report[`E_${mode}`] = diag;
  await page.screenshot({ path: path.join(outDir, `state-E-${mode}.png`) });
}
await page.locator('[data-mode="composition"]').click();
await page.waitForTimeout(1500);
report.E_composition = await page.evaluate(() => window.__iqaiIntelligenceLab.getLayerDiagnostics());
await page.screenshot({ path: path.join(outDir, 'state-E-composition.png') });

report.outDir = outDir;
console.log(JSON.stringify(report, null, 2));
await browser.close();
