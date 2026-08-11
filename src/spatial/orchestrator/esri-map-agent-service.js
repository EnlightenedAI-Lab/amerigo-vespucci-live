/**
 * IQAI MAP SPECIALIST — bounded Esri map-local agent service (server).
 * Proposes MapActionPlans only; never schedules research or Agent 2.
 */
import { randomUUID } from 'node:crypto';
import {
  MAP_ACTION_TYPES,
  createMapActionPlan,
  ORCHESTRATOR_SCHEMA_VERSION
} from './contracts.js';
import { validateMapActionPlan } from './map-action-validator.js';

export const ESRI_MAP_AGENT_CAPABILITY = 'ESRI_MAP_AGENT';

export const ESRI_MAP_AGENT_ACTIONS = Object.freeze({
  ZOOM_NAVIGATE: 'ZOOM_NAVIGATE',
  LAYER_STATISTICS: 'LAYER_STATISTICS',
  HIGHLIGHT: 'HIGHLIGHT',
  FILTER: 'FILTER',
  QUERY_VISIBLE_LAYER: 'QUERY_VISIBLE_LAYER'
});

export const PILOT_LAYER_IDS = Object.freeze({
  HOSPITALS_DETERMINISTIC: 'iqai-deterministic-results',
  HOSPITALS_ANALYTICAL: 'iqai-analytical-hospitals',
  INTELLIGENCE_PREFIX: 'iqai-intelligence-'
});

export const MAP_LOCAL_PRESETS = Object.freeze({
  OLD_MONTREAL: {
    label: 'Old Montréal',
    center: { longitude: -73.5544, latitude: 45.5075 },
    zoom: 14
  }
});

const BLOCKED_PROMPT_PATTERN = /\b(gemini|grok|openai|deepseek|agent\s*2|govern-candidate|research|corpus|taskgraph|publish|persist|intelligence\s+layer\s+search|map\s+fires)\b/i;

/**
 * @param {string} prompt
 */
export function assertEsriMapAgentAuthorityBoundary(prompt = '') {
  if (BLOCKED_PROMPT_PATTERN.test(String(prompt))) {
    return { allowed: false, reason: 'CROSS_BOUNDARY_PROMPT', code: 'AUTHORITY_VIOLATION' };
  }
  return { allowed: true };
}

/**
 * @param {string} prompt
 */
export function classifyEsriMapAgentPrompt(prompt = '') {
  const text = String(prompt).toLowerCase().trim();
  if (/\bzoom\b.*\bold\s*montr[eé]al\b|\bgo\s+to\s+old\s+montr[eé]al\b/.test(text)) {
    return { intent: ESRI_MAP_AGENT_ACTIONS.ZOOM_NAVIGATE, preset: 'OLD_MONTREAL' };
  }
  if (/\b(zoom|go)\b.*\b(mapped\s+incident|incident|mapped\s+event)\b/.test(text)) {
    return { intent: ESRI_MAP_AGENT_ACTIONS.ZOOM_NAVIGATE, target: 'MAPPED_INCIDENT' };
  }
  if (/\bhow\s+many\b.*\bhospitals?\b/.test(text)) {
    return { intent: ESRI_MAP_AGENT_ACTIONS.LAYER_STATISTICS, layerRole: 'HOSPITALS' };
  }
  if (/\bhighlight\b.*\bhospitals?\b/.test(text)) {
    return { intent: ESRI_MAP_AGENT_ACTIONS.HIGHLIGHT, layerRole: 'HOSPITALS_ANALYTICAL' };
  }
  if (/\bshow\s+only\b.*\bhospitals?\b.*\b(analytical|result)\b/.test(text)) {
    return { intent: ESRI_MAP_AGENT_ACTIONS.FILTER, layerRole: 'HOSPITALS_ANALYTICAL', mode: 'ANALYTICAL_RESULT_ONLY' };
  }
  if (/\bquery\b.*\bvisible\b.*\blayer\b/.test(text)) {
    return { intent: ESRI_MAP_AGENT_ACTIONS.QUERY_VISIBLE_LAYER, layerRole: 'HOSPITALS' };
  }
  return { intent: null, reason: 'UNRECOGNIZED_MAP_LOCAL_PROMPT' };
}

function resolveHospitalLayerId(mapContext = {}) {
  const layers = mapContext.layers || [];
  const analytical = layers.find((l) => l.id === PILOT_LAYER_IDS.HOSPITALS_ANALYTICAL);
  if (analytical?.graphicCount > 0) return analytical.id;
  const deterministic = layers.find((l) => l.id === PILOT_LAYER_IDS.HOSPITALS_DETERMINISTIC);
  if (deterministic?.graphicCount > 0) return deterministic.id;
  return PILOT_LAYER_IDS.HOSPITALS_ANALYTICAL;
}

function resolveIntelligenceLayerId(mapContext = {}) {
  const layers = mapContext.layers || [];
  return layers.find((l) => String(l.id || '').startsWith(PILOT_LAYER_IDS.INTELLIGENCE_PREFIX))?.id
    || 'iqai-intelligence-fires';
}

/**
 * @param {object} input
 */
