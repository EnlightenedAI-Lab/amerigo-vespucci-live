/**
 * Intelligence Lab — provider-neutral Ask IQAI explain service (server-side only).
 */

import { logger } from '../logger.js';
import { explainDeterministic } from '../../public/spatial/intelligence-lab/lab-explain.js';

const SYSTEM_PROMPT = `You are IQAI Spatial's analytical explainer.

You may ONLY make factual claims about the current map and data from the supplied structured context JSON.
Do not invent counts, dates, locations, incidents, trends, forecast values, source status, or causal explanations.
If the context cannot answer the question, say so clearly.

Distinguish:
- reported data (SPVM published reports)
- expected/baseline values from the frozen analytical panel
- derived analytical measures (deviation, persistence, change)
- experimental F1 one-week forecast (if present)
- long-range planning outlook (seasonal extrapolation, NOT operational forecast)

SPVM semantics:
- DATE is report date, not exact offence time
- QUART is report shift (day/evening/night), not exact clock time
- published coordinates are privacy-displaced
- PDQ analytical geography is not exact incident geography

Use plain language in 1–3 short paragraphs unless the user asks for technical detail.
Never characterize a person as criminal/suspect or infer offender identity.

Offender and linkage rules:
- Never identify or speculate about who committed an offence unless explicit offender data is in context (it is not in SPVM published reports).
- Never state that separate reports are the same crime series or same offender based on proximity alone.
- When evidence is insufficient, say so clearly.

Forecast rules:
- Do not invent forecast values. Use analytics.outlookSummary and analytics.outlookMethod/outlookEnd when discussing the green B4 planning outlook.
- Distinguish B4 multi-week planning outlook from F1 one-week experimental MVT forecast.
- Do not calculate a separate forecast; explain the supplied deterministic values only.`;

const MAX_HISTORY_TURNS = 6;
const MAX_QUESTION_LEN = 1200;
const MAX_OUTPUT_TOKENS = 700;

function resolveProvider() {
  const raw = String(process.env.IQAI_EXPLAIN_PROVIDER || 'openai').trim().toLowerCase();
  if (raw === 'deterministic' || raw === 'deterministic_fallback') return 'DETERMINISTIC';
  if (raw === 'xai') return 'XAI';
  if (raw === 'openai') return 'OPENAI';
  return 'OPENAI';
}

function resolveModel(provider) {
  const configured = String(process.env.IQAI_EXPLAIN_MODEL || '').trim();
  if (configured) return configured;
  if (provider === 'DETERMINISTIC') return 'deterministic-fallback';
  if (provider === 'XAI') {
    return String(process.env.XAI_MODEL || process.env.GROK_MODEL || 'grok-2-latest').trim();
  }
  return 'gpt-5.6-terra';
}

/** Runtime explain provider/model for UI provenance (no secrets). */
export function getExplainRuntimeConfig() {
  const provider = resolveProvider();
  return {
    provider,
    model: resolveModel(provider),
    providerLabel: provider === 'OPENAI' ? 'OpenAI' : provider === 'XAI' ? 'xAI' : 'Deterministic'
  };
}

function collectContextNumbers(context, out = new Set()) {
  const walk = (obj) => {
    if (obj == null) return;
    if (typeof obj === 'number' && Number.isFinite(obj)) {
      out.add(obj);
      out.add(Math.round(obj));
      out.add(Number(obj.toFixed(1)));
      return;
    }
    if (Array.isArray(obj)) {
      obj.forEach(walk);
      return;
    }
    if (typeof obj === 'object') {
      Object.values(obj).forEach(walk);
    }
  };
  walk(context);
  return out;
}

/** Lightweight post-response guard for authoritative numeric claims. */
export function validateExplainAnswerGrounding(answer, context) {
  const allowed = collectContextNumbers(context);
  for (let y = 2015; y <= 2027; y += 1) allowed.add(y);
  const tokens = String(answer || '').match(/-?\d+(?:\.\d+)?/g) || [];
  const ungrounded = [];
  for (const token of tokens) {
    const n = Number(token);
    if (!Number.isFinite(n)) continue;
    if (n >= 2015 && n <= 2027 && Number.isInteger(n)) continue;
    const match = [...allowed].some((a) => Math.abs(a - n) < 0.11 || (a !== 0 && Math.abs((a - n) / a) < 0.02));
    if (!match && Math.abs(n) > 1) ungrounded.push(n);
  }
  return { ok: ungrounded.length === 0, ungrounded: ungrounded.slice(0, 8) };
}

