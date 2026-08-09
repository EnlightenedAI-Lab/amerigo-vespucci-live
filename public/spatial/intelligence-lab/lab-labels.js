/**
 * Human-facing labels and deterministic headlines (display only — no calculation changes).
 */

export const VIEW_MODES = [
  { id: 'observed', label: 'Observed' },
  { id: 'baseline', label: 'Expected' },
  { id: 'deviation', label: 'Deviation' },
  { id: 'change', label: 'Change' },
  { id: 'persistence', label: 'Persistence' },
  { id: 'composition', label: 'Composition' },
  { id: 'bivariate', label: 'Volume × Deviation' },
  { id: 'forecast', label: 'Forecast' },
  { id: 'forecastError', label: 'Forecast Error' },
  { id: 'modelAdvantage', label: 'Model Comparison' },
  { id: 'timeTravel', label: 'Time' }
];

export const CATEGORY_LABELS = {
  'Vol de véhicule à moteur': 'Vehicle theft',
  'Vol dans / sur véhicule à moteur': 'Theft from vehicle',
  'Introduction': 'Break-ins',
  'Méfait': 'Mischief',
  'Vols qualifiés': 'Robberies'
};

export const COMPOSITION_COLORS = [
  { field: 'cat_0', color: '#2563eb', label: 'Vehicle theft' },
  { field: 'cat_1', color: '#7c3aed', label: 'Theft from vehicle' },
  { field: 'cat_2', color: '#0891b2', label: 'Break-ins' },
  { field: 'cat_3', color: '#059669', label: 'Mischief' },
  { field: 'cat_4', color: '#d97706', label: 'Robberies' }
];

export const BASELINE_LABELS = {
  B0: 'Previous week',
  B1: 'Previous 4-week average',
  B2: 'Previous 13-week average',
  B3: 'Same week last year',
  B4: 'Historical seasonal median'
};

/** @type {Map<string, string>} */
let pdqDisplayNames = new Map();

export function setPdqDisplayNames(geoFeatures) {
  pdqDisplayNames = new Map(
    geoFeatures.map((f) => [f.properties.harmonized_pdq_id, f.properties.display_name || formatPdqId(f.properties.harmonized_pdq_id)])
  );
}

export function formatPdqId(pdqId) {
  if (!pdqId) return '—';
  const cached = pdqDisplayNames.get(pdqId);
  if (cached) return cached;
  const m = pdqId.match(/PDQ_H_(\d+(?:_\d+)?)/);
  if (m) return `PDQ ${m[1].replace('_', '/')}`;
  return pdqId;
}

export function formatWeekLabel(weekStart) {
  if (!weekStart) return '—';
  const d = new Date(`${weekStart}T12:00:00Z`);
  return `Week of ${d.toLocaleDateString('en-CA', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' })}`;
}

export function categoryLabel(category) {
  return CATEGORY_LABELS[category] || category;
}

export function baselineLabel(key) {
  return BASELINE_LABELS[key] || key;
}

export function formatNumber(v, digits = 1) {
  if (v == null || Number.isNaN(v)) return '—';
  if (Number.isInteger(v)) return String(v);
  return Number(v).toFixed(digits);
}

export function formatSigned(v, digits = 1) {
  if (v == null || Number.isNaN(v)) return '—';
  const n = Number(v);
  const sign = n > 0 ? '+' : '';
  return `${sign}${formatNumber(n, digits)}`;
}

export function formatPercent(v) {
  if (v == null || Number.isNaN(v)) return '—';
  const sign = v > 0 ? '+' : '';
  return `${sign}${(v * 100).toFixed(0)}%`;
}

function topAreas(metrics, accessor, n = 3) {
  return Object.values(metrics)
    .filter((m) => m.mapValue != null && Number.isFinite(m.mapValue))
    .sort((a, b) => Math.abs(b.mapValue) - Math.abs(a.mapValue) || b.mapValue - a.mapValue)
    .slice(0, n);
}

function countWhere(metrics, pred) {
  return Object.values(metrics).filter(pred).length;
}

/**
 * @param {string} mode
 * @param {object} state
 * @param {Record<string, object>} metrics
 */
