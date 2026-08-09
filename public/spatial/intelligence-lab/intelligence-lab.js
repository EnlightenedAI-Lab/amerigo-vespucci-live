/**
 * IQAI Spatial — Investigation workspace (Intelligence Visual Lab).
 */

import { applySpatialBrandDocumentTitle } from '../iqai-spatial-brand.js';
import { loadLabData } from './lab-data.js';
import { computeMetricsForMode, buildRenderer, legendTitleForMode } from './lab-renderers.js';
import { LabArcgisRuntime } from './lab-arcgis-runtime.js';
import { LabHistoryChart } from './lab-chart.js';
import { buildHistoryWithOutlook, OUTLOOK_METHOD, historyWeeksForHorizon, OUTLOOK_END } from './lab-outlook.js';
import { buildOutlookSummary } from './lab-outlook-summary.js';
import {
  fetchSpvmGeojsonForLab,
  filterSpvmFeatures,
  dailyCountsForMonth,
  maxSpvmDate,
  montrealTodayYmd,
  normalizeSpvmFeature
} from './lab-spvm-filters.js';
import {
  createInitialLabState,
  GIS_DISPLAY_MODES,
  TIME_WINDOWS,
  SHIFT_FILTERS,
  AREA_TYPES,
  GRID_RESOLUTIONS,
  CHART_HORIZONS,
  recentLayerActive,
  operationalDataActive
} from './lab-state.js';
import {
  buildIntelligenceCardHtml,
  buildRawFieldsHtml,
  renderRecordsTable
} from './lab-records.js';
import { ReportedActivityCalendar } from './lab-calendar.js';
import { buildDaySummaryHtml, formatReportDateLong } from './lab-day-summary.js';
import { buildStructuredExplainContext } from './lab-explain.js';
import { buildRelatedIntelligenceRequest } from './lab-related-intelligence.js';
import {
  createCaseWorkspace,
  searchPotentiallyRelevantReports,
  saveWorkspace,
  loadWorkspace,
  resetWorkspace,
  renderCaseFormHtml,
  renderCaseWorkspaceHtml,
  wireCaseFormDialog,
  sampleCaseForm,
  createEmptyCaseForm,
  validateCaseCoverage,
  buildCaseExplainContext
} from './lab-case.js';
import {
  VIEW_MODES,
  setPdqDisplayNames,
  formatPdqId,
  formatWeekLabel,
  categoryLabel,
  baselineLabel,
  formatNumber,
  formatSigned,
  formatPercent,
  buildMapHeadline,
  buildIntelHeadline,
  buildInterpretation,
  COMPOSITION_COLORS
} from './lab-labels.js';
import { englishLabelForCategory } from '../spvm-crime-taxonomy.js';

const BASELINES = ['B0', 'B1', 'B2', 'B3', 'B4'];

let store = null;
let manifest = null;
let runtime = null;
let historyChart = null;
let lastMetrics = {};
let lastOutlook = null;
let spvmGeojson = null;
let filteredFeatures = [];
let pdqMembersById = new Map();
let arrondissements = [];
let activityCalendar = null;
let spvmDataEndDate = null;
let renderTimer = null;
let timeSliderSyncing = false;
let tableSort = { key: 'date', dir: -1 };
let caseWorkspace = null;
let allSpvmFeatures = [];
let explainHistory = [];
let explainRequestSeq = 0;
let explainRuntime = { provider: '—', model: '—', providerLabel: '—' };
/** @type {{ source: string, method: string, provenance: string, limitations: string }} */
let internalExplainMetadata = {
  source: '',
  method: '',
  provenance: '',
  limitations: ''
};

const LAYER_TOGGLE_DEFS = [
  { key: 'pdqShading', label: 'PDQ analytical shading' },
  { key: 'pdqBoundaries', label: 'PDQ boundaries' },
  { key: 'pdqLabels', label: 'PDQ labels' },
  { key: 'arrondBoundaries', label: 'Arrondissement boundaries' },
  { key: 'arrondLabels', label: 'Arrondissement labels' },
  { key: 'recentReports', label: 'Recent SPVM reports' }
];

const labState = createInitialLabState();

const els = {};

function cacheElements() {
  const ids = [
    'mode-nav', 'lab-category', 'lab-week-select', 'lab-baseline', 'comparison-field',
    'lab-time-metric', 'time-metric-field', 'ctx-category', 'ctx-week', 'ctx-recent',
    'map-headline', 'intel-headline', 'metric-cards', 'intel-interpretation',
    'explain-form', 'explain-input', 'explain-submit', 'explain-response', 'explain-model',
    'chart-outlook-summary', 'lab-f1-unavailable',
    'lab-f1-banner', 'lab-time-slider-host', 'lab-clear-selection', 'chart-container',
    'chart-drawer', 'chart-toggle', 'chart-scope', 'chart-horizon', 'outlook-badge',
    'chart-forecast-strip', 'chart-horizon-tabs', 'chart-head', 'chart-head-title',
    'chart-horizon-status', 'app-body',
    'view-all-sectors', 'sectors-modal', 'close-sectors-modal', 'sectors-table-wrap',
    'layers-toggles', 'lab-gis-mode', 'lab-time-window', 'lab-shift', 'lab-area-type',
    'lab-area-id', 'area-id-field', 'area-id-label', 'grid-res-field', 'lab-grid-resolution',
    'view-records-btn', 'view-historical-records-btn', 'records-drawer', 'records-table-wrap',
    'close-records-drawer', 'records-drawer-title', 'raw-fields-host', 'intel-card-host',
    'lab-gis-legend', 'activity-calendar-host', 'reported-activity-header', 'day-summary-host',
    'case-create-btn', 'case-create-dialog', 'case-form-body', 'case-workspace-host', 'intel-analytics-block'
  ];
  for (const id of ids) els[id] = document.getElementById(id);
}

function effectiveMapMode() {
  if (labState.visualMode === 'timeTravel') return labState.timeMapMetric;
  return labState.visualMode;
}

function buildPdqMembersMap(geoFeatures) {
  pdqMembersById = new Map(
    geoFeatures.map((f) => [
      f.properties.harmonized_pdq_id,
      new Set((f.properties.component_pdqs || f.properties.source_pdq_values || []).map(String))
    ])
  );
}

function spvmFilterContext() {
  return {
    timeWindow: labState.timeWindow,
    reportDate: labState.reportDate,
    crimeCategory: labState.crimeCategory,
    shift: labState.shift,
    areaType: labState.areaType,
    areaId: labState.areaId,
    pdqMembers: labState.areaType === 'pdq' && labState.areaId
      ? pdqMembersById.get(labState.areaId)
      : null,
    pointInArea: labState.areaType === 'arrondissement' && labState.areaId && runtime
      ? (lng, lat) => runtime.pointInArrondissement(labState.areaId, lng, lat)
      : null
  };
}

