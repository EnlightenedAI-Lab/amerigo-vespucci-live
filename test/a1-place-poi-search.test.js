import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  parsePlacePoiIntent,
  resolvePoiSpec,
  DEFAULT_NEAR_RADIUS_METERS
} from '../src/spatial/place-poi-intent.js';
import { executePlacePoiSearch } from '../src/spatial/place-poi-search-service.js';
import {
  planSpatialCapability,
  SPATIAL_CAPABILITY
} from '../public/spatial/spatial-capability-router.js';
import { parseIntelligenceMapIntent } from '../public/spatial/intelligence-layer-intent.js';

const ORIGIN_GEOCODE = {
  ok: true,
  candidate: {
    geocoder: 'ArcGIS World GeocodeServer',
    geocoderUrl: 'https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer',
    resolvedAddress: '997 Rue De La Commune O, Montréal, Quebec, H3C 0P3',
    longitude: -73.553,
    latitude: 45.494,
    score: 100
  }
};

const STARBUCKS_FEATURES = {
  features: [
    {
      attributes: {
        OBJECTID: 101,
        osm_id: 'node/1',
        amenity: 'cafe',
        name: 'Starbucks',
        addr_street: 'Rue De La Commune'
      },
      geometry: { x: -73.554, y: 45.495 }
    }
  ]
};

const PHARMACY_FEATURES = {
  features: [
    { attributes: { OBJECTID: 1, amenity: 'pharmacy', name: 'Pharmacy A' }, geometry: { x: -73.555, y: 45.496 } },
    { attributes: { OBJECTID: 2, amenity: 'pharmacy', name: 'Pharmacy B' }, geometry: { x: -73.5545, y: 45.4955 } },
    { attributes: { OBJECTID: 3, amenity: 'pharmacy', name: 'Pharmacy C' }, geometry: { x: -73.554, y: 45.495 } },
    { attributes: { OBJECTID: 4, amenity: 'pharmacy', name: 'Pharmacy D' }, geometry: { x: -73.5538, y: 45.4948 } },
    { attributes: { OBJECTID: 5, amenity: 'pharmacy', name: 'Pharmacy E' }, geometry: { x: -73.5535, y: 45.4945 } },
    { attributes: { OBJECTID: 6, amenity: 'pharmacy', name: 'Pharmacy F' }, geometry: { x: -73.5532, y: 45.4942 } }
  ]
};

function mockPoiFetch(features = STARBUCKS_FEATURES.features) {
  return async (url) => {
    const text = String(url);
    if (text.includes('/0?f=json')) {
      return {
        ok: true,
        json: async () => ({
          fields: [{ name: 'amenity' }, { name: 'name' }, { name: 'OBJECTID' }, { name: 'osm_id' }, { name: 'addr_street' }],
          editingInfo: { dataLastEditDate: Date.now() }
        })
      };
    }
    if (text.includes('/query?')) {
      return { ok: true, json: async () => ({ features }) };
    }
    return { ok: false, status: 404, json: async () => ({ error: { message: 'not found' } }) };
  };
}

describe('place POI intent parser', () => {
  it('parses Starbucks near address', () => {
    const intent = parsePlacePoiIntent('Map Starbucks near 997 de la Commune.');
    assert.ok(intent);
    assert.equal(intent.poi.label, 'Starbucks');
    assert.equal(intent.mode, 'NEAR');
    assert.equal(intent.radiusMeters, DEFAULT_NEAR_RADIUS_METERS);
    assert.match(intent.layerTitle, /AI MAP · Starbucks/i);
  });

  it('parses coffee shops within 1 km of Old Montréal', () => {
    const intent = parsePlacePoiIntent('Show coffee shops within 1 km of Old Montréal.');
    assert.ok(intent);
    assert.equal(intent.poi.amenity, 'cafe');
    assert.equal(intent.mode, 'WITHIN');
    assert.equal(intent.radiusMeters, 1000);
  });

  it('parses nearest 5 pharmacies', () => {
    const intent = parsePlacePoiIntent('Find the 5 nearest pharmacies to 997 de la Commune.');
    assert.ok(intent);
    assert.equal(intent.limit, 5);
    assert.equal(intent.mode, 'NEAREST');
    assert.equal(intent.poi.amenity, 'pharmacy');
  });
});

