import test from 'node:test';
import assert from 'node:assert/strict';
import { planCompoundPrompt } from '../src/spatial/spatial-compound-planner.js';
import {
  resolveWebMapLayersFromPhrase,
  resolveTargetFromPhrase,
  LAYER_NOT_AVAILABLE_MESSAGE
} from '../src/spatial/webmap-layer-catalog.js';
import { interpretSpatialLanguage } from '../src/spatial/spatial-language-interpreter.js';
import { DATASET_IDS } from '../src/spatial/dataset-registry.js';

const mockCatalog = {
  webmapTitle: 'Montreal 1',
  layers: [
    {
      catalogId: 'cameras-layer',
      layerId: 'cameras-layer',
      title: 'Cameras',
      type: 'feature',
      geometryType: 'point',
      queryable: true,
      visible: false,
      parentGroup: 'Public Safety'
    },
    {
      catalogId: 'ems-layer',
      layerId: 'ems-layer',
      title: 'EMS',
      type: 'feature',
      geometryType: 'point',
      queryable: true,
      visible: false,
      parentGroup: null
    },
    {
      catalogId: 'traffic-layer',
      layerId: 'traffic-layer',
      title: 'Traffic',
      type: 'feature',
      geometryType: 'point',
      queryable: true,
      visible: true,
      parentGroup: null
    }
  ]
};

test('resolveWebMapLayersFromPhrase matches Cameras aliases', () => {
  const cameras = resolveWebMapLayersFromPhrase('cams', mockCatalog);
  assert.equal(cameras.matches.length, 1);
  assert.equal(cameras.matches[0].title, 'Cameras');

  const ems = resolveWebMapLayersFromPhrase('ambulance', mockCatalog);
  assert.equal(ems.matches.length, 1);
  assert.equal(ems.matches[0].title, 'EMS');
});

test('planCompoundPrompt parses layer list and layer control commands', () => {
  const list = planCompoundPrompt('What layers do I have?', { webmapLayerCatalog: mockCatalog });
  assert.equal(list.supported, true);
  assert.equal(list.commands[0].action, 'LIST_LAYERS');

  const show = planCompoundPrompt('Turn on Cameras.', { webmapLayerCatalog: mockCatalog });
  assert.equal(show.supported, true);
  assert.equal(show.commands[0].action, 'SHOW_LAYER');
  assert.equal(show.commands[0].webmapLayer.title, 'Cameras');

  const hide = planCompoundPrompt('Hide Cameras.', { webmapLayerCatalog: mockCatalog });
  assert.equal(hide.supported, true);
  assert.equal(hide.commands[0].action, 'HIDE_LAYER');

  const zoom = planCompoundPrompt('Zoom to Cameras.', { webmapLayerCatalog: mockCatalog });
  assert.equal(zoom.supported, true);
  assert.equal(zoom.commands[0].action, 'ZOOM_TO_LAYER');
});

test('planCompoundPrompt resolves Cameras within spatial query to WebMap layer', () => {
  const within = planCompoundPrompt(
    'Show Cameras within 3 km of 997 de la Commune.',
    { webmapLayerCatalog: mockCatalog }
  );
  assert.equal(within.supported, true);
  assert.equal(within.commands[0].action, 'WITHIN');
  assert.equal(within.commands[0].layerSource, 'WEBMAP');
  assert.equal(within.commands[0].webmapLayer.title, 'Cameras');
  assert.equal(within.commands[0].distanceKm, 3);
  assert.equal(within.sharedLocation, '997 de la Commune');

  const count = planCompoundPrompt(
    'How many Cameras are within 3 km of 997 de la Commune?',
    { webmapLayerCatalog: mockCatalog }
  );
  assert.equal(count.supported, true);
  assert.equal(count.commands[0].action, 'COUNT');
  assert.equal(count.commands[0].webmapLayer.title, 'Cameras');
});

test('verified datasets still resolve when WebMap layer does not match', () => {
  const police = planCompoundPrompt(
    'Map the 3 nearest police stations, all active fire stations within 4 km, and hospitals within 3 km of 997 de la Commune.',
    { webmapLayerCatalog: mockCatalog }
  );
  assert.equal(police.supported, true);
  assert.equal(police.commands.length, 3);
  assert.equal(police.commands[0].datasetIds[0], DATASET_IDS.POLICE_STATIONS);
  assert.equal(police.commands[1].datasetIds[0], DATASET_IDS.FIRE_STATIONS);
  assert.equal(police.commands[2].datasetIds[0], DATASET_IDS.HOSPITALS);
});

test('unknown layer returns not available message', () => {
  const missing = planCompoundPrompt('Turn on Nuclear plants.', { webmapLayerCatalog: mockCatalog });
  assert.equal(missing.supported, false);
  assert.equal(missing.message, LAYER_NOT_AVAILABLE_MESSAGE);
});

test('interpretSpatialLanguage passes catalog context for layer commands', () => {
  const result = interpretSpatialLanguage('What point layers do I have?', {
    webmapLayerCatalog: mockCatalog
  });
  assert.equal(result.supported, true);
  assert.equal(result.commands[0].action, 'LIST_LAYERS');
  assert.equal(result.commands[0].filter, 'point');
});
