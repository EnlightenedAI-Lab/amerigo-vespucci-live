import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMapFromPrompt } from '../src/spatial/iqai-mapper.js';
import { buildCompactWebMapLayerCatalog, normalizeMapRequestCatalog } from '../src/spatial/webmap-layer-catalog.js';
import {
  buildMapApiRequestBody,
  measureMapApiRequestBody,
  MAP_API_BODY_LIMIT_BYTES,
  MAP_API_BODY_TARGET_BYTES
} from '../public/spatial/map-request-payload.js';
import { planCompoundPrompt } from '../src/spatial/spatial-compound-planner.js';
import { interpretSpatialLanguage } from '../src/spatial/spatial-language-interpreter.js';

const BATHROOM_PROMPT = 'Show bathrooms within 5 km of 997 de la Commune';
const CAMERAS_PROMPT = 'Show Cameras within 3 km of 997 de la Commune';

function makeFullCatalogLayer(index, fieldCount = 30) {
  const fields = Array.from({ length: fieldCount }, (_, j) => ({
    name: `FIELD_${index}_${j}`,
    alias: `Field ${j}`,
    type: 'esriFieldTypeString'
  }));
  return {
    catalogId: `operational-layer-${index}`,
    layerId: `layer-${index}`,
    title: `Operational Layer ${index}`,
    type: 'feature',
    parentGroup: index % 7 === 0 ? `Group ${index % 5}` : null,
    url: `https://services6.arcgis.com/Do88DoK2xjTUCXd1/arcgis/rest/services/Layer_${index}/FeatureServer/0`,
    visible: index % 3 === 0,
    geometryType: 'esriGeometryPoint',
    fields,
    popupTemplateExists: true,
    popupTemplate: {
      title: `Layer ${index}`,
      outFields: ['*'],
      fieldInfos: fields.slice(0, 8).map((field) => ({
        fieldName: field.name,
        label: field.alias
      })),
      content: [{
        type: 'fields',
        fieldInfos: fields.slice(0, 8).map((field) => ({
          fieldName: field.name,
          label: field.alias
        }))
      }]
    },
    queryable: true,
    selectable: true,
    minScale: 0,
    maxScale: 0,
    serviceType: 'Feature Layer',
    classification: 'CURRENT_WEBMAP'
  };
}

function makeMontrealScaleCatalog(layerCount = 95) {
  const layers = Array.from({ length: layerCount }, (_, index) => makeFullCatalogLayer(index));
  return {
    webmapTitle: 'Montreal 1',
    webmapItemId: '2ec27986ecfb4dd188d058cae620be0d',
    builtAt: '2026-08-08T12:00:00.000Z',
    classification: 'CURRENT_WEBMAP',
    layers,
    summary: {
      operationalLayersDiscovered: layers.length,
      featureLayers: layers.filter((layer) => layer.type === 'feature').length,
      queryableLayers: layers.filter((layer) => layer.queryable).length,
      nestedGroupLayers: layers.filter((layer) => layer.parentGroup).length
    }
  };
}

test('compact catalog removes heavy metadata and shrinks payload', () => {
  const full = makeMontrealScaleCatalog(40);
  const fullBody = {
    prompt: BATHROOM_PROMPT,
    previousLocationText: '997 de la Commune',
    previousMatchedAddress: '997 de la Commune Rue O, Montréal',
    webmapLayerCatalog: full,
    conversationState: {
      lastLocationText: '997 de la Commune',
      lastMatchedAddress: '997 de la Commune Rue O, Montréal',
      lastScopedRadiusKm: 5,
      lastPrompt: BATHROOM_PROMPT
    }
  };
  const compactBody = buildMapApiRequestBody({
    prompt: BATHROOM_PROMPT,
    catalog: full,
    conversation: {
      lastLocationText: '997 de la Commune',
      lastMatchedAddress: '997 de la Commune Rue O, Montréal'
    }
  });
  const fullBytes = measureMapApiRequestBody(fullBody);
  const compactBytes = measureMapApiRequestBody(compactBody);
  assert.ok(compactBytes < fullBytes / 5);
  assert.equal(compactBody.webmapLayerCatalog.layers[0].fields, undefined);
  assert.equal(compactBody.webmapLayerCatalog.layers[0].popupTemplate, undefined);
});

test('bathroom MAP request stays below 16 KB limit', () => {
  const body = buildMapApiRequestBody({
    prompt: BATHROOM_PROMPT,
    catalog: makeMontrealScaleCatalog(95),
    conversation: {
      lastLocationText: '997 de la Commune',
      lastMatchedAddress: '997 de la Commune Rue O, Montréal, Quebec, H3C 1B8'
    }
  });
  const bytes = measureMapApiRequestBody(body);
  assert.ok(bytes < MAP_API_BODY_LIMIT_BYTES, `expected < ${MAP_API_BODY_LIMIT_BYTES}, got ${bytes}`);
  assert.ok(bytes < MAP_API_BODY_TARGET_BYTES, `expected < ${MAP_API_BODY_TARGET_BYTES}, got ${bytes}`);
  assert.equal(body.webmapLayerCatalog.compact, true);
  assert.equal(body.previousLocationText, '997 de la Commune');
  assert.equal(body.previousMatchedAddress, '997 de la Commune Rue O, Montréal, Quebec, H3C 1B8');
  assert.equal(body.conversationState, undefined);
});

