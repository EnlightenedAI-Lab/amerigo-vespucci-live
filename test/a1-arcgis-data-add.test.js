import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseArcgisUserInput, getLayerStableIdentity } from '../public/spatial/arcgis-data-add-resolver.js';
import {
  registerUserAddedLayer,
  findUserAddedByIdentity,
  isUserAddedLayerId
} from '../public/spatial/arcgis-data-add-registry.js';
import { isUserAddedCatalogEntry, isToggleableCatalogEntry } from '../public/spatial/webmap-layer-catalog.js';
import { USER_ADDED_CLASSIFICATION } from '../public/spatial/arcgis-data-add-provenance.js';
import {
  buildPortalSearchQuery,
  resolvePortalSort,
  ARCGIS_CONTENT_SOURCES,
  LIVING_ATLAS_GROUP_ID,
  SEARCH_SORT_OPTIONS
} from '../public/spatial/arcgis-data-add-search-config.js';

describe('arcgis-data-add search config', () => {
  it('builds Living Atlas query using Esri curated publisher filter', () => {
    const query = buildPortalSearchQuery('wildfire', ARCGIS_CONTENT_SOURCES.LIVING_ATLAS, ['Feature Service']);
    assert.match(query, /owner:esri_livefeeds/);
    assert.match(query, /wildfire/);
    assert.match(query, /type:"Feature Service"/);
  });

  it('maps sort choices to portal semantics', () => {
    assert.deepEqual(resolvePortalSort(SEARCH_SORT_OPTIONS.MOST_VIEWED), {
      sortField: 'numViews',
      sortOrder: 'desc'
    });
    assert.deepEqual(resolvePortalSort(SEARCH_SORT_OPTIONS.LEAST_VIEWED), {
      sortField: 'numViews',
      sortOrder: 'asc'
    });
    assert.deepEqual(resolvePortalSort(SEARCH_SORT_OPTIONS.RECENTLY_UPDATED), {
      sortField: 'modified',
      sortOrder: 'desc'
    });
    assert.deepEqual(resolvePortalSort(SEARCH_SORT_OPTIONS.RELEVANCE), {
      sortField: 'relevance',
      sortOrder: 'desc'
    });
  });
});

describe('arcgis-data-add resolver', () => {
  it('parses 32-char portal item IDs', () => {
    const parsed = parseArcgisUserInput('2ec27986ecfb4dd188d058cae620be0d');
    assert.equal(parsed.kind, 'item-id');
    assert.equal(parsed.itemId, '2ec27986ecfb4dd188d058cae620be0d');
  });

  it('parses ArcGIS Online item page URLs', () => {
    const parsed = parseArcgisUserInput('https://www.arcgis.com/home/item.html?id=2ec27986ecfb4dd188d058cae620be0d');
    assert.equal(parsed.kind, 'item-url');
    assert.equal(parsed.itemId, '2ec27986ecfb4dd188d058cae620be0d');
  });

  it('parses FeatureServer URLs with layer index', () => {
    const parsed = parseArcgisUserInput('https://services.arcgis.com/example/FeatureServer/0');
    assert.equal(parsed.kind, 'feature-service');
    assert.equal(parsed.layerIndex, 0);
  });

  it('parses MapServer URLs', () => {
    const parsed = parseArcgisUserInput('https://sampleserver6.arcgisonline.com/arcgis/rest/services/USA/MapServer');
    assert.equal(parsed.kind, 'map-service');
  });

  it('rejects unsupported URLs', () => {
    const parsed = parseArcgisUserInput('https://example.com/not-arcgis');
    assert.equal(parsed.kind, 'unsupported-url');
  });
});

describe('arcgis-data-add registry', () => {
  it('detects duplicate identities', () => {
    const layer = { id: null, title: 'Bike lanes', url: 'https://services.example/FeatureServer/0' };
    const first = registerUserAddedLayer(layer, { serviceUrl: layer.url });
    assert.equal(first.duplicate, false);
    assert.ok(isUserAddedLayerId(first.entry.layerId));

    const second = registerUserAddedLayer(
      { id: null, title: 'Bike lanes copy', url: layer.url },
      { serviceUrl: layer.url }
    );
    assert.equal(second.duplicate, true);
    assert.equal(findUserAddedByIdentity(first.identity)?.layerId, first.entry.layerId);
  });

  it('forces iqai-added prefix even when ArcGIS assigns a layer id', () => {
    const layer = {
      id: 'b8f4033069f141729ffb298b7418b653',
      title: 'MODIS',
      url: 'https://services.example/FeatureServer/0'
    };
    const registered = registerUserAddedLayer(layer, { portalItemId: 'b8f4033069f141729ffb298b7418b653' });
    assert.equal(registered.duplicate, false);
    assert.ok(isUserAddedLayerId(registered.entry.layerId));
    assert.notEqual(registered.entry.layerId, 'b8f4033069f141729ffb298b7418b653');
    assert.equal(layer.id, registered.entry.layerId);
  });

  it('builds stable identity from item id and url', () => {
    assert.equal(
      getLayerStableIdentity({ url: 'https://services.example/FeatureServer/0' }, { portalItemId: 'abc' }),
      'item:abc'
    );
    assert.equal(
      getLayerStableIdentity({ url: 'https://services.example/FeatureServer/0' }, {}),
      'url:https://services.example/featureserver/0'
    );
  });
});

describe('webmap catalog user-added entries', () => {
  it('marks user-added layers toggleable', () => {
    const entry = {
      catalogId: 'iqai-added-abc',
      layerId: 'iqai-added-abc',
      type: 'feature',
      classification: USER_ADDED_CLASSIFICATION
    };
    assert.equal(isUserAddedCatalogEntry(entry), true);
    assert.equal(isToggleableCatalogEntry(entry), true);
  });

  it('keeps iqai result layers non-toggleable', () => {
    const entry = { catalogId: 'iqai-map-result', type: 'group' };
    assert.equal(isToggleableCatalogEntry(entry), false);
  });
});
