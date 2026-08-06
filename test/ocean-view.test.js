import test from 'node:test';
import assert from 'node:assert/strict';
import { getOceanViewConfig, OCEAN_VIEW_WEBMAP_ID, describeLayerRenderer } from '../src/ocean-view-config.js';

test('ocean view config loads WebMap via arcgis-map component CDN', () => {
  const config = getOceanViewConfig();
  assert.equal(config.webmapId, OCEAN_VIEW_WEBMAP_ID);
  assert.equal(config.loadMethod, 'arcgis-map-component');
  assert.equal(config.sdkVersion, '5.1');
  assert.equal(config.cdnUrl, 'https://js.arcgis.com/5.1/');
  assert.match(config.portalUrl, /^https:\/\/.+/);
  assert.equal(config.destination.latitude, 37.734722);
  assert.equal(config.destination.longitude, -25.664444);
});

test('ocean view URLs do not include credentials as query params', () => {
  const config = getOceanViewConfig();
  assert.doesNotMatch(config.externalUrl, /token=|apikey=|password=/i);
  const json = JSON.stringify(config);
  assert.doesNotMatch(json, /ARCGIS_TOKEN|password|apikey/i);
});

test('describeLayerRenderer flags flow renderer as animated', () => {
  const info = describeLayerRenderer({ title: 'Currents', type: 'imagery', renderer: { type: 'flow' } });
  assert.equal(info.rendererType, 'flow');
  assert.equal(info.animated, true);
});
