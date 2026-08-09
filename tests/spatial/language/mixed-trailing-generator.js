import { FIXTURE_LAYER_TITLES } from './fixtures/catalog.js';
import { createRng, pick } from './seeded-rng.js';

const LAYERS = FIXTURE_LAYER_TITLES.filter((t) => t !== 'Imagery');

/**
 * Generate supplemental mixed trailing visibility cases (not part of frozen benchmark).
 * @param {{ seed?: number }} [options]
 */
export function generateMixedTrailingCases(options = {}) {
  const seed = options.seed ?? 42;
  const rng = createRng(seed);
  const cases = [];
  let index = 0;

  const pushMixed = (prompt, operations, path = 'layer_compound') => {
    cases.push({
      id: `mixed-trailing-${seed}-${index}`,
      seed,
      category: 'mixed-trailing-visibility',
      language: 'en',
      path,
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
      id: `mixed-trailing-${seed}-${index}`,
      seed,
      category: 'mixed-trailing-visibility',
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

  const pushFailClosed = (prompt) => {
    cases.push({
      id: `mixed-trailing-${seed}-${index}`,
      seed,
      category: 'mixed-trailing-visibility',
      language: 'en',
      path: 'layer_fail_closed',
      prompt,
      expected: { kind: 'clarification' },
      severity: 'high'
    });
    index += 1;
  };

  // Required anchors
  pushMixed('Turn Traffic on and Cameras off', [
    { operation: 'SHOW_LAYERS', layers: ['Traffic'] },
    { operation: 'HIDE_LAYERS', layers: ['Cameras'] }
  ]);
  pushMixed('Turn Cameras off and Traffic on', [
    { operation: 'HIDE_LAYERS', layers: ['Cameras'] },
    { operation: 'SHOW_LAYERS', layers: ['Traffic'] }
  ]);
  pushMixed('Turn Traffic on, Cameras off, and EMS on', [
    { operation: 'SHOW_LAYERS', layers: ['Traffic'] },
    { operation: 'HIDE_LAYERS', layers: ['Cameras'] },
    { operation: 'SHOW_LAYERS', layers: ['EMS'] }
  ]);
  pushMixed('turn on Traffic and Cameras off', [
    { operation: 'SHOW_LAYERS', layers: ['Traffic'] },
    { operation: 'HIDE_LAYERS', layers: ['Cameras'] }
  ]);
  pushMixed('Traffic on and turn off Cameras', [
    { operation: 'SHOW_LAYERS', layers: ['Traffic'] },
    { operation: 'HIDE_LAYERS', layers: ['Cameras'] }
  ]);
  pushMixed('show Traffic and Cameras off', [
    { operation: 'SHOW_LAYERS', layers: ['Traffic'] },
    { operation: 'HIDE_LAYERS', layers: ['Cameras'] }
  ]);
  pushMixed('Cameras off and enable EMS', [
    { operation: 'HIDE_LAYERS', layers: ['Cameras'] },
    { operation: 'SHOW_LAYERS', layers: ['EMS'] }
  ]);

  // Homogeneous guards
  pushHomogeneous('turn Cameras and EMS off', 'HIDE_LAYERS', ['Cameras', 'EMS']);
  pushHomogeneous('turn Cameras and EMS on', 'SHOW_LAYERS', ['Cameras', 'EMS']);
  pushHomogeneous('show Traffic and EMS', 'SHOW_LAYERS', ['Traffic', 'EMS']);
  pushHomogeneous('hide Cameras and Roads', 'HIDE_LAYERS', ['Cameras', 'Roads']);

  pushFailClosed('turn Traffic on and WhateverLayer off');

  // Two-clause trailing permutations
  for (let i = 0; i < LAYERS.length; i += 1) {
    for (let j = 0; j < LAYERS.length; j += 1) {
      if (i === j) continue;
      const showLayer = LAYERS[i];
      const hideLayer = LAYERS[j];
      pushMixed(`turn ${showLayer} on and ${hideLayer} off`, [
        { operation: 'SHOW_LAYERS', layers: [showLayer] },
        { operation: 'HIDE_LAYERS', layers: [hideLayer] }
      ]);
      pushMixed(`turn ${hideLayer} off and ${showLayer} on`, [
        { operation: 'HIDE_LAYERS', layers: [hideLayer] },
        { operation: 'SHOW_LAYERS', layers: [showLayer] }
      ]);
      pushMixed(`${showLayer} on and ${hideLayer} off`, [
        { operation: 'SHOW_LAYERS', layers: [showLayer] },
        { operation: 'HIDE_LAYERS', layers: [hideLayer] }
      ]);
      pushMixed(`turn on ${showLayer} and ${hideLayer} off`, [
        { operation: 'SHOW_LAYERS', layers: [showLayer] },
        { operation: 'HIDE_LAYERS', layers: [hideLayer] }
      ]);
      pushMixed(`show ${showLayer} and ${hideLayer} off`, [
        { operation: 'SHOW_LAYERS', layers: [showLayer] },
        { operation: 'HIDE_LAYERS', layers: [hideLayer] }
      ]);
      pushMixed(`${hideLayer} off and enable ${showLayer}`, [
        { operation: 'HIDE_LAYERS', layers: [hideLayer] },
        { operation: 'SHOW_LAYERS', layers: [showLayer] }
      ]);
    }
  }

  // Three-clause trailing samples
  const triples = [
    ['Traffic', 'Cameras', 'EMS'],
    ['Roads', 'Addresses', 'Traffic'],
    ['EMS', 'Cameras', 'Roads'],
    ['Traffic', 'Roads', 'Addresses']
  ];
  for (const [a, b, c] of triples) {
    pushMixed(`turn ${a} on, ${b} off, and ${c} on`, [
      { operation: 'SHOW_LAYERS', layers: [a] },
      { operation: 'HIDE_LAYERS', layers: [b] },
      { operation: 'SHOW_LAYERS', layers: [c] }
    ]);
    pushMixed(`${a} on, ${b} off, and ${c} on`, [
      { operation: 'SHOW_LAYERS', layers: [a] },
      { operation: 'HIDE_LAYERS', layers: [b] },
      { operation: 'SHOW_LAYERS', layers: [c] }
    ]);
  }

  // Additional homogeneous trailing multi-layer
  for (let i = 0; i < 20; i += 1) {
    const n = rng() < 0.5 ? 2 : 3;
    const picked = [];
    while (picked.length < n) {
      const layer = pick(rng, LAYERS);
      if (!picked.includes(layer)) picked.push(layer);
    }
    const joined = picked.length === 2
      ? `${picked[0]} and ${picked[1]}`
      : `${picked[0]}, ${picked[1]}, and ${picked[2]}`;
    if (rng() < 0.5) {
      pushHomogeneous(`turn ${joined} off`, 'HIDE_LAYERS', picked);
      pushHomogeneous(`turn ${joined} on`, 'SHOW_LAYERS', picked);
    } else {
      pushHomogeneous(`hide ${joined}`, 'HIDE_LAYERS', picked);
      pushHomogeneous(`show ${joined}`, 'SHOW_LAYERS', picked);
    }
  }

  // Leading + trailing reversed order pairs
  for (const showLayer of LAYERS) {
    for (const hideLayer of LAYERS) {
      if (showLayer === hideLayer) continue;
      pushMixed(`disable ${hideLayer} and ${showLayer} on`, [
        { operation: 'HIDE_LAYERS', layers: [hideLayer] },
        { operation: 'SHOW_LAYERS', layers: [showLayer] }
      ]);
      pushMixed(`hide ${hideLayer} and turn ${showLayer} on`, [
        { operation: 'HIDE_LAYERS', layers: [hideLayer] },
        { operation: 'SHOW_LAYERS', layers: [showLayer] }
      ]);
      pushMixed(`turn ${hideLayer} off and display ${showLayer}`, [
        { operation: 'HIDE_LAYERS', layers: [hideLayer] },
        { operation: 'SHOW_LAYERS', layers: [showLayer] }
      ]);
    }
  }

  return cases;
}
