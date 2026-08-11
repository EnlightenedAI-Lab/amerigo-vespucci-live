import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  assertEsriMapAgentAuthorityBoundary,
  classifyEsriMapAgentPrompt,
  proposeAndValidateEsriMapAgentPlan,
  buildInvalidEsriMapAgentPlanForTest,
  ESRI_MAP_AGENT_ACTIONS,
  ESRI_MAP_AGENT_CAPABILITY,
  MAP_LOCAL_PRESETS
} from '../src/spatial/orchestrator/esri-map-agent-service.js';
import { assessEsriAiFeasibility } from '../src/spatial/orchestrator/esri-ai-feasibility.js';
import { validateMapActionPlan } from '../src/spatial/orchestrator/map-action-validator.js';
import { MAP_ACTION_TYPES } from '../src/spatial/orchestrator/contracts.js';
import { isEsriMapAgentPilotEnabled } from '../src/spatial/orchestrator/esri-map-agent-routes.js';

const MAP_CONTEXT = {
  graphId: 'graph-phase5',
  layers: [
    { id: 'iqai-deterministic-results', graphicCount: 12, type: 'graphics' },
    { id: 'iqai-analytical-hospitals', graphicCount: 3, type: 'graphics' },
    { id: 'iqai-intelligence-fires', graphicCount: 1, type: 'graphics' }
  ]
};

describe('Phase 5 Esri map agent bounded pilot', () => {
  it('documents inspected feasibility and bounded custom agent pilot', () => {
    const feasibility = assessEsriAiFeasibility();
    assert.equal(feasibility.implementationStatus, 'BOUNDED_CUSTOM_AGENT_PILOT');
    assert.equal(feasibility.aiComponentsPackageInstalled, false);
    assert.equal(feasibility.builtInAgentsEvaluated.navigationAgent.integrated, false);
    assert.equal(feasibility.builtInAgentsEvaluated.dataExplorationAgent.integrated, false);
    assert.equal(feasibility.builtInAgentsEvaluated.customFunctionAgent.integrated, true);
    assert.match(feasibility.sdkVersion, /5\.1/);
  });

  it('classifies map-local pilot prompts', () => {
    assert.equal(
      classifyEsriMapAgentPrompt('Zoom to Old Montréal.').intent,
      ESRI_MAP_AGENT_ACTIONS.ZOOM_NAVIGATE
    );
    assert.equal(
      classifyEsriMapAgentPrompt('How many hospitals are currently in the hospital layer?').intent,
      ESRI_MAP_AGENT_ACTIONS.LAYER_STATISTICS
    );
    assert.equal(
      classifyEsriMapAgentPrompt('Highlight hospitals in the current analytical result.').intent,
      ESRI_MAP_AGENT_ACTIONS.HIGHLIGHT
    );
    assert.equal(
      classifyEsriMapAgentPrompt('Show only hospitals within the analytical result set.').intent,
      ESRI_MAP_AGENT_ACTIONS.FILTER
    );
  });

  it('blocks cross-boundary prompts (dual-orchestrator guard)', () => {
    const blocked = [
      'Run Gemini research on hospitals',
      'Call Agent 2 to govern candidate',
      'Publish intelligence to corpus',
      'Expand TaskGraph budget'
    ];
    for (const prompt of blocked) {
      const gate = assertEsriMapAgentAuthorityBoundary(prompt);
      assert.equal(gate.allowed, false, prompt);
      assert.throws(
        () => proposeAndValidateEsriMapAgentPlan({ prompt, mapContext: MAP_CONTEXT }),
        /CROSS_BOUNDARY_PROMPT/
      );
    }
  });

  it('proposes validated MapActionPlan for zoom preset without bypass', () => {
    const result = proposeAndValidateEsriMapAgentPlan({
      prompt: 'Zoom to Old Montréal.',
      mapContext: MAP_CONTEXT,
      sessionScope: 'phase5-zoom'
    });
    assert.equal(result.approved, true);
    assert.equal(result.proposal.capability, ESRI_MAP_AGENT_CAPABILITY);
    assert.equal(result.proposal.agentType, 'IQAI_MAP_SPECIALIST');
    assert.equal(result.proposal.builtInEsriAgent, false);
    assert.equal(result.mapActionPlan.actions[0].type, MAP_ACTION_TYPES.ZOOM);
    assert.deepEqual(result.mapActionPlan.actions[0].center, MAP_LOCAL_PRESETS.OLD_MONTREAL.center);
    assert.equal(result.authority.agent2Reachable, false);
    assert.equal(result.authority.researchProvidersReachable, false);
    assert.equal(result.authority.mapActionPlanBypass, false);
  });

  it('returns read-only statistics from GraphicsLayer context', () => {
    const result = proposeAndValidateEsriMapAgentPlan({
      prompt: 'How many hospitals are in this layer?',
      mapContext: MAP_CONTEXT,
      sessionScope: 'phase5-stats'
    });
    assert.equal(result.approved, true);
    assert.equal(result.classification.intent, ESRI_MAP_AGENT_ACTIONS.LAYER_STATISTICS);
    assert.equal(result.mapActionPlan.mapResultPayload.statistics.count, 3);
    assert.equal(result.mapActionPlan.mapResultPayload.statistics.method, 'GRAPHICS_LAYER_COUNT');
    assert.equal(result.mapActionPlan.mapResultPayload.readOnly, true);
  });

  it('rejects invalid map actions via IQAI validator (no unauthorized mutation)', () => {
    const invalidPlan = buildInvalidEsriMapAgentPlanForTest('phase5-invalid');
    const validation = validateMapActionPlan(invalidPlan, {
      sessionScope: 'phase5-invalid',
      expectedResultVersion: 1
    });
    assert.equal(validation.approved, false);
    assert.ok(validation.issues.some((issue) => issue.startsWith('PROHIBITED_FIELD:javascript')));
  });

  it('feature flag OFF keeps route disabled', () => {
    const prev = process.env.IQAI_ESRI_AGENTIC_V1_ENABLED;
    process.env.IQAI_ESRI_AGENTIC_V1_ENABLED = 'false';
    assert.equal(isEsriMapAgentPilotEnabled(), false);
    if (prev == null) delete process.env.IQAI_ESRI_AGENTIC_V1_ENABLED;
    else process.env.IQAI_ESRI_AGENTIC_V1_ENABLED = prev;
  });
});
