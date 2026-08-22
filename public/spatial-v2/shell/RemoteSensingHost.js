/**
 * REMOTE SENSING is a top-level Spatial command, not a ground mode and not a layer.
 * It keeps the current MapView, waits for an operator AOI, then paints EO on that map.
 */

import { importArc } from '../map/arcgis-sdk.js';
import { getMapView } from '../map/map-foundation.js';
import { getActiveSpatialFocus } from '../map/spatial-focus.js';
import { setInspectorRegion } from './ContextInspector.js';
import {
  DEFAULT_PROOF_AOI,
  bboxAroundPoint,
  bboxFromRings,
  formatAoiLabel,
  validateAoi
} from '../imagery/eo/eo-aoi.js';
import {
  askEoBrain,
  overlayFromReceipt,
  probeEo,
  runEo
} from '../imagery/eo/eo-client.js';
import {
  captureFromReceipt,
  followUpQuestions,
  formatProbeReadout,
  overlayCaptionText,
  presentBrainResult
} from '../imagery/eo/eo-brain-view.js';
import {
  clearAoiBox,
  clearCompareBox,
  clearDrawPreview,
  clearEoOverlay,
  clearProbePin,
  goToAoi,
  paintAoiBox,
  paintCompareBox,
  paintDrawPreviewScreen,
  paintEoOverlay,
  paintOverlayCaption,
  paintProbePin,
  setOverlayStale
} from '../imagery/eo/eo-overlay-layer.js';

const PRODUCTS = Object.freeze([
  { id: 'EO.NDVI', label: 'NDVI' },
  { id: 'EO.SURFACE_TEMPERATURE', label: 'HEAT' },
  { id: 'EO.SAR_CHANGE', label: 'RADAR' }
]);

const FOCUS_LAYER_ID = 'iqai-v2-spatial-focus';

const FALLBACK_STOPS = Object.freeze({
  lst: [
    { t: 0, color: 'rgb(20, 30, 90)' },
    { t: 0.35, color: 'rgb(40, 140, 160)' },
    { t: 0.55, color: 'rgb(240, 220, 80)' },
    { t: 0.75, color: 'rgb(230, 120, 40)' },
    { t: 1, color: 'rgb(160, 20, 20)' }
  ],
  ndvi: [
    { t: 0, color: 'rgb(92, 64, 51)' },
    { t: 0.35, color: 'rgb(194, 178, 128)' },
    { t: 0.55, color: 'rgb(140, 170, 90)' },
    { t: 1, color: 'rgb(20, 90, 40)' }
  ],
  sar: [
    { t: 0, color: 'rgb(30, 60, 140)' },
    { t: 0.5, color: 'rgb(240, 240, 240)' },
    { t: 1, color: 'rgb(160, 20, 30)' }
  ]
});

function $(root, selector) {
  return root.querySelector(selector);
}

function formatNum(value, digits) {
  const n = Number(value);
  return Number.isFinite(n) ? n.toFixed(digits) : '—';
}

function legendFromReceipt(receipt) {
  const overlay = overlayFromReceipt(receipt);
  if (overlay.legend?.title || overlay.legend?.stops) return overlay.legend;
  const measurement = receipt?.measurement || {};
  const command = receipt?.command;
  if (command === 'EO.SURFACE_TEMPERATURE') {
    return {
      kind: 'lst',
      title: 'LAND SURFACE TEMPERATURE °C',
      units: '°C',
      mean: measurement.mean,
      median: measurement.median,
      dataMin: measurement.min,
      dataMax: measurement.max,
      min: measurement.min,
      max: measurement.max,
      validPixels: receipt.qa?.validPixelCount,
      warning: 'SURFACE TEMPERATURE — NOT AIR TEMPERATURE',
      lowLabel: 'COOLER',
      highLabel: 'WARMER',
      ticks: [measurement.min, measurement.mean, measurement.max].filter((n) => Number.isFinite(Number(n))),
      stops: FALLBACK_STOPS.lst
    };
  }
  if (command === 'EO.NDVI') {
    return {
      kind: 'ndvi',
      title: 'NDVI',
      units: 'index',
      mean: measurement.mean,
      median: measurement.median,
      dataMin: measurement.min,
      dataMax: measurement.max,
      validPixels: receipt.qa?.validPixelCount,
      warning: 'SPECTRAL GREENNESS — NOT VEGETATION TYPE',
      lowLabel: 'LOW',
      highLabel: 'HIGH',
      ticks: [-1, 0, 0.25, 0.5, 0.75, 1],
      stops: FALLBACK_STOPS.ndvi
    };
  }
  if (command === 'EO.SAR_CHANGE') {
    return {
      kind: 'sar',
      title: 'SAR CHANGE dB',
      units: 'dB',
      mean: measurement.mean,
      median: measurement.median,
      dataMin: measurement.min,
      dataMax: measurement.max,
      validPixels: receipt.qa?.validPixelCount,
      warning: 'RADAR CHANGE — NOT LAND COVER CLASS',
      lowLabel: 'DECREASE',
      highLabel: 'INCREASE',
      ticks: [measurement.min, 0, measurement.max].filter((n) => Number.isFinite(Number(n))),
      stops: FALLBACK_STOPS.sar
    };
  }
  return null;
}