function clampString(value, max = 240) {
  const s = String(value ?? '').trim();
  if (!s) return '';
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

function clampNumber(value, { min = null, max = null } = {}) {
  if (value == null || Number.isNaN(Number(value))) return null;
  let n = Number(value);
  if (min != null) n = Math.max(min, n);
  if (max != null) n = Math.min(max, n);
  return n;
}

function sanitizeRecord(record) {
  if (!record || typeof record !== 'object') return null;
  return {
    category: clampString(record.category, 120),
    date: clampString(record.date, 32),
    shift: clampString(record.shiftLabel || record.shift, 32),
    pdq: clampString(record.pdq, 32)
  };
}

function sanitizeComposition(comp) {
  if (!Array.isArray(comp)) return [];
  return comp.slice(0, 8).map((c) => ({
    label: clampString(c.label, 80),
    count: clampNumber(c.count, { min: 0, max: 1e7 }),
    percent: clampNumber(c.percent, { min: 0, max: 100 })
  }));
}

function sanitizeDaySummary(summary) {
  if (!summary || typeof summary !== 'object') return null;
  const byCategory = summary.byCategory && typeof summary.byCategory === 'object'
    ? Object.fromEntries(
      Object.entries(summary.byCategory).slice(0, 12).map(([k, v]) => [clampString(k, 80), clampNumber(v, { min: 0, max: 1e7 })])
    )
    : undefined;
  const byShift = summary.byShift && typeof summary.byShift === 'object'
    ? Object.fromEntries(
      Object.entries(summary.byShift).slice(0, 6).map(([k, v]) => [clampString(k, 40), clampNumber(v, { min: 0, max: 1e7 })])
    )
    : undefined;
  return {
    date: clampString(summary.date, 32),
    total: clampNumber(summary.total, { min: 0, max: 1e7 }),
    ...(byCategory ? { byCategory } : {}),
    ...(byShift ? { byShift } : {})
  };
}

/**
 * Validate and compact client context into a bounded explain contract.
 * @param {unknown} raw
 */
export function validateExplainContext(raw) {
  if (!raw || typeof raw !== 'object') {
    const err = new Error('context object required');
    err.code = 'INVALID_CONTEXT';
    throw err;
  }

  const view = raw.view && typeof raw.view === 'object' ? raw.view : {};
  const filters = raw.filters && typeof raw.filters === 'object' ? raw.filters : {};
  const analytics = raw.analytics && typeof raw.analytics === 'object' ? raw.analytics : {};
  const recentData = raw.recentData && typeof raw.recentData === 'object' ? raw.recentData : {};
  const map = raw.map && typeof raw.map === 'object' ? raw.map : {};
  const methodology = raw.methodology && typeof raw.methodology === 'object' ? raw.methodology : {};
  const provenance = raw.provenance && typeof raw.provenance === 'object' ? raw.provenance : {};

  const layers = map.visibleLayers && typeof map.visibleLayers === 'object'
    ? {
      pdqShading: map.visibleLayers.pdqShading !== false,
      pdqBoundaries: map.visibleLayers.pdqBoundaries !== false,
      pdqLabels: map.visibleLayers.pdqLabels !== false,
      arrondBoundaries: map.visibleLayers.arrondBoundaries === true,
      arrondLabels: map.visibleLayers.arrondLabels === true,
      recentReports: map.visibleLayers.recentReports !== false
    }
    : undefined;

  return {
    view: {
      analyticalMode: clampString(view.analyticalMode || view.mode, 64),
      mapDisplayMode: clampString(view.mapDisplayMode || view.gisDisplayMode, 64)
    },
    filters: {
      crimeCategory: clampString(filters.crimeCategory || filters.category, 120),
      crimeCategoryLabel: clampString(filters.crimeCategoryLabel || filters.categoryLabel, 120),
      historicalWeek: clampString(filters.historicalWeek || filters.week, 32),
      historicalWeekLabel: clampString(filters.historicalWeekLabel || filters.weekLabel, 80),
      reportDate: filters.reportDate ? clampString(filters.reportDate, 32) : null,
      reportDateLabel: filters.reportDateLabel ? clampString(filters.reportDateLabel, 80) : null,
      recentTimeWindow: clampString(filters.recentTimeWindow || filters.recentReports, 40),
      reportShift: clampString(filters.reportShift || filters.shift, 32),
      selectedGeographyType: clampString(filters.selectedGeographyType || filters.areaType, 40),
      selectedGeographyId: filters.selectedGeographyId != null ? clampString(filters.selectedGeographyId, 64) : null,
      selectedGeographyName: clampString(filters.selectedGeographyName || filters.areaName || filters.pdqLabel, 120)
    },
    analytics: {
      observed: clampNumber(analytics.observed),
      baselineType: clampString(analytics.baselineType, 32),
      baselineLabel: clampString(analytics.baselineLabel, 80),
      expected: clampNumber(analytics.expected ?? analytics.baselineValue),
      difference: clampNumber(analytics.difference ?? analytics.deviation),
      relativeDifference: clampNumber(analytics.relativeDifference ?? analytics.relDev),
      persistenceWeeks: clampNumber(analytics.persistenceWeeks ?? analytics.persistence, { min: 0, max: 520 }),
      changeVsPrior4: clampNumber(analytics.changeVsPrior4 ?? analytics.change),
      composition: sanitizeComposition(analytics.composition),
      forecastValue: clampNumber(analytics.forecastValue),
      forecastStatus: clampString(analytics.forecastStatus, 120),
      outlookMethod: clampString(analytics.outlookMethod, 120),
      outlookEnd: clampString(analytics.outlookEnd, 32)
    },
    recentData: {
      filteredRecordCount: clampNumber(recentData.filteredRecordCount ?? recentData.filteredCount, { min: 0, max: 1e7 }) ?? 0,
      daySummary: sanitizeDaySummary(recentData.daySummary),
      selectedRecord: sanitizeRecord(recentData.selectedRecord)
    },
    map: {
      visibleLayers: layers,
      selectedPdqId: map.selectedPdqId ? clampString(map.selectedPdqId, 64) : null,
      gisDisplayMode: clampString(map.gisDisplayMode, 40)
    },
    methodology: {
      sourceName: clampString(methodology.sourceName || methodology.source, 240),
      locationPrecision: clampString(methodology.locationPrecision, 320),
      temporalPrecision: clampString(methodology.temporalPrecision, 320),
      outlookMethod: clampString(methodology.outlookMethod, 160),
      outlookEnd: clampString(methodology.outlookEnd, 32),
      methodSummary: clampString(methodology.methodSummary, 1600),
      limitations: clampString(methodology.limitations, 800)
    },
    provenance: {
      sources: Array.isArray(provenance.sources)
        ? provenance.sources.slice(0, 8).map((s) => clampString(s, 200)).filter(Boolean)
        : provenance.source
          ? [clampString(provenance.source, 240)]
          : [],
      detail: clampString(provenance.detail, 400)
    },
    workspace: raw.workspace && typeof raw.workspace === 'object'
      ? {
        id: clampString(raw.workspace.id, 64),
        label: clampString(raw.workspace.label, 120)
      }
      : null,
    demoCase: sanitizeDemoCase(raw.demoCase)
  };
}

function sanitizeDemoCase(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const caseObj = raw.case && typeof raw.case === 'object' ? raw.case : raw;
  const reports = Array.isArray(raw.potentiallyRelevantReports)
    ? raw.potentiallyRelevantReports.slice(0, 25).map((r) => ({
      recordKey: clampString(r.recordKey, 120),
      category: clampString(r.category, 80),
      date: clampString(r.date, 32),
      pdq: clampString(r.pdq, 16),
      distanceKm: clampNumber(r.distanceKm, { min: 0, max: 100 }),
      reasons: Array.isArray(r.reasons) ? r.reasons.slice(0, 6).map((s) => clampString(s, 120)) : [],
      pinned: Boolean(r.pinned)
    }))
    : [];
  return {
    syntheticLabel: clampString(raw.syntheticLabel, 80) || 'DEMO CASE — SYNTHETIC DATA',
    case: {
      caseId: clampString(caseObj.caseId, 64),
      title: clampString(caseObj.title, 160),
      categoryLabel: clampString(caseObj.categoryLabel || caseObj.category, 80),
      locationLabel: clampString(caseObj.locationLabel, 200),
      reportedDate: clampString(caseObj.reportedDate, 32),
      occurrenceStart: clampString(caseObj.occurrenceStart, 40),
      occurrenceEnd: clampString(caseObj.occurrenceEnd, 40),
      searchRadiusKm: clampNumber(caseObj.searchRadiusKm, { min: 0.1, max: 50 }),
      searchTimeWindowHours: clampNumber(caseObj.searchTimeWindowHours, { min: 1, max: 720 })
    },
    metrics: raw.metrics && typeof raw.metrics === 'object' ? {
      nearbyReports: clampNumber(raw.metrics.nearbyReports, { min: 0, max: 5000 }) ?? 0,
      sameCategoryReports: clampNumber(raw.metrics.sameCategoryReports, { min: 0, max: 5000 }) ?? 0,
      pdqsInvolved: clampNumber(raw.metrics.pdqsInvolved, { min: 0, max: 200 }) ?? 0,
      arrondissementsInvolved: clampNumber(raw.metrics.arrondissementsInvolved, { min: 0, max: 50 }) ?? 0
    } : null,
    potentiallyRelevantReports: reports,
    pinnedReports: reports.filter((r) => r.pinned),
    analystNotes: Array.isArray(raw.analystNotes)
      ? raw.analystNotes.slice(-15).map((n) => ({ text: clampString(n.text, 500), at: clampString(n.at, 40) }))
      : [],
    openQuestions: Array.isArray(raw.openQuestions)
      ? raw.openQuestions.slice(-15).map((q) => clampString(q, 300))
      : [],
    timeline: Array.isArray(raw.timeline)
      ? raw.timeline.slice(0, 40).map((t) => ({
        id: clampString(t.id, 80),
        kind: clampString(t.kind, 20),
        phase: clampString(t.phase, 20),
        at: clampString(t.at, 40),
        label: clampString(t.label, 160),
        recordKey: t.recordKey ? clampString(t.recordKey, 120) : null
      }))
      : [],
    historicalPdqContext: raw.historicalPdqContext || null
  };
}

function sanitizeHistory(history) {
  if (!Array.isArray(history)) return [];
  return history
    .slice(-MAX_HISTORY_TURNS)
    .map((turn) => {
      const role = turn?.role === 'assistant' ? 'assistant' : 'user';
      const content = clampString(turn?.content, 2000);
      return content ? { role, content } : null;
    })
    .filter(Boolean);
}

function flattenContextForDeterministic(ctx) {
  return {
    view: ctx.view.analyticalMode,
    gisDisplayMode: ctx.view.mapDisplayMode || ctx.map.gisDisplayMode,
    category: ctx.filters.crimeCategory,
    categoryLabel: ctx.filters.crimeCategoryLabel,
    week: ctx.filters.historicalWeek,
    weekLabel: ctx.filters.historicalWeekLabel,
    reportDate: ctx.filters.reportDate,
    reportDateLabel: ctx.filters.reportDateLabel,
    pdqId: ctx.map.selectedPdqId || ctx.filters.selectedGeographyId,
    pdqLabel: ctx.filters.selectedGeographyName || '—',
    areaType: ctx.filters.selectedGeographyType,
    areaName: ctx.filters.selectedGeographyName,
    shift: ctx.filters.reportShift,
    observed: ctx.analytics.observed,
    baselineMode: ctx.analytics.baselineType,
    baselineLabel: ctx.analytics.baselineLabel,
    baselineValue: ctx.analytics.expected,
    deviation: ctx.analytics.difference,
    relDev: ctx.analytics.relativeDifference,
    changeVsPrior4: ctx.analytics.changeVsPrior4,
    persistence: ctx.analytics.persistenceWeeks,
    forecastValue: ctx.analytics.forecastValue,
    forecastStatus: ctx.analytics.forecastStatus,
    outlookMethod: ctx.analytics.outlookMethod || ctx.methodology.outlookMethod,
    outlookEnd: ctx.analytics.outlookEnd || ctx.methodology.outlookEnd,
    recentReports: ctx.filters.recentTimeWindow,
    filteredCount: ctx.recentData.filteredRecordCount,
    selectedRecord: ctx.recentData.selectedRecord,
    daySummary: ctx.recentData.daySummary,
    composition: ctx.analytics.composition,
    locationPrecision: ctx.methodology.locationPrecision,
    temporalPrecision: ctx.methodology.temporalPrecision,
    source: ctx.methodology.sourceName || ctx.provenance.sources?.join(' · '),
    demoCase: ctx.demoCase || null
  };
}

async function callChatCompletions({ url, apiKey, model, messages, provider }) {
  const started = Date.now();
  const bodyPayload = {
    model,
    messages
  };
  if (provider === 'OPENAI') {
    bodyPayload.max_completion_tokens = MAX_OUTPUT_TOKENS;
  } else {
    bodyPayload.max_tokens = MAX_OUTPUT_TOKENS;
    bodyPayload.temperature = 0.25;
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(bodyPayload)
  });

  const latencyMs = Date.now() - started;
  const bodyText = await res.text();
  let body;
  try {
    body = JSON.parse(bodyText);
  } catch {
    body = { raw: bodyText.slice(0, 500) };
  }

  if (!res.ok) {
    const err = new Error(body?.error?.message || `LLM HTTP ${res.status}`);
    err.code = res.status === 429 ? 'RATE_LIMIT' : 'LLM_HTTP_ERROR';
    err.status = res.status;
    err.latencyMs = latencyMs;
    throw err;
  }

  const answer = body?.choices?.[0]?.message?.content?.trim();
  if (!answer) {
    const err = new Error('LLM returned empty response');
    err.code = 'EMPTY_RESPONSE';
    err.latencyMs = latencyMs;
    throw err;
  }

  return {
    answer,
    latencyMs,
    usage: body.usage || null,
    model: body.model || model
  };
}