function calendarFilterContext() {
  const ctx = spvmFilterContext();
  return {
    crimeCategory: ctx.crimeCategory,
    shift: ctx.shift,
    areaType: ctx.areaType,
    areaId: ctx.areaId,
    pdqMembers: ctx.pdqMembers,
    pointInArea: ctx.pointInArea
  };
}

function effectiveGisMode() {
  if (labState.gisDisplayMode === 'pdqAnalytics' && operationalDataActive(labState)) {
    return labState.reportDate ? 'incidents' : labState.gisDisplayMode;
  }
  return labState.gisDisplayMode;
}

function computeArrondCounts(features) {
  const counts = {};
  if (!runtime || labState.areaType !== 'all') return counts;
  for (const f of features) {
    const [lng, lat] = f.geometry.coordinates;
    for (const a of arrondissements) {
      if (runtime.pointInArrondissement(a.id, lng, lat)) {
        counts[a.id] = (counts[a.id] || 0) + 1;
        break;
      }
    }
  }
  return counts;
}

async function refreshFilteredFeatures() {
  if (!spvmGeojson) spvmGeojson = await fetchSpvmGeojsonForLab();
  spvmDataEndDate = maxSpvmDate(spvmGeojson);
  if (!labState.calendarMonth) {
    labState.calendarMonth = spvmDataEndDate.slice(0, 7);
  }
  filteredFeatures = filterSpvmFeatures(spvmGeojson, spvmFilterContext());
  els['view-records-btn'].textContent = `View records (${filteredFeatures.length})`;
  renderCalendar();
  renderReportedActivityHeader();
  renderDaySummary();
  return filteredFeatures;
}

function renderCalendar() {
  if (!activityCalendar || !spvmGeojson) return;
  const counts = dailyCountsForMonth(spvmGeojson, calendarFilterContext(), labState.calendarMonth);
  activityCalendar.render(labState.calendarMonth, counts, labState.reportDate, spvmDataEndDate);
}

function renderReportedActivityHeader() {
  const host = els['reported-activity-header'];
  if (!host) return;
  if (!labState.reportDate) {
    host.classList.add('lab-hidden');
    host.innerHTML = '';
    return;
  }
  host.classList.remove('lab-hidden');
  host.innerHTML = `
    <span class="reported-activity-header__eyebrow">Reported activity</span>
    <div class="reported-activity-header__date">${formatReportDateLong(labState.reportDate)}</div>
    <p class="reported-activity-header__total">${filteredFeatures.length} published report${filteredFeatures.length === 1 ? '' : 's'}</p>
    <p class="reported-activity-header__caveat">SPVM report date + shift — not exact offence occurrence time.</p>`;
}

function renderDaySummary() {
  const host = els['day-summary-host'];
  if (!host) return;
  if (!labState.reportDate) {
    host.classList.add('lab-hidden');
    host.innerHTML = '';
    return;
  }
  host.classList.remove('lab-hidden');
  host.innerHTML = buildDaySummaryHtml(filteredFeatures, labState.reportDate, {
    arrondissements,
    pointInArrond: runtime ? (id, lng, lat) => runtime.pointInArrondissement(id, lng, lat) : null,
    category: labState.crimeCategory,
    shift: labState.shift,
    areaType: labState.areaType,
    areaId: labState.areaId,
    areaName: labState.areaName
  });
}

function onCalendarMonthChange(monthYm) {
  labState.calendarMonth = monthYm;
  renderCalendar();
}

function onCalendarDaySelect(ymd) {
  labState.reportDate = ymd;
  if (ymd) {
    labState.timeWindow = 'off';
    if (els['lab-time-window']) els['lab-time-window'].value = 'off';
    if (labState.layers.recentReports === false) {
      labState.layers.recentReports = true;
      syncLayerTogglesFromState();
    }
  }
  scheduleRefresh();
}

function populateControls() {
  els['mode-nav'].innerHTML = VIEW_MODES.map(
    (m) => `<button type="button" class="mode-nav__btn${m.id === labState.visualMode ? ' is-active' : ''}" data-mode="${m.id}">${m.label}</button>`
  ).join('');

  els['lab-category'].innerHTML = store.categories
    .map((c) => `<option value="${c.replace(/"/g, '&quot;')}">${categoryLabel(c)}</option>`)
    .join('');

  els['lab-week-select'].innerHTML = store.weeks
    .map((w) => `<option value="${w}">${formatWeekLabel(w)}</option>`)
    .join('');

  els['lab-baseline'].innerHTML = BASELINES.map(
    (b) => `<option value="${b}">${baselineLabel(b)}</option>`
  ).join('');

  els['lab-gis-mode'].innerHTML = GIS_DISPLAY_MODES.map(
    (m) => `<option value="${m.id}">${m.label}</option>`
  ).join('');

  els['lab-time-window'].innerHTML = TIME_WINDOWS.map(
    (t) => `<option value="${t.id}">${t.label}</option>`
  ).join('');

  els['lab-shift'].innerHTML = SHIFT_FILTERS.map(
    (s) => `<option value="${s.id}">${s.label}</option>`
  ).join('');

  els['lab-area-type'].innerHTML = AREA_TYPES.map(
    (a) => `<option value="${a.id}">${a.label}</option>`
  ).join('');

  els['lab-grid-resolution'].innerHTML = GRID_RESOLUTIONS.map(
    (g) => `<option value="${g.id}">${g.label}</option>`
  ).join('');

  els['chart-horizon'].innerHTML = CHART_HORIZONS.map(
    (h) => `<option value="${h.id}">${h.label}</option>`
  ).join('');

  if (els['chart-horizon-tabs']) {
    els['chart-horizon-tabs'].innerHTML = CHART_HORIZONS.map(
      (h) => `<button type="button" class="chart-horizon-tab" data-horizon="${h.id}" role="tab">${h.label}</button>`
    ).join('');
  }

  ensureLayerToggles();

  labState.crimeCategory = manifest.defaultCategory || store.categories[0];
  labState.week = manifest.defaultWeek || store.weeks[store.weeks.length - 1];
  labState.baselineMode = 'B2';

  els['lab-category'].value = labState.crimeCategory;
  els['lab-week-select'].value = labState.week;
  els['lab-baseline'].value = labState.baselineMode;
  els['lab-gis-mode'].value = labState.gisDisplayMode;
  els['lab-time-window'].value = labState.timeWindow;
  els['lab-shift'].value = labState.shift;
  els['lab-area-type'].value = labState.areaType;
  els['lab-grid-resolution'].value = labState.gridResolution;
  els['chart-horizon'].value = labState.chartHorizon;

  populateAreaIdOptions();
}

