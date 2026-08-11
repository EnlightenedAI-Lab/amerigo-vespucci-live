#!/usr/bin/env node
/**
 * IQAI Autonomous Operator Gauntlet V1 — 10-level browser quality sprint.
 */
import { chromium } from 'playwright';
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  startSpatialServer,
  stopSpatialServer,
  waitForHttp,
  isPortOpen,
  killProcessOnPort
} from './lib/spatial-server.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const ARTIFACT_DIR = resolve(REPO_ROOT, 'artifacts', 'agent1-iqai-operator-gauntlet-v1');
const AUTH_PROFILE_DIR = resolve(REPO_ROOT, '.playwright-auth', 'montreal');
const STARTUP_TIMEOUT_MS = 180000;
const RESEARCH_TIMEOUT_MS = 180000;

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

function score(pass, partial = false) {
  if (pass) return 'PASS';
  if (partial) return 'PARTIAL';
  return 'FAIL';
}

function blankScores() {
  return {
    ROUTING: 'NOT_APPLICABLE',
    RETRIEVAL: 'NOT_APPLICABLE',
    EVIDENCE: 'NOT_APPLICABLE',
    GOVERNANCE: 'NOT_APPLICABLE',
    'SPATIAL / GEOMETRY': 'NOT_APPLICABLE',
    'GIS EXECUTION': 'NOT_APPLICABLE',
    'MAP OUTCOME': 'NOT_APPLICABLE',
    PROVENANCE: 'NOT_APPLICABLE',
    'STATE ISOLATION': 'NOT_APPLICABLE',
    LATENCY: 'NOT_APPLICABLE',
    'USER OUTCOME': 'NOT_APPLICABLE'
  };
}

loadEnv();
process.env.IQAI_PROGRESSIVE_INTELLIGENCE_V1_ENABLED = 'true';
process.env.IQAI_CROSS_AGENT_SPATIAL_V1_ENABLED = 'true';
process.env.IQAI_PLACE_POI_V1_ENABLED = 'true';

const PORT = Number(process.env.SPATIAL_PORT || 3000);
const BASE = `http://localhost:${PORT}`;
const SPATIAL_URL = `${BASE}/spatial/`;
const HEADED = process.env.HEADED === '1';

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
  while (Date.now() - started < STARTUP_TIMEOUT_MS) {
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
    if (ok) return { ready: true, startupMs: Date.now() - started };
    await page.waitForTimeout(1000);
  }
  return { ready: false, startupMs: Date.now() - started };
}

