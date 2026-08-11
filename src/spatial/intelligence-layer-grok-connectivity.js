/**
 * Grok / xAI connectivity probe — statuses only, no secret values.
 */
import { loadSharedProviderEnv } from './intelligence-layer-shared-env.js';
import { resolveGrokApiKey } from './intelligence-layer-grok-research.js';

const XAI_BASE = () => String(process.env.XAI_API_BASE_URL || 'https://api.x.ai/v1').replace(/\/$/, '');

function resolveModel() {
  return String(
    process.env.IQAI_XAI_RESEARCH_MODEL
    || process.env.GROK_MODEL
    || process.env.XAI_MODEL
    || 'grok-4.3'
  ).trim();
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
  return { webSearchInvoked: webSearch > 0, xSearchInvoked: xSearch > 0 };
}

/**
 * @returns {Promise<object>}
 */
export async function probeGrokConnectivity() {
  loadSharedProviderEnv();
  const apiKey = resolveGrokApiKey();
  const model = resolveModel();
  const report = {
    provider: 'GROK_XAI',
    rdCanonicalSecret: 'GROK_API_KEY',
    spatialAliases: ['GROK_API_KEY', 'XAI_API_KEY'],
    credentialPresent: Boolean(apiKey),
    baseUrl: XAI_BASE(),
    model,
    authentication: 'ABSENT',
    modelList: 'SKIPPED',
    modelResponds: 'SKIPPED',
    webSearch: 'SKIPPED',
    xSearch: 'SKIPPED',
    latencyMs: { auth: null, research: null }
  };

  if (!apiKey) return report;

  const authStarted = Date.now();
  try {
    const res = await fetch(`${XAI_BASE()}/models`, {
      headers: { Authorization: `Bearer ${apiKey}` }
    });
    report.latencyMs.auth = Date.now() - authStarted;
    report.authHttpStatus = res.status;
    report.authentication = res.ok ? 'CONNECTED' : 'FAIL';
    report.modelList = res.ok ? 'CONNECTED' : 'FAIL';
    if (!res.ok) return report;
  } catch {
    report.latencyMs.auth = Date.now() - authStarted;
    report.authentication = 'FAIL';
    return report;
  }

  const researchStarted = Date.now();
  try {
    const res = await fetch(`${XAI_BASE()}/responses`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model,
        input: [{ role: 'user', content: 'Search X for Montreal protests and use web_search. Reply {"ok":true} after searching.' }],
        tools: [{ type: 'web_search' }, { type: 'x_search' }]
      })
    });
    const data = await res.json().catch(() => ({}));
    report.latencyMs.research = Date.now() - researchStarted;
    report.researchHttpStatus = res.status;
    if (!res.ok) {
      report.modelResponds = 'FAIL';
      return report;
    }
    report.modelResponds = 'CONNECTED';
    const tools = extractToolUsage(data);
    report.webSearch = tools.webSearchInvoked ? 'CONNECTED' : 'ABSENT';
    report.xSearch = tools.xSearchInvoked ? 'CONNECTED' : 'ABSENT';
  } catch {
    report.latencyMs.research = Date.now() - researchStarted;
    report.modelResponds = 'FAIL';
  }

  return report;
}
