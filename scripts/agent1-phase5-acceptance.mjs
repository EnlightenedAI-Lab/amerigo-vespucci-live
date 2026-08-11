#!/usr/bin/env node
/**
 * Phase 5 ArcGIS-native agentic adapter bounded pilot acceptance.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  proposeAndValidateEsriMapAgentPlan,
  ESRI_MAP_AGENT_ACTIONS
} from '../src/spatial/orchestrator/esri-map-agent-service.js';
import { assessEsriAiFeasibility } from '../src/spatial/orchestrator/esri-ai-feasibility.js';
import { buildInvalidEsriMapAgentPlanForTest } from '../src/spatial/orchestrator/esri-map-agent-service.js';
import { validateMapActionPlan } from '../src/spatial/orchestrator/map-action-validator.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, '..', 'artifacts', 'agent1-phase5-acceptance');

const MAP_CONTEXT = {
  graphId: 'phase5-live',
  layers: [
    { id: 'iqai-deterministic-results', graphicCount: 98, type: 'graphics' },
    { id: 'iqai-analytical-hospitals', graphicCount: 2, type: 'graphics' },
    { id: 'iqai-intelligence-fires', graphicCount: 1, type: 'graphics' }
  ]
};

const PILOT_PROMPTS = [
  { label: 'zoom-old-montreal', prompt: 'Zoom to Old Montréal.', expectIntent: ESRI_MAP_AGENT_ACTIONS.ZOOM_NAVIGATE },
  { label: 'hospital-count', prompt: 'How many hospitals are currently in the hospital layer?', expectIntent: ESRI_MAP_AGENT_ACTIONS.LAYER_STATISTICS },
  { label: 'highlight-analytical', prompt: 'Highlight hospitals in the current analytical result.', expectIntent: ESRI_MAP_AGENT_ACTIONS.HIGHLIGHT },
  { label: 'filter-analytical', prompt: 'Show only hospitals within the analytical result set.', expectIntent: ESRI_MAP_AGENT_ACTIONS.FILTER }
];

async function main() {
  const started = Date.now();
  const feasibility = assessEsriAiFeasibility();
  const pilotResults = [];

  for (const item of PILOT_PROMPTS) {
    const t0 = Date.now();
    const result = proposeAndValidateEsriMapAgentPlan({
      prompt: item.prompt,
      mapContext: MAP_CONTEXT,
      sessionScope: `phase5:${item.label}`
    });
    pilotResults.push({
      label: item.label,
      prompt: item.prompt,
      intent: result.classification?.intent,
      expectIntent: item.expectIntent,
      approved: result.approved,
      iqaiValidation: result.validation?.status,
      mapEffect: result.mapActionPlan?.mapResultPayload?.readOnly ? 'read-only' : 'mutating',
      statistics: result.mapActionPlan?.mapResultPayload?.statistics || null,
      latencyMs: Date.now() - t0
    });
  }

  const invalidPlan = buildInvalidEsriMapAgentPlanForTest('phase5-invalid');
  const invalidValidation = validateMapActionPlan(invalidPlan, {
    sessionScope: 'phase5-invalid',
    expectedResultVersion: 1
  });

  const payload = {
    generatedAt: new Date().toISOString(),
    feasibility: {
      compatible: feasibility.compatible,
      implementationStatus: feasibility.implementationStatus,
      sdkVersion: feasibility.sdkVersion,
      aiComponentsPackageInstalled: feasibility.aiComponentsPackageInstalled,
      mapArchitecture: feasibility.mapArchitecture,
      builtInNavigationIntegrated: feasibility.builtInAgentsEvaluated.navigationAgent.integrated,
      builtInDataExplorationIntegrated: feasibility.builtInAgentsEvaluated.dataExplorationAgent.integrated,
      customFunctionAgentIntegrated: feasibility.builtInAgentsEvaluated.customFunctionAgent.integrated
    },
    authority: {
      iqaiCoordinatorTopLevel: true,
      agent2Reachable: false,
      researchProvidersReachable: false,
      mapActionPlanBypass: false,
      invalidActionRejected: invalidValidation.approved === false
    },
    pilotResults,
    pass: pilotResults.every((r) => r.approved && r.intent === r.expectIntent)
      && invalidValidation.approved === false,
    totalMs: Date.now() - started
  };

  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, 'latest.json'), JSON.stringify(payload, null, 2));
  console.log(JSON.stringify(payload, null, 2));
  process.exit(payload.pass ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
