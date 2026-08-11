#!/usr/bin/env node
/**
 * Live progressive intelligence demonstration — requires IQAI_PROGRESSIVE_INTELLIGENCE_V1_ENABLED=true
 * and configured Gemini key for live retrieval.
 */
import { runProgressiveIntelligenceGraph, PROGRESSIVE_VERTICAL_SLICE_QUERY } from '../src/spatial/orchestrator/progressive-intelligence-coordinator.js';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const artifactDir = join(__dirname, '..', 'artifacts', 'agent1-progressive-intelligence');

async function main() {
  const now = new Date();
  const windows = [30, 90];
  let lastResult = null;

  for (const days of windows) {
    const from = new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
    const to = now.toISOString();
    const started = Date.now();
    const result = await runProgressiveIntelligenceGraph({
      query: PROGRESSIVE_VERTICAL_SLICE_QUERY.replace('30 days', `${days} days`),
      conceptId: 'fires',
      geography: 'Greater Montréal',
      from,
      to,
      researchExecution: 'FAST'
    }, {
      sessionScope: `demo:${Date.now()}`
    });
    lastResult = { result, days, started };
    if (result.ok && result.pendingMapPlans?.length > 0) break;
  }

  const { result, days, started } = lastResult;

  const payload = {
    generatedAt: new Date().toISOString(),
    query: PROGRESSIVE_VERTICAL_SLICE_QUERY,
    windowDays: days,
    mappedCount: result.mappedCount,
    pendingPlans: result.pendingMapPlans?.length || 0,
    finalState: result.finalState,
    selectedProvider: result.performance?.selectedProvider,
    fallbackUsed: result.performance?.fallbackUsed,
    agent2RestLatencyMs: result.performance?.agent2RestLatencyMs,
    milestones: result.milestones,
    performance: result.performance,
    admittedEventIds: result.streamResult?.admittedEventIds || [],
    totalMs: Date.now() - started
  };

  mkdirSync(artifactDir, { recursive: true });
  writeFileSync(join(artifactDir, 'latest.json'), JSON.stringify(payload, null, 2));
  console.log(JSON.stringify(payload, null, 2));
  process.exit(result.ok ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