async function runPrompt(page, prompt, options = {}) {
  const result = {
    prompt,
    ok: false,
    routing: null,
    outcome: null,
    error: null,
    latency: {},
    scores: blankScores(),
    globals: {}
  };
  await page.waitForFunction(() => {
    const btn = document.querySelector('#spatial-ai-run');
    const field = document.querySelector('#spatial-ai-input');
    return field && !field.disabled && btn && btn.textContent?.trim() !== '…';
  }, { timeout: RESEARCH_TIMEOUT_MS }).catch(() => null);

  const input = page.locator('#spatial-ai-input');
  const runBtn = page.locator('#spatial-ai-run');
  await input.fill(prompt);
  await page.waitForTimeout(150);
  const submitAt = Date.now();
  const waits = [];
  if (options.waitProgressive) {
    waits.push(page.waitForResponse((r) => r.url().includes('/progressive-intelligence') && r.request().method() === 'POST', { timeout: RESEARCH_TIMEOUT_MS }).catch(() => null));
  }
  if (options.waitCrossAgent) {
    waits.push(page.waitForResponse((r) => r.url().includes('/cross-agent-spatial-analysis') && r.request().method() === 'POST', { timeout: RESEARCH_TIMEOUT_MS }).catch(() => null));
  }
  if (options.waitPoi) {
    waits.push(page.waitForResponse((r) => r.url().includes('/place-poi/search') && r.request().method() === 'POST', { timeout: 120000 }).catch(() => null));
  }
  await runBtn.click();
  if (waits.length) await Promise.all(waits);
  if (options.waitProgressive) {
    await page.waitForFunction(() => {
      const receipt = window.__IQAI_LAST_PROGRESSIVE_RECEIPT__;
      const chain = document.querySelector('#spatial-ai-chain')?.textContent || '';
      return Boolean(receipt?.governanceStats || receipt?.mappedCount != null)
        || /Governed intelligence/i.test(chain);
    }, { timeout: RESEARCH_TIMEOUT_MS }).catch(() => null);
  }
  if (options.waitCrossAgent) {
    await page.waitForFunction(() => {
      const receipt = window.__IQAI_LAST_CROSS_AGENT_RECEIPT__;
      const chain = document.querySelector('#spatial-ai-chain')?.textContent || '';
      return Boolean(receipt?.spatialFacts?.length || receipt?.activeSpatialFacts?.length)
        || /Cross-agent spatial/i.test(chain);
    }, { timeout: RESEARCH_TIMEOUT_MS }).catch(() => null);
  }
  await page.waitForFunction(() => {
    const btn = document.querySelector('#spatial-ai-run');
    const field = document.querySelector('#spatial-ai-input');
    return field && !field.disabled && btn && btn.textContent?.trim() !== '…';
  }, { timeout: RESEARCH_TIMEOUT_MS }).catch(() => null);
  if (!options.quick) await page.waitForTimeout(options.settleMs ?? 6000);

  const snap = await page.evaluate(() => ({
    aiFeedback: document.querySelector('#spatial-ai-feedback')?.textContent?.trim() || '',
    aiChain: document.querySelector('#spatial-ai-chain')?.textContent?.trim() || '',
    aiPhase: document.querySelector('#spatial-ai-status-badge')?.textContent?.trim() || '',
    lastMap: window.__IQAI_APP_SHELL__?.lastMapResult || null,
    progressive: window.__IQAI_LAST_PROGRESSIVE_RECEIPT__ || null,
    arcgis: window.__IQAI_LAST_ARCGIS_DISCOVERY__ || null,
    crossAgent: window.__IQAI_LAST_CROSS_AGENT_RECEIPT__ || null,
    catalogCount: window.__IQAI_WEBMAP_LAYER_CATALOG__?.layers?.length || 0
  }));
  result.routing = snap.aiChain || snap.aiPhase || null;
  result.outcome = snap.aiFeedback;
  result.globals = snap;
  result.latency = {
    totalInteractiveMs: Date.now() - submitAt,
    timeToFirstSourceMs: snap.progressive?.performance?.timeToFirstSourceMs ?? snap.crossAgent?.performance?.timeToFirstGovernedEventMs ?? null,
    timeToFirstGovernedEventMs: snap.progressive?.performance?.timeToFirstGovernedEventMs ?? null,
    timeToFirstRenderedFeatureMs: snap.progressive?.performance?.clientTimeToFirstRenderedFeatureMs
      ?? snap.crossAgent?.performance?.clientTimeToFirstRenderedFeatureMs ?? null
  };
  result.ok = options.assert ? options.assert(snap, result) : !/failed|error|cannot read/i.test(`${snap.aiFeedback} ${snap.aiChain}`);
  return result;
}

async function screenshot(page, name) {
  const path = resolve(ARTIFACT_DIR, `${name}.png`);
  await page.screenshot({ path, fullPage: true }).catch(() => {});
  return path;
}

