/**
 * Full NOISE INVARIANCE / spatial-vs-layer family breakdown.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generatePromptCases } from '../tests/spatial/language/prompt-generator.js';
import { generateConversationSequences } from '../tests/spatial/language/conversation-generator.js';
import { executeCase, comparePlans } from '../tests/spatial/language/canonical-plan.js';
import { FIXTURE_CATALOG } from '../tests/spatial/language/fixtures/catalog.js';
import { inferPatternKey } from '../tests/spatial/language/report.js';
import { planLayerAwareClientCommand } from '../public/spatial/layer-aware-wiring.js';
import { planCompoundPrompt } from '../src/spatial/spatial-compound-planner.js';
import { collapseDuplicateFillerWords } from '../public/spatial/spatial-conversation-resolve.js';

const catalog = FIXTURE_CATALOG;

function normalize(text) {
  return collapseDuplicateFillerWords(String(text || ''))
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[.?!]+$/g, '')
    .trim();
}

const promptCases = generatePromptCases({ seed: 42, targetPrompts: 12000 });
const sequences = generateConversationSequences({ seed: 42, targetSequences: 1200 });
const failures = [];

for (const c of promptCases) {
  const { actual } = executeCase(c, catalog);
  const cmp = comparePlans(c.expected, actual);
  if (!cmp.equal) failures.push({ ...c, actual, diff: cmp.diff, patternKey: inferPatternKey({ ...c, diff: cmp.diff }) });
}
for (const seq of sequences) {
  for (const turn of seq.turns) {
    const c = { ...turn, id: `${seq.id}-turn`, seed: seq.seed, category: `conversation-${seq.name}`, path: turn.path };
    const { actual } = executeCase(c, catalog);
    const cmp = comparePlans(c.expected, actual);
    if (!cmp.equal) failures.push({ ...c, actual, diff: cmp.diff, patternKey: inferPatternKey({ ...c, diff: cmp.diff }) });
  }
}

const noiseFailures = failures.filter((f) => f.patternKey === 'NOISE INVARIANCE');
const diffBuckets = {};
for (const f of noiseFailures) {
  diffBuckets[f.diff] = (diffBuckets[f.diff] || 0) + 1;
}

const spatialVsLayer = noiseFailures.filter((f) =>
  f.diff?.includes('WITHIN vs SHOW') || f.diff?.includes('SHOW_LAYER')
);

const baseCategory = {};
for (const f of noiseFailures) {
  const base = f.basePrompt || f.prompt;
  baseCategory[base] = (baseCategory[base] || 0) + 1;
}

// Group spatial-vs-layer failures
const groups = {
  leadingVerb: {},
  spatialRelation: {},
  layer: {},
  radius: {},
  location: {},
  noiseCaps: 0,
  noisePunct: 0,
  noiseFiller: 0,
  noiseTypo: 0,
  noiseDupFiller: 0,
  baseFromSpatialWithin: 0,
  baseFromMultiShow: 0,
  baseFromMultiHide: 0
};

for (const f of spatialVsLayer) {
  const p = f.prompt;
  const pl = p.toLowerCase();
  const base = (f.basePrompt || '').toLowerCase();
  if (base.includes('within') || base.includes('around') || base.includes('inside')) groups.baseFromSpatialWithin += 1;
  if (/^show |^turn on |^display |^enable /.test(base) && !/\d\s*km/.test(base)) groups.baseFromMultiShow += 1;
  if (/hide|turn off|disable/.test(base)) groups.baseFromMultiHide += 1;

  const verbMatch = pl.match(/^(please |can you |could you |just |for me |i want to )?(turn on|show me|show|display|enable|let me see)/);
  groups.leadingVerb[verbMatch ? verbMatch[2] || verbMatch[1] : 'other'] = (groups.leadingVerb[verbMatch ? verbMatch[2] || verbMatch[1] : 'other'] || 0) + 1;
  const rel = (pl.match(/\b(within|inside|around|within a radius of|in a radius of)\b/) || ['none'])[0];
  groups.spatialRelation[rel] = (groups.spatialRelation[rel] || 0) + 1;
  const km = pl.match(/(\d+)\s*km/);
  groups.radius[km ? `${km[1]} km` : 'none'] = (groups.radius[km ? `${km[1]} km` : 'none'] || 0) + 1;
  if (/camras|witin|nerest|shw|tun|polce|hospitls/.test(pl)) groups.noiseTypo += 1;
  if (/to to|the the|off off/.test(pl)) groups.noiseDupFiller += 1;
  if (/please|can you|just|for me/i.test(pl)) groups.noiseFiller += 1;
  if (p !== f.basePrompt && /[A-Z]/.test(p)) groups.noiseCaps += 1;
  if (/[.?!]$/.test(p)) groups.noisePunct += 1;
  const layerMatch = pl.match(/\b(cameras|ems|traffic)\b/);
  if (layerMatch) groups.layer[layerMatch[1]] = (groups.layer[layerMatch[1]] || 0) + 1;
}

// Classify spatial-vs-layer
function classify(f) {
  const pl = f.prompt.toLowerCase();
  const base = (f.basePrompt || '').toLowerCase();
  // spatial-within base with around/in a radius - production failure when SHOW instead of WITHIN
  if (f.diff?.includes('WITHIN vs SHOW')) {
    if (/\baround\b|\bin a radius of\b|\bwithin a radius of\b/.test(pl) && /\d\s*km/.test(pl)) return 'TRUE_PRODUCTION';
    if (/\bwithin\b/.test(pl) && /\d\s*km/.test(pl) && /show me/.test(pl)) return 'TRUE_PRODUCTION'; // show me doesn't match turn on/show regex in layer catalog
    return 'REVIEW';
  }
  // multi-layer show/hide noise - layer path expected
  if (f.path === 'layer' || f.expected?.kind === 'layer_client') return 'TRUE_PRODUCTION_LAYER_NOISE';
  if (f.diff?.includes('HIDE') || f.diff?.includes('SHOW_LAYER')) return 'REVIEW';
  return 'AMBIGUOUS';
}

const classified = { TRUE_PRODUCTION: [], TRUE_PRODUCTION_LAYER_NOISE: [], TEST_HARNESS: [], AMBIGUOUS: [], REVIEW: [] };
for (const f of noiseFailures) {
  const c = classify(f);
  classified[c].push(f);
}

// Trace samples
const samples = [
  'turn on Cameras around 2 km of 997 de la Commune.',
  'SHOW CAMERAS AROUND 6 KM OF 6939 DÉCARIE BOULEVARD',
  'turn on Cameras in a radius of 4 km of Ville-Marie',
  'display Traffic around 1 km of Gauchetière',
  'show me Cameras within 3 km of 997 de la Commune'
].map((prompt) => {
  const normalized = normalize(prompt);
  const layerClient = planLayerAwareClientCommand(prompt, catalog);
  const compound = planCompoundPrompt(prompt, { webmapLayerCatalog: catalog });
  return {
    input: prompt,
    normalized,
    spatialQueryPatternBlocksLayer: /\b(within|inside|nearest|closest|how many|count|number of)\b/i.test(normalized),
    layerClientHandled: layerClient.handled,
    layerClientOp: layerClient.operation,
    compoundAction: compound.commands?.[0]?.action,
    compoundLocation: compound.commands?.[0]?.location,
    compoundRadius: compound.commands?.[0]?.distanceKm
  };
});

console.log(JSON.stringify({
  totalNoiseFailures: noiseFailures.length,
  spatialVsLayerWithinShow: spatialVsLayer.filter((f) => f.diff?.includes('WITHIN vs SHOW')).length,
  diffBuckets,
  classifiedCounts: Object.fromEntries(Object.entries(classified).map(([k, v]) => [k, v.length])),
  groups,
  samples,
  typoNoiseNonSpatial: classified.TRUE_PRODUCTION_LAYER_NOISE.slice(0, 3).map((f) => ({ prompt: f.prompt, diff: f.diff, base: f.basePrompt }))
}, null, 2));
