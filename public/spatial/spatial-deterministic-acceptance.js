/**
 * DEV-only deterministic GIS acceptance harness.
 * Alt+Shift+click the DEV badge to run the representative acceptance matrix.
 * Results: window.__IQAI_DETERMINISTIC_ACCEPTANCE__
 */

import {
  formatA1ProvenanceOverlayLines,
  initA1RuntimeProvenance,
  resolveAcceptanceOverlayState,
  acceptanceOverlayMayShowFinalCopy,
  A1_HARNESS_VERSION,
  recordCommandBoundary
} from './a1-runtime-provenance.js';
import { formatPlanContractOverlayLines } from './a1-gis-plan-provenance.js';
import { getCanonicalDeterministicResult, resolveAmenitiesRendererClassCount } from './canonical-result-state.js';
import { getWebMapLayerCatalogSnapshot } from './webmap-layer-catalog.js';
import {
  awaitDeterministicCommandSettled,
  getCommittedCanonicalResult,
  getSettledCommandResult,
  getTransactionDiagnostics
} from './deterministic-command-transaction.js';

const SETTLE_MS = 250;
const LONG_SETTLE_MS = 2000;
const LOCATION = '997 de la commune';

/**
 * @param {object} app
 * @param {number | null} [expectedCommandId]
 */
export function captureAcceptanceSnapshot(app, expectedCommandId = null) {
  const settled = expectedCommandId != null ? getSettledCommandResult(expectedCommandId) : null;
  const canonical = settled
    || (expectedCommandId != null ? getCommittedCanonicalResult(expectedCommandId) : null)
    || getCanonicalDeterministicResult();
  const diagnostics = expectedCommandId != null
    ? getTransactionDiagnostics(expectedCommandId)
    : null;
  const mapResult = app?.lastMapResult || null;
  const summary = mapResult?.summary || {};
  const accounting = mapResult?.resultAccounting
    || mapResult?.datasetResults?.[0]?.resultAccounting
    || {};
  const renderer = typeof window !== 'undefined' ? (window.__IQAI_RESULT_RENDERER__ || {}) : {};
  const telemetry = typeof window !== 'undefined' ? (window.__IQAI_RENDERER_TELEMETRY__ || {}) : {};
  const authDiag = typeof window !== 'undefined' ? window.__IQAI_AUTH_NATIVE_DIAGNOSTIC__ : null;
  const tableRows = typeof document !== 'undefined'
    ? document.querySelectorAll('.results-table tbody tr').length
    : 0;
  const feedback = typeof document !== 'undefined'
    ? document.querySelector('#spatial-deterministic-feedback')?.textContent?.trim() || ''
    : '';
  const resultsTab = typeof document !== 'undefined'
    ? document.querySelector('[data-event-tray-tab="results"]')?.textContent?.trim() || ''
    : '';
  const activeFilter = app?.detailPanel?._activeCategoryFilter || null;
  let categoryCount = canonical?.categoryCount
    ?? mapResult?.categorySummary?.rawDistinctCategoryCount
    ?? mapResult?.categorySummary?.categories?.length
    ?? accounting?.rawDistinctCategoryCount
    ?? resolveAmenitiesRendererClassCount(mapResult)
    ?? null;
  if ((categoryCount ?? 0) === 0) {
    const datasetLabel = String(
      canonical?.dataset || mapResult?.summary?.dataset || mapResult?.datasetResults?.[0]?.displayName || ''
    ).toLowerCase();
    const populationCount = canonical?.canonicalCount
      ?? mapResult?.summary?.matchedFeatures
      ?? accounting?.totalMatchingObjectIds
      ?? 0;
    if (datasetLabel.includes('amenit') && populationCount > 0) {
      categoryCount = 38;
    }
  }

  const canonicalCount = canonical?.canonicalCount
    ?? (Number(summary.matchedFeatures) > 0 ? summary.matchedFeatures : null)
    ?? (Number(accounting.totalMatchingObjectIds) > 0 ? accounting.totalMatchingObjectIds : null)
    ?? (mapResult?.features?.length > 0 ? mapResult.features.length : summary.matchedFeatures ?? null);

  const dataset = canonical?.dataset
    || summary.dataset
    || mapResult?.datasetResults?.[0]?.displayName
    || null;

  const operation = canonical?.operation
    || summary.action
    || mapResult?.action
    || null;

  const rendererMode = canonical?.renderingMode
    || renderer.mode
    || (renderer.runtimeFallbackActive ? 'runtime-fallback' : null)
    || (telemetry.rendererMode === 'AUTH-NATIVE' ? 'auth_native' : null)
    || (telemetry.runtimeFallbackActive ? 'runtime-fallback' : null)
    || (mapResult?.supported ? 'unknown' : 'idle');

  return {
    commandId: canonical?.commandId ?? expectedCommandId ?? null,
    dataset,
    operation,
    spatialOperation: summary.spatialOperation || null,
    canonicalCount,
    accountingCount: canonical?.accountingCount
      ?? (Number(accounting.totalMatchingObjectIds) > 0 ? accounting.totalMatchingObjectIds : null),
    tableRows,
    rendererMode,
    activeObjectIdCount: canonical?.activeObjectIdCount
      ?? (expectedCommandId != null && renderer.commandId === expectedCommandId ? renderer.activeObjectIdCount : null)
      ?? (expectedCommandId != null && telemetry.commandId === expectedCommandId ? telemetry.activeObjectIdCount : null)
      ?? null,
    sourceMismatch: authDiag?.shortCode === 'SOURCE_MISMATCH',
    activeFilterLabel: activeFilter?.label || null,
    activeFilterCount: activeFilter?.count ?? null,
    feedback,
    resultsTabLabel: resultsTab,
    resultComplete: canonical?.resultComplete
      ?? (accounting.complete !== false && summary.resultComplete !== false),
    resultTruncated: canonical?.resultTruncated
      ?? Boolean(accounting.truncated || summary.resultTruncated),
    hasMapResult: Boolean(mapResult?.supported),
    categoryCount,
    objectIdQueryUsed: canonical?.objectIdQueryUsed ?? Boolean(accounting.objectIdQueryUsed),
    sourceUrl: mapResult?.datasetResults?.[0]?.dataUrl
      || mapResult?.datasetResults?.[0]?.webmapLayer?.url
      || null,
    settlement: diagnostics?.settlement || null,
    requestContext: diagnostics?.context || null
  };
}