test('signed-in Montreal-scale MAP request stays below 16 KB limit', () => {
  const body = buildMapApiRequestBody({
    prompt: CAMERAS_PROMPT,
    catalog: makeMontrealScaleCatalog(110),
    conversation: {
      lastLocationText: '997 de la Commune',
      lastMatchedAddress: '997 de la Commune Rue O, Montréal, Quebec, H3C 1B8',
      lastScopedRadiusKm: 5,
      lastPrompt: BATHROOM_PROMPT
    }
  });
  const bytes = measureMapApiRequestBody(body);
  assert.ok(bytes < MAP_API_BODY_LIMIT_BYTES, `expected < ${MAP_API_BODY_LIMIT_BYTES}, got ${bytes}`);
});

test('compact MAP body excludes runtime graphics and STM payloads', () => {
  const body = buildMapApiRequestBody({
    prompt: BATHROOM_PROMPT,
    catalog: makeMontrealScaleCatalog(20)
  });
  const json = JSON.stringify(body);
  assert.equal(json.includes('stm'), false);
  assert.equal(json.includes('graphics'), false);
  assert.equal(json.includes('popupTemplate'), false);
  assert.equal(json.includes('"fields"'), false);
});

test('TRUSTED_EXTERNAL bathroom plan works with compact catalog', async () => {
  const compact = buildCompactWebMapLayerCatalog(makeMontrealScaleCatalog(60));
  const result = await buildMapFromPrompt(BATHROOM_PROMPT, {
    context: { webmapLayerCatalog: normalizeMapRequestCatalog(compact) }
  });
  assert.equal(result.supported, true);
  assert.equal(result.summary?.conceptId, 'TOILETS');
  assert.equal(result.summary?.matchedFeatures, 73);
});

test('layer-aware MAP commands work with compact catalog', () => {
  const compact = buildCompactWebMapLayerCatalog({
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
      ...makeMontrealScaleCatalog(40).layers
    ]
  });
  const plannerCatalog = normalizeMapRequestCatalog(compact);
  const list = planCompoundPrompt('What layers do I have?', { webmapLayerCatalog: plannerCatalog });
  assert.equal(list.supported, true);
  assert.equal(list.commands[0].action, 'LIST_LAYERS');

  const show = planCompoundPrompt('Turn on Cameras.', {
    webmapLayerCatalog: plannerCatalog
  });
  assert.equal(show.supported, true);
  assert.equal(show.commands[0].action, 'SHOW_LAYER');

  const hide = planCompoundPrompt('Hide Cameras.', { webmapLayerCatalog: plannerCatalog });
  assert.equal(hide.supported, true);
  assert.equal(hide.commands[0].action, 'HIDE_LAYER');

  const zoom = planCompoundPrompt('Zoom to Cameras.', { webmapLayerCatalog: plannerCatalog });
  assert.equal(zoom.supported, true);
  assert.equal(zoom.commands[0].action, 'ZOOM_TO_LAYER');
});

test('WebMap spatial commands work with compact catalog', async () => {
  const compact = buildCompactWebMapLayerCatalog({
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
      }
    ]
  });
  const plannerCatalog = normalizeMapRequestCatalog(compact);

  const within = interpretSpatialLanguage(CAMERAS_PROMPT, {
    webmapLayerCatalog: plannerCatalog
  });
  assert.equal(within.supported, true);
  assert.equal(within.commands[0].action, 'WITHIN');
  assert.equal(within.commands[0].webmapCatalogId, 'cameras-layer');

  const nearest = interpretSpatialLanguage('Nearest 3 Cameras from 997 de la Commune', {
    webmapLayerCatalog: plannerCatalog
  });
  assert.equal(nearest.supported, true);
  assert.equal(nearest.commands[0].action, 'NEAREST');
  assert.equal(nearest.commands[0].limit, 3);

  const count = interpretSpatialLanguage('How many Cameras within 3 km of 997 de la Commune', {
    webmapLayerCatalog: plannerCatalog
  });
  assert.equal(count.supported, true);
  assert.equal(count.commands[0].action, 'COUNT');
});

test('conversation location reuse fields are compact', () => {
  const body = buildMapApiRequestBody({
    prompt: 'Make it 5 km.',
    catalog: makeMontrealScaleCatalog(30),
    conversation: {
      lastLocationText: '997 de la Commune',
      lastMatchedAddress: '997 de la Commune Rue O, Montréal',
      lastScopedRadiusKm: 3,
      lastPrompt: CAMERAS_PROMPT,
      lastScopedResultLayerIds: ['iqai-webmap-cameras-layer', 'iqai-map-result'],
      lastReferencedSourceLayers: [{ title: 'Cameras' }]
    }
  });
  assert.equal(body.previousLocationText, '997 de la Commune');
  assert.equal(body.previousMatchedAddress, '997 de la Commune Rue O, Montréal');
  assert.equal(body.conversationState, undefined);
  assert.ok(measureMapApiRequestBody(body) < MAP_API_BODY_LIMIT_BYTES);
});
