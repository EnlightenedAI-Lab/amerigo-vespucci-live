/**
 * Provider-neutral intelligence research contract — shared schemas and provider IDs.
 */

export const RESEARCH_PROVIDER = Object.freeze({
  OPENAI: 'openai-web-search',
  GEMINI: 'gemini-google-search',
  GROK: 'grok-xai-search',
  DEEPSEEK: 'deepseek-reasoner',
  CORPUS: 'iqai-corpus',
  MULTI: 'multi'
});

export const RESEARCH_MODE = Object.freeze({
  OPENAI: 'OPENAI',
  GEMINI: 'GEMINI',
  MULTI: 'MULTI',
  CORPUS: 'CORPUS'
});

/** Execution profile — FAST = Gemini primary + IQAI; DEEP = Gemini + OpenAI + Grok + IQAI + optional DeepSeek. */
export const RESEARCH_EXECUTION = Object.freeze({
  FAST: 'FAST',
  DEEP: 'DEEP'
});

/**
 * @returns {import('./intelligence-layer-research-contract.js').ResearchPerformanceTimeline}
 */
export function createResearchPerformanceTimeline() {
  const marks = {};
  return {
    marks,
    mark(name) {
      marks[name] = Date.now();
    },
    sinceStart(name, startedAt) {
      const at = marks[name];
      return at && startedAt ? at - startedAt : null;
    },
    toPayload(startedAt) {
      const elapsed = (name) => {
        const at = marks[name];
        return at && startedAt ? at - startedAt : null;
      };
      const firstMappableAt = marks.firstMappableEvent || null;
      const completeAt = marks.researchComplete || Date.now();
      return {
        requestAcknowledgedMs: elapsed('requestAcknowledged'),
        geminiSearchStartedMs: elapsed('geminiSearchStarted'),
        firstGroundedSourceMs: elapsed('firstGroundedSource'),
        firstEventCandidateMs: elapsed('firstEventCandidate'),
        firstEventGeocodedMs: elapsed('firstEventGeocoded'),
        firstMappableEventMs: elapsed('firstMappableEvent'),
        researchCompleteMs: completeAt - startedAt,
        timeToFirstMappableEventMs: firstMappableAt && startedAt ? firstMappableAt - startedAt : null,
        totalResearchTimeMs: completeAt - startedAt
      };
    }
  };
}

export const EVENTS_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    events: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          concept: { type: 'string' },
          title: { type: 'string' },
          description: { type: 'string' },
          occurredAt: { type: 'string' },
          publishedAt: { type: 'string' },
          municipality: { type: 'string' },
          neighbourhood: { type: 'string' },
          locationText: { type: 'string' },
          sourceReports: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                publisher: { type: 'string' },
                url: { type: 'string' },
                title: { type: 'string' },
                publishedAt: { type: 'string' },
                evidenceOrigin: { type: 'string' }
              },
              required: ['publisher', 'url', 'title', 'publishedAt', 'evidenceOrigin']
            }
          }
        },
        required: [
          'concept', 'title', 'description', 'occurredAt', 'publishedAt',
          'municipality', 'neighbourhood', 'locationText', 'sourceReports'
        ]
      }
    }
  },
  required: ['events']
};

/** Gemini-compatible JSON schema (uppercase types). */
export const GEMINI_EVENTS_JSON_SCHEMA = {
  type: 'OBJECT',
  properties: {
    events: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          concept: { type: 'STRING' },
          title: { type: 'STRING' },
          description: { type: 'STRING' },
          occurredAt: { type: 'STRING' },
          publishedAt: { type: 'STRING' },
          municipality: { type: 'STRING' },
          neighbourhood: { type: 'STRING' },
          locationText: { type: 'STRING' },
          sourceReports: {
            type: 'ARRAY',
            items: {
              type: 'OBJECT',
              properties: {
                publisher: { type: 'STRING' },
                url: { type: 'STRING' },
                title: { type: 'STRING' },
                publishedAt: { type: 'STRING' },
                evidenceOrigin: { type: 'STRING' }
              },
              required: ['publisher', 'url', 'title', 'publishedAt', 'evidenceOrigin']
            }
          }
        },
        required: [
          'concept', 'title', 'description', 'occurredAt', 'publishedAt',
          'municipality', 'neighbourhood', 'locationText', 'sourceReports'
        ]
      }
    }
  },
  required: ['events']
};

/**
 * @param {string} text
 */
