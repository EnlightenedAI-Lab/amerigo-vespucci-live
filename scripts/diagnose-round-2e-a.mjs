/**
 * Round 2E-A — reversed trailing ON/OFF visibility diagnostic. No production or test changes.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generatePromptCases } from '../tests/spatial/language/prompt-generator.js';
import { generateConversationSequences } from '../tests/spatial/language/conversation-generator.js';
import { executeCase, comparePlans } from '../tests/spatial/language/canonical-plan.js';
import { FIXTURE_CATALOG } from '../tests/spatial/language/fixtures/catalog.js';
import { planLayerAwareClientCommand } from '../public/spatial/layer-aware-wiring.js';
import { planCompoundPrompt } from '../src/spatial/spatial-compound-planner.js';
import { interpretSpatialLanguage } from '../src/spatial/spatial-language-interpreter.js';
import { stripLeadingConversationalFiller } from '../public/spatial/leading-conversational-filler.js';
import { hasExplicitSpatialIntent } from '../public/spatial/spatial-intent-signals.js';
import { collapseDuplicateFillerWords } from '../public/spatial/spatial-conversation-resolve.js';
import { splitVisibilityClauses, parseVisibilityClause, planMixedActionLayerCompound } from '../public/spatial/mixed-action-layer-compound.js';

const catalog = FIXTURE_CATALOG;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outPath = path.join(__dirname, '..', 'artifacts', 'language-conformance', 'round-2e-a-diagnostic.json');

function norm(text) {
  return collapseDuplicateFillerWords(String(text || ''))
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[.?!]+$/g, '')
    .trim();
}

function isTrailingOff(p) {
  const n = norm(p).toLowerCase();
  return /^turn\s+.+\s+off$/i.test(n) && !/^turn off\b/i.test(n);
}

function isTrailingOn(p) {
  const n = norm(p).toLowerCase();
  return /^turn\s+.+\s+on$/i.test(n) && !/^turn on\b/i.test(n) && !/back on$/i.test(n);
}

function trace(prompt) {
  const normalized = stripLeadingConversationalFiller(norm(prompt));
  const spatial = hasExplicitSpatialIntent(normalized);
  const clauses = splitVisibilityClauses(normalized);
  const mixedPlan = planMixedActionLayerCompound(normalized, catalog);
  const mixedSignal = clauses.length > 1 || mixedPlan?.operations?.length || mixedPlan?.error;
  const layerClient = planLayerAwareClientCommand(prompt, catalog);
  const compound = planCompoundPrompt(prompt, { webmapLayerCatalog: catalog });
  const gis = interpretSpatialLanguage(prompt, { webmapLayerCatalog: catalog });

  const offEquiv = normalized.replace(/^turn\s+(.+?)\s+off$/i, 'turn off $1');
  const onEquiv = normalized.replace(/^turn\s+(.+?)\s+on$/i, 'turn on $1');
  const offEquivPlan = planLayerAwareClientCommand(offEquiv, catalog);
  const onEquivPlan = planLayerAwareClientCommand(onEquiv, catalog);

  let firstRouter = 'unsupported';
  if (layerClient.handled) firstRouter = 'layer_client';
  else if (gis.supported) firstRouter = 'gis';
  else if (compound.supported) firstRouter = 'compound';

  const actualPlan = layerClient.handled
    ? {
        kind: layerClient.action === 'LAYER_COMPOUND_CONTROLS' ? 'layer_compound' : 'layer_client',
        action: layerClient.action,
        operation: layerClient.operation,
        layers: (layerClient.layers || []).map((l) => l.title),
        operations: layerClient.operations?.map((op) => ({
          operation: op.operation,
          layers: op.layers.map((l) => l.title)
        }))
      }
    : gis.supported
      ? { kind: 'gis', commands: (gis.plan?.commands || gis.commands || []).map((c) => c.action) }
      : layerClient.error
        ? { kind: 'clarification', message: layerClient.error }
        : { kind: 'not_handled', reason: layerClient.reason };

  return {
    input: prompt,
    normalized,
    spatialIntent: spatial,
    mixedActionSignal: Boolean(mixedSignal),
    clauseCount: clauses.length,
    clauses,
    clauseParses: clauses.map((c) => parseVisibilityClause(c)),
    leadingFillerResult: normalized,
    firstRouter,
    offEquiv,
    onEquiv,
    offEquivMatch: offEquivPlan.handled,
    onEquivMatch: onEquivPlan.handled,
    actualPlan
  };
}

function classifyFailure(f) {
  const pl = f.prompt.toLowerCase();
  const base = (f.basePrompt || f.prompt).toLowerCase();

  if (/them|those layers|those off|both off|both on/i.test(pl)) return 'OTHER_PRONOUN';
  if (/\b(within|inside|around)\s+\d+\s*km/i.test(pl) && f.expected?.kind === 'gis') return 'OTHER_SPATIAL';
  if (/witin|camras|tun\b|\bof$/i.test(pl) && f.category === 'typo-noise') return 'OTHER_TYPO';
  if (/\b(and|,)\b/.test(pl) && /\bon\b/i.test(pl) && /\boff\b/i.test(pl) && !f.category?.includes('multi-layer-hide-reversed')) {
    return 'OTHER_MIXED_ACTION';
  }

  if (isTrailingOff(f.prompt) || (f.basePrompt && isTrailingOff(f.basePrompt))) {
    const n = stripLeadingConversationalFiller(norm(f.prompt));
    const equiv = n.replace(/^turn\s+(.+?)\s+off$/i, 'turn off $1');
    const equivPlan = planLayerAwareClientCommand(equiv, catalog);
    if (f.expected?.kind === 'layer_client' && equivPlan.handled) return 'TRUE_REVERSED_OFF';
    if (f.expected?.kind === 'clarification') return 'GENUINELY_AMBIGUOUS';
    return 'OTHER_LAYER';
  }

  if (isTrailingOn(f.prompt) || (f.basePrompt && isTrailingOn(f.basePrompt))) {
    const n = stripLeadingConversationalFiller(norm(f.prompt));
    const equiv = n.replace(/^turn\s+(.+?)\s+on$/i, 'turn on $1');
    const equivPlan = planLayerAwareClientCommand(equiv, catalog);
    if (f.expected?.kind === 'layer_client' && equivPlan.handled) return 'TRUE_REVERSED_ON';
    if (f.expected?.kind === 'clarification') return 'GENUINELY_AMBIGUOUS';
    return 'OTHER_LAYER';
  }

  return 'OTHER';
}

function countTags(list) {
  const tags = {
    single_layer: 0,
    multi_layer: 0,
    punctuation: 0,
    leading_filler: 0,
    typo_noise: 0,
    mixed_action_candidate: 0,
    pronoun: 0,
    spatial_tail: 0
  };
  for (const f of list) {
    const base = (f.basePrompt || f.prompt).replace(/\s+off$/i, '').replace(/\s+on$/i, '');
    const pl = f.prompt;
    if (/\b(and|,)\b/.test(base)) tags.multi_layer += 1;
    else tags.single_layer += 1;
    if (/[.?!]$/.test(pl)) tags.punctuation += 1;
    if (/^(please|could you|can you|just|for me|now|i want to)\s/i.test(pl)) tags.leading_filler += 1;
    if (f.category === 'typo-noise') tags.typo_noise += 1;
    if (/\b(and|,)\b/.test(pl) && /\bon\b/i.test(pl) && /\boff\b/i.test(pl)) tags.mixed_action_candidate += 1;
    if (/them|those|both/i.test(pl)) tags.pronoun += 1;
    if (/\b(within|around)\s+\d/i.test(pl)) tags.spatial_tail += 1;
  }
  return tags;
}

const promptCases = generatePromptCases({ seed: 42 });
const sequences = generateConversationSequences({ seed: 42, targetSequences: 1200 });

const allCases = [...promptCases];
for (const seq of sequences) {
  for (const turn of seq.turns) {
    allCases.push({
      id: `${seq.id}-turn`,
      seed: seq.seed,
      category: `conversation-${seq.name}`,
      language: seq.language,
      path: turn.path,
      prompt: turn.prompt,
      context: turn.context,
      expected: turn.expected,
      severity: 'medium',
      basePrompt: turn.basePrompt
    });
  }
}

let reversedCategoryTotal = 0;
let reversedCategoryPassed = 0;
const trailingOffCases = [];
const trailingOnCases = [];

for (const c of allCases) {
  if (c.category === 'multi-layer-hide-reversed') {
    reversedCategoryTotal += 1;
    const { actual } = executeCase(c, catalog);
    const cmp = comparePlans(c.expected, actual);
    if (cmp.equal) reversedCategoryPassed += 1;
    else trailingOffCases.push({ ...c, actual, diff: cmp.diff, trailingType: 'OFF' });
  }
  const off = isTrailingOff(c.prompt);
  const on = isTrailingOn(c.prompt);
  if (off && c.category !== 'multi-layer-hide-reversed') {
    const { actual } = executeCase(c, catalog);
    const cmp = comparePlans(c.expected, actual);
    if (!cmp.equal) trailingOffCases.push({ ...c, actual, diff: cmp.diff, trailingType: 'OFF' });
  }
  if (on) {
    trailingOnCases.push(c);
    const { actual } = executeCase(c, catalog);
    const cmp = comparePlans(c.expected, actual);
    if (!cmp.equal) trailingOnCases.push({ ...c, actual, diff: cmp.diff, trailingType: 'ON', failed: true });
  }
}

const offFailures = trailingOffCases;
const onFailureList = trailingOnCases.filter((c) => c.failed);

const offByClass = {};
const onByClass = {};
for (const f of offFailures) {
  const cls = classifyFailure(f);
  offByClass[cls] = (offByClass[cls] || 0) + 1;
}
for (const f of onFailureList) {
  const cls = classifyFailure(f);
  onByClass[cls] = (onByClass[cls] || 0) + 1;
}

const representativePrompts = [
  'turn Cameras off',
  'turn Cameras and EMS off',
  'turn Traffic off',
  'turn Roads and Traffic off',
  'turn Cameras on',
  'turn Cameras and EMS on',
  'turn Traffic on and Cameras off',
  'turn Cameras off and Traffic on',
  'turn Traffic on, Cameras off, and EMS on',
  'turn them off',
  'turn those off',
  'turn both off',
  'turn Cameras on within 3 km of 997 de la Commune',
  'turn Cameras off around this location'
];

const traces = representativePrompts.map((prompt) => {
  const t = trace(prompt);
  let expectedPlan = null;
  if (prompt === 'turn Cameras off') expectedPlan = { operation: 'HIDE_LAYERS', layers: ['Cameras'] };
  if (prompt === 'turn Cameras and EMS off') expectedPlan = { operation: 'HIDE_LAYERS', layers: ['Cameras', 'EMS'] };
  if (prompt === 'turn Traffic off') expectedPlan = { operation: 'HIDE_LAYERS', layers: ['Traffic'] };
  if (prompt === 'turn Roads and Traffic off') expectedPlan = { operation: 'HIDE_LAYERS', layers: ['Roads', 'Traffic'] };
  if (prompt === 'turn Cameras on') expectedPlan = { operation: 'SHOW_LAYERS', layers: ['Cameras'] };
  if (prompt === 'turn Cameras and EMS on') expectedPlan = { operation: 'SHOW_LAYERS', layers: ['Cameras', 'EMS'] };
  return {
  ...t,
  expectedPlan,
  rootCause: classifyFailure({ prompt, expected: expectedPlan ? { kind: 'layer_client' } : { kind: 'clarification' } })
};
});

// Mixed-action trailing analysis
const mixedTrailing = [
  'turn Traffic on and Cameras off',
  'turn Cameras off and Traffic on',
  'turn Traffic on, Cameras off, and EMS on'
].map((prompt) => {
  const t = trace(prompt);
  const clauses = t.clauses;
  const perClause = clauses.map((clause) => {
    const offM = clause.match(/^turn\s+(.+?)\s+off$/i);
    const onM = clause.match(/^turn\s+(.+?)\s+on$/i);
    return {
      clause,
      trailingOff: offM ? { layerPhrase: offM[1], op: 'HIDE' } : null,
      trailingOn: onM ? { layerPhrase: onM[1], op: 'SHOW' } : null,
      leadingParse: parseVisibilityClause(clause)
    };
  });
  return { prompt, perClause, actual: t.actualPlan, mixedSignal: t.mixedActionSignal };
});

const report = {
  timestamp: new Date().toISOString(),
  multiLayerHideReversed: {
    total: reversedCategoryTotal,
    passed: reversedCategoryPassed,
    failed: reversedCategoryTotal - reversedCategoryPassed
  },
  trailingOff: {
    totalFailures: offFailures.length,
    byClass: offByClass,
    tags: countTags(offFailures),
    byCategory: offFailures.reduce((a, f) => {
      a[f.category] = (a[f.category] || 0) + 1;
      return a;
    }, {})
  },
  trailingOn: {
    totalCases: trailingOnCases.filter((c) => !c.failed).length + onFailureList.length,
    totalFailures: onFailureList.length,
    byClass: onByClass,
    tags: countTags(onFailureList)
  },
  trueReversedOff: offByClass.TRUE_REVERSED_OFF || 0,
  trueReversedOn: onByClass.TRUE_REVERSED_ON || 0,
  traces,
  mixedTrailing,
  trailingOnCasesInBenchmark: trailingOnCases.map((c) => ({
    prompt: c.prompt,
    category: c.category,
    expected: c.expected?.kind
  }))
};

fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
console.log(JSON.stringify({
  multiLayerHideReversed: report.multiLayerHideReversed,
  trailingOff: report.trailingOff,
  trailingOn: report.trailingOn,
  trueReversedOff: report.trueReversedOff,
  trueReversedOn: report.trueReversedOn,
  trailingOnBenchmarkCases: report.trailingOnCasesInBenchmark.length
}, null, 2));
