/**
 * Round 2D-A — show-verb alias diagnostic. No production or test changes.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import { generatePromptCases } from '../tests/spatial/language/prompt-generator.js';
import { generateConversationSequences } from '../tests/spatial/language/conversation-generator.js';
import { executeCase, comparePlans } from '../tests/spatial/language/canonical-plan.js';
import { FIXTURE_CATALOG } from '../tests/spatial/language/fixtures/catalog.js';
import { inferPatternKey } from '../tests/spatial/language/report.js';
import { planLayerAwareClientCommand } from '../public/spatial/layer-aware-wiring.js';
import { planCompoundPrompt } from '../src/spatial/spatial-compound-planner.js';
import { interpretSpatialLanguage } from '../src/spatial/spatial-language-interpreter.js';
import { stripLeadingConversationalFiller } from '../public/spatial/leading-conversational-filler.js';
import { hasExplicitSpatialIntent } from '../public/spatial/spatial-intent-signals.js';
import { collapseDuplicateFillerWords } from '../public/spatial/spatial-conversation-resolve.js';
import { splitVisibilityClauses, parseVisibilityClause, planMixedActionLayerCompound } from '../public/spatial/mixed-action-layer-compound.js';

const catalog = FIXTURE_CATALOG;
const VERB_PATTERNS = {
  display: /\bdisplay\b/i,
  enable: /\benable\b/i,
  letMeSee: /\blet me see\b/i
};

function norm(text) {
  return collapseDuplicateFillerWords(String(text || ''))
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[.?!]+$/g, '')
    .trim();
}

function detectVerbFamily(prompt, basePrompt) {
  const sources = [prompt, basePrompt || ''].map((s) => s.toLowerCase());
  for (const s of sources) {
    if (VERB_PATTERNS.letMeSee.test(s)) return 'let me see';
    if (VERB_PATTERNS.display.test(s)) return 'display';
    if (VERB_PATTERNS.enable.test(s)) return 'enable';
  }
  return null;
}

function isTrueAliasCandidate(f) {
  const base = (f.basePrompt || f.prompt).toLowerCase();
  const verb = detectVerbFamily(f.prompt, f.basePrompt);
  if (!verb) return false;
  if (f.path !== 'layer' || f.expected?.kind !== 'layer_client') return false;
  if (!/^(display|enable|let me see)\s+/i.test(base)) return false;
  const stripped = stripLeadingConversationalFiller(norm(f.prompt));
  const showEquiv = stripped.replace(/^(display|enable|let me see)\s+/i, 'show ');
  const baseShow = base.replace(/^(display|enable|let me see)\s+/i, 'show ');
  const showPlan = planLayerAwareClientCommand(baseShow, catalog);
  if (!showPlan.handled) return false;
  const aliasPlan = planLayerAwareClientCommand(stripped.replace(/^(display|enable|let me see)\s+/i, `${verb} `), catalog);
  // true alias if replacing with show works on base
  return showPlan.handled && !aliasPlan.handled;
}

function classifyFailure(f) {
  const verb = detectVerbFamily(f.prompt, f.basePrompt);
  const base = (f.basePrompt || '').toLowerCase();
  const pl = f.prompt.toLowerCase();

  if (/them|those|both|it again/i.test(pl)) return 'OTHER_PRONOUN';
  if (/\b(within|inside|around)\s+\d+\s*km/i.test(pl) && f.path === 'gis') return 'OTHER_SPATIAL_GIS';
  if (/\b(within|inside|around)\s+\d+\s*km/i.test(pl) && f.expected?.kind === 'gis') return 'OTHER_SPATIAL_EXPECTED';
  if (/witin|camras|shw|tun\b/i.test(pl)) return 'OTHER_TYPO';
  if (isTrueAliasCandidate(f)) return 'TRUE_ALIAS';

  if (f.path === 'layer' && f.expected?.kind === 'layer_client' && /^(display|enable|let me see)/i.test(base)) {
    const showBase = base.replace(/^(display|enable|let me see)\s+/i, 'show ');
    if (planLayerAwareClientCommand(showBase, catalog).handled) return 'TRUE_ALIAS';
    return 'OTHER_LAYER';
  }

  if (f.diff === 'kind gis vs clarification' && /i want to.*(display|enable|let me see)/i.test(pl)) return 'AMBIGUOUS_DOUBLE_VERB';
  if (verb && f.category === 'typo-noise' && !/^(display|enable|let me see)/i.test(base)) return 'OTHER_TYPO_BASE';

  return 'OTHER';
}

function subgroup(f) {
  const pl = f.prompt;
  const base = f.basePrompt || f.prompt;
  const tags = [];
  if (/\b(and|,)\b/.test(base) && !/\b(within|around)\b/i.test(base)) tags.push('multi_layer');
  else tags.push('single_layer');
  if (pl !== pl.toLowerCase() || pl !== base) tags.push('caps_or_variant');
  if (/[.?!]$/.test(pl)) tags.push('punct');
  if (/^(please|could you|can you|just|for me|now|i want to)\s/i.test(pl)) tags.push('leading_filler');
  if (/\b(within|inside|around)\s+\d+\s*km/i.test(pl)) tags.push('spatial_tail');
  if (f.category === 'typo-noise') tags.push('typo_noise');
  if (/\b(and|,)\b/.test(pl) && /(hide|turn off|disable|switch off)/i.test(pl) && /(display|enable|let me see|show|turn on)/i.test(pl)) tags.push('mixed_action_candidate');
  if (/them|those|both/i.test(pl)) tags.push('pronoun');
  return tags;
}

function trace(prompt) {
  const normalized = stripLeadingConversationalFiller(norm(prompt));
  const fillerResult = stripLeadingConversationalFiller(norm(prompt));
  const spatial = hasExplicitSpatialIntent(normalized);
  const clauses = splitVisibilityClauses(normalized);
  const mixedSignal = clauses.length > 1 || planMixedActionLayerCompound(normalized, catalog)?.operations?.length;
  const layerClient = planLayerAwareClientCommand(prompt, catalog);
  const compound = planCompoundPrompt(prompt, { webmapLayerCatalog: catalog });
  const gis = interpretSpatialLanguage(prompt, { webmapLayerCatalog: catalog });

  const showEquiv = normalized.replace(/^(display|enable|let me see)\s+/i, 'show ');
  const showPlan = planLayerAwareClientCommand(showEquiv, catalog);

  return {
    input: prompt,
    normalized,
    leadingFillerResult: fillerResult,
    spatialSignal: spatial,
    mixedActionSignal: Boolean(mixedSignal),
    clauseCount: clauses.length,
    firstRouter: layerClient.handled ? 'layer_client' : (gis.supported ? 'gis' : 'unsupported'),
    layerMatch: layerClient.handled,
    showEquivHandled: showPlan.handled,
    showEquivOp: showPlan.operation || showPlan.action,
    actual: layerClient.handled
      ? { action: layerClient.action, operation: layerClient.operation, layers: (layerClient.layers || []).map((l) => l.title) }
      : layerClient.error
        ? { clarification: layerClient.error }
        : { not_handled: true },
    compoundAction: compound.commands?.[0]?.action,
    gisAction: gis.supported ? (gis.plan?.commands?.[0]?.action || gis.commands?.[0]?.action) : 'clarification'
  };
}

const promptCases = generatePromptCases({ seed: 42, targetPrompts: 12000 });
const sequences = generateConversationSequences({ seed: 42, targetSequences: 1200 });
const allFailures = [];

for (const c of promptCases) {
  const { actual } = executeCase(c, catalog);
  const cmp = comparePlans(c.expected, actual);
  if (!cmp.equal) allFailures.push({ ...c, actual, diff: cmp.diff, patternKey: inferPatternKey({ ...c, diff: cmp.diff }) });
}
for (const seq of sequences) {
  for (const turn of seq.turns) {
    const c = { ...turn, id: `${seq.id}-turn`, seed: seq.seed, category: `conversation-${seq.name}`, path: turn.path };
    const { actual } = executeCase(c, catalog);
    const cmp = comparePlans(c.expected, actual);
    if (!cmp.equal) allFailures.push({ ...c, actual, diff: cmp.diff, patternKey: inferPatternKey({ ...c, diff: cmp.diff }) });
  }
}

const targetFailures = allFailures.filter((f) => detectVerbFamily(f.prompt, f.basePrompt));

// Also count all cases (pass+fail) with these verbs in base for context
let totalDisplayCases = 0, totalEnableCases = 0, totalLmsCases = 0;
for (const c of promptCases) {
  const v = detectVerbFamily(c.prompt, c.basePrompt);
  if (v === 'display') totalDisplayCases++;
  if (v === 'enable') totalEnableCases++;
  if (v === 'let me see') totalLmsCases++;
}

const byVerb = { display: [], enable: [], 'let me see': [] };
for (const f of targetFailures) {
  const v = detectVerbFamily(f.prompt, f.basePrompt);
  if (v) byVerb[v].push(f);
}

function summarizeVerb(failures, verb) {
  const classified = { TRUE_ALIAS: 0, OTHER_TYPO: 0, OTHER_PRONOUN: 0, OTHER_SPATIAL_GIS: 0, OTHER_SPATIAL_EXPECTED: 0, OTHER_LAYER: 0, AMBIGUOUS_DOUBLE_VERB: 0, OTHER: 0, OTHER_TYPO_BASE: 0 };
  const subgroups = {};
  for (const f of failures) {
    const c = classifyFailure(f);
    classified[c] = (classified[c] || 0) + 1;
    for (const tag of subgroup(f)) {
      subgroups[tag] = (subgroups[tag] || 0) + 1;
    }
  }
  return { total: failures.length, classified, subgroups };
}

const displaySum = summarizeVerb(byVerb.display, 'display');
const enableSum = summarizeVerb(byVerb.enable, 'enable');
const lmsSum = summarizeVerb(byVerb['let me see'], 'let me see');

// Spatial interaction probes
const spatialProbes = [
  'display Cameras within 3 km of 997 de la Commune',
  'enable Cameras around 2 km of 6939 Décarie Boulevard',
  'let me see Cameras within 5 km of 997 de la Commune'
].map(trace);

// Mixed-action probes (simulated - no production change)
const mixedProbes = [
  'display Traffic and hide Cameras',
  'enable Traffic and turn off Cameras',
  'show Traffic and disable Cameras',
  'let me see Traffic and hide Cameras'
].map((p) => {
  const t = trace(p);
  const normalized = t.normalized;
  const withDisplay = normalized.replace(/^show\s+/i, 'display ');
  const withEnable = normalized.replace(/^show\s+/i, 'enable ');
  const withLms = normalized.replace(/^show\s+/i, 'let me see ');
  return {
    input: p,
    current: t.actual,
    ifDisplayAlias: planLayerAwareClientCommand(withDisplay.replace(/show Traffic/, 'display Traffic').replace(/^show/, 'display'), catalog),
    simulated: {
      display: planLayerAwareClientCommand(p.replace(/^show/, 'display').replace(/^turn on/, 'enable'), catalog),
      note: 'show-based mixed works today',
      showMixed: planLayerAwareClientCommand(p, catalog)
    }
  };
});

// Filler probes
const fillerProbes = [
  'please display Cameras',
  'could you enable EMS',
  'can you display Traffic',
  'please let me see Addresses'
].map((p) => {
  const stripped = stripLeadingConversationalFiller(norm(p));
  return {
    input: p,
    afterFiller: stripped,
    showEquiv: stripped.replace(/^(display|enable|let me see)\s+/i, 'show '),
    showHandled: planLayerAwareClientCommand(stripped.replace(/^(display|enable|let me see)\s+/i, 'show '), catalog).handled
  };
});

const traces = [
  'display Cameras',
  'display Cameras and EMS',
  'enable Traffic',
  'enable Cameras and EMS',
  'let me see Addresses',
  'let me see Cameras',
  'display Cameras within 3 km of 997 de la Commune',
  'please display Cameras',
  'display Traffic and hide Cameras',
  'DISPLAY EMS.'
].map(trace);

// Count true alias across ALL noise failures for display/enable/lms bases
let trueAliasTotal = 0;
const layerNH = [];
for (const c of promptCases) {
  const { actual } = executeCase(c, catalog);
  const cmp = comparePlans(c.expected, actual);
  if (!cmp.equal && cmp.diff === 'kind layer_client vs not_handled') layerNH.push({ ...c, diff: cmp.diff });
}
for (const f of layerNH) {
  if (classifyFailure(f) === 'TRUE_ALIAS') trueAliasTotal++;
}

const report = {
  totalTargetFailuresExamined: targetFailures.length,
  totalCasesInGenerator: { display: totalDisplayCases, enable: totalEnableCases, letMeSee: totalLmsCases },
  display: displaySum,
  enable: enableSum,
  letMeSee: lmsSum,
  trueAliasTotalFromLayerNH: trueAliasTotal,
  spatialProbes,
  mixedProbes,
  fillerProbes,
  traces
};

const out = path.join(path.dirname(fileURLToPath(import.meta.url)), '../artifacts/language-conformance/round-2d-a-diagnostic.json');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
