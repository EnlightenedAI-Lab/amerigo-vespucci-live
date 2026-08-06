import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildWebMapRepairPlan,
  buildVespucciGroupLayer,
  classifyWebMapLayer,
  collectVespucciSublayerConfigs,
  flattenOperationalLayers,
  isFeatureServiceRootUrl,
  parseFeatureLayerIdFromUrl,
  applyWebMapRepairPlan,
  validateVespucciGroupLayer
} from '../src/webmap-repair.js';
import { describeLayerRenderer, getOceanViewConfig } from '../src/ocean-view-config.js';
import { layer0AttributesToPosition } from '../src/arcgis-diagnostics.js';

const FEATURE_URL = 'https://services.arcgis.com/example/FeatureServer';

test('parseFeatureLayerIdFromUrl extracts layer id', () => {
  assert.equal(parseFeatureLayerIdFromUrl(`${FEATURE_URL}/3`), 3);
  assert.equal(parseFeatureLayerIdFromUrl(`${FEATURE_URL}/0/`), 0);
  assert.equal(parseFeatureLayerIdFromUrl(FEATURE_URL), null);
});

test('isFeatureServiceRootUrl detects service root', () => {
  assert.equal(isFeatureServiceRootUrl(FEATURE_URL, FEATURE_URL), true);
  assert.equal(isFeatureServiceRootUrl(`${FEATURE_URL}/`, FEATURE_URL), true);
  assert.equal(isFeatureServiceRootUrl(`${FEATURE_URL}/3`, FEATURE_URL), false);
});

test('flattenOperationalLayers handles nested WebMap group layers', () => {
  const flat = flattenOperationalLayers([
    { title: 'A' },
    { title: 'Group', layerType: 'GroupLayer', layers: [{ title: 'B' }, { title: 'C' }] }
  ]);
  assert.equal(flat.length, 3);
});

test('repair restores GroupLayer with six FeatureLayer children', () => {
  const webmap = {
    baseMap: { baseMapLayers: [{ id: 'bm' }] },
    operationalLayers: [
      { title: 'Current Vessel Position', url: `${FEATURE_URL}/0`, itemId: 'item' },
      { title: 'Vespucci Destination', url: `${FEATURE_URL}/3`, itemId: 'item' },
      { title: 'Ocean Currents in Motion', url: 'https://example.com/imagery' }
    ]
  };
  const plan = buildWebMapRepairPlan(webmap, { layers: [] }, { featureServiceUrl: FEATURE_URL, featureItemId: 'item' });
  assert.ok(plan.summary.vespucciGroupLayer);
  assert.equal(plan.duplicatesRemoved.length, 2);
  assert.equal(plan.operationalLayersAfter.length, 2);
  const group = plan.operationalLayersAfter[0];
  assert.equal(group.layerType, 'GroupLayer');
  assert.equal(group.url, undefined);
  assert.equal(group.layers.length, 6);
  assert.equal(group.layers[0].layerType, 'ArcGISFeatureLayer');
  assert.equal(group.layers[0].url, `${FEATURE_URL}/0`);
  assert.equal(plan.layerOrder[0], 'Amerigo_Vespucci_Live');
  assert.equal(plan.groupValidation.valid, true);
});

test('buildVespucciGroupLayer keeps explicit renderers on children', () => {
  const group = buildVespucciGroupLayer({ featureServiceUrl: FEATURE_URL, featureItemId: 'item' });
  assert.equal(group.layerType, 'GroupLayer');
  const destination = group.layers.find((l) => l.url === `${FEATURE_URL}/3`);
  assert.equal(destination.layerDefinition.drawingInfo.renderer.type, 'simple');
  assert.equal(destination.layerType, 'ArcGISFeatureLayer');
});

test('collectVespucciSublayerConfigs preserves popupInfo from split refs', () => {
  const layers = [
    { title: 'Vespucci Destination', url: `${FEATURE_URL}/3`, popupInfo: { title: 'Dest popup' } }
  ];
  const configs = collectVespucciSublayerConfigs(layers, FEATURE_URL);
  assert.equal(configs.get(3).popupInfo.title, 'Dest popup');
});

