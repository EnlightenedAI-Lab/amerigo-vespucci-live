#!/usr/bin/env node
/**
 * Compound analytical map execution — real browser proof with governed fixture plans.
 * Does not inject fixtures into live intelligence results.
 */
import { chromium } from 'playwright';
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  runCrossAgentSpatialAnalysis,
  CROSS_AGENT_VERTICAL_SLICE_QUERY
} from '../src/spatial/orchestrator/cross-agent-spatial-coordinator.js';
import { ADMISSION_OUTCOME } from '../src/spatial/orchestrator/intelligence-admission.js';
import { DATASET_IDS } from '../src/spatial/dataset-registry.js';
import {
  startSpatialServer,
  stopSpatialServer,
  waitForHttp,
  isPortOpen,
  killProcessOnPort
} from './lib/spatial-server.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const ARTIFACT_DIR = resolve(REPO_ROOT, 'artifacts', 'agent1-compound-map-execution-acceptance');
const AUTH_PROFILE_DIR = resolve(REPO_ROOT, '.playwright-auth', 'montreal');

function loadEnv() {
  const envPath = resolve(REPO_ROOT, '.env');
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    if (!process.env[key]) process.env[key] = trimmed.slice(eq + 1).trim();
  }
}

loadEnv();

const GOVERNED_EVENT = {
  governedEventId: 'evt-map-exec-proof',
  governedEventVersion: 1,
  candidate: {
    eventId: 'evt-map-exec-proof',
    title: 'Warehouse fire',
    locationText: 'Rue Notre-Dame, Montréal',
    municipality: 'Montréal',
    geometryVersion: 1,
    mappable: true,
    geometry: { type: 'Point', coordinates: [-73.554, 45.514] },
    sourceReports: [{ url: 'https://www.cbc.ca/news/canada/montreal/warehouse-fire', publisher: 'CBC' }]
  },
  admission: { outcome: ADMISSION_OUTCOME.ADMIT }
};

const HOSPITAL_FIXTURES = [
  {
    featureId: 'hosp-proof-1',
    id: 'hosp-proof-1',
    name: 'Hôpital Notre-Dame',
    latitude: 45.515,
    longitude: -73.555,
    sourceName: 'Statistics Canada ODHF'
  }
];

function mockHospitalLoad() {
  return {
    dataset: { id: DATASET_IDS.HOSPITALS, sourceId: 'STATCAN_HOSPITALS_001', authority: 'Statistics Canada' },
    features: HOSPITAL_FIXTURES,
    receipt: { receiptId: 'hosp-receipt-proof', sourceId: 'STATCAN_HOSPITALS_001', featureCount: 1 }
  };
}

async function fetchPreauthToken() {
  const username = process.env.ARCGIS_USERNAME;
  const password = process.env.ARCGIS_PASSWORD;
  const portal = (process.env.ARCGIS_PORTAL_URL || 'https://www.arcgis.com').replace(/\/$/, '');
  if (!username || !password) return null;
  const params = new URLSearchParams({ username, password, client: 'requestip', expiration: '60', f: 'json' });
  const res = await fetch(`${portal}/sharing/rest/generateToken`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString()
  });
  const data = await res.json().catch(() => ({}));
  return data.token ? { token: data.token, expires: data.expires } : null;
}

async function waitReady(page) {
  const started = Date.now();
  while (Date.now() - started < 180000) {
    const ok = await page.evaluate(async () => {
      const shell = window.__IQAI_APP_SHELL__;
      const catalog = window.__IQAI_WEBMAP_LAYER_CATALOG__;
      let aiAvailable = false;
      try {
        const res = await fetch('/api/spatial/ai-config', { cache: 'no-store' });
        aiAvailable = Boolean((await res.json())?.ai?.available);
      } catch { /* ignore */ }
      return Boolean(document.querySelector('#spatial-map-host canvas'))
        && (catalog?.layers?.length || 0) > 5
        && shell?.mapOperational !== false
        && aiAvailable;
    });
    if (ok) return true;
    await page.waitForTimeout(1000);
  }
  return false;
}