export function buildMapHeadline(mode, state, metrics) {
  const cat = categoryLabel(state.crimeCategory);
  const bl = baselineLabel(state.baselineMode);

  switch (mode) {
    case 'observed': {
      const top = topAreas(metrics, (m) => m.observed, 3).filter((m) => m.observed > 0);
      if (!top.length) return `No reported ${cat.toLowerCase()} this week across sectors.`;
      if (top.length === 1) return `Highest reported ${cat.toLowerCase()} was in ${formatPdqId(top[0].pdqId)}.`;
      return `Highest reported ${cat.toLowerCase()} counts were concentrated in ${top.length} sectors.`;
    }
    case 'baseline':
      return `Map shows expected ${cat.toLowerCase()} based on ${bl.toLowerCase()}.`;
    case 'deviation': {
      const above = countWhere(metrics, (m) => m.deviation != null && m.deviation > 0);
      if (!above) return `No sectors were above ${bl.toLowerCase()} this week.`;
      return `${above} sector${above === 1 ? '' : 's'} ${above === 1 ? 'was' : 'were'} above ${bl.toLowerCase()}.`;
    }
    case 'change': {
      const rising = countWhere(metrics, (m) => m.change != null && m.change > 0);
      if (!rising) return `Reported ${cat.toLowerCase()} did not rise vs the prior 4-week average in any sector.`;
      return `Reported ${cat.toLowerCase()} increased most sharply in ${rising} sector${rising === 1 ? '' : 's'}.`;
    }
    case 'persistence': {
      const persisting = countWhere(metrics, (m) => (m.persistence ?? 0) >= 2);
      if (!persisting) return `Elevated reported activity persisted for 2+ weeks in no sector.`;
      return `${persisting} sector${persisting === 1 ? '' : 's'} show sustained elevation above recent pattern.`;
    }
    case 'composition':
      return `Category mix of reported crime varies by sector this week.`;
    case 'bivariate': {
      const hot = countWhere(metrics, (m) => m.observed >= 3 && m.deviation != null && m.deviation > 0);
      return hot
        ? `${hot} sector${hot === 1 ? '' : 's'} combine high volume with above-pattern deviation.`
        : `Few sectors combine high volume with above-pattern deviation this week.`;
    }
    case 'forecast':
      return `Experimental forecast for next-week vehicle theft by sector.`;
    case 'forecastError': {
      const miss = countWhere(metrics, (m) => m.mapValue != null && Math.abs(m.mapValue) >= 2);
      return miss
        ? `The experimental model differed most from reported counts in ${miss} sector${miss === 1 ? '' : 's'}.`
        : `Forecast errors were modest across sectors this week.`;
    }
    case 'modelAdvantage': {
      const helped = countWhere(metrics, (m) => m.mapValue != null && m.mapValue > 0);
      return `F1 improved on the comparison baseline in ${helped} of 28 sectors this week.`;
    }
    case 'timeTravel':
      return `Scrub through weekly reported ${cat.toLowerCase()} across Montréal sectors.`;
    default:
      return '';
  }
}

export function buildIntelHeadline(mode, state, metrics, selectedPdqIds) {
  const cat = categoryLabel(state.crimeCategory).toUpperCase();
  if (selectedPdqIds.length === 1) {
    const m = metrics[selectedPdqIds[0]];
    if (!m) return cat;
    if (mode === 'deviation' && m.deviation != null) {
      if (m.deviation > 0.5) return `${formatPdqId(selectedPdqIds[0])}\nAbove recent pattern`;
      if (m.deviation < -0.5) return `${formatPdqId(selectedPdqIds[0])}\nBelow recent pattern`;
      return `${formatPdqId(selectedPdqIds[0])}\nNear recent pattern`;
    }
    return `${formatPdqId(selectedPdqIds[0])}`;
  }
  if (mode === 'deviation') {
    const above = countWhere(metrics, (m) => m.deviation != null && m.deviation > 0);
    return `${cat}\n${above} area${above === 1 ? '' : 's'} above recent pattern`;
  }
  return cat;
}

export function buildInterpretation(mode, state, metric) {
  if (!metric) return '';
  const cat = categoryLabel(state.crimeCategory).toLowerCase();
  const bl = baselineLabel(state.baselineMode).toLowerCase();

  switch (mode) {
    case 'deviation':
      if (metric.deviation == null) return `Comparison baseline unavailable for this sector.`;
      if (Math.abs(metric.deviation) < 0.5) return `Reported ${cat} was close to its ${bl} in this area.`;
      if (metric.deviation > 0) return `Reported ${cat} was above its ${bl} in this area.`;
      return `Reported ${cat} was below its ${bl} in this area.`;
    case 'observed':
      return `Reported count for ${cat} during the selected week.`;
    case 'baseline':
      return `Expected count based on ${bl}.`;
    case 'change':
      return `Difference from the prior 4-week average of reported ${cat}.`;
    case 'persistence':
      return `Consecutive weeks with reported counts above ${bl}. Not offender identity.`;
    case 'forecast':
      return `Experimental one-week-ahead forecast for vehicle theft. Not operational.`;
    case 'forecastError':
      return `Difference between reported count and experimental forecast.`;
    default:
      return '';
  }
}
