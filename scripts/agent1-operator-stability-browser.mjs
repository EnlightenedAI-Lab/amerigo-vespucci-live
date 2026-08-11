#!/usr/bin/env node
/**
 * Operator stability browser verification against the LIVE launcher stack.
 * Never starts or kills services on ports 3000 / 3027.
 */
import { chromium } from 'playwright';
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const ARTIFACT_DIR = resolve(ROOT, 'artifacts', 'agent1-operator-stability');
const SCREENSHOT_DIR = resolve(ARTIFACT_DIR, 'screenshots');
const BASE = process.env.SPATIAL_URL || 'http://localhost:3000';

function loadEnvFile(path) {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    if (!process.env[key]) process.env[key] = trimmed.slice(eq + 1).trim();
  }
}

loadEnvFile(resolve(ROOT, '.env'));

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
  return data.token
    ? { token: data.token, expires: data.expires ? Number(data.expires) * 1000 : Date.now() + 3600000 }
    : null;
}

async function waitForMapReady(page, timeoutMs = 180000) {
  return page.waitForFunction(() => {
    const canvas = document.querySelector('#spatial-map-host canvas');
    const layers = document.querySelectorAll('#spatial-layer-tree .layer-row input[type="checkbox"]');
    const catalog = window.__IQAI_WEBMAP_LAYER_CATALOG__?.layers?.length || 0;
    const operational = window.__IQAI_APP_SHELL__?.mapOperational !== false;
    return Boolean(canvas && layers.length > 0 && catalog > 5 && operational);
  }, { timeout: timeoutMs }).catch(() => false);
}

