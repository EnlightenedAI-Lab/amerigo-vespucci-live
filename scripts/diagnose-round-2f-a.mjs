/**
 * Round 2F-A — source vs scoped conversation diagnostic. No production or test changes.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateConversationSequences, SESSION_TEMPLATES, CONTEXT_PRESETS } from '../tests/spatial/language/conversation-generator.js';
import { executeCase, comparePlans } from '../tests/spatial/language/canonical-plan.js';
import { FIXTURE_CATALOG } from '../tests/spatial/language/fixtures/catalog.js';
import { expandConversationInput } from '../public/spatial/spatial-conversation-resolve.js';
import { planLayerAwareClientCommand } from '../public/spatial/layer-aware-wiring.js';
import { interpretSpatialLanguage } from '../src/spatial/spatial-language-interpreter.js';

const catalog = FIXTURE_CATALOG;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outPath = path.join(__dirname, '..', 'artifacts', 'language-conformance', 'round-2f-a-diagnostic.json');

function simulateSequenceState(turns, throughIndex) {
  const state = {
    lastReferencedSourceLayers: [],
    lastScopedResultLayerIds: [],
    lastScopedDatasets: [],
    lastScopedLocation: null,
    lastScopedRadiusKm: null,
    lastLocationText: null,
    lastOperationScope: null,
    lastSpatialOperation: null,
    lastVisibleLayerSet: [],
    lastQueryLayers: [],
    lastResultLayerIds: [],
    lastPrompt: null,
    lastExecutablePrompt: null
  };

  for (let i = 0; i <= throughIndex; i += 1) {
    const turn = turns[i];
    const ctx = { ...state, ...turn.context };

    if (turn.path === 'layer') {
      const plan = planLayerAwareClientCommand(turn.prompt, catalog);
      if (plan.handled && !plan.error) {
        const layers = (plan.layers || (plan.layer ? [plan.layer] : [])).map((l) => ({
          catalogId: l.catalogId,
          title: l.title
        }));
        state.lastReferencedSourceLayers = layers;
        state.lastOperationScope = 'source';
        state.lastPrompt = turn.prompt;
        state.lastExecutablePrompt = turn.prompt;
      }
    } else if (turn.path === 'gis') {
      const result = interpretSpatialLanguage(turn.prompt, { webmapLayerCatalog: catalog });
      if (result.supported) {
        state.lastScopedDatasets = [{ title: 'Cameras' }];
        state.lastScopedResultLayerIds = ['iqai-webmap-cameras-layer', 'iqai-map-result'];
        state.lastScopedLocation = '997 de la Commune';
        state.lastScopedRadiusKm = 3;
        state.lastLocationText = '997 de la Commune';
        state.lastOperationScope = 'scoped';
        state.lastSpatialOperation = 'WITHIN';
        state.lastPrompt = turn.prompt;
        state.lastExecutablePrompt = turn.prompt;
      }
    } else if (turn.path === 'conversation') {
      const expanded = expandConversationInput(turn.prompt, ctx);
      if (expanded.ok) {
        state.lastPrompt = turn.prompt;
        if (expanded.metaAction === 'HIDE_SCOPED_RESULTS') {
          state.lastOperationScope = 'scoped';
        }
        if (expanded.metaAction === 'RESET_MAP') {
          state.lastScopedResultLayerIds = [];
          state.lastScopedDatasets = [];
          state.lastScopedLocation = null;
          state.lastScopedRadiusKm = null;
          state.lastOperationScope = null;
        }
      }
    }
  }
  return state;
}

function classifyFailure(f) {
  const prompt = (f.prompt || '').toLowerCase();
  const expected = f.expected || {};
  const actual = f.actual || {};
  const diff = f.diff || '';

  if (/return to original layers|restore map|start over|reset map/.test(prompt)
    && expected.kind === 'layer_client') {
    return 'TEST_EXPECTATION_ERROR';
  }

  if (expected.kind === 'layer_client' && actual.kind === 'not_handled'
    && /turn off cameras|turn on cameras|hide cameras|show cameras/.test(prompt)) {
    return 'EXPLICIT_SOURCE_OVERRIDE_ERROR';
  }

  if (expected.metaAction === 'HIDE_SCOPED_RESULTS' && actual.metaAction !== 'HIDE_SCOPED_RESULTS') {
    if (/these results|those results|scoped results/.test(prompt)) return 'SOURCE_SCOPED_REFERENT_COLLISION';
    if (/turn them off|hide them/.test(prompt)) return 'PRONOUN_OTHER_FAMILY';
  }

  if (expected.metaAction === 'SHOW_SCOPED_RESULTS' && actual.metaAction !== 'SHOW_SCOPED_RESULTS') {
    return 'RESTORE_HIDE_SEMANTIC_ERROR';
  }

  if (expected.kind === 'meta' && actual.kind === 'layer_client') {
    return 'SOURCE_SCOPED_REFERENT_COLLISION';
  }

  if (expected.kind === 'layer_client' && actual.kind === 'meta') {
    return 'SOURCE_SCOPED_REFERENT_COLLISION';
  }

  if (/them|those|both|it\b/.test(prompt) && expected.kind === 'meta') {
    return 'PRONOUN_OTHER_FAMILY';
  }

  return 'OTHER';
}

function referencePhraseGroup(prompt) {
  const p = (prompt || '').toLowerCase();
  if (/these results|those results|scoped results|the results/.test(p)) return 'these_results';
  if (/remove those from view/.test(p)) return 'those_results';
  if (/turn them|hide them|show them/.test(p)) return 'them';
  if (/those layers|those off|those on|those back/.test(p)) return 'those';
  if (/both/.test(p)) return 'both';
  if (/return to original|reset map|restore map|start over/.test(p)) return 'reset';
  if (/turn off cameras|turn on cameras/.test(p)) return 'explicit_source_name';
  if (/cameras within|show cameras/.test(p)) return 'explicit_dataset_spatial';
  if (/all layers|everything/.test(p)) return 'all_layers';
  if (/back on|back off/.test(p)) return 'back_on_off';
  if (/again/.test(p)) return 'again';
  return 'other';
}

function transitionType(turnIndex, templateName) {
  const map = {
    0: 'SOURCE_OR_META',
    1: 'TO_SCOPED',
    2: 'SCOPED_META',
    3: 'SCOPED_TO_SOURCE_OR_VARIANT'
  };
  return `${templateName}:${map[turnIndex] || 'unknown'}`;
}

function traceScenario(name, turns) {
  const lastIdx = turns.length - 1;
  const state = simulateSequenceState(turns, lastIdx - 1);
  const lastTurn = turns[lastIdx];
  const ctx = { ...state, ...lastTurn.context };

  let actual;
  let raw;
  if (lastTurn.path === 'conversation') {
    raw = expandConversationInput(lastTurn.prompt, ctx);
    actual = raw.ok
      ? { kind: 'meta', metaAction: raw.metaAction, operation: raw.operation, scope: raw.scope }
      : { kind: 'clarification', message: raw.clarification };
  } else if (lastTurn.path === 'layer') {
    raw = planLayerAwareClientCommand(lastTurn.prompt, catalog);
    actual = raw.handled
      ? { kind: 'layer_client', operation: raw.operation, layers: (raw.layers || []).map((l) => l.title) }
      : { kind: 'not_handled', reason: raw.reason };
  } else {
    raw = interpretSpatialLanguage(lastTurn.prompt, { webmapLayerCatalog: catalog });
    actual = raw.supported ? { kind: 'gis' } : { kind: 'clarification' };
  }

  return { name, stateBefore: state, prompt: lastTurn.prompt, path: lastTurn.path, actual, raw };
}

const sequences = generateConversationSequences({ seed: 42, targetSequences: 1200 });
const failures = [];
let passed = 0;

for (const seq of sequences) {
  if (seq.name !== 'source-vs-scoped') continue;
  for (let t = 0; t < seq.turns.length; t += 1) {
    const turn = seq.turns[t];
    const caseDef = {
      id: `${seq.id}-turn`,
      category: 'conversation-source-vs-scoped',
      path: turn.path,
      prompt: turn.prompt,
      context: turn.context,
      expected: turn.expected
    };
    const { actual, raw } = executeCase(caseDef, catalog);
    const cmp = comparePlans(caseDef.expected, actual);
    if (!cmp.equal) {
      const simState = simulateSequenceState(seq.turns, t - 1);
      failures.push({
        ...caseDef,
        turnIndex: t,
        sequenceIndex: seq.seed,
        actual,
        diff: cmp.diff,
        raw,
        stateBefore: simState,
        transition: transitionType(t, seq.name),
        referencePhrase: referencePhraseGroup(turn.prompt),
        rootCause: classifyFailure({ ...caseDef, actual, diff: cmp.diff })
      });
    } else {
      passed += 1;
    }
  }
}

const byRootCause = {};
const byTransition = {};
const byReference = {};
const bySeverity = { HIGH: 0, MEDIUM: 0, LOW: 0 };

for (const f of failures) {
  byRootCause[f.rootCause] = (byRootCause[f.rootCause] || 0) + 1;
  byTransition[f.transition] = (byTransition[f.transition] || 0) + 1;
  byReference[f.referencePhrase] = (byReference[f.referencePhrase] || 0) + 1;

  if (f.rootCause === 'TEST_EXPECTATION_ERROR') bySeverity.LOW += 1;
  else if (f.actual?.kind === 'layer_client' && f.expected?.kind === 'meta') bySeverity.HIGH += 1;
  else if (f.actual?.kind === 'meta' && f.expected?.kind === 'layer_client') bySeverity.MEDIUM += 1;
  else if (f.actual?.kind === 'not_handled') bySeverity.MEDIUM += 1;
  else bySeverity.MEDIUM += 1;
}

const scenarios = {
  A: traceScenario('A', [
    { prompt: 'Turn on Cameras.', path: 'layer' },
    { prompt: 'Show Cameras within 3 km of 997 de la Commune.', path: 'gis' },
    { prompt: 'Hide these results.', path: 'conversation', context: CONTEXT_PRESETS.scoped_cameras }
  ]),
  B: traceScenario('B', [
    { prompt: 'Turn on Cameras.', path: 'layer' },
    { prompt: 'Show Cameras within 3 km of 997 de la Commune.', path: 'gis' },
    { prompt: 'Turn Cameras off.', path: 'layer' }
  ]),
  C: traceScenario('C', [
    { prompt: 'Show Cameras within 3 km of 997 de la Commune.', path: 'gis' },
    { prompt: 'Hide these results.', path: 'conversation', context: CONTEXT_PRESETS.scoped_cameras },
    { prompt: 'Show them again.', path: 'conversation', context: CONTEXT_PRESETS.scoped_cameras }
  ]),
  D: traceScenario('D', [
    { prompt: 'Show Cameras within 3 km of 997 de la Commune.', path: 'gis' },
    { prompt: 'Turn Cameras off.', path: 'layer' },
    { prompt: 'Show them again.', path: 'conversation', context: CONTEXT_PRESETS.scoped_cameras }
  ]),
  E: traceScenario('E', [
    { prompt: 'Show Cameras within 3 km of 997 de la Commune.', path: 'gis' },
    { prompt: 'Make it 5 km.', path: 'conversation', context: CONTEXT_PRESETS.scoped_cameras },
    { prompt: 'Hide these results.', path: 'conversation', context: CONTEXT_PRESETS.scoped_cameras },
    { prompt: 'Turn Cameras on.', path: 'layer' }
  ]),
  F: traceScenario('F', [
    { prompt: 'Show Cameras within 3 km of 997 de la Commune.', path: 'gis' },
    { prompt: 'Reset map.', path: 'conversation', context: CONTEXT_PRESETS.scoped_cameras },
    { prompt: 'Show them again.', path: 'conversation', context: CONTEXT_PRESETS.scoped_cameras }
  ])
};

const report = {
  timestamp: new Date().toISOString(),
  category: 'conversation-source-vs-scoped',
  totalTurns: passed + failures.length,
  passed,
  failed: failures.length,
  byRootCause,
  byTransition,
  byReference,
  bySeverity,
  uniqueFailurePrompts: [...new Set(failures.map((f) => f.prompt))],
  failureSamples: failures.slice(0, 15),
  scenarios,
  generatorNote: {
    variantKeyCycle: ['Turn them off.', 'Turn them back on.', 'Hide these results.', 'Reset map.'],
    sourceVsScopedLastStepExpected: 'layer_client HIDE_LAYER Cameras',
    lastStepVariantWhenIndexMod4Equals3: 'Reset map variants applied to wrong template last step'
  }
};

fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
console.log(JSON.stringify({
  failed: failures.length,
  passed,
  byRootCause,
  byReference,
  uniquePrompts: report.uniqueFailurePrompts,
  scenarios: Object.fromEntries(Object.entries(scenarios).map(([k, v]) => [k, { prompt: v.prompt, actual: v.actual }]))
}, null, 2));
