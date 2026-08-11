#!/usr/bin/env node
import 'dotenv/config';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { loadSharedProviderEnv } from '../src/spatial/intelligence-layer-shared-env.js';
import { executeIntelligenceLayerSearch } from '../src/spatial/intelligence-layer-search-handler.js';
import { createSpatialLatencyTrace } from '../src/spatial/spatial-latency-trace.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(__dirname, '..', 'artifacts', 'agent1-search-map-latency-profiler');
const benchmarks = [
  { id: 'A', query: 'Map protests and demonstrations reported in Greater Montréal during the last 30 days.', days: 30 },
  { id: 'B', query: 'Map significant fires, explosions, or hazardous-material incidents reported in Greater Montréal during the last 30 days.', days: 30 },
  { id: 'C', query: 'Map significant infrastructure disruptions reported in Greater Montréal during the last 7 days.', days: 7 }
];

loadSharedProviderEnv();

async function run(benchmark, strategy) {
  const traceId = randomUUID();
  const trace = createSpatialLatencyTrace(traceId, { strategy });
  const from = new Date(Date.now() - benchmark.days * 86400000).toISOString();
  const to = new Date().toISOString();
  const started = Date.now();
  const result = await executeIntelligenceLayerSearch({
    query: benchmark.query,
    geography: 'Greater Montréal',
    from,
    to,
    temporalField: 'OCCURRED',
    includeLive: true,
    researchExecution: strategy,
    traceId
  }, { trace });
  const lt = result.latencyTrace || trace.toPayload();
  return {
    id: benchmark.id,
    query: benchmark.query,
    strategy,
    wallClockMs: Date.now() - started,
    mapped: result.combined?.mappable || 0,
    events: result.combined?.distinctEvents || 0,
    providers: [
      result.researchAudit?.geminiInvoked ? 'GEMINI' : null,
      result.researchAudit?.grokInvoked ? 'GROK_XAI' : null,
      result.researchAudit?.openaiInvoked ? 'OPENAI' : null,
      result.researchAudit?.deepseekInvoked ? 'DEEPSEEK' : null,
      result.researchAudit?.iqaiCorpusInvoked ? 'IQAI_CORPUS' : null
    ].filter(Boolean),
    milestones: lt.milestones,
    fastBlocking: lt.fastBlocking,
    topSpans: (lt.spans || []).sort((a, b) => b.durationMs - a.durationMs).slice(0, 6),
    agent2: { callCount: lt.agent2?.callCount || 0, totalMs: lt.agent2?.totalMs || 0 },
    geocoding: { totalMs: lt.geocoding?.totalMs || 0, calls: lt.geocoding?.calls?.length || 0, mode: lt.geocoding?.mode }
  };
}

const out = { generatedAt: new Date().toISOString(), fast: [], deep: [] };
for (const benchmark of benchmarks) out.fast.push(await run(benchmark, 'FAST'));
for (const benchmark of benchmarks) out.deep.push(await run(benchmark, 'DEEP'));
mkdirSync(OUT, { recursive: true });
writeFileSync(resolve(OUT, 'server-only.json'), JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
