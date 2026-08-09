import { FIXTURE_LAYER_TITLES } from './fixtures/catalog.js';
import { createRng, pick } from './seeded-rng.js';

const SHOW_VERBS = ['show', 'turn on'];
const HIDE_VERBS = ['hide', 'turn off', 'disable', 'switch off'];
const LAYERS = FIXTURE_LAYER_TITLES.filter((t) => t !== 'Imagery');

/**
 * Generate supplemental mixed-action layer compound cases.
 * @param {{ seed?: number }} [options]
 */
export function generateMixedActionCases(options = {}) {
  const seed = options.seed ?? 42;
  const rng = createRng(seed);
  const cases = [];
  let index = 0;

  const pushMixed = (prompt, operations) => {
    cases.push({
      id: `mixed-action-${seed}-${index}`,
      seed,
      category: 'mixed-action-layer-compound',
      language: 'en',
      path: 'layer_compound',
      prompt,
      expected: {
        kind: 'layer_compound',
        operations: operations.map((op) => ({
          operation: op.operation,
          layers: [...op.layers].sort()
        }))
      },
      severity: 'high'
    });
    index += 1;
  };

  const pushHomogeneous = (prompt, operation, layers) => {
    cases.push({
      id: `mixed-action-${seed}-${index}`,
      seed,
      category: 'mixed-action-layer-compound',
      language: 'en',
      path: 'layer_homogeneous',
      prompt,
      expected: {
        kind: 'layer_client',
        action: 'LAYER_CONTROLS',
        operation,
        layers: [...layers].sort()
      },
      severity: 'medium'
    });
    index += 1;
  };

  // Required regression anchors
  pushMixed('turn on Traffic and turn off Cameras', [
    { operation: 'SHOW_LAYERS', layers: ['Traffic'] },
    { operation: 'HIDE_LAYERS', layers: ['Cameras'] }
  ]);
  pushMixed('turn off Cameras and turn on Traffic', [
    { operation: 'HIDE_LAYERS', layers: ['Cameras'] },
    { operation: 'SHOW_LAYERS', layers: ['Traffic'] }
  ]);
  pushMixed('show Traffic and hide Cameras', [
    { operation: 'SHOW_LAYERS', layers: ['Traffic'] },
    { operation: 'HIDE_LAYERS', layers: ['Cameras'] }
  ]);
  pushMixed('hide Cameras and show Traffic', [
    { operation: 'HIDE_LAYERS', layers: ['Cameras'] },
    { operation: 'SHOW_LAYERS', layers: ['Traffic'] }
  ]);
  pushMixed('show Traffic, hide Cameras, and show EMS', [
    { operation: 'SHOW_LAYERS', layers: ['Traffic'] },
    { operation: 'HIDE_LAYERS', layers: ['Cameras'] },
    { operation: 'SHOW_LAYERS', layers: ['EMS'] }
  ]);
  pushHomogeneous('show Traffic and EMS', 'SHOW_LAYERS', ['Traffic', 'EMS']);
  pushHomogeneous('hide Cameras and EMS', 'HIDE_LAYERS', ['Cameras', 'EMS']);

  pushMixed('disable Cameras and turn on Traffic', [
    { operation: 'HIDE_LAYERS', layers: ['Cameras'] },
    { operation: 'SHOW_LAYERS', layers: ['Traffic'] }
  ]);

  cases.push({
    id: `mixed-action-${seed}-${index}`,
    seed,
    category: 'mixed-action-layer-compound',
    language: 'en',
    path: 'layer_fail_closed',
    prompt: 'show Traffic and hide whatever',
    expected: { kind: 'clarification' },
    severity: 'high'
  });
  index += 1;

  cases.push({
    id: `mixed-action-${seed}-${index}`,
    seed,
    category: 'mixed-action-layer-compound',
    language: 'en',
    path: 'layer_mixed',
    prompt: 'disable Cameras and enable Traffic',
    expected: {
      kind: 'layer_compound',
      operations: [
        { operation: 'HIDE_LAYERS', layers: ['Cameras'] },
        { operation: 'SHOW_LAYERS', layers: ['Traffic'] }
      ]
    },
    severity: 'high'
  });
  index += 1;

  // Two-clause permutations
  for (const showVerb of SHOW_VERBS) {
    for (const hideVerb of HIDE_VERBS) {
      for (let i = 0; i < LAYERS.length; i += 1) {
        for (let j = 0; j < LAYERS.length; j += 1) {
          if (i === j) continue;
          const a = LAYERS[i];
          const b = LAYERS[j];
          pushMixed(`${showVerb} ${a} and ${hideVerb} ${b}`, [
            { operation: 'SHOW_LAYERS', layers: [a] },
            { operation: 'HIDE_LAYERS', layers: [b] }
          ]);
          pushMixed(`${hideVerb} ${b} and ${showVerb} ${a}`, [
            { operation: 'HIDE_LAYERS', layers: [b] },
            { operation: 'SHOW_LAYERS', layers: [a] }
          ]);
        }
      }
    }
  }

  // Three-clause samples
  const tripleLayers = [
    ['Traffic', 'Cameras', 'EMS'],
    ['Roads', 'Addresses', 'Traffic'],
    ['EMS', 'Cameras', 'Roads']
  ];
  for (const [a, b, c] of tripleLayers) {
    pushMixed(`show ${a}, hide ${b}, and show ${c}`, [
      { operation: 'SHOW_LAYERS', layers: [a] },
      { operation: 'HIDE_LAYERS', layers: [b] },
      { operation: 'SHOW_LAYERS', layers: [c] }
    ]);
    pushMixed(`turn on ${a}, turn off ${b}, and show ${c}`, [
      { operation: 'SHOW_LAYERS', layers: [a] },
      { operation: 'HIDE_LAYERS', layers: [b] },
      { operation: 'SHOW_LAYERS', layers: [c] }
    ]);
  }

  // Homogeneous multi-layer guards
  for (let i = 0; i < 12; i += 1) {
    const n = rng() < 0.5 ? 2 : 3;
    const picked = [];
    while (picked.length < n) {
      const layer = pick(rng, LAYERS);
      if (!picked.includes(layer)) picked.push(layer);
    }
    const joined = picked.length === 2 ? `${picked[0]} and ${picked[1]}` : `${picked[0]}, ${picked[1]}, and ${picked[2]}`;
    if (rng() < 0.5) {
      pushHomogeneous(`show ${joined}`, 'SHOW_LAYERS', picked);
      pushHomogeneous(`turn on ${joined}`, 'SHOW_LAYERS', picked);
    } else {
      pushHomogeneous(`hide ${joined}`, 'HIDE_LAYERS', picked);
      pushHomogeneous(`disable ${joined}`, 'HIDE_LAYERS', picked);
    }
  }

  // disable + turn on pairs (supported)
  for (const a of LAYERS) {
    for (const b of LAYERS) {
      if (a === b) continue;
      pushMixed(`disable ${a} and turn on ${b}`, [
        { operation: 'HIDE_LAYERS', layers: [a] },
        { operation: 'SHOW_LAYERS', layers: [b] }
      ]);
    }
  }

  return cases;
}
