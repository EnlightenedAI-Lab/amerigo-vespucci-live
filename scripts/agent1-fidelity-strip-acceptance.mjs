#!/usr/bin/env node
/**
 * Issue #29 — Fidelity Strip V1 Playwright gauntlet (Tests 1–7).
 * Requires live IQAI at http://localhost:3000/spatial/
 */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isPortOpen } from './lib/spatial-server.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const ARTIFACT_DIR = resolve(REPO_ROOT, 'artifacts', 'agent1-fidelity-strip-v1');
const AUTH_PROFILE_DIR = resolve(REPO_ROOT, '.playwright-auth', 'montreal');

const PORT = Number(process.env.SPATIAL_PORT || 3000);
const SPATIAL_URL = process.env.SPATIAL_URL || `http://localhost:${PORT}/spatial/`;
const RESEARCH_TIMEOUT_MS = Number(process.env.INTEL_RESEARCH_TIMEOUT_MS || 180000);
const SETTLE_MS = Number(process.env.SCENARIO_SETTLE_MS || 15000);

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

const AUTH_READY_MARKER = resolve(AUTH_PROFILE_DIR, '.auth-ready.json');
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
        aiRun: Boolean(document.querySelector('#spatial-ai-run') && !document.querySelector('#spatial-ai-run').disabled),
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

async function runPrompt(page, prompt, options = {}) {
  await page.locator('#spatial-ai-input').fill(prompt);
  await page.waitForTimeout(200);
  await page.waitForFunction(() => {
    const btn = document.querySelector('#spatial-ai-run');
    return btn && !btn.disabled;
  }, { timeout: 30000 });
  const waits = [];
  if (options.progressive) {
    waits.push(page.waitForResponse(
      (res) => res.url().includes('/api/spatial/orchestrator/progressive-intelligence') && res.request().method() === 'POST',
      { timeout: RESEARCH_TIMEOUT_MS }
    ).catch(() => null));
  }
  if (options.poi) {
    waits.push(page.waitForResponse(
      (res) => res.url().includes('/api/spatial/') && res.request().method() === 'POST',
      { timeout: 120000 }
    ).catch(() => null));
  }
  await page.locator('#spatial-ai-run').click();
  if (waits.length) await Promise.all(waits);
  await page.waitForTimeout(options.settleMs ?? SETTLE_MS);
}

async function readFidelityStrip(page) {
  return page.evaluate(() => {
    const strip = document.querySelector('.fidelity-strip');
    const model = window.__IQAI_FIDELITY_STRIP__ || null;
    const cards = {};
    document.querySelectorAll('[data-fidelity-card]').forEach((el) => {
      cards[el.getAttribute('data-fidelity-card')] = {
        value: el.querySelector('.fidelity-strip__value')?.textContent?.trim() || null,
        sub: el.querySelector('.fidelity-strip__sub')?.textContent?.trim() || null
      };
    });
    return {
      visible: Boolean(strip && !strip.closest('[hidden]')),
      mode: strip?.getAttribute('data-fidelity-mode') || model?.mode || null,
      model,
      cards,
      governedCount: Object.keys(window.__IQAI_GOVERNED_EVENT_STORE__ || {}).length
    };
  });
}

async function selectGovernedEvent(page, eventId) {
  return page.evaluate(async (id) => {
    const store = window.__IQAI_GOVERNED_EVENT_STORE__ || {};
    const governed = store[id];
    if (!governed) return { ok: false, reason: 'MISSING_GOVERNED_EVENT' };
    const hub = await import('/spatial/fidelity-selection-hub.js');
    hub.publishFidelitySelection({
      mode: hub.FIDELITY_SELECTION_MODES.INTELLIGENCE_EVENT,
      eventId: id,
      attributes: {
        eventId: id,
        iqaiFidelityPlane: 'INTELLIGENCE',
        admissionOutcome: governed.admissionDecision?.outcome || null
      }
    });
    await new Promise((r) => setTimeout(r, 300));
    return {
      ok: true,
      strip: window.__IQAI_FIDELITY_STRIP__ || null,
      admission: governed.admissionDecision?.outcome || null
    };
  }, eventId);
}

async function selectReferenceFeature(page, attrs) {
  return page.evaluate(async (attributes) => {
    const hub = await import('/spatial/fidelity-selection-hub.js');
    hub.publishFidelitySelection(hub.classifyMapFeatureSelection(attributes));
    await new Promise((r) => setTimeout(r, 200));
    return window.__IQAI_FIDELITY_STRIP__ || null;
  }, attrs);
}

