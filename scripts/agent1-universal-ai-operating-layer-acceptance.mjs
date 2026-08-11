#!/usr/bin/env node
/**
 * Universal AI Operating Layer V1 browser acceptance.
 */
import { chromium } from 'playwright';
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  startSpatialServer,
  stopSpatialServer,
  waitForHttp,
  killProcessOnPort
} from './lib/spatial-server.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const ARTIFACT_DIR = resolve(REPO_ROOT, 'artifacts', 'agent1-universal-ai-operating-layer');
const AUTH_PROFILE_DIR = resolve(REPO_ROOT, '.playwright-auth', 'montreal');
const PORT = Number(process.env.SPATIAL_PORT || 3000);
const BASE = process.env.SPATIAL_URL || `http://localhost:${PORT}`;
const HEADED = process.env.HEADED === '1';
const RESEARCH_TIMEOUT_MS = Number(process.env.INTEL_RESEARCH_TIMEOUT_MS || 180000);

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
  return {
    token: data.token,
    expires: data.expires
      ? (Number(data.expires) > 1e12 ? Number(data.expires) : Number(data.expires) * 1000)
      : Date.now() + 3600000
  };
}

async function dismissBlockingDialogs(page) {
  const oauth = page.locator('calcite-dialog, .esri-identity-modal');
  if (await oauth.count()) {
    await page.keyboard.press('Escape').catch(() => {});
    await page.waitForTimeout(500);
  }
}

function orchestratedMode(mode) {
  return typeof mode === 'string' && /-orchestrated$/.test(mode);
}

async function waitForMapReady(page, timeoutMs = 180000) {
  return page.waitForFunction(() => {
    const canvas = document.querySelector('#spatial-map-host canvas');
    const catalog = window.__IQAI_WEBMAP_LAYER_CATALOG__?.layers?.length || 0;
    return Boolean(canvas && catalog > 5);
  }, { timeout: timeoutMs }).catch(() => false);
}

async function waitForResearchResponse(page, timeoutMs) {
  return page.waitForResponse(
    (res) => res.url().includes('/api/spatial/intelligence-layers/research') && res.request().method() === 'POST',
    { timeout: timeoutMs }
  );
}

async function runPanelResearch(page) {
  await page.selectOption('#intel-layers-time', '30d');
  const responsePromise = waitForResearchResponse(page, RESEARCH_TIMEOUT_MS);
  await page.click('[data-intel-concept="shootings"]');
  const response = await responsePromise;
  const body = await response.json();
  return {
    ok: response.ok(),
    distinctEvents: body.combined?.distinctEvents ?? 0,
    mappable: body.combined?.mappable ?? 0,
    unresolved: body.combined?.unresolved ?? 0,
    mode: body.contract?.mode || null,
    researchMode: body.researchAudit?.mode || null,
    webSearchInvoked: body.researchAudit?.webSearchInvoked === true,
    googleSearchInvoked: body.researchAudit?.googleSearchInvoked === true,
    iqaiCorpusInvoked: body.researchAudit?.iqaiCorpusInvoked === true,
    domains: body.combined?.domains || [],
    raw: body
  };
}

async function runTypedIntelligence(page, command) {
  const input = page.locator('#spatial-deterministic-input');
  const runBtn = page.locator('#spatial-deterministic-run');
  await input.fill(command);
  await page.waitForFunction(() => {
    const btn = document.querySelector('#spatial-deterministic-run');
    return btn && !btn.disabled;
  }, null, { timeout: 60000 });
  const responsePromise = waitForResearchResponse(page, RESEARCH_TIMEOUT_MS);
  await runBtn.click({ force: true });
  const response = await responsePromise;
  const body = await response.json();
  return {
    ok: response.ok(),
    distinctEvents: body.combined?.distinctEvents ?? 0,
    mappable: body.combined?.mappable ?? 0,
    mode: body.contract?.mode || null,
    webSearchInvoked: body.researchAudit?.webSearchInvoked === true,
    googleSearchInvoked: body.researchAudit?.googleSearchInvoked === true,
    iqaiCorpusInvoked: body.researchAudit?.iqaiCorpusInvoked === true,
    raw: body
  };
}

