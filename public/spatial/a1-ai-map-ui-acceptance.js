/**
 * DEV/autonomous AI MAP UI acceptance harness.
 */

import { AI_MAP_UI_ENABLED } from './ai-map-ui-config.js';
import { getCanonicalDeterministicResult } from './canonical-result-state.js';

const LOCATION = '997 de la Commune';
const DECARIE = '6939 Décarie Boulevard';
const STEP_TIMEOUT_MS = 180000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function snapshotUiState(app) {
  const feedback = document.querySelector('#spatial-ai-feedback')?.textContent?.trim() || '';
  const chain = document.querySelector('#spatial-ai-chain')?.textContent?.trim() || '';
  const modelBadge = document.querySelector('#spatial-ai-model-badge')?.textContent?.trim() || '';
  const aiRunDisabled = document.querySelector('#spatial-ai-run')?.disabled ?? true;
  const canonical = getCanonicalDeterministicResult();
  return {
    feedback,
    chain,
    modelBadge,
    aiRunDisabled,
    canonicalCount: canonical?.canonicalCount ?? null,
    canonicalDataset: canonical?.dataset ?? null,
    canonicalOperation: canonical?.operation ?? null,
    commandId: canonical?.commandId ?? null,
    hasMapResult: Boolean(app?.lastMapResult?.supported)
  };
}

/**
 * @param {object} app
 * @param {object} step
 */
async function runUiStep(app, step) {
  const input = document.querySelector('#spatial-ai-input');
  const runBtn = document.querySelector('#spatial-ai-run');
  if (!input || !runBtn || !app?.runAiMapCommand) {
    return { pass: false, failures: ['AI MAP controls or app handler not found'] };
  }

  if (step.restoreFetch) {
    window.fetch = step.restoreFetch;
    step.restoreFetch = null;
  }
  if (step.mockFetch) {
    const originalFetch = window.fetch.bind(window);
    step.restoreFetch = originalFetch;
    window.fetch = async (url, options = {}) => {
      const href = String(url);
      if (href.includes('/api/spatial/ai-map')) {
        return step.mockFetch(href, options);
      }
      return originalFetch(url, options);
    };
  }

  const before = snapshotUiState(app);
  input.value = step.prompt;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  await sleep(100);

  await app.runAiMapCommand(step.prompt);
  await sleep(600);

  const after = snapshotUiState(app);
  const feedback = after.feedback || document.querySelector('#spatial-ai-feedback')?.textContent?.trim() || '';

  const failures = [];
  if (step.expectEnabled && !AI_MAP_UI_ENABLED) {
    failures.push('AI MAP UI gate is disabled');
  }
  if (step.expectModelBadge && !after.modelBadge) {
    failures.push('provider/model badge not shown');
  }
  if (step.expectFeedbackIncludes) {
    const needle = String(step.expectFeedbackIncludes).toLowerCase();
    if (!feedback.toLowerCase().includes(needle)) {
      failures.push(`feedback missing "${step.expectFeedbackIncludes}" (got "${feedback}")`);
    }
  }
  if (step.expectFeedbackAbsent) {
    if (feedback) {
      failures.push(`expected no AI MAP feedback but got "${feedback}"`);
    }
  }
  if (step.expectNoGisExecution) {
    if (after.commandId !== before.commandId && before.commandId != null) {
      // command may legitimately stay same — check canonical stability
    }
    if (step.expectCanonicalUnchanged) {
      if (after.canonicalCount !== before.canonicalCount) {
        failures.push(`canonical count changed ${before.canonicalCount} → ${after.canonicalCount}`);
      }
      if (after.canonicalDataset !== before.canonicalDataset && before.canonicalDataset) {
        failures.push(`canonical dataset changed ${before.canonicalDataset} → ${after.canonicalDataset}`);
      }
    }
    if (step.expectNoNewCommand && after.commandId !== before.commandId) {
      failures.push(`commandId changed ${before.commandId} → ${after.commandId} without GIS execution expected`);
    }
  }
  if (step.expectGisExecution) {
    if (!after.hasMapResult && after.canonicalCount == null) {
      failures.push('expected GIS result after AI MAP execution');
    }
    if (step.expectOperation && String(after.canonicalOperation || '').toUpperCase() !== step.expectOperation) {
      failures.push(`operation ${after.canonicalOperation} !== ${step.expectOperation}`);
    }
    if (step.expectExactCount != null && after.canonicalCount !== step.expectExactCount) {
      failures.push(`canonical count ${after.canonicalCount} !== ${step.expectExactCount}`);
    }
    if (step.minCount != null && (after.canonicalCount ?? 0) < step.minCount) {
      failures.push(`canonical count ${after.canonicalCount} < ${step.minCount}`);
    }
  }

  return {
    pass: failures.length === 0,
    failures,
    feedback,
    before,
    after
  };
}