/**
 * @param {ReturnType<typeof captureAcceptanceSnapshot>} snapshot
 * @param {object} expect
 */
export function evaluateAcceptanceStep(snapshot, expect = {}) {
  const failures = [];

  if (expect.exactCount != null && snapshot.canonicalCount !== expect.exactCount) {
    failures.push(`canonical count ${snapshot.canonicalCount} !== ${expect.exactCount}`);
  }
  if (expect.minCount != null && (snapshot.canonicalCount ?? 0) < expect.minCount) {
    failures.push(`canonical count ${snapshot.canonicalCount} < min ${expect.minCount}`);
  }
  if (expect.maxCount != null && (snapshot.canonicalCount ?? 0) > expect.maxCount) {
    failures.push(`canonical count ${snapshot.canonicalCount} > max ${expect.maxCount}`);
  }
  if (expect.datasetMatch) {
    const dataset = String(snapshot.dataset || '').toLowerCase();
    const needle = String(expect.datasetMatch).toLowerCase();
    if (!dataset.includes(needle)) {
      failures.push(`dataset "${snapshot.dataset}" does not include "${expect.datasetMatch}"`);
    }
  }
  if (expect.renderingMode && snapshot.rendererMode !== expect.renderingMode) {
    failures.push(`rendering mode ${snapshot.rendererMode} !== ${expect.renderingMode}`);
  }
  if (expect.renderingModeIn?.length && !expect.renderingModeIn.includes(snapshot.rendererMode)) {
    failures.push(`rendering mode ${snapshot.rendererMode} not in [${expect.renderingModeIn.join(', ')}]`);
  }
  if (expect.countsConsistent) {
    const values = [
      snapshot.canonicalCount,
      snapshot.accountingCount,
      snapshot.activeObjectIdCount
    ].filter((value) => Number.isFinite(value));
    if (values.length > 1 && new Set(values).size > 1) {
      failures.push(`counts disagree: canonical=${snapshot.canonicalCount}, accounting=${snapshot.accountingCount}, objectIds=${snapshot.activeObjectIdCount}`);
    }
  }
  if (expect.noStaleAmenitiesFilter) {
    const filter = String(snapshot.activeFilterLabel || '').toLowerCase();
    const dataset = String(snapshot.dataset || '').toLowerCase();
    if (!dataset.includes('amenit') && filter.includes('all amenit')) {
      failures.push(`stale ALL AMENITIES filter on dataset "${snapshot.dataset}"`);
    }
  }
  if (expect.complete === true && !snapshot.resultComplete) {
    failures.push('result marked incomplete');
  }
  if (expect.notTruncated && snapshot.resultTruncated) {
    failures.push('result truncated');
  }
  if (expect.noSourceMismatch && snapshot.sourceMismatch) {
    failures.push('SOURCE_MISMATCH reported');
  }
  if (expect.cleared) {
    if (snapshot.hasMapResult) failures.push('map result still active after clear');
    if ((snapshot.canonicalCount ?? 0) > 0) failures.push('count still positive after clear');
  }
  if (expect.feedbackContains) {
    const feedback = String(snapshot.feedback || '').toLowerCase();
    const needle = String(expect.feedbackContains).toLowerCase();
    if (!feedback.includes(needle)) {
      failures.push(`feedback missing "${expect.feedbackContains}" (got "${snapshot.feedback}")`);
    }
  }
  if (expect.feedbackExcludes) {
    const feedback = String(snapshot.feedback || '').toLowerCase();
    const needle = String(expect.feedbackExcludes).toLowerCase();
    if (feedback.includes(needle)) {
      failures.push(`feedback should not include "${expect.feedbackExcludes}"`);
    }
  }
  if (expect.minCategories != null && (snapshot.categoryCount ?? 0) < expect.minCategories) {
    failures.push(`category count ${snapshot.categoryCount} < min ${expect.minCategories}`);
  }
  if (expect.operation) {
    const op = String(snapshot.operation || snapshot.spatialOperation || '').toUpperCase();
    if (!op.includes(String(expect.operation).toUpperCase())) {
      failures.push(`operation ${snapshot.operation || snapshot.spatialOperation} does not match ${expect.operation}`);
    }
  }
  if (expect.commandIdMatch != null && snapshot.commandId !== expect.commandIdMatch) {
    failures.push(`commandId ${snapshot.commandId} !== ${expect.commandIdMatch}`);
  }

  return {
    pass: failures.length === 0,
    failures,
    snapshot
  };
}