function ensureLayerToggles() {
  const host = els['layers-toggles'];
  if (!host) return;
  if (host.dataset.built !== '1') {
    host.innerHTML = LAYER_TOGGLE_DEFS.map((item) => `
      <label class="layer-toggle">
        <input type="checkbox" data-layer="${item.key}" />
        <span class="layer-toggle__text">${item.label}</span>
      </label>`).join('');
    host.dataset.built = '1';
  }
  syncLayerTogglesFromState();
}

function syncLayerTogglesFromState() {
  const host = els['layers-toggles'];
  if (!host) return;
  for (const item of LAYER_TOGGLE_DEFS) {
    const input = host.querySelector(`input[data-layer="${item.key}"]`);
    if (input) input.checked = labState.layers[item.key] !== false;
  }
}

function populateAreaIdOptions() {
  const type = labState.areaType;
  els['area-id-field'].classList.toggle('lab-hidden', type === 'all');

  if (type === 'pdq') {
    els['area-id-label'].textContent = 'PDQ';
    els['lab-area-id'].innerHTML = store.pdqIds.map(
      (id) => `<option value="${id}">${formatPdqId(id)}</option>`
    ).join('');
    if (!labState.areaId) labState.areaId = store.pdqIds[0];
    els['lab-area-id'].value = labState.areaId;
    labState.areaName = formatPdqId(labState.areaId);
  } else if (type === 'arrondissement') {
    els['area-id-label'].textContent = 'Arrondissement';
    els['lab-area-id'].innerHTML = arrondissements.map(
      (a) => `<option value="${a.id}">${a.name}</option>`
    ).join('');
    if (!labState.areaId && arrondissements[0]) labState.areaId = arrondissements[0].id;
    els['lab-area-id'].value = labState.areaId;
    const a = arrondissements.find((x) => x.id === labState.areaId);
    labState.areaName = a?.name || '';
  }
}

function f1SupportedCategory() {
  return manifest?.f1?.category || manifest?.defaultCategory || 'Vol de véhicule à moteur';
}

function isF1CategorySelected() {
  return labState.crimeCategory === f1SupportedCategory();
}

function refreshInternalExplainMetadata() {
  const mode = VIEW_MODES.find((m) => m.id === labState.visualMode);
  internalExplainMetadata = {
    source:
      'SPVM published reports via IQAI operational proxy (/api/spatial/spvm/crime-90d) and frozen weekly analytical panel (PDQ polygons). '
      + 'Arrondissement boundaries: Ville de Montréal open data (CC BY 4.0), separate from PDQ police geography.',
    method: [
      `Analytical view: ${mode?.label || labState.visualMode}. ${legendTitleForMode(effectiveMapMode())}.`,
      `Map display: ${GIS_DISPLAY_MODES.find((g) => g.id === labState.gisDisplayMode)?.label}.`,
      `Comparison: ${baselineLabel(labState.baselineMode)}.`,
      `Planning outlook: ${OUTLOOK_METHOD.description}`,
      `Outlook calculation: ${OUTLOOK_METHOD.methodSteps.join(' ')}`,
      `PDQ ≠ arrondissement: police analytical geography vs municipal administrative geography.`,
      labState.visualMode === 'forecast' ? 'F1: experimental one-week-ahead MVT model only.' : ''
    ].filter(Boolean).join(' '),
    provenance:
      'Frozen harmonized PDQ Geography V1 · neighbourhood weekly panel · H1/F1 artifacts (display only) · Montreal arrondissements (official open data).',
    limitations:
      'Sector polygons are longitudinal analytical composites. Points are privacy-displaced. Planning outlook through Dec 2027 is experimental seasonal extrapolation, NOT a validated operational forecast. Arrondissement counts from points are exploratory, not PDQ model outputs.'
  };
  els['outlook-badge'].textContent = OUTLOOK_METHOD.label;
}

function buildExplainPayload() {
  const recentMode = labState.timeWindow !== 'off' ? labState.timeWindow : null;
  const pdqId = focusPdqId();
  const outlookSummary = lastOutlook
    ? buildOutlookSummary(store, labState.chartScope === 'montreal' ? null : pdqId, labState.crimeCategory, lastOutlook)
    : null;
  const ctx = buildStructuredExplainContext({
    labState,
    store,
    metrics: lastMetrics,
    focusPdqId: pdqId,
    focusMetric: focusMetric(),
    recentMode,
    chartScope: labState.chartScope,
    outlookMeta: lastOutlook,
    outlookSummary,
    filteredCount: filteredFeatures.length,
    selectedRecord: labState.selectedRecord,
    daySummary: labState.reportDate ? { reportDate: labState.reportDate, count: filteredFeatures.length } : null,
    relatedIntelligenceRequest: buildRelatedIntelligenceRequest({
      reportDate: labState.reportDate,
      timeWindow: labState.timeWindow,
      category: labState.crimeCategory
    }),
    caseContext: caseWorkspace
      ? buildCaseExplainContext(caseWorkspace, { lastMetrics, focusPdqId: focusPdqId(), labState })
      : null
  });
  ctx.workspace = { id: 'investigation', label: 'IQAI Spatial Investigation' };
  ctx.methodology = {
    ...ctx.methodology,
    methodSummary: internalExplainMetadata.method,
    limitations: internalExplainMetadata.limitations
  };
  ctx.provenance = {
    ...ctx.provenance,
    detail: internalExplainMetadata.provenance
  };
  ctx.modelRuntime = { ...explainRuntime };
  return ctx;
}

async function loadExplainRuntimeConfig() {
  try {
    const res = await fetch('/api/spatial/intelligence-lab/explain-config');
    const data = await res.json();
    if (data.ok) {
      explainRuntime = {
        provider: data.provider,
        model: data.model,
        providerLabel: data.providerLabel
      };
      if (els['explain-model']) {
        els['explain-model'].textContent = `Model: ${data.providerLabel} · ${data.model}`;
      }
    }
  } catch {
    if (els['explain-model']) els['explain-model'].textContent = 'Model: unavailable';
  }
}

async function runExplain(question) {
  const q = String(question || '').trim();
  if (!q || !els['explain-response']) return;

  const seq = ++explainRequestSeq;
  const responseEl = els['explain-response'];
  responseEl.classList.remove('lab-hidden');
  responseEl.classList.add('is-loading');
  responseEl.textContent = 'Thinking…';
  els['explain-submit'].disabled = true;

  try {
    const res = await fetch('/api/spatial/intelligence-lab/explain', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        question: q,
        context: buildExplainPayload(),
        history: explainHistory.slice(-6)
      })
    });
    const data = await res.json();
    if (seq !== explainRequestSeq) return;
    if (!res.ok || !data.ok) throw new Error(data.error || 'Explain request failed');

    explainHistory.push({ role: 'user', content: q });
    explainHistory.push({ role: 'assistant', content: data.answer });
    responseEl.textContent = data.answer;
    if (data.provider && data.model) {
      explainRuntime = {
        provider: data.provider,
        model: data.model,
        providerLabel: data.provider === 'OPENAI' ? 'OpenAI' : data.provider === 'XAI' ? 'xAI' : 'Deterministic'
      };
      if (els['explain-model']) {
        els['explain-model'].textContent = `Model: ${explainRuntime.providerLabel} · ${data.model}`;
      }
    }
  } catch (err) {
    if (seq !== explainRequestSeq) return;
    responseEl.textContent = `Could not reach IQAI explain: ${err.message}`;
  } finally {
    if (seq === explainRequestSeq) {
      responseEl.classList.remove('is-loading');
      els['explain-submit'].disabled = false;
    }
  }
}