describe('place POI search service', () => {
  const originalGeocode = global.fetch;

  afterEach(() => {
    global.fetch = originalGeocode;
    delete process.env.IQAI_PLACE_POI_V1_ENABLED;
  });

  beforeEach(() => {
    process.env.IQAI_PLACE_POI_V1_ENABLED = 'true';
  });

  it('executes Starbucks search with provider-backed geometry and MapActionPlan validation', async () => {
    const result = await executePlacePoiSearch(
      { prompt: 'Map Starbucks near 997 de la Commune.' },
      { geocodeResolver: async () => ORIGIN_GEOCODE, fetchFn: mockPoiFetch() }
    );

    assert.equal(result.ok, true);
    assert.equal(result.places.length, 1);
    assert.equal(result.places[0].name, 'Starbucks');
    assert.equal(result.places[0].provider, 'OSM_NA_AMENITIES');
    assert.equal(result.status, 'PASS');
    assert.equal(result.route, 'DYNAMIC_PLACE_SEARCH');
    assert.equal(result.validation.approved, true);
    assert.equal(result.mapResult.capability, 'PLACE_POI_SEARCH');
    assert.equal(result.mapResult.route, 'DYNAMIC_PLACE_SEARCH');
    assert.match(result.layerTitle, /AI MAP · Starbucks/i);
    assert.doesNotMatch(result.layerTitle, /Last 7 days/i);
    assert.equal(result.mapActionPlan.mapResultPayload.capability, 'PLACE_POI_SEARCH');
    assert.equal(result.geocodeReceipt.geocoder, 'ArcGIS World GeocodeServer');
  });

  it('returns top 5 nearest pharmacies deterministically', async () => {
    global.fetch = mockPoiFetch(PHARMACY_FEATURES.features);
    const result = await executePlacePoiSearch(
      { prompt: 'Find the 5 nearest pharmacies to 997 de la Commune.' },
      { geocodeResolver: async () => ORIGIN_GEOCODE, fetchFn: mockPoiFetch(PHARMACY_FEATURES.features) }
    );
    assert.equal(result.ok, true);
    assert.equal(result.places.length, 5);
    assert.ok(result.places[0].distanceMeters <= result.places[1].distanceMeters);
  });

  it('returns provider unavailable without intelligence fallback', async () => {
    const result = await executePlacePoiSearch(
      { prompt: 'Map Starbucks near 997 de la Commune.' },
      {
        geocodeResolver: async () => ORIGIN_GEOCODE,
        fetchFn: async () => ({ ok: false, status: 503, json: async () => ({}) })
      }
    );
    assert.equal(result.ok, false);
    assert.equal(result.code, 'PROVIDER_UNAVAILABLE');
    assert.equal(parseIntelligenceMapIntent('Map Starbucks near 997 de la Commune.'), null);
  });

  it('returns no verified results without fabricating points', async () => {
    const result = await executePlacePoiSearch(
      { prompt: 'Map Zzyzxq Qorblat Coffeeworks within 2 km of 997 de la Commune.' },
      { geocodeResolver: async () => ORIGIN_GEOCODE, fetchFn: mockPoiFetch([]) }
    );
    assert.equal(result.ok, true);
    assert.equal(result.status, 'NO_VERIFIED_RESULTS');
    assert.equal(result.places.length, 0);
    assert.equal(result.mapResult.features.length, 0);
  });
});

describe('place POI capability routing', () => {
  it('routes Starbucks to PLACE_POI_SEARCH with execution available', () => {
    const plan = planSpatialCapability('Map Starbucks near 997 de la Commune.');
    assert.equal(plan.capability, SPATIAL_CAPABILITY.PLACE_POI_SEARCH);
    assert.equal(plan.route, 'DYNAMIC_PLACE_SEARCH');
    assert.equal(plan.available, true);
    assert.equal(plan.executionAuthority, 'PLACE_POI_SERVICE');
    assert.notEqual(plan.capability, SPATIAL_CAPABILITY.INTELLIGENCE_RESEARCH);
  });

  it('does not attach intelligence time windows to POI objectives', () => {
    const intent = parsePlacePoiIntent('Map Starbucks near 997 de la Commune.');
    assert.ok(intent);
    assert.equal(intent.timeWindow, undefined);
    assert.equal(parseIntelligenceMapIntent('Map Starbucks near 997 de la Commune.'), null);
  });

  it('preserves sequential capability switching without stale inheritance', () => {
    const poi = planSpatialCapability('Map Starbucks near 997 de la Commune.');
    const intel = planSpatialCapability('Find significant fires, explosions, or hazmat incidents in Montréal in the last 30 days and map them.');
    const poiAgain = planSpatialCapability('Map Starbucks near 997 de la Commune.');
    assert.equal(poi.capability, SPATIAL_CAPABILITY.PLACE_POI_SEARCH);
    assert.equal(intel.capability, SPATIAL_CAPABILITY.INTELLIGENCE_RESEARCH);
    assert.equal(poiAgain.capability, SPATIAL_CAPABILITY.PLACE_POI_SEARCH);
  });
});

describe('place POI spec resolution', () => {
  it('resolves brand vs category without LLM coordinates', () => {
    assert.equal(resolvePoiSpec('Starbucks').kind, 'brand');
    assert.equal(resolvePoiSpec('coffee shops').amenity, 'cafe');
  });
});
