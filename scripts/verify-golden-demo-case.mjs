/**
 * Golden demo case — sample load + investigation workspace verification.
 */
import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
await page.addInitScript(() => localStorage.removeItem('iqai-intelligence-lab-demo-case-v1'));
await page.goto('http://localhost:3000/spatial/intelligence-lab/', { waitUntil: 'networkidle', timeout: 120000 });
await page.waitForFunction(() => window.__iqaiIntelligenceLab?.openSampleCase, null, { timeout: 90000 });
await page.waitForTimeout(4000);

await page.evaluate(() => window.__iqaiIntelligenceLab.openSampleCase());
await page.waitForTimeout(5000);

const report = await page.evaluate(() => {
  const ws = window.__iqaiIntelligenceLab.caseWorkspace();
  const metrics = ws?.relatedReports
    ? {
        nearbyReports: ws.relatedReports.length,
        sameCategoryReports: ws.relatedReports.filter((r) => r.sameCategory).length,
        pdqsInvolved: new Set(ws.relatedReports.map((r) => r.pdq).filter(Boolean)).size,
        arrondissementsInvolved: new Set(ws.relatedReports.map((r) => r.arrondissement).filter(Boolean)).size
      }
    : null;
  const hoverCard = document.querySelector('.lab-hover-card');
  return {
    caseVisible: document.querySelector('#case-workspace-host')?.textContent?.includes('SYNTHETIC'),
    metrics,
    coverage: ws?.coverage,
    hoverAtCase: {
      hidden: hoverCard?.classList.contains('lab-hidden'),
      text: hoverCard?.textContent || ''
    },
    caseCoords: ws?.case ? { lat: ws.case.latitude, lng: ws.case.longitude } : null
  };
});

// Polygon click away from the synthetic marker (marker itself opens case details)
const polygonClick = await page.evaluate(() => {
  const canvas = document.querySelector('#lab-map-host canvas');
  const box = canvas.getBoundingClientRect();
  const cx = box.left + box.width * 0.62;
  const cy = box.top + box.height * 0.55;
  return window.__iqaiIntelligenceLab.simulateMapClick(cx, cy);
});

console.log(JSON.stringify({ report, polygonClick }, null, 2));
await browser.close();

const failures = [];
if (!report.caseVisible) failures.push('case workspace not visible');
if (!report.metrics || report.metrics.nearbyReports < 5) {
  failures.push(`insufficient nearby reports: ${report.metrics?.nearbyReports ?? 0}`);
}
if (!report.coverage?.insideCoverage) failures.push('golden case outside PDQ coverage');
if (/·\s*PDQ\s*$/i.test(report.hoverAtCase.text) || report.hoverAtCase.text === '— · PDQ') {
  failures.push(`orphan PDQ hover: ${report.hoverAtCase.text}`);
}
if (!polygonClick?.selected?.length) failures.push('polygon not clickable with case open');

if (failures.length) {
  console.error('FAILED:', failures.join('; '));
  process.exit(1);
}
