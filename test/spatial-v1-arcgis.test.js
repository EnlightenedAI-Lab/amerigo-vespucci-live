import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('spatial V1 page mounts shell via spatial.js', async () => {
  const html = await readFile(new URL('../public/spatial/index.html', import.meta.url), 'utf8');
  assert.match(html, /id="spatial-app"/);
  assert.match(html, /spatial\.js/);
  const appShell = await readFile(new URL('../public/spatial/shell/AppShell.js', import.meta.url), 'utf8');
  assert.equal((appShell.match(/id="spatial-map-host"/g) || []).length, 1);
  assert.match(appShell, /data-spatial-map-host/);
});

test('spatial arcgis runtime creates MapView once', async () => {
  const runtime = await readFile(new URL('../public/spatial/spatial-arcgis-runtime.js', import.meta.url), 'utf8');
  assert.match(runtime, /mapViewCreateCount \+= 1/);
  assert.match(runtime, /webMapCreateCount \+= 1/);
  assert.match(runtime, /LayerList/);
  assert.doesNotMatch(runtime, /destroy\(/);
});

test('layer panel uses ArcGIS LayerList host not fake layers', async () => {
  const layerPanel = await readFile(new URL('../public/spatial/shell/LayerPanel.js', import.meta.url), 'utf8');
  assert.match(layerPanel, /spatial-arcgis-layerlist/);
  assert.doesNotMatch(layerPanel, /Fire Stations/);
  assert.doesNotMatch(layerPanel, /VERIFIED GIS/);
});

test('layer panel toggles use authoritative executeLayerControl contract', async () => {
  const controller = await readFile(new URL('../public/spatial/shell/layer-panel-controller.js', import.meta.url), 'utf8');
  assert.match(controller, /operation: input\.checked \? 'SHOW_LAYER' : 'HIDE_LAYER'/);
  assert.match(controller, /catalogId/);
  assert.doesNotMatch(controller, /webmapCatalogId/);
  assert.doesNotMatch(controller, /layer-row__meta/);
});

test('deterministic map results use a single guaranteed-visible FeatureLayer', async () => {
  const mapCommand = await readFile(new URL('../public/spatial/spatial-map-command.js', import.meta.url), 'utf8');
  assert.match(mapCommand, /iqai-deterministic-results/);
  assert.match(mapCommand, /buildSafeResultRenderer/);
  assert.match(mapCommand, /buildCleanOsmPopupTemplate/);
  assert.match(mapCommand, /buildDeterministicResultsLayer/);
  assert.doesNotMatch(mapCommand, /buildIqaiResultClusterReduction/);
  assert.doesNotMatch(mapCommand, /buildWebMapScopedFeatureLayer/);
});
test('montreal oauth config exposes WebMap item id', async () => {
  const { buildMontrealOAuthPublicConfig } = await import('../src/spatial/montreal-oauth-config.js');
  const cfg = buildMontrealOAuthPublicConfig({
    montrealArcgisOAuthAppId: 'test-client',
    montrealOperationalWebmapId: '2ec27986ecfb4dd188d058cae620be0d'
  }, 'http://localhost:3000');
  assert.equal(cfg.webmapItemId, '2ec27986ecfb4dd188d058cae620be0d');
  assert.equal(cfg.oauthAppIdConfigured, true);
});

test('local API key demo mode keeps OAuth fields and suppresses popup', async () => {
  const previous = process.env.ARCGIS_API_KEY;
  process.env.ARCGIS_API_KEY = 'test-local-demo-key';
  const { buildMontrealOAuthPublicConfig } = await import('../src/spatial/montreal-oauth-config.js');
  try {
    const local = buildMontrealOAuthPublicConfig({
      montrealArcgisOAuthAppId: 'test-client',
      montrealOperationalWebmapId: '2ec27986ecfb4dd188d058cae620be0d'
    }, 'http://localhost:3047');
    assert.equal(local.authMode, 'local-api-key');
    assert.equal(local.popup, false);
    assert.equal(local.apiKeyConfigured, true);
    assert.equal(local.oauthAppIdConfigured, true);
    assert.equal(local.webmapItemId, '2ec27986ecfb4dd188d058cae620be0d');
    const remote = buildMontrealOAuthPublicConfig({
      montrealArcgisOAuthAppId: 'test-client'
    }, 'https://example.invalid');
    assert.equal(remote.authMode, 'browser-oauth');
    assert.equal(remote.apiKey, null);
    assert.equal(remote.popup, true);
  } finally {
    if (previous == null) delete process.env.ARCGIS_API_KEY;
    else process.env.ARCGIS_API_KEY = previous;
  }
});