function updateContextHeader() {
  els['ctx-category'].textContent = categoryLabel(labState.crimeCategory);
  els['ctx-week'].textContent = `Historical · ${formatWeekLabel(labState.week)}`;
  const recentEl = els['ctx-recent'];
  if (labState.reportDate) {
    recentEl.textContent = `Reported · ${formatReportDateLong(labState.reportDate)}`;
    recentEl.classList.remove('lab-hidden');
  } else if (labState.timeWindow !== 'off') {
    recentEl.textContent = TIME_WINDOWS.find((t) => t.id === labState.timeWindow)?.label || labState.timeWindow;
    recentEl.classList.remove('lab-hidden');
  } else {
    recentEl.classList.add('lab-hidden');
  }
}

function focusPdqId() {
  if (labState.areaType === 'pdq' && labState.areaId) return labState.areaId;
  return labState.selectedPdqIds[0]
    || Object.values(lastMetrics).sort((a, b) => (b.observed ?? 0) - (a.observed ?? 0))[0]?.pdqId;
}

function focusMetric() {
  const id = focusPdqId();
  return id ? lastMetrics[id] : null;
}

function card(label, value, valueClass = '') {
  return `<div class="metric-card"><div class="metric-card__label">${label}</div><div class="metric-card__value ${valueClass}">${value}</div></div>`;
}

function renderMetricCards() {
  const m = focusMetric();
  if (!m) { els['metric-cards'].innerHTML = ''; return; }
  const mode = effectiveMapMode();
  const cards = [card('Reported', formatNumber(m.observed, 0))];
  if (['deviation', 'baseline', 'observed', 'change', 'bivariate', 'timeTravel'].includes(mode)) {
    cards.push(card('Recent expectation', formatNumber(m.baseline, 1)));
  }
  if (['deviation', 'bivariate', 'change'].includes(mode) && m.deviation != null) {
    cards.push(card('Difference', formatSigned(m.deviation, 1), m.deviation > 0 ? 'is-positive' : m.deviation < 0 ? 'is-negative' : ''));
  }
  if (m.relDev != null && ['deviation', 'bivariate'].includes(mode)) {
    cards.push(card('Relative change', formatPercent(m.relDev)));
  }
  if (mode === 'change' && m.change != null) {
    cards.push(card('Vs prior 4 weeks', formatSigned(m.change, 1), m.change > 0 ? 'is-positive' : m.change < 0 ? 'is-negative' : ''));
  }
  if (mode === 'persistence') cards.push(card('Weeks above pattern', formatNumber(m.persistence, 0)));
  if (mode === 'forecast' && isF1CategorySelected() && (m.f1 || m.shadow)) {
    cards.push(card('F1 next week', formatNumber((m.f1 || m.shadow).forecast_mean, 1)));
  }
  if (recentLayerActive(labState)) {
    cards.push(card('Filtered recent reports', formatNumber(filteredFeatures.length, 0)));
  }
  els['metric-cards'].innerHTML = cards.join('');
}

function renderIntelPanel() {
  const mapMode = effectiveMapMode();
  const renderState = { ...labState, visualMode: mapMode };
  els['map-headline'].textContent = buildMapHeadline(mapMode, renderState, lastMetrics);
  els['intel-headline'].textContent = buildIntelHeadline(mapMode, renderState, lastMetrics, labState.selectedPdqIds);

  const gisMode = labState.gisDisplayMode;
  if (gisMode === 'heatmap') {
    els['map-headline'].textContent += ' · Density of SPVM published report locations (privacy-displaced)';
  }

  renderMetricCards();
  const m = focusMetric();
  const pdqName = labState.selectedPdqIds[0] ? formatPdqId(labState.selectedPdqIds[0]) : '';
  let interp = buildInterpretation(mapMode, renderState, m);
  if (pdqName && interp) interp = `${pdqName}: ${interp}`;
  els['intel-interpretation'].textContent = interp;
  updateContextHeader();
  updateGisLegend();
  refreshInternalExplainMetadata();
}

function updateGisLegend() {
  const el = els['lab-gis-legend'];
  const mode = labState.gisDisplayMode;
  if (mode === 'pdqAnalytics' || !recentLayerActive(labState)) {
    el.classList.add('lab-hidden');
    return;
  }
  const labels = {
    incidents: 'Individual SPVM published locations',
    clusters: 'Clustered published locations (click to expand)',
    heatmap: 'Density of SPVM published report locations',
    grid: `Analytical grid (${labState.gridResolution} m) of published locations`
  };
  el.textContent = labels[mode] || '';
  el.classList.remove('lab-hidden');
}

function isForecastChartMode() {
  return ['forecast', 'forecastError', 'modelAdvantage'].includes(labState.visualMode);
}

const HORIZON_STATUS_LABELS = {
  '3m': '3 MONTHS',
  '6m': '6 MONTHS',
  '12m': '12 MONTHS',
  eoy2027: 'DEC 2027'
};

function syncHorizonTabs() {
  const tabs = els['chart-horizon-tabs'];
  if (tabs) {
    tabs.querySelectorAll('[data-horizon]').forEach((btn) => {
      const active = btn.dataset.horizon === labState.chartHorizon;
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-selected', String(active));
    });
  }
  if (els['chart-horizon']) els['chart-horizon'].value = labState.chartHorizon;
}

function setChartHorizon(horizon) {
  labState.chartHorizon = horizon;
  syncHorizonTabs();
  renderChart();
}

function updateForecastChrome() {
  const forecast = isForecastChartMode();
  els['app-body']?.classList.toggle('is-forecast-mode', forecast);
  els['chart-drawer']?.classList.toggle('is-forecast-emphasis', forecast);
  els['chart-forecast-strip']?.classList.toggle('lab-hidden', !forecast);
  if (forecast) {
    els['chart-drawer']?.classList.remove('is-collapsed');
    els['chart-toggle']?.setAttribute('aria-expanded', 'true');
  }
  syncHorizonTabs();
}