async function clearFidelity(page) {
  return page.evaluate(async () => {
    const hub = await import('/spatial/fidelity-selection-hub.js');
    hub.clearFidelitySelection();
    await new Promise((r) => setTimeout(r, 150));
    return window.__IQAI_FIDELITY_STRIP__ || null;
  });
}

async function firstGovernedEventId(page) {
  return page.evaluate(() => {
    const ids = Object.keys(window.__IQAI_GOVERNED_EVENT_STORE__ || {});
    return ids[0] || null;
  });
}

async function readProgressiveAuthEvidence(page) {
  return page.evaluate(() => {
    const store = window.__IQAI_GOVERNED_EVENT_STORE__ || {};
    const ids = Object.keys(store);
    const liveIds = ids.filter((id) => {
      const source = store[id]?.source;
      return source === 'progressive-intelligence'
        || source === 'progressive-map-plan'
        || String(id).startsWith('live-event_');
    });
    const receipt = window.__IQAI_LAST_PROGRESSIVE_RECEIPT__ || null;
    return {
      governedCount: ids.length,
      liveGovernedCount: liveIds.length,
      liveEventIds: liveIds,
      mappedCount: receipt?.mappedCount ?? null,
      governanceStats: receipt?.governanceStats || null,
      progressiveTraceId: receipt?.traceId || null
    };
  });
}

/** Fallback retained for diagnostics only — must not count toward authenticity PASS. */
async function seedLiveGovernedEvent(page) {
  return page.evaluate(async () => {
    const res = await fetch('/api/spatial/intelligence/govern-candidate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        candidate: {
          eventId: `fallback-fidelity-${Date.now()}`,
          title: 'Structure fire — Montréal',
          occurredAt: '2026-08-01T03:00:00Z',
          publishedAt: '2026-08-01T08:00:00Z',
          occurrenceSource: 'SOURCE_EXTRACTION',
          locationText: 'Rue Saint-Denis, Montréal',
          municipality: 'Montréal',
          mappable: true,
          geometry: { type: 'Point', coordinates: [-73.56, 45.51] },
          sourceReports: [{
            url: 'https://www.cbc.ca/news/canada/montreal/fire-report',
            sourceUrl: 'https://www.cbc.ca/news/canada/montreal/fire-report',
            publisher: 'CBC'
          }]
        },
        objectiveContext: { query: 'fires Montréal', conceptId: 'fires' }
      })
    });
    const body = await res.json();
    if (!body?.admissionDecision?.outcome) return { ok: false, body };
    const { registerGovernedEvent } = await import('/spatial/governed-event-store.js');
    const eventId = body.admissionDecision.eventId || body.governedCandidate?.eventId;
    registerGovernedEvent(eventId, {
      admissionDecision: body.admissionDecision,
      governedCandidate: body.governedCandidate,
      candidate: body.governedCandidate,
      receipt: body.receipt,
      source: 'acceptance-fallback'
    });
    return { ok: true, eventId, outcome: body.admissionDecision.outcome, fallbackUsed: true };
  });
}

