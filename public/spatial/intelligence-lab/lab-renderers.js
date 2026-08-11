/**
 * Intelligence Lab — renderer builders (semantic cartographic ramps).
 */

import { COMPOSITION_COLORS } from './lab-labels.js';
import { isF1CategorySupported } from './lab-category-support.js';

const BLUE_SEQ = ['#eff6ff', '#bfdbfe', '#60a5fa', '#2563eb', '#1e3a8a'];
const INDIGO_SEQ = ['#eef2ff', '#c7d2fe', '#818cf8', '#4f46e5', '#312e81'];
const PERSIST_SEQ = ['#f5f3ff', '#ddd6fe', '#a78bfa', '#7c3aed', '#5b21b6'];
const TEAL_SEQ = ['#f0fdfa', '#99f6e4', '#2dd4bf', '#0d9488', '#115e59'];

export const VISUAL_MODES = [
  { id: 'observed' },
  { id: 'baseline' },
  { id: 'deviation' },
  { id: 'change' },
  { id: 'persistence' },
  { id: 'composition' },
  { id: 'bivariate' },
  { id: 'forecast' },
  { id: 'forecastError' },
  { id: 'modelAdvantage' },
  { id: 'timeTravel' }
];

function breaksFromValues(values, count = 5) {
  const nums = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (!nums.length) return [0, 1, 2, 3, 4];
  const breaks = [];
  for (let i = 1; i < count; i += 1) {
    const p = i / count;
    const idx = Math.min(nums.length - 1, Math.floor(p * nums.length));
    breaks.push(nums[idx]);
  }
  breaks.push(nums[nums.length - 1]);
  return [...new Set(breaks)];
}

function symmetricBreaks(values) {
  const nums = values.filter((v) => Number.isFinite(v));
  const maxAbs = Math.max(0.5, ...nums.map((v) => Math.abs(v)));
  const step = maxAbs / 2;
  return [-maxAbs, -step, 0, step, maxAbs];
}

function classBreaksFromPalette(values, palette, field = 'mapValue', legendTitle = '') {
  const breaks = breaksFromValues(values);
  const infos = breaks.map((b, i) => ({
    minValue: i === 0 ? -Infinity : breaks[i - 1],
    maxValue: b,
    symbol: {
      type: 'simple-fill',
      color: palette[Math.min(palette.length - 1, i)],
      outline: { color: '#94a3b8', width: 0.6 }
    }
  }));
  infos.push({
    minValue: breaks[breaks.length - 1],
    maxValue: Infinity,
    symbol: {
      type: 'simple-fill',
      color: palette[palette.length - 1],
      outline: { color: '#64748b', width: 0.75 }
    }
  });
  return { type: 'class-breaks', field, classBreakInfos: infos, defaultSymbol: fill('#e2e8f0'), legendOptions: { title: legendTitle } };
}

function divergingBreaks(values, mode = 'deviation', legendTitle = 'Above / below pattern') {
  const breaks = symmetricBreaks(values);
  const below = mode === 'modelAdvantage' ? '#94a3b8' : '#3b82f6';
  const above = mode === 'modelAdvantage' ? '#059669' : '#ea580c';
  return {
    type: 'class-breaks',
    field: 'mapValue',
    classBreakInfos: [
      { minValue: breaks[0], maxValue: breaks[1], symbol: fill(below, 0.85) },
      { minValue: breaks[1], maxValue: breaks[2], symbol: fill('#dbeafe', 0.7) },
      { minValue: breaks[2], maxValue: breaks[3], symbol: fill('#f8fafc') },
      { minValue: breaks[3], maxValue: breaks[4], symbol: fill('#fed7aa', 0.85) },
      { minValue: breaks[4], maxValue: breaks[4] + 1, symbol: fill(above, 0.9) }
    ],
    defaultSymbol: fill('#e2e8f0'),
    legendOptions: { title: legendTitle }
  };
}

function fill(color, opacity = 0.82) {
  return { type: 'simple-fill', color, outline: { color: '#64748b', width: 0.65 } };
}

