/**
 * Server-side live-model provider boundary for GIS plan candidate generation.
 * Returns UNTRUSTED model output only — no validation or GIS execution.
 */

import {
  GIS_CAPABILITY_REGISTRY,
  GIS_PLAN_SCHEMA_VERSION,
  OPERATION_REGISTRY,
  DATASET_REGISTRY
} from './a1-gis-capability-registry.js';

const MAX_PROMPT_LEN = 800;
const MAX_OUTPUT_TOKENS = 600;
const PROVIDER_TIMEOUT_MS = 45_000;

/** @type {((userRequest: string, context: object, options?: object) => Promise<object>) | null} */
let providerCallOverride = null;

export function setGisPlanProviderCallOverride(fn) {
  providerCallOverride = fn;
}

export function clearGisPlanProviderCallOverride() {
  providerCallOverride = null;
}

export function resolveGisPlanProvider() {
  const raw = String(process.env.IQAI_AI_SPATIAL_PROVIDER || process.env.IQAI_EXPLAIN_PROVIDER || 'openai').trim().toLowerCase();
  if (raw === 'deterministic') return 'DETERMINISTIC';
  if (raw === 'xai') return 'XAI';
  return 'OPENAI';
}

export function resolveGisPlanModel(provider) {
  const configured = String(process.env.IQAI_AI_SPATIAL_MODEL || process.env.IQAI_EXPLAIN_MODEL || '').trim();
  if (configured) return configured;
  if (provider === 'DETERMINISTIC') return 'deterministic-planner-unavailable';
  if (provider === 'XAI') return String(process.env.XAI_MODEL || process.env.GROK_MODEL || 'grok-2-latest').trim();
  return 'gpt-4o-mini';
}

export function getGisPlanProviderRuntimeConfig() {
  const provider = resolveGisPlanProvider();
  if (provider === 'DETERMINISTIC') {
    return {
      available: false,
      provider,
      model: resolveGisPlanModel(provider),
      providerLabel: 'Not configured',
      reason: 'Live model provider is set to DETERMINISTIC'
    };
  }
  const apiKey = provider === 'XAI'
    ? String(process.env.XAI_API_KEY || '').trim()
    : String(process.env.OPENAI_API_KEY || '').trim();
  return {
    available: Boolean(apiKey),
    provider,
    model: resolveGisPlanModel(provider),
    providerLabel: provider === 'OPENAI' ? 'OpenAI' : 'xAI',
    reason: apiKey ? null : `${provider === 'XAI' ? 'XAI_API_KEY' : 'OPENAI_API_KEY'} not configured`
  };
}

function buildCapabilityRegistryPromptBlock() {
  const operations = Object.values(OPERATION_REGISTRY).map((op) => ({
    id: op.id,
    requiresDataset: op.requiresDataset,
    requiresLocation: op.requiresLocation,
    requiresRadius: op.requiresRadius,
    requiresLimit: op.requiresLimit,
    permitsFilters: op.permitsFilters
  }));
  const datasets = Object.values(DATASET_REGISTRY).map((ds) => ({
    key: ds.key,
    displayName: ds.displayName
  }));
  return {
    schemaId: GIS_CAPABILITY_REGISTRY.schemaId,
    schemaVersion: GIS_PLAN_SCHEMA_VERSION,
    operations,
    datasets,
    filterSemantics: Object.keys(GIS_CAPABILITY_REGISTRY.filterSemantics),
    nonAiAddressable: GIS_CAPABILITY_REGISTRY.nonAiAddressableOperations
  };
}

export function buildGisPlanGeneratorSystemPrompt() {
  return `YOU ARE A GIS PLAN CANDIDATE GENERATOR for IQAI Agent 1.

You may ONLY express capabilities available in the supplied capability registry.
You do NOT execute GIS. You do NOT manipulate ArcGIS. You do NOT invent unsupported operations or datasets.

Return ONE JSON envelope object only:

For a supported unambiguous request:
{
  "type": "PLAN",
  "plan": {
    "schemaVersion": "${GIS_PLAN_SCHEMA_VERSION}",
    "operation": "<LOCATE|SHOW|WITHIN|NEAREST|COUNT|CLEAR>",
    "dataset": "<canonical dataset key when required>",
    "location": { "type": "address", "text": "<address>" },
    "locationRef": { "type": "conversation", "ref": "last_location" },
    "radius": { "value": <number>, "unit": "km|m" },
    "limit": <integer>,
    "filters": [{ "fieldSemantic": "active_only", "operator": "equals", "value": true }]
  }
}

For ambiguous requests where a safe plan cannot be formed:
{ "type": "NEEDS_CLARIFICATION", "question": "<concise bounded question>" }

For requests outside Agent 1 capability:
{ "type": "UNSUPPORTED", "reason": "<concise reason>" }

Rules:
- Use canonical dataset keys only (fire_stations, police_stations, schools, hospitals, transit, amenities).
- Never include ArcGIS URLs, layer IDs, objectIds, renderers, SQL, whereClause, JavaScript, or code.
- Do not guess unsupported semantics (e.g. unsupported predicates on amenities).
- Do not fabricate conversation context; use locationRef only when previousLocation is provided.
- When previousLocation is provided and the user says "this address", prefer locationRef { "type": "conversation", "ref": "last_location" } OR explicit location text from context — not both.
- Never include filters unless the user explicitly requests active-only fire station filtering.
- Do not return markdown or prose outside the JSON envelope.`;
}

