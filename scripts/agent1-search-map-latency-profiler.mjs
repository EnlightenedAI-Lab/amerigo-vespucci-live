#!/usr/bin/env node
/**
 * End-to-end Search → Map latency profiler — measurement only, no optimization.
 */
import 'dotenv/config';
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { chromium } from 'playwright';
import { loadSharedProviderEnv } from '../src/spatial/intelligence-layer-shared-env.js';
import { executeIntelligenceLayerSearch } from '../src/spatial/intelligence-layer-search-handler.js';
import { createSpatialLatencyTrace, buildHumanSummary } from '../src/spatial/spatial-latency-trace.js';
import {
  startSpatialServer,
  stopSpatialServer,
  waitForHttp,
  killProcessOnPort
} from './lib/spatial-server.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const OUT = resolve(REPO_ROOT, 'artifacts', 'agent1-search-map-latency-profiler');
const PORT = Number(process.env.SPATIAL_PORT || 3000);
const BASE = process.env.SPATIAL_URL || `http://localhost:${PORT}`;
const AUTH_PROFILE_DIR = resolve(REPO_ROOT, '.playwright-auth', 'montreal');

const BENCHMARKS = [
  {
    id: 'A',
    query: 'Map protests and demonstrations reported in Greater Montréal during the last 30 days.',
    days: 30
  },
  {
    id: 'B',
    query: 'Map significant fires, explosions, or hazardous-material incidents reported in Greater Montréal during the last 30 days.',
    days: 30
  },
  {
    id: 'C',
    query: 'Map significant infrastructure disruptions reported in Greater Montréal during the last 7 days.',
    days: 7
  }
];

function loadEnvFile(path) {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (!process.env[key]) process.env[key] = value;
  }
}

loadEnvFile(resolve(REPO_ROOT, '.env'));
loadSharedProviderEnv();

function buildRequest(benchmark, strategy) {
  const to = new Date();
  const from = new Date(Date.now() - benchmark.days * 86400000);
  return {
    query: benchmark.query,
    geography: 'Greater Montréal',
    from: from.toISOString(),
    to: to.toISOString(),
    temporalField: 'OCCURRED',
    includeLive: true,
    researchExecution: strategy
  };
}

function summarizeBenchmarkRun(benchmark, strategy, mode, result, tracePayload, clientTrace = null) {
  const audit = result.researchAudit || {};
  const perf = result.researchPerformance || {};
  const merged = clientTrace?.merged || tracePayload || {};
  const milestones = merged.milestones || tracePayload?.milestones || {};
  return {
    benchmarkId: benchmark.id,
    query: benchmark.query,
    strategy,
    mode,
    traceId: result.traceId || tracePayload?.traceId || null,
    providersInvoked: [
      audit.geminiInvoked ? 'GEMINI' : null,
      audit.grokInvoked ? 'GROK_XAI' : null,
      audit.openaiInvoked ? 'OPENAI' : null,
      audit.deepseekInvoked ? 'DEEPSEEK' : null,
      audit.iqaiCorpusInvoked ? 'IQAI_CORPUS' : null
    ].filter(Boolean),
    eventCount: result.combined?.distinctEvents ?? result.events?.length ?? 0,
    mappedCount: result.combined?.mappable ?? 0,
    unresolvedCount: result.combined?.unresolved ?? 0,
    milestones: {
      firstSourceMs: milestones.timeToFirstSourceMs ?? perf.firstGroundedSourceMs ?? null,
      firstCandidateMs: milestones.timeToFirstCandidateMs ?? perf.firstEventCandidateMs ?? null,
      firstGovernedCandidateMs: milestones.timeToFirstGovernedCandidateMs ?? null,
      firstGeocodeMs: milestones.timeToFirstGeocodeMs ?? perf.firstEventGeocodedMs ?? null,
      firstMappableServerMs: milestones.timeToFirstMappableEventMs ?? perf.timeToFirstMappableEventMs ?? null,
      browserReceiptMs: milestones.timeToBrowserReceiptMs ?? clientTrace?.milestones?.browserReceipt ?? null,
      graphicsLayerInsertMs: milestones.timeToGraphicsLayerInsertMs ?? clientTrace?.milestones?.graphicsLayerInsert ?? null,
      firstRenderedFeatureMs: milestones.timeToFirstRenderedFeatureMs ?? clientTrace?.milestones?.firstRenderedFeature ?? null,
      initialLayerReadyMs: milestones.timeToInitialLayerReadyMs ?? clientTrace?.milestones?.initialLayerReady ?? null,
      researchCompleteMs: milestones.totalResearchCompleteMs ?? perf.totalResearchTimeMs ?? null
    },
    providerLatency: tracePayload?.providers || {},
    agent2: tracePayload?.agent2 || null,
    geocoding: tracePayload?.geocoding || null,
    fastBlocking: tracePayload?.fastBlocking || null,
    criticalPath: tracePayload?.criticalPath || null,
    humanSummary: buildHumanSummary(milestones, tracePayload || {})
  };
}

async function runServerBenchmark(benchmark, strategy) {
  const traceId = randomUUID();
  const trace = createSpatialLatencyTrace(traceId, { strategy });
  const request = { ...buildRequest(benchmark, strategy), traceId };
  const started = Date.now();
  const result = await executeIntelligenceLayerSearch(request, { trace });
  return {
    wallClockMs: Date.now() - started,
    ...summarizeBenchmarkRun(benchmark, strategy, 'SERVER', result, result.latencyTrace || trace.toPayload())
  };
}

