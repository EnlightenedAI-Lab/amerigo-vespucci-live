/**

 * Gemini intelligence research — Google Search grounding via Gemini API.

 * FAST lane: grounding-first for early source/candidate, then compact structured extraction.

 */

import {

  buildResearchPrompt,

  GEMINI_EVENTS_JSON_SCHEMA,

  parseEventsJson,

  RESEARCH_PROVIDER

} from './intelligence-layer-research-contract.js';



const DEFAULT_MODEL = 'gemini-flash-latest';

const TIMEOUT_MS = 120_000;

const FAST_MAX_EVENTS = 5;



function resolveGeminiModel() {

  return String(process.env.IQAI_GEMINI_RESEARCH_MODEL || DEFAULT_MODEL).trim() || DEFAULT_MODEL;

}



function geminiUrl(model, apiKey) {

  return `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;

}



async function callGemini(payload, apiKey, model, timeoutMs = TIMEOUT_MS) {

  const controller = new AbortController();

  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {

    const res = await fetch(geminiUrl(model, apiKey), {

      method: 'POST',

      headers: { 'Content-Type': 'application/json' },

      body: JSON.stringify(payload),

      signal: controller.signal

    });

    const body = await res.json().catch(() => ({}));

    if (!res.ok) {

      const err = new Error(body?.error?.message || `Gemini HTTP ${res.status}`);

      err.code = 'MODEL_PROVIDER_ERROR';

      err.body = body;

      throw err;

    }

    return body;

  } finally {

    clearTimeout(timer);

  }

}



function extractGeminiText(response) {

  const parts = response?.candidates?.[0]?.content?.parts || [];

  return parts.map((part) => part.text || '').join('\n').trim();

}



function extractGoogleSearchCalls(response) {

  const metadata = response?.candidates?.[0]?.groundingMetadata || {};

  const chunks = metadata.groundingChunks || [];

  const queries = Array.isArray(metadata.webSearchQueries)

    ? metadata.webSearchQueries

    : (metadata.searchEntryPoint?.renderedContent

      ? [metadata.searchEntryPoint.renderedContent]

      : []);

  return {

    queries,

    chunks: chunks.map((chunk) => ({

      uri: chunk?.web?.uri || chunk?.retrievedContext?.uri || null,

      title: chunk?.web?.title || chunk?.retrievedContext?.title || null

    })).filter((c) => c.uri || c.title),

    googleSearchInvoked: Boolean(chunks.length || queries.length)

  };

}



function groundedCandidatesFromResponse(response, hooks = {}) {

  const candidates = parseEventsJson(extractGeminiText(response)).map((candidate) => ({

    ...candidate,

    sourceReports: (candidate.sourceReports || []).map((report) => ({

      ...report,

      evidenceOrigin: report.evidenceOrigin || 'live'

    }))

  }));

  const grounded = candidates.filter((candidate) =>

    Array.isArray(candidate.sourceReports) && candidate.sourceReports.some((report) => report?.url));

  if (grounded.length && hooks.onFirstEventCandidate) {

    hooks.onFirstEventCandidate(grounded[0]);

  }

  return { candidates, grounded };

}



function stubCandidatesFromGrounding(searchMeta, request = {}) {
  const concept = request.conceptId || 'incident';
  const geography = request.geography || 'Montréal';

  return (searchMeta.chunks || [])
    .filter((chunk) => chunk.uri)
    .slice(0, 3)
    .map((chunk, index) => ({
      concept,
      title: chunk.title || `Reported ${concept} incident`,
      description: chunk.title || '',
      occurredAt: null,
      publishedAt: null,
      municipality: geography,
      neighbourhood: '',
      locationText: '',
      sourceReports: [{
        publisher: chunk.title || 'Web',
        url: chunk.uri,
        title: chunk.title || 'Source report',
        publishedAt: null,
        evidenceOrigin: 'live'
      }],
      _earlyStub: index === 0,
      _groundingFallback: true
    }));
}

function groundingFallbackCandidates(searchMeta, request = {}) {
  return (searchMeta.chunks || [])
    .filter((chunk) => chunk.uri)
    .slice(0, 5)
    .map((chunk) => ({
      concept: request.conceptId || 'incident',
      title: chunk.title || 'Reported incident',
      description: chunk.title || '',
      occurredAt: null,
      publishedAt: null,
      municipality: request.geography || 'Montréal',
      neighbourhood: '',
      locationText: '',
      sourceReports: [{
        publisher: chunk.title || 'Web',
        url: chunk.uri,
        title: chunk.title || 'Source report',
        publishedAt: null,
        evidenceOrigin: 'live'
      }],
      _groundingFallback: true
    }));
}



async function gatherGeminiFastLane(request, apiKey, model, hooks, audit) {

  const researchPrompt = `${buildResearchPrompt(request)}



Use Google Search to find current reporting in English and French. Focus on the most recent distinct incidents.

After research, identify evidence-backed events with real source URLs.`;



  hooks.onGeminiSearchStarted?.();

  audit.fastLane = true;

  audit.singleCall = false;



  const groundedResponse = await callGemini({

    contents: [{ role: 'user', parts: [{ text: researchPrompt }] }],

    tools: [{ google_search: {} }]

  }, apiKey, model);



  const searchMeta = extractGoogleSearchCalls(groundedResponse);

  audit.googleSearchInvoked = searchMeta.googleSearchInvoked;

  audit.googleSearchCalls = searchMeta;

  if (searchMeta.googleSearchInvoked) {

    hooks.onFirstGroundedSource?.(searchMeta);

  }



  const stubs = stubCandidatesFromGrounding(searchMeta, request);

  for (const stub of stubs) {
    hooks.onFirstEventCandidate?.(stub);
  }

  const notes = extractGeminiText(groundedResponse);

  const runStructuredExtraction = async () => {
    const structured = await callGemini({
      contents: [
        { role: 'user', parts: [{ text: researchPrompt }] },
        { role: 'model', parts: [{ text: notes || 'No grounded notes.' }] },
        {
          role: 'user',
          parts: [{
            text: `Extract up to ${FAST_MAX_EVENTS} distinct evidence-backed events from the research notes.

Return ONLY JSON with an events array. Every event must include real source URLs from the research.
For each event preserve separately:
- occurredAt: incident occurrence time ONLY when explicitly stated in the source (ISO-8601). Use null if unknown.
- publishedAt: article/report publication time when known (ISO-8601). Never copy publishedAt into occurredAt.
- locationText: most specific address or intersection named in the source.
- municipality and neighbourhood when stated.
No coordinates.`
          }]
        }
      ],
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: GEMINI_EVENTS_JSON_SCHEMA
      }
    }, apiKey, model);

    const structuredMeta = extractGoogleSearchCalls(structured);
    if (structuredMeta.googleSearchInvoked) {
      audit.googleSearchInvoked = true;
      audit.googleSearchCalls = structuredMeta;
    }

    const extracted = groundedCandidatesFromResponse(structured, hooks);
    if (!extracted.grounded.length && searchMeta.chunks?.length) {
      const fallback = groundingFallbackCandidates(searchMeta, request);
      return {
        candidates: fallback,
        grounded: fallback.filter((candidate) =>
          Array.isArray(candidate.sourceReports) && candidate.sourceReports.some((report) => report?.url))
      };
    }
    return extracted;
  };

  return runStructuredExtraction();
}



/**

 * @param {object} request

 * @param {object} [deps]

 */

export async function gatherGeminiResearchCandidates(request = {}, deps = {}) {

  const apiKey = String(process.env.GEMINI_API_KEY || '').trim();

  if (!apiKey) {

    const err = new Error('GEMINI_API_KEY not configured for intelligence research');

    err.code = 'MISSING_API_KEY';

    throw err;

  }



  const hooks = deps.performanceHooks || {};

  const model = resolveGeminiModel();

  const started = Date.now();

  const audit = {

    provider: RESEARCH_PROVIDER.GEMINI,

    model,

    apiPath: 'POST /v1beta/models/:generateContent',

    googleSearchInvoked: false,

    googleSearchCalls: [],

    singleCall: true,

    fastLane: false,

    latencyMs: 0

  };



  const useFastLane = deps.fastLane !== false;



  let grounded;

  if (useFastLane) {

    grounded = await gatherGeminiFastLane(request, apiKey, model, hooks, audit);

  } else {

    const researchPrompt = `${buildResearchPrompt(request)}



Use Google Search to find current reporting in English and French. After research, extract distinct incidents only.

Return evidence-backed events with real source URLs. Do NOT invent incidents, dates, locations, URLs, or coordinates.`;



    hooks.onGeminiSearchStarted?.();

    let response;

    try {

      response = await callGemini({

        contents: [{ role: 'user', parts: [{ text: researchPrompt }] }],

        tools: [{ google_search: {} }],

        generationConfig: {

          responseMimeType: 'application/json',

          responseSchema: GEMINI_EVENTS_JSON_SCHEMA

        }

      }, apiKey, model);

    } catch {

      audit.singleCall = false;

      grounded = await gatherGeminiFastLane(request, apiKey, model, hooks, audit);

      audit.latencyMs = Date.now() - started;

      return {

        provider: RESEARCH_PROVIDER.GEMINI,

        candidates: grounded.grounded.length ? grounded.grounded : grounded.candidates,

        audit,

        latencyMs: audit.latencyMs

      };

    }



    const searchMeta = extractGoogleSearchCalls(response);

    audit.googleSearchInvoked = searchMeta.googleSearchInvoked;

    audit.googleSearchCalls = searchMeta;

    if (searchMeta.googleSearchInvoked) {

      hooks.onFirstGroundedSource?.(searchMeta);

    }

    grounded = groundedCandidatesFromResponse(response, hooks);

  }



  audit.latencyMs = Date.now() - started;

  return {

    provider: RESEARCH_PROVIDER.GEMINI,

    candidates: grounded.grounded.length ? grounded.grounded : grounded.candidates,

    audit,

    latencyMs: audit.latencyMs

  };

}