async function main() {
  mkdirSync(ARTIFACT_DIR, { recursive: true });
  const started = Date.now();
  const serverResult = await runCrossAgentSpatialAnalysis({
    query: CROSS_AGENT_VERTICAL_SLICE_QUERY,
    conceptId: 'fires'
  }, {
    sessionScope: `map-exec-proof:${Date.now()}`,
    streamProgressiveResearch: async (_req, hooks) => {
      await hooks.onAdmittedCandidate?.(GOVERNED_EVENT);
      return {
        corpusResult: {},
        liveResult: {},
        admittedEventIds: [GOVERNED_EVENT.candidate.eventId],
        governanceStats: { admit: 1, reject: 0, hold: 0 },
        metrics: { corpusLatencyMs: 5, liveLatencyMs: 10 },
        cancelled: false
      };
    },
    hospitalLoad: mockHospitalLoad()
  });

  const plan = serverResult.analyticalPlans[0];
  if (!plan) {
    const payload = { pass: false, error: 'No analytical plan produced', serverResult };
    writeFileSync(resolve(ARTIFACT_DIR, 'latest.json'), JSON.stringify(payload, null, 2));
    console.log(JSON.stringify(payload, null, 2));
    process.exit(1);
  }

  const PORT = Number(process.env.SPATIAL_PORT || 3000);
  const BASE = `http://localhost:${PORT}`;
  if (await isPortOpen(PORT)) killProcessOnPort(PORT);
  const server = startSpatialServer(REPO_ROOT, {
    env: {
      IQAI_CROSS_AGENT_SPATIAL_V1_ENABLED: 'true',
      IQAI_PROGRESSIVE_INTELLIGENCE_V1_ENABLED: 'true'
    }
  });
  if (!await waitForHttp(`${BASE}/api/spatial/runtime-info`, 90000)) process.exit(1);

  const preauth = await fetchPreauthToken();
  let browser;
  let page;
  if (preauth) {
    browser = await chromium.launch({ headless: process.env.HEADED !== '1' });
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    page = await ctx.newPage();
    await page.addInitScript((t) => { window.__MONTREAL_PREAUTH_TOKEN = t; }, preauth);
  } else {
    browser = await chromium.launchPersistentContext(AUTH_PROFILE_DIR, {
      headless: process.env.HEADED !== '1',
      viewport: { width: 1440, height: 900 }
    });
    page = browser.pages()[0] || await browser.newPage();
  }

  try {
    await page.goto(`${BASE}/spatial/?v=${Date.now()}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
    if (!await waitReady(page)) throw new Error('Spatial shell not ready');

    const browserProof = await page.evaluate(async (analyticalPlan) => {
      const { executeAnalyticalMapActionPlan } = await import('/spatial/orchestrator/analytical-map-action-executor.js');
      const receipt = await executeAnalyticalMapActionPlan(analyticalPlan, {
        graphId: analyticalPlan.graphId,
        traceId: 'map-exec-proof',
        idempotencyKey: analyticalPlan.planId
      });
      const view = window.__IQAI_APP_SHELL__?.mapView
      || document.querySelector('#spatial-map-host')?.view
      || null;
      const map = view?.map;
      const intelLayerId = analyticalPlan.mapResultPayload?.layerId;
      const refLayerId = analyticalPlan.mapResultPayload?.referenceLayerId;
      const intelLayer = map?.findLayerById?.(intelLayerId);
      const refLayer = map?.findLayerById?.(refLayerId);
      return {
        receipt,
        intelLayerId,
        refLayerId,
        intelGraphics: intelLayer?.graphics?.length || 0,
        refGraphics: refLayer?.graphics?.length || 0
      };
    }, plan);

    const pass = Boolean(browserProof.receipt?.mutatedMap)
      && (browserProof.receipt?.referenceRendered || 0) > 0
      && (browserProof.receipt?.eventsRendered || 0) > 0;

    const payload = {
      generatedAt: new Date().toISOString(),
      pass,
      serverFacts: serverResult.activeSpatialFacts.length,
      serverPlans: serverResult.analyticalPlans.length,
      browserProof,
      totalMs: Date.now() - started
    };
    writeFileSync(resolve(ARTIFACT_DIR, 'latest.json'), JSON.stringify(payload, null, 2));
    await page.screenshot({ path: resolve(ARTIFACT_DIR, 'map-proof.png'), fullPage: true }).catch(() => {});
    console.log(JSON.stringify(payload, null, 2));
    process.exit(pass ? 0 : 1);
  } finally {
    await browser.close().catch(() => {});
    stopSpatialServer(server);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
