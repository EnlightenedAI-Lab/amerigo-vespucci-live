/**
 * Capture V4.6 contact edges, lock seal, and single identity plate.
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
await page.waitForFunction(() => window.IQAIFocusInstrument?.version === '4.6', { timeout: 30000 });
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
      if (cls.includes('casing') || cls.includes('shadow') || cls.includes('inner') || cls.includes('pulse') || cls.includes('travel') || cls.includes('release') || cls.includes('collected') || cls.includes('approach') || cls.includes('contact-ink')) continue;
      const opacity = Number(pathEl.getAttribute('stroke-opacity') ?? 1);
      const d = pathEl.getAttribute('d') || '';
      if (opacity < 0.2 || d.length < 8) continue;
      if (cls.includes('contact')) {
        visible.push({ role: 'contact', family: family(pathEl.getAttribute('stroke')), stroke: pathEl.getAttribute('stroke'), className: cls });
        continue;
      }
      if (cls.includes('seal')) {
        visible.push({ role: 'seal', family: family(pathEl.getAttribute('stroke')), stroke: pathEl.getAttribute('stroke'), className: cls });
        continue;
      }
      const role = cls.includes('selected') || cls.includes('acquire')
        ? 'acquired'
        : cls.includes('hover') || cls.includes('targeted') || cls.includes('candidate')
          ? 'candidate'
          : 'other';
      const stroke = pathEl.getAttribute('stroke');
      visible.push({ role, family: family(stroke), stroke, className: cls });
    }
    const plate = document.querySelector('.fi-id-plate:not([hidden])');
    return {
      green: visible.filter((row) => row.family === 'green' && row.role !== 'contact').length,
      red: visible.filter((row) => row.family === 'red' && row.role !== 'seal').length,
      contact: visible.filter((row) => row.role === 'contact').length,
      seal: visible.filter((row) => row.role === 'seal').length,
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
      candidateIdentity: plate?.querySelector('[data-role="text"]')?.textContent || null,
      plateText: (plate?.innerText || '').replace(/\s+/g, ' ').trim(),
      plateCount: document.querySelectorAll('.fi-id-plate:not([hidden])').length,
      extraLabels: document.querySelectorAll('.fi-foot-label__card:not([hidden])').length,
      visible
    };
  });
}

function sealOnce() {
  return page.evaluate(() => {
    const seals = [...document.querySelectorAll('.leaflet-pane path.fi-footprint--seal')]
      .filter((el) => (el.getAttribute('d') || '').length > 4);
    if (!seals.length) return { present: false, count: 0, iteration: null };
    const anim = getComputedStyle(seals[0]).animationIterationCount;
    return { present: true, count: seals.length, iteration: anim };
  });
}

function pointerChip() {
  return page.evaluate(() => {
    const chip = document.querySelector('.fi-pointer .fi-chip');
    const sense = chip?.querySelector('[data-role="sense"]');
    return {
      text: (chip?.innerText || '').trim(),
      sense: sense && !sense.hidden ? (sense.textContent || '') : '',
      coordsPresent: Boolean(chip?.querySelector('[data-role="coords"]'))
    };
  });
}

function approachTickCount() {
  return page.evaluate(() => (
    [...document.querySelectorAll('.leaflet-pane path.fi-footprint--approach-tick')]
      .filter((el) => (el.getAttribute('d') || '').length > 4).length
  ));
}

function collectedHairlineCount() {
  return page.evaluate(() => (
    [...document.querySelectorAll('.leaflet-pane path.fi-footprint--collected')]
      .filter((el) => (el.getAttribute('d') || '').length > 8).length
  ));
}

async function findApproachPoint() {
  const origin = PVM;
  const cos = Math.cos(origin.lat * Math.PI / 180);
  const dirs = [
    { lat: -1, lng: 0 },
    { lat: 1, lng: 0 },
    { lat: 0, lng: -1 },
    { lat: 0, lng: 1 },
    { lat: -1, lng: -1 }
  ];
  for (const dir of dirs) {
    for (let meters = 20; meters <= 120; meters += 3) {
      const point = {
        lat: origin.lat + dir.lat * meters / 111320,
        lng: origin.lng + dir.lng * meters / (111320 * cos)
      };
      await page.evaluate(async ({ lat, lng }) => {
        await window.IQAIFocusInstrument.hoverAt(lat, lng);
      }, point);
      const hover = await page.evaluate(() => window.IQAIFocusInstrument.getState().hover);
      if (hover?.relation === 'near' && hover.range > 1 && hover.range <= 16) {
        return { point, hover, ticks: await approachTickCount() };
      }
    }
  }
  return { point: null, hover: null, ticks: 0 };
}

await page.evaluate(() => window.IQAIFocusInstrument.rest());
const quietProbes = [
  STREET,
  { lat: 45.5034, lng: -73.5715 },
  { lat: 45.4994, lng: -73.5712 },
  { lat: 45.5026, lng: -73.5640 }
];
let quietPoint = STREET;
for (const point of quietProbes) {
  await page.evaluate(({ lat, lng }) => window.IQAIFocusInstrument.setView(lat, lng, 18), point);
  await new Promise((r) => setTimeout(r, 200));
  await page.evaluate(async ({ lat, lng }) => {
    await window.IQAIFocusInstrument.moveTo(lat, lng);
  }, point);
  const hover = await page.evaluate(() => window.IQAIFocusInstrument.getState().hover);
  if (!hover) {
    quietPoint = point;
    break;
  }
}
await page.evaluate(({ lat, lng }) => window.IQAIFocusInstrument.setView(lat, lng, 18), quietPoint);
await new Promise((r) => setTimeout(r, 250));
await page.evaluate(async ({ lat, lng }) => {
  await window.IQAIFocusInstrument.moveTo(lat, lng);
}, quietPoint);
await new Promise((r) => setTimeout(r, 120));
const silentMove = { chip: await pointerChip(), hover: await page.evaluate(() => window.IQAIFocusInstrument.getState().hover) };
await shot('v46-move-silent');

await page.evaluate(({ lat, lng }) => window.IQAIFocusInstrument.setView(lat, lng, 18), PVM);
await new Promise((r) => setTimeout(r, 250));
const approach = await findApproachPoint();
await shot('v46-approach-ticks');

await page.evaluate(({ lat, lng }) => window.IQAIFocusInstrument.setView(lat, lng, 18), PVM);
await new Promise((r) => setTimeout(r, 250));
await page.evaluate(async ({ lat, lng }) => {
  await window.IQAIFocusInstrument.hoverAt(lat, lng);
}, PVM);
await new Promise((r) => setTimeout(r, 180));
const hoverPvm = {
  sourceId: await sourceId(),
  sensing: await sensing()
};
await shot('v46-hover-contact');

const beforeDwell = await page.evaluate(() => window.IQAIFocusInstrument.getState().pointer);
await page.evaluate(async ({ lat, lng }) => {
  await window.IQAIFocusInstrument.dwellAt(lat, lng);
}, PVM);
await new Promise((r) => setTimeout(r, 80));
const dwellPvm = {
  pointer: await page.evaluate(() => window.IQAIFocusInstrument.getState().pointer),
  before: beforeDwell,
  hover: await page.evaluate(() => window.IQAIFocusInstrument.getState().hover),
  sensing: await sensing()
};
await shot('v46-dwell-contact');

const acquirePromise = page.evaluate(async ({ lat, lng }) => {
  await window.IQAIFocusInstrument.acquireAt(lat, lng);
}, PVM);
await new Promise((r) => setTimeout(r, 90));
const seal = await sealOnce();
const sealSense = await sensing();
await shot('v46-lock-seal');
await acquirePromise;
const acquirePvm = { sourceId: await sourceId(), sensing: await sensing() };
await shot('v46-acquired-pvm-red');

await page.evaluate(() => window.IQAIFocusInstrument.openInspector());
await new Promise((r) => setTimeout(r, 150));
const firstAdd = await page.evaluate(() => window.IQAIFocusInstrument.addToSet());
const dupAdd = await page.evaluate(() => window.IQAIFocusInstrument.addToSet());
await shot('v46-inspector-set');

await page.evaluate(({ lat, lng }) => window.IQAIFocusInstrument.setView(lat, lng, 17), BOTH);
await new Promise((r) => setTimeout(r, 300));
await page.evaluate(async ({ lat, lng }) => {
  await window.IQAIFocusInstrument.hoverAt(lat, lng);
}, GARE);
await new Promise((r) => setTimeout(r, 200));
const dual = { sourceId: await sourceId(), sensing: await sensing() };
await shot('v46-pvm-red-gare-green');

await page.evaluate(async ({ lat, lng }) => {
  await window.IQAIFocusInstrument.acquireAt(lat, lng);
}, GARE);
await new Promise((r) => setTimeout(r, 180));
await shot('v46-handoff-release');
await new Promise((r) => setTimeout(r, 700));
const handoff = { sourceId: await sourceId(), sensing: await sensing() };
await shot('v46-handoff-gare-red');
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
writeFileSync(path.join(OUT, 'v46-collected.csv'), csv);
await shot('v46-set-two-rows');

await page.evaluate(async ({ lat, lng }) => {
  window.IQAIFocusInstrument.setView(lat, lng, 18);
  await window.IQAIFocusInstrument.acquireAt(lat, lng);
  window.IQAIFocusInstrument.addToSet();
}, TOUR1000);
await new Promise((r) => setTimeout(r, 200));
const triple = { sourceId: await sourceId(), sensing: await sensing(), set: await setState() };
await shot('v46-collected-quiet-field');

await page.evaluate(() => window.IQAIFocusInstrument.clear());
await new Promise((r) => setTimeout(r, 400));
const hairlinesAfterClear = await collectedHairlineCount();
await shot('v46-hairlines-after-clear');

await page.evaluate(() => window.IQAIFocusInstrument.setBasemap('dark'));
await new Promise((r) => setTimeout(r, 800));
await page.evaluate(({ lat, lng }) => window.IQAIFocusInstrument.setView(lat, lng, 18), PVM);
await new Promise((r) => setTimeout(r, 500));
await page.evaluate(async ({ lat, lng }) => {
  await window.IQAIFocusInstrument.hoverAt(lat, lng);
}, PVM);
await new Promise((r) => setTimeout(r, 200));
const darkHover = { sensing: await sensing() };
await shot('v46-dark-hover-green');
await page.evaluate(async ({ lat, lng }) => {
  await window.IQAIFocusInstrument.acquireAt(lat, lng);
}, PVM);
await new Promise((r) => setTimeout(r, 500));
const darkAcquired = { sensing: await sensing() };
await shot('v46-dark-acquired-red');
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
  silentMove,
  approach,
  hoverPvm,
  dwellPvm,
  seal,
  sealSense,
  acquirePvm,
  firstAdd,
  dupAdd,
  dual,
  handoff,
  secondAdd,
  triple,
  hairlinesAfterClear,
  collected,
  csvHeader,
  csvIds,
  darkHover,
  darkAcquired,
  persist: { persistId, persistLeave, afterClear },
  nrcanFeatureCount: featureCount
};

writeFileSync(path.join(OUT, 'v46-report.json'), JSON.stringify(report, null, 2));
await browser.close();

const snapped = dwellPvm.pointer
  && dwellPvm.before
  && (Math.abs(dwellPvm.pointer.lat - dwellPvm.before.lat) > 1e-6
    || Math.abs(dwellPvm.pointer.lng - dwellPvm.before.lng) > 1e-6
    || dwellPvm.hover?.relation === 'inside');

const ok = (
  report.version === '4.6'
  && silentMove.chip.coordsPresent === false
  && !/EL|SNAP|BUILDING|coords/i.test(silentMove.chip.text)
  && approach.hover?.relation === 'near'
  && approach.ticks >= 2
  && hoverPvm.sourceId == null
  && hoverPvm.sensing.candidateGreen
  && hoverPvm.sensing.contact >= 2
  && hoverPvm.sensing.green === 1
  && hoverPvm.sensing.candidateIdentity
  && hoverPvm.sensing.plateCount === 1
  && hoverPvm.sensing.extraLabels === 0
  && !/OBJECT ACQUIRED/i.test(hoverPvm.sensing.plateText || '')
  && snapped
  && dwellPvm.sensing.contact >= 2
  && (seal.iteration === '1' || seal.count >= 4)
  && sealSense.seal >= 4
  && acquirePvm.sourceId === PVM_ID
  && acquirePvm.sensing.acquiredRed
  && acquirePvm.sensing.brightRed
  && acquirePvm.sensing.red === 1
  && acquirePvm.sensing.seal === 0
  && acquirePvm.sensing.plateCount === 1
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
  && triple.set.count === 3
  && triple.sensing.red === 1
  && hairlinesAfterClear >= 2
  && collected.count === 3
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
  throw new Error('V4.6 validation failed: ' + JSON.stringify(report, null, 2));
}

console.log(JSON.stringify({ ok: true, report, shots, csv: path.join(OUT, 'v46-collected.csv') }, null, 2));
