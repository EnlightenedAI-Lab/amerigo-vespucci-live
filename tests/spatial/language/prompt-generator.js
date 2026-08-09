import { DATASET_IDS } from '../../../src/spatial/dataset-registry.js';
import { FIXTURE_CATALOG, FIXTURE_LOCATIONS, FIXTURE_LAYER_TITLES } from './fixtures/catalog.js';
import { createRng, pick, pickN, shuffle } from './seeded-rng.js';
import { generateNoiseVariants } from './noise.js';

const SHOW_VERBS = ['show', 'show me', 'display', 'turn on', 'enable', 'let me see'];
const HIDE_VERBS = ['hide', 'turn off', 'switch off', 'disable', 'remove from view'];
const ZOOM_VERBS = ['zoom to', 'focus on', 'frame', 'take me to'];
const WITHIN_PHRASES = ['within', 'inside', 'around', 'within a radius of', 'in a radius of'];
const NEAREST_PHRASES = ['nearest', 'closest', 'closest to', 'nearest to'];
const COUNT_PHRASES = ['count', 'how many', 'number of'];

const RADII_KM = [1, 2, 3, 4, 5, 6];
const NEAREST_LIMITS = [1, 2, 3, 5, 10];

function joinLayers(layers, rng) {
  if (layers.length === 1) return layers[0];
  const conj = rng() < 0.5 ? ' and ' : ', ';
  return layers.join(conj);
}

function makeId(seed, category, index) {
  return `${category}-${seed}-${index}`;
}

/**
 * Generate individual prompt conformance cases.
 * @param {object} options
 */
