/**
 * Capability-first live provider selection — FAST / DEEP orchestration V1.
 */
import {
  RESEARCH_EXECUTION,
  resolveResearchExecution
} from '../intelligence-layer-research-contract.js';
import {
  buildSpatialAiProviderRegistry,
  PROVIDER_CAPABILITY,
  PROVIDER_ROLE,
  SPATIAL_AI_PROVIDER
} from '../intelligence-layer-provider-registry.js';
import { gatherGeminiResearchCandidates } from '../intelligence-layer-gemini-research.js';
import { gatherGrokResearchCandidates, resolveGrokApiKey } from '../intelligence-layer-grok-research.js';
import { gatherOpenAiResearchCandidates } from '../intelligence-layer-llm-research.js';

export const OBJECTIVE_CLASS = Object.freeze({
  GENERIC_WEB_EVENT: 'GENERIC_WEB_EVENT',
  SOCIAL_X_EVENT: 'SOCIAL_X_EVENT',
  CORPUS_HISTORICAL: 'CORPUS_HISTORICAL',
  MIXED_EVENT_DISCOVERY: 'MIXED_EVENT_DISCOVERY'
});

export const FAST_FIRST_RESULT_DEADLINE_MS = Number(
  process.env.IQAI_FAST_FIRST_RESULT_DEADLINE_MS || 25_000
);
export const DEEP_MAX_LIVE_BRANCHES = 3;

const LIVE_WORKER_DEFS = Object.freeze([
  {
    provider: SPATIAL_AI_PROVIDER.GEMINI,
    workerId: 'gemini-live-retrieval',
    providerLabel: 'GEMINI',
    traceProvider: 'GEMINI',
    retrievalProvider: 'gemini-google-search-v1',
    researchOrigin: 'gemini-google-search',
    requiredCapabilities: [PROVIDER_CAPABILITY.GOOGLE_SEARCH, PROVIDER_CAPABILITY.WEB_SEARCH],
    roles: [PROVIDER_ROLE.FAST_SCOUT],
    sourceFamilies: ['OPEN_WEB', 'GOOGLE_SEARCH'],
    isConfigured: () => Boolean(String(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '').trim()),
    gather: gatherGeminiResearchCandidates
  },
  {
    provider: SPATIAL_AI_PROVIDER.GROK_XAI,
    workerId: 'grok-live-retrieval',
    providerLabel: 'GROK_XAI',
    traceProvider: 'GROK_XAI',
    retrievalProvider: 'grok-xai-search-v1',
    researchOrigin: 'grok-xai-search',
    requiredCapabilities: [PROVIDER_CAPABILITY.X_SEARCH],
    roles: [PROVIDER_ROLE.SOCIAL_AND_WEB_SCOUT],
    sourceFamilies: ['SOCIAL_X', 'OPEN_WEB'],
    isConfigured: () => Boolean(resolveGrokApiKey()),
    gather: gatherGrokResearchCandidates
  },
  {
    provider: SPATIAL_AI_PROVIDER.OPENAI,
    workerId: 'openai-live-retrieval',
    providerLabel: 'OPENAI',
    traceProvider: 'OPENAI',
    retrievalProvider: 'openai-web-search-v1',
    researchOrigin: 'openai-web-research',
    requiredCapabilities: [PROVIDER_CAPABILITY.WEB_SEARCH],
    roles: [PROVIDER_ROLE.WEB_SCOUT],
    sourceFamilies: ['OPEN_WEB'],
    isConfigured: () => Boolean(String(process.env.OPENAI_API_KEY || '').trim()),
    gather: gatherOpenAiResearchCandidates
  }
]);

/**
 * @param {object} request
 */
export function classifyResearchObjective(request = {}) {
  const text = String(request.query || request.originalText || '').toLowerCase();
  const concept = String(request.conceptId || '').toLowerCase();
  if (/\b(x\.com|twitter|tweet|social media|x post|on x)\b/i.test(text)) {
    return OBJECTIVE_CLASS.SOCIAL_X_EVENT;
  }
  if (concept === 'corpus' || /\b(corpus|historical|archive|internal record)\b/i.test(text)) {
    return OBJECTIVE_CLASS.CORPUS_HISTORICAL;
  }
  if (/\b(fires?|explosions?|hazmat|hazardous[-\s]?material|incidents?)\b/i.test(text)) {
    return OBJECTIVE_CLASS.MIXED_EVENT_DISCOVERY;
  }
  return OBJECTIVE_CLASS.GENERIC_WEB_EVENT;
}

