#!/usr/bin/env node
/**
 * Phase 4 Cross-Agent Spatial Analysis live acceptance.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  runCrossAgentSpatialAnalysis,
  proveSpatialFactRecompute,
  CROSS_AGENT_VERTICAL_SLICE_QUERY
} from '../src/spatial/orchestrator/cross-agent-spatial-coordinator.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, '..', 'artifacts', 'agent1-phase4-acceptance');

const executor = async () => ({ success: true, mutatedMap: true, receiptId: `exec-${Date.now()}` });

async function main() {
  const started = Date.now();
  const result = await runCrossAgentSpatialAnalysis({
    query: CROSS_AGENT_VERTICAL_SLICE_QUERY,
    conceptId: 'fires',
    geography: 'Greater Montréal',
    researchExecution: 'FAST',
    proximityThresholdMeters: 2000
  }, {
    sessionScope: `phase4:${Date.now()}`,
    executeMapActionPlan: executor
  });

  let recomputeProof = null;
  if (result.governedEvents.length >= 1) {
    const base = result.governedEvents[0];
    const refined = {
      ...base,
      governedEventVersion: (base.governedEventVersion || 1) + 1,
      candidate: {
        ...base.candidate,
        geometryVersion: (base.candidate?.geometryVersion || 1) + 1,
        geometry: {
          type: 'Point',
          coordinates: [
            base.candidate.geometry.coordinates[0] + 0.01,
            base.candidate.geometry.coordinates[1] + 0.01
          ]
        }
      }
    };
    recomputeProof = await proveSpatialFactRecompute(base, refined);
  }

  const payload = {
    generatedAt: new Date().toISOString(),
    objective: CROSS_AGENT_VERTICAL_SLICE_QUERY,
    windowDays: result.windowDays,
    finalState: result.finalState,
    governedEventCount: result.governedEvents.length,
    activeSpatialFactCount: result.activeSpatialFacts.length,
    hospitalDatasetReceipt: result.hospitalDatasetReceipt,
    sampleSpatialFact: result.activeSpatialFacts[0] || null,
    sampleExplanation: result.analysisSummary?.explanations?.[0] || null,
    recomputeProof,
    performance: result.performance,
    receipts: result.receipts,
    pass: result.governedEvents.length > 0
      && result.activeSpatialFacts.length > 0
      && result.analyticalPlans.length > 0,
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
