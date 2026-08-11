#!/usr/bin/env node
/**
 * Intelligence Layer LLM web-research acceptance — shootings / Greater Montréal / 30 days.
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
const ARTIFACT_DIR = resolve(REPO_ROOT, 'artifacts', 'agent1-intelligence-layer-llm');
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

function orchestratedMode(mode) {
  return mode === 'llm-orchestrated' || (typeof mode === 'string' && /-orchestrated$/.test(mode));
}

function writeArtifacts(report) {
  mkdirSync(ARTIFACT_DIR, { recursive: true });
  writeFileSync(resolve(ARTIFACT_DIR, 'latest.json'), JSON.stringify(report, null, 2));
  writeFileSync(resolve(ARTIFACT_DIR, 'latest.txt'), [
    `STATE: ${report.state}`,
    `buttonEvents: ${report.button?.distinctEvents ?? 0}`,
    `buttonMapped: ${report.button?.mappable ?? 0}`,
    `typedEvents: ${report.typed?.distinctEvents ?? 0}`,
    `webSearchInvoked: ${report.button?.webSearchInvoked ?? false}`,
    `iqaiCorpusInvoked: ${report.button?.iqaiCorpusInvoked ?? false}`,
    report.blockers?.length ? `blockers: ${report.blockers.join('; ')}` : ''
  ].filter(Boolean).join('\n'));
}

async function waitForResearchResponse(page, timeoutMs) {
  return page.waitForResponse(
    (res) => res.url().includes('/api/spatial/intelligence-layers/research') && res.request().method() === 'POST',
    { timeout: timeoutMs }
  );
}

async function runPanelResearch(page, { label, timeWindow }) {
  await page.selectOption('#intel-layers-time', timeWindow);
  const responsePromise = waitForResearchResponse(page, RESEARCH_TIMEOUT_MS);
  await page.click(`[data-intel-concept="shootings"]`);
  const response = await responsePromise;
  const body = await response.json();
  const statusText = await page.locator('#intel-layers-status').textContent({ timeout: 15000 }).catch(() => '');
  const activeLayers = await page.locator('.intel-layer-row').count();
  const mappedMeta = await page.locator('.intel-layer-row__meta').first().textContent().catch(() => '');
  return {
    label,
    ok: response.ok(),
    statusText: (statusText || '').trim(),
    distinctEvents: body.combined?.distinctEvents ?? 0,
    mappable: body.combined?.mappable ?? 0,
    unresolved: body.combined?.unresolved ?? 0,
    domains: body.combined?.domains || [],
    webSearchInvoked: body.researchAudit?.webSearchInvoked === true,
    iqaiCorpusInvoked: body.researchAudit?.iqaiCorpusInvoked === true,
    model: body.researchAudit?.model || null,
    mode: body.contract?.mode || null,
    activeLayers,
    mappedMeta: (mappedMeta || '').trim(),
    raw: body
  };
}

async function runTypedResearch(page) {
  const input = page.locator('#spatial-deterministic-input');
  const runBtn = page.locator('#spatial-deterministic-run');
  await input.waitFor({ state: 'visible', timeout: 30000 });
  await runBtn.waitFor({ state: 'visible', timeout: 30000 });
  const responsePromise = waitForResearchResponse(page, RESEARCH_TIMEOUT_MS);
  await input.fill('Map shootings reported in Montreal in the last 30 days');
  await runBtn.waitFor({ state: 'attached', timeout: 30000 });
  await page.waitForFunction(() => {
    const btn = document.querySelector('#spatial-deterministic-run');
    return btn && !btn.disabled;
  }, null, { timeout: 60000 });
  await runBtn.click();
  const response = await responsePromise;
  const body = await response.json();
  return {
    label: 'typed',
    ok: response.ok(),
    distinctEvents: body.combined?.distinctEvents ?? 0,
    mappable: body.combined?.mappable ?? 0,
    unresolved: body.combined?.unresolved ?? 0,
    webSearchInvoked: body.researchAudit?.webSearchInvoked === true,
    iqaiCorpusInvoked: body.researchAudit?.iqaiCorpusInvoked === true,
    mode: body.contract?.mode || null,
    raw: body
  };
}

async function main() {
  const blockers = [];
  if (!process.env.OPENAI_API_KEY) blockers.push('OPENAI_API_KEY missing');

  let serverChild = null;
  let startedServer = false;
  killProcessOnPort(PORT);
  serverChild = startSpatialServer(REPO_ROOT);
  startedServer = true;
  await waitForHttp(`${BASE}/spatial/`, 90000);

  const browser = await chromium.launchPersistentContext(AUTH_PROFILE_DIR, {
    headless: !HEADED,
    viewport: { width: 1440, height: 900 }
  });
  const page = await browser.newPage();

  const report = {
    generatedAt: new Date().toISOString(),
    base: BASE,
    state: 'FAIL',
    blockers,
    button: null,
    typed: null
  };

  try {
    await page.goto(`${BASE}/spatial/`, { waitUntil: 'domcontentloaded', timeout: 90000 });
    await page.waitForSelector('.intel-layers', { timeout: 60000 });

    report.button = await runPanelResearch(page, { label: 'button', timeWindow: '30d' });
    report.typed = await runTypedResearch(page);

    const passCore = report.button.webSearchInvoked
      && report.button.iqaiCorpusInvoked
      && (orchestratedMode(report.button.mode))
      && (orchestratedMode(report.typed.mode))
      && report.button.distinctEvents > 0
      && report.typed.distinctEvents > 0;

    const passMap = report.button.mappable > 0;

    report.state = passCore && passMap ? 'PASS' : (report.button.distinctEvents > 0 ? 'PARTIAL' : 'FAIL');
    if (!report.button.webSearchInvoked) blockers.push('web_search not invoked (button path)');
    if (!report.button.iqaiCorpusInvoked) blockers.push('IQAI corpus not invoked (button path)');
    if (report.button.distinctEvents === 0) blockers.push('zero events from button path');
    if (report.typed.distinctEvents === 0) blockers.push('zero events from typed path');
    if (report.button.mappable === 0) blockers.push('no mappable events on map');
    report.blockers = [...new Set(blockers)];
  } catch (error) {
    report.state = 'FAIL';
    report.blockers.push(error?.message || String(error));
  } finally {
    writeArtifacts(report);
    await browser.close();
    if (startedServer && serverChild) stopSpatialServer(serverChild);
  }

  console.log(JSON.stringify(report, null, 2));
  process.exit(report.state === 'PASS' ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