async function main() {
  mkdirSync(ARTIFACT_DIR, { recursive: true });
  const report = {
    generatedAt: new Date().toISOString(),
    startCheckpoint: '0e7c585',
    levels: {},
    checkpoints: {},
    repairs: [],
    overall: 'FAIL'
  };

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
    browser = await chromium.launch({ headless: !HEADED });
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    page = await ctx.newPage();
    await page.addInitScript((t) => { window.__MONTREAL_PREAUTH_TOKEN = t; }, preauth);
  } else {
    browser = await chromium.launchPersistentContext(AUTH_PROFILE_DIR, {
      headless: !HEADED,
      viewport: { width: 1440, height: 900 }
    });
    page = browser.pages()[0] || await browser.newPage();
  }

  const consoleErrors = [];
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });

  try {
    const startupWall = Date.now();
    await page.goto(`${SPATIAL_URL}?v=${Date.now()}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
    const startup = await waitReady(page);
    report.startupMs = Date.now() - startupWall;
    if (!startup.ready) {
      report.overall = 'FAIL';
      writeFileSync(resolve(ARTIFACT_DIR, 'latest.json'), JSON.stringify(report, null, 2));
      process.exit(1);
    }
    await screenshot(page, 'ready');

    // LEVEL 1
    const l1a = await runPrompt(page, 'Map fire stations within 3 km of 997 de la Commune.', {
      settleMs: 10000,
      assert: (snap) => /Deterministic GIS|fire station/i.test(`${snap.aiChain} ${snap.aiFeedback}`)
        && !/intelligence|Agent 2|governed event/i.test(`${snap.aiChain} ${snap.aiFeedback}`)
        && (snap.lastMap?.summary?.matchedFeatures > 0 || /found|mapped|station/i.test(snap.aiFeedback))
    });
    const l1b = await runPrompt(page, 'clear map', {
      quick: true,
      settleMs: 3000,
      assert: (snap) => /Result cleared|Map cleared/i.test(`${snap.aiFeedback} ${snap.aiChain}`)
    });
    const l1pass = l1a.ok && l1b.ok;
    report.levels[1] = {
      pass: l1pass,
      scores: { ...blankScores(), ROUTING: score(l1a.ok), 'GIS EXECUTION': score(l1a.ok), 'MAP OUTCOME': score(l1a.ok), 'USER OUTCOME': score(l1pass), 'STATE ISOLATION': score(l1b.ok) },
      fireStations: l1a,
      clear: l1b,
      screenshot: await screenshot(page, 'level-1')
    };
    if (!l1pass) { report.overall = 'PARTIAL'; writeFileSync(resolve(ARTIFACT_DIR, 'latest.json'), JSON.stringify(report, null, 2)); process.exit(1); }

    // LEVEL 2
    const l2a = await runPrompt(page, 'Find the five closest pharmacies to 997 de la Commune and map them in distance order.', {
      waitPoi: true,
      assert: (snap) => /Place POI|pharmac/i.test(`${snap.aiChain} ${snap.aiFeedback}`)
    });
    const l2b = await runPrompt(page, 'Show coffee shops within 1 km of Old Montréal.', {
      waitPoi: true,
      assert: (snap) => /Place POI|coffee/i.test(`${snap.aiChain} ${snap.aiFeedback}`)
    });
    const l2pass = l2a.ok && l2b.ok;
    report.levels[2] = { pass: l2pass, pharmacies: l2a, coffee: l2b, screenshot: await screenshot(page, 'level-2') };
    if (!l2pass) { report.overall = 'PARTIAL'; writeFileSync(resolve(ARTIFACT_DIR, 'latest.json'), JSON.stringify(report, null, 2)); process.exit(1); }

    // LEVEL 3
    const l3a = await runPrompt(page, 'Find an authoritative ArcGIS layer showing Montréal borough boundaries and add it to the map.', {
      settleMs: 12000,
      assert: (snap) => {
        const a = snap.arcgis;
        return a?.ok && a?.itemId && a?.owner && (a?.authority?.authorityWeight >= 65 || /ville|gouv|esri|statcan/i.test(`${a.owner} ${a.authority?.authorityLabel}`));
      }
    });
    const l3b = await runPrompt(page, 'Find an authoritative ArcGIS layer showing Montréal bike paths and add it to the map.', {
      settleMs: 12000,
      assert: (snap) => {
        const a = snap.arcgis;
        return a?.ok && a?.itemId && /bike|cycl|piste|velo|cycleway|sentier/i.test(`${a.title} ${snap.aiFeedback}`);
      }
    });
    const l3pass = l3a.ok && l3b.ok;
    report.levels[3] = {
      pass: l3pass,
      borough: l3a,
      bike: l3b,
      boroughMeta: l3a.globals?.arcgis,
      bikeMeta: l3b.globals?.arcgis,
      screenshot: await screenshot(page, 'level-3')
    };
    if (!l3pass) { report.overall = 'PARTIAL'; writeFileSync(resolve(ARTIFACT_DIR, 'latest.json'), JSON.stringify(report, null, 2)); process.exit(1); }

    // LEVEL 4
    const l4 = await runPrompt(page, 'Find significant fires, explosions, or hazmat incidents in Montréal in the last 30 days and map them.', {
      waitProgressive: true,
      settleMs: 12000,
      assert: (snap) => {
        const g = snap.progressive?.governanceStats || {};
        const mapped = snap.progressive?.mappedCount || 0;
        const governed = (g.admit || 0) + (g.admitWithCaution || 0);
        const completed = Boolean(snap.progressive)
          && /Governed intelligence|Intelligence research/i.test(`${snap.aiChain} ${snap.aiFeedback}`);
        return completed && (mapped === 0 || governed >= mapped);
      }
    });
    report.levels[4] = { pass: l4.ok, fires: l4, governance: l4.globals?.progressive?.governanceStats, screenshot: await screenshot(page, 'level-4') };
    if (!l4.ok) { report.overall = 'PARTIAL'; writeFileSync(resolve(ARTIFACT_DIR, 'latest.json'), JSON.stringify(report, null, 2)); process.exit(1); }

    // LEVEL 5
    await runPrompt(page, 'clear map', { quick: true, settleMs: 2000 });
    const l5 = await runPrompt(page, 'Find significant fires, explosions, or hazmat incidents in Montréal in the last 30 days and show hospitals within 2 km of each admitted event.', {
      waitCrossAgent: true,
      settleMs: 8000,
      assert: (snap) => /Cross-agent|cross-agent/i.test(`${snap.aiChain} ${snap.aiPhase}`)
        && (snap.crossAgent?.spatialFacts?.length > 0 || snap.crossAgent?.activeSpatialFacts?.length > 0)
    });
    report.levels[5] = { pass: l5.ok, crossAgent: l5, spatialFacts: l5.globals?.crossAgent?.spatialFacts?.length, screenshot: await screenshot(page, 'level-5') };
    if (!l5.ok) { report.overall = 'PARTIAL'; writeFileSync(resolve(ARTIFACT_DIR, 'latest.json'), JSON.stringify(report, null, 2)); process.exit(1); }

    // LEVELS 6-10 — score current capability honestly
    const blockers = [];
    const l6 = await runPrompt(page, 'Find protests or demonstrations planned in Montréal during the next 7 days and show which are within 1 km of government buildings.', { waitProgressive: true, settleMs: 5000 });
    l6.pass = false;
    l6.blocker = 'No orchestrated future-protest + government-building proximity capability in AI MAP';
    report.levels[6] = l6;
    blockers.push('Level 6');

    const l7 = await runPrompt(page, 'Find firearm-related incidents reported in Greater Montréal during the last 7 days. Deduplicate reports referring to the same incident, map only legitimate locations, and show corroboration.', { waitProgressive: true, settleMs: 5000 });
    l7.pass = false;
    l7.blocker = 'Dedup/corroboration compound prompt not orchestrated as single capability';
    report.levels[7] = l7;
    blockers.push('Level 7');

    const l8 = await runPrompt(page, 'Find major infrastructure disruptions affecting Montréal today, map the legitimate events, identify hospitals and major roads nearby, and show which events could have the greatest operational impact.', { waitProgressive: true, settleMs: 5000 });
    l8.pass = false;
    l8.blocker = 'Multi-capability compound operational objective not orchestrated';
    report.levels[8] = l8;
    blockers.push('Level 8');

    const tortureSteps = [];
    for (const prompt of [
      'Find significant fires in Montréal in the last 30 days and map them.',
      'Only show the ones near hospitals.',
      'Make that within 3 km.',
      'Remove the hospital layer.',
      'Now show Starbucks near the most affected area.',
      'Clear everything except borough boundaries.',
      'Show the fires again.',
      'Actually make that protests.'
    ]) {
      tortureSteps.push(await runPrompt(page, prompt, { waitProgressive: /fires|protests/i.test(prompt), waitPoi: /starbucks/i.test(prompt), settleMs: 4000 }));
    }
    const l9pass = tortureSteps.every((s) => !/cannot read|failed/i.test(`${s.outcome} ${s.routing}`));
    report.levels[9] = { pass: l9pass, steps: tortureSteps, blocker: l9pass ? null : 'Conversational intelligence follow-ups not fully supported', screenshot: await screenshot(page, 'level-9') };
    if (!l9pass) blockers.push('Level 9');

    const l10 = await runPrompt(page, 'Build me an operational picture of significant public-safety events in Montréal over the last 24 hours. Find the events from live sources, deduplicate and govern them, map only legitimate locations, add relevant authoritative ArcGIS context, identify hospitals and critical infrastructure within 2 km of admitted events, distinguish verified facts from interpretation, preserve source provenance, and tell me which areas deserve analyst attention first.', { waitProgressive: true, settleMs: 8000 });
    l10.pass = false;
    l10.blocker = 'Full operational-picture orchestration not implemented';
    report.levels[10] = l10;
    blockers.push('Level 10');

    const levels1to5Pass = [1, 2, 3, 4, 5].every((n) => report.levels[n]?.pass);
    report.overall = blockers.length ? 'NEEDS_CONTROL_TOWER' : 'PASS';
    report.levelsPassed = levels1to5Pass ? '1-5' : '<5';
    report.blockers = blockers;
    report.consoleErrors = consoleErrors.slice(0, 20);
    writeFileSync(resolve(ARTIFACT_DIR, 'latest.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ overall: report.overall, levels1to5Pass, blockers }, null, 2));
    process.exit(levels1to5Pass ? 0 : 1);
  } finally {
    await browser.close().catch(() => {});
    stopSpatialServer(server);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
