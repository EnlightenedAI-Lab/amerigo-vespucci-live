/**
 * Round 2C-A — filler-prefix diagnostic. Does NOT modify production or tests.
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
import { expandConversationInput } from '../public/spatial/spatial-conversation-resolve.js';
import { stripFillerWords, normalizePrompt } from '../src/spatial/spatial-language-pack.js';
import { collapseDuplicateFillerWords } from '../public/spatial/spatial-conversation-resolve.js';

const catalog = FIXTURE_CATALOG;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

const NOISE_FILLERS = ['please', 'can you', 'could you', 'I want to', 'just', 'for me', 'now'];
const FILLER_PATTERNS = [
  { key: 'please', re: /^please\s+/i },
  { key: 'could you', re: /^could you\s+/i },
  { key: 'can you', re: /^can you\s+/i },
  { key: 'would you', re: /^would you\s+/i },
  { key: 'just', re: /^just\s+/i },
  { key: 'I want to', re: /^i want to\s+/i },
  { key: "I'd like to", re: /^i'd like to\s+/i },
  { key: 'let me see', re: /^let me see\s+/i },
  { key: 'show me', re: /^show me\s+/i },
  { key: 'for me', re: /^for me\s+/i },
  { key: 'now', re: /^now\s+/i }
];

function clientNormalize(text) {
  return collapseDuplicateFillerWords(String(text || ''))
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[.?!]+$/g, '')
    .trim();
}

function detectFiller(prompt) {
  const pl = prompt.trim();
  for (const { key, re } of FILLER_PATTERNS) {
    if (re.test(pl)) return key;
  }
  if (/^i want to\s+/i.test(pl)) return 'I want to';
  return 'other';
}

function stripLeadingNoiseFiller(prompt) {
  let p = prompt.trim();
  for (const filler of NOISE_FILLERS.sort((a, b) => b.length - a.length)) {
    const re = new RegExp(`^${filler.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s+`, 'i');
    if (re.test(p)) {
      p = p.replace(re, '').trim();
      break;
    }
  }
  return p.replace(/[.?!]+$/g, '').trim();
}

function underlyingOp(expected) {
  if (expected?.kind === 'gis') {
    const a = expected.commands?.[0]?.action;
    if (['WITHIN', 'NEAREST', 'COUNT'].includes(a)) return 'SPATIAL';
    return a || 'OTHER';
  }
  if (expected?.kind === 'layer_client') {
    const op = expected.operation || '';
    if (op.includes('SHOW')) return op.includes('LAYERS') ? 'SHOW_LAYERS' : 'SHOW_LAYER';
    if (op.includes('HIDE')) return op.includes('LAYERS') ? 'HIDE_LAYERS' : 'HIDE_LAYER';
    if (op.includes('ZOOM')) return 'ZOOM';
    return op || 'OTHER';
  }
  if (expected?.kind === 'meta') return 'CONVERSATION';
  return 'OTHER';
}

function classifyFailure(f) {
  const base = f.basePrompt || f.prompt;
  const strippedNoise = stripLeadingNoiseFiller(f.prompt);
  const strippedPack = stripFillerWords(clientNormalize(f.prompt));

  // Layer path expected not_handled actual
  if (f.path === 'layer' && f.expected?.kind === 'layer_client' && f.actual?.kind === 'not_handled') {
    const basePlan = planLayerAwareClientCommand(base, catalog);
    const strippedPlan = planLayerAwareClientCommand(strippedNoise, catalog);
    if (basePlan.handled && strippedPlan.handled) {
      return { category: 'TRUE_FILLER', stripped: strippedNoise, strippedPack };
    }
    if (basePlan.handled) {
      return { category: 'OTHER', reason: 'base works but strip failed', stripped: strippedNoise };
    }
    return { category: 'OTHER', reason: 'base also fails', stripped: strippedNoise };
  }

  // GIS noise with filler - spatial path
  if (f.path === 'gis' && f.category === 'typo-noise') {
    const hasFiller = detectFiller(f.prompt) !== 'other';
    if (hasFiller) {
      const gisStripped = interpretSpatialLanguage(strippedNoise, { webmapLayerCatalog: catalog });
      const cmp = comparePlans(f.expected, normalizeGisFromInterp(gisStripped));
      if (cmp.equal) return { category: 'TRUE_FILLER_GIS', stripped: strippedNoise };
      if (/them|those|both/.test(f.prompt)) return { category: 'OTHER', reason: 'pronoun' };
      if (/I want to.*(show|turn|let me)/i.test(f.prompt)) return { category: 'AMBIGUOUS', reason: 'double verb' };
      return { category: 'OTHER', reason: 'gis filler complex', stripped: strippedNoise };
    }
  }

  if (f.patternKey === 'NOISE INVARIANCE') {
    return { category: 'OTHER', reason: 'noise non-layer' };
  }
  return { category: 'OTHER', reason: 'not filler family' };
}

function normalizeGisFromInterp(result) {
  if (!result?.supported) return { kind: 'clarification', message: result?.message || result?.clarification };
  const commands = (result.plan?.commands || result.commands || []).map((cmd) => ({
    action: cmd.action,
    layerSource: cmd.layerSource || (cmd.webmapLayer ? 'WEBMAP' : 'VERIFIED'),
    dataset: cmd.webmapLayer?.title || null,
    datasetIds: [...(cmd.datasetIds || [])].sort(),
    webmapCatalogId: cmd.webmapCatalogId || null,
    radiusKm: cmd.distanceKm ?? null,
    location: cmd.location || result.sharedLocation || null
  }));
  return { kind: 'gis', commands, sharedLocation: result.sharedLocation || null };
}

function trace(prompt) {
  const normalized = clientNormalize(prompt);
  const strippedNoise = stripLeadingNoiseFiller(prompt);
  const strippedPack = stripFillerWords(normalized);
  const layerOrig = planLayerAwareClientCommand(prompt, catalog);
  const layerStripped = planLayerAwareClientCommand(strippedNoise, catalog);
  const compoundOrig = planCompoundPrompt(prompt, { webmapLayerCatalog: catalog });
  const compoundStripped = planCompoundPrompt(strippedNoise, { webmapLayerCatalog: catalog });
  const gisOrig = interpretSpatialLanguage(prompt, { webmapLayerCatalog: catalog });
  const gisStripped = interpretSpatialLanguage(strippedNoise, { webmapLayerCatalog: catalog });
  return {
    original: prompt,
    normalized,
    strippedNoise,
    strippedPack,
    layerOrig: { handled: layerOrig.handled, op: layerOrig.operation, action: layerOrig.action },
    layerStripped: { handled: layerStripped.handled, op: layerStripped.operation, action: layerStripped.action },
    compoundOrigAction: compoundOrig.commands?.[0]?.action,
    compoundStrippedAction: compoundStripped.commands?.[0]?.action,
    gisOrigAction: gisOrig.supported ? (gisOrig.plan?.commands?.[0]?.action || gisOrig.commands?.[0]?.action) : 'clarification',
    gisStrippedAction: gisStripped.supported ? (gisStripped.plan?.commands?.[0]?.action || gisStripped.commands?.[0]?.action) : 'clarification'
  };
}

// Collect failures
const promptCases = generatePromptCases({ seed: 42, targetPrompts: 12000 });
const sequences = generateConversationSequences({ seed: 42, targetSequences: 1200 });
const allFailures = [];

for (const c of promptCases) {
  const { actual } = executeCase(c, catalog);
  const cmp = comparePlans(c.expected, actual);
  if (!cmp.equal) {
    allFailures.push({ ...c, actual, diff: cmp.diff, patternKey: inferPatternKey({ ...c, diff: cmp.diff }) });
  }
}
for (const seq of sequences) {
  for (const turn of seq.turns) {
    const c = { ...turn, id: `${seq.id}-turn`, seed: seq.seed, category: `conversation-${seq.name}`, path: turn.path };
    const { actual } = executeCase(c, catalog);
    const cmp = comparePlans(c.expected, actual);
    if (!cmp.equal) allFailures.push({ ...c, actual, diff: cmp.diff, patternKey: inferPatternKey({ ...c, diff: cmp.diff }) });
  }
}

const fillerFamily = allFailures.filter((f) => f.patternKey === 'NOISE INVARIANCE');

const fillerDist = {};
const opDist = {};
const classified = {
  TRUE_FILLER: [],
  TRUE_FILLER_GIS: [],
  OTHER: [],
  TEST_HARNESS: [],
  AMBIGUOUS: []
};

for (const f of fillerFamily) {
  const filler = detectFiller(f.prompt);
  fillerDist[filler] = (fillerDist[filler] || 0) + 1;
  const op = underlyingOp(f.expected);
  opDist[op] = (opDist[op] || 0) + 1;
  const cls = classifyFailure(f);
  classified[cls.category].push({ ...f, ...cls });
}

// Also count layer_client vs not_handled specifically
const layerNotHandled = fillerFamily.filter((f) => f.diff === 'kind layer_client vs not_handled');

const traces = [
  'could you show Cameras',
  'please show Cameras',
  'just disable Cameras',
  'let me see Addresses',
  'can you turn on EMS',
  'could you hide Traffic',
  'could you show Cameras within 3 km of 997 de la Commune',
  'please show EMS around 2 km of 6939 Décarie',
  'can you show the 3 nearest police stations',
  'could you turn them off',
  'please hide those',
  'can you show them again',
  'just reset the map'
].map(trace);

// Safety probes
const safety = [
  'Turn on Cameras.',
  'Show Cameras.',
  'show me Cameras within 3 km of 997 de la Commune',
  'Show the 3 nearest police stations to 997 de la Commune',
  'How many fire stations are within 3 km of 997 de la Commune',
  'please show me Cameras within 3 km of 997 de la Commune'
].map(trace);

const report = {
  totalNoiseInvariance: fillerFamily.length,
  layerNotHandledCount: layerNotHandled.length,
  classifiedCounts: Object.fromEntries(Object.entries(classified).map(([k, v]) => [k, v.length])),
  fillerDist,
  opDist,
  traces,
  safety,
  sampleTrueFiller: classified.TRUE_FILLER.slice(0, 5).map((f) => ({
    prompt: f.prompt,
    base: f.basePrompt,
    stripped: f.stripped,
    diff: f.diff
  }))
};

const outDir = path.join(root, 'artifacts', 'language-conformance');
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'round-2c-a-diagnostic.json'), JSON.stringify(report, null, 2));

console.log(JSON.stringify(report, null, 2));

// Extended breakdown
const layerNH = fillerFamily.filter((f) => f.diff === 'kind layer_client vs not_handled');
const NOISE_FILLERS_LIST = ['please', 'can you', 'could you', 'I want to', 'just', 'for me', 'now'];
function hasLeadingNoiseFiller(p) {
  const pl = p.trim();
  return NOISE_FILLERS_LIST.some((f) => new RegExp(`^${f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s+`, 'i').test(pl));
}
let noFillerPrefix = 0;
let trueFillerNoise = 0;
let trueFillerPack = 0;
let letMeSeeTotal = 0;
let letMeSeePackFix = 0;
for (const f of layerNH) {
  if (/^let me see\s/i.test(f.prompt.trim())) {
    letMeSeeTotal++;
    const pack = stripFillerWords(clientNormalize(f.prompt));
    if (planLayerAwareClientCommand(f.basePrompt, catalog).handled && planLayerAwareClientCommand(pack, catalog).handled) letMeSeePackFix++;
  }
  if (!hasLeadingNoiseFiller(f.prompt) && !/^let me see\s/i.test(f.prompt.trim())) {
    noFillerPrefix++;
    continue;
  }
  const stripped = stripLeadingNoiseFiller(f.prompt);
  const pack = stripFillerWords(clientNormalize(f.prompt));
  const baseH = planLayerAwareClientCommand(f.basePrompt, catalog).handled;
  if (baseH && planLayerAwareClientCommand(stripped, catalog).handled) trueFillerNoise++;
  else if (baseH && planLayerAwareClientCommand(pack, catalog).handled) trueFillerPack++;
}
console.log('EXTENDED', JSON.stringify({ layerNH: layerNH.length, noFillerPrefix, trueFillerNoise, trueFillerPack, letMeSeeTotal, letMeSeePackFix }));

