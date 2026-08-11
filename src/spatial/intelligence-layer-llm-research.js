/**
 * LLM-native intelligence research — OpenAI Responses API with web_search + IQAI corpus tool.
 */
import {
  EVENTS_JSON_SCHEMA,
  buildResearchPrompt,
  parseEventsJson,
  RESEARCH_PROVIDER
} from './intelligence-layer-research-contract.js';

const RESPONSES_URL = 'https://api.openai.com/v1/responses';
const DEFAULT_MODEL = 'gpt-4o';
const MAX_ITERATIONS = 10;
const TIMEOUT_MS = 120_000;

const SEARCH_IQAI_TOOL = {
  type: 'function',
  name: 'search_iqai_intelligence',
  description: 'Search the IQAI curated production intelligence corpus for evidence-backed events matching query, geography, and time window.',
  strict: true,
  parameters: {
    type: 'object',
    additionalProperties: false,
    properties: {
      query: { type: 'string' },
      geography: { type: 'string' },
      from: { type: 'string' },
      to: { type: 'string' },
      temporalField: { type: 'string' }
    },
    required: ['query', 'geography', 'from', 'to', 'temporalField']
  }
};

function resolveResearchModel() {
  return String(process.env.IQAI_INTELLIGENCE_RESEARCH_MODEL || DEFAULT_MODEL).trim() || DEFAULT_MODEL;
}

function buildResearchInstructions() {
  return `You are the IQAI Spatial intelligence research orchestrator.

Your job is to investigate RECENT REPORTED EVENTS for map intelligence layers — not statistics, not opinion pieces, not year-over-year trend articles.

MANDATORY TOOLS:
1. Use web_search to research current/recent open-web reporting in English AND French.
2. Use search_iqai_intelligence to query the IQAI curated production corpus for the same concept, geography, and time window.

RULES:
- Every event MUST cite at least one real source URL from web_search or IQAI corpus results.
- Do NOT invent incidents, dates, locations, or URLs.
- Do NOT use model memory as evidence.
- Do NOT output latitude/longitude — only locationText, municipality, neighbourhood.
- Deduplicate duplicate news coverage of the same incident.
- Focus on distinct incidents within the requested geography and time window.

After research, return ONLY valid JSON matching the required schema with an "events" array.`;
}

async function callResponsesApi(payload, apiKey) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(RESPONSES_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify(payload),
      signal: controller.signal
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(body?.error?.message || `OpenAI Responses HTTP ${res.status}`);
      err.code = 'MODEL_PROVIDER_ERROR';
      err.body = body;
      throw err;
    }
    return body;
  } finally {
    clearTimeout(timer);
  }
}

function extractWebSearchCalls(response) {
  const calls = [];
  for (const item of response.output || []) {
    if (item.type === 'web_search_call') {
      calls.push({ id: item.id, status: item.status, action: item.action });
    }
  }
  return calls;
}

function extractFunctionCalls(response) {
  const calls = [];
  for (const item of response.output || []) {
    if (item.type === 'function_call' && item.name === 'search_iqai_intelligence') {
      calls.push(item);
    }
  }
  return calls;
}

function extractOutputText(response) {
  const chunks = [];
  for (const item of response.output || []) {
    if (item.type === 'message') {
      for (const block of item.content || []) {
        if (block.type === 'output_text' && block.text) chunks.push(block.text);
      }
    }
  }
  return chunks.join('\n').trim();
}

/**
 * @param {object} request
 * @param {object} [deps]
 */
export async function gatherOpenAiResearchCandidates(request = {}, deps = {}) {
  const apiKey = String(process.env.OPENAI_API_KEY || '').trim();
  if (!apiKey) {
    const err = new Error('OPENAI_API_KEY not configured for intelligence research');
    err.code = 'MISSING_API_KEY';
    throw err;
  }

  const { executeIntelligenceLayerCorpusSearch } = await import('./intelligence-layer-search-handler.js');
  const model = resolveResearchModel();
  const started = Date.now();
  const audit = {
    provider: RESEARCH_PROVIDER.OPENAI,
    model,
    apiPath: 'POST /v1/responses',
    webSearchInvoked: false,
    webSearchCalls: [],
    iqaiCorpusInvoked: false,
    iqaiCorpusCalls: 0,
    iterations: 0,
    latencyMs: 0
  };

  let input = buildResearchPrompt(request);
  let previousResponseId = null;

  for (let i = 0; i < MAX_ITERATIONS; i += 1) {
    audit.iterations += 1;
    const payload = {
      model,
      instructions: buildResearchInstructions(),
      input,
      tools: [{ type: 'web_search' }, SEARCH_IQAI_TOOL],
      tool_choice: !audit.webSearchInvoked ? { type: 'web_search' } : 'auto'
    };
    if (previousResponseId) payload.previous_response_id = previousResponseId;

    const response = await callResponsesApi(payload, apiKey);
    previousResponseId = response.id;

    const webCalls = extractWebSearchCalls(response);
    if (webCalls.length) {
      audit.webSearchInvoked = true;
      audit.webSearchCalls.push(...webCalls);
    }

    const functionCalls = extractFunctionCalls(response);
    if (functionCalls.length) {
      audit.iqaiCorpusInvoked = true;
      audit.iqaiCorpusCalls += functionCalls.length;
      const toolOutputs = [];
      for (const call of functionCalls) {
        let args = {};
        try {
          args = JSON.parse(call.arguments || '{}');
        } catch {
          args = {};
        }
        const corpusResult = await executeIntelligenceLayerCorpusSearch({
          query: args.query || request.query,
          geography: args.geography || request.geography,
          from: args.from || request.from,
          to: args.to || request.to,
          temporalField: args.temporalField || request.temporalField || 'OCCURRED',
          includeLive: true,
          useLlmResearch: false
        }, deps);
        toolOutputs.push({
          type: 'function_call_output',
          call_id: call.call_id,
          output: JSON.stringify({
            distinctEvents: corpusResult.combined?.distinctEvents || 0,
            events: (corpusResult.events || []).slice(0, 25).map((e) => ({
              title: e.title,
              occurredAt: e.occurredAt,
              locationText: e.locationText,
              municipality: e.municipality,
              sourceReports: e.sourceReports
            }))
          })
        });
      }
      input = toolOutputs;
      continue;
    }

    if (audit.webSearchInvoked) break;
  }

  const structureResponse = await callResponsesApi({
    model,
    previous_response_id: previousResponseId,
    instructions: 'Return ONLY JSON with an events array. Every event must include real source URLs from your prior research. No coordinates.',
    input: 'Produce the final structured events JSON now.',
    tool_choice: 'none',
    text: {
      format: {
        type: 'json_schema',
        name: 'intelligence_layer_events',
        schema: EVENTS_JSON_SCHEMA,
        strict: true
      }
    }
  }, apiKey);

  const candidates = parseEventsJson(extractOutputText(structureResponse));
  audit.latencyMs = Date.now() - started;
  return { provider: RESEARCH_PROVIDER.OPENAI, candidates, audit, latencyMs: audit.latencyMs };
}

/**
 * @param {object} request
 * @param {object} [deps]
 */
export async function executeIntelligenceLayerLlmResearch(request = {}, deps = {}) {
  const { researchEvents } = await import('./intelligence-layer-research-events.js');
  return researchEvents({ ...request, researchProvider: 'OPENAI' }, deps);
}
