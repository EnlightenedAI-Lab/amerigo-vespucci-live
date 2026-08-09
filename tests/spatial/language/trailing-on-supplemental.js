import { FIXTURE_CATALOG } from './fixtures/catalog.js';

/**
 * Supplemental trailing-ON visibility cases (not part of frozen 16,200 benchmark).
 */
export function generateTrailingOnSupplementalCases() {
  return [
    {
      id: 'trailing-on-1',
      category: 'trailing-on-supplemental',
      path: 'layer',
      prompt: 'turn Cameras on',
      expected: {
        kind: 'layer_client',
        action: 'LAYER_CONTROLS',
        operation: 'SHOW_LAYERS',
        layers: ['Cameras']
      }
    },
    {
      id: 'trailing-on-2',
      category: 'trailing-on-supplemental',
      path: 'layer',
      prompt: 'turn Cameras and EMS on',
      expected: {
        kind: 'layer_client',
        action: 'LAYER_CONTROLS',
        operation: 'SHOW_LAYERS',
        layers: ['Cameras', 'EMS']
      }
    },
    {
      id: 'trailing-on-3',
      category: 'trailing-on-supplemental',
      path: 'layer',
      prompt: 'turn Traffic on',
      expected: {
        kind: 'layer_client',
        action: 'LAYER_CONTROLS',
        operation: 'SHOW_LAYERS',
        layers: ['Traffic']
      }
    },
    {
      id: 'trailing-on-back-on',
      category: 'trailing-on-supplemental',
      path: 'layer',
      prompt: 'turn them back on',
      expected: { kind: 'not_handled', reason: 'reference_command' }
    },
    {
      id: 'trailing-on-all-layers',
      category: 'trailing-on-supplemental',
      path: 'layer',
      prompt: 'turn all layers on',
      expected: {
        kind: 'layer_client',
        action: 'SHOW_ALL_OPERATIONAL',
        operation: null,
        layers: []
      }
    },
    {
      id: 'trailing-on-spatial',
      category: 'trailing-on-supplemental',
      path: 'gis',
      prompt: 'turn Cameras on within 3 km of 997 de la Commune',
      expected: {
        kind: 'gis',
        commands: [{
          action: 'WITHIN',
          dataset: 'Cameras',
          radiusKm: 3,
          location: '997 de la Commune',
          layerSource: 'WEBMAP'
        }],
        sharedLocation: '997 de la Commune'
      }
    },
    {
      id: 'trailing-off-filler',
      category: 'trailing-on-supplemental',
      path: 'layer',
      prompt: 'please turn Cameras off',
      expected: {
        kind: 'layer_client',
        action: 'LAYER_CONTROLS',
        operation: 'HIDE_LAYERS',
        layers: ['Cameras']
      }
    },
    {
      id: 'trailing-on-filler',
      category: 'trailing-on-supplemental',
      path: 'layer',
      prompt: 'could you turn EMS on',
      expected: {
        kind: 'layer_client',
        action: 'LAYER_CONTROLS',
        operation: 'SHOW_LAYERS',
        layers: ['EMS']
      }
    }
  ];
}

export { FIXTURE_CATALOG };
