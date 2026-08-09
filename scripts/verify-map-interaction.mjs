/**
 * Verify PDQ hover card lifecycle and polygon click selection.
 */
import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
await page.addInitScript(() => localStorage.removeItem('iqai-intelligence-lab-demo-case-v1'));
await page.goto('http://localhost:3000/spatial/intelligence-lab/', { waitUntil: 'networkidle', timeout: 120000 });
await page.waitForFunction(() => window.__iqaiIntelligenceLab?.simulateMapClick, null, { timeout: 90000 });
await page.waitForTimeout(4000);

const clickNoCase = await page.evaluate(() => window.__iqaiIntelligenceLab.simulateMapClick(800, 400));
const hoverRace = await page.evaluate(async () => {
  const canvas = document.querySelector('#lab-map-host canvas');
  const box = canvas.getBoundingClientRect();
  await new Promise((resolve) => {
    let moves = 0;
    const step = () => {
      const x = box.left + 200 + moves * 40;
      const y = box.top + 200;
      window.dispatchEvent(new MouseEvent('mousemove', { clientX: x, clientY: y, bubbles: true }));
      moves += 1;
      if (moves < 8) setTimeout(step, 10);
      else setTimeout(resolve, 120);
    };
    step();
  });
  const el = document.querySelector('.lab-hover-card');
  return {
    hidden: el?.classList.contains('lab-hidden'),
    text: el?.textContent || '',
    html: el?.innerHTML || ''
  };
});

await page.evaluate(() => window.__iqaiIntelligenceLab.openSampleCase());
await page.waitForTimeout(4000);
const clickWithCase = await page.evaluate(() => window.__iqaiIntelligenceLab.simulateMapClick(800, 400));

const report = { clickNoCase, hoverRace, clickWithCase };
console.log(JSON.stringify(report, null, 2));
await browser.close();

const failures = [];
if (!clickNoCase?.selected?.length) failures.push('PDQ not selected without case');
if (!clickWithCase?.selected?.length) failures.push('PDQ not selected with demo case open');
if (!hoverRace.hidden) failures.push('hover card visible after pointer leave race');
if (/^PDQ\s*$/i.test(hoverRace.text.trim())) failures.push('orphan PDQ-only hover text');

if (failures.length) {
  console.error('FAILED:', failures.join('; '));
  process.exit(1);
}