export function buildEsriMapAgentProposal(input = {}) {
  const { prompt, mapContext = {}, sessionScope = 'esri-map-agent' } = input;
  const authority = assertEsriMapAgentAuthorityBoundary(prompt);
  if (!authority.allowed) {
    const err = new Error(authority.reason);
    err.code = authority.code;
    throw err;
  }

  const classification = classifyEsriMapAgentPrompt(prompt);
  if (!classification.intent) {
    const err = new Error(classification.reason || 'UNRECOGNIZED_MAP_LOCAL_PROMPT');
    err.code = 'UNRECOGNIZED_PROMPT';
    throw err;
  }

  const planId = randomUUID();
  const actions = [];
  let mapResultPayload = {
    supported: true,
    esriMapAgent: true,
    capability: ESRI_MAP_AGENT_CAPABILITY,
    intent: classification.intent,
    prompt,
    readOnly: false
  };

  if (classification.intent === ESRI_MAP_AGENT_ACTIONS.ZOOM_NAVIGATE) {
    if (classification.preset === 'OLD_MONTREAL') {
      mapResultPayload = {
        ...mapResultPayload,
        zoomTarget: MAP_LOCAL_PRESETS.OLD_MONTREAL
      };
      actions.push({
        actionId: randomUUID(),
        type: MAP_ACTION_TYPES.ZOOM,
        mode: 'CENTER',
        center: MAP_LOCAL_PRESETS.OLD_MONTREAL.center,
        zoom: MAP_LOCAL_PRESETS.OLD_MONTREAL.zoom
      });
    } else {
      const layerId = resolveIntelligenceLayerId(mapContext);
      mapResultPayload = { ...mapResultPayload, zoomTarget: { layerId } };
      actions.push({
        actionId: randomUUID(),
        type: MAP_ACTION_TYPES.ZOOM,
        mode: 'FIT_LAYER',
        layerId
      });
    }
  }

  if (classification.intent === ESRI_MAP_AGENT_ACTIONS.LAYER_STATISTICS) {
    const layerId = resolveHospitalLayerId(mapContext);
    const count = (mapContext.layers || []).find((l) => l.id === layerId)?.graphicCount ?? 0;
    mapResultPayload = {
      ...mapResultPayload,
      readOnly: true,
      statistics: {
        layerId,
        count,
        method: 'GRAPHICS_LAYER_COUNT',
        authoritative: false,
        note: 'Count from visible IQAI GraphicsLayer graphics — verify against deterministic IQAI result for authority'
      }
    };
    actions.push({
      actionId: randomUUID(),
      type: MAP_ACTION_TYPES.SELECT,
      mode: 'LAYER_STATISTICS',
      layerId
    });
  }

  if (classification.intent === ESRI_MAP_AGENT_ACTIONS.HIGHLIGHT) {
    const layerId = PILOT_LAYER_IDS.HOSPITALS_ANALYTICAL;
    mapResultPayload = { ...mapResultPayload, highlightLayerId: layerId };
    actions.push({
      actionId: randomUUID(),
      type: MAP_ACTION_TYPES.HIGHLIGHT,
      layerId,
      mode: 'PROXIMITY_MATCH'
    });
  }

  if (classification.intent === ESRI_MAP_AGENT_ACTIONS.FILTER) {
    const layerId = PILOT_LAYER_IDS.HOSPITALS_ANALYTICAL;
    mapResultPayload = { ...mapResultPayload, filterLayerId: layerId, filterMode: classification.mode };
    actions.push({
      actionId: randomUUID(),
      type: MAP_ACTION_TYPES.FILTER,
      layerId,
      mode: classification.mode
    });
  }

  if (classification.intent === ESRI_MAP_AGENT_ACTIONS.QUERY_VISIBLE_LAYER) {
    const layerId = resolveHospitalLayerId(mapContext);
    mapResultPayload = {
      ...mapResultPayload,
      readOnly: true,
      queryResult: {
        layerId,
        graphicCount: (mapContext.layers || []).find((l) => l.id === layerId)?.graphicCount ?? 0
      }
    };
    actions.push({
      actionId: randomUUID(),
      type: MAP_ACTION_TYPES.SELECT,
      mode: 'QUERY_VISIBLE',
      layerId
    });
  }

  const plan = createMapActionPlan({
    planId,
    graphId: mapContext.graphId || randomUUID(),
    taskResultId: `esri-map-agent:${classification.intent}`,
    taskResultVersion: 1,
    sessionScope,
    actions,
    stableFeatureKeys: [`esri-map-agent:${classification.intent}`],
    mapResultRef: { resultId: planId, resultVersion: 1 },
    mapResultPayload
  });

  if (plan.schemaVersion !== ORCHESTRATOR_SCHEMA_VERSION) {
    const err = new Error('INVALID_PLAN_SCHEMA');
    err.code = 'INVALID_PLAN';
    throw err;
  }

  return {
    classification,
    proposal: {
      capability: ESRI_MAP_AGENT_CAPABILITY,
      intent: classification.intent,
      agentType: 'IQAI_MAP_SPECIALIST',
      builtInEsriAgent: false
    },
    mapActionPlan: plan
  };
}

/**
 * @param {object} input
 */
export function proposeAndValidateEsriMapAgentPlan(input = {}) {
  const started = Date.now();
  const built = buildEsriMapAgentProposal(input);
  const validation = validateMapActionPlan(built.mapActionPlan, {
    sessionScope: input.sessionScope || built.mapActionPlan.sessionScope,
    expectedResultVersion: 1,
    mapResultPayload: built.mapActionPlan.mapResultPayload
  });
  return {
    ...built,
    validation,
    approved: validation.approved,
    latencyMs: Date.now() - started,
    authority: {
      iqaiCoordinatorTopLevel: true,
      agent2Reachable: false,
      researchProvidersReachable: false,
      mapActionPlanBypass: false
    }
  };
}

/**
 * Inject prohibited field to test validator rejection.
 */
export function buildInvalidEsriMapAgentPlanForTest(sessionScope = 'test') {
  const built = buildEsriMapAgentProposal({
    prompt: 'Zoom to Old Montréal.',
    mapContext: { layers: [] },
    sessionScope
  });
  built.mapActionPlan.actions[0].javascript = 'alert(1)';
  return built.mapActionPlan;
}
