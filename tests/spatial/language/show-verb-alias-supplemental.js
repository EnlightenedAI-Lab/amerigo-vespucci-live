import { FIXTURE_CATALOG } from './fixtures/catalog.js';

/**
 * Supplemental SHOW-alias + mixed-action cases (not part of frozen 16,200 benchmark).
 */
export function generateShowVerbAliasMixedCases() {
  return [
    {
      id: 'alias-mixed-1',
      category: 'show-verb-alias-mixed',
      prompt: 'display Traffic and hide Cameras',
      expected: {
        kind: 'layer_compound',
        operations: [
          { operation: 'SHOW_LAYERS', layers: ['Traffic'] },
          { operation: 'HIDE_LAYERS', layers: ['Cameras'] }
        ]
      }
    },
    {
      id: 'alias-mixed-2',
      category: 'show-verb-alias-mixed',
      prompt: 'enable Traffic and turn off Cameras',
      expected: {
        kind: 'layer_compound',
        operations: [
          { operation: 'SHOW_LAYERS', layers: ['Traffic'] },
          { operation: 'HIDE_LAYERS', layers: ['Cameras'] }
        ]
      }
    },
    {
      id: 'alias-mixed-3',
      category: 'show-verb-alias-mixed',
      prompt: 'let me see Traffic and hide Cameras',
      expected: {
        kind: 'layer_compound',
        operations: [
          { operation: 'SHOW_LAYERS', layers: ['Traffic'] },
          { operation: 'HIDE_LAYERS', layers: ['Cameras'] }
        ]
      }
    },
    {
      id: 'alias-single-1',
      category: 'show-verb-alias-mixed',
      prompt: 'display Cameras',
      expected: {
        kind: 'layer_client',
        action: 'LAYER_CONTROLS',
        operation: 'SHOW_LAYERS',
        layers: ['Cameras']
      }
    },
    {
      id: 'alias-single-2',
      category: 'show-verb-alias-mixed',
      prompt: 'enable EMS',
      expected: {
        kind: 'layer_client',
        action: 'LAYER_CONTROLS',
        operation: 'SHOW_LAYERS',
        layers: ['EMS']
      }
    },
    {
      id: 'alias-fail-closed',
      category: 'show-verb-alias-mixed',
      prompt: 'display Traffic and hide whatever',
      expected: { kind: 'clarification' }
    }
  ];
}

export { FIXTURE_CATALOG };