async function runDeterministicGis(page) {
  const input = page.locator('#spatial-deterministic-input');
  const runBtn = page.locator('#spatial-deterministic-run');
  const command = 'Map fire stations within 3 km of 997 de la Commune';
  await input.fill(command);
  await page.waitForFunction(() => {
    const btn = document.querySelector('#spatial-deterministic-run');
    return btn && !btn.disabled;
  }, null, { timeout: 60000 });
  await runBtn.click({ force: true });
  await page.waitForFunction(() => {
    const feedback = document.querySelector('#spatial-deterministic-feedback')?.textContent || '';
    const summary = document.querySelector('.iqai-detail-panel__summary')?.textContent || '';
    return /fire station|casernes?/i.test(`${feedback} ${summary}`);
  }, null, { timeout: 120000 }).catch(() => false);
  const feedback = await page.locator('#spatial-deterministic-feedback').textContent().catch(() => '');
  const featureCount = await page.evaluate(() => {
    const result = window.__IQAI_LAST_MAP_RESULT__;
    return result?.features?.length ?? result?.layers?.length ?? 0;
  }).catch(() => 0);
  return {
    feedback: (feedback || '').trim(),
    featureCount,
    pass: /fire station|casernes?/i.test(feedback || '') || featureCount > 0
  };
}

async function runStarbucksRecognition(page) {
  const input = page.locator('#spatial-deterministic-input');
  const runBtn = page.locator('#spatial-deterministic-run');
  await input.fill('Show all Starbucks in Montreal');
  await page.waitForFunction(() => {
    const btn = document.querySelector('#spatial-deterministic-run');
    return btn && !btn.disabled;
  }, null, { timeout: 60000 });
  const researchPromise = waitForResearchResponse(page, 5000).catch(() => null);
  await runBtn.click({ force: true });
  const researchResponse = await researchPromise;
  const feedback = await page.locator('#spatial-deterministic-feedback, #spatial-command-understood')
    .first()
    .textContent({ timeout: 15000 })
    .catch(() => '');
  const starbucksLayers = await page.locator('.intel-layer-row').filter({ hasText: /starbucks/i }).count();
  return {
    researchInvoked: Boolean(researchResponse),
    feedback: (feedback || '').trim(),
    starbucksLayers,
    pass: !researchResponse
      && /not yet available|PLACE_POI_SEARCH|POI search|capability is not yet available/i.test(feedback || '')
      && starbucksLayers === 0
  };
}

async function readControlBar(page) {
  const bar = page.locator('#spatial-research-control-bar .iqai-control-bar');
  const visible = await bar.isVisible().catch(() => false);
  if (!visible) return { visible: false, text: '' };
  const text = await bar.textContent().catch(() => '');
  return {
    visible: true,
    text: (text || '').trim(),
    hasResearch: /RESEARCH/i.test(text || ''),
    hasEvidence: /EVIDENCE/i.test(text || ''),
    hasProvenance: /PROVENANCE/i.test(text || ''),
    hasSpatial: /SPATIAL/i.test(text || ''),
    hasTemporal: /TEMPORAL/i.test(text || ''),
    hasCoverage: /COVERAGE/i.test(text || '')
  };
}

