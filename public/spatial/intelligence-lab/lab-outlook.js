/**
 * Experimental year-end outlook — B4 seasonal median from frozen panel (NOT recursive F1).
 */

/** Last Monday on or before 2027-12-31 (weekly panel grain). */
export const OUTLOOK_END = '2027-12-27';

export const OUTLOOK_METHOD = {
  id: 'B4_SEASONAL_MEDIAN_EXTRAPOLATION',
  label: 'Experimental planning outlook — NOT operational forecast',
  description:
    'No validated multi-week F1 forecast exists. Future weeks use the approved B4 seasonal structure: '
    + 'for each future week W, outlook = median of all historical reported counts in the frozen panel '
    + 'where calendar week (MM-DD) matches W, for the same PDQ (or citywide sum) and category, '
    + 'using only weeks strictly before W. '
    + 'Uncertainty band = interquartile range (25th–75th percentile) of those same-week historical values. '
    + 'COVID/transition regimes are not separately re-weighted; all pre-W panel history contributes equally.',
  validation: 'NOT multi-step validated. F1 remains one-week-ahead MVT only.',
  baselineCode: 'B4',
  outlookEnd: OUTLOOK_END,
  methodSteps: [
    'Identify last observed panel week T.',
    `For each future week W from T+7 through ${OUTLOOK_END} (Mondays):`,
    '  Collect all panel weeks W\' < W with matching MM-DD.',
    '  Outlook(W) = median(reported counts).',
    '  Band = [Q1, Q3] of the same sample.'
  ]
};

const HORIZON_OUTLOOK_WEEKS = {
  '3m': 13,
  '6m': 26,
  '12m': 52,
  eoy2027: null
};

function calendarWeekKey(weekStart) {
  return weekStart.slice(5);
}

function addWeeks(weekStart, n) {
  const d = new Date(`${weekStart}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n * 7);
  return d.toISOString().slice(0, 10);
}

function quantile(sorted, q) {
  if (!sorted.length) return null;
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  if (sorted[base + 1] == null) return sorted[base];
  return sorted[base] + rest * (sorted[base + 1] - sorted[base]);
}

/**
 * Historical same-calendar-week values prior to targetWeek.
 */
export function seasonalSamples(store, pdqId, category, targetWeek) {
  const key = calendarWeekKey(targetWeek);
  const values = [];
  for (const week of store.weeks) {
    if (week >= targetWeek) continue;
    if (calendarWeekKey(week) !== key) continue;
    const v = pdqId
      ? store.getObserved(week, category, pdqId)
      : store.getCitywideObserved(week, category);
    if (v != null) values.push(v);
  }
  return values;
}

export function seasonalOutlookPoint(store, pdqId, category, targetWeek) {
  const values = seasonalSamples(store, pdqId, category, targetWeek).sort((a, b) => a - b);
  if (!values.length) return null;
  return {
    outlook: quantile(values, 0.5),
    low: quantile(values, 0.25),
    high: quantile(values, 0.75),
    n: values.length,
    method: OUTLOOK_METHOD.id
  };
}

export function futureWeeksFrom(lastObservedWeek) {
  const weeks = [];
  let w = addWeeks(lastObservedWeek, 1);
  while (w <= OUTLOOK_END) {
    weeks.push(w);
    w = addWeeks(w, 1);
  }
  return weeks;
}

export function finalForecastWeek(series) {
  const outlook = (series || []).filter((s) => s.phase === 'outlook');
  return outlook.length ? outlook[outlook.length - 1].week : null;
}

/**
 * @param {import('./lab-data.js').LabDataStore} store
 * @param {string|null} pdqId null = Montréal total
 */
export function historyWeeksForHorizon(store, horizon = 'eoy2027') {
  const lastObserved = store.weeks[store.weeks.length - 1];
  const endIdx = store.weekIndex[lastObserved];
  const outlookWeeks = HORIZON_OUTLOOK_WEEKS[horizon];
  if (outlookWeeks == null) return Math.min(endIdx + 1, 156);
  return Math.min(endIdx + 1, Math.max(26, outlookWeeks));
}

export function buildHistoryWithOutlook(store, pdqId, category, baselineKey = 'B2', historyWeeks = 52, horizon = 'eoy2027') {
  const lastObserved = store.weeks[store.weeks.length - 1];
  const endIdx = store.weekIndex[lastObserved];
  const histCount = typeof historyWeeks === 'number' ? historyWeeks : historyWeeksForHorizon(store, horizon);
  const startIdx = Math.max(0, endIdx - histCount + 1);

  const series = [];
  for (let i = startIdx; i <= endIdx; i += 1) {
    const week = store.weeks[i];
    series.push({
      week,
      phase: 'historical',
      observed: pdqId
        ? store.getObserved(week, category, pdqId)
        : store.getCitywideObserved(week, category),
      baseline: pdqId
        ? store.getBaseline(week, category, pdqId, baselineKey)
        : store.getCitywideBaseline(week, category, baselineKey),
      outlook: null,
      outlookLow: null,
      outlookHigh: null,
      f1: pdqId ? store.getF1Forecast(week, pdqId)?.forecast_mean ?? null : null
    });
  }

  const future = futureWeeksFrom(lastObserved);
  for (const week of future) {
    const pt = seasonalOutlookPoint(store, pdqId, category, week);
    series.push({
      week,
      phase: 'outlook',
      observed: null,
      baseline: null,
      outlook: pt?.outlook ?? null,
      outlookLow: pt?.low ?? null,
      outlookHigh: pt?.high ?? null,
      outlookN: pt?.n ?? null,
      f1: null
    });
  }

  const trimmed = trimSeriesToHorizon(series, horizon);

  return {
    series: trimmed,
    forecastStartWeek: addWeeks(lastObserved, 1),
    lastObservedWeek: lastObserved,
    outlookEnd: OUTLOOK_END,
    finalForecastWeek: finalForecastWeek(trimmed),
    outlookMethod: OUTLOOK_METHOD
  };
}

function trimSeriesToHorizon(series, horizon) {
  if (horizon === 'eoy2027') return series;

  const outlookCap = HORIZON_OUTLOOK_WEEKS[horizon];
  if (outlookCap == null) return series;

  const hist = series.filter((s) => s.phase === 'historical');
  const out = series.filter((s) => s.phase === 'outlook').slice(0, outlookCap);
  const histKeep = Math.max(26, outlookCap);
  return [...hist.slice(-histKeep), ...out];
}
