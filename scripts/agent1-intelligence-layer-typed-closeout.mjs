#!/usr/bin/env node
/**
 * Typed MAP COMMAND closeout — authenticated browser verification only.
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
const ARTIFACT_DIR = resolve(REPO_ROOT, 'artifacts', 'agent1-intelligence-layer-typed-closeout');
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

async function waitForMapReady(page, timeoutMs = 180000) {
  return page.waitForFunction(() => {
    const canvas = document.querySelector('#spatial-map-host canvas');
    const catalog = window.__IQAI_WEBMAP_LAYER_CATALOG__?.layers?.length || 0;
    return Boolean(canvas && catalog > 5);
  }, { timeout: timeoutMs }).catch(() => false);
}
async function dismissBlockingDialogs(page) {
  const oauth = page.locator('calcite-dialog, .esri-identity-modal');
  if (await oauth.count()) {
    await page.keyboard.press('Escape').catch(() => {});
    await page.waitForTimeout(500);
  }
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
    command: 'Map shootings reported in Montreal in the last 30 days',
    state: 'FAIL'
  };

  try {
    await page.goto(`${BASE}/spatial/?v=${Date.now()}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await page.waitForSelector('#spatial-deterministic-input', { timeout: 120000 });
    await page.waitForSelector('.intel-layers', { timeout: 120000 });
    const mapReady = await waitForMapReady(page, 180000);
    if (!mapReady) {
      throw new Error('ArcGIS map/catalog not ready for MAP COMMAND execution');
    }
    await dismissBlockingDialogs(page);

    const input = page.locator('#spatial-deterministic-input');
    const runBtn = page.locator('#spatial-deterministic-run');
    await input.fill(report.command);
    await page.waitForFunction(() => {
      const btn = document.querySelector('#spatial-deterministic-run');
      return btn && !btn.disabled;
    }, null, { timeout: 60000 });
    await dismissBlockingDialogs(page);

    const responsePromise = page.waitForResponse(
      (res) => res.url().includes('/api/spatial/intelligence-layers/research') && res.request().method() === 'POST',
      { timeout: RESEARCH_TIMEOUT_MS }
    );
    await runBtn.click({ force: true });
    const httpResponse = await responsePromise;
    const body = await httpResponse.json();

    await page.waitForFunction(() => {
      const status = document.querySelector('#intel-layers-status')?.textContent || '';
      return !/Researching intelligence/i.test(status);
    }, null, { timeout: 60000 }).catch(() => {});

    const response = { ok: () => httpResponse.ok() };
    const statusText = await page.locator('#intel-layers-status, #spatial-deterministic-feedback')
      .first()
      .textContent({ timeout: 30000 })
      .catch(() => '');

    report.ok = response.ok();
    report.mode = body.contract?.mode || null;
    report.webSearchInvoked = body.researchAudit?.webSearchInvoked === true;
    report.iqaiCorpusInvoked = body.researchAudit?.iqaiCorpusInvoked === true;
    report.totalEvents = body.combined?.distinctEvents ?? 0;
    report.mapped = body.combined?.mappable ?? 0;
    report.unresolved = body.combined?.unresolved ?? 0;
    report.temporalGate = body.temporalGate || null;
    report.outOfWindowRejected = body.temporalGate?.rejectedOutOfWindow ?? 0;
    report.unknownOccurrenceRejected = body.temporalGate?.rejectedUnknownOccurrence ?? 0;
    report.domains = body.combined?.domains || [];
    report.statusText = (statusText || '').trim();
    report.events = (body.events || []).map((e) => ({
      title: e.title,
      occurredAt: e.occurredAt,
      publishedAt: e.publishedAt,
      mappable: e.mappable,
      locationText: e.locationText,
      sourceUrl: e.sourceReports?.[0]?.sourceUrl || null
    }));

    const layerMeta = await page.locator('.intel-layer-row__meta').first().textContent().catch(() => '');
    report.layerMeta = (layerMeta || '').trim();

    const pass = (report.mode === 'llm-orchestrated' || /-orchestrated$/.test(report.mode || ''))
      && report.webSearchInvoked
      && report.iqaiCorpusInvoked
      && report.totalEvents > 0;

    report.state = pass ? 'PASS' : 'PARTIAL';
    if (!report.webSearchInvoked) report.blockers = ['web_search not invoked'];
    if (!report.iqaiCorpusInvoked) report.blockers = [...(report.blockers || []), 'IQAI corpus not invoked'];
    if (report.totalEvents === 0) report.blockers = [...(report.blockers || []), 'zero events after temporal gate'];
  } catch (error) {
    report.state = 'FAIL';
    report.blockers = [error?.message || String(error)];
  } finally {
    writeFileSync(resolve(ARTIFACT_DIR, 'latest.json'), JSON.stringify(report, null, 2));
    await browser.close();
    stopSpatialServer(serverChild);
  }

  console.log(JSON.stringify(report, null, 2));
  process.exit(report.state === 'PASS' ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
