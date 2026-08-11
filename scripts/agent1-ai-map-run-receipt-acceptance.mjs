#!/usr/bin/env node
/**
 * Durable AI MAP run receipt — browser + Control Tower read proof.
 * Requires live IQAI at http://localhost:3000/spatial/
 */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isPortOpen } from './lib/spatial-server.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const ARTIFACT_DIR = resolve(REPO_ROOT, 'artifacts', 'agent1-ai-map-run-receipt-v1');
const AUTH_PROFILE_DIR = resolve(REPO_ROOT, '.playwright-auth', 'montreal');

const PORT = Number(process.env.SPATIAL_PORT || 3000);
const SPATIAL_URL = process.env.SPATIAL_URL || `http://localhost:${PORT}/spatial/`;
const RECEIPT_URL = `http://localhost:${PORT}/api/spatial/ai-map/last-receipt`;
const RESEARCH_TIMEOUT_MS = Number(process.env.INTEL_RESEARCH_TIMEOUT_MS || 240000);
const SETTLE_MS = Number(process.env.SCENARIO_SETTLE_MS || 20000);
const DEFAULT_QUERY = process.env.AI_MAP_RECEIPT_QUERY
  || 'Find officially reported firearm incidents in Montréal in the last 30 days and map only admissible events.';

function loadEnvFile(path) {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, 'utf8').split('\n')) {
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
process.env.IQAI_PROGRESSIVE_INTELLIGENCE_V1_ENABLED = process.env.IQAI_PROGRESSIVE_INTELLIGENCE_V1_ENABLED || 'true';

const STARTUP_TIMEOUT_MS = Number(process.env.STARTUP_TIMEOUT_MS || 180000);
const HEADED = process.env.HEADED === '1';

async function fetchPreauthToken() {
  const username = process.env.ARCGIS_USERNAME;
  const password = process.env.ARCGIS_PASSWORD;
  const portal = (process.env.ARCGIS_PORTAL_URL || 'https://www.arcgis.com').replace(/\/$/, '');
  if (!username || !password) return null;
  const params = new URLSearchParams({
    username,
    password,
    client: 'requestip',
    f: 'json',
    expiration: '60'
  });
  const res = await fetch(`${portal}/sharing/rest/generateToken`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString()
  });
  const data = await res.json();
  if (!data.token) return null;
  return {
    token: data.token,
    expires: data.expires
      ? (Number(data.expires) > 1e12 ? Number(data.expires) : Number(data.expires) * 1000)
      : Date.now() + 3600000
  };
}

async function waitForReady(page) {
  const deadline = Date.now() + STARTUP_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const snap = await page.evaluate(async () => {
      let aiAvailable = false;
      try {
        const res = await fetch('/api/spatial/ai-config', { cache: 'no-store' });
        const cfg = await res.json();
        aiAvailable = Boolean(cfg?.ai?.available);
      } catch { /* ignore */ }
      return {
        canvas: Boolean(document.querySelector('#spatial-map-host canvas')),
        catalog: window.__IQAI_WEBMAP_LAYER_CATALOG__?.layers?.length || 0,
        mapOperational: window.__IQAI_APP_SHELL__?.mapOperational !== false,
        aiAvailable
      };
    });
    if (snap.canvas && snap.catalog > 5 && snap.mapOperational && snap.aiAvailable) return snap;
    await page.waitForTimeout(1000);
  }
  throw new Error('Runtime not ready');
}

async function runProgressivePrompt(page, prompt) {
  const responseWait = page.waitForResponse(
    (res) => res.url().includes('/api/spatial/orchestrator/progressive-intelligence') && res.request().method() === 'POST',
    { timeout: RESEARCH_TIMEOUT_MS }
  );
  await page.evaluate(async (text) => {
    const app = window.__IQAI_APP_SHELL__;
    if (!app?.runAiMapCommand) throw new Error('AI MAP shell unavailable');
    await app.runAiMapCommand(text);
  }, prompt);
  const response = await responseWait;
  if (!response.ok()) {
    const text = await response.text().catch(() => '');
    throw new Error(`Progressive orchestrator HTTP ${response.status()}: ${text.slice(0, 200)}`);
  }
  await page.waitForFunction(() => {
    const receipt = window.__IQAI_LAST_PROGRESSIVE_RECEIPT__;
    const storeCount = Object.keys(window.__IQAI_GOVERNED_EVENT_STORE__ || {}).length;
    return Boolean(receipt) || storeCount > 0;
  }, { timeout: RESEARCH_TIMEOUT_MS }).catch(() => {});
  await page.waitForTimeout(SETTLE_MS);
}