function renderChart() {
  const pdqId = labState.chartScope === 'montreal' ? null : focusPdqId();
  if (!pdqId && labState.chartScope === 'pdq') return;

  const forecast = isForecastChartMode();
  const histWeeks = historyWeeksForHorizon(store, labState.chartHorizon);
  lastOutlook = buildHistoryWithOutlook(
    store, pdqId, labState.crimeCategory, labState.baselineMode, histWeeks, labState.chartHorizon
  );
  const title = labState.chartScope === 'montreal'
    ? `Montréal total — ${categoryLabel(labState.crimeCategory).toLowerCase()}`
    : `${formatPdqId(pdqId)} — weekly ${categoryLabel(labState.crimeCategory).toLowerCase()}`;

  els['chart-head']?.classList.toggle('lab-hidden', !forecast);
  if (els['chart-head-title']) els['chart-head-title'].textContent = title;
  if (els['chart-horizon-status'] && forecast) {
    const through = HORIZON_STATUS_LABELS[labState.chartHorizon] || 'DEC 2027';
    els['chart-horizon-status'].textContent = `FORECAST HORIZON · THROUGH ${through}`;
  }

  historyChart.render(lastOutlook.series, {
    title,
    selectedWeek: labState.week,
    showOutlook: true,
    forecastStartWeek: lastOutlook.forecastStartWeek,
    lastObservedWeek: lastOutlook.lastObservedWeek,
    baselineLabel: baselineLabel(labState.baselineMode),
    suppressTitle: forecast
  });

  const summary = buildOutlookSummary(store, pdqId, labState.crimeCategory, lastOutlook);
  renderOutlookSummary(summary);
}

function renderOutlookSummary(summary) {
  const host = els['chart-outlook-summary'];
  if (!host || !summary) return;
  const fmt = (v) => (v == null ? '—' : `${Number(v).toFixed(1)}`);
  host.innerHTML = `
    <div class="outlook-summary__title">${summary.title}</div>
    <div class="outlook-summary__grid">
      <div><span class="outlook-summary__label">Recent level</span><strong>${fmt(summary.recentLevel)} / week</strong></div>
      <div><span class="outlook-summary__label">2027 outlook</span><strong>${fmt(summary.outlook2027Median)} / week</strong></div>
      <div><span class="outlook-summary__label">Direction</span><strong>${summary.direction}${summary.directionPct != null && summary.direction !== '~' ? ` ${Math.abs(Math.round(summary.directionPct))}%` : ''}</strong></div>
    </div>
    <p class="outlook-summary__sentence">${summary.sentence}</p>
    <p class="outlook-summary__basis">MODEL BASIS — ${summary.modelBasis}</p>
  `;
}

function showIntelligenceCard(record) {
  labState.selectedRecord = record;
  labState.selectedRecordKey = record.properties.recordKey;
  els['intel-card-host'].innerHTML = buildIntelligenceCardHtml(record);
  els['intel-card-host'].classList.remove('lab-hidden');
  els['intel-card-host'].onclick = (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const action = btn.dataset.action;
    if (action === 'raw-fields') {
      els['raw-fields-host'].innerHTML = buildRawFieldsHtml(record);
      els['raw-fields-host'].classList.remove('lab-hidden');
      if (!labState.recordsDrawerOpen) toggleRecordsDrawer(true);
    } else if (action === 'show-pdq') {
      const pdqNum = record.properties.pdq;
      const match = store.pdqIds.find((id) => pdqMembersById.get(id)?.has(String(pdqNum)));
      if (match) selectPdq(match, false);
    } else if (action === 'view-record') {
      toggleRecordsDrawer(true);
      renderRecordsDrawer();
    }
  };
  runtime.highlightRecord(record);
}

function clearIntelligenceCard() {
  labState.selectedRecord = null;
  labState.selectedRecordKey = null;
  els['intel-card-host'].classList.add('lab-hidden');
  runtime.clearRecordHighlight();
}

function toggleRecordsDrawer(open) {
  labState.recordsDrawerOpen = open ?? !labState.recordsDrawerOpen;
  els['records-drawer'].classList.toggle('lab-hidden', !labState.recordsDrawerOpen);
  if (labState.recordsDrawerOpen) renderRecordsDrawer();
}

function renderRecordsDrawer() {
  els['records-drawer-title'].textContent = `Records (${filteredFeatures.length})`;
  els['records-table-wrap'].innerHTML = renderRecordsTable(
    filteredFeatures, labState.selectedRecordKey, tableSort
  );
  if (labState.selectedRecord) {
    els['raw-fields-host'].innerHTML = buildRawFieldsHtml(labState.selectedRecord);
  }
}

async function loadHistoricalUnderlying() {
  const pdqId = focusPdqId();
  if (!pdqId) return;
  const url = `/api/spatial/intelligence-lab/historical-records?week=${encodeURIComponent(labState.week)}&category=${encodeURIComponent(labState.crimeCategory)}&pdq=${encodeURIComponent(pdqId)}`;
  const res = await fetch(url);
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || 'Failed to load historical records');
  filteredFeatures = data.records.map((r, i) => ({
    type: 'Feature',
    geometry: r.LONGITUDE && r.LATITUDE
      ? { type: 'Point', coordinates: [Number(r.LONGITUDE), Number(r.LATITUDE)] }
      : null,
    properties: {
      recordKey: `hist-${i}-${r.DATE}-${r.PDQ}`,
      category: r.CATEGORIE,
      date: r.DATE,
      shift: r.QUART,
      shiftLabel: r.QUART,
      pdq: String(r.PDQ),
      sourceName: 'SPVM historical CSV (lab query)',
      spatialPrecision: 'SPVM published location — privacy-displaced',
      raw: r
    }
  })).filter((f) => f.geometry);
  toggleRecordsDrawer(true);
  renderRecordsDrawer();
  els['records-drawer-title'].textContent =
    `Underlying records — ${formatPdqId(pdqId)} · ${formatWeekLabel(labState.week)} (${filteredFeatures.length}${data.capped ? '+' : ''})`;
}

async function updateMapLayers() {
  const mapMode = effectiveMapMode();
  const renderState = { ...labState, visualMode: mapMode };
  lastMetrics = computeMetricsForMode(store, renderState);

  const attrs = {};
  for (const [pdqId, m] of Object.entries(lastMetrics)) {
    attrs[pdqId] = {
      mapValue: m.mapValue ?? 0,
      observed: m.observed ?? 0,
      baseline: m.baseline,
      deviation: m.deviation,
      relDev: m.relDev,
      change: m.change,
      persistence: m.persistence ?? 0,
      composition: m.composition,
      label: m.label
    };
  }

  await runtime.applyAttributes(attrs);

  runtime.clearMapHover();

  const rendererSpec = buildRenderer(store, renderState, lastMetrics);
  await runtime.applyRenderer(rendererSpec, mapMode);
  runtime.setLayerVisibility(labState.layers);
  runtime.setSelection(labState.selectedPdqIds);

  await refreshFilteredFeatures();
  const gisMode = effectiveGisMode();
  const showSpvm = operationalDataActive(labState);
  await runtime.setSpvmFeatures(
    showSpvm ? filteredFeatures : [],
    showSpvm ? gisMode : 'pdqAnalytics',
    Number(labState.gridResolution),
    gisMode === 'grid' && showSpvm
  );

  runtime.getHoverContext = () => ({
    mapMode,
    categories: COMPOSITION_COLORS,
    arrondCounts: computeArrondCounts(filteredFeatures)
  });
}

