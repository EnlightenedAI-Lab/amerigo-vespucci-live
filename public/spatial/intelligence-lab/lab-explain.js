/**
 * Deterministic Explain-this over structured analytical state (no invented numbers).
 */

import {
  categoryLabel,
  baselineLabel,
  formatPdqId,
  formatWeekLabel,
  formatNumber,
  formatSigned,
  formatPercent
} from './lab-labels.js';
import { englishLabelForCategory } from '../spvm-crime-taxonomy.js';
import { OUTLOOK_METHOD } from './lab-outlook.js';

export function buildExplainContext({
  labState,
  store,
  metrics,
  focusPdqId,
  focusMetric,
  recentMode,
  chartScope,
  outlookMeta,
  filteredCount,
  selectedRecord,
  daySummary,
  relatedIntelligenceRequest,
  outlookSummary
}) {
  const m = focusMetric || {};
  return {
    view: labState.visualMode,
    gisDisplayMode: labState.gisDisplayMode,
    category: labState.crimeCategory,
    categoryLabel: categoryLabel(labState.crimeCategory),
    week: labState.week,
    weekLabel: formatWeekLabel(labState.week),
    reportDate: labState.reportDate,
    reportDateLabel: labState.reportDate ? formatReportDateLong(labState.reportDate) : null,
    pdqId: focusPdqId,
    pdqLabel: focusPdqId ? formatPdqId(focusPdqId) : (chartScope === 'montreal' ? 'Montréal total' : '—'),
    areaType: labState.areaType,
    areaName: labState.areaName,
    shift: labState.shift,
    observed: m.observed,
    baselineType: labState.baselineMode,
    baselineLabel: baselineLabel(labState.baselineMode),
    baselineValue: m.baseline,
    difference: m.deviation,
    relativeDifference: m.relDev,
    changeVsPrior4: m.change,
    persistenceWeeks: m.persistence,
    forecastValue: m.f1?.forecast_mean ?? m.shadow?.forecast_mean ?? null,
    forecastStatus: 'EXPERIMENTAL / MARGINAL / NOT OPERATIONAL',
    outlookMethod: outlookMeta?.outlookMethod?.label || OUTLOOK_METHOD.label,
    outlookEnd: outlookMeta?.outlookEnd || OUTLOOK_METHOD.outlookEnd,
    outlookSummary: outlookSummary || null,
    recentReports: recentMode,
    filteredCount: filteredCount ?? 0,
    selectedRecord: selectedRecord?.properties || null,
    daySummary: daySummary || null,
    relatedIntelligenceRequest: relatedIntelligenceRequest || null,
    locationPrecision: 'Sector polygons are analytical composites. Recent points are privacy-displaced SPVM published locations.',
    temporalPrecision: 'SPVM DATE = report date; QUART = report shift (day/evening/night). Not exact offence occurrence time.',
    source: 'SPVM published reports via IQAI frozen analytical panel and operational SPVM proxy (/api/spatial/spvm/crime-90d).',
    mapValue: m.mapValue,
    composition: m.composition,
    visibleLayers: labState.layers
  };
}

