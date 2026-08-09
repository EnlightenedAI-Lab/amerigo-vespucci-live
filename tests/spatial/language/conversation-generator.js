import { createRng } from './seeded-rng.js';

const SESSION_TEMPLATES = [
  {
    name: 'source-toggle-cycle',
    steps: [
      { prompt: 'Turn off all layers.', expected: { kind: 'meta', metaAction: 'HIDE_ALL_DISPLAYED' } },
      { prompt: 'Turn on Cameras and EMS.', expected: { kind: 'layer_client', action: 'LAYER_CONTROLS', operation: 'SHOW_LAYERS', layers: ['Cameras', 'EMS'] }, path: 'layer' },
      {
        prompt: 'Turn them off.',
        variants: ['turn them off', 'hide those', 'switch both off', 'turn those layers off', 'turn both off please'],
        expected: { kind: 'meta', metaAction: 'LAYER_REFERENCE', operation: 'HIDE_LAYERS', scope: 'source', layers: ['Cameras', 'EMS'] },
        contextFrom: 'source_on'
      },
      {
        prompt: 'Turn them back on.',
        variants: ['turn them back on', 'show them again', 'enable those layers', 'turn those back on'],
        expected: { kind: 'meta', metaAction: 'LAYER_REFERENCE', operation: 'SHOW_LAYERS', scope: 'source', layers: ['Cameras', 'EMS'] },
        contextFrom: 'source_on'
      }
    ]
  },
  {
    name: 'scoped-query-cycle',
    steps: [
      { prompt: 'Show Cameras within 3 km of 997 de la Commune.', path: 'gis', expected: { kind: 'gis', commands: [{ action: 'WITHIN', dataset: 'Cameras', radiusKm: 3, location: '997 de la Commune', layerSource: 'WEBMAP' }], sharedLocation: '997 de la Commune' } },
      { prompt: 'Make it 5 km.', expected: { kind: 'expansion', expansion: 'radius_reuse' }, contextFrom: 'scoped_cameras' },
      {
        prompt: 'Hide these results.',
        variants: ['hide these results', 'remove those from view', 'hide scoped results'],
        expected: { kind: 'meta', metaAction: 'HIDE_SCOPED_RESULTS' },
        contextFrom: 'scoped_cameras'
      },
      {
        prompt: 'Show them again.',
        variants: ['show them again', 'turn them back on'],
        expected: { kind: 'meta', metaAction: 'SHOW_SCOPED_RESULTS' },
        contextFrom: 'scoped_cameras'
      }
    ]
  },
  {
    name: 'reset-clean',
    steps: [
      { prompt: 'Show Cameras within 3 km of 997 de la Commune.', path: 'gis', expected: { kind: 'gis', commands: [{ action: 'WITHIN', dataset: 'Cameras', radiusKm: 3, layerSource: 'WEBMAP' }] } },
      {
        prompt: 'Reset map.',
        variants: ['reset map', 'restore map', 'start over', 'return to original layers'],
        expected: { kind: 'meta', metaAction: 'RESET_MAP' },
        contextFrom: 'scoped_cameras'
      }
    ]
  },
  {
    name: 'source-vs-scoped',
    steps: [
      { prompt: 'Turn on Cameras.', path: 'layer', expected: { kind: 'layer_client', action: 'LAYER_CONTROLS', operation: 'SHOW_LAYERS', layers: ['Cameras'] } },
      { prompt: 'Show Cameras within 3 km of 997 de la Commune.', path: 'gis', expected: { kind: 'gis', commands: [{ action: 'WITHIN', dataset: 'Cameras', radiusKm: 3, layerSource: 'WEBMAP' }] } },
      {
        prompt: 'Hide these results.',
        variants: ['hide these results', 'remove those from view', 'hide scoped results'],
        expected: { kind: 'meta', metaAction: 'HIDE_SCOPED_RESULTS' },
        contextFrom: 'scoped_cameras'
      },
      {
        prompt: 'Turn off Cameras.',
        variants: ['turn off Cameras', 'hide Cameras', 'disable Cameras', 'turn Cameras off'],
        path: 'layer',
        expected: { kind: 'layer_client', action: 'LAYER_CONTROL', operation: 'HIDE_LAYER', layers: ['Cameras'] }
      }
    ]
  }
];

const CONTEXT_PRESETS = {
  source_on: {
    lastReferencedSourceLayers: [
      { catalogId: 'cameras-layer', title: 'Cameras' },
      { catalogId: 'ems-layer', title: 'EMS' }
    ],
    lastOperationScope: 'source'
  },
  scoped_cameras: {
    lastScopedResultLayerIds: ['iqai-webmap-cameras-layer', 'iqai-map-result'],
    lastScopedDatasets: [{ title: 'Cameras' }],
    lastScopedLocation: '997 de la Commune',
    lastScopedRadiusKm: 3,
    lastLocationText: '997 de la Commune',
    lastOperationScope: 'scoped',
    lastSpatialOperation: 'WITHIN'
  }
};

function makeId(seed, index) {
  return `conv-${seed}-${index}`;
}

/**
 * Generate multi-turn conversation sequences.
 */
export function generateConversationSequences(options = {}) {
  const seed = options.seed ?? 42;
  const target = options.targetSequences ?? 1200;
  const sequences = [];
  let index = 0;

  while (sequences.length < target) {
    const template = SESSION_TEMPLATES[index % SESSION_TEMPLATES.length];

    const turns = template.steps.map((step) => {
      let prompt = step.prompt;
      if (step.variants?.length) {
        prompt = step.variants[index % step.variants.length];
      }
      const context = step.contextFrom ? { ...CONTEXT_PRESETS[step.contextFrom] } : {};
      return {
        prompt,
        path: step.path || 'conversation',
        expected: step.expected,
        context
      };
    });

    sequences.push({
      id: makeId(seed, index),
      seed,
      name: template.name,
      turns,
      language: 'en'
    });
    index += 1;
  }

  return sequences.slice(0, target);
}

export { CONTEXT_PRESETS, SESSION_TEMPLATES };
