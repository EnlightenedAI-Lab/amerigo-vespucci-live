import test from 'node:test';
import assert from 'node:assert/strict';
import {
  expandConversationInput,
  collapseDuplicateFillerWords
} from '../public/spatial/spatial-conversation-resolve.js';
import { patchConversationState, resetConversationState } from '../public/spatial/spatial-conversation-state.js';

test('collapseDuplicateFillerWords removes immediate duplicates', () => {
  assert.equal(collapseDuplicateFillerWords('zoom to to these results'), 'zoom to these results');
  assert.equal(collapseDuplicateFillerWords('show me the the cameras'), 'show me the cameras');
});

test('expandConversationInput handles turn off layers as hide all displayed', () => {
  resetConversationState();
  const result = expandConversationInput('turn off layers');
  assert.equal(result.ok, true);
  assert.equal(result.metaAction, 'HIDE_ALL_DISPLAYED');
});

test('expandConversationInput handles hide everything as hide all displayed', () => {
  resetConversationState();
  const result = expandConversationInput('hide everything');
  assert.equal(result.ok, true);
  assert.equal(result.metaAction, 'HIDE_ALL_DISPLAYED');
});

test('expandConversationInput handles turn off all source layers only', () => {
  resetConversationState();
  const result = expandConversationInput('turn off all source layers');
  assert.equal(result.ok, true);
  assert.equal(result.metaAction, 'HIDE_ALL_SOURCE');
});

test('expandConversationInput handles restore map reset', () => {
  resetConversationState();
  const result = expandConversationInput('restore map');
  assert.equal(result.ok, true);
  assert.equal(result.metaAction, 'RESET_MAP');
});

test('expandConversationInput handles clear result without API round trip', () => {
  resetConversationState();
  const result = expandConversationInput('clear result');
  assert.equal(result.ok, true);
  assert.equal(result.metaAction, 'CLEAR_RESULT');
});

test('expandConversationInput handles clear results variant', () => {
  resetConversationState();
  const result = expandConversationInput('clear results');
  assert.equal(result.ok, true);
  assert.equal(result.metaAction, 'CLEAR_RESULT');
});

test('expandConversationInput normalizes zoom to to these results', () => {
  resetConversationState();
  patchConversationState({
    lastScopedResultLayerIds: ['iqai-webmap-cameras'],
    lastScopedDatasets: [{ title: 'Cameras' }],
    lastOperationScope: 'scoped'
  });
  const result = expandConversationInput('zoom to to these results');
  assert.equal(result.ok, true);
  assert.equal(result.metaAction, 'ZOOM_SCOPED_RESULTS');
});

test('expandConversationInput zoom to the results', () => {
  resetConversationState();
  patchConversationState({
    lastScopedResultLayerIds: ['iqai-webmap-cameras'],
    lastScopedDatasets: [{ title: 'Cameras' }],
    lastOperationScope: 'scoped'
  });
  const result = expandConversationInput('Zoom to the results.');
  assert.equal(result.ok, true);
  assert.equal(result.metaAction, 'ZOOM_SCOPED_RESULTS');
});

test('expandConversationInput handles turn all layers on', () => {
  resetConversationState();
  const result = expandConversationInput('turn all layers on');
  assert.equal(result.ok, true);
  assert.equal(result.metaAction, 'SHOW_ALL_OPERATIONAL');
});

test('expandConversationInput resolves zoom to them from session source layers', () => {
  resetConversationState();
  patchConversationState({
    lastReferencedSourceLayers: [
      { catalogId: 'c1', layerId: 'c1', title: 'Cameras' },
      { catalogId: 'e1', layerId: 'e1', title: 'EMS' }
    ],
    lastOperationScope: 'source'
  });
  const result = expandConversationInput('Zoom to them.');
  assert.equal(result.ok, true);
  assert.equal(result.metaAction, 'LAYER_REFERENCE');
  assert.equal(result.operation, 'ZOOM_TO_LAYERS');
  assert.equal(result.layers.length, 2);
});

test('expandConversationInput turn them off hides source layers when scope is source', () => {
  resetConversationState();
  patchConversationState({
    lastReferencedSourceLayers: [
      { catalogId: 'c1', layerId: 'c1', title: 'Cameras' },
      { catalogId: 'e1', layerId: 'e1', title: 'EMS' }
    ],
    lastOperationScope: 'source'
  });
  const result = expandConversationInput('turn them off');
  assert.equal(result.ok, true);
  assert.equal(result.metaAction, 'LAYER_REFERENCE');
  assert.equal(result.operation, 'HIDE_LAYERS');
});

test('expandConversationInput turn them off hides scoped results when scope is scoped', () => {
  resetConversationState();
  patchConversationState({
    lastScopedResultLayerIds: ['iqai-webmap-cameras', 'iqai-map-result'],
    lastScopedDatasets: [{ title: 'Cameras' }],
    lastOperationScope: 'scoped'
  });
  const result = expandConversationInput('turn them off');
  assert.equal(result.ok, true);
  assert.equal(result.metaAction, 'HIDE_SCOPED_RESULTS');
});

test('expandConversationInput hide scoped results phrases', () => {
  resetConversationState();
  patchConversationState({
    lastScopedResultLayerIds: ['iqai-webmap-cameras'],
    lastScopedDatasets: [{ title: 'Cameras' }],
    lastOperationScope: 'scoped'
  });
  const hide = expandConversationInput('Hide these results.');
  assert.equal(hide.metaAction, 'HIDE_SCOPED_RESULTS');
  const restore = expandConversationInput('Show them again.');
  assert.equal(restore.metaAction, 'SHOW_SCOPED_RESULTS');
});

test('expandConversationInput zoom to scoped results after scoped query', () => {
  resetConversationState();
  patchConversationState({
    lastScopedResultLayerIds: ['iqai-webmap-cameras'],
    lastScopedDatasets: [{ title: 'Cameras' }],
    lastOperationScope: 'scoped'
  });
  const result = expandConversationInput('Zoom to these results.');
  assert.equal(result.ok, true);
  assert.equal(result.metaAction, 'ZOOM_SCOPED_RESULTS');
});

test('expandConversationInput reuses location for show EMS there', () => {
  resetConversationState();
  patchConversationState({
    lastLocationText: '997 de la Commune',
    lastScopedRadiusKm: 3,
    lastRadiusKm: 3,
    lastSpatialOperation: 'WITHIN'
  });
  const result = expandConversationInput('Show EMS there.');
  assert.equal(result.ok, true);
  assert.match(result.prompt, /EMS within 3 km of 997 de la Commune/i);
});

test('expandConversationInput make it 5 km reuses scoped datasets', () => {
  resetConversationState();
  patchConversationState({
    lastScopedLocation: '997 de la Commune',
    lastScopedDatasets: [{ title: 'Cameras' }]
  });
  const result = expandConversationInput('Make it 5 km.');
  assert.equal(result.ok, true);
  assert.match(result.prompt, /Cameras within 5 km of 997 de la Commune/i);
});

test('expandConversationInput clarifies ambiguous layer reference', () => {
  resetConversationState();
  const result = expandConversationInput('Hide them.');
  assert.equal(result.ok, false);
  assert.match(result.clarification, /No previous/i);
});