async function main() {
  mkdirSync(SCREENSHOT_DIR, { recursive: true });
  const report = {
    generatedAt: new Date().toISOString(),
    baseUrl: BASE,
    checks: [],
    screenshots: []
  };

  function record(id, pass, detail = {}) {
    report.checks.push({ id, pass, ...detail });
  }

  const preauth = await fetchPreauthToken();
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  page.setDefaultTimeout(120000);

  if (preauth) {
    await page.addInitScript((tokenData) => {
      window.__MONTREAL_PREAUTH_TOKEN = tokenData;
    }, preauth);
  }

  await page.goto(`${BASE}/spatial/?v=${Date.now()}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  const mapReady = await waitForMapReady(page);
  record('application_boot', mapReady, {
    authMode: preauth ? 'preauth-token' : 'none',
    canvas: await page.locator('#spatial-map-host canvas').count() > 0
  });

  const bootShot = resolve(SCREENSHOT_DIR, '01-application-boot.png');
  await page.screenshot({ path: bootShot, fullPage: false });
  report.screenshots.push(bootShot);

  if (!mapReady) {
    report.state = 'FAIL';
    writeArtifacts(report);
    await browser.close();
    process.exit(1);
  }

  // MAP COMMAND — fire stations
  await page.fill('#spatial-deterministic-input', 'map fire stations within 3 km of 997 de la commune');
  await page.locator('#spatial-deterministic-run').click({ force: true });
  await page.waitForTimeout(20000);
  const mapCommand = await page.evaluate(() => {
    const inspect = window.__IQAI_RUNTIME_LAYER_INSPECT__?.['iqai-deterministic-results'] || {};
    const feedback = document.querySelector('#spatial-deterministic-feedback')?.textContent?.trim() || '';
    const error = document.querySelector('#spatial-detail-error')?.textContent?.trim() || '';
    return {
      feedback,
      error,
      graphicCount: inspect.graphicCount ?? inspect.count ?? null,
      visible: inspect.visible !== false,
      rendererMode: inspect.rendererMode || null
    };
  });
  record('map_command', /fire station/i.test(mapCommand.feedback) && !/failed/i.test(mapCommand.error), mapCommand);

  const mapCommandShot = resolve(SCREENSHOT_DIR, '02-map-command-fire-stations.png');
  await page.screenshot({ path: mapCommandShot, fullPage: false });
  report.screenshots.push(mapCommandShot);

  // AI MAP — known-good mock clarification path
  const aiMap = await page.evaluate(async () => {
    const originalFetch = window.fetch;
    window.fetch = async (url, init) => {
      if (String(url).includes('/api/spatial/ai-map')) {
        return new Response(JSON.stringify({
          supported: false,
          status: 'NEEDS_CLARIFICATION',
          message: 'Which type of station do you mean — police, fire, or transit?'
        }), { status: 422, headers: { 'Content-Type': 'application/json' } });
      }
      return originalFetch(url, init);
    };
    try {
      const app = window.__IQAI_APP_SHELL__;
      const result = await app.runAiMapCommand('Show me the nearest stations.');
      const feedback = document.querySelector('#spatial-ai-feedback')?.textContent?.trim() || '';
      return { status: result?.status, feedback, pass: result?.status === 'NEEDS_CLARIFICATION' };
    } finally {
      window.fetch = originalFetch;
    }
  });
  record('ai_map', aiMap.pass === true, aiMap);

  const aiMapShot = resolve(SCREENSHOT_DIR, '03-ai-map-clarification.png');
  await page.screenshot({ path: aiMapShot, fullPage: false });
  report.screenshots.push(aiMapShot);

  // Point Intelligence — Montreal click
  const pi = await page.evaluate(async () => {
    if (typeof window.__IQAI_RUN_POINT_INTELLIGENCE_V3_ACCEPTANCE__ !== 'function') {
      return { pass: false, error: 'PI V3 harness missing' };
    }
    const result = await window.__IQAI_RUN_POINT_INTELLIGENCE_V3_ACCEPTANCE__(true);
    const html = document.querySelector('#spatial-point-intelligence-section')?.innerHTML || '';
    return {
      pass: result?.state === 'PASS',
      state: result?.state,
      bundleState: result?.steps?.find((s) => s.id === 'bundle-click')?.response?.bundleState || null,
      familiesWithResults: Object.values(result?.steps?.find((s) => s.id === 'bundle-click')?.response?.families || {})
        .filter((f) => Number(f.resultCount) > 0).length,
      hasEvidenceSection: /Evidence|Provenance|QueryReceipt/i.test(html),
      noDominatedIds: !/iqai\.pi\.(bundle|queryreq)\.[a-f0-9-]{8,}/i.test(
        document.querySelector('#spatial-point-intelligence-section')?.textContent || ''
      )
    };
  });
  record('point_intelligence', pi.pass === true && pi.hasEvidenceSection, pi);

  const piShot = resolve(SCREENSHOT_DIR, '04-point-intelligence-montreal.png');
  await page.screenshot({ path: piShot, fullPage: true });
  report.screenshots.push(piShot);

  // Open-World Intelligence — fire search + map/panel linking
  const owi = await page.evaluate(async () => {
    const app = window.__IQAI_APP_SHELL__;
    const input = document.querySelector('#owi-keyword');
    const searchBtn = document.querySelector('[data-owi-search]');
    if (input) {
      input.value = 'fire';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
    if (searchBtn) searchBtn.click();
    else if (app?.openWorldIntelligence?.search) {
      await app.openWorldIntelligence.search('fire');
    } else if (typeof window.__IQAI_RUN_LIF_PHASE5_ACCEPTANCE__ === 'function') {
      // fallback: harness proves live Agent 2 seam
      const harness = await window.__IQAI_RUN_LIF_PHASE5_ACCEPTANCE__();
      return {
        pass: harness.state === 'PASS',
        spatialResults: harness.evidence?.live?.summary?.spatialResults ?? null,
        harness: true,
        sampleTitle: harness.evidence?.live?.summary ? 'harness' : null
      };
    }

    await new Promise((r) => setTimeout(r, 12000));
    const cards = [...document.querySelectorAll('[data-owi-result-id]')];
    const spatialCard = cards.find((c) => !c.querySelector('.owi-spatial-badge--none'));
    const title = spatialCard?.querySelector('.owi-result__title, .owi-result-title')?.textContent?.trim() || '';
    const source = spatialCard?.querySelector('.owi-result__source, .owi-result-source')?.textContent?.trim() || '';
    const layerInspect = window.__IQAI_RUNTIME_LAYER_INSPECT__?.['iqai-open-world-intel'] || {};
    let mapSelectionOk = false;
    if (spatialCard) {
      spatialCard.click();
      await new Promise((r) => setTimeout(r, 800));
      mapSelectionOk = spatialCard.classList.contains('owi-result--selected');
    }
    const provenanceBtn = document.querySelector('[data-owi-inspect]');
    let provenanceOpen = false;
    if (provenanceBtn) {
      provenanceBtn.click();
      await new Promise((r) => setTimeout(r, 500));
      provenanceOpen = Boolean(document.querySelector('#owi-inspector-host:not([hidden]), .owi-inspector--open'));
    }
    return {
      pass: cards.length > 0 && Boolean(title) && title !== source,
      resultCount: cards.length,
      spatialGraphics: layerInspect.graphicCount ?? layerInspect.count ?? null,
      title,
      source,
      mapSelectionOk,
      provenanceOpen
    };
  });
  record('open_world_intelligence', owi.pass === true, owi);

  const owiShot = resolve(SCREENSHOT_DIR, '05-open-world-intelligence-fire.png');
  await page.screenshot({ path: owiShot, fullPage: true });
  report.screenshots.push(owiShot);

  // Mode transitions — stale graphics / click authority
  await page.fill('#spatial-deterministic-input', 'map fire stations within 3 km of 997 de la commune');
  await page.locator('#spatial-deterministic-run').click({ force: true });
  await page.waitForTimeout(5000);

  const modes = await page.evaluate(async () => {
    const app = window.__IQAI_APP_SHELL__;
    const layers = () => ({
      deterministic: window.__IQAI_RUNTIME_LAYER_INSPECT__?.['iqai-deterministic-results']?.graphicCount ?? 0,
      owi: window.__IQAI_RUNTIME_LAYER_INSPECT__?.['iqai-open-world-intel']?.graphicCount ?? 0,
      pi: window.__IQAI_RUNTIME_LAYER_INSPECT__?.['iqai-point-intelligence']?.graphicCount ?? 0
    });
    const before = layers();

    await app?.runMapCommand?.('CLEAR');
    await new Promise((r) => setTimeout(r, 1500));
    const afterClear = layers();

    return {
      before,
      afterClear,
      clearWorked: afterClear.deterministic === 0 || afterClear.deterministic < before.deterministic,
      piModeToggle: Boolean(document.querySelector('#spatial-point-intelligence-section')),
      owiControl: Boolean(document.querySelector('#spatial-open-world-intelligence'))
    };
  });
  record('mode_transitions', modes.clearWorked !== false && modes.piModeToggle && modes.owiControl, modes);

  const modeShot = resolve(SCREENSHOT_DIR, '06-mode-transitions.png');
  await page.screenshot({ path: modeShot, fullPage: false });
  report.screenshots.push(modeShot);

  await browser.close();

  const failed = report.checks.filter((c) => !c.pass);
  report.state = failed.length ? 'PARTIAL' : 'PASS';
  report.pass = report.checks.length - failed.length;
  report.fail = failed.length;
  report.total = report.checks.length;
  writeArtifacts(report);

  console.log(JSON.stringify({
    state: report.state,
    pass: report.pass,
    total: report.total,
    checks: report.checks.map((c) => ({ id: c.id, pass: c.pass }))
  }, null, 2));
  process.exit(failed.length ? 1 : 0);
}

function writeArtifacts(report) {
  mkdirSync(ARTIFACT_DIR, { recursive: true });
  writeFileSync(resolve(ARTIFACT_DIR, 'latest.json'), `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(resolve(ARTIFACT_DIR, 'latest.txt'), [
    'AGENT 1 OPERATOR STABILITY (BROWSER)',
    `STATE: ${report.state}`,
    `CHECKS: ${report.pass}/${report.total}`,
    '',
    ...report.checks.map((c) => `${c.pass ? 'PASS' : 'FAIL'} ${c.id} ${JSON.stringify(c)}`),
    '',
    'SCREENSHOTS:',
    ...(report.screenshots || []).map((p) => ` - ${p}`)
  ].join('\n'));
}

main().catch((error) => {
  console.error(error?.stack || error);
  process.exit(1);
});