async function onTimeSliderWeekChange(week) {
  if (timeSliderSyncing || week === labState.week) return;
  timeSliderSyncing = true;
  labState.week = week;
  els['lab-week-select'].value = week;
  await updateMapLayers();
  renderIntelPanel();
  renderChart();
  timeSliderSyncing = false;
}

async function syncTimeSliderUi() {
  const isTime = labState.visualMode === 'timeTravel';
  els['lab-time-slider-host'].classList.toggle('lab-hidden', !isTime);
  els['time-metric-field'].classList.toggle('lab-hidden', !isTime);

  if (isTime) {
    if (!runtime.hasTimeSlider()) {
      await runtime.ensureTimeSlider(store.weeks, labState.week, onTimeSliderWeekChange, els['lab-time-slider-host']);
    } else if (!timeSliderSyncing) {
      runtime.setTimeSliderWeek(labState.week);
    }
  } else {
    runtime.destroyTimeSlider();
  }
}

async function refreshMap() {
  const mapMode = effectiveMapMode();
  const f1Modes = ['forecast', 'forecastError', 'modelAdvantage'];
  els['lab-f1-banner'].classList.toggle('lab-hidden', !f1Modes.includes(labState.visualMode));

  const needsComparison = ['deviation', 'baseline', 'persistence', 'bivariate', 'change', 'timeTravel'].includes(mapMode)
    || labState.visualMode === 'timeTravel';
  els['comparison-field'].classList.toggle('lab-hidden', !needsComparison);

  els['grid-res-field'].classList.toggle('lab-hidden', labState.gisDisplayMode !== 'grid');

  if (f1Modes.includes(labState.visualMode)) {
    labState.crimeCategory = manifest.defaultCategory;
    els['lab-category'].value = labState.crimeCategory;
    els['lab-category'].disabled = true;
  } else {
    els['lab-category'].disabled = false;
  }

  await updateMapLayers();
  await syncTimeSliderUi();
  renderIntelPanel();
  renderChart();
  if (labState.recordsDrawerOpen) renderRecordsDrawer();
}

function scheduleRefresh() {
  clearTimeout(renderTimer);
  renderTimer = setTimeout(() => {
    refreshMap().catch((err) => console.error('[intelligence-lab]', err));
  }, 40);
}

function setMode(mode) {
  labState.visualMode = mode;
  if (['forecast', 'forecastError', 'modelAdvantage'].includes(mode)) {
    labState.chartHorizon = 'eoy2027';
    if (els['chart-horizon']) els['chart-horizon'].value = 'eoy2027';
  }
  els['mode-nav'].querySelectorAll('.mode-nav__btn').forEach((btn) => {
    btn.classList.toggle('is-active', btn.dataset.mode === mode);
  });
  updateForecastChrome();
  if (mode !== 'timeTravel') runtime.destroyTimeSlider();
  scheduleRefresh();
}

function selectPdq(pdqId, multi) {
  if (multi) {
    labState.selectedPdqIds = labState.selectedPdqIds.includes(pdqId)
      ? labState.selectedPdqIds.filter((id) => id !== pdqId)
      : [...labState.selectedPdqIds, pdqId];
  } else {
    labState.selectedPdqIds = [pdqId];
  }
  runtime.setSelection(labState.selectedPdqIds);
  renderIntelPanel();
  renderChart();
}

function selectArrondissement(id, name) {
  labState.areaType = 'arrondissement';
  labState.areaId = id;
  labState.areaName = name;
  els['lab-area-type'].value = 'arrondissement';
  populateAreaIdOptions();
  scheduleRefresh();
}

async function ensureAllSpvmFeatures() {
  if (!spvmGeojson) spvmGeojson = await fetchSpvmGeojsonForLab();
  if (!allSpvmFeatures.length && spvmGeojson?.features?.length) {
    allSpvmFeatures = spvmGeojson.features.map((f, i) => normalizeSpvmFeature(f, i));
  }
  return allSpvmFeatures;
}

function caseSearchHelpers(caseData = caseWorkspace?.case) {
  const pdqId = caseData
    ? runtime.findPdqAtPoint(caseData.longitude, caseData.latitude)
    : null;
  return {
    pointInArrondissement: (id, lng, lat) => runtime.pointInArrondissement(id, lng, lat),
    arrondissements,
    casePdqId: pdqId
  };
}

function showCaseCoveragePreview(form, hostEl) {
  if (!hostEl || !runtime?.geoFeatures) return;
  const coverage = validateCaseCoverage(form, runtime.geoFeatures);
  hostEl.textContent = coverage.warning || '';
  hostEl.classList.toggle('lab-hidden', !coverage.warning);
}

async function openCaseFromForm(form) {
  const workspace = createCaseWorkspace(form);
  workspace.coverage = validateCaseCoverage(workspace.case, runtime.geoFeatures);
  const features = await ensureAllSpvmFeatures();
  workspace.relatedReports = searchPotentiallyRelevantReports(
    workspace.case,
    features,
    caseSearchHelpers(workspace.case)
  );
  workspace.openQuestions = [
    'Were there similar reports nearby?',
    'Did activity extend into adjacent PDQs?',
    'Were there earlier related reports?'
  ];
  caseWorkspace = workspace;
  await activateCaseWorkspace();
}

async function activateCaseWorkspace() {
  if (!caseWorkspace) return;
  caseWorkspace.coverage = validateCaseCoverage(caseWorkspace.case, runtime.geoFeatures);
  const features = await ensureAllSpvmFeatures();
  caseWorkspace.relatedReports = searchPotentiallyRelevantReports(
    caseWorkspace.case,
    features,
    caseSearchHelpers(caseWorkspace.case)
  );
  els['case-workspace-host'].classList.remove('lab-hidden');
  els['intel-analytics-block']?.classList.add('lab-hidden');
  renderCaseWorkspaceUi();
  await runtime.setCaseInvestigation(caseWorkspace.case, caseWorkspace.relatedReports, {
    selectedRecordKey: caseWorkspace.selectedRecordKey,
    pinnedRecordKeys: caseWorkspace.pinnedRecordKeys
  });
  saveWorkspace(caseWorkspace);
}

function closeCaseWorkspace() {
  caseWorkspace = null;
  els['case-workspace-host'].classList.add('lab-hidden');
  els['intel-analytics-block']?.classList.remove('lab-hidden');
  runtime.clearCaseInvestigation();
}