export function generatePromptCases(options = {}) {
  const seed = options.seed ?? 42;
  const rng = createRng(seed);
  const catalog = options.catalog || FIXTURE_CATALOG;
  const cases = [];
  let index = 0;

  const push = (category, prompt, expected, path = 'gis', context = null, severity = 'medium', language = 'en') => {
    cases.push({
      id: makeId(seed, category, index),
      seed,
      category,
      language,
      path,
      prompt,
      context,
      expected,
      severity,
      basePrompt: prompt
    });
    index += 1;
  };

  // GIS WITHIN — WebMap layers
  for (const layer of ['Cameras', 'EMS', 'Traffic']) {
    for (const loc of FIXTURE_LOCATIONS) {
      for (const km of RADII_KM) {
        for (const within of WITHIN_PHRASES.slice(0, 3)) {
          const verb = pick(rng, SHOW_VERBS);
          const prompt = `${verb} ${layer} ${within} ${km} km of ${loc}`;
          push('spatial-within-webmap', prompt, {
            kind: 'gis',
            commands: [{
              action: 'WITHIN',
              layerSource: 'WEBMAP',
              dataset: layer,
              radiusKm: km,
              location: loc
            }],
            sharedLocation: loc
          });
        }
      }
    }
  }

  // GIS NEAREST / COUNT — verified datasets
  const verified = [
    { label: 'police stations', id: DATASET_IDS.POLICE_STATIONS },
    { label: 'fire stations', id: DATASET_IDS.FIRE_STATIONS },
    { label: 'hospitals', id: DATASET_IDS.HOSPITALS },
    { label: 'schools', id: DATASET_IDS.SCHOOLS }
  ];
  for (const ds of verified) {
    for (const loc of FIXTURE_LOCATIONS) {
      for (const n of NEAREST_LIMITS) {
        const prompt = `Show the ${n} ${NEAREST_PHRASES[0]} ${ds.label} to ${loc}`;
        push('spatial-nearest', prompt, {
          kind: 'gis',
          commands: [{
            action: 'NEAREST',
            layerSource: 'VERIFIED',
            datasetIds: [ds.id],
            limit: n,
            location: loc
          }],
          sharedLocation: loc
        });
      }
      for (const km of RADII_KM) {
        const prompt = `${COUNT_PHRASES[1]} ${ds.label} are ${WITHIN_PHRASES[0]} ${km} km of ${loc}`;
        push('spatial-count', prompt, {
          kind: 'gis',
          commands: [{
            action: 'COUNT',
            layerSource: 'VERIFIED',
            datasetIds: [ds.id],
            radiusKm: km,
            location: loc
          }],
          sharedLocation: loc
        });
      }
    }
  }

  // Layer control — single and multi
  for (const n of [1, 2, 3]) {
    for (let i = 0; i < 40; i += 1) {
      const layers = pickN(rng, FIXTURE_LAYER_TITLES.filter((t) => t !== 'Imagery'), n);
      const joined = joinLayers(layers, rng);
      const showVerb = pick(rng, SHOW_VERBS);
      const hideVerb = pick(rng, HIDE_VERBS);
      const zoomVerb = pick(rng, ZOOM_VERBS);

      push('multi-layer-show', `${showVerb} ${joined}`, {
        kind: 'layer_client',
        action: 'LAYER_CONTROLS',
        operation: 'SHOW_LAYERS',
        layers: [...layers].sort()
      }, 'layer');

      push('multi-layer-hide', `${hideVerb} ${joined}`, {
        kind: 'layer_client',
        action: 'LAYER_CONTROLS',
        operation: 'HIDE_LAYERS',
        layers: [...layers].sort()
      }, 'layer');

      push('multi-layer-zoom', `${zoomVerb} ${joined}`, {
        kind: 'layer_client',
        action: 'LAYER_CONTROLS',
        operation: 'ZOOM_TO_LAYERS',
        layers: [...layers].sort()
      }, 'layer');

      push('multi-layer-hide-reversed', `turn ${joined} off`, {
        kind: 'layer_client',
        action: 'LAYER_CONTROLS',
        operation: 'HIDE_LAYERS',
        layers: [...layers].sort()
      }, 'layer');
    }
  }

  // LIST layers
  push('layer-list', 'What layers do I have?', {
    kind: 'gis',
    commands: [{ action: 'LIST_LAYERS', layerSource: 'VERIFIED' }]
  }, 'planner');
  push('layer-list-point', 'What point layers do I have?', {
    kind: 'gis',
    commands: [{ action: 'LIST_LAYERS', layerSource: 'VERIFIED' }]
  }, 'planner');

  // Conversation meta / expansion
  const sourceLayers = [
    { catalogId: 'c1', title: 'Cameras' },
    { catalogId: 'e1', title: 'EMS' }
  ];
  const scopedState = {
    lastScopedResultLayerIds: ['iqai-webmap-cameras'],
    lastScopedDatasets: [{ title: 'Cameras' }],
    lastScopedLocation: '997 de la Commune',
    lastScopedRadiusKm: 3,
    lastOperationScope: 'scoped',
    lastSpatialOperation: 'WITHIN'
  };
  const sourceState = {
    lastReferencedSourceLayers: sourceLayers,
    lastOperationScope: 'source'
  };

  const convPhrases = [
    { p: 'turn them off', ctx: sourceState, exp: { kind: 'meta', metaAction: 'LAYER_REFERENCE', operation: 'HIDE_LAYERS', scope: 'source', layers: ['Cameras', 'EMS'] } },
    { p: 'turn them back on', ctx: sourceState, exp: { kind: 'meta', metaAction: 'LAYER_REFERENCE', operation: 'SHOW_LAYERS', scope: 'source', layers: ['Cameras', 'EMS'] } },
    { p: 'hide these results', ctx: scopedState, exp: { kind: 'meta', metaAction: 'HIDE_SCOPED_RESULTS' } },
    { p: 'show them again', ctx: scopedState, exp: { kind: 'meta', metaAction: 'SHOW_SCOPED_RESULTS' } },
    { p: 'turn off all layers', ctx: {}, exp: { kind: 'meta', metaAction: 'HIDE_ALL_DISPLAYED' } },
    { p: 'turn off all source layers', ctx: {}, exp: { kind: 'meta', metaAction: 'HIDE_ALL_SOURCE' } },
    { p: 'reset map', ctx: {}, exp: { kind: 'meta', metaAction: 'RESET_MAP' } },
    { p: 'Make it 5 km', ctx: scopedState, exp: { kind: 'expansion', expansion: 'radius_reuse', prompt: 'Show Cameras within 5 km of 997 de la Commune' } },
    { p: 'Show EMS there', ctx: { lastLocationText: '997 de la Commune', lastScopedRadiusKm: 3, lastSpatialOperation: 'WITHIN' }, exp: { kind: 'expansion', expansion: 'location_reuse' } }
  ];
  for (const item of convPhrases) {
    push('conversation', item.p, item.exp, 'conversation', item.ctx);
  }

  // Ambiguity — must not guess
  const ambiguous = [
    { p: 'Show it.', path: 'gis' },
    { p: 'Hide that.', path: 'gis' },
    { p: 'Show important things.', path: 'gis' },
    { p: 'Map stuff around there.', path: 'gis' },
    { p: 'Do something with Cameras.', path: 'gis' }
  ];
  for (const item of ambiguous) {
    push('ambiguity', item.p, { kind: 'clarification' }, item.path, {}, 'high');
  }

  // French subset
  const french = [
    { p: 'Désactive les caméras.', exp: { kind: 'layer_client', action: 'LAYER_CONTROL', operation: 'HIDE_LAYER', layers: ['Cameras'] }, path: 'layer' },
    { p: 'Montre les caméras dans un rayon de 3 km de 997 de la Commune.', exp: { kind: 'gis', commands: [{ action: 'WITHIN', dataset: 'Cameras', radiusKm: 3, location: '997 de la Commune', layerSource: 'WEBMAP' }], sharedLocation: '997 de la Commune' } },
    { p: 'Cache-les.', exp: { kind: 'clarification' }, path: 'conversation', ctx: {} }
  ];
  for (const f of french) {
    push('french', f.p, f.exp, f.path || 'gis', f.ctx || {}, 'medium', 'fr');
  }

  // Compound GIS stress
  const compoundTemplates = [
    {
      prompt: 'Map the 5 nearest police stations, the 3 nearest fire stations, and all hospitals within 6 km of 6939 Décarie Boulevard.',
      commands: [
        { action: 'NEAREST', datasetIds: [DATASET_IDS.POLICE_STATIONS], limit: 5 },
        { action: 'NEAREST', datasetIds: [DATASET_IDS.FIRE_STATIONS], limit: 3 },
        { action: 'WITHIN', datasetIds: [DATASET_IDS.HOSPITALS], radiusKm: 6 }
      ],
      sharedLocation: '6939 Décarie Boulevard'
    }
  ];
  for (const t of compoundTemplates) {
    push('compound', t.prompt, { kind: 'gis', commands: t.commands, sharedLocation: t.sharedLocation });
    // clause order variants
    push('compound', t.prompt.replace('police stations, the 3 nearest fire', 'fire stations, the 5 nearest police'), {
      kind: 'gis',
      commands: t.commands,
      sharedLocation: t.sharedLocation
    });
  }

  // Grammatical noise — natural imperfect phrasing before spatial relations (English)
  const grammaticalBases = [
    { label: 'fire stations', datasetIds: [DATASET_IDS.FIRE_STATIONS], km: 3, loc: '997 de la Commune' },
    { label: 'hospitals', datasetIds: [DATASET_IDS.HOSPITALS], km: 2, loc: '997 de la Commune' },
    { label: 'police stations', datasetIds: [DATASET_IDS.POLICE_STATIONS], km: 4, loc: '997 de la Commune' }
  ];
  const grammaticalPrefixes = ['show me', 'can you show me', 'where are', 'what are', 'find'];
  const grammaticalInserts = [' are ', ' that are ', ' which are '];
  for (const base of grammaticalBases) {
    for (const prefix of grammaticalPrefixes.slice(0, 3)) {
      for (const insert of grammaticalInserts.slice(0, 2)) {
        const unitNoise = base.km === 1 ? '1km' : `${base.km} km`;
        const prompt = `${prefix} ${base.label}${insert}within ${unitNoise} of ${base.loc}`;
        push('grammatical-noise-within', prompt, {
          kind: 'gis',
          commands: [{
            action: 'WITHIN',
            datasetIds: base.datasetIds,
            radiusKm: base.km,
            location: base.loc
          }],
          sharedLocation: base.loc
        }, 'gis', null, 'medium');
      }
    }
  }

  // Noise expansion on stable bases — grow to 10k+
  const noiseBases = cases.filter((c) => ['spatial-within-webmap', 'multi-layer-hide', 'multi-layer-show'].includes(c.category));
  const noiseCases = [];
  for (const base of noiseBases) {
    const variants = generateNoiseVariants(base.prompt, rng, 12);
    for (const v of variants) {
      if (v === base.prompt) continue;
      noiseCases.push({
        ...base,
        id: makeId(seed, 'noise', index),
        category: 'typo-noise',
        prompt: v,
        basePrompt: base.prompt,
        severity: 'low'
      });
      index += 1;
    }
  }

  // Multi-layer WITHIN — current parser binds first layer only (document gap)
  const combinatorial = [];
  for (let i = 0; i < 200; i += 1) {
    const layers = pickN(rng, ['Cameras', 'EMS', 'Traffic'], 2);
    const km = pick(rng, RADII_KM);
    const loc = pick(rng, FIXTURE_LOCATIONS);
    const within = pick(rng, WITHIN_PHRASES);
    const verb = pick(rng, SHOW_VERBS);
    const prompt = `${verb} ${joinLayers(layers, rng)} ${within} ${km} km of ${loc}`;
    combinatorial.push({
      id: makeId(seed, 'combinatorial', index),
      seed,
      category: 'spatial-multi',
      language: 'en',
      path: 'gis',
      prompt,
      context: null,
      expected: {
        kind: 'gis',
        commands: [{
          action: 'WITHIN',
          layerSource: 'WEBMAP',
          dataset: layers[0],
          radiusKm: km,
          location: loc
        }],
        sharedLocation: loc
      },
      severity: 'medium',
      basePrompt: prompt
    });
    index += 1;
  }

  let all = [...cases, ...noiseCases, ...combinatorial];

  // Cap or expand to target
  const target = options.targetPrompts ?? 12000;
  if (all.length < target) {
    const extra = [];
    for (let i = all.length; extra.length < target - all.length; i += 1) {
      const layer = pick(rng, FIXTURE_LAYER_TITLES);
      const loc = pick(rng, FIXTURE_LOCATIONS);
      const km = pick(rng, RADII_KM);
      const verb = pick(rng, HIDE_VERBS);
      const prompt = `${verb} ${layer}`;
      extra.push({
        id: makeId(seed, 'generated-layer', i),
        seed,
        category: 'layer-single',
        language: 'en',
        path: 'layer',
        prompt,
        expected: {
          kind: 'layer_client',
          action: 'LAYER_CONTROLS',
          operation: 'HIDE_LAYERS',
          layers: [layer]
        },
        severity: 'low'
      });
    }
    all = all.concat(extra);
  }

  return all.slice(0, target);
}

export { FIXTURE_CATALOG };
