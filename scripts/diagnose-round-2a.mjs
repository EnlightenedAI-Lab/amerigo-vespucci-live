/**
 * Round 2A diagnostic — spatial vs layer routing failures.
 * Does NOT modify production or tests.
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
import { collapseDuplicateFillerWords } from '../public/spatial/spatial-conversation-resolve.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const catalog = FIXTURE_CATALOG;

const SPATIAL_VS_LAYER_DIFF = /WITHIN vs SHOW|SHOW_LAYER.*WITHIN|action: WITHIN vs SHOW/i;

function normalize(text) {
  return collapseDuplicateFillerWords(String(text || ''))
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[.?!]+$/g, '')
    .trim();
}

function classifyFailure(f) {
  const p = f.prompt.toLowerCase();
  if (/around\s+\d+\s*km|within\s+\d+\s*km|radius of|in a radius/.test(p)) {
    return 'TRUE_PRODUCTION';
  }
  if (f.category === 'typo-noise' && /within|inside|nearest|count/.test(p)) {
    return 'TRUE_PRODUCTION';
  }
  if (/turn on .+ around|show .+ around|display .+ around/.test(p)) {
    return 'TRUE_PRODUCTION';
  }
  if (/sharedLocation/i.test(f.diff || '')) {
    return 'TEST_HARNESS';
  }
  if (/turn on cameras$/i.test(p) && !/\d\s*km/.test(p)) {
    return 'AMBIGUOUS_OR_HARNESS';
  }
  return 'REVIEW';
}

function traceRouting(prompt) {
  const normalized = normalize(prompt);
  const layerClient = planLayerAwareClientCommand(prompt, catalog);
  const compound = planCompoundPrompt(prompt, { webmapLayerCatalog: catalog });
  const interpreted = interpretSpatialLanguage(prompt, { webmapLayerCatalog: catalog });
  return {
    input: prompt,
    normalized,
    layerClient: {
      handled: layerClient.handled,
      action: layerClient.action,
      operation: layerClient.operation,
      reason: layerClient.reason
    },
    compoundFirstCommand: compound.supported ? compound.commands?.[0] : compound,
    interpretFirstCommand: interpreted.supported ? interpreted.plan?.commands?.[0] || interpreted.commands?.[0] : interpreted
  };
}

// Collect all failures
const promptCases = generatePromptCases({ seed: 42, targetPrompts: 12000 });
const sequences = generateConversationSequences({ seed: 42, targetSequences: 1200 });
const failures = [];

for (const c of promptCases) {
  const { actual } = executeCase(c, catalog);
  const cmp = comparePlans(c.expected, actual);
  if (!cmp.equal) {
    failures.push({ ...c, actual, diff: cmp.diff });
  }
}
for (const seq of sequences) {
  for (const turn of seq.turns) {
    const c = { ...turn, id: `${seq.id}-turn`, seed: seq.seed, category: `conversation-${seq.name}`, path: turn.path };
    const { actual } = executeCase(c, catalog);
    const cmp = comparePlans(c.expected, actual);
    if (!cmp.equal) failures.push({ ...c, actual, diff: cmp.diff });
  }
}

const familyFailures = failures.filter((f) =>
  SPATIAL_VS_LAYER_DIFF.test(f.diff || '')
  || (f.category === 'typo-noise' && /SHOW_LAYER|SHOW_LAYERS/.test(JSON.stringify(f.actual)))
  || (f.diff && /WITHIN vs SHOW/.test(f.diff))
);

// Also include typo-noise with spatial mismatch
const noiseSpatial = failures.filter((f) =>
  f.category === 'typo-noise'
  && f.actual?.kind === 'gis'
  && f.actual?.commands?.[0]?.action === 'SHOW_LAYER'
  && f.expected?.kind === 'gis'
  && f.expected?.commands?.[0]?.action === 'WITHIN'
);

const examined = [...new Set([...familyFailures, ...noiseSpatial].map((f) => f.id))].map((id) =>
  failures.find((f) => f.id === id)
);

const groups = {
  leadingVerb: {},
  spatialRelation: {},
  layer: {},
  radius: {},
  location: {},
  hasFiller: 0,
  hasCapsNoise: 0,
  hasPunct: 0
};

for (const f of examined) {
  const p = f.prompt;
  const pl = p.toLowerCase();
  const verb = (pl.match(/^(turn on|show me|show|display|enable|let me see|turn on)/) || ['other'])[0];
  groups.leadingVerb[verb] = (groups.leadingVerb[verb] || 0) + 1;
  const rel = (pl.match(/\b(within|inside|around|within a radius of|in a radius of)\b/) || ['none'])[0];
  groups.spatialRelation[rel] = (groups.spatialRelation[rel] || 0) + 1;
  const km = pl.match(/(\d+)\s*km/);
  groups.radius[km ? `${km[1]} km` : 'none'] = (groups.radius[km ? `${km[1]} km` : 'none'] || 0) + 1;
  if (/997|6939|gauchetière|ville marie|décarie/i.test(pl)) {
    const loc = pl.includes('997') ? '997 de la Commune' : pl.includes('6939') ? '6939 Décarie' : 'other fixture';
    groups.location[loc] = (groups.location[loc] || 0) + 1;
  }
  if (/please|can you|just|for me/i.test(pl)) groups.hasFiller += 1;
  if (p !== pl) groups.hasCapsNoise += 1;
  if (/[.?!]$/.test(p)) groups.hasPunct += 1;
  const layerMatch = pl.match(/(cameras|ems|traffic)/);
  if (layerMatch) groups.layer[layerMatch[1]] = (groups.layer[layerMatch[1]] || 0) + 1;
}

const classified = { TRUE_PRODUCTION: [], TEST_HARNESS: [], AMBIGUOUS: [], REVIEW: [] };
for (const f of examined) {
  const c = classifyFailure(f);
  if (c === 'TRUE_PRODUCTION') classified.TRUE_PRODUCTION.push(f);
  else if (c === 'TEST_HARNESS') classified.TEST_HARNESS.push(f);
  else if (c === 'AMBIGUOUS_OR_HARNESS') classified.AMBIGUOUS.push(f);
  else classified.REVIEW.push(f);
}

const traces = [
  'turn on Cameras around 2 km of 997 de la Commune.',
  'show me Cameras within 3 km of 997 de la Commune',
  'Turn on Cameras.',
  'show Cameras',
  'enable EMS around 5 km of 6939 Décarie Boulevard'
].map(traceRouting);

const protectedCases = [
  'Turn on Cameras.',
  'Show Cameras.',
  'Turn on Cameras and EMS.',
  'hide Cameras',
  'disable Cameras'
].map((p) => ({
  prompt: p,
  layerClient: planLayerAwareClientCommand(p, catalog).handled,
  compound: planCompoundPrompt(p, { webmapLayerCatalog: catalog }).commands?.[0]?.action
}));

const report = {
  totalFailures: failures.length,
  familyFailuresExamined: examined.length,
  classified: {
    TRUE_PRODUCTION: classified.TRUE_PRODUCTION.length,
    TEST_HARNESS: classified.TEST_HARNESS.length,
    AMBIGUOUS: classified.AMBIGUOUS.length,
    REVIEW: classified.REVIEW.length
  },
  groups,
  sampleTrueFailures: classified.TRUE_PRODUCTION.slice(0, 8).map((f) => ({
    prompt: f.prompt,
    diff: f.diff,
    actual: f.actual?.commands?.[0]
  })),
  traces,
  protectedCases,
  rootCause: 'SPATIAL_QUERY_PATTERN omits "around"/radius phrases; planLayerCatalogCommands (SHOW_LAYER via turn on/show) runs before parseClause spatial routing in planCompoundPrompt; AppShell also routes planLayerAwareClientCommand before server GIS when layer path matches.'
};

const outDir = path.join(root, 'artifacts', 'language-conformance');
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'round-2a-diagnostic.json'), JSON.stringify(report, null, 2));

console.log(JSON.stringify({
  familyFailuresExamined: examined.length,
  classified: report.classified,
  groups: report.groups,
  traces: report.traces,
  protectedCases: report.protectedCases
}, null, 2));