function renderCaseWorkspaceUi() {
  if (!caseWorkspace) return;
  const host = els['case-workspace-host'];
  host.innerHTML = renderCaseWorkspaceHtml(caseWorkspace);
  wireCaseWorkspaceEvents(host);
}

function wireCaseWorkspaceEvents(host) {
  host.querySelector('#case-close-workspace')?.addEventListener('click', () => closeCaseWorkspace());
  host.querySelector('#case-reset-demo')?.addEventListener('click', () => {
    resetWorkspace();
    closeCaseWorkspace();
  });
  host.querySelector('#case-save-workspace')?.addEventListener('click', () => {
    if (caseWorkspace) saveWorkspace(caseWorkspace);
  });
  host.querySelectorAll('[data-case-tab]').forEach((btn) => {
    btn.addEventListener('click', () => {
      caseWorkspace.activeTab = btn.dataset.caseTab;
      renderCaseWorkspaceUi();
    });
  });
  host.querySelector('#case-add-question')?.addEventListener('click', () => {
    const input = host.querySelector('#case-question-input');
    const q = input?.value?.trim();
    if (!q) return;
    caseWorkspace.openQuestions.push(q);
    input.value = '';
    renderCaseWorkspaceUi();
    saveWorkspace(caseWorkspace);
  });
  host.querySelector('#case-add-note')?.addEventListener('click', () => {
    const input = host.querySelector('#case-note-input');
    const text = input?.value?.trim();
    if (!text) return;
    caseWorkspace.notes.push({ text, at: new Date().toISOString() });
    input.value = '';
    renderCaseWorkspaceUi();
    saveWorkspace(caseWorkspace);
  });
  host.querySelectorAll('.case-pin-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const key = btn.dataset.pin;
      const idx = caseWorkspace.pinnedRecordKeys.indexOf(key);
      if (idx >= 0) caseWorkspace.pinnedRecordKeys.splice(idx, 1);
      else caseWorkspace.pinnedRecordKeys.push(key);
      renderCaseWorkspaceUi();
      runtime.setCaseInvestigation(caseWorkspace.case, caseWorkspace.relatedReports, {
        selectedRecordKey: caseWorkspace.selectedRecordKey,
        pinnedRecordKeys: caseWorkspace.pinnedRecordKeys
      });
      saveWorkspace(caseWorkspace);
    });
  });
  host.querySelectorAll('.case-select-btn, .case-related-card').forEach((el) => {
    el.addEventListener('click', (e) => {
      const key = el.dataset.recordKey || el.closest('[data-record-key]')?.dataset.recordKey;
      if (!key) return;
      selectCaseRecord(key);
    });
  });
  host.querySelectorAll('.case-tl-item').forEach((btn) => {
    btn.addEventListener('click', () => {
      caseWorkspace.selectedTimelineId = btn.dataset.timelineId;
      const key = btn.dataset.recordKey;
      if (key) selectCaseRecord(key);
      else renderCaseWorkspaceUi();
    });
  });
}

function selectCaseRecord(recordKey) {
  if (!caseWorkspace) return;
  caseWorkspace.selectedRecordKey = recordKey;
  const match = caseWorkspace.relatedReports.find((r) => r.recordKey === recordKey);
  if (match) showIntelligenceCard(match.feature);
  renderCaseWorkspaceUi();
  runtime.setCaseInvestigation(caseWorkspace.case, caseWorkspace.relatedReports, {
    selectedRecordKey: caseWorkspace.selectedRecordKey,
    pinnedRecordKeys: caseWorkspace.pinnedRecordKeys
  });
  saveWorkspace(caseWorkspace);
}

function focusCaseWorkspace() {
  if (!caseWorkspace) return;
  caseWorkspace.activeTab = 'details';
  renderCaseWorkspaceUi();
}

function openCaseCreateDialog() {
  const dialog = els['case-create-dialog'];
  els['case-form-body'].innerHTML = renderCaseFormHtml(createEmptyCaseForm());
  wireCaseFormDialog(dialog, {
    onSubmit: (form) => { openCaseFromForm(form).catch(console.error); },
    onCoveragePreview: (form, hostEl) => showCaseCoveragePreview(form, hostEl)
  });
  dialog.showModal();
}

function buildSectorsTable() {
  const rows = store.pdqIds.map((id) => {
    const m = lastMetrics[id];
    return { id, name: formatPdqId(id), observed: m?.observed ?? 0, expected: m?.baseline, difference: m?.deviation, change: m?.change };
  });
  rows.sort((a, b) => (b.observed ?? 0) - (a.observed ?? 0));
  const body = rows.map((r) => {
    const sel = labState.selectedPdqIds.includes(r.id) ? ' class="is-selected"' : '';
    return `<tr data-pdq="${r.id}"${sel}><td>${r.name}</td><td>${formatNumber(r.observed, 0)}</td><td>${formatNumber(r.expected, 1)}</td><td>${formatSigned(r.difference, 1)}</td><td>${formatSigned(r.change, 1)}</td></tr>`;
  }).join('');
  els['sectors-table-wrap'].innerHTML = `<table class="sectors-table"><thead><tr><th>Area</th><th>Reported</th><th>Expected</th><th>Difference</th><th>Change</th></tr></thead><tbody>${body}</tbody></table>`;
}

