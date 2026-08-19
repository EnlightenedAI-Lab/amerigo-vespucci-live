/**
 * Capture V4.3 live object sensing language + persistence proofs.
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
await page.waitForFunction(() => window.IQAIFocusInstrument?.version === '4.3', { timeout: 30000 });
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

function inspectorKind() {
  return page.evaluate(() => document.querySelector('[data-field="kind"]')?.textContent || null);
}

function geometryCount() {
  return page.evaluate(() => window.IQAIFocusInstrument.buildingSource?.featureCount
    || window.IQAIFocusInstrument.getState().buildingSource?.featureCount
    || null);
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
      if (r > g + 25 && r > b) return 'red';
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
      visible.push({
        role,
        family: family(pathEl.getAttribute('stroke')),
        className: cls
      });
    }
    return {
      green: visible.filter((row) => row.family === 'green').length,
      red: visible.filter((row) => row.family === 'red').length,
      candidateGreen: visible.some((row) => row.role === 'candidate' && row.family === 'green'),
      acquiredRed: visible.some((row) => row.role === 'acquired' && row.family === 'red'),
      visible
    };
  });
}

function pointerDom() {
  return page.evaluate(() => {
    const pointer = document.querySelector('.fi-pointer');
    const svg = pointer?.querySelector('.fi-reticle');
    return {
      state: pointer?.dataset.state || null,
      circles: svg ? svg.querySelectorAll('circle').length : 0,
      rings: svg ? svg.querySelectorAll('.fi-ring').length : 0,
      brackets: svg ? svg.querySelectorAll('.fi-reticle__brackets path').length : 0,
      seam: Boolean(svg?.querySelector('.fi-seam'))
    };
  });
}

async function persistSequence(point, tag) {
  await page.evaluate(async ({ lat, lng }) => {
    window.IQAIFocusInstrument.setView(lat, lng, 18);
    await window.IQAIFocusInstrument.acquireAt(lat, lng);
  }, point);
  await new Promise((r) => setTimeout(r, 200));
  const acquired = await sourceId();
  await page.evaluate(async ({ lat, lng }) => {
    await window.IQAIFocusInstrument.moveTo(lat, lng);
  }, STREET);
  const afterLeave = await sourceId();
  await page.evaluate(() => window.IQAIFocusInstrument.openInspector());
  await new Promise((r) => setTimeout(r, 150));
  const afterInspect = await sourceId();
  const kind = await inspectorKind();
  await page.evaluate(() => window.IQAIFocusInstrument.closeInspector());
  await new Promise((r) => setTimeout(r, 120));
  const afterClose = await sourceId();
  await page.evaluate(({ lat, lng }) => {
    window.IQAIFocusInstrument.setView(lat, lng - 0.0012, 17);
  }, point);
  await new Promise((r) => setTimeout(r, 220));
  const afterPan = await sourceId();
  await page.evaluate(({ lat, lng }) => {
    window.IQAIFocusInstrument.setView(lat, lng, 18);
  }, point);
  await new Promise((r) => setTimeout(r, 220));
  const afterZoom = await sourceId();
  await page.evaluate(async ({ lat, lng }) => {
    await window.IQAIFocusInstrument.hoverAt(lat, lng);
  }, GARE);
  const afterHoverOther = await sourceId();
  return {
    tag,
    acquired,
    afterLeave,
    afterInspect,
    inspectorKind: kind,
    afterClose,
    afterPan,
    afterZoom,
    afterHoverOther,
    lockHeld: [afterLeave, afterInspect, afterClose, afterPan, afterZoom, afterHoverOther]
      .every((id) => id === acquired)
  };
}

await page.evaluate(() => window.IQAIFocusInstrument.rest());
await page.evaluate(({ lat, lng }) => window.IQAIFocusInstrument.setView(lat, lng, 18), STREET);
await new Promise((r) => setTimeout(r, 350));
await page.evaluate(async ({ lat, lng }) => {
  await window.IQAIFocusInstrument.moveTo(lat, lng);
}, STREET);
await new Promise((r) => setTimeout(r, 180));
const move = { pointer: await pointerDom(), sensing: await sensing() };
await shot('v43-move');

await page.evaluate(({ lat, lng }) => window.IQAIFocusInstrument.setView(lat, lng, 18), PVM);
await new Promise((r) => setTimeout(r, 300));
await page.evaluate(async ({ lat, lng }) => {
  await window.IQAIFocusInstrument.hoverAt(lat, lng);
}, PVM);
await new Promise((r) => setTimeout(r, 180));
const hoverPvm = { sourceId: await sourceId(), sensing: await sensing() };
await shot('v43-hover-pvm-green');

await page.evaluate(async ({ lat, lng }) => {
  await window.IQAIFocusInstrument.moveTo(lat, lng);
}, STREET);
await new Promise((r) => setTimeout(r, 180));
const leavePvm = { sourceId: await sourceId(), sensing: await sensing() };

await page.evaluate(async ({ lat, lng }) => {
  await window.IQAIFocusInstrument.dwellAt(lat, lng);
}, PVM);
await new Promise((r) => setTimeout(r, 180));
const dwellPvm = { sourceId: await sourceId(), sensing: await sensing() };

await page.evaluate(async ({ lat, lng }) => {
  await window.IQAIFocusInstrument.acquireAt(lat, lng);
}, PVM);
await new Promise((r) => setTimeout(r, 250));
const acquirePvm = { sourceId: await sourceId(), sensing: await sensing() };
await shot('v43-acquired-pvm-red');

await page.evaluate(async ({ lat, lng }) => {
  await window.IQAIFocusInstrument.moveTo(lat, lng);
}, STREET);
await new Promise((r) => setTimeout(r, 180));
const persistPvm = { sourceId: await sourceId(), sensing: await sensing() };

await page.evaluate(({ lat, lng }) => window.IQAIFocusInstrument.setView(lat, lng, 17), BOTH);
await new Promise((r) => setTimeout(r, 350));
await page.evaluate(async ({ lat, lng }) => {
  await window.IQAIFocusInstrument.hoverAt(lat, lng);
}, GARE);
await new Promise((r) => setTimeout(r, 220));
const dual = { sourceId: await sourceId(), sensing: await sensing() };
await shot('v43-pvm-red-gare-green');

await page.evaluate(async ({ lat, lng }) => {
  await window.IQAIFocusInstrument.moveTo(lat, lng);
}, STREET);
await new Promise((r) => setTimeout(r, 180));
const leaveGare = { sourceId: await sourceId(), sensing: await sensing() };

await page.evaluate(({ lat, lng }) => window.IQAIFocusInstrument.setView(lat, lng, 18), GARE);
await new Promise((r) => setTimeout(r, 280));
await page.evaluate(async ({ lat, lng }) => {
  await window.IQAIFocusInstrument.acquireAt(lat, lng);
}, GARE);
await new Promise((r) => setTimeout(r, 250));
const acquireGare = { sourceId: await sourceId(), sensing: await sensing() };
await shot('v43-acquired-gare-red');

await page.evaluate(() => window.IQAIFocusInstrument.clear());
await new Promise((r) => setTimeout(r, 200));
const cleared = { sourceId: await sourceId(), sensing: await sensing() };
await shot('v43-cleared');

const pvm = await persistSequence(PVM, 'pvm');
const gare = await persistSequence(GARE, 'gare');
const tour = await persistSequence(TOUR1000, 'tour1000');
const featureCount = await geometryCount();

const report = {
  version: await page.evaluate(() => window.IQAIFocusInstrument.version),
  move,
  hoverPvm,
  leavePvm,
  dwellPvm,
  acquirePvm,
  persistPvm,
  dual,
  leaveGare,
  acquireGare,
  cleared,
  pvm,
  gare,
  tour,
  nrcanFeatureCount: featureCount
};

writeFileSync(path.join(OUT, 'v43-sensing.json'), JSON.stringify(report, null, 2));
await browser.close();

const ok = (
  move.pointer.state === 'move'
  && move.pointer.circles === 0
  && move.pointer.rings === 0
  && hoverPvm.sourceId == null
  && hoverPvm.sensing.candidateGreen
  && hoverPvm.sensing.green === 1
  && hoverPvm.sensing.red === 0
  && leavePvm.sensing.green === 0
  && leavePvm.sensing.red === 0
  && dwellPvm.sourceId == null
  && dwellPvm.sensing.candidateGreen
  && acquirePvm.sourceId === PVM_ID
  && acquirePvm.sensing.acquiredRed
  && persistPvm.sourceId === PVM_ID
  && persistPvm.sensing.acquiredRed
  && persistPvm.sensing.green === 0
  && dual.sourceId === PVM_ID
  && dual.sensing.acquiredRed
  && dual.sensing.candidateGreen
  && dual.sensing.red === 1
  && dual.sensing.green === 1
  && leaveGare.sourceId === PVM_ID
  && leaveGare.sensing.acquiredRed
  && leaveGare.sensing.green === 0
  && acquireGare.sourceId === GARE_ID
  && acquireGare.sensing.acquiredRed
  && acquireGare.sensing.green === 0
  && cleared.sourceId == null
  && cleared.sensing.red === 0
  && pvm.lockHeld
  && gare.lockHeld
  && tour.lockHeld
  && featureCount === 571
);

if (!ok) {
  throw new Error('V4.3 sensing validation failed: ' + JSON.stringify(report, null, 2));
}

console.log(JSON.stringify({ ok: true, report, shots }, null, 2));