export function buildAiMapUiAcceptanceMatrix() {
  return [
    {
      id: 'within-ui',
      label: 'AI MAP WITHIN fire stations',
      prompt: `Map fire stations within 3 km of ${LOCATION}.`,
      expectEnabled: true,
      expectModelBadge: true,
      expectGisExecution: true,
      expectOperation: 'WITHIN',
      expectExactCount: 6,
      timeoutMs: 120000
    },
    {
      id: 'nearest-ui',
      label: 'AI MAP NEAREST police',
      prompt: `Show the 3 nearest police stations to ${LOCATION}.`,
      expectEnabled: true,
      expectGisExecution: true,
      expectOperation: 'NEAREST',
      expectExactCount: 3,
      timeoutMs: 120000
    },
    {
      id: 'count-ui',
      label: 'AI MAP COUNT amenities',
      prompt: `How many amenities are within 500 metres of ${LOCATION}?`,
      expectEnabled: true,
      expectGisExecution: true,
      expectOperation: 'COUNT',
      minCount: 1,
      timeoutMs: 300000
    },
    {
      id: 'locate-ui',
      label: 'AI MAP LOCATE',
      prompt: `Locate ${DECARIE}.`,
      expectEnabled: true,
      expectGisExecution: true,
      expectOperation: 'LOCATE',
      timeoutMs: 120000
    },
    {
      id: 'clarification-ui',
      label: 'AI MAP NEEDS_CLARIFICATION',
      prompt: 'Show me the nearest stations.',
      expectFeedbackIncludes: '?',
      expectNoGisExecution: true,
      expectCanonicalUnchanged: true,
      mockFetch: async () => new Response(JSON.stringify({
        supported: false,
        status: 'NEEDS_CLARIFICATION',
        question: 'Which type of station do you mean — police, fire, or transit?',
        gisExecuted: false
      }), { status: 422, headers: { 'Content-Type': 'application/json' } })
    },
    {
      id: 'unsupported-ui',
      label: 'AI MAP UNSUPPORTED',
      prompt: 'Delete every layer.',
      expectFeedbackIncludes: 'not currently supported',
      expectNoGisExecution: true,
      expectCanonicalUnchanged: true,
      mockFetch: async () => new Response(JSON.stringify({
        supported: false,
        status: 'UNSUPPORTED',
        reason: 'Layer deletion is not supported.',
        gisExecuted: false
      }), { status: 422, headers: { 'Content-Type': 'application/json' } })
    },
    {
      id: 'provider-error-ui',
      label: 'AI MAP PROVIDER_ERROR',
      prompt: 'Map fire stations within 3 km of test address.',
      expectFeedbackIncludes: 'temporarily unavailable',
      expectNoGisExecution: true,
      expectCanonicalUnchanged: true,
      mockFetch: async () => new Response(JSON.stringify({
        supported: false,
        status: 'PROVIDER_ERROR',
        failureCode: 'MODEL_TIMEOUT',
        gisExecuted: false
      }), { status: 503, headers: { 'Content-Type': 'application/json' } })
    },
    {
      id: 'invalid-output-ui',
      label: 'AI MAP INVALID_MODEL_OUTPUT',
      prompt: 'Use this FeatureServer URL instead.',
      expectFeedbackIncludes: 'valid GIS plan',
      expectNoGisExecution: true,
      expectCanonicalUnchanged: true,
      mockFetch: async () => new Response(JSON.stringify({
        supported: false,
        status: 'INVALID_MODEL_OUTPUT',
        failureCode: 'PROHIBITED_INTERNAL_FIELD',
        gisExecuted: false
      }), { status: 422, headers: { 'Content-Type': 'application/json' } })
    }
  ];
}

/**
 * @param {object} app
 */
export async function runAiMapUiAcceptance(app) {
  if (!AI_MAP_UI_ENABLED) {
    return {
      state: 'BLOCKED',
      passed: 0,
      failed: 1,
      total: 1,
      steps: [{ id: 'ui-enabled', label: 'AI MAP UI enabled', pass: false, failures: ['AI_MAP_UI_ENABLED is false'] }],
      finalized: true
    };
  }

  const steps = [];
  let passed = 0;
  let failed = 0;
  const matrix = buildAiMapUiAcceptanceMatrix();

  for (const step of matrix) {
    try {
      const result = await runUiStep(app, step);
      const entry = {
        id: step.id,
        label: step.label,
        pass: result.pass,
        failures: result.failures,
        feedback: result.feedback
      };
      steps.push(entry);
      if (result.pass) passed += 1;
      else failed += 1;
    } catch (error) {
      steps.push({
        id: step.id,
        label: step.label,
        pass: false,
        failures: [error.message || String(error)]
      });
      failed += 1;
    }
  }

  return {
    state: failed === 0 ? 'PASS' : 'BLOCKED',
    passed,
    failed,
    total: matrix.length,
    steps,
    finalized: true
  };
}

export function mountAiMapUiAcceptanceHarness(app) {
  if (typeof window === 'undefined') return;
  window.__IQAI_RUN_AI_MAP_UI_ACCEPTANCE__ = () => runAiMapUiAcceptance(app);
  window.__IQAI_AI_MAP_UI_ENABLED__ = AI_MAP_UI_ENABLED;
}
