/**
 * Deterministic B4 planning-outlook summary (no LLM).
 */

import { categoryLabel, formatPdqId } from './lab-labels.js';
import { OUTLOOK_METHOD } from './lab-outlook.js';

function mean(values) {
  if (!values.length) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function median(sorted) {
  if (!sorted.length) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * @param {import('./lab-data.js').LabDataStore} store
 * @param {string|null} pdqId
 * @param {string} category
 * @param {{ series: Array, lastObservedWeek?: string, finalForecastWeek?: string }} outlookBundle
 */
export function buildOutlookSummary(store, pdqId, category, outlookBundle) {
  const series = outlookBundle?.series || [];
  const hist = series.filter((s) => s.phase === 'historical');
  const outlook = series.filter((s) => s.phase === 'outlook');

  const lastObs = hist[hist.length - 1];
  const recent12 = hist.slice(-12).map((s) => s.observed).filter((v) => v != null);
  const recent4 = hist.slice(-4).map((s) => s.observed).filter((v) => v != null);
  const outlookVals = outlook.map((s) => s.outlook).filter((v) => v != null);
  const sortedOutlook = [...outlookVals].sort((a, b) => a - b);

  const recentLevel = mean(recent12);
  const outlook2027Median = median(sortedOutlook);
  const outlook2027Avg = mean(outlookVals);

  let direction = '~';
  let directionPct = null;
  let sentence = 'Seasonal-history outlook remains broadly consistent with the recent level.';

  if (recentLevel != null && outlook2027Median != null && recentLevel > 0) {
    directionPct = ((outlook2027Median - recentLevel) / recentLevel) * 100;
    if (Math.abs(directionPct) < 5) {
      direction = '~';
      sentence = 'Seasonal-history outlook remains broadly consistent with the recent 12-week reported level.';
    } else if (directionPct < 0) {
      direction = '↓';
      sentence = `Seasonal-history outlook is ${Math.abs(Math.round(directionPct))}% below the recent 12-week reported level.`;
    } else {
      direction = '↑';
      sentence = `Seasonal-history outlook is ${Math.round(directionPct)}% above the recent 12-week reported level.`;
    }
  }

  const geoLabel = pdqId ? formatPdqId(pdqId) : 'Montréal total';

  return {
    title: `PLANNING OUTLOOK — ${categoryLabel(category).toUpperCase()} — ${geoLabel.toUpperCase()}`,
    category,
    categoryLabel: categoryLabel(category),
    geography: geoLabel,
    pdqId,
    lastObservedWeek: lastObs?.week || outlookBundle?.lastObservedWeek || null,
    lastObservedCount: lastObs?.observed ?? null,
    prior4WeekAverage: mean(recent4),
    prior12WeekAverage: recentLevel,
    outlook2027Average: outlook2027Avg,
    outlook2027Median,
    outlook2027Min: sortedOutlook.length ? sortedOutlook[0] : null,
    outlook2027Max: sortedOutlook.length ? sortedOutlook[sortedOutlook.length - 1] : null,
    recentLevel,
    direction,
    directionPct,
    sentence,
    modelBasis: 'Historical median for equivalent calendar weeks.',
    methodId: OUTLOOK_METHOD.id
  };
}
