/**
 * Browser verification for Ask IQAI explain + layer checkbox mouse input.
 */
import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
await page.goto('http://localhost:3000/spatial/intelligence-lab/', { waitUntil: 'networkidle', timeout: 120000 });
await page.waitForFunction(() => window.__iqaiIntelligenceLab, null, { timeout: 90000 });
await page.waitForTimeout(2500);

const layerKeys = ['pdqShading', 'pdqBoundaries', 'pdqLabels', 'arrondBoundaries', 'arrondLabels', 'recentReports'];
const layerResults = {};
for (const key of layerKeys) {
  const loc = page.locator(`input[data-layer="${key}"]`);
  const before = await loc.isChecked();
  const box = await loc.boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(300);
  const after = await loc.isChecked();
  layerResults[key] = { before, after, toggled: before !== after };
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(200);
}

async function ask(question) {
  await page.fill('#explain-input', question);
  await page.click('#explain-submit');
  await page.waitForFunction(() => {
    const el = document.querySelector('#explain-response');
    return el && !el.classList.contains('is-loading') && el.textContent && el.textContent !== 'Thinking…';
  }, null, { timeout: 120000 });
  return {
    answer: await page.locator('#explain-response').textContent(),
    provenance: await page.locator('#explain-provenance').textContent()
  };
}

const persistence = await ask('what is persistence');
const unusual = await ask('is this unusual');
const provenance = await ask('where did this data come from');

const html = await page.content();
const hasKeyInHtml = /sk-[A-Za-z0-9]{10,}/.test(html) || /OPENAI_API_KEY/.test(html);

// Force deterministic provider via direct API call in browser
const fallback = await page.evaluate(async () => {
  const res = await fetch('/api/spatial/intelligence-lab/explain', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      question: 'what is persistence',
      context: {
        view: { analyticalMode: 'persistence', mapDisplayMode: 'pdqAnalytics' },
        filters: {
          crimeCategoryLabel: 'Vehicle theft',
          historicalWeekLabel: 'Week of 2026-07-28',
          selectedGeographyName: 'PDQ 12'
        },
        analytics: { persistenceWeeks: 3, baselineLabel: '4-week average' },
        recentData: { filteredRecordCount: 0 },
        map: { visibleLayers: { pdqShading: true } },
        methodology: { sourceName: 'SPVM test' },
        provenance: { sources: ['SPVM published reports'] }
      }
    })
  });
  return res.json();
});

const report = {
  layerMouseClicks: Object.values(layerResults).every((r) => r.toggled),
  layerResults,
  persistence,
  unusual,
  provenance,
  hasKeyInHtml,
  fallbackProvider: fallback.provider,
  fallbackAnswerPreview: String(fallback.answer || '').slice(0, 200)
};

console.log(JSON.stringify(report, null, 2));
await browser.close();

if (!report.layerMouseClicks || report.hasKeyInHtml) process.exit(1);