async function readBrowserReceipt(page) {
  return page.evaluate(() => {
    const browserReceipt = window.__IQAI_LAST_PROGRESSIVE_RECEIPT__ || null;
    const store = window.__IQAI_GOVERNED_EVENT_STORE__ || {};
    const candidates = Object.entries(store).map(([eventId, entry]) => {
      const admission = entry.admissionDecision || entry.admission || {};
      return {
        eventId,
        outcome: admission.outcome || null,
        reasonCodes: Array.isArray(admission.reasonCodes) ? admission.reasonCodes : []
      };
    });
    const stats = browserReceipt?.governanceStats || {};
    return {
      browserReceipt,
      governedCount: candidates.length,
      mappedCount: browserReceipt?.mappedCount ?? null,
      governanceCounts: {
        ADMIT: stats.admit || 0,
        ADMIT_WITH_CAUTION: stats.admitWithCaution || 0,
        HOLD: stats.hold || 0,
        REJECT: stats.reject || 0
      },
      candidates,
      traceId: browserReceipt?.traceId || null
    };
  });
}

async function fetchServerReceipt() {
  const res = await fetch(RECEIPT_URL, { cache: 'no-store' });
  const body = await res.json();
  return { status: res.status, body };
}

function formatControlTowerReadout(receipt) {
  if (!receipt) return '(no receipt)';
  const lines = [
    `query: ${receipt.query || '—'}`,
    `receipt id: ${receipt.receiptId || '—'}`,
    `trace id: ${receipt.traceId || '—'}`,
    `started: ${receipt.startedAt || '—'}`,
    `completed: ${receipt.completedAt || '—'}`,
    `elapsed ms: ${receipt.elapsedMs ?? '—'}`,
    `source/research count: ${receipt.sourceResultCount ?? '—'}`,
    `governed count: ${receipt.governedCandidateCount ?? '—'}`,
    `ADMIT: ${receipt.governanceCounts?.ADMIT ?? 0}`,
    `ADMIT_WITH_CAUTION: ${receipt.governanceCounts?.ADMIT_WITH_CAUTION ?? 0}`,
    `HOLD: ${receipt.governanceCounts?.HOLD ?? 0}`,
    `REJECT: ${receipt.governanceCounts?.REJECT ?? 0}`,
    `mapped count: ${receipt.mappedCount ?? 0}`,
    `selected event: ${receipt.selectedEventId || '—'}`,
    `status: ${receipt.statusMessage || receipt.finalState || '—'}`
  ];
  if (Array.isArray(receipt.rejectionDiagnostics) && receipt.rejectionDiagnostics.length) {
    lines.push('rejection diagnostics:');
    for (const row of receipt.rejectionDiagnostics) {
      lines.push(`  - ${row.eventId}: ${row.outcome} [${(row.reasonCodes || []).join(', ')}]`);
    }
  }
  return lines.join('\n');
}

function compareReceipts(browser, serverReceipt) {
  const issues = [];
  if (!serverReceipt) {
    issues.push('server receipt missing');
    return issues;
  }
  if (browser.governedCount !== serverReceipt.governedCandidateCount) {
    issues.push(`governed count mismatch browser=${browser.governedCount} server=${serverReceipt.governedCandidateCount}`);
  }
  if (browser.mappedCount != null && browser.mappedCount !== serverReceipt.mappedCount) {
    issues.push(`mapped count mismatch browser=${browser.mappedCount} server=${serverReceipt.mappedCount}`);
  }
  for (const key of ['ADMIT', 'ADMIT_WITH_CAUTION', 'HOLD', 'REJECT']) {
    const b = browser.governanceCounts?.[key] ?? 0;
    const s = serverReceipt.governanceCounts?.[key] ?? 0;
    if (b !== s) issues.push(`governance ${key} mismatch browser=${b} server=${s}`);
  }
  const browserIds = new Set((browser.candidates || []).map((c) => c.eventId));
  const serverIds = new Set(serverReceipt.candidateIds || []);
  if (browserIds.size !== serverIds.size) {
    issues.push(`candidate id count mismatch browser=${browserIds.size} server=${serverIds.size}`);
  }
  for (const candidate of browser.candidates || []) {
    const serverCandidate = (serverReceipt.candidates || []).find((c) => c.eventId === candidate.eventId);
    if (!serverCandidate) {
      issues.push(`missing server candidate ${candidate.eventId}`);
      continue;
    }
    if (candidate.outcome !== serverCandidate.outcome) {
      issues.push(`outcome mismatch ${candidate.eventId}: browser=${candidate.outcome} server=${serverCandidate.outcome}`);
    }
    const bCodes = (candidate.reasonCodes || []).join(',');
    const sCodes = (serverCandidate.reasonCodes || []).join(',');
    if (bCodes !== sCodes) {
      issues.push(`reasonCodes mismatch ${candidate.eventId}: browser=${bCodes} server=${sCodes}`);
    }
  }
  const hasRejections = (serverReceipt.rejectionDiagnostics || []).length > 0
    || (serverReceipt.governanceCounts?.REJECT || 0) > 0
    || (serverReceipt.governanceCounts?.HOLD || 0) > 0;
  if (hasRejections) {
    for (const row of serverReceipt.rejectionDiagnostics || []) {
      if (!row.reasonCodes?.length && (row.outcome === 'REJECT' || row.outcome === 'HOLD')) {
        issues.push(`missing reasonCodes for ${row.eventId}`);
      }
    }
  }
  return issues;
}

