#!/usr/bin/env node
/**
 * Multi-AI provider activation — credential discovery + FAST benchmarks.
 */
import 'dotenv/config';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadSharedProviderEnv, getProviderCredentialStatus, auditReflectiveDiagnosticsSecrets } from '../src/spatial/intelligence-layer-shared-env.js';
import { buildSpatialAiProviderRegistry } from '../src/spatial/intelligence-layer-provider-registry.js';
import { researchEvents } from '../src/spatial/intelligence-layer-research-events.js';
import { finalizeIntelligenceLayerResult } from '../src/spatial/intelligence-layer-search-handler.js';
import { gatherGeminiResearchCandidates } from '../src/spatial/intelligence-layer-gemini-research.js';
import { gatherGrokResearchCandidates } from '../src/spatial/intelligence-layer-grok-research.js';
import { consolidateCandidatesWithDeepSeek } from '../src/spatial/intelligence-layer-deepseek-consolidation.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const OUT = resolve(REPO_ROOT, 'artifacts', 'agent1-multi-ai-provider-activation');
const SPATIAL_ENV = resolve(REPO_ROOT, '.env');
const RD_REPO = 'C:\\Users\\nicol\\OneDrive\\Reflective Diagnostics api backup version\\reflective-diagnostics-api';

async function probeProvider(name, fn) {
  const started = Date.now();
  try {
    const result = await fn();
    return {
      connected: true,
      latencyMs: Date.now() - started,
      ...result
    };
  } catch (error) {
    return {
      connected: false,
      latencyMs: Date.now() - started,
      error: error?.message || String(error),
      code: error?.code || null
    };
  }
}

function benchmarkQuery(conceptId, query) {
  return {
    query,
    conceptId,
    geography: 'Greater Montréal',
    from: new Date(Date.now() - 30 * 86400000).toISOString(),
    to: new Date().toISOString(),
    temporalField: 'OCCURRED',
    includeLive: true,
    researchExecution: 'FAST'
  };
}

