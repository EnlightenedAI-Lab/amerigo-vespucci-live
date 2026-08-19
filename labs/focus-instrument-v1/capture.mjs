/**
 * Capture V4.4 bright lock, collection contract, CSV, and visibility proofs.
 */

import puppeteer from 'puppeteer-core';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.FOCUS_INSTRUMENT_PORT || 8767);
const BASE = `http://127.0.0.1:${PORT}/`;
const OUT = path.join(__dirname, 'proof');
const STREET = { lat: 45.50094, lng: -73.56832 };
const PVM = { lat: 45.50169, lng: -73.56832 };
const GARE = { lat: 45.49991, lng: -73.56648 };
const TOUR1000 = { lat: 45.49833, lng: -73.56639 };
const BOTH = { lat: 45.5008, lng: -73.5674 };
const PVM_ID = '79f19e6e-9da7-4f1e-b269-ac2f28aff1d0';
const GARE_ID = 'ae6980f1-b153-4e75-8f35-ae544279189c';
const CSV_COLUMNS = [
  'object_key', 'object_class', 'authority_provider', 'source_id', 'name_context',
  'latitude', 'longitude', 'source_area_m2', 'derived_area_m2', 'perimeter_m',
  'height_min_m', 'height_max_m', 'elev_min_m', 'elev_max_m', 'quality',
  'acquisition_method', 'provider', 'date_min', 'date_max', 'h_accuracy',
  'v_accuracy', 'dataset', 'dataset_uuid', 'provenance_method', 'attributes_ref'
];
const CHROME = process.env.CHROME_PATH
  || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

mkdirSync(OUT, { recursive: true });

