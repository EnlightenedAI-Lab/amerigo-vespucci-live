/**
 * DeepSeek cross-evidence reasoning — DEEP mode consolidation only.
 * Never invents new evidence; operates on normalized provider candidates.
 */
import { PROVIDER_ROLE } from './intelligence-layer-provider-registry.js';

const TIMEOUT_MS = 90_000;
const DEFAULT_MODEL = 'deepseek-chat';

function resolveDeepSeekModel() {
  return String(
    process.env.IQAI_DEEPSEEK_RESEARCH_MODEL
    || process.env.DEEPSEEK_MODEL
    || DEFAULT_MODEL
  ).trim() || DEFAULT_MODEL;
}

function deepSeekBaseUrl() {
  return String(process.env.DEEPSEEK_API_BASE_URL || 'https://api.deepseek.com').replace(/\/$/, '');
}

/**
 * @param {object[]} candidates
 * @param {object} request
 */
export async function consolidateCandidatesWithDeepSeek(candidates = [], request = {}) {
  const apiKey = String(process.env.DEEPSEEK_API_KEY || '').trim();
  if (!apiKey || candidates.length < 2) {
    return {
      invoked: false,
      status: 'SKIPPED',
      duplicateGroups: [],
      notes: [],
      latencyMs: 0,
      receipt: null
    };
  }

  const model = resolveDeepSeekModel();
  const started = Date.now();
  const evidence = candidates.map((candidate, index) => ({
    index,
    title: candidate.title,
    occurredAt: candidate.occurredAt,
    locationText: candidate.locationText,
    urls: (candidate.sourceReports || []).map((r) => r.url).filter(Boolean)
  }));

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let body = {};
  try {
    const res = await fetch(`${deepSeekBaseUrl()}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content: 'You are an IQAI evidence consolidation judge. Identify duplicate events across providers referring to the same incident. Do NOT invent events or URLs. Return JSON: { "duplicateGroups": [[indices]], "notes": ["..."] }'
          },
          {
            role: 'user',
            content: `Query: ${request.query}\nGeography: ${request.geography}\nCandidates:\n${JSON.stringify(evidence)}`
          }
        ]
      }),
      signal: controller.signal
    });
    body = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(body?.error?.message || `DeepSeek HTTP ${res.status}`);
      err.code = 'MODEL_PROVIDER_ERROR';
      throw err;
    }
  } finally {
    clearTimeout(timer);
  }

  const latencyMs = Date.now() - started;
  let parsed = {};
  try {
    parsed = JSON.parse(body?.choices?.[0]?.message?.content || '{}');
  } catch {
    parsed = {};
  }

  const receipt = {
    provider: 'DEEPSEEK',
    model,
    role: PROVIDER_ROLE.REASONER,
    invoked: true,
    toolsUsed: ['STRUCTURED_OUTPUT', 'REASONING'],
    sourceCount: 0,
    latencyMs,
    status: 'SUCCESS'
  };

  return {
    invoked: true,
    status: 'SUCCESS',
    duplicateGroups: Array.isArray(parsed.duplicateGroups) ? parsed.duplicateGroups : [],
    notes: Array.isArray(parsed.notes) ? parsed.notes : [],
    latencyMs,
    receipt
  };
}
