/**
 * IQAI Spatial AI provider registry — normalized capability descriptions.
 */
import { loadSharedProviderEnv } from './intelligence-layer-shared-env.js';

export const PROVIDER_CAPABILITY = Object.freeze({
  WEB_SEARCH: 'WEB_SEARCH',
  X_SEARCH: 'X_SEARCH',
  GOOGLE_SEARCH: 'GOOGLE_SEARCH',
  REASONING: 'REASONING',
  STRUCTURED_OUTPUT: 'STRUCTURED_OUTPUT',
  FUNCTION_CALLING: 'FUNCTION_CALLING',
  CORPUS_SEARCH: 'CORPUS_SEARCH'
});

export const PROVIDER_ROLE = Object.freeze({
  FAST_SCOUT: 'FAST_SCOUT',
  SOCIAL_AND_WEB_SCOUT: 'SOCIAL_AND_WEB_SCOUT',
  WEB_SCOUT: 'WEB_SCOUT',
  REASONER: 'REASONER',
  CORPUS: 'CORPUS'
});

export const SPATIAL_AI_PROVIDER = Object.freeze({
  OPENAI: 'OPENAI',
  GEMINI: 'GEMINI',
  GROK_XAI: 'GROK_XAI',
  DEEPSEEK: 'DEEPSEEK',
  IQAI_CORPUS: 'IQAI_CORPUS'
});

function env(key) {
  return String(process.env[key] || '').trim();
}

/**
 * @returns {object[]}
 */
export function buildSpatialAiProviderRegistry() {
  loadSharedProviderEnv();

  const openaiConfigured = Boolean(env('OPENAI_API_KEY'));
  const geminiConfigured = Boolean(env('GEMINI_API_KEY'));
  const xaiConfigured = Boolean(env('XAI_API_KEY') || env('GROK_API_KEY'));
  const deepseekConfigured = Boolean(env('DEEPSEEK_API_KEY'));

  return [
    {
      provider: SPATIAL_AI_PROVIDER.OPENAI,
      configured: openaiConfigured,
      model: env('IQAI_INTELLIGENCE_RESEARCH_MODEL') || 'gpt-4o',
      role: PROVIDER_ROLE.WEB_SCOUT,
      capabilities: openaiConfigured
        ? [PROVIDER_CAPABILITY.WEB_SEARCH, PROVIDER_CAPABILITY.FUNCTION_CALLING, PROVIDER_CAPABILITY.STRUCTURED_OUTPUT]
        : []
    },
    {
      provider: SPATIAL_AI_PROVIDER.GEMINI,
      configured: geminiConfigured,
      model: env('IQAI_GEMINI_RESEARCH_MODEL') || 'gemini-flash-latest',
      role: PROVIDER_ROLE.FAST_SCOUT,
      capabilities: geminiConfigured
        ? [PROVIDER_CAPABILITY.GOOGLE_SEARCH, PROVIDER_CAPABILITY.WEB_SEARCH, PROVIDER_CAPABILITY.STRUCTURED_OUTPUT]
        : []
    },
    {
      provider: SPATIAL_AI_PROVIDER.GROK_XAI,
      configured: xaiConfigured,
      model: env('IQAI_XAI_RESEARCH_MODEL') || env('XAI_MODEL') || env('GROK_MODEL') || 'grok-4.3',
      role: PROVIDER_ROLE.SOCIAL_AND_WEB_SCOUT,
      capabilities: xaiConfigured
        ? [PROVIDER_CAPABILITY.WEB_SEARCH, PROVIDER_CAPABILITY.X_SEARCH, PROVIDER_CAPABILITY.STRUCTURED_OUTPUT]
        : []
    },
    {
      provider: SPATIAL_AI_PROVIDER.DEEPSEEK,
      configured: deepseekConfigured,
      model: env('IQAI_DEEPSEEK_RESEARCH_MODEL') || env('DEEPSEEK_MODEL') || 'deepseek-chat',
      role: PROVIDER_ROLE.REASONER,
      capabilities: deepseekConfigured
        ? [PROVIDER_CAPABILITY.REASONING, PROVIDER_CAPABILITY.STRUCTURED_OUTPUT]
        : []
    },
    {
      provider: SPATIAL_AI_PROVIDER.IQAI_CORPUS,
      configured: true,
      model: 'iqai-corpus-v1',
      role: PROVIDER_ROLE.CORPUS,
      capabilities: [PROVIDER_CAPABILITY.CORPUS_SEARCH]
    }
  ];
}

/**
 * @param {object} receipt
 */
export function buildProviderReceipt(receipt = {}) {
  return {
    provider: receipt.provider || 'UNKNOWN',
    model: receipt.model || null,
    role: receipt.role || null,
    invoked: receipt.invoked === true,
    toolsUsed: receipt.toolsUsed || [],
    sourceCount: receipt.sourceCount || 0,
    latencyMs: receipt.latencyMs || 0,
    status: receipt.status || 'SKIPPED'
  };
}