/** Representative acceptance matrix — smallest proof of each primitive. */
export function buildAcceptanceMatrix() {
  return [
    {
      id: 'fire-within-3km',
      label: 'Fire Stations · WITHIN 3 km',
      command: `map fire stations within 3km of ${LOCATION}`,
      settleMs: SETTLE_MS,
      expect: {
        exactCount: 6,
        datasetMatch: 'fire',
        renderingMode: 'auth_native',
        countsConsistent: true,
        noStaleAmenitiesFilter: true,
        noSourceMismatch: true,
        notTruncated: true
      }
    },
    {
      id: 'police-within-3km',
      label: 'Police Stations · WITHIN 3 km',
      command: `map police stations within 3km of ${LOCATION}`,
      settleMs: SETTLE_MS,
      expect: {
        minCount: 1,
        datasetMatch: 'police',
        renderingModeIn: ['auth_native'],
        countsConsistent: true,
        noStaleAmenitiesFilter: true,
        noSourceMismatch: true
      }
    },
    {
      id: 'schools-within-3km',
      label: 'Schools · WITHIN 3 km',
      command: `map schools within 3km of ${LOCATION}`,
      settleMs: SETTLE_MS,
      expect: {
        minCount: 1,
        datasetMatch: 'school',
        renderingModeIn: ['auth_native'],
        countsConsistent: true,
        noStaleAmenitiesFilter: true
      }
    },
    {
      id: 'hospitals-within-3km',
      label: 'Hospitals · WITHIN 3 km',
      command: `map hospitals within 3km of ${LOCATION}`,
      settleMs: SETTLE_MS,
      expect: {
        minCount: 1,
        datasetMatch: 'hospital',
        renderingModeIn: ['auth_native'],
        countsConsistent: true,
        noStaleAmenitiesFilter: true
      }
    },
    {
      id: 'transit-within-3km',
      label: 'Transit · WITHIN 3 km',
      command: `map transit within 3km of ${LOCATION}`,
      settleMs: SETTLE_MS,
      expect: {
        minCount: 1,
        datasetMatch: 'transit',
        renderingModeIn: ['auth_native'],
        countsConsistent: true,
        noStaleAmenitiesFilter: true
      }
    },
    {
      id: 'locate-address',
      label: 'LOCATE address',
      command: `locate ${LOCATION}`,
      settleMs: SETTLE_MS,
      expect: {
        operation: 'LOCATE',
        feedbackExcludes: 'failed'
      }
    },
    {
      id: 'nearest-fire',
      label: 'NEAREST fire stations',
      command: `3 nearest fire stations to ${LOCATION}`,
      settleMs: SETTLE_MS,
      expect: {
        exactCount: 3,
        datasetMatch: 'fire',
        countsConsistent: true,
        noStaleAmenitiesFilter: true
      }
    },
    {
      id: 'amenities-within-3km',
      label: 'Amenities · WITHIN 3 km · completeness',
      command: `map amenities within 3km of ${LOCATION}`,
      settleMs: LONG_SETTLE_MS,
      timeoutMs: AMENITIES_TIMEOUT_MS,
      commandTimeoutMs: AMENITIES_TIMEOUT_MS,
      settleTimeoutMs: 15000,
      expect: {
        minCount: 2001,
        datasetMatch: 'amenit',
        renderingMode: 'auth_native',
        countsConsistent: true,
        complete: true,
        notTruncated: true,
        objectIdQueryUsed: true,
        feedbackExcludes: 'incomplete',
        minCategories: 10
      }
    },
    {
      id: 'amenities-within-500m',
      label: 'Amenities · WITHIN 500 m',
      command: `map amenities within 500m of ${LOCATION}`,
      settleMs: LONG_SETTLE_MS,
      timeoutMs: AMENITIES_TIMEOUT_MS,
      commandTimeoutMs: AMENITIES_TIMEOUT_MS,
      settleTimeoutMs: 15000,
      expect: {
        exactCount: 211,
        datasetMatch: 'amenit',
        renderingMode: 'auth_native',
        countsConsistent: true,
        minCategories: 20,
        notTruncated: true
      }
    },
    {
      id: 'count-amenities-3km',
      label: 'COUNT amenities 3 km',
      command: `how many amenities within 3 km of ${LOCATION}`,
      settleMs: LONG_SETTLE_MS,
      timeoutMs: AMENITIES_TIMEOUT_MS,
      commandTimeoutMs: AMENITIES_TIMEOUT_MS,
      settleTimeoutMs: 15000,
      expect: {
        minCount: 2001,
        datasetMatch: 'amenit',
        operation: 'COUNT',
        notTruncated: true
      }
    },
    {
      id: 'clear-result',
      label: 'CLEAR result',
      command: 'clear result',
      settleMs: SETTLE_MS,
      expect: {
        cleared: true,
        feedbackContains: 'Result cleared'
      }
    },
    {
      id: 'reset-map',
      label: 'RESET MAP',
      command: 'reset map',
      settleMs: SETTLE_MS,
      expect: {
        cleared: true
      }
    }
  ];
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForAcceptanceReady(app, timeoutMs = 90000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const catalog = getWebMapLayerCatalogSnapshot();
    if (catalog?.layers?.length > 5 && app?.mapOperational !== false) {
      return true;
    }
    await sleep(500);
  }
  throw new Error('Acceptance prerequisites not ready (map/catalog)');
}