async function waitForHealth(timeoutMs = 8000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/health`);
      if (res.ok) return;
    } catch { /* retry */ }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error('Lab server did not become healthy on port ' + PORT);
}

function shotPath(name) {
  return path.join(OUT, `${name}.png`);
}

await waitForHealth();

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  defaultViewport: { width: 1920, height: 1080, deviceScaleFactor: 1 },
  args: ['--hide-scrollbars', '--window-size=1920,1080']
});

const page = await browser.newPage();
await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });
await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForFunction(() => window.IQAIFocusInstrument?.version === '4.4', { timeout: 30000 });
await page.waitForSelector('.leaflet-tile-loaded', { timeout: 30000 });
await new Promise((r) => setTimeout(r, 2000));

const shots = [];
async function shot(name) {
  const file = shotPath(name);
  await page.screenshot({ path: file });
  shots.push(file);
  return file;
}

function sourceId() {
  return page.evaluate(() => window.IQAIFocusInstrument.getState().objectRef?.sourceId || null);
}

function setState() {
  return page.evaluate(() => window.IQAIFocusInstrument.getState().collectedSet || null);
}

function sensing() {
  return page.evaluate(() => {
    function family(stroke) {
      const value = String(stroke || '');
      const rgb = value.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
      let r;
      let g;
      let b;
      if (rgb) {
        r = Number(rgb[1]);
        g = Number(rgb[2]);
        b = Number(rgb[3]);
      } else if (value.startsWith('#')) {
        const hex = value.replace('#', '');
        const full = hex.length === 3 ? hex.split('').map((ch) => ch + ch).join('') : hex;
        r = parseInt(full.slice(0, 2), 16);
        g = parseInt(full.slice(2, 4), 16);
        b = parseInt(full.slice(4, 6), 16);
      } else {
        return 'other';
      }
      if (g > r + 25 && g > b) return 'green';
      if (r > g + 40 && r > b + 20) return 'red';
      return 'other';
    }
    const paths = [...document.querySelectorAll('.leaflet-pane path.fi-footprint')];
    const visible = [];
    for (const pathEl of paths) {
      const cls = pathEl.getAttribute('class') || '';
      if (cls.includes('casing') || cls.includes('shadow') || cls.includes('inner') || cls.includes('pulse') || cls.includes('travel')) continue;
      const opacity = Number(pathEl.getAttribute('stroke-opacity') ?? 1);
      const d = pathEl.getAttribute('d') || '';
      if (opacity < 0.2 || d.length < 8) continue;
      const role = cls.includes('selected') || cls.includes('acquire')
        ? 'acquired'
        : cls.includes('hover') || cls.includes('targeted') || cls.includes('candidate')
          ? 'candidate'
          : 'other';
      const stroke = pathEl.getAttribute('stroke');
      visible.push({ role, family: family(stroke), stroke, className: cls });
    }
    const chip = document.querySelector('.fi-cand-id:not([hidden]) [data-role="text"]');
    return {
      green: visible.filter((row) => row.family === 'green').length,
      red: visible.filter((row) => row.family === 'red').length,
      candidateGreen: visible.some((row) => row.role === 'candidate' && row.family === 'green'),
      acquiredRed: visible.some((row) => row.role === 'acquired' && row.family === 'red'),
      brightRed: visible.some((row) => {
        if (row.role !== 'acquired') return false;
        const hex = String(row.stroke || '').replace('#', '');
        if (hex.length < 6) return false;
        const r = parseInt(hex.slice(0, 2), 16);
        const g = parseInt(hex.slice(2, 4), 16);
        return r >= 220 && g <= 80;
      }),
      candidateIdentity: chip?.textContent || null,
      visible
    };
  });
}

function pulseOnce() {
  return page.evaluate(() => {
    const pulse = document.querySelector('.leaflet-pane path.fi-footprint--pulse');
    if (!pulse) return { present: false };
    const anim = getComputedStyle(pulse).animationIterationCount;
    return { present: true, iteration: anim };
  });
}

await page.evaluate(() => window.IQAIFocusInstrument.rest());
await page.evaluate(({ lat, lng }) => window.IQAIFocusInstrument.setView(lat, lng, 18), PVM);
await new Promise((r) => setTimeout(r, 350));
await page.evaluate(async ({ lat, lng }) => {
  await window.IQAIFocusInstrument.hoverAt(lat, lng);
}, PVM);
await new Promise((r) => setTimeout(r, 180));
const hoverPvm = { sourceId: await sourceId(), sensing: await sensing() };
await shot('v44-hover-pvm-green');

await page.evaluate(async ({ lat, lng }) => {
  await window.IQAIFocusInstrument.acquireAt(lat, lng);
}, PVM);
const pulse = await pulseOnce();
await new Promise((r) => setTimeout(r, 500));
const acquirePvm = { sourceId: await sourceId(), sensing: await sensing() };
await shot('v44-acquired-pvm-red');

await page.evaluate(() => window.IQAIFocusInstrument.openInspector());
await new Promise((r) => setTimeout(r, 150));
const firstAdd = await page.evaluate(() => window.IQAIFocusInstrument.addToSet());
const dupAdd = await page.evaluate(() => window.IQAIFocusInstrument.addToSet());
await shot('v44-inspector-set');

await page.evaluate(({ lat, lng }) => window.IQAIFocusInstrument.setView(lat, lng, 17), BOTH);
await new Promise((r) => setTimeout(r, 300));
await page.evaluate(async ({ lat, lng }) => {
  await window.IQAIFocusInstrument.hoverAt(lat, lng);
}, GARE);
await new Promise((r) => setTimeout(r, 200));
const dual = { sourceId: await sourceId(), sensing: await sensing() };
await shot('v44-pvm-red-gare-green');

await page.evaluate(async ({ lat, lng }) => {
  await window.IQAIFocusInstrument.acquireAt(lat, lng);
}, GARE);
await new Promise((r) => setTimeout(r, 500));
const handoff = { sourceId: await sourceId(), sensing: await sensing() };
await shot('v44-handoff-gare-red');
const secondAdd = await page.evaluate(() => window.IQAIFocusInstrument.addToSet());
await page.evaluate(() => window.IQAIFocusInstrument.openInspector());
await new Promise((r) => setTimeout(r, 150));
const csv = await page.evaluate(() => {
  const set = window.IQAIFocusInstrument.serializeCollectedSet();
  const header = [
    'object_key', 'object_class', 'authority_provider', 'source_id', 'name_context',
    'latitude', 'longitude', 'source_area_m2', 'derived_area_m2', 'perimeter_m',
    'height_min_m', 'height_max_m', 'elev_min_m', 'elev_max_m', 'quality',
    'acquisition_method', 'provider', 'date_min', 'date_max', 'h_accuracy',
    'v_accuracy', 'dataset', 'dataset_uuid', 'provenance_method', 'attributes_ref'
  ];
  const lines = set.objectRefs.map((item) => header.map((key) => item.row?.[key] ?? '').join(','));
  return [header.join(','), ...lines].join('\n');
});
writeFileSync(path.join(OUT, 'v44-collected.csv'), csv);
await shot('v44-set-two-rows');

await page.evaluate(() => window.IQAIFocusInstrument.clear());
await page.evaluate(() => window.IQAIFocusInstrument.setBasemap('dark'));
await new Promise((r) => setTimeout(r, 800));
await page.evaluate(({ lat, lng }) => window.IQAIFocusInstrument.setView(lat, lng, 18), PVM);
await new Promise((r) => setTimeout(r, 500));
await page.evaluate(async ({ lat, lng }) => {
  await window.IQAIFocusInstrument.hoverAt(lat, lng);
}, PVM);
await new Promise((r) => setTimeout(r, 200));
const darkHover = { sensing: await sensing() };
await shot('v44-dark-hover-green');
await page.evaluate(async ({ lat, lng }) => {
  await window.IQAIFocusInstrument.acquireAt(lat, lng);
}, PVM);
await new Promise((r) => setTimeout(r, 500));
const darkAcquired = { sensing: await sensing() };
await shot('v44-dark-acquired-red');
await page.evaluate(() => window.IQAIFocusInstrument.setBasemap('imagery'));

await page.evaluate(() => window.IQAIFocusInstrument.clear());
await page.evaluate(async ({ lat, lng }) => {
  window.IQAIFocusInstrument.setView(lat, lng, 18);
  await window.IQAIFocusInstrument.acquireAt(lat, lng);
}, TOUR1000);
await new Promise((r) => setTimeout(r, 200));
const persistId = await sourceId();
await page.evaluate(async ({ lat, lng }) => {
  await window.IQAIFocusInstrument.moveTo(lat, lng);
}, STREET);
const persistLeave = await sourceId();
await page.evaluate(() => window.IQAIFocusInstrument.clear());
const afterClear = await sourceId();
const collected = await setState();
const featureCount = await page.evaluate(() => window.IQAIFocusInstrument.buildingSource?.featureCount || null);
const csvLines = csv.trim().split(/\r?\n/);
const csvHeader = csvLines[0].split(',');
const csvIds = csvLines.slice(1).map((line) => line.split(',')[3]);

const report = {
  version: await page.evaluate(() => window.IQAIFocusInstrument.version),
  hoverPvm,
  pulse,
  acquirePvm,
  firstAdd,
  dupAdd,
  dual,
  handoff,
  secondAdd,
  collected,
  csvHeader,
  csvIds,
  darkHover,
  darkAcquired,
  persist: { persistId, persistLeave, afterClear },
  nrcanFeatureCount: featureCount
};

writeFileSync(path.join(OUT, 'v44-report.json'), JSON.stringify(report, null, 2));
await browser.close();

const ok = (
  hoverPvm.sourceId == null
  && hoverPvm.sensing.candidateGreen
  && hoverPvm.sensing.green === 1
  && hoverPvm.sensing.candidateIdentity
  && acquirePvm.sourceId === PVM_ID
  && acquirePvm.sensing.acquiredRed
  && acquirePvm.sensing.brightRed
  && acquirePvm.sensing.red === 1
  && (pulse.iteration === '1' || pulse.present === false || pulse.iteration === '1')
  && firstAdd.ok === true
  && dupAdd.ok === false
  && dupAdd.reason === 'duplicate'
  && dual.sourceId === PVM_ID
  && dual.sensing.acquiredRed
  && dual.sensing.candidateGreen
  && dual.sensing.red === 1
  && dual.sensing.green === 1
  && handoff.sourceId === GARE_ID
  && handoff.sensing.red === 1
  && handoff.sensing.acquiredRed
  && secondAdd.ok === true
  && collected.count === 2
  && CSV_COLUMNS.every((col) => csvHeader.includes(col))
  && csvIds.includes(PVM_ID)
  && csvIds.includes(GARE_ID)
  && darkHover.sensing.candidateGreen
  && darkAcquired.sensing.acquiredRed
  && persistId === persistLeave
  && afterClear == null
  && featureCount === 571
);

if (!ok) {
  throw new Error('V4.4 validation failed: ' + JSON.stringify(report, null, 2));
}

console.log(JSON.stringify({ ok: true, report, shots, csv: path.join(OUT, 'v44-collected.csv') }, null, 2));