/** Compact validated contract for server-side LLM explain. */
export function buildStructuredExplainContext(params) {
  const flat = buildExplainContext(params);
  return {
    view: {
      analyticalMode: flat.view,
      mapDisplayMode: flat.gisDisplayMode
    },
    filters: {
      crimeCategory: flat.category,
      crimeCategoryLabel: flat.categoryLabel,
      historicalWeek: flat.week,
      historicalWeekLabel: flat.weekLabel,
      reportDate: flat.reportDate,
      reportDateLabel: flat.reportDateLabel,
      recentTimeWindow: flat.recentReports,
      reportShift: flat.shift,
      selectedGeographyType: flat.areaType,
      selectedGeographyId: flat.pdqId,
      selectedGeographyName: flat.areaName || flat.pdqLabel
    },
    analytics: {
      observed: flat.observed,
      baselineType: flat.baselineType,
      baselineLabel: flat.baselineLabel,
      expected: flat.baselineValue,
      difference: flat.difference,
      relativeDifference: flat.relativeDifference,
      persistenceWeeks: flat.persistenceWeeks,
      changeVsPrior4: flat.changeVsPrior4,
      composition: flat.composition,
      forecastValue: flat.forecastValue,
      forecastStatus: flat.forecastStatus,
      outlookMethod: flat.outlookMethod,
      outlookEnd: flat.outlookEnd,
      outlookSummary: flat.outlookSummary
    },
    recentData: {
      filteredRecordCount: flat.filteredCount,
      daySummary: flat.daySummary,
      selectedRecord: flat.selectedRecord
        ? {
          category: flat.selectedRecord.category,
          date: flat.selectedRecord.date,
          shift: flat.selectedRecord.shiftLabel || flat.selectedRecord.shift,
          pdq: flat.selectedRecord.pdq
        }
        : null
    },
    map: {
      visibleLayers: flat.visibleLayers,
      selectedPdqId: flat.pdqId,
      gisDisplayMode: flat.gisDisplayMode
    },
    methodology: {
      sourceName: flat.source,
      locationPrecision: flat.locationPrecision,
      temporalPrecision: flat.temporalPrecision,
      outlookMethod: flat.outlookMethod,
      outlookEnd: flat.outlookEnd
    },
    provenance: {
      sources: [
        'SPVM published reports (IQAI operational proxy /api/spatial/spvm/crime-90d)',
        'Frozen IQAI analytical weekly panel (harmonized PDQ Geography V1)',
        'Montreal arrondissements (Ville de Montréal open data, CC BY 4.0)'
      ]
    },
    demoCase: params.caseContext || null
  };
}

function formatReportDateLong(ymd) {
  if (!ymd) return '—';
  const d = new Date(`${ymd}T12:00:00`);
  return d.toLocaleDateString('en-CA', { year: 'numeric', month: 'long', day: 'numeric' });
}

function normalizeQuestion(q) {
  return String(q || '').trim().toLowerCase();
}