async function explainWithOpenAI({ question, context, history }) {
  const apiKey = String(process.env.OPENAI_API_KEY || '').trim();
  if (!apiKey) {
    const err = new Error('OPENAI_API_KEY not configured');
    err.code = 'MISSING_API_KEY';
    throw err;
  }
  const model = resolveModel('OPENAI');
  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    ...history,
    {
      role: 'user',
      content: `Structured context (JSON):\n${JSON.stringify(context)}\n\nQuestion: ${question}`
    }
  ];
  const result = await callChatCompletions({
    url: 'https://api.openai.com/v1/chat/completions',
    apiKey,
    model,
    messages,
    provider: 'OPENAI'
  });
  return { ...result, provider: 'OPENAI' };
}

async function explainWithXai({ question, context, history }) {
  const apiKey = String(process.env.XAI_API_KEY || '').trim();
  if (!apiKey) {
    const err = new Error('XAI_API_KEY not configured');
    err.code = 'MISSING_API_KEY';
    throw err;
  }
  const model = resolveModel('XAI');
  const base = String(process.env.XAI_API_BASE_URL || 'https://api.x.ai/v1').replace(/\/$/, '');
  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    ...history,
    {
      role: 'user',
      content: `Structured context (JSON):\n${JSON.stringify(context)}\n\nQuestion: ${question}`
    }
  ];
  const result = await callChatCompletions({
    url: `${base}/chat/completions`,
    apiKey,
    model,
    messages,
    provider: 'XAI'
  });
  return { ...result, provider: 'XAI' };
}