test('repair replaces legacy FeatureServer root with GroupLayer', () => {
  const webmap = {
    baseMap: { baseMapLayers: [] },
    operationalLayers: [
      { title: 'Ocean Currents in Motion', url: 'https://example.com/currents' },
      { title: 'Amerigo_Vespucci_Live', url: FEATURE_URL, layerType: 'ArcGISFeatureLayer', layers: [{ id: 0 }, { id: 1 }] }
    ]
  };
  const plan = buildWebMapRepairPlan(webmap, { layers: [] }, { featureServiceUrl: FEATURE_URL });
  assert.equal(plan.summary.oceanCurrentsPreserved, true);
  assert.deepEqual(plan.layerOrder, ['Amerigo_Vespucci_Live', 'Ocean Currents in Motion']);
  assert.equal(plan.operationalLayersAfter[0].layerType, 'GroupLayer');
});

test('dry-run performs no ArcGIS write', async () => {
  let wrote = false;
  const client = { token: 't', config: { arcgisPortalUrl: 'https://www.arcgis.com' }, rawPost: async () => { wrote = true; return {}; } };
  const plan = {
    dryRun: true,
    owner: 'user',
    webmapItemId: 'abc',
    originalWebMap: {},
    operationalLayersAfter: []
  };
  const result = await applyWebMapRepairPlan(client, plan, { dryRun: true });
  assert.equal(result.applied, false);
  assert.equal(wrote, false);
});

test('vessel geometry cannot be changed by WebMap repair plan', () => {
  const plan = buildWebMapRepairPlan({ baseMap: {}, operationalLayers: [] }, { layers: [] }, { featureServiceUrl: FEATURE_URL });
  assert.equal(plan.vesselGeometryUntouched, true);
  assert.ok(!JSON.stringify(plan).match(/updateFeatures.*layer.?0/i));
});

test('missing travelled route is explained when history is insufficient', () => {
  const diagnostics = {
    layers: [
      { layerId: 1, historyPointCount: 1 },
      { layerId: 2, travelledRouteExists: false, travelledRouteNote: 'Observed route unavailable: fewer than two stored observations.' }
    ]
  };
  const plan = buildWebMapRepairPlan({ baseMap: {}, operationalLayers: [] }, diagnostics, { featureServiceUrl: FEATURE_URL });
  assert.match(plan.travelledRouteNote, /fewer than two stored observations/i);
});

test('Ocean View config uses WebMap item not Map Viewer iframe', () => {
  const config = getOceanViewConfig();
  assert.equal(config.loadMethod, 'arcgis-map-component');
  assert.ok(config.webmapId);
  assert.equal(config.embedUrl, undefined);
  assert.doesNotMatch(JSON.stringify(config), /mapviewer/i);
});

test('describeLayerRenderer identifies flow and imagery animation', () => {
  assert.equal(describeLayerRenderer({ title: 'Ocean Currents', type: 'imagery-tile', renderer: { type: 'flow' } }).animated, true);
  assert.equal(describeLayerRenderer({ title: 'Vessel', type: 'feature', renderer: { type: 'simple' } }).animated, false);
});

test('layer0AttributesToPosition handles ISO timestamps from diagnostics', () => {
  const config = { targetMmsi: 247999000 };
  const pos = layer0AttributesToPosition({
    MMSI: 247999000,
    Latitude: 48.5,
    Longitude: -68.5,
    LastAIS: '2026-08-05T12:00:00.000Z',
    SpeedKnots: 8
  }, config);
  assert.equal(pos.latitude, 48.5);
  assert.ok(pos.lastAIS instanceof Date);
});

test('classifyWebMapLayer identifies ocean currents, group, and service root', () => {
  assert.equal(classifyWebMapLayer({ title: 'Ocean Currents' }, FEATURE_URL).kind, 'oceanCurrents');
  assert.equal(classifyWebMapLayer({ title: 'Amerigo_Vespucci_Live', layerType: 'GroupLayer' }, FEATURE_URL).kind, 'vespucciGroup');
  assert.equal(classifyWebMapLayer({ title: 'Amerigo_Vespucci_Live', url: FEATURE_URL }, FEATURE_URL).kind, 'vespucciService');
});

test('validateVespucciGroupLayer requires six ArcGISFeatureLayer children', () => {
  const group = buildVespucciGroupLayer({ featureServiceUrl: FEATURE_URL, featureItemId: 'item' });
  const validation = validateVespucciGroupLayer(group, FEATURE_URL);
  assert.equal(validation.valid, true);
  assert.equal(validation.children.length, 6);
  assert.equal(validation.children.every((c) => c.layerType === 'ArcGISFeatureLayer'), true);
});