async function bboxFromView(view) {
  if (!view?.extent) return null;
  let extent = view.extent;
  const wkid = Number(extent.spatialReference?.wkid || extent.spatialReference?.latestWkid);
  if (wkid && wkid !== 4326) {
    const webMercatorUtils = await importArc('@arcgis/core/geometry/support/webMercatorUtils.js');
    if (typeof webMercatorUtils.webMercatorToGeographic === 'function') {
      extent = webMercatorUtils.webMercatorToGeographic(extent);
    }
  }
  return validateAoi([extent.xmin, extent.ymin, extent.xmax, extent.ymax]).bbox
    || [extent.xmin, extent.ymin, extent.xmax, extent.ymax];
}

function bboxFromFocusLayer(view) {
  const layer = view?.map?.findLayerById?.(FOCUS_LAYER_ID);
  const graphics = layer?.graphics?.toArray?.() || [];
  const rings = [];
  for (const graphic of graphics) {
    const geometry = graphic?.geometry;
    if (geometry?.rings) rings.push(...geometry.rings);
  }
  return bboxFromRings(rings);
}

function productLabel(id) {
  return PRODUCTS.find((item) => item.id === id)?.label || id;
}

function legendMarkup() {
  return `
    <aside class="iqai-v2-eo-legend" data-iqai-eo-legend-panel hidden>
      <p class="iqai-v2-eo-legend__kicker" data-iqai-eo-legend-title>LEGEND</p>
      <div class="iqai-v2-eo-legend__labels">
        <span data-iqai-eo-legend-low>LOW</span>
        <span data-iqai-eo-legend-center></span>
        <span data-iqai-eo-legend-high>HIGH</span>
      </div>
      <div class="iqai-v2-eo-legend__ramp" data-iqai-eo-legend-ramp></div>
      <div class="iqai-v2-eo-legend__ticks" data-iqai-eo-legend-ticks></div>
      <dl data-iqai-eo-legend-stats></dl>
      <p class="iqai-v2-eo-legend__warn" data-iqai-eo-legend-warn></p>
      <p data-iqai-eo-meaning hidden></p>
      <p data-iqai-eo-limits hidden></p>
    </aside>
  `;
}

function probeMarkup() {
  return `
    <aside class="iqai-v2-eo-probe" data-iqai-eo-probe-panel hidden>
      <p class="iqai-v2-eo-probe__kicker">PROBE</p>
      <p data-iqai-eo-probe-hint>Click the heatmap to read this cell versus the area mean.</p>
      <p data-iqai-eo-probe-value hidden></p>
      <p data-iqai-eo-probe-versus hidden></p>
      <p data-iqai-eo-probe-qa hidden></p>
      <button type="button" data-iqai-eo-probe-brain hidden>ASK BRAIN ABOUT THIS POINT</button>
    </aside>
  `;
}

function compareMarkup() {
  return `
    <aside class="iqai-v2-eo-compare" data-iqai-eo-compare-panel hidden>
      <p class="iqai-v2-eo-compare__kicker">AREA COMPARE</p>
      <p data-iqai-eo-compare-summary></p>
    </aside>
  `;
}

function brainMarkup() {
  return `
    <aside class="iqai-v2-eo-brain" data-iqai-eo-brain-panel hidden>
      <p class="iqai-v2-eo-brain__kicker">ASK BRAIN</p>
      <p class="iqai-v2-eo-brain__question" data-iqai-eo-brain-question hidden></p>
      <p class="iqai-v2-eo-brain__kicker">ANSWER</p>
      <p data-iqai-eo-brain-answer>Ask a follow-up about this measurement.</p>
      <p class="iqai-v2-eo-brain__kicker">WHAT THAT MEANS</p>
      <p data-iqai-eo-brain-meaning hidden></p>
      <p class="iqai-v2-eo-brain__kicker">LIMIT</p>
      <p data-iqai-eo-brain-limit hidden></p>
      <p class="iqai-v2-eo-brain__kicker">FOLLOW-UP</p>
      <div class="iqai-v2-eo-brain__followups" data-iqai-eo-brain-followups></div>
      <details class="iqai-v2-eo-brain__details">
        <summary>DETAILS</summary>
        <pre data-iqai-eo-brain-details></pre>
      </details>
    </aside>
  `;
}

