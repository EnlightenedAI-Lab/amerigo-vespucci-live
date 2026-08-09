/**
 * B4 forecast audit helpers — prove seasonal median from frozen panel.
 */

import {
  buildHistoryWithOutlook,
  seasonalOutlookPoint,
  seasonalSamples,
  OUTLOOK_END
} from './lab-outlook.js';

const MVT = 'Vol de véhicule à moteur';
const THEFT_FROM = 'Vol dans / sur véhicule à moteur';

function mean(values) {
  if (!values.length) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function median(sorted) {
  if (!sorted.length) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function auditWeek(store, pdqId, category, targetWeek) {
  const samples = seasonalSamples(store, pdqId, category, targetWeek);
  const pt = seasonalOutlookPoint(store, pdqId, category, targetWeek);
  const historicalWeeks = [];
  const key = targetWeek.slice(5);
  for (const week of store.weeks) {
    if (week >= targetWeek) continue;
    if (week.slice(5) !== key) continue;
    historicalWeeks.push({
      week,
      count: pdqId
        ? store.getObserved(week, category, pdqId)
        : store.getCitywideObserved(week, category)
    });
  }
  return {
    targetWeek,
    historicalEquivalentWeeks: historicalWeeks.map((h) => h.week),
    historicalCounts: historicalWeeks.map((h) => h.count),
    medianResult: pt?.outlook ?? null,
    iqrLow: pt?.low ?? null,
    iqrHigh: pt?.high ?? null,
    sampleSize: samples.length
  };
}

function auditCategory(store, pdqId, category) {
  const built = buildHistoryWithOutlook(store, pdqId, category, 'B2', 156, 'eoy2027');
  const hist = built.series.filter((s) => s.phase === 'historical');
  const outlook = built.series.filter((s) => s.phase === 'outlook');
  const lastObs = hist[hist.length - 1];
  const outlookVals = outlook.map((s) => s.outlook).filter((v) => v != null);
  const sorted = [...outlookVals].sort((a, b) => a - b);

  const firstForecastWeek = built.forecastStartWeek;
  const jan2027 = outlook.find((s) => s.week.startsWith('2027-01'))?.week
    || outlook[Math.floor(outlook.length * 0.35)]?.week;
  const jul2027 = outlook.find((s) => s.week.startsWith('2027-07'))?.week
    || outlook[Math.floor(outlook.length * 0.65)]?.week;

  return {
    category,
    pdqId,
    lastObservedWeek: lastObs?.week,
    lastObservedCount: lastObs?.observed,
    prior4WeekAverage: mean(hist.slice(-4).map((s) => s.observed).filter((v) => v != null)),
    prior12WeekAverage: mean(hist.slice(-12).map((s) => s.observed).filter((v) => v != null)),
    outlook2027Average: mean(outlookVals),
    outlook2027Median: median(sorted),
    outlook2027Min: sorted[0] ?? null,
    outlook2027Max: sorted[sorted.length - 1] ?? null,
    finalForecastWeek: built.finalForecastWeek,
    outlookEnd: OUTLOOK_END,
    sampleWeeks: {
      firstForecastWeek: auditWeek(store, pdqId, category, firstForecastWeek),
      january2027: jan2027 ? auditWeek(store, pdqId, category, jan2027) : null,
      july2027: jul2027 ? auditWeek(store, pdqId, category, jul2027) : null
    },
    categoryConsistency: {
      historicalUsesCategory: category,
      outlookUsesCategory: category,
      samePdq: pdqId,
      trainingPanelWeekCount: store.weeks.length,
      note: 'B4 training uses full frozen panel weeks strictly before each target week; recent SPVM time-window filters do not truncate this panel.'
    }
  };
}

export function auditB4Forecast(store, pdqId = 'PDQ_H_38') {
  return {
    pdqId,
    vehicleTheft: auditCategory(store, pdqId, MVT),
    theftFromVehicle: auditCategory(store, pdqId, THEFT_FROM)
  };
}