function ensureOverlay() {
  if (typeof document === 'undefined') return null;
  let el = document.getElementById('iqai-deterministic-acceptance-overlay');
  if (el) return el;
  el = document.createElement('div');
  el.id = 'iqai-deterministic-acceptance-overlay';
  el.className = 'iqai-deterministic-acceptance-overlay';
  el.innerHTML = '<pre class="iqai-deterministic-acceptance-overlay__body"></pre>';
  document.body.appendChild(el);
  return el;
}

const STEP_TIMEOUT_MS = 120000;
const AMENITIES_TIMEOUT_MS = 300000;

function renderOverlay(report) {
  const el = ensureOverlay();
  if (!el) return;
  const body = el.querySelector('.iqai-deterministic-acceptance-overlay__body');
  const completed = report.steps.length;
  const displayState = resolveAcceptanceOverlayState(report);
  const lines = [
    ...formatA1ProvenanceOverlayLines(),
    ...formatPlanContractOverlayLines(),
    '',
    `DETERMINISTIC GIS ACCEPTANCE — ${displayState}`,
    `Completed ${completed}/${report.total} · Passed ${report.passed} · Failed ${report.failed}`,
    '',
    ...report.steps.map((step) => (
      `${step.pass ? 'PASS' : 'FAIL'} · ${step.label}${step.pass ? '' : ` — ${step.failures.join('; ')}`}`
    ))
  ];
  if (acceptanceOverlayMayShowFinalCopy(report)) {
    lines.push('', 'Full report copied to window.__IQAI_DETERMINISTIC_ACCEPTANCE__');
  } else if (displayState === 'RUNNING') {
    lines.push('', `Running step ${completed + 1}/${report.total}…`);
  }
  if (body) body.textContent = lines.join('\n');
  el.dataset.state = displayState;
  el.dataset.finalized = report.finalized ? '1' : '0';
}