export function bindRemoteSensingHost(root, options = {}) {
  const chrome = $(root, '[data-iqai-eo-chrome]');
  const statusEl = $(root, '[data-iqai-eo-status]');
  const aoiLabelEl = $(root, '[data-iqai-eo-aoi-label]');
  const captureEl = $(root, '[data-iqai-eo-capture]');
  const productLabelEl = $(root, '[data-iqai-eo-product-label]');
  const meaningEl = $(root, '[data-iqai-eo-meaning]');
  const limitsEl = $(root, '[data-iqai-eo-limits]');
  const legendPanel = $(root, '[data-iqai-eo-legend-panel]');
  const brainPanel = $(root, '[data-iqai-eo-brain-panel]');
  const brainAnswerEl = $(root, '[data-iqai-eo-brain-answer]');
  const brainMeaningEl = $(root, '[data-iqai-eo-brain-meaning]');
  const brainLimitEl = $(root, '[data-iqai-eo-brain-limit]');
  const brainQuestionEl = $(root, '[data-iqai-eo-brain-question]');
  const brainFollowEl = $(root, '[data-iqai-eo-brain-followups]');
  const brainDetailsEl = $(root, '[data-iqai-eo-brain-details]');
  const probePanel = $(root, '[data-iqai-eo-probe-panel]');
  const probeHintEl = $(root, '[data-iqai-eo-probe-hint]');
  const probeValueEl = $(root, '[data-iqai-eo-probe-value]');
  const probeVersusEl = $(root, '[data-iqai-eo-probe-versus]');
  const probeQaEl = $(root, '[data-iqai-eo-probe-qa]');
  const probeBrainButton = $(root, '[data-iqai-eo-probe-brain]');
  const comparePanel = $(root, '[data-iqai-eo-compare-panel]');
  const compareSummaryEl = $(root, '[data-iqai-eo-compare-summary]');
  const runButton = $(root, '[data-iqai-eo-run]');
  const brainButton = $(root, '[data-iqai-eo-brain]');
  if (!chrome) return null;

  let open = false;
  let drawing = false;
  let drawingCompare = false;
  let analyzing = false;
  let product = 'EO.NDVI';
  let aoi = null;
  let aoiSource = null;
  let receipt = null;
  let compareReceipt = null;
  let lastProbe = null;
  let lastQuestion = '';
  let dragHandle = null;
  let clickHandle = null;
  let dragStart = null;

  function setStatus(text, isError = false) {
    if (!statusEl) return;
    statusEl.textContent = text;
    statusEl.dataset.iqaiEoError = isError ? 'true' : 'false';
  }

  function paintProduct() {
    for (const button of root.querySelectorAll('[data-iqai-eo-product]')) {
      const id = button.getAttribute('data-iqai-eo-product');
      const selected = id === product;
      button.setAttribute('aria-pressed', selected ? 'true' : 'false');
      button.classList.toggle('is-selected', selected);
      button.textContent = selected ? `${productLabel(id)} · SELECTED` : productLabel(id);
    }
    if (productLabelEl) {
      productLabelEl.hidden = false;
      productLabelEl.textContent = `SELECTED · ${productLabel(product)}`;
    }
    paintStaleOverlay();
  }

  function paintRunButton() {
    if (!runButton) return;
    runButton.disabled = !aoi || analyzing;
    if (analyzing) {
      runButton.textContent = `ANALYZING ${productLabel(product)}…`;
      runButton.setAttribute('aria-busy', 'true');
      runButton.setAttribute('aria-pressed', 'true');
      runButton.classList.add('is-analyzing');
      return;
    }
    runButton.removeAttribute('aria-busy');
    runButton.classList.remove('is-analyzing');
    if (receipt?.status === 'ROUTED' && receipt.command === product) {
      runButton.textContent = `ANALYZED · ${productLabel(product)}`;
      runButton.setAttribute('aria-pressed', 'true');
      return;
    }
    runButton.textContent = `ANALYZE ${productLabel(product)}`;
    runButton.setAttribute('aria-pressed', 'false');
  }

  function paintAoiState() {
    paintRunButton();
    if (aoiLabelEl) aoiLabelEl.textContent = aoi ? `${aoiSource || 'AOI'} · ${formatAoiLabel(aoi)}` : 'AOI NOT SET';
    if (captureEl) {
      const stamp = captureFromReceipt(receipt);
      captureEl.hidden = !stamp;
      captureEl.textContent = stamp ? `CAPTURED ${stamp}` : '';
    }
    for (const button of root.querySelectorAll('[data-iqai-remote-sensing-toggle]')) {
      button.setAttribute('aria-pressed', open ? 'true' : 'false');
    }
    chrome.hidden = !open;
    if (!open && legendPanel) legendPanel.hidden = true;
    if (!open && brainPanel) brainPanel.hidden = true;
    if (!open && probePanel) probePanel.hidden = true;
    if (!open && comparePanel) comparePanel.hidden = true;
  }

  function paintLegend() {
    const legend = legendFromReceipt(receipt);
    if (!legendPanel) return;
    if (!open || receipt?.status !== 'ROUTED' || !legend) {
      legendPanel.hidden = true;
      return;
    }
    legendPanel.hidden = false;
    const title = $(root, '[data-iqai-eo-legend-title]');
    const low = $(root, '[data-iqai-eo-legend-low]');
    const high = $(root, '[data-iqai-eo-legend-high]');
    const center = $(root, '[data-iqai-eo-legend-center]');
    const ramp = $(root, '[data-iqai-eo-legend-ramp]');
    const ticks = $(root, '[data-iqai-eo-legend-ticks]');
    const stats = $(root, '[data-iqai-eo-legend-stats]');
    const warn = $(root, '[data-iqai-eo-legend-warn]');
    if (title) title.textContent = legend.title || 'LEGEND';
    if (low) low.textContent = legend.lowLabel || 'LOW';
    if (high) high.textContent = legend.highLabel || 'HIGH';
    if (center) center.textContent = legend.centerLabel || '';
    if (ramp) {
      const gradient = (legend.stops || []).map((stop) => `${stop.color} ${Math.round(Number(stop.t) * 100)}%`).join(', ');
      ramp.style.background = `linear-gradient(to right, ${gradient || '#000, #fff'})`;
    }
    if (ticks) {
      ticks.replaceChildren();
      for (const tick of legend.ticks || []) {
        const span = document.createElement('span');
        span.textContent = legend.kind === 'ndvi' ? formatNum(tick, 2) : String(tick);
        ticks.append(span);
      }
    }
    if (stats) {
      stats.replaceChildren();
      const digits = legend.kind === 'ndvi' ? 3 : 1;
      const unit = legend.kind === 'lst' ? ' °C' : '';
      const rows = legend.kind === 'lst'
        ? [
          ['AOI MEAN', `${formatNum(legend.mean, 1)}${unit}`],
          ['MEDIAN', `${formatNum(legend.median, 1)}${unit}`],
          ['MIN', `${formatNum(legend.dataMin, 1)}${unit}`],
          ['MAX', `${formatNum(legend.dataMax, 1)}${unit}`]
        ]
        : [
          ['MEAN', formatNum(legend.mean, digits)],
          ['MEDIAN', formatNum(legend.median, digits)]
        ];
      rows.push(['VALID PIXELS', legend.validPixels ?? '—']);
      const stamp = captureFromReceipt(receipt);
      if (stamp) rows.push(['CAPTURED', stamp]);
      for (const [label, value] of rows) {
        const dt = document.createElement('dt');
        dt.textContent = label;
        const dd = document.createElement('dd');
        dd.textContent = String(value);
        stats.append(dt, dd);
      }
    }
    if (warn) warn.textContent = legend.warning || '';
  }

  function paintReceipt() {
    const meaning = receipt?.explain?.what || receipt?.meaning || '';
    const measurement = receipt?.explain?.measurement || '';
    const limits = Array.isArray(receipt?.limitations) ? receipt.limitations.join(' ') : '';
    if (meaningEl) {
      meaningEl.hidden = !meaning || receipt?.status === 'ROUTED';
      meaningEl.textContent = [meaning, measurement].filter(Boolean).join(' ');
    }
    if (limitsEl) {
      limitsEl.hidden = !limits || receipt?.status === 'ROUTED';
      limitsEl.textContent = limits;
    }
    paintLegend();
    paintFollowUps();
    if (brainButton) brainButton.hidden = receipt?.status !== 'ROUTED';
    if (brainPanel) brainPanel.hidden = !open || receipt?.status !== 'ROUTED';
    paintProbePanel();
    paintComparePanel();
    paintStaleOverlay();
    if (receipt?.status === 'ROUTED' && !lastQuestion) {
      paintBrainView({
        answer: receipt.explain?.measurement || receipt.explain?.what || '',
        limitations: receipt.limitations
      });
    }
  }

  function paintFollowUps() {
    if (!brainFollowEl) return;
    brainFollowEl.replaceChildren();
    for (const question of followUpQuestions(receipt)) {
      const button = document.createElement('button');
      button.type = 'button';
      button.setAttribute('data-iqai-eo-followup', question);
      button.setAttribute('aria-pressed', question === lastQuestion ? 'true' : 'false');
      button.textContent = question;
      brainFollowEl.append(button);
    }
  }

  function paintBrainView(payload) {
    const view = presentBrainResult(payload, receipt);
    if (brainPanel) brainPanel.hidden = !open || receipt?.status !== 'ROUTED';
    if (brainQuestionEl) {
      brainQuestionEl.hidden = !view.question;
      brainQuestionEl.textContent = view.question;
    }
    if (brainAnswerEl) {
      brainAnswerEl.hidden = false;
      brainAnswerEl.textContent = view.answer;
    }
    if (brainMeaningEl) {
      brainMeaningEl.hidden = !view.meaning;
      brainMeaningEl.textContent = view.meaning;
    }
    if (brainLimitEl) {
      brainLimitEl.hidden = !view.limit;
      brainLimitEl.textContent = view.limit;
    }
    if (brainDetailsEl) {
      brainDetailsEl.textContent = view.details ? JSON.stringify(view.details, null, 2) : '';
    }
    paintFollowUps();
  }

  function paintStaleOverlay() {
    if (!receipt || receipt.status !== 'ROUTED' || product === receipt.command) {
      setOverlayStale('');
      return;
    }
    setOverlayStale(`SHOWING ${productLabel(receipt.command)} — ${productLabel(product)} NOT ANALYZED YET`);
  }

  function paintProbePanel() {
    if (!probePanel) return;
    const ready = open && receipt?.status === 'ROUTED';
    probePanel.hidden = !ready;
    const readout = lastProbe ? formatProbeReadout(lastProbe, receipt) : null;
    if (probeHintEl) {
      probeHintEl.hidden = Boolean(readout);
      probeHintEl.textContent = 'Click the heatmap to read this cell versus the area mean.';
    }
    if (probeValueEl) {
      probeValueEl.hidden = !readout;
      probeValueEl.textContent = readout?.label || '';
    }
    if (probeVersusEl) {
      probeVersusEl.hidden = !readout?.versus;
      probeVersusEl.textContent = readout?.versus || '';
    }
    if (probeQaEl) {
      probeQaEl.hidden = !readout;
      probeQaEl.textContent = readout?.qa || '';
    }
    if (probeBrainButton) probeBrainButton.hidden = lastProbe?.status !== 'VALID';
  }

  function paintComparePanel() {
    if (!comparePanel) return;
    if (!compareReceipt || compareReceipt.status !== 'ROUTED' || !receipt) {
      comparePanel.hidden = true;
      return;
    }
    const a = Number(receipt.measurement?.mean);
    const b = Number(compareReceipt.measurement?.mean);
    const unit = receipt.command === 'EO.SURFACE_TEMPERATURE' ? ' °C' : receipt.command === 'EO.SAR_CHANGE' ? ' dB' : '';
    const digits = receipt.command === 'EO.NDVI' ? 2 : 1;
    let text = `AREA A ${Number.isFinite(a) ? a.toFixed(digits) + unit : '—'} · AREA B ${Number.isFinite(b) ? b.toFixed(digits) + unit : '—'}`;
    if (Number.isFinite(a) && Number.isFinite(b)) {
      const delta = b - a;
      text += ` · Δ ${delta > 0 ? '+' : ''}${delta.toFixed(digits)}${unit}`;
    }
    comparePanel.hidden = !open;
    if (compareSummaryEl) compareSummaryEl.textContent = text;
  }

  function writeInspector() {
    if (!receipt) return;
    const overlay = overlayFromReceipt(receipt);
    const scene = receipt.scenes?.[0] || {};
    const measurement = receipt.measurement || {};
    setInspectorRegion(root, 'evidence-slot', {
      stateLabel: receipt.status === 'ROUTED' ? 'MEASURED' : receipt.status || 'EO',
      body: [
        receipt.command,
        receipt.explain?.what || '',
        measurement.mean != null ? `MEAN ${measurement.mean} ${measurement.units || ''}`.trim() : '',
        scene.platform ? `SENSOR ${scene.platform} ${scene.sensor || ''}`.trim() : '',
        scene.captureStart ? `CAPTURE ${scene.captureStart}` : '',
        scene.resolutionNative ? `RESOLUTION ${scene.resolutionNative} m native / ${scene.resolutionDelivered || 'UNKNOWN'} m delivered` : '',
        overlay.dataUrl ? 'OVERLAY ON MAP' : 'NO OVERLAY'
      ].filter(Boolean).join('\n')
    });
    setInspectorRegion(root, 'execution-receipt-slot', {
      stateLabel: receipt.brainReady ? 'BRAIN READY' : receipt.status || 'EO',
      body: JSON.stringify({
        receiptId: receipt.receiptId,
        command: receipt.command,
        status: receipt.status,
        aoi: receipt.aoi?.bbox || aoi,
        measurement: receipt.measurement,
        limitations: receipt.limitations,
        overlayExcluded: true
      }, null, 2)
    });
    setInspectorRegion(root, 'provenance-slot', {
      stateLabel: 'EO SOURCE',
      body: [
        scene.product || receipt.method?.id || receipt.command,
        scene.attribution || '',
        scene.license || '',
        `METHOD ${receipt.method?.id || 'UNKNOWN'} v${receipt.method?.version || 'UNKNOWN'}`
      ].filter(Boolean).join('\n')
    });
    const brainState = root.querySelector('[data-iqai-brain-state]');
    if (brainState) brainState.textContent = receipt.brainReady ? 'EO PACKAGE READY' : (receipt.status || 'EO');
  }

  async function setAoi(next, source, { frame = false } = {}) {
    const checked = validateAoi(next);
    if (!checked.ok) {
      setStatus(checked.error, true);
      return false;
    }
    aoi = checked.bbox;
    aoiSource = source;
    paintAoiBox(aoi);
    paintAoiState();
    if (frame) await goToAoi(aoi);
    setStatus(`AOI SET · ${source}. Choose a product, then ANALYZE. Nothing runs until you ask.`);
    return true;
  }

  async function useSelection() {
    const view = getMapView();
    const fromLot = bboxFromFocusLayer(view);
    if (fromLot && (await setAoi(fromLot, 'SELECTION'))) return;
    const focus = getActiveSpatialFocus();
    if (focus) {
      const around = bboxAroundPoint(focus.longitude, focus.latitude);
      if (around && (await setAoi(around, 'PIN NEIGHBORHOOD'))) return;
    }
    setStatus('No selected area. Drop a pin or draw a box.', true);
  }

  async function useCurrentView() {
    const bbox = await bboxFromView(getMapView());
    const checked = validateAoi(bbox);
    if (!checked.ok) {
      setStatus(checked.error || 'Current view is too large. Zoom in or draw a smaller box.', true);
      return;
    }
    await setAoi(checked.bbox, 'CURRENT VIEW');
  }

  function stopDrawing() {
    drawing = false;
    drawingCompare = false;
    dragStart = null;
    dragHandle?.remove?.();
    dragHandle = null;
    clearDrawPreview();
    const view = getMapView();
    if (view?.container) {
      view.container.style.cursor = receipt?.status === 'ROUTED' ? 'crosshair' : '';
    }
    const drawButton = $(root, '[data-iqai-eo-draw]');
    if (drawButton) drawButton.setAttribute('aria-pressed', 'false');
  }

  async function startDrawing({ compare = false } = {}) {
    const view = getMapView();
    if (!view) {
      setStatus('Map is not ready.', true);
      return;
    }
    stopDrawing();
    drawing = true;
    drawingCompare = compare === true;
    view.container.style.cursor = 'crosshair';
    const drawButton = $(root, '[data-iqai-eo-draw]');
    if (drawButton) drawButton.setAttribute('aria-pressed', drawingCompare ? 'false' : 'true');
    setStatus(drawingCompare
      ? 'Drag a second box to compare with this area. Analysis of box B starts when you finish the box.'
      : 'Drag a box on the map. You should see the outline while dragging. Analysis waits for ANALYZE.');
    dragHandle = view.on('drag', (event) => {
      if (!drawing) return;
      event.stopPropagation();
      const screen = { x: Number(event.x), y: Number(event.y) };
      const point = view.toMap(event) || view.toMap(screen);
      if (event.action === 'start') {
        dragStart = {
          x: screen.x,
          y: screen.y,
          lon: Number(point?.longitude),
          lat: Number(point?.latitude)
        };
        paintDrawPreviewScreen(dragStart, dragStart, { compare: drawingCompare });
        return;
      }
      if (!dragStart) return;
      paintDrawPreviewScreen(dragStart, screen, { compare: drawingCompare });
      if (event.action === 'end') {
        const lon = Number(point?.longitude);
        const lat = Number(point?.latitude);
        const bbox = [
          Math.min(dragStart.lon, lon),
          Math.min(dragStart.lat, lat),
          Math.max(dragStart.lon, lon),
          Math.max(dragStart.lat, lat)
        ];
        const wasCompare = drawingCompare;
        stopDrawing();
        if (wasCompare) void analyzeCompare(bbox);
        else void setAoi(bbox, 'DRAWN BOX');
      }
    });
  }

  async function analyze() {
    const checked = validateAoi(aoi);
    if (!checked.ok) {
      setStatus(checked.error, true);
      return;
    }
    analyzing = true;
    paintRunButton();
    setStatus(`ANALYZING ${productLabel(product)}… Looking for qualified observations.`);
    try {
      const { payload } = await runEo({ command: product, bbox: checked.bbox });
      receipt = payload;
      lastQuestion = '';
      const overlay = overlayFromReceipt(payload);
      if (payload.status === 'ROUTED' && overlay.dataUrl) {
        await paintEoOverlay(overlay);
        paintOverlayCaption(overlayCaptionText(payload));
        lastProbe = null;
        clearProbePin();
        const stamp = captureFromReceipt(payload);
        setStatus([
          `ANALYZED · ${productLabel(product)}`,
          payload.explain?.measurement || payload.explain?.what || 'MEASUREMENT ON MAP',
          stamp ? `CAPTURED ${stamp}` : '',
          'Click the heatmap to read a cell.'
        ].filter(Boolean).join(' · '));
      } else {
        await clearEoOverlay();
        setStatus(payload.error || payload.status || 'NO QUALIFIED OBSERVATION', payload.status !== 'ROUTED');
      }
      paintReceipt();
      writeInspector();
    } catch (error) {
      setStatus(error.message || String(error), true);
    } finally {
      analyzing = false;
      paintAoiState();
    }
  }

  async function askBrain(question) {
    if (!receipt?.receiptId) return;
    const asked = String(question || '').trim() || 'WHAT AM I LOOKING AT?';
    lastQuestion = asked;
    if (brainPanel) brainPanel.hidden = false;
    if (brainAnswerEl) {
      brainAnswerEl.hidden = false;
      brainAnswerEl.textContent = 'ASKING BRAIN…';
    }
    if (brainQuestionEl) {
      brainQuestionEl.hidden = false;
      brainQuestionEl.textContent = asked;
    }
    paintFollowUps();
    const { payload } = await askEoBrain({
      question: asked,
      eoReceiptId: receipt.receiptId,
      probeId: lastProbe?.probeId || null
    });
    paintBrainView(payload);
    const brainState = root.querySelector('[data-iqai-brain-state]');
    if (brainState) brainState.textContent = payload.status === 'PACKAGE_ONLY' ? 'EO PACKAGE ONLY' : 'EO BRAIN ANSWER';
  }

  async function analyzeCompare(bbox) {
    const checked = validateAoi(bbox);
    if (!checked.ok) {
      setStatus(checked.error, true);
      return;
    }
    if (!receipt?.receiptId) {
      setStatus('Analyze the first area before comparing.', true);
      return;
    }
    paintCompareBox(checked.bbox);
    analyzing = true;
    paintRunButton();
    setStatus(`ANALYZING COMPARISON ${productLabel(receipt.command)}…`);
    try {
      const { payload } = await runEo({ command: receipt.command, bbox: checked.bbox });
      compareReceipt = payload;
      if (payload.status === 'ROUTED') {
        paintComparePanel();
        const a = receipt.measurement?.mean;
        const b = payload.measurement?.mean;
        setStatus(`AREA COMPARE READY · A ${a ?? '—'} · B ${b ?? '—'}. Overlay stays on area A.`);
      } else {
        setStatus(payload.error || 'Comparison area had no qualified observation.', true);
      }
    } catch (error) {
      setStatus(error.message || String(error), true);
    } finally {
      analyzing = false;
      paintAoiState();
      paintComparePanel();
    }
  }

  async function runTimeCompare() {
    if (!receipt?.receiptId) return;
    if (receipt.command === 'EO.NDVI') {
      analyzing = true;
      paintRunButton();
      setStatus('LOOKING FOR A SAME-SEASON SECOND DATE…');
      try {
        const { payload } = await runEo({ command: 'EO.NDVI', bbox: aoi, compare: true });
        receipt = payload;
        lastQuestion = 'HAS THIS CHANGED OVER TIME?';
        const overlay = overlayFromReceipt(payload);
        if (payload.status === 'ROUTED' && overlay.dataUrl) {
          await paintEoOverlay(overlay);
          paintOverlayCaption(overlayCaptionText(payload));
        }
        setStatus(payload.explain?.measurement || payload.explain?.what || payload.error || 'TIME COMPARE');
        paintReceipt();
        writeInspector();
        await askBrain('HAS THIS CHANGED OVER TIME?');
      } catch (error) {
        setStatus(error.message || String(error), true);
      } finally {
        analyzing = false;
        paintAoiState();
      }
      return;
    }
    if (receipt.command === 'EO.SAR_CHANGE') {
      setStatus(`Radar already compares two dates: ${captureFromReceipt(receipt) || 'see caption'}.`);
      await askBrain('HAS THIS CHANGED OVER TIME?');
      return;
    }
    setStatus('V1 HEAT is one Landsat date. Neighborhood difference is not change over time. Radar or NDVI compare can show change.');
    await askBrain('HAS THIS CHANGED OVER TIME?');
  }

  async function probeAt(event) {
    if (!open || drawing || !receipt?.receiptId || receipt.status !== 'ROUTED') return;
    event?.stopPropagation?.();
    const mapPoint = event?.mapPoint;
    const lat = Number(mapPoint?.latitude);
    const lon = Number(mapPoint?.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
    const { payload } = await probeEo({ lat, lon, receiptId: receipt.receiptId });
    lastProbe = payload;
    paintProbePin(lon, lat);
    paintProbePanel();
    const readout = formatProbeReadout(payload, receipt);
    setStatus([readout.label, readout.versus].filter(Boolean).join(' · ') || 'PROBE');
  }

  async function clearAll() {
    aoi = null;
    aoiSource = null;
    receipt = null;
    compareReceipt = null;
    lastProbe = null;
    lastQuestion = '';
    stopDrawing();
    clearAoiBox();
    clearCompareBox();
    clearProbePin();
    await clearEoOverlay();
    paintReceipt();
    paintAoiState();
    setStatus('AOI cleared. Draw a box or choose selection / current view. Nothing runs until you ask.');
    if (brainAnswerEl) brainAnswerEl.textContent = '';
    if (brainMeaningEl) {
      brainMeaningEl.hidden = true;
      brainMeaningEl.textContent = '';
    }
    if (brainLimitEl) {
      brainLimitEl.hidden = true;
      brainLimitEl.textContent = '';
    }
    if (brainDetailsEl) brainDetailsEl.textContent = '';
    if (brainFollowEl) brainFollowEl.replaceChildren();
  }

  async function applyDefaultAoi() {
    const checked = validateAoi(DEFAULT_PROOF_AOI.bbox);
    if (!checked.ok) return;
    await setAoi(checked.bbox, DEFAULT_PROOF_AOI.label, { frame: true });
    setStatus('Default mixed-proof area is drawn. Press ANALYZE when you want a measurement, or draw a new box.');
  }

  async function setOpen(next) {
    open = next === true;
    if (open) {
      await options.ensureMapVisible?.();
      const view = getMapView();
      clickHandle?.remove?.();
      clickHandle = view?.on?.('click', (event) => { void probeAt(event); }) || null;
      if (receipt?.status === 'ROUTED' && view?.container) view.container.style.cursor = 'crosshair';
      if (!aoi) await applyDefaultAoi();
      else {
        paintAoiBox(aoi);
        setStatus(receipt?.status === 'ROUTED'
          ? 'Click the heatmap to read a cell, or ANALYZE again.'
          : 'Keep this map. Draw a new box, or ANALYZE the current area.');
      }
    } else {
      clickHandle?.remove?.();
      clickHandle = null;
      stopDrawing();
      const view = getMapView();
      if (view?.container) view.container.style.cursor = '';
    }
    paintProduct();
    paintAoiState();
    paintLegend();
  }

  root.addEventListener('click', (event) => {
    const toggle = event.target.closest('[data-iqai-remote-sensing-toggle]');
    if (toggle && root.contains(toggle)) {
      event.preventDefault();
      void setOpen(!open);
      return;
    }
    if (!open) return;
    if (event.target.closest('[data-iqai-eo-draw]')) {
      void startDrawing();
      return;
    }
    if (event.target.closest('[data-iqai-eo-selection]')) {
      void useSelection();
      return;
    }
    if (event.target.closest('[data-iqai-eo-view]')) {
      void useCurrentView();
      return;
    }
    if (event.target.closest('[data-iqai-eo-clear]')) {
      void clearAll();
      return;
    }
    if (event.target.closest('[data-iqai-eo-run]')) {
      void analyze();
      return;
    }
    if (event.target.closest('[data-iqai-eo-brain]')) {
      void askBrain('WHAT AM I LOOKING AT?');
      return;
    }
    if (event.target.closest('[data-iqai-eo-probe-brain]')) {
      void askBrain('WHAT DOES THIS PROBE VALUE MEAN?');
      return;
    }
    const follow = event.target.closest('[data-iqai-eo-followup]');
    if (follow) {
      const question = follow.getAttribute('data-iqai-eo-followup');
      if (question === 'COMPARE WITH ANOTHER AREA') {
        void startDrawing({ compare: true });
        void askBrain(question);
        return;
      }
      if (question === 'HAS THIS CHANGED OVER TIME?') {
        void runTimeCompare();
        return;
      }
      void askBrain(question);
      return;
    }
    const productButton = event.target.closest('[data-iqai-eo-product]');
    if (productButton) {
      product = productButton.getAttribute('data-iqai-eo-product') || product;
      paintProduct();
      paintRunButton();
      setStatus(`${productLabel(product)} selected. Press ANALYZE ${productLabel(product)} to measure this product.`);
    }
  });

  paintProduct();
  paintAoiState();
  setStatus('REMOTE SENSING starts with the original mixed-proof area. Analysis waits for ANALYZE.');

  return Object.freeze({
    setOpen,
    isOpen: () => open,
    snapshot: () => ({ open, aoi, aoiSource, product, receiptId: receipt?.receiptId || null }),
    close: () => setOpen(false),
    clear: async () => {
      await clearAll();
      await setOpen(false);
    }
  });
}

export function renderRemoteSensingChrome() {
  return `
    <button type="button" data-iqai-remote-sensing-toggle aria-pressed="false">REMOTE SENSING</button>
  `;
}

export function renderRemoteSensingPanel() {
  return `
    <div class="iqai-v2-imagery-command__eo" data-iqai-eo-chrome hidden>
      <p data-iqai-eo-status>Default mixed-proof area is drawn. Press ANALYZE when you want a measurement.</p>
      <div class="iqai-v2-imagery-command__eo-aoi">
        <button type="button" data-iqai-eo-draw aria-pressed="false">DRAW BOX</button>
        <button type="button" data-iqai-eo-selection>USE SELECTION</button>
        <button type="button" data-iqai-eo-view>USE CURRENT VIEW</button>
        <button type="button" data-iqai-eo-clear>CLEAR</button>
      </div>
      <div class="iqai-v2-imagery-command__eo-products">
        ${PRODUCTS.map((item, index) => `
          <button type="button" data-iqai-eo-product="${item.id}" aria-pressed="${index === 0 ? 'true' : 'false'}">${item.label}</button>
        `).join('')}
      </div>
      <button type="button" data-iqai-eo-run disabled>ANALYZE NDVI</button>
      <p data-iqai-eo-product-label>SELECTED · NDVI</p>
      <p data-iqai-eo-aoi-label>AOI NOT SET</p>
      <p data-iqai-eo-capture hidden></p>
      <button type="button" data-iqai-eo-brain hidden>ASK BRAIN</button>
    </div>
    ${legendMarkup()}
    ${probeMarkup()}
    ${compareMarkup()}
    ${brainMarkup()}
  `;
}
