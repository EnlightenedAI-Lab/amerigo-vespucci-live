/**
 * Automated browser verification for Conversational Result Scope V1.
 */
import { chromium } from 'playwright';

const BASE = process.env.PREVIEW_BASE || 'http://localhost:3000';
const STEPS = [
  'Turn off all layers.',
  'Turn on Cameras and EMS.',
  'Turn them off.',
  'Turn them back on.',
  'Show Cameras within 3 km of 997 de la Commune.',
  'Hide these results.',
  'Show them again.',
  'Make it 5 km.',
  'Zoom to these results.',
  'Turn all layers on.'
];

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

async function runCommand(prompt) {
  await page.locator('#spatial-command-input').fill(prompt);
  await page.locator('#spatial-command-run').click();
  await page.waitForTimeout(8000);
}

async function state() {
  return page.evaluate(() => window.__IQAI_CONVERSATION_STATE__ || null);
}

async function ledgerRows() {
  return page.evaluate(() => {
    const rows = [...document.querySelectorAll('.execution-ledger-table tbody tr')];
    return rows.map((tr) => [...tr.querySelectorAll('td')].map((td) => td.textContent?.trim()));
  });
}

async function responseLine() {
  return page.locator('#spatial-response-line').textContent().catch(() => '');
}

async function layerVisible(title) {
  return page.evaluate((layerTitle) => {
    const catalog = window.__IQAI_WEBMAP_LAYER_CATALOG__ || null;
    const entry = catalog?.layers?.find((l) => l.title === layerTitle);
    return entry?.visible ?? null;
  }, title);
}

async function iqaiLayerVisible(idSuffix) {
  return page.evaluate((suffix) => {
    const webMap = window.__IQAI_RUNTIME__?.webMap;
    if (!webMap) return null;
    const layer = webMap.layers.find((l) => l.id?.includes(suffix));
    return layer ? layer.visible : null;
  }, idSuffix);
}

await page.goto(`${BASE}/spatial/`, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForSelector('.spatial-shell', { timeout: 15000 });
const signIn = page.locator('#spatial-sign-in');
if (await signIn.isVisible({ timeout: 5000 }).catch(() => false)) {
  await signIn.click();
  await page.waitForTimeout(15000);
}
await page.waitForTimeout(12000);
await page.waitForSelector('#spatial-command-run:not([disabled])', { timeout: 120000 }).catch(() => {});

const results = [];
for (let i = 0; i < STEPS.length; i++) {
  const prompt = STEPS[i];
  await runCommand(prompt);
  const snap = {
    step: i + 1,
    prompt,
    response: await responseLine(),
    state: await state(),
    ledger: await ledgerRows(),
    camerasVisible: await layerVisible('Cameras'),
    emsVisible: await layerVisible('EMS'),
    scopedVisible: await iqaiLayerVisible('iqai-webmap')
  };
  results.push(snap);
}

const diag = await page.evaluate(() => window.__iqaiSpatialV1Diagnostics?.() || null);
const health = await fetch(`${BASE}/health`).then((r) => r.json()).catch(() => ({}));

await browser.close();

const step5 = results[4];
const step8 = results[7];
const ledger5 = step5?.ledger || [];
const duplicateZero = ledger5.filter((row) => row[2] === '0').length;
const ledger124 = ledger5.find((row) => row[0] === 'Cameras' && row[2] === '124');

console.log(JSON.stringify({
  results,
  diag,
  health,
  duplicateZeroRow: duplicateZero,
  has124Row: Boolean(ledger124),
  step8Count: step8?.ledger?.[0]?.[2]
}, null, 2));