function buildProviderContext(context = {}) {
  return {
    capabilityRegistry: buildCapabilityRegistryPromptBlock(),
    previousLocation: context.previousLocationText
      || context.previousMatchedAddress
      || context.conversationState?.lastLocationText
      || null,
    previousMatchedAddress: context.previousMatchedAddress
      || context.conversationState?.lastMatchedAddress
      || null
  };
}

async function callLiveModel({ messages, provider, timeoutMs = PROVIDER_TIMEOUT_MS }) {
  const apiKey = provider === 'XAI'
    ? String(process.env.XAI_API_KEY || '').trim()
    : String(process.env.OPENAI_API_KEY || '').trim();
  if (!apiKey) {
    const err = new Error('Live model API key not configured');
    err.code = 'MISSING_API_KEY';
    throw err;
  }

  const model = resolveGisPlanModel(provider);
  const url = provider === 'XAI'
    ? `${String(process.env.XAI_API_BASE_URL || 'https://api.x.ai/v1').replace(/\/$/, '')}/chat/completions`
    : 'https://api.openai.com/v1/chat/completions';

  const bodyPayload = {
    model,
    messages,
    response_format: { type: 'json_object' },
    temperature: 0.1
  };
  if (provider === 'OPENAI') {
    bodyPayload.max_completion_tokens = MAX_OUTPUT_TOKENS;
  } else {
    bodyPayload.max_tokens = MAX_OUTPUT_TOKENS;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify(bodyPayload),
      signal: controller.signal
    });

    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(body?.error?.message || `Model HTTP ${res.status}`);
      err.code = res.status === 429 ? 'RATE_LIMIT' : res.status === 401 ? 'AUTH_FAILURE' : 'MODEL_PROVIDER_ERROR';
      throw err;
    }

    const content = body?.choices?.[0]?.message?.content?.trim();
    if (!content) {
      const err = new Error('Model returned empty response');
      err.code = 'MODEL_RESPONSE_EMPTY';
      throw err;
    }

    return {
      rawContent: content,
      provider,
      model: body.model || model,
      usage: body.usage || null
    };
  } catch (error) {
    if (error?.name === 'AbortError') {
      const err = new Error('Model request timed out');
      err.code = 'MODEL_TIMEOUT';
      throw err;
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * @param {string} userRequest
 * @param {object} [context]
 * @param {object} [options]
 */
export async function generateGISPlanCandidate(userRequest, context = {}, options = {}) {
  const text = String(userRequest || '').trim();
  if (!text) {
    const err = new Error('User request is required');
    err.code = 'MISSING_REQUEST';
    throw err;
  }
  if (text.length > MAX_PROMPT_LEN) {
    const err = new Error('User request exceeds maximum length');
    err.code = 'REQUEST_TOO_LONG';
    throw err;
  }

  if (providerCallOverride) {
    return providerCallOverride(text, context, options);
  }

  const runtime = getGisPlanProviderRuntimeConfig();
  if (!runtime.available) {
    const err = new Error(runtime.reason || 'Live model provider is not configured');
    err.code = 'MODEL_PROVIDER_ERROR';
    throw err;
  }

  const providerContext = buildProviderContext(context);
  const messages = [
    { role: 'system', content: buildGisPlanGeneratorSystemPrompt() },
    {
      role: 'user',
      content: `Capability registry:\n${JSON.stringify(providerContext.capabilityRegistry)}\n\nConversation context:\n${JSON.stringify({
        previousLocation: providerContext.previousLocation,
        previousMatchedAddress: providerContext.previousMatchedAddress
      })}\n\nUser request:\n${text}`
    }
  ];

  const result = await callLiveModel({
    messages,
    provider: runtime.provider,
    timeoutMs: options.timeoutMs || PROVIDER_TIMEOUT_MS
  });

  return {
    ...result,
    userRequest: text,
    providerLabel: runtime.providerLabel
  };
}
