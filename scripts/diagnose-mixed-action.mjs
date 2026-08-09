/**
 * Mixed-action compound diagnostic — no production changes.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import { generatePromptCases } from '../tests/spatial/language/prompt-generator.js';
import { FIXTURE_CATALOG } from '../tests/spatial/language/fixtures/catalog.js';
import { planLayerAwareClientCommand } from '../public/spatial/layer-aware-wiring.js';
import { planCompoundPrompt } from '../src/spatial/spatial-compound-planner.js';
import { interpretSpatialLanguage } from '../src/spatial/spatial-language-interpreter.js';
import { expandConversationInput } from '../public/spatial/spatial-conversation-resolve.js';
import { stripLeadingConversationalFiller } from '../public/spatial/leading-conversational-filler.js';
import { resolveWebMapLayersFromPhrases, resolveWebMapLayersFromPhrase } from '../public/spatial/webmap-layer-catalog.js';
import { collapseDuplicateFillerWords } from '../public/spatial/spatial-conversation-resolve.js';

const catalog = FIXTURE_CATALOG;

function normalizePrompt(text) {
  return collapseDuplicateFillerWords(String(text || ''))
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[.?!]+$/g, '')
    .trim();
}

function splitOnAnd(phrase) {
  return String(phrase || '')
    .split(/\s*,\s*|\s+and\s+|\s+et\s+/i)
    .map((p) => p.trim())
    .filter(Boolean);
}

function inferVerbFromClause(clause) {
  const c = clause.trim();
  if (/^turn on\s+/i.test(c)) return { op: 'SHOW', verb: 'turn on', layerPhrase: c.replace(/^turn on\s+/i, '') };
  if (/^switch on\s+/i.test(c)) return { op: 'SHOW', verb: 'switch on', layerPhrase: c.replace(/^switch on\s+/i, '') };
  if (/^enable\s+/i.test(c)) return { op: 'SHOW', verb: 'enable', layerPhrase: c.replace(/^enable\s+/i, '') };
  if (/^show\s+/i.test(c)) return { op: 'SHOW', verb: 'show', layerPhrase: c.replace(/^show\s+/i, '') };
  if (/^(?:hide|turn off|disable|switch off)\s+/i.test(c)) {
    const m = c.match(/^(hide|turn off|disable|switch off)\s+(.+)$/i);
    return { op: 'HIDE', verb: m[1], layerPhrase: m[2] };
  }
  if (/^turn\s+(.+?)\s+on$/i.test(c)) return { op: 'SHOW', verb: 'turn X on', layerPhrase: c.match(/^turn\s+(.+?)\s+on$/i)[1] };
  if (/^turn\s+(.+?)\s+off$/i.test(c)) {
    const m = c.match(/^turn\s+(.+?)\s+off$/i);
    return { op: 'HIDE', verb: 'turn X off', layerPhrase: m[1] };
  }
  return { op: 'UNKNOWN', verb: null, layerPhrase: c };
}

function traceMixedAction(prompt) {
  const normalized = stripLeadingConversationalFiller(normalizePrompt(prompt));
  const clauses = splitOnAnd(normalized);
  const clauseAnalysis = clauses.map((clause) => {
    const verb = inferVerbFromClause(clause);
    const layers = resolveWebMapLayersFromPhrase(verb.layerPhrase, catalog);
    return { clause, verb, layers: layers.matches.map((m) => m.title) };
  });

  const layerClient = planLayerAwareClientCommand(prompt, catalog);
  const compound = planCompoundPrompt(prompt, { webmapLayerCatalog: catalog });
  const gis = interpretSpatialLanguage(prompt, { webmapLayerCatalog: catalog });
  const expanded = expandConversationInput(prompt, {});

  const phraseSplit = splitOnAnd(normalized);
  const naiveMultiResolve = resolveWebMapLayersFromPhrases(normalized, catalog);

  return {
    input: prompt,
    normalized,
    clauseSegmentation: clauses,
    clauseAnalysis,
    naivePhraseSplit: phraseSplit,
    naiveMultiResolve: naiveMultiResolve.matches?.map((m) => m.title) || naiveMultiResolve.error,
    layerClient: {
      handled: layerClient.handled,
      operation: layerClient.operation,
      layers: (layerClient.layers || []).map((l) => l.title),
      action: layerClient.action
    },
    compound: compound.supported ? {
      commands: compound.commands?.map((c) => ({ action: c.action, layer: c.webmapLayer?.title }))
    } : { supported: false, message: compound.message || compound.clarification },
    gis: gis.supported ? {
      commands: (gis.plan?.commands || gis.commands || []).map((c) => ({
        action: c.action,
        layer: c.webmapLayer?.title
      }))
    } : { supported: false, message: gis.message || gis.clarification },
    expanded: expanded.ok ? { metaAction: expanded.metaAction, prompt: expanded.prompt } : expanded
  };
}

const variants = [
  'switch on traffic and turn off cameras',
  'turn on Traffic and turn off Cameras',
  'turn off Cameras and turn on Traffic',
  'show Traffic and hide Cameras',
  'hide Cameras and show Traffic',
  'enable Traffic and disable Cameras',
  'disable Cameras and enable Traffic',
  'turn Traffic on and Cameras off',
  'turn Cameras off and Traffic on',
  'show Traffic, hide Cameras, and show EMS'
];

const results = variants.map((v) => {
  const t = traceMixedAction(v);
  const lc = t.layerClient;
  const expected = analyzeExpected(v);
  const actualOp = lc.handled ? lc.operation : null;
  const actualLayers = lc.layers || [];
  const opposite = isOppositeExecution(t, expected);
  return {
    prompt: v,
    expected,
    actual: { operation: actualOp, layers: actualLayers },
    correct: lc.handled && matchesExpected(lc, expected),
    opposite,
    trace: t
  };
});

function analyzeExpected(prompt) {
  const normalized = stripLeadingConversationalFiller(normalizePrompt(prompt));
  const clauses = splitOnAnd(normalized);
  return clauses.map((c) => inferVerbFromClause(c));
}

function matchesExpected(lc, expected) {
  if (!lc.handled || !expected.length) return false;
  // single operation can't match mixed expected
  if (expected.length > 1) {
    const singleOp = lc.operation?.includes('SHOW') ? 'SHOW' : lc.operation?.includes('HIDE') ? 'HIDE' : null;
    const expectedOps = expected.map((e) => e.op);
    const allSame = expectedOps.every((o) => o === expectedOps[0]);
    if (!allSame && singleOp) return false;
  }
  return true;
}

function isOppositeExecution(trace, expected) {
  const lc = trace.layerClient;
  if (!lc.handled) return false;
  const op = lc.operation || '';
  const isShow = op.includes('SHOW');
  const isHide = op.includes('HIDE');
  if (expected.length < 2) return false;
  const hideExpected = expected.filter((e) => e.op === 'HIDE');
  const showExpected = expected.filter((e) => e.op === 'SHOW');
  if (isShow && hideExpected.length > 0) {
    const hideLayers = hideExpected.flatMap((e) => resolveWebMapLayersFromPhrase(e.layerPhrase, catalog).matches.map((m) => m.title));
    const shown = lc.layers || [];
    return hideLayers.some((l) => shown.includes(l));
  }
  if (isHide && showExpected.length > 0) {
    const showLayers = showExpected.flatMap((e) => resolveWebMapLayersFromPhrase(e.layerPhrase, catalog).matches.map((m) => m.title));
    const hidden = lc.layers || [];
    return showLayers.some((l) => hidden.includes(l));
  }
  return false;
}

// Benchmark coverage
const cases = generatePromptCases({ seed: 42, targetPrompts: 12000 });
let mixedInBenchmark = 0;
for (const c of cases) {
  const p = c.prompt.toLowerCase();
  if (c.path === 'layer' && /\band\b/.test(p)) {
    const hasShow = /\b(show|turn on|enable|display|let me see|switch on)\b/.test(p);
    const hasHide = /\b(hide|turn off|disable|switch off)\b/.test(p);
    if (hasShow && hasHide) mixedInBenchmark++;
  }
}

const report = {
  realFailure: results[0],
  variantSummary: results.map((r) => ({
    prompt: r.prompt,
    correct: r.correct,
    opposite: r.opposite,
    actual: r.actual,
    expectedOps: r.expected.map((e) => `${e.op} ${e.layerPhrase}`)
  })),
  oppositeCount: results.filter((r) => r.opposite).length,
  benchmarkMixedActionCount: mixedInBenchmark
};

const out = path.join(path.dirname(fileURLToPath(import.meta.url)), '../artifacts/language-conformance/mixed-action-diagnostic.json');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