function explainWithDeterministic({ question, context }) {
  const flat = flattenContextForDeterministic(context);
  return {
    provider: 'DETERMINISTIC',
    model: 'deterministic-fallback',
    answer: explainDeterministic(question, flat),
    latencyMs: 0,
    usage: null
  };
}

/**
 * @param {{ question: string, context: unknown, history?: Array<{role:string,content:string}> }} input
 */
export async function runIntelligenceLabExplain(input) {
  const question = clampString(input?.question, MAX_QUESTION_LEN);
  if (!question) {
    const err = new Error('question required');
    err.code = 'INVALID_QUESTION';
    throw err;
  }

  const context = validateExplainContext(input?.context);
  const history = sanitizeHistory(input?.history);
  const preferred = resolveProvider();

  const attempt = async (providerName) => {
    if (providerName === 'DETERMINISTIC') return explainWithDeterministic({ question, context });
    if (providerName === 'XAI') return explainWithXai({ question, context, history });
    return explainWithOpenAI({ question, context, history });
  };

  const started = Date.now();
  try {
    const result = await attempt(preferred);
    logger.info('intelligence-lab explain', {
      provider: result.provider,
      model: result.model,
      latencyMs: result.latencyMs ?? (Date.now() - started),
      promptTokens: result.usage?.prompt_tokens,
      completionTokens: result.usage?.completion_tokens,
      errorClass: null
    });
    return {
      ok: true,
      answer: result.answer,
      provider: result.provider,
      model: result.model,
      latencyMs: result.latencyMs ?? (Date.now() - started),
      usage: result.usage,
      grounding: validateExplainAnswerGrounding(result.answer, context)
    };
  } catch (error) {
    logger.warn('intelligence-lab explain fallback', {
      provider: preferred,
      model: resolveModel(preferred),
      latencyMs: Date.now() - started,
      errorClass: error.code || error.name,
      message: error.message
    });
    const fallback = explainWithDeterministic({ question, context });
    return {
      ok: true,
      answer: fallback.answer,
      provider: fallback.provider,
      model: fallback.model,
      latencyMs: fallback.latencyMs,
      usage: null,
      fallback: true,
      fallbackReason: error.code || 'PROVIDER_ERROR',
      grounding: validateExplainAnswerGrounding(fallback.answer, context)
    };
  }
}

export const EXPLAIN_SYSTEM_RULES = SYSTEM_PROMPT;