async function runFastBenchmark(label, request) {
  const started = Date.now();
  const raw = await researchEvents(request);
  const finalized = finalizeIntelligenceLayerResult(raw, request);
  const perf = finalized.researchPerformance || {};
  return {
    label,
    timeToFirstMappableEventMs: perf.timeToFirstMappableEventMs,
    totalElapsedMs: Date.now() - started,
    totalResearchTimeMs: perf.totalResearchTimeMs,
    groundedReports: finalized.researchConsolidation?.rawSourceReports || 0,
    domains: finalized.combined?.domains || [],
    distinctEvents: finalized.combined?.distinctEvents || 0,
    mapped: finalized.combined?.mappable || 0,
    unresolved: finalized.combined?.unresolved || 0,
    englishSources: finalized.researchConsolidation?.englishSources || 0,
    frenchSources: finalized.researchConsolidation?.frenchSources || 0,
    providers: finalized.researchAudit?.providerReceipts || [],
    contractMode: finalized.contract?.mode || null
  };
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const shared = loadSharedProviderEnv();
  const rdAudit = auditReflectiveDiagnosticsSecrets();
  const credentials = getProviderCredentialStatus();
  const registry = buildSpatialAiProviderRegistry();

  const report = {
    generatedAt: new Date().toISOString(),
    state: 'FAIL',
    secretsDiscovery: {
      reflectiveDiagnosticsProjectRoot: rdAudit.secretsTomlPath
        ? resolve(rdAudit.secretsTomlPath, '..', '..')
        : null,
      reflectiveDiagnosticsRepoIdentified: Boolean(rdAudit.secretsTomlPath),
      secretsTomlPath: rdAudit.secretsTomlPath,
      secretMechanism: rdAudit.mechanism || shared.mechanism,
      secretsPyFound: false,
      spatialEnvFile: SPATIAL_ENV,
      sharedEnvLoadedFrom: shared.loadedFrom || rdAudit.secretsTomlPath || null,
      sharedEnvSupplementedKeys: shared.supplemented,
      rdKeyAudit: rdAudit.keys,
      credentials: {
        GEMINI_API_KEY: credentials.GEMINI_API_KEY ? 'PRESENT' : 'ABSENT',
        GROK_API_KEY: credentials.GROK_API_KEY ? 'PRESENT' : 'ABSENT',
        XAI_API_KEY: credentials.XAI_API_KEY ? 'PRESENT' : 'ABSENT',
        DEEPSEEK_API_KEY: credentials.DEEPSEEK_API_KEY ? 'PRESENT' : 'ABSENT',
        OPENAI_API_KEY: credentials.OPENAI_API_KEY ? 'PRESENT' : 'ABSENT'
      }
    },
    providerRegistry: registry.map((entry) => ({
      provider: entry.provider,
      configured: entry.configured,
      model: entry.model,
      role: entry.role,
      capabilities: entry.capabilities
    })),
    providers: {},
    fastBenchmark: { crime30d: null, shootings30d: null },
    blockers: []
  };

  report.providers.gemini = await probeProvider('GEMINI', async () => {
    if (!credentials.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY not configured');
    const run = await gatherGeminiResearchCandidates(benchmarkQuery('crime', 'crime'));
    return {
      model: run.audit?.model,
      googleSearchInvoked: run.audit?.googleSearchInvoked === true,
      sourceCount: run.candidates?.length || 0
    };
  });

  report.providers.grok = await probeProvider('GROK', async () => {
    if (!credentials.GROK_API_KEY && !credentials.XAI_API_KEY) throw new Error('GROK_API_KEY not configured');
    const run = await gatherGrokResearchCandidates(benchmarkQuery('crime', 'crime'));
    return {
      model: run.audit?.model,
      webSearchInvoked: run.audit?.webSearchInvoked === true,
      xSearchInvoked: run.audit?.xSearchInvoked === true,
      sourceCount: run.candidates?.length || 0
    };
  });

  report.providers.deepseek = await probeProvider('DEEPSEEK', async () => {
    if (!credentials.DEEPSEEK_API_KEY) throw new Error('DEEPSEEK_API_KEY not configured');
    const result = await consolidateCandidatesWithDeepSeek([
      {
        title: 'A',
        occurredAt: '2026-07-30',
        locationText: 'Montréal',
        sourceReports: [{ url: 'https://example.com/a' }]
      },
      {
        title: 'B',
        occurredAt: '2026-07-30',
        locationText: 'Montréal',
        sourceReports: [{ url: 'https://example.com/b' }]
      }
    ], { query: 'crime', geography: 'Greater Montréal' });
    return {
      model: result.receipt?.model,
      role: 'REASONER / CONSOLIDATOR',
      invoked: result.invoked,
      status: result.status
    };
  });

  const anyScout = credentials.GEMINI_API_KEY || credentials.XAI_API_KEY || credentials.OPENAI_API_KEY;
  if (anyScout) {
    if (credentials.GEMINI_API_KEY) {
      report.fastBenchmark.crime30d = await runFastBenchmark('crime', benchmarkQuery('crime', 'crime'));
      report.fastBenchmark.shootings30d = await runFastBenchmark('shootings', benchmarkQuery('shootings', 'shootings firearm incidents'));
    } else {
      report.blockers.push('FAST benchmark requires GEMINI_API_KEY for Gemini-primary FAST mode');
    }
  } else {
    report.blockers.push('No scout provider credentials available locally');
  }

  const connectedScouts = [
    report.providers.gemini.connected,
    report.providers.grok.connected,
    credentials.OPENAI_API_KEY
  ].filter(Boolean).length;

  if (connectedScouts > 0) report.state = 'PARTIAL';
  if (report.providers.gemini.connected && report.fastBenchmark.crime30d?.mapped > 0) report.state = 'PASS';
  if (!credentials.GEMINI_API_KEY && !credentials.XAI_API_KEY && !credentials.DEEPSEEK_API_KEY) {
    report.state = 'FAIL';
    report.blockers.push('No Gemini/xAI/DeepSeek credentials found in Spatial runtime or shared env');
  }

  writeFileSync(resolve(OUT, 'latest.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  process.exit(report.state === 'FAIL' ? 1 : 0);
}

main().catch((error) => {
  console.error(error?.message || String(error));
  process.exit(1);
});