export function parseEventsJson(text) {
  if (!text) return [];
  try {
    const parsed = JSON.parse(text);
    return Array.isArray(parsed?.events) ? parsed.events : [];
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return [];
    try {
      const parsed = JSON.parse(match[0]);
      return Array.isArray(parsed?.events) ? parsed.events : [];
    } catch {
      return [];
    }
  }
}

/**
 * @param {object} request
 */
export function buildResearchPrompt(request = {}) {
  return `Research intelligence layer request:
Concept/query: ${request.query}
Geography: ${request.geography || 'Greater Montréal'}
Time window: ${request.from} to ${request.to}
Temporal basis: ${request.temporalField || 'OCCURRED'}

Find distinct, evidence-backed incidents suitable for mapping. Search the web in English AND French before answering.
For firearm/shooting research in Montréal, include French terms (fusillade, coups de feu, tir).
Every event must cite real source URLs. Do NOT invent incidents, dates, locations, URLs, or coordinates.`;
}

/**
 * @param {object} [request]
 */
/**
 * @param {object} [request]
 */
export function resolveResearchExecution(request = {}) {
  const explicit = String(
    request.researchExecution
    || request.executionProfile
    || process.env.IQAI_INTELLIGENCE_RESEARCH_EXECUTION
    || ''
  ).toUpperCase();
  if (explicit === RESEARCH_EXECUTION.DEEP) return RESEARCH_EXECUTION.DEEP;
  if (explicit === RESEARCH_EXECUTION.FAST) return RESEARCH_EXECUTION.FAST;
  const hasGemini = Boolean(String(process.env.GEMINI_API_KEY || '').trim());
  return hasGemini ? RESEARCH_EXECUTION.FAST : RESEARCH_EXECUTION.DEEP;
}

/**
 * @param {object} [request]
 */
export function resolveResearchMode(request = {}) {
  const explicit = String(request.researchProvider || request.researchMode || process.env.IQAI_INTELLIGENCE_RESEARCH_PROVIDER || '').toUpperCase();
  const hasOpenAi = Boolean(String(process.env.OPENAI_API_KEY || '').trim());
  const hasGemini = Boolean(String(process.env.GEMINI_API_KEY || '').trim());
  const execution = resolveResearchExecution(request);

  if (explicit === 'CORPUS') return RESEARCH_MODE.CORPUS;
  if (explicit === 'OPENAI') return RESEARCH_MODE.OPENAI;
  if (explicit === 'GEMINI') return RESEARCH_MODE.GEMINI;
  if (explicit === 'MULTI') return RESEARCH_MODE.MULTI;

  if (execution === RESEARCH_EXECUTION.FAST && hasGemini) return RESEARCH_MODE.GEMINI;
  if (hasOpenAi && hasGemini) return RESEARCH_MODE.MULTI;
  if (hasOpenAi) return RESEARCH_MODE.OPENAI;
  if (hasGemini) return RESEARCH_MODE.GEMINI;
  return RESEARCH_MODE.CORPUS;
}

/**
 * @param {object[]} candidateSets
 */
export function dedupeResearchCandidates(candidateSets = []) {
  const seen = new Set();
  const merged = [];
  for (const set of candidateSets) {
    for (const candidate of set.candidates || []) {
      const urls = (candidate.sourceReports || []).map((r) => r?.url).filter(Boolean).sort().join('|');
      const key = [
        set.provider || 'unknown',
        candidate.title,
        candidate.occurredAt,
        candidate.locationText,
        urls
      ].join('::').toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push({
        ...candidate,
        _researchProvider: set.provider || null
      });
    }
  }
  return merged;
}

/**
 * @param {object[]} candidates
 */
export function countGroundedSourceReports(candidates = []) {
  const urls = new Set();
  let english = 0;
  let french = 0;
  for (const candidate of candidates) {
    for (const report of candidate.sourceReports || []) {
      if (!report?.url) continue;
      urls.add(report.url);
      const text = `${report.title || ''} ${report.publisher || ''} ${report.url}`;
      if (/[àâäéèêëïîôùûüçœæ]/i.test(text) || /\b(incendie|fusillade|montréal|québec)\b/i.test(text)) {
        french += 1;
      } else {
        english += 1;
      }
    }
  }
  return {
    rawSourceReports: english + french,
    distinctUrls: urls.size,
    englishSources: english,
    frenchSources: french,
    domains: [...urls].map((url) => {
      try {
        return new URL(url).hostname.replace(/^www\./, '');
      } catch {
        return null;
      }
    }).filter(Boolean)
  };
}
