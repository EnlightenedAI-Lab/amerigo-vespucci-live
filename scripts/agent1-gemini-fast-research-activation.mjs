#!/usr/bin/env node
/**
 * Gemini FAST research activation benchmark — CRIME + SHOOTINGS (30d).
 */
import 'dotenv/config';
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { researchEvents } from '../src/spatial/intelligence-layer-research-events.js';
import { finalizeIntelligenceLayerResult } from '../src/spatial/intelligence-layer-search-handler.js';
import {
  startSpatialServer,
  stopSpatialServer,
  waitForHttp,
  killProcessOnPort
} from './lib/spatial-server.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const OUT = resolve(REPO_ROOT, 'artifacts', 'agent1-gemini-fast-research-activation');
const ENV_FILE = resolve(REPO_ROOT, '.env');
const PORT = Number(process.env.SPATIAL_PORT || 3000);
const BASE = process.env.SPATIAL_URL || `http://localhost:${PORT}`;
const AUTH_PROFILE_DIR = resolve(REPO_ROOT, '.playwright-auth', 'montreal');

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

loadEnvFile(ENV_FILE);

function credentialStatus() {
  const gemini = Boolean(String(process.env.GEMINI_API_KEY || '').trim());
  const openai = Boolean(String(process.env.OPENAI_API_KEY || '').trim());
  return { gemini, openai };
}

function buildQuery(conceptId, query) {
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

function summarizeResult(label, raw, finalized) {
  const perf = finalized.researchPerformance || {};
  const consolidation = finalized.researchConsolidation || {};
  const categories = [...new Set((finalized.events || []).map((e) => e.concept).filter(Boolean))];
  return {
    label,
    timeToFirstMappableEventMs: perf.timeToFirstMappableEventMs,
    totalResearchTimeMs: perf.totalResearchTimeMs ?? perf.researchCompleteMs,
    performance: perf,
    groundedReports: consolidation.rawSourceReports || 0,
    domains: finalized.combined?.domains || [],
    distinctEvents: finalized.combined?.distinctEvents || 0,
    mapped: finalized.combined?.mappable || 0,
    unresolved: finalized.combined?.unresolved || 0,
    englishSources: consolidation.englishSources || 0,
    frenchSources: consolidation.frenchSources || 0,
    categoryDiversity: categories,
    temporalGate: finalized.temporalGate || null,
    googleSearchInvoked: finalized.researchAudit?.googleSearchInvoked === true,
    openaiInvoked: finalized.researchAudit?.openaiInvoked === true,
    geminiInvoked: finalized.researchAudit?.geminiInvoked === true,
    contractMode: finalized.contract?.mode || null
  };
}

async function runApiBenchmark(conceptId, query) {
  const request = buildQuery(conceptId, query);
  const started = Date.now();
  const raw = await researchEvents(request);
  const finalized = finalizeIntelligenceLayerResult(raw, request);
  return {
    ...summarizeResult(conceptId, raw, finalized),
    wallClockMs: Date.now() - started
  };
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
  if (!data.token) return null;
  return { token: data.token };
}

async function runBrowserConcept(page, conceptId) {
  await page.selectOption('#intel-layers-time', '30d');
  const started = Date.now();
  const responsePromise = page.waitForResponse(
    (res) => res.url().includes('/api/spatial/intelligence-layers/research') && res.request().method() === 'POST',
    { timeout: 180000 }
  );
  await page.click(`[data-intel-concept="${conceptId}"]`);
  const response = await responsePromise;
  const body = await response.json();
  const controlBar = await page.locator('#spatial-research-control-bar .iqai-control-bar').textContent().catch(() => '');
  return {
    ...summarizeResult(`${conceptId}-browser`, body, body),
    wallClockMs: Date.now() - started,
    controlBarText: (controlBar || '').trim()
  };
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const credentials = credentialStatus();
  const report = {
    generatedAt: new Date().toISOString(),
    state: 'FAIL',
    activation: {
      apiKeyPresent: credentials.gemini,
      envFile: ENV_FILE,
      variableName: 'GEMINI_API_KEY',
      serverRestartRequired: true,
      model: process.env.IQAI_GEMINI_RESEARCH_MODEL || 'gemini-flash-latest',
      googleSearchGrounding: 'gemini-google-search tool via generateContent'
    },
    credentials,
    crime30d: null,
    shootings30d: null,
    browser: null,
    comparison: {
      openAiBaseline: {
        note: 'Prior OpenAI-only path observed ~6 mapped crime events with high latency',
        approximateMappedEvents: 6,
        perceivedLatency: 'unacceptably slow'
      }
    },
    recommendation: null,
    blockers: []
  };

  if (!credentials.gemini) {
    report.state = 'FAIL';
    report.blockers.push('GEMINI_API_KEY not present in active Spatial runtime environment');
    report.recommendation = 'Add GEMINI_API_KEY to .env at repo root, restart spatial server (node src/preview.js), then re-run this benchmark before evaluating taxonomy fan-out.';
    writeFileSync(resolve(OUT, 'latest.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
    process.exit(1);
  }

  report.crime30d = await runApiBenchmark('crime', 'crime');
  report.shootings30d = await runApiBenchmark('shootings', 'shootings firearm incidents');

  killProcessOnPort(PORT);
  const serverChild = startSpatialServer(REPO_ROOT);
  await waitForHttp(`${BASE}/spatial/`, 90000);

  const preauth = await fetchPreauthToken().catch(() => null);
  let browser;
  let page;
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

  try {
    await page.goto(`${BASE}/spatial/?v=${Date.now()}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await page.waitForSelector('.intel-layers', { timeout: 120000 });
    report.browser = {
      crime30d: await runBrowserConcept(page, 'crime'),
      shootings30d: await runBrowserConcept(page, 'shootings')
    };
  } finally {
    await browser.close();
    stopSpatialServer(serverChild);
  }

  const geminiWorked = report.crime30d.googleSearchInvoked || report.shootings30d.googleSearchInvoked;
  const hasResults = (report.crime30d.mapped + report.shootings30d.mapped) > 0;
  report.state = geminiWorked && hasResults ? 'PASS' : (geminiWorked ? 'PARTIAL' : 'FAIL');

  const faster = (report.crime30d.totalResearchTimeMs || 999999) < 60000;
  const recall = report.crime30d.mapped >= 1 || report.shootings30d.mapped >= 1;
  report.comparison.geminiFast = {
    fasterThanOpenAiBaseline: faster,
    recallObserved: recall,
    crimeMapped: report.crime30d.mapped,
    shootingsMapped: report.shootings30d.mapped,
    crimeDomains: report.crime30d.domains,
    shootingsDomains: report.shootings30d.domains
  };

  report.recommendation = recall
    ? 'Gemini FAST path is returning grounded events. Run side-by-side DEEP comparison before deciding whether broad crime taxonomy fan-out is necessary.'
    : 'Gemini executed but recall was low in this run. Tune prompts or run DEEP mode before investing in taxonomy fan-out.';

  writeFileSync(resolve(OUT, 'latest.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  process.exit(report.state === 'FAIL' ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
