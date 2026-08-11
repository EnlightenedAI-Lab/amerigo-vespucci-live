/**
 * Grok / xAI intelligence research — Web Search + X Search via xAI Responses API.
 */
import {
  buildResearchPrompt,
  parseEventsJson,
  RESEARCH_PROVIDER
} from './intelligence-layer-research-contract.js';
import { PROVIDER_ROLE } from './intelligence-layer-provider-registry.js';

const TIMEOUT_MS = 180_000;
const XAI_BASE = () => String(process.env.XAI_API_BASE_URL || 'https://api.x.ai/v1').replace(/\/$/, '');

/** RD canonical secret is GROK_API_KEY; XAI_API_KEY is a Spatial alias. */
export function resolveGrokApiKey() {
  return String(process.env.GROK_API_KEY || process.env.XAI_API_KEY || '').trim();
}

function resolveGrokModel() {
  return String(
    process.env.IQAI_XAI_RESEARCH_MODEL
    || process.env.GROK_MODEL
    || process.env.XAI_MODEL
    || 'grok-4.3'
  ).trim();
}

function extractResponseText(data) {
  if (data?.output_text) return data.output_text;
  const output = data?.output;
  if (Array.isArray(output)) {
    for (const item of output) {
      if (item?.type === 'message' && Array.isArray(item.content)) {
        for (const part of item.content) {
          if (part?.text) return part.text;
        }
      }
    }
  }
  return '';
}

function extractToolUsage(data) {
  const usage = data?.server_side_tool_usage || {};
  let webSearch = 0;
  let xSearch = 0;
  for (const [key, value] of Object.entries(usage)) {
    const normalized = String(key).toUpperCase();
    const count = Number(value) || 0;
    if (normalized.includes('WEB_SEARCH')) webSearch += count;
    if (normalized.includes('X_SEARCH')) xSearch += count;
  }
  const output = Array.isArray(data?.output) ? data.output : [];
  for (const item of output) {
    const type = String(item?.type || '').toLowerCase();
    const name = String(item?.name || item?.tool_name || '').toLowerCase();
    if (type.includes('web_search') || name.includes('web_search')) webSearch = Math.max(webSearch, 1);
    if (type.includes('x_search') || name.includes('x_search') || name.includes('x_keyword')) {
      xSearch = Math.max(xSearch, 1);
    }
    if (type === 'custom_tool_call' && (name.includes('x_') || name.includes('twitter'))) {
      xSearch = Math.max(xSearch, 1);
    }
  }
  return {
    webSearchInvoked: webSearch > 0,
    xSearchInvoked: xSearch > 0,
    webSearchCount: webSearch,
    xSearchCount: xSearch
  };
}

function buildGrokTools(request) {
  const tools = [{ type: 'web_search' }];
  const xSearch = { type: 'x_search' };
  if (request.from) xSearch.from_date = String(request.from).slice(0, 10);
  if (request.to) xSearch.to_date = String(request.to).slice(0, 10);
  tools.push(xSearch);
  return tools;
}

function observationToCandidate(obs = {}) {
  const url = obs.sourceUrl || obs.url || obs.sourceReports?.[0]?.url || '';
  if (!url) return null;
  return {
    concept: obs.concept || obs.category || 'incident',
    title: obs.title || obs.headline || 'Untitled event',
    description: obs.description || obs.summary || obs.excerpt || '',
    occurredAt: obs.occurredAt || obs.eventDate || obs.publishedAt || '',
    publishedAt: obs.publishedAt || obs.eventDate || '',
    municipality: obs.municipality || '',
    neighbourhood: obs.neighbourhood || '',
    locationText: obs.locationText || obs.location || '',
    sourceReports: [{
      publisher: obs.publisher || obs.sourceName || 'xAI source',
      url,
      title: obs.title || obs.headline || 'Source',
      publishedAt: obs.publishedAt || obs.eventDate || '',
      evidenceOrigin: obs.evidenceOrigin || 'live'
    }]
  };
}

function normalizeCandidates(parsed) {
  if (Array.isArray(parsed?.events)) {
    return parsed.events.filter((c) =>
      Array.isArray(c.sourceReports) && c.sourceReports.some((r) => r?.url));
  }
  if (Array.isArray(parsed?.observations)) {
    return parsed.observations.map(observationToCandidate).filter(Boolean);
  }
  return [];
}

/**
 * @param {object} request
 * @param {object} [deps]
 */
export async function gatherGrokResearchCandidates(request = {}, deps = {}) {
  const apiKey = resolveGrokApiKey();
  if (!apiKey) {
    const err = new Error('GROK_API_KEY not configured for intelligence research');
    err.code = 'MISSING_API_KEY';
    throw err;
  }

  const model = resolveGrokModel();
  const started = Date.now();
  const audit = {
    provider: RESEARCH_PROVIDER.GROK,
    model,
    apiPath: 'POST /v1/responses',
    webSearchInvoked: false,
    xSearchInvoked: false,
    latencyMs: 0
  };

  const prompt = `${buildResearchPrompt(request)}

Use BOTH web_search and x_search. Search English and French reporting.
Return ONLY JSON: { "events": [ ... ] } with real source URLs. No coordinates.`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let data = {};
  try {
    const res = await fetch(`${XAI_BASE()}/responses`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model,
        input: [{ role: 'user', content: prompt }],
        tools: buildGrokTools(request),
        text: {
          format: {
            type: 'json_schema',
            name: 'intelligence_events',
            schema: {
              type: 'object',
              properties: {
                events: { type: 'array' }
              },
              required: ['events']
            }
          }
        }
      }),
      signal: controller.signal
    });
    data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data?.error?.message || data?.message || `xAI HTTP ${res.status}`);
      err.code = 'MODEL_PROVIDER_ERROR';
      throw err;
    }
  } finally {
    clearTimeout(timer);
  }

  const tools = extractToolUsage(data);
  audit.webSearchInvoked = tools.webSearchInvoked;
  audit.xSearchInvoked = tools.xSearchInvoked;

  const text = extractResponseText(data);
  const parsedEvents = parseEventsJson(text);
  let candidates = parsedEvents.filter((candidate) =>
    Array.isArray(candidate.sourceReports) && candidate.sourceReports.some((report) => report?.url));
  if (!candidates.length) {
    try {
      const parsed = JSON.parse(text.match(/\{[\s\S]*\}/)?.[0] || '{}');
      candidates = normalizeCandidates(parsed);
    } catch {
      candidates = [];
    }
  }

  audit.latencyMs = Date.now() - started;
  const receipt = {
    provider: 'GROK_XAI',
    model,
    role: PROVIDER_ROLE.SOCIAL_AND_WEB_SCOUT,
    invoked: true,
    toolsUsed: [
      ...(tools.webSearchInvoked ? ['WEB_SEARCH'] : []),
      ...(tools.xSearchInvoked ? ['X_SEARCH'] : [])
    ],
    sourceCount: candidates.reduce((sum, c) => sum + (c.sourceReports?.length || 0), 0),
    latencyMs: audit.latencyMs,
    status: candidates.length ? 'SUCCESS' : 'PARTIAL'
  };

  return {
    provider: RESEARCH_PROVIDER.GROK,
    candidates,
    audit,
    receipt,
    latencyMs: audit.latencyMs
  };
}