export function computeMetricsForMode(store, state, manifest = null) {
  const { week, crimeCategory, visualMode, baselineMode } = state;
  const f1Supported = manifest ? isF1CategorySupported(manifest, crimeCategory) : true;
  const metrics = {};

  for (const pdqId of store.pdqIds) {
    const observed = store.getObserved(week, crimeCategory, pdqId) ?? 0;
    const baseline = store.getBaseline(week, crimeCategory, pdqId, baselineMode);
    const deviation = baseline == null ? null : observed - baseline;
    const relDev = baseline != null && baseline !== 0 ? (observed - baseline) / baseline : null;
    const prior4 = store.getPrior4WeekMean(week, crimeCategory, pdqId);
    const change = prior4 == null ? null : observed - prior4;
    const persistence = store.getPersistenceStreak(week, crimeCategory, pdqId, baselineMode);
    const composition = store.getComposition(week, pdqId);
    const f1 = f1Supported ? store.getF1Forecast(week, pdqId) : null;
    const shadow = f1Supported ? store.getF1ShadowForecast(pdqId) : null;
    const adv = f1Supported ? store.getModelAdvantage(week, pdqId) : null;

    let mapValue = observed;
    let label = 'report_count';

    switch (visualMode) {
      case 'observed': mapValue = observed; label = 'observed'; break;
      case 'baseline': mapValue = baseline; label = `baseline_${baselineMode}`; break;
      case 'deviation': mapValue = deviation; label = 'deviation'; break;
      case 'change': mapValue = change; label = 'change_vs_prior4'; break;
      case 'persistence': mapValue = persistence; label = 'persistence_streak_weeks'; break;
      case 'bivariate': mapValue = deviation; label = 'bivariate_deviation'; break;
      case 'forecast': {
        if (!f1Supported) {
          mapValue = null;
          label = 'f1_unavailable';
          break;
        }
        const fc = f1?.forecast_mean ?? shadow?.forecast_mean ?? null;
        mapValue = fc; label = 'f1_forecast_mean'; break;
      }
      case 'forecastError':
        if (!f1Supported) {
          mapValue = null;
          label = 'f1_unavailable';
          break;
        }
        mapValue = f1?.forecast_error ?? (f1 && f1.actual_count != null ? f1.actual_count - f1.forecast_mean : null);
        label = 'forecast_error'; break;
      case 'modelAdvantage':
        if (!f1Supported) {
          mapValue = null;
          label = 'f1_unavailable';
          break;
        }
        mapValue = adv?.model_advantage ?? null; label = 'model_advantage'; break;
      case 'timeTravel': mapValue = observed; label = 'observed_time_travel'; break;
      case 'composition':
        mapValue = composition.reduce((m, c) => Math.max(m, c.count), 0);
        label = 'composition_total'; break;
      default: break;
    }

    metrics[pdqId] = {
      pdqId, observed, baseline, deviation, relDev, change, persistence,
      composition, f1, shadow, adv, mapValue, label
    };
  }
  return metrics;
}

export function buildRenderer(store, state, metrics) {
  const { visualMode } = state;
  const values = Object.values(metrics).map((m) => m.mapValue);

  if (visualMode === 'composition') {
    const fields = store.categories.map((c, i) => ({
      field: `cat_${i}`,
      label: COMPOSITION_COLORS[i]?.label || c
    }));
    return { type: 'pie-chart', _pieFields: fields };
  }

  if (visualMode === 'deviation' || visualMode === 'forecastError') {
    return divergingBreaks(values, visualMode, legendTitleForMode(visualMode));
  }
  if (visualMode === 'change') return divergingBreaks(values, 'change', legendTitleForMode(visualMode));
  if (visualMode === 'modelAdvantage') return divergingBreaks(values, 'modelAdvantage', legendTitleForMode(visualMode));

  if (visualMode === 'bivariate') {
    const maxObs = Math.max(3, ...Object.values(metrics).map((m) => m.observed));
    return {
      type: 'simple',
      symbol: fill('#e2e8f0', 0.5),
      visualVariables: [
        {
          type: 'color',
          field: 'mapValue',
          legendOptions: { title: 'Deviation from pattern' },
          stops: [
            { value: -5, color: '#3b82f6' },
            { value: 0, color: '#f1f5f9' },
            { value: 5, color: '#ea580c' }
          ]
        },
        {
          type: 'size',
          field: 'observed',
          legendOptions: { title: 'Reported volume' },
          minDataValue: 0,
          maxDataValue: maxObs,
          minSize: 6,
          maxSize: 28
        }
      ]
    };
  }

  if (visualMode === 'observed' || visualMode === 'timeTravel') {
    return classBreaksFromPalette(values, BLUE_SEQ, 'mapValue', legendTitleForMode(visualMode));
  }
  if (visualMode === 'baseline') return classBreaksFromPalette(values, INDIGO_SEQ, 'mapValue', legendTitleForMode(visualMode));
  if (visualMode === 'persistence') return classBreaksFromPalette(values, PERSIST_SEQ, 'mapValue', legendTitleForMode(visualMode));
  if (visualMode === 'forecast') return classBreaksFromPalette(values, TEAL_SEQ, 'mapValue', legendTitleForMode(visualMode));

  return classBreaksFromPalette(values, BLUE_SEQ, 'mapValue', legendTitleForMode(visualMode));
}

export function legendTitleForMode(mode) {
  const titles = {
    observed: 'Reported count',
    baseline: 'Expected count',
    deviation: 'Above / below pattern',
    change: 'Change vs prior 4 weeks',
    persistence: 'Weeks above pattern',
    composition: 'Category mix',
    bivariate: 'Volume × deviation',
    forecast: 'Forecast (experimental)',
    forecastError: 'Forecast error',
    modelAdvantage: 'Model comparison',
    timeTravel: 'Reported count'
  };
  return titles[mode] || '';
}