async function runBrowserBenchmark(page, benchmark, strategy) {
  const payload = buildRequest(benchmark, strategy);
  return page.evaluate(async (input) => {
    const { createClientLatencyTrace } = await import('/spatial/spatial-latency-trace.js');
    const { runIntelligenceLayerResearch } = await import('/spatial/intelligence-layer-service.js');
    const trace = createClientLatencyTrace({ strategy: input.strategy });
    trace.mark('userRun');
    const result = await runIntelligenceLayerResearch({
      ...input,
      researchExecution: input.strategy
    }, { trace, traceId: trace.traceId });
    return {
      latencyTrace: result.latencyTrace,
      mappedCount: result.normalized?.mappableEvents?.length || 0,
      eventCount: result.normalized?.events?.length || 0,
      audit: result.raw?.researchAudit || null,
      traceId: trace.traceId
    };
  }, payload);
}

async function fetchPreauthToken() {
  const username = process.env.ARCGIS_USERNAME;
  const password = process.env.ARCGIS_PASSWORD;
  const portal = (process.env.ARCGIS_PORTAL_URL || 'https://www.arcgis.com').replace(/\/$/, '');
  if (!username || !password) return null;
  const params = new URLSearchParams({
    username,
    password,
    client: 'requestip',
    expiration: '60',
    f: 'json'
  });
  const res = await fetch(`${portal}/sharing/rest/generateToken`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString()
  });
  const data = await res.json().catch(() => ({}));
  return data.token ? { token: data.token } : null;
}

function rankCriticalPath(runs = []) {
  const totals = new Map();
  for (const run of runs) {
    for (const span of run.criticalPath?.fullResearch || []) {
      totals.set(span.name, (totals.get(span.name) || 0) + span.durationMs);
    }
  }
  return [...totals.entries()]
    .map(([stage, durationMs]) => ({ stage, durationMs }))
    .sort((a, b) => b.durationMs - a.durationMs);
}

function topOptimizationTargets(fastRuns = [], deepRuns = []) {
  const ranked = rankCriticalPath([...fastRuns, ...deepRuns]);
  return ranked.slice(0, 3).map((entry) => ({
    stage: entry.stage,
    aggregateDurationMs: entry.durationMs,
    basis: 'measured critical-path spans across benchmarks'
  }));
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const report = {
    generatedAt: new Date().toISOString(),
    state: 'FAIL',
    optimizationPerformed: false,
    benchmarks: { A: null, B: null, C: null },
    fast: { server: [], browser: [], criticalPath: [] },
    deep: { server: [], criticalPath: [] },
    topOptimizationTargets: [],
    regression: null
  };

  for (const benchmark of BENCHMARKS) {
    report.fast.server.push(await runServerBenchmark(benchmark, 'FAST'));
  }
  for (const benchmark of BENCHMARKS) {
    report.deep.server.push(await runServerBenchmark(benchmark, 'DEEP'));
  }

  killProcessOnPort(PORT);
  const serverChild = startSpatialServer(REPO_ROOT);
  await waitForHttp(`${BASE}/spatial/`, 90000);

  const preauth = await fetchPreauthToken().catch(() => null);
  let browser;
  let page;
  try {
    if (preauth) {
      browser = await chromium.launch({ headless: true });
      const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      page = await context.newPage();
      await page.addInitScript((tokenData) => {
        window.__MONTREAL_PREAUTH_TOKEN = tokenData;
      }, preauth);
    } else {
      browser = await chromium.launchPersistentContext(AUTH_PROFILE_DIR, {
        headless: true,
        viewport: { width: 1440, height: 900 }
      });
      page = browser.pages()[0] || await browser.newPage();
    }

    await page.goto(`${BASE}/spatial/?v=${Date.now()}`, { waitUntil: 'domcontentloaded', timeout: 180000 });
    await page.waitForSelector('.intel-layers, .esri-view-root', { timeout: 180000 });

    for (const benchmark of BENCHMARKS) {
      const browserResult = await runBrowserBenchmark(page, benchmark, 'FAST');
      const benchmarkEntry = summarizeBenchmarkRun(
        benchmark,
        'FAST',
        'BROWSER_E2E',
        {
          traceId: browserResult.traceId,
          combined: {
            distinctEvents: browserResult.eventCount,
            mappable: browserResult.mappedCount
          },
          researchAudit: browserResult.audit || {}
        },
        browserResult.latencyTrace?.server || null,
        browserResult.latencyTrace || null
      );
      report.fast.browser.push(benchmarkEntry);
      report.benchmarks[benchmark.id] = benchmarkEntry;
    }
  } finally {
    if (browser) await browser.close();
    stopSpatialServer(serverChild);
  }

  report.fast.criticalPath = rankCriticalPath(report.fast.server);
  report.deep.criticalPath = rankCriticalPath(report.deep.server);
  report.topOptimizationTargets = topOptimizationTargets(report.fast.server, report.deep.server);

  const anyMappedBrowser = report.fast.browser.some((run) => run.mappedCount > 0);
  const anyMappedServer = [...report.fast.server, ...report.deep.server].some((run) => run.mappedCount > 0);
  const tracesPresent = report.fast.server.every((run) => run.traceId);
  report.state = tracesPresent && (anyMappedBrowser || anyMappedServer) ? 'PASS' : (tracesPresent ? 'PARTIAL' : 'FAIL');

  writeFileSync(resolve(OUT, 'latest.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({
    state: report.state,
    benchmarks: report.benchmarks,
    fastCriticalPath: report.fast.criticalPath.slice(0, 5),
    deepCriticalPath: report.deep.criticalPath.slice(0, 5),
    topOptimizationTargets: report.topOptimizationTargets
  }, null, 2));
}

main().catch((error) => {
  console.error(error?.message || String(error));
  process.exit(1);
});