export function explainDeterministic(question, ctx) {
  const q = normalizeQuestion(question);

  if (ctx.demoCase || ctx.case) {
    const cs = ctx.demoCase || ctx.case;
    if (/summarize.*case|this case/.test(q)) {
      const c = cs.case || cs;
      const m = cs.metrics || {};
      return `DEMO CASE (SYNTHETIC): ${c.title || c.caseId}. Category: ${c.categoryLabel || c.category}. `
        + `Location: ${c.locationLabel}. Occurrence window (synthetic): ${c.occurrenceStart || '—'} to ${c.occurrenceEnd || '—'}. `
        + `${m.nearbyReports ?? 0} potentially relevant SPVM published reports surfaced within ${c.searchRadiusKm} km — not linked crimes.`;
    }
    if (/why.*surfaced|why was this record/.test(q)) {
      const rel = cs.potentiallyRelevantReports?.find((r) => r.recordKey === cs.selectedRecordKey)
        || cs.potentiallyRelevantReports?.[0];
      if (!rel) return 'No potentially relevant report is selected. Choose a report from Related reports.';
      return `This SPVM published report was surfaced because: ${rel.reasons?.join('; ') || 'distance and time/category match'}. This is not a confirmed link to the synthetic demo case.`;
    }
    if (/what other reports|nearby/.test(q)) {
      const n = cs.metrics?.nearbyReports ?? cs.potentiallyRelevantReports?.length ?? 0;
      return `${n} SPVM published reports match the case search radius (${cs.case?.searchRadiusKm} km) and time window. See Related reports for inclusion reasons.`;
    }
    if (/before this case/.test(q)) {
      const before = (cs.timeline || []).filter((t) => t.phase === 'before' && t.kind === 'spvm');
      return before.length
        ? `${before.length} SPVM published report(s) before the synthetic occurrence window. Earliest shown: ${before[0]?.label}.`
        : 'No SPVM published reports in the search set fall before the synthetic case window.';
    }
    if (/after this case|afterward/.test(q)) {
      const after = (cs.timeline || []).filter((t) => t.phase === 'after' && t.kind === 'spvm');
      return after.length
        ? `${after.length} SPVM published report(s) after the synthetic occurrence window.`
        : 'No SPVM published reports in the search set fall after the synthetic case window.';
    }
    if (/elevated.*pdq|vehicle theft.*pdq/.test(q)) {
      const h = cs.historicalPdqContext;
      if (!h) return 'Select a PDQ or open historical analytics to compare weekly vehicle-theft levels.';
      return `Historical context for PDQ ${h.pdqId}: observed ${formatNumber(h.observed, 0)} vs expected ${formatNumber(h.baseline, 1)} (difference ${formatSigned(h.deviation, 1)}). This is weekly panel data, separate from the synthetic demo case.`;
    }
    if (/missing|what information/.test(q)) {
      return 'Missing from this demo: exact offence time, suspect identity, recovered property status, and external intelligence. SPVM points are privacy-displaced published reports only.';
    }
    if (/most relevant|review/.test(q)) {
      const top = (cs.potentiallyRelevantReports || []).slice(0, 3);
      if (!top.length) return 'No potentially relevant reports match the current search criteria.';
      return top.map((r, i) => `${i + 1}. ${r.date} PDQ ${r.pdq} (${r.distanceKm} km) — ${r.reasons?.join(', ')}`).join('\n');
    }
  }

  if (/who committed|who stole|offender|suspect|perpetrator|who did this/.test(q)) {
    return 'The available SPVM published-report evidence in this view does not establish an offender, suspect identity, or who committed these thefts. IQAI can only describe reported events and analytical patterns from published data.';
  }

  if (/same crime series|same offender|linked crimes|same series|part of the same/.test(q)) {
    return 'Spatial or temporal relevance in this view does not establish that reports are part of the same crime series or involve the same offender. Potentially related report surfacing is for investigative review only, not confirmed linkage.';
  }

  if (/green.*lower|why.*forecast.*lower|why is the green|lower than recent/.test(q)) {
    const os = ctx.outlookSummary;
    if (os?.sentence && os.recentLevel != null && os.outlook2027Median != null) {
      return `${os.sentence} For ${ctx.pdqLabel} · ${ctx.categoryLabel}, the recent 12-week reported level averages ${formatNumber(os.recentLevel, 1)}/week, while the 2027 B4 seasonal-history outlook median is ${formatNumber(os.outlook2027Median, 1)}/week. `
        + `This uses ${OUTLOOK_METHOD.id}: median of historical same-calendar-week counts from the frozen panel for the same category and geography. It is not F1 and does not force continuity with the latest observed week.`;
    }
    return `The green planning outlook can be lower than recent reported levels when historical same-calendar-week medians (${OUTLOOK_METHOD.id}) are below the recent 12-week average. `
      + `It uses the frozen historical panel for the selected category and geography, not the recent incident filter.`;
  }

  if (!q || /what am i looking at|explain this|help/.test(q)) {
    return `${ctx.pdqLabel} · ${ctx.categoryLabel} · ${ctx.weekLabel}. `
      + `This map shows harmonized police-sector weekly analytical intelligence. `
      + `Polygons summarize reported events by sector; they are not exact incident locations.`;
  }

  if (/dark blue|blue area|blue sector|color/.test(q)) {
    if (ctx.view === 'observed' || ctx.view === 'timeTravel') {
      return `Darker blue sectors have higher reported ${ctx.categoryLabel.toLowerCase()} counts for ${ctx.weekLabel}.`;
    }
    if (ctx.view === 'deviation') {
      return `Blue sectors are below the ${ctx.baselineLabel.toLowerCase()}. Orange sectors are above it. This is a comparison, not a danger rating.`;
    }
    return `Colors encode the selected view (${ctx.view}). Check the map legend for the current scale.`;
  }

  if (/persistence|persistent/.test(q)) {
    const weeks = ctx.persistenceWeeks ?? ctx.persistence;
    if (weeks == null) {
      return 'Persistence counts how many consecutive weeks a sector has stayed above its comparison baseline for the selected category. Switch to Persistence mode or select a sector to see its current streak.';
    }
    return `Persistence is the number of consecutive weeks ${ctx.pdqLabel} has remained above its ${ctx.baselineLabel?.toLowerCase() || 'comparison baseline'} for ${ctx.categoryLabel?.toLowerCase() || 'the selected category'}. `
      + `For the current selection (${ctx.weekLabel}), persistence is ${weeks} week${weeks === 1 ? '' : 's'}. `
      + `It is a derived longitudinal measure from the frozen weekly panel, not a forecast.`;
  }

  if (/deviation|difference between observed|observed and expected/.test(q)) {
    return `Observed is the reported SPVM count aggregated to the sector for ${ctx.weekLabel}. `
      + `Expected (${ctx.baselineLabel?.toLowerCase() || 'baseline'}) is ${formatNumber(ctx.baselineValue, 1)}. `
      + `Difference (deviation) is observed minus expected: ${formatSigned(ctx.difference, 1)} (${formatPercent(ctx.relativeDifference)}).`;
  }

  if (/unusual|normal|pattern/.test(q)) {
    if (ctx.difference == null) return `Comparison baseline is unavailable for this selection.`;
    const dir = ctx.difference > 0.5 ? 'above' : ctx.difference < -0.5 ? 'below' : 'close to';
    return `${ctx.pdqLabel} recorded ${formatNumber(ctx.observed, 0)} reports, ${dir} the ${ctx.baselineLabel.toLowerCase()} (${formatNumber(ctx.baselineValue, 1)}). `
      + `Difference: ${formatSigned(ctx.difference, 1)} (${formatPercent(ctx.relativeDifference)}).`;
  }

  if (/blue line|reported/.test(q)) {
    return `The solid blue line is reported SPVM published counts — actual weekly reports aggregated to the sector.`;
  }

  if (/grey|gray|dashed|expected|comparison line/.test(q)) {
    return `The dashed grey line is the recent expected level (${ctx.baselineLabel.toLowerCase()}) from the frozen historical panel.`;
  }

  if (/pie|composition|mix/.test(q)) {
    const comp = ctx.composition || [];
    if (!comp.length) return `Composition mode shows the category mix for each PDQ during ${ctx.weekLabel}. Hover a pie for counts and percentages.`;
    const lines = comp.map((c) => `${c.label}: ${c.count}`).join(', ');
    return `The pie summarizes the mix of reported crime categories for ${ctx.pdqLabel} during ${ctx.weekLabel}. Slices: ${lines}. Size reflects total report count.`;
  }

  if (/arrondissement|borough|ville-marie|plateau/.test(q)) {
    if (ctx.areaType === 'arrondissement' && ctx.areaName) {
      return `${ctx.areaName} is a municipal arrondissement (administrative geography), distinct from PDQ police sectors. `
        + `${ctx.filteredCount} filtered SPVM published reports match the current time/category/shift filters within this area.`;
    }
    return `Arrondissements are municipal administrative boundaries from Ville de Montréal open data. They are not the same as PDQ police analytical geography.`;
  }

  if (/concentrat|heatmap|dark area|grid/.test(q)) {
    if (ctx.gisDisplayMode === 'heatmap') {
      return `The heatmap shows density of SPVM published report locations for the current filters — not exact crime density. Coordinates are privacy-displaced.`;
    }
    if (ctx.gisDisplayMode === 'grid') {
      return `Grid cells aggregate filtered published SPVM locations. Click a cell to see underlying records. This is exploratory spatial aggregation, not exact incident locations.`;
    }
    return `Enable Heatmap or Grid display with a recent time window to explore spatial concentration of published SPVM locations.`;
  }

  if (/this point|what is this point/.test(q)) {
    const r = ctx.selectedRecord;
    if (!r) return `Click a recent SPVM point to inspect it. Points are privacy-displaced published locations.`;
    return `${englishLabelForCategory(r.category)} reported ${r.date}, shift ${r.shiftLabel || r.shift}, PDQ ${r.pdq}. Location: SPVM published location — privacy-displaced.`;
  }

  if (/2027|end of 2027|planning outlook/.test(q)) {
    return `The green planning outlook extends through ${ctx.outlookEnd} using B4 seasonal same-week medians from the frozen panel. `
      + `It is labelled experimental and is NOT a validated multi-step forecast. F1 applies only to next-week MVT.`;
  }

  if (/how did you calculate|method/.test(q)) {
    return OUTLOOK_METHOD.description;
  }

  if (/last 24|last 72|last 7|recent hours/.test(q)) {
    if (ctx.recentReports === 'off') return `Set Time window to Last 24 hours, 72 hours, 7 days, or 30 days to load recent SPVM published reports.`;
    return `${ctx.filteredCount} SPVM published reports match the current filters (${ctx.recentReports}, ${ctx.categoryLabel}, shift ${ctx.shift}). `
      + `${ctx.locationPrecision}`;
  }

  if (/what happened on|this day|on this date/.test(q)) {
    if (!ctx.reportDateLabel) {
      return 'Select a day on the Reported Activity Calendar to filter published SPVM reports for that report date.';
    }
    return `On ${ctx.reportDateLabel}, ${ctx.filteredCount} published SPVM report${ctx.filteredCount === 1 ? '' : 's'} match the current category, shift, and area filters. `
      + `${ctx.temporalPrecision}`;
  }

  if (/how many.*vehicle theft|how many.*reports/.test(q)) {
    return `${ctx.filteredCount} published report${ctx.filteredCount === 1 ? '' : 's'} shown for `
      + `${ctx.reportDateLabel || ctx.recentReports || 'the current filter'}. `
      + `Category filter: ${ctx.categoryLabel}.`;
  }

  if (/which pdq had the most|top pdq/.test(q)) {
    if (!ctx.daySummary?.byCategory) {
      return `Select a calendar day or recent window to rank PDQs from published report points.`;
    }
    const pdqCounts = {};
    return `Use the day summary panel for top PDQs. Currently ${ctx.filteredCount} published reports in view.`;
  }

  if (/night.?shift|evening|day shift|show only/.test(q) && /shift|night|evening|day/.test(q)) {
    return `Shift filter is "${ctx.shift}". SPVM QUART values are report shift (jour/soir/nuit), not exact clock times.`;
  }

  if (/unusual.*day|compared with recent/.test(q)) {
    if (!ctx.reportDate) {
      return 'Select a reported-activity date to compare against recent published-report patterns.';
    }
    const hist = ctx.observed;
    const base = ctx.baselineValue;
    if (hist != null && base != null) {
      return `Historical week ${ctx.weekLabel}: ${formatNumber(hist, 0)} reported vs ${formatNumber(base, 1)} expected for ${ctx.pdqLabel}. `
        + `Calendar day ${ctx.reportDateLabel} shows ${ctx.filteredCount} individual published reports — a different temporal grain (daily published reports vs weekly PDQ aggregate).`;
    }
    return `Calendar day ${ctx.reportDateLabel}: ${ctx.filteredCount} published reports. Weekly historical comparison: ${ctx.weekLabel} sector aggregate is separate from daily published points.`;
  }

  if (/related intelligence/.test(q)) {
    if (ctx.relatedIntelligenceRequest) {
      return `Related intelligence is not connected in this lab. Future query scope: report date ${ctx.reportDate || '—'}, category ${ctx.categoryLabel}. `
        + `External observations will not be auto-linked to SPVM incident identity.`;
    }
    return 'Related intelligence requires a selected report date or recent window.';
  }

  if (/green|outlook|forecast|december/.test(q)) {
    return `The green line is an ${ctx.outlookMethod}. `
      + `It uses historical same-week medians (B4 seasonal approach), not a validated multi-week F1 forecast. `
      + `The vertical marker shows where observed history ends.`;
  }

  if (/change|trend/.test(q)) {
    return `${ctx.pdqLabel} changed by ${formatSigned(ctx.changeVsPrior4, 1)} versus its prior 4-week average for ${ctx.categoryLabel.toLowerCase()}.`;
  }

  if (/model|f1|perform/.test(q)) {
    return `F1 is an experimental one-week-ahead motor-vehicle-theft model (${ctx.forecastStatus}). `
      + `Year-end outlook on the chart is separate and uses seasonal median extrapolation, not recursive F1.`;
  }

  if (/trust|why should/.test(q)) {
    return `Numbers come from the frozen IQAI analytical panel and approved baselines. `
      + `Forecasts and outlooks are labelled experimental. Geography is harmonized for longitudinal comparison, not exact boundaries.`;
  }

  if (/where.*from|source|provenance/.test(q)) {
    return `Source: ${ctx.source} Recent points: SPVM 90-day operational proxy when enabled.`;
  }

  if (/recent|24|72|point/.test(q)) {
    if (ctx.recentReports === 'off') return `Recent reports overlay is off. Enable Last 24 hours or Last 72 hours to see privacy-displaced SPVM points.`;
    return `Red points are recent published SPVM reports (${ctx.recentReports}). ${ctx.locationPrecision}`;
  }

  return `${ctx.pdqLabel}: reported ${formatNumber(ctx.observed, 0)}, expected ${formatNumber(ctx.baselineValue, 1)}, difference ${formatSigned(ctx.difference, 1)} for ${ctx.weekLabel}.`;
}

export const EXPLAIN_PROMPTS = [
  'What am I looking at?',
  'What happened on this day?',
  'How many vehicle theft reports are shown?',
  'Which PDQ had the most reports?',
  'What does the green line mean?',
  'What related intelligence exists for this date?',
  'Where did this data come from?'
];