async function main() {
  mkdirSync(ARTIFACT_DIR, { recursive: true });
  killProcessOnPort(PORT);
  const serverChild = startSpatialServer(REPO_ROOT);
  await waitForHttp(`${BASE}/spatial/`, 90000);

  const preauth = await fetchPreauthToken().catch(() => null);
  let browser;
  let page;
  if (preauth) {
    browser = await chromium.launch({ headless: !HEADED });
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    page = await context.newPage();
    await page.addInitScript((tokenData) => {
      window.__MONTREAL_PREAUTH_TOKEN = tokenData;
    }, preauth);
  } else {
    browser = await chromium.launchPersistentContext(AUTH_PROFILE_DIR, {
      headless: !HEADED,
      viewport: { width: 1440, height: 900 }
    });
    page = browser.pages()[0] || await browser.newPage();
  }

  const report = {
    generatedAt: new Date().toISOString(),
    credentials: {
      openai: Boolean(process.env.OPENAI_API_KEY),
      gemini: Boolean(process.env.GEMINI_API_KEY)
    },
    intelligenceLayer: { state: 'FAIL' },
    typedIntelligence: { state: 'FAIL' },
    deterministicGis: { state: 'FAIL' },
    starbucksRecognition: { state: 'FAIL' },
    controlBar: { state: 'FAIL' },
    state: 'FAIL',
    blockers: []
  };

  try {
    await page.goto(`${BASE}/spatial/?v=${Date.now()}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await page.waitForSelector('#spatial-deterministic-input', { timeout: 120000 });
    await page.waitForSelector('.intel-layers', { timeout: 120000 });
    const mapReady = await waitForMapReady(page, 180000);
    if (!mapReady) throw new Error('ArcGIS map/catalog not ready');
    await dismissBlockingDialogs(page);

    report.intelligenceLayer = await runPanelResearch(page);
    report.intelligenceLayer.state = (
      orchestratedMode(report.intelligenceLayer.mode)
      && report.intelligenceLayer.iqaiCorpusInvoked
      && (report.intelligenceLayer.webSearchInvoked || report.intelligenceLayer.googleSearchInvoked)
      && report.intelligenceLayer.distinctEvents > 0
    ) ? 'PASS' : 'PARTIAL';

    report.typedIntelligence = await runTypedIntelligence(
      page,
      'Map shootings reported in Montreal in the last 30 days'
    );
    report.typedIntelligence.state = (
      orchestratedMode(report.typedIntelligence.mode)
      && report.typedIntelligence.distinctEvents > 0
    ) ? 'PASS' : 'PARTIAL';

    report.controlBar = await readControlBar(page);

    report.controlBar.state = (
      report.controlBar.visible
      && report.controlBar.hasResearch
      && report.controlBar.hasEvidence
      && report.controlBar.hasProvenance
      && report.controlBar.hasSpatial
      && report.controlBar.hasTemporal
      && report.controlBar.hasCoverage
    ) ? 'PASS' : 'FAIL';

    report.deterministicGis = await runDeterministicGis(page);
    report.deterministicGis.state = report.deterministicGis.pass ? 'PASS' : 'FAIL';

    report.starbucksRecognition = await runStarbucksRecognition(page);
    report.starbucksRecognition.state = report.starbucksRecognition.pass ? 'PASS' : 'FAIL';

    const checks = [
      report.intelligenceLayer.state,
      report.typedIntelligence.state,
      report.deterministicGis.state,
      report.starbucksRecognition.state,
      report.controlBar.state
    ];
    if (checks.every((state) => state === 'PASS')) report.state = 'PASS';
    else if (checks.some((state) => state === 'PASS' || state === 'PARTIAL')) report.state = 'PARTIAL';
    else report.state = 'FAIL';

    if (report.intelligenceLayer.state !== 'PASS') {
      report.blockers.push('intelligence layer panel path incomplete');
    }
    if (report.typedIntelligence.state !== 'PASS') {
      report.blockers.push('typed intelligence command incomplete');
    }
    if (report.deterministicGis.state !== 'PASS') {
      report.blockers.push('deterministic GIS fire stations failed');
    }
    if (report.starbucksRecognition.state !== 'PASS') {
      report.blockers.push('Starbucks POI intent not blocked cleanly');
    }
    if (report.controlBar.state !== 'PASS') {
      report.blockers.push('research control bar not visible or incomplete');
    }
  } catch (error) {
    report.state = 'FAIL';
    report.blockers.push(error?.message || String(error));
  } finally {
    writeFileSync(resolve(ARTIFACT_DIR, 'latest.json'), JSON.stringify(report, null, 2));
    await browser.close();
    stopSpatialServer(serverChild);
  }

  console.log(JSON.stringify(report, null, 2));
  process.exit(report.state === 'FAIL' ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