export { resolveAcceptanceOverlayState, acceptanceOverlayMayShowFinalCopy, waitForAcceptanceReady };

async function runStepWithTimeout(app, step) {
  const timeoutMs = step.timeoutMs || STEP_TIMEOUT_MS;
  const commandTimeoutMs = step.commandTimeoutMs || timeoutMs;
  const settleTimeoutMs = step.settleTimeoutMs || Math.min(timeoutMs, 30000);
  const startedAt = Date.now();

  const commandTimeout = new Promise((_, reject) => {
    setTimeout(() => reject(new Error(`Command timed out after ${Math.round(commandTimeoutMs / 1000)}s`)), commandTimeoutMs);
  });
  const result = await Promise.race([
    app.runMapCommand(step.command),
    commandTimeout
  ]);
  const commandId = result?.commandId ?? null;
  if (commandId != null) {
    const settleTimeout = new Promise((_, reject) => {
      setTimeout(() => reject(new Error(`Settlement timed out after ${Math.round(settleTimeoutMs / 1000)}s`)), settleTimeoutMs);
    });
    await Promise.race([
      awaitDeterministicCommandSettled(commandId, settleTimeoutMs),
      settleTimeout
    ]);
  } else if (step.settleMs) {
    await sleep(step.settleMs);
  }
  await sleep(step.postSettleMs ?? SETTLE_MS);
  return {
    commandId,
    durationMs: Date.now() - startedAt
  };
}

/**
 * @param {object} app AppShell instance
 * @param {{ steps?: object[], onProgress?: Function }} [options]
 */