async function main() {
  mkdirSync(ARTIFACT_DIR, { recursive: true });
  if (!(await isPortOpen(PORT))) {
    const payload = { pass: false, error: `Port ${PORT} not reachable — start spatial runtime first` };
    writeFileSync(resolve(ARTIFACT_DIR, 'latest.json'), JSON.stringify(payload, null, 2));
    console.log(JSON.stringify(payload, null, 2));
    process.exit(1);
  }

  let browser;
  let context;
  const preauth = (process.env.ARCGIS_USERNAME && process.env.ARCGIS_PASSWORD)
    ? await fetchPreauthToken()
    : null;

  if (preauth) {
    browser = await chromium.launch({ headless: !HEADED, slowMo: HEADED ? 30 : 0 });
    context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await context.addInitScript((tokenData) => {
      window.__MONTREAL_PREAUTH_TOKEN = tokenData;
    }, preauth);
  } else {
    mkdirSync(AUTH_PROFILE_DIR, { recursive: true });
    context = await chromium.launchPersistentContext(AUTH_PROFILE_DIR, {
      headless: !HEADED,
      viewport: { width: 1440, height: 900 },
      slowMo: HEADED ? 30 : 0
    });
  }

  const page = context.pages()[0] || await context.newPage();
  const artifact = {
    generatedAt: new Date().toISOString(),
    spatialUrl: SPATIAL_URL,
    query: DEFAULT_QUERY,
    pass: false,
    browser: null,
    server: null,
    comparisonIssues: [],
    controlTowerReadout: null
  };

  try {
    await page.goto(`${SPATIAL_URL}?v=${Date.now()}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await waitForReady(page);
    await runProgressivePrompt(page, DEFAULT_QUERY);
    artifact.browser = await readBrowserReceipt(page);

    const serverFetch = await fetchServerReceipt();
    artifact.server = serverFetch.body;
    const serverReceipt = serverFetch.body?.receipt || null;
    artifact.comparisonIssues = compareReceipts(artifact.browser, serverReceipt);
    artifact.controlTowerReadout = formatControlTowerReadout(serverReceipt);

    console.log('\n--- CONTROL TOWER READ PROOF ---');
    console.log(artifact.controlTowerReadout);
    console.log('--- END READ PROOF ---\n');

    artifact.pass = Boolean(
      serverFetch.status === 200
      && serverFetch.body?.ok === true
      && serverReceipt?.query
      && serverReceipt.governedCandidateCount != null
      && artifact.comparisonIssues.length === 0
      && (serverReceipt.governedCandidateCount === 0 || (serverReceipt.candidates || []).length > 0)
      && (serverReceipt.governedCandidateCount === 0
        || (serverReceipt.rejectionDiagnostics || []).length > 0
        || (serverReceipt.governanceCounts?.ADMIT || 0) > 0
        || (serverReceipt.governanceCounts?.ADMIT_WITH_CAUTION || 0) > 0
        || (serverReceipt.governanceCounts?.HOLD || 0) > 0)
    );
  } catch (error) {
    artifact.error = error?.message || String(error);
  } finally {
    writeFileSync(resolve(ARTIFACT_DIR, 'latest.json'), JSON.stringify(artifact, null, 2));
    if (browser) await browser.close().catch(() => {});
    else await context.close().catch(() => {});
  }

  console.log(JSON.stringify(artifact, null, 2));
  process.exit(artifact.pass ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