function registryHealth(registry = [], provider) {
  const entry = registry.find((item) => item.provider === provider);
  return entry?.configured ? 'HEALTHY' : 'UNCONFIGURED';
}

function rankWorkers(workers, objectiveClass) {
  const priority = {
    [OBJECTIVE_CLASS.SOCIAL_X_EVENT]: [SPATIAL_AI_PROVIDER.GROK_XAI, SPATIAL_AI_PROVIDER.GEMINI, SPATIAL_AI_PROVIDER.OPENAI],
    [OBJECTIVE_CLASS.GENERIC_WEB_EVENT]: [SPATIAL_AI_PROVIDER.GEMINI, SPATIAL_AI_PROVIDER.OPENAI, SPATIAL_AI_PROVIDER.GROK_XAI],
    [OBJECTIVE_CLASS.MIXED_EVENT_DISCOVERY]: [SPATIAL_AI_PROVIDER.GEMINI, SPATIAL_AI_PROVIDER.GROK_XAI, SPATIAL_AI_PROVIDER.OPENAI],
    [OBJECTIVE_CLASS.CORPUS_HISTORICAL]: [SPATIAL_AI_PROVIDER.GEMINI, SPATIAL_AI_PROVIDER.OPENAI, SPATIAL_AI_PROVIDER.GROK_XAI]
  };
  const order = priority[objectiveClass] || priority[OBJECTIVE_CLASS.GENERIC_WEB_EVENT];
  return [...workers].sort((a, b) => order.indexOf(a.provider) - order.indexOf(b.provider));
}

/**
 * @param {object} request
 * @param {object} [deps]
 */
export function selectLiveProviderPlan(request = {}, deps = {}) {
  const execution = resolveResearchExecution(request);
  const objectiveClass = classifyResearchObjective(request);
  const registry = deps.registry || buildSpatialAiProviderRegistry();
  const eligible = rankWorkers(
    LIVE_WORKER_DEFS.filter((worker) => worker.isConfigured()),
    objectiveClass
  );

  const eligibleProviders = eligible.map((worker) => ({
    provider: worker.providerLabel,
    workerId: worker.workerId,
    health: registryHealth(registry, worker.provider),
    sourceFamilies: worker.sourceFamilies
  }));

  if (execution === RESEARCH_EXECUTION.DEEP) {
    const branches = [];
    const primary = eligible[0] || null;
    if (primary) branches.push(primary);

    const complementary = objectiveClass === OBJECTIVE_CLASS.SOCIAL_X_EVENT
      ? eligible.find((w) => w.provider === SPATIAL_AI_PROVIDER.GROK_XAI && w !== primary)
      : eligible.find((w) => w.provider === SPATIAL_AI_PROVIDER.OPENAI && w !== primary);
    if (complementary && !branches.includes(complementary)) branches.push(complementary);

    const diversity = eligible.find((w) => !branches.includes(w));
    if (diversity && branches.length < DEEP_MAX_LIVE_BRANCHES) branches.push(diversity);

    return {
      execution,
      objectiveClass,
      eligibleProviders,
      primary: primary ? { ...primary } : null,
      fallback: null,
      branches: branches.slice(0, DEEP_MAX_LIVE_BRANCHES),
      maxLiveBranches: DEEP_MAX_LIVE_BRANCHES,
      firstResultDeadlineMs: FAST_FIRST_RESULT_DEADLINE_MS,
      selectionReason: `DEEP:${objectiveClass}:complementary_branches=${branches.length}`
    };
  }

  const primary = eligible[0] || null;
  const fallback = eligible[1] || null;
  let selectionReason = 'FAST:NO_ELIGIBLE_PROVIDER';
  if (primary) {
    selectionReason = objectiveClass === OBJECTIVE_CLASS.SOCIAL_X_EVENT && primary.provider === SPATIAL_AI_PROVIDER.GROK_XAI
      ? 'FAST:social_x_primary'
      : 'FAST:generic_web_primary';
  }

  return {
    execution,
    objectiveClass,
    eligibleProviders,
    primary: primary ? { ...primary } : null,
    fallback: fallback ? { ...fallback } : null,
    branches: primary ? [primary] : [],
    maxLiveBranches: 1,
    firstResultDeadlineMs: FAST_FIRST_RESULT_DEADLINE_MS,
    selectionReason
  };
}

export function liveWorkerChainFromPlan(plan = {}) {
  if (plan.execution === RESEARCH_EXECUTION.DEEP) {
    return plan.branches || [];
  }
  const chain = [];
  if (plan.primary) chain.push(plan.primary);
  if (plan.fallback) chain.push(plan.fallback);
  return chain;
}

export { LIVE_WORKER_DEFS };