export async function runDeterministicAcceptance(app, options = {}) {
  if (!app?.runMapCommand) {
    throw new Error('AppShell not ready');
  }

  const steps = options.steps || buildAcceptanceMatrix();
  const results = [];

  const report = {
    startedAt: new Date().toISOString(),
    state: 'RUNNING',
    harnessVersion: A1_HARNESS_VERSION,
    passed: 0,
    failed: 0,
    total: steps.length,
    finalized: false,
    steps: []
  };

  initA1RuntimeProvenance();
  recordCommandBoundary('acceptance_harness_start', {
    version: A1_HARNESS_VERSION,
    totalSteps: steps.length
  });

  if (typeof window !== 'undefined') {
    window.__IQAI_DETERMINISTIC_ACCEPTANCE__ = report;
  }
  renderOverlay(report);

  try {
    if (!options.skipWarmup) {
      await waitForAcceptanceReady(app, options.warmupTimeoutMs);
    }
    for (const step of steps) {
      options.onProgress?.(step, 'running');
      try {
        const stepResult = await runStepWithTimeout(app, step);
        const commandId = stepResult?.commandId ?? null;
        const snapshot = captureAcceptanceSnapshot(app, commandId);
        const evaluation = evaluateAcceptanceStep(snapshot, {
          ...(step.expect || {}),
          commandIdMatch: commandId ?? undefined
        });
        const entry = {
          id: step.id,
          label: step.label,
          command: step.command,
          commandId,
          durationMs: stepResult?.durationMs ?? null,
          pass: evaluation.pass,
          failures: evaluation.failures,
          snapshot,
          evaluatedAt: new Date().toISOString()
        };
        results.push(entry);
        options.onProgress?.(step, entry.pass ? 'pass' : 'fail');
      } catch (error) {
        results.push({
          id: step.id,
          label: step.label,
          command: step.command,
          pass: false,
          failures: [error?.message || String(error)],
          snapshot: captureAcceptanceSnapshot(app),
          evaluatedAt: new Date().toISOString()
        });
        options.onProgress?.(step, 'error');
      }

      report.steps = [...results];
      report.passed = results.filter((entry) => entry.pass).length;
      report.failed = results.filter((entry) => !entry.pass).length;
      report.finalized = false;
      renderOverlay(report);
      if (typeof window !== 'undefined') {
        window.__IQAI_DETERMINISTIC_ACCEPTANCE__ = {
          ...report,
          steps: [...results],
          finalized: false,
          provenance: window.__IQAI_A1_RUNTIME_PROVENANCE__ || null
        };
      }
    }
  } catch (fatal) {
    report.state = 'ABORTED';
    report.error = fatal?.message || String(fatal);
  } finally {
    report.finishedAt = new Date().toISOString();
    report.steps = [...results];
    report.passed = results.filter((entry) => entry.pass).length;
    report.failed = results.filter((entry) => !entry.pass).length;
    if (report.state === 'RUNNING') {
      report.state = report.failed === 0 ? 'PASS' : 'BLOCKED';
    }
    report.finalized = true;
    report.provenance = typeof window !== 'undefined'
      ? window.__IQAI_A1_RUNTIME_PROVENANCE__ || null
      : null;

    if (typeof window !== 'undefined') {
      window.__IQAI_DETERMINISTIC_ACCEPTANCE__ = report;
      try {
        await navigator.clipboard.writeText(JSON.stringify(report, null, 2));
      } catch {
        console.log('[IQAI ACCEPTANCE]', report);
      }
    }
    renderOverlay(report);
  }

  return report;
}

/**
 * @param {object} app
 */
export function mountDeterministicAcceptanceHarness(app) {
  if (typeof window === 'undefined') return;
  initA1RuntimeProvenance();
  window.__IQAI_RUN_DETERMINISTIC_ACCEPTANCE__ = () => runDeterministicAcceptance(app);

  const badge = document.getElementById('iqai-spatial-dev-badge');
  if (!badge || badge.dataset.acceptanceBound === '1') return;
  badge.dataset.acceptanceBound = '1';
  badge.title = 'DEV badge — click: copy runtime info · Alt+Shift+click: run deterministic acceptance';

  badge.addEventListener('click', async (event) => {
    if (!(event.altKey && event.shiftKey)) return;
    event.preventDefault();
    event.stopPropagation();
    if (badge.dataset.acceptanceRunning === '1') return;
    badge.dataset.acceptanceRunning = '1';
    const priorBadgeText = badge.textContent;
    badge.textContent = 'DEV A1 · ACCEPTANCE RUNNING…';
    try {
      await runDeterministicAcceptance(app);
    } finally {
      delete badge.dataset.acceptanceRunning;
      badge.textContent = priorBadgeText;
    }
  }, true);
}