async function screenshot(page, name) {
  const path = resolve(ARTIFACT_DIR, `${name}.png`);
  await page.screenshot({ path, fullPage: true }).catch(() => {});
  return path;
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
  let preauth = null;
  if (process.env.ARCGIS_USERNAME && process.env.ARCGIS_PASSWORD) {
    preauth = await fetchPreauthToken();
  }

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
  try {
    const cdp = await context.newCDPSession(page);
    await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
  } catch { /* optional */ }
  const tests = {};
  const consoleErrors = [];
  page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });

  try {
    await page.goto(`${SPATIAL_URL}?v=${Date.now()}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await waitForReady(page);

    // TEST 1 — live progressive intelligence → governed store → fidelity strip
    await runPrompt(page,
      'Find significant fires, explosions, or hazmat incidents in Montréal in the last 30 days and map them.',
      { progressive: true, settleMs: 5000 }
    );
    await page.waitForFunction(
      () => Boolean(window.__IQAI_LAST_PROGRESSIVE_RECEIPT__),
      { timeout: RESEARCH_TIMEOUT_MS }
    ).catch(() => {});
    await page.waitForFunction(
      () => {
        const store = window.__IQAI_GOVERNED_EVENT_STORE__ || {};
        return Object.keys(store).some((id) => {
          const source = store[id]?.source;
          return source === 'progressive-intelligence'
            || source === 'progressive-map-plan'
            || String(id).startsWith('live-event_');
        });
      },
      { timeout: RESEARCH_TIMEOUT_MS }
    ).catch(() => {});
    const authEvidence = await readProgressiveAuthEvidence(page);
    let fallbackUsed = false;
    let eventA = authEvidence.liveEventIds?.[0] || null;
    if (!eventA) {
      const seeded = await seedLiveGovernedEvent(page);
      tests.test1Seed = seeded;
      eventA = seeded.eventId || null;
      fallbackUsed = true;
    }
    const selA = eventA ? await selectGovernedEvent(page, eventA) : { ok: false };
    const stripA = await readFidelityStrip(page);
    await screenshot(page, 'test1-live-intelligence');
    const liveProgressiveEventUsed = Boolean(!fallbackUsed && eventA && selA.ok);
    tests.test1 = {
      pass: Boolean(
        liveProgressiveEventUsed
        && fallbackUsed === false
        && selA.ok
        && stripA.visible
        && stripA.cards.ADMISSION?.value
        && stripA.cards.ADMISSION.value !== 'NOT ASSESSED'
        && stripA.cards.ADMISSION.value !== '—'
        && stripA.cards.SOURCE?.value
        && stripA.cards.SPATIAL?.value
        && stripA.cards.TEMPORAL?.value
        && stripA.cards.PROVENANCE?.value
      ),
      liveProgressiveEventUsed,
      fallbackUsed,
      governanceOutcome: selA.admission || stripA.cards.ADMISSION?.value || null,
      selectedEventId: eventA,
      eventId: eventA,
      strip: stripA,
      receiptMatch: selA.admission === stripA.cards.ADMISSION?.value,
      authEvidence
    };

    // TEST 2 — event switch (require a different admission outcome than Event A)
    const switchCandidate = await page.evaluate((eventAId) => {
      const store = window.__IQAI_GOVERNED_EVENT_STORE__ || {};
      const outcomeA = store[eventAId]?.admissionDecision?.outcome || null;
      for (const [id, bundle] of Object.entries(store)) {
        if (id === eventAId) continue;
        const outcome = bundle?.admissionDecision?.outcome || null;
        if (outcome && outcome !== outcomeA) return id;
      }
      return null;
    }, eventA);
    let eventB = switchCandidate;
    if (!eventB) {
      await page.evaluate(async () => {
        const { registerGovernedEvent } = await import('/spatial/governed-event-store.js');
        registerGovernedEvent('evt-switch-b', {
          admissionDecision: {
            outcome: 'ADMIT',
            reasonCodes: ['ADMITTED'],
            sourceFacts: { sourceIntelligenceClass: 'OFFICIAL_GOVERNMENT', isOfficial: true },
            spatialFacts: { locationPrecision: 'MUNICIPALITY' },
            temporalFacts: { occurrenceKnown: true, occurredAt: '2026-08-02T01:00:00Z', publishedAt: '2026-08-02T02:00:00Z' },
            evidenceLineageFacts: { corroborationSummary: 'OFFICIAL_SUPPORT', lineageCount: 2, independentLineageCount: 2, sourceReportCount: 2 }
          }
        });
      });
      eventB = 'evt-switch-b';
    }
    await selectGovernedEvent(page, eventB);
    const stripB = await readFidelityStrip(page);
    await screenshot(page, 'test2-event-switch');
    tests.test2 = {
      pass: Boolean(stripB.visible && stripB.cards.ADMISSION?.value && stripB.cards.ADMISSION.value !== stripA.cards.ADMISSION?.value),
      eventB,
      admissionA: stripA.cards.ADMISSION?.value,
      admissionB: stripB.cards.ADMISSION?.value
    };

    // TEST 3 — governance HOLD
    await page.evaluate(async () => {
      const { registerGovernedEvent } = await import('/spatial/governed-event-store.js');
      registerGovernedEvent('evt-hold-proof', {
        admissionDecision: {
          outcome: 'HOLD',
          reasonCodes: ['MISSING_OCCURRENCE'],
          sourceFacts: {},
          spatialFacts: {},
          temporalFacts: { occurrenceKnown: false },
          evidenceLineageFacts: {}
        }
      });
    });
    await selectGovernedEvent(page, 'evt-hold-proof');
    const stripHold = await readFidelityStrip(page);
    await screenshot(page, 'test3-hold');
    tests.test3 = {
      pass: stripHold.cards.ADMISSION?.value === 'HOLD',
      strip: stripHold
    };

    // TEST 4 — compound incident + hospital
    await runPrompt(page,
      'Find significant fires, explosions, or hazmat incidents in Montréal in the last 30 days and show hospitals within 2 km of each admitted event.',
      { progressive: true, settleMs: 20000 }
    );
    const compoundEvent = await firstGovernedEventId(page);
    await selectGovernedEvent(page, compoundEvent);
    const stripIncident = await readFidelityStrip(page);
    await selectReferenceFeature(page, { datasetId: 'HOSPITALS', name: 'Test Hospital' });
    const stripHospital = await readFidelityStrip(page);
    await screenshot(page, 'test4-compound');
    tests.test4 = {
      pass: Boolean(
        stripIncident.visible
        && stripIncident.cards.ADMISSION?.value
        && stripHospital.mode === 'REFERENCE_GIS'
        && stripHospital.cards.ADMISSION?.value === '—'
      ),
      incidentAdmission: stripIncident.cards.ADMISSION?.value,
      hospitalMode: stripHospital?.mode
    };

    // TEST 5 — POI switch
    await runPrompt(page, 'Map Starbucks near 997 de la Commune.', { poi: true, settleMs: 18000 });
    await selectReferenceFeature(page, { datasetId: 'AMENITIES', amenity: 'cafe', name: 'Starbucks' });
    const stripPoi = await readFidelityStrip(page);
    await screenshot(page, 'test5-poi');
    tests.test5 = {
      pass: Boolean(
        stripPoi.mode === 'REFERENCE_GIS'
        && stripPoi.cards.ADMISSION?.value === '—'
        && stripPoi.cards.INTEGRITY?.value === '—'
      ),
      strip: stripPoi
    };

    // TEST 6 — clear
    await runPrompt(page, 'clear map', { settleMs: 5000 });
    await clearFidelity(page);
    const stripClear = await readFidelityStrip(page);
    await screenshot(page, 'test6-clear');
    tests.test6 = {
      pass: !stripClear.visible,
      strip: stripClear
    };

    // TEST 7 — return to intelligence
    await runPrompt(page,
      'Find significant fires, explosions, or hazmat incidents in Montréal in the last 30 days and map them.',
      { progressive: true }
    );
    const returnEvent = await firstGovernedEventId(page);
    await selectGovernedEvent(page, returnEvent);
    const stripReturn = await readFidelityStrip(page);
    await screenshot(page, 'test7-return-intelligence');
    tests.test7 = {
      pass: Boolean(
        stripReturn.visible
        && stripReturn.cards.ADMISSION?.value
        && stripReturn.cards.ADMISSION.value !== '—'
      ),
      strip: stripReturn
    };

    const allPass = ['test1', 'test2', 'test3', 'test4', 'test5', 'test6', 'test7']
      .every((key) => tests[key]?.pass === true);
    const payload = {
      generatedAt: new Date().toISOString(),
      spatialUrl: SPATIAL_URL,
      pass: allPass,
      authenticity: {
        liveProgressiveEventUsed: tests.test1?.liveProgressiveEventUsed === true,
        fallbackUsed: tests.test1?.fallbackUsed === true,
        governanceOutcome: tests.test1?.governanceOutcome || null,
        selectedEventId: tests.test1?.selectedEventId || null
      },
      tests,
      consoleErrors: consoleErrors.slice(0, 20)
    };
    writeFileSync(resolve(ARTIFACT_DIR, 'latest.json'), JSON.stringify(payload, null, 2));
    console.log(JSON.stringify(payload, null, 2));
    process.exit(allPass ? 0 : 1);
  } finally {
    await context?.close?.().catch(() => {});
    await browser?.close?.().catch(() => {});
  }
}

main().catch((error) => {
  const payload = { pass: false, error: error.message };
  mkdirSync(ARTIFACT_DIR, { recursive: true });
  writeFileSync(resolve(ARTIFACT_DIR, 'latest.json'), JSON.stringify(payload, null, 2));
  console.error(error);
  process.exit(1);
});