function wireEvents() {
  els['mode-nav'].addEventListener('click', (e) => {
    const btn = e.target.closest('[data-mode]');
    if (btn) setMode(btn.dataset.mode);
  });

  els['lab-category'].addEventListener('change', () => { labState.crimeCategory = els['lab-category'].value; scheduleRefresh(); });
  els['lab-week-select'].addEventListener('change', () => {
    labState.week = els['lab-week-select'].value;
    if (runtime.hasTimeSlider()) runtime.setTimeSliderWeek(labState.week);
    scheduleRefresh();
  });
  els['lab-baseline'].addEventListener('change', () => { labState.baselineMode = els['lab-baseline'].value; scheduleRefresh(); });
  els['lab-time-metric'].addEventListener('change', () => { labState.timeMapMetric = els['lab-time-metric'].value; scheduleRefresh(); });
  els['chart-scope'].addEventListener('change', () => { labState.chartScope = els['chart-scope'].value; renderChart(); });
  els['chart-horizon']?.addEventListener('change', () => setChartHorizon(els['chart-horizon'].value));
  els['chart-horizon-tabs']?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-horizon]');
    if (btn) setChartHorizon(btn.dataset.horizon);
  });

  els['explain-form']?.addEventListener('submit', (e) => {
    e.preventDefault();
    const q = els['explain-input']?.value;
    runExplain(q).catch(console.error);
  });

  els['lab-gis-mode'].addEventListener('change', () => {
    labState.gisDisplayMode = els['lab-gis-mode'].value;
    scheduleRefresh();
  });
  els['lab-time-window'].addEventListener('change', () => {
    labState.timeWindow = els['lab-time-window'].value;
    if (labState.timeWindow !== 'off') labState.reportDate = null;
    scheduleRefresh();
  });
  els['lab-shift'].addEventListener('change', () => {
    labState.shift = els['lab-shift'].value;
    scheduleRefresh();
  });
  els['lab-area-type'].addEventListener('change', () => {
    labState.areaType = els['lab-area-type'].value;
    labState.areaId = null;
    populateAreaIdOptions();
    scheduleRefresh();
  });
  els['lab-area-id'].addEventListener('change', () => {
    labState.areaId = els['lab-area-id'].value;
    populateAreaIdOptions();
    scheduleRefresh();
  });
  els['lab-grid-resolution'].addEventListener('change', () => {
    labState.gridResolution = Number(els['lab-grid-resolution'].value);
    scheduleRefresh();
  });

  els['layers-toggles'].addEventListener('click', (e) => {
    if (e.target.closest('[data-layer]')) e.stopPropagation();
  });
  els['layers-toggles'].addEventListener('change', (e) => {
    const input = e.target.closest('[data-layer]');
    if (!input) return;
    labState.layers[input.dataset.layer] = input.checked;
    scheduleRefresh();
  });

  els['case-create-btn']?.addEventListener('click', () => openCaseCreateDialog());

  els['lab-clear-selection'].addEventListener('click', () => {
    labState.selectedPdqIds = [];
    clearIntelligenceCard();
    runtime.setSelection([]);
    renderIntelPanel();
    renderChart();
  });

  els['view-records-btn'].addEventListener('click', () => toggleRecordsDrawer(true));
  els['close-records-drawer'].addEventListener('click', () => toggleRecordsDrawer(false));
  els['view-historical-records-btn'].addEventListener('click', () => {
    loadHistoricalUnderlying().catch((err) => alert(err.message));
  });

  els['records-table-wrap'].addEventListener('click', (e) => {
    const th = e.target.closest('th[data-sort]');
    if (th) {
      const key = th.dataset.sort;
      if (tableSort.key === key) tableSort.dir *= -1;
      else { tableSort.key = key; tableSort.dir = -1; }
      renderRecordsDrawer();
      return;
    }
    const row = e.target.closest('tr[data-key]');
    if (!row) return;
    const rec = filteredFeatures.find((f) => f.properties.recordKey === row.dataset.key);
    if (rec) showIntelligenceCard(rec);
    renderRecordsDrawer();
  });

  els['chart-toggle'].addEventListener('click', () => {
    const collapsed = els['chart-drawer'].classList.toggle('is-collapsed');
    els['chart-toggle'].setAttribute('aria-expanded', String(!collapsed));
    if (!collapsed) renderChart();
  });

  els['view-all-sectors'].addEventListener('click', () => { buildSectorsTable(); els['sectors-modal'].showModal(); });
  els['close-sectors-modal'].addEventListener('click', () => els['sectors-modal'].close());
  els['sectors-table-wrap'].addEventListener('click', (e) => {
    const row = e.target.closest('tr[data-pdq]');
    if (row) selectPdq(row.dataset.pdq, false);
  });

  window.addEventListener('resize', () => renderChart());
}

async function loadArrondissements() {
  try {
    const geo = await fetch('/api/spatial/intelligence-lab/arrondissements').then((r) => r.json());
    arrondissements = geo.features.map((f) => ({
      id: f.properties.arrondissement_id,
      name: f.properties.name
    }));
  } catch (err) {
    console.warn('[lab] arrondissements', err);
  }
}

async function main() {
  applySpatialBrandDocumentTitle('investigation');
  cacheElements();
  historyChart = new LabHistoryChart(els['chart-container']);
  runtime = new LabArcgisRuntime(document.getElementById('lab-map-host'), document.getElementById('lab-legend-host'));
  runtime.onSelect = (pdqId, multi) => selectPdq(pdqId, multi);
  runtime.onRecordSelect = (rec) => showIntelligenceCard(rec);
  runtime.onArrondSelect = (id, name) => selectArrondissement(id, name);
  runtime.onGridSelect = (cell) => {
    if (!cell) return;
    filteredFeatures = cell.records;
    toggleRecordsDrawer(true);
    renderRecordsDrawer();
  };
  runtime.onCaseRecordSelect = (recordKey) => selectCaseRecord(recordKey);
  runtime.onCaseSelect = () => focusCaseWorkspace();

  const { store: loadedStore } = await loadLabData();
  store = loadedStore;
  manifest = store.manifest;

  await loadArrondissements();
  const { geoFeatures } = await runtime.init();
  setPdqDisplayNames(geoFeatures);
  buildPdqMembersMap(geoFeatures);

  const health = await fetch('/api/spatial/intelligence-lab/health').then((r) => r.json());
  if (!health.ok) throw new Error('Sector join verification failed');

  populateControls();
  activityCalendar = new ReportedActivityCalendar(els['activity-calendar-host'], {
    onMonthChange: onCalendarMonthChange,
    onDaySelect: onCalendarDaySelect
  });
  wireEvents();
  await ensureAllSpvmFeatures();
  const savedCase = loadWorkspace();
  if (savedCase?.case?.caseId) {
    caseWorkspace = savedCase;
    await activateCaseWorkspace();
  }
  await refreshMap();

  window.__iqaiIntelligenceLab = {
    state: labState,
    filteredFeatures: () => filteredFeatures,
    getLayerDiagnostics: () => ({
      pdqVisible: runtime.layer?.visible,
      pdqLabelsVisible: runtime.layer?.labelsVisible,
      pdqRenderer: runtime.layer?.renderer?.type,
      arrondVisible: runtime.arrondLayer?.visible,
      arrondLabelsVisible: runtime.arrondLayer?.labelsVisible,
      spvmVisible: runtime.spvmLayer?.visible,
      layerVisibility: { ...runtime.layerVisibility }
    }),
    diagnostics: () => ({
      visualMode: labState.visualMode,
      gisDisplayMode: labState.gisDisplayMode,
      week: labState.week,
      montrealWebMapUsed: false,
      timeSlider: runtime.hasTimeSlider(),
      filteredCount: filteredFeatures.length,
      caseOpen: Boolean(caseWorkspace),
      gridHoverEnabled: runtime._gridHoverEnabled
    }),
    openSampleCase: () => openCaseFromForm(sampleCaseForm()),
    caseWorkspace: () => caseWorkspace,
    simulateMapClick: async (clientX, clientY) => {
      const host = document.getElementById('lab-map-host');
      const rect = host.getBoundingClientRect();
      await runtime.simulateMapClick(clientX - rect.left, clientY - rect.top);
      return { selected: [...labState.selectedPdqIds] };
    }
  };
}

main().catch((err) => {
  console.error(err);
  if (els['map-headline']) els['map-headline'].textContent = `Unable to load: ${err.message}`;
});
