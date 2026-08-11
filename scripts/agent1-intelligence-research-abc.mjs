#!/usr/bin/env node
/**
 * A/B/C intelligence research comparison — OpenAI vs Gemini vs MULTI.
 */
import 'dotenv/config';
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { researchEvents } from '../src/spatial/intelligence-layer-research-events.js';
import { finalizeIntelligenceLayerResult } from '../src/spatial/intelligence-layer-search-handler.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(__dirname, '..', 'artifacts', 'agent1-intelligence-research-abc');

const QUERY = {
  query: 'shootings firearm incidents',
  conceptId: 'shootings',
  geography: 'Greater Montréal',
  from: new Date(Date.now() - 30 * 86400000).toISOString(),
  to: new Date().toISOString(),
  temporalField: 'OCCURRED',
  includeLive: true
};

async function runMode(mode) {
  const started = Date.now();
  const raw = await researchEvents({ ...QUERY, researchProvider: mode });
  const result = finalizeIntelligenceLayerResult(raw, QUERY);
  return {
    mode,
    latencyMs: Date.now() - started,
    providerLatencyMs: result.researchAudit?.latencyMs || null,
    distinctEvents: result.combined?.distinctEvents || 0,
    mapped: result.combined?.mappable || 0,
    unresolved: result.combined?.unresolved || 0,
    domains: result.combined?.domains || [],
    rawSourceReports: result.researchConsolidation?.rawSourceReports || 0,
    englishSources: result.live?.englishSources || 0,
    frenchSources: result.live?.frenchSources || 0,
    unsupportedRejected: result.researchConsolidation?.unsupportedRejected || 0,
    temporalRejected: result.temporalGate?.rejected || 0,
    webSearchInvoked: result.researchAudit?.webSearchInvoked || false,
    googleSearchInvoked: result.researchAudit?.googleSearchInvoked || false,
    iqaiCorpusInvoked: result.researchAudit?.iqaiCorpusInvoked || false,
    openaiModel: result.researchAudit?.openai?.model || null,
    geminiModel: result.researchAudit?.gemini?.model || null,
    providerErrors: result.researchAudit?.providerErrors || [],
    contractMode: result.contract?.mode || null
  };
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const report = {
    generatedAt: new Date().toISOString(),
    query: QUERY,
    credentials: {
      openai: Boolean(process.env.OPENAI_API_KEY),
      gemini: Boolean(process.env.GEMINI_API_KEY)
    },
    runs: {}
  };

  for (const mode of ['OPENAI', 'GEMINI', 'MULTI']) {
    try {
      report.runs[mode] = await runMode(mode);
    } catch (error) {
      report.runs[mode] = { mode, error: error?.message || String(error) };
    }
  }

  writeFileSync(resolve(OUT, 'latest.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
