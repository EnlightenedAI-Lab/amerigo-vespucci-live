/**
 * Capture V4.2 reticle states + V4.1 persistence / inspector-truth proofs.
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
const PVM_ID = '79f19e6e-9da7-4f1e-b269-ac2f28aff1d0';
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
await page.waitForFunction(() => window.IQAIFocusInstrument?.version === '4.2', { timeout: 30000 });
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
  await new Promise((r) => setTimeout(r, 200));
  const afterInspect = await sourceId();
  const kind = await inspectorKind();
  if (tag === 'pvm') {
    await shot('v42-acquired-pvm');
    await shot('v42-inspector-pvm');
  }
  await page.evaluate(() => window.IQAIFocusInstrument.closeInspector());
  await new Promise((r) => setTimeout(r, 150));
  const afterClose = await sourceId();
  await page.evaluate(({ lat, lng }) => {
    window.IQAIFocusInstrument.setView(lat, lng - 0.0012, 17);
  }, point);
  await new Promise((r) => setTimeout(r, 250));
  const afterPan = await sourceId();
  await page.evaluate(({ lat, lng }) => {
    window.IQAIFocusInstrument.setView(lat, lng, 18);
  }, point);
  await new Promise((r) => setTimeout(r, 250));
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
await new Promise((r) => setTimeout(r, 400));
await page.evaluate(async ({ lat, lng }) => {
  await window.IQAIFocusInstrument.moveTo(lat, lng);
}, STREET);
await new Promise((r) => setTimeout(r, 200));
const moveDom = await pointerDom();
await shot('v42-move');

await page.evaluate(({ lat, lng }) => window.IQAIFocusInstrument.setView(lat, lng, 18), PVM);
await new Promise((r) => setTimeout(r, 350));
await page.evaluate(async ({ lat, lng }) => {
  await window.IQAIFocusInstrument.hoverAt(lat, lng);
}, PVM);
await new Promise((r) => setTimeout(r, 200));
const hoverDom = await pointerDom();
await shot('v42-hover');

await page.evaluate(async ({ lat, lng }) => {
  await window.IQAIFocusInstrument.dwellAt(lat, lng);
}, PVM);
await new Promise((r) => setTimeout(r, 200));
const targetedDom = await pointerDom();
await shot('v42-targeted');

await page.evaluate(async ({ lat, lng }) => {
  await window.IQAIFocusInstrument.acquireAt(lat, lng);
}, PVM);
await new Promise((r) => setTimeout(r, 250));
const acquiredId = await sourceId();
await shot('v42-acquired');

await page.evaluate(() => window.IQAIFocusInstrument.openInspector());
await new Promise((r) => setTimeout(r, 200));
await shot('v42-acquired-pvm-inspector');

await page.evaluate(async ({ lat, lng }) => {
  await window.IQAIFocusInstrument.moveTo(lat, lng);
}, STREET);
await new Promise((r) => setTimeout(r, 200));
const persistId = await sourceId();
await shot('v42-acquired-persist-leave');
await page.evaluate(() => window.IQAIFocusInstrument.closeInspector());

const objectRef = await page.evaluate(() => window.IQAIFocusInstrument.serializeSelection());
await page.evaluate(() => window.IQAIFocusInstrument.clear());
await new Promise((r) => setTimeout(r, 200));

const pvm = await persistSequence(PVM, 'pvm');
const gare = await persistSequence(GARE, 'gare');
await page.evaluate(async ({ lat, lng }) => {
  window.IQAIFocusInstrument.setView(lat, lng, 18);
  await window.IQAIFocusInstrument.acquireAt(lat, lng);
}, GARE);
await new Promise((r) => setTimeout(r, 200));
await shot('v42-acquired-gare');
await page.evaluate(() => window.IQAIFocusInstrument.openInspector());
await new Promise((r) => setTimeout(r, 150));
await shot('v42-inspector-gare');
await page.evaluate(() => window.IQAIFocusInstrument.closeInspector());

const first = await sourceId();
await page.evaluate(async ({ lat, lng }) => {
  window.IQAIFocusInstrument.setView(lat, lng, 18);
  await window.IQAIFocusInstrument.acquireAt(lat, lng);
}, TOUR1000);
await new Promise((r) => setTimeout(r, 250));
const second = await sourceId();
await shot('v42-acquired-1000');
await page.evaluate(() => window.IQAIFocusInstrument.openInspector());
await new Promise((r) => setTimeout(r, 150));
await shot('v42-inspector-1000');
const secondInspect = await sourceId();
await page.evaluate(() => window.IQAIFocusInstrument.closeInspector());
await page.evaluate(() => window.IQAIFocusInstrument.clear());
await new Promise((r) => setTimeout(r, 200));
const afterClear = await sourceId();
await shot('v42-cleared');

const tour = await persistSequence(TOUR1000, 'tour1000');
const featureCount = await geometryCount();

const report = {
  version: await page.evaluate(() => window.IQAIFocusInstrument.version),
  reticle: { move: moveDom, hover: hoverDom, targeted: targetedDom },
  pvmAcquisition: { acquiredId, persistId, persisted: persistId === acquiredId && acquiredId === PVM_ID },
  objectRefContract: objectRef?.objectRef?.authority?.provider === 'nrcan'
    && objectRef?.objectRef?.sourceId === PVM_ID,
  nrcanFeatureCount: featureCount,
  pvm,
  gare,
  tour,
  secondAcquisition: {
    from: first,
    to: second,
    changed: first !== second,
    inspectSame: second === secondInspect
  },
  clear: { afterClear, cleared: afterClear == null }
};

writeFileSync(path.join(OUT, 'v42-persistence.json'), JSON.stringify(report, null, 2));
await browser.close();

const noWheels = [moveDom, hoverDom, targetedDom].every((row) =>
  row.circles === 0 && row.rings === 0 && row.seam === false && row.brackets >= 8
);
const failed = [pvm, gare, tour].filter((row) => !row.lockHeld);
if (
  moveDom.state !== 'move'
  || hoverDom.state !== 'hover'
  || targetedDom.state !== 'dwell'
  || !noWheels
  || failed.length
  || !report.secondAcquisition.changed
  || !report.clear.cleared
  || !report.pvmAcquisition.persisted
  || !report.objectRefContract
  || featureCount !== 571
) {
  throw new Error('V4.2 validation failed: ' + JSON.stringify(report, null, 2));
}

console.log(JSON.stringify({ ok: true, report, shots }, null, 2));
