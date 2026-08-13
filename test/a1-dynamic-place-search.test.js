import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  parsePlacePoiIntent,
  resolvePoiSpec,
  formatDynamicPlaceLayerTitle
} from '../src/spatial/place-poi-intent.js';
import { executePlacePoiSearch } from '../src/spatial/place-poi-search-service.js';
import { normalizeArcGisPlace, searchPlaces } from '../src/spatial/places-provider.js';
import {
  planSpatialCapability,
  SPATIAL_CAPABILITY,
  isAuthoritativeGisObjective,
  isPlacePoiObjective
} from '../public/spatial/spatial-capability-router.js';

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

describe('dynamic place search intent', () => {
  it('parses Starbucks within 2 km as 2000 metres', () => {
    const intent = parsePlacePoiIntent('map Starbucks within 2 km of 997 de la Commune');
    assert.ok(intent);
    assert.equal(intent.route, 'DYNAMIC_PLACE_SEARCH');
    assert.equal(intent.poi.label, 'Starbucks');
    assert.equal(intent.radiusMeters, 2000);
    assert.equal(intent.locationText.includes('997'), true);
    assert.equal(intent.layerTitle, 'AI MAP · Starbucks · 2 km');
  });

  it('parses show Starbucks 2000 meters from address', () => {
    const intent = parsePlacePoiIntent('show Starbucks 2000 meters from 997 de la Commune');
    assert.ok(intent);
    assert.equal(intent.radiusMeters, 2000);
    assert.equal(intent.poi.label, 'Starbucks');
  });

  it('parses nearest gas station without a leading map verb', () => {
    const intent = parsePlacePoiIntent('nearest gas station to Montreal airport');
    assert.ok(intent);
    assert.equal(intent.mode, 'NEAREST');
    assert.equal(intent.limit, 1);
    assert.equal(intent.poi.amenity, 'fuel');
    assert.match(intent.locationText, /Trudeau|Airport/i);
  });

  it('parses hotels around Bell Centre', () => {
    const intent = parsePlacePoiIntent('map hotels around Bell Centre');
    assert.ok(intent);
    assert.equal(intent.poi.category, 'hotel');
    assert.match(intent.locationText, /Bell Centre/i);
  });

  it('does not parse fire stations as place search', () => {
    assert.equal(parsePlacePoiIntent('map fire stations within 3 km of 997 de la Commune'), null);
  });

  it('does not parse toilets as place search', () => {
    assert.equal(parsePlacePoiIntent('map toilets 500 meters from 997 de la commune'), null);
  });
});

describe('dynamic vs registered GIS routing', () => {
  const placePrompts = [
    'map Starbucks within 2 km of 997 de la Commune',
    'show Starbucks 2000 meters from 997 de la Commune',
    'find coffee shops within 1 km of Place Ville Marie',
    'map pharmacies within 2 km of McGill University',
    'nearest gas station to Montreal airport',
    'map hotels around Bell Centre',
    'map Costco within 2 km of 997 de la Commune'
  ];

  for (const prompt of placePrompts) {
    it(`routes place prompt: ${prompt}`, () => {
      const plan = planSpatialCapability(prompt);
      assert.equal(plan.capability, SPATIAL_CAPABILITY.PLACE_POI_SEARCH, prompt);
      assert.equal(plan.route, 'DYNAMIC_PLACE_SEARCH', prompt);
      assert.equal(isPlacePoiObjective(prompt), true);
      assert.equal(isAuthoritativeGisObjective(prompt), false);
    });
  }

  it('keeps fire stations on registered GIS', () => {
    const plan = planSpatialCapability('map fire stations within 3 km of 997 de la Commune');
    assert.equal(plan.capability, SPATIAL_CAPABILITY.DETERMINISTIC_GIS);
    assert.equal(plan.parsedIntent.route, 'REGISTERED_GIS');
    assert.equal(isAuthoritativeGisObjective('map fire stations within 3 km of 997 de la Commune'), true);
    assert.equal(isPlacePoiObjective('map fire stations within 3 km of 997 de la Commune'), false);
  });

  it('keeps toilets on registered GIS', () => {
    const plan = planSpatialCapability('map toilets 500 meters from 997 de la commune');
    assert.equal(plan.capability, SPATIAL_CAPABILITY.DETERMINISTIC_GIS);
    assert.equal(isPlacePoiObjective('map toilets 500 meters from 997 de la commune'), false);
  });
});

describe('ArcGIS Places normalization', () => {
  it('keeps provider coordinates and omits missing address', () => {
    const place = normalizeArcGisPlace({
      placeId: 'abc123',
      name: 'Starbucks',
      distance: 420,
      location: { x: -73.554, y: 45.495 },
      categories: [{ label: 'Coffee Shop' }]
    }, '2026-08-13T00:00:00.000Z');
    assert.equal(place.name, 'Starbucks');
    assert.equal(place.latitude, 45.495);
    assert.equal(place.longitude, -73.554);
    assert.equal(place.provider, 'ARCGIS_PLACES');
    assert.equal(place.providerId, 'abc123');
    assert.equal(place.category, 'Coffee Shop');
    assert.equal(place.distanceMeters, 420);
    assert.equal('address' in place, false);
  });

  it('drops places without real coordinates', () => {
    assert.equal(normalizeArcGisPlace({
      placeId: 'bad',
      name: 'Starbucks',
      location: { x: 'east', y: 'north' }
    }, '2026-08-13T00:00:00.000Z'), null);
  });
});

describe('searchPlaces fallback', () => {
  it('uses OSM when Places is skipped and returns verified coordinates only', async () => {
    const result = await searchPlaces({
      query: 'Starbucks',
      point: { latitude: 45.494, longitude: -73.553 },
      radiusMeters: 2000,
      poi: resolvePoiSpec('Starbucks')
    }, {
      fetchFn: async () => ({
        ok: true,
        json: async () => ({
          features: [{
            attributes: { OBJECTID: 9, osm_id: 'node/9', name: 'Starbucks', amenity: 'cafe' },
            geometry: { x: -73.554, y: 45.495 }
          }]
        })
      })
    });
    assert.equal(result.status, 'PASS');
    assert.equal(result.provider, 'OSM_NA_AMENITIES');
    assert.equal(result.places.length, 1);
    assert.equal(result.places[0].latitude, 45.495);
  });
});

describe('empty legitimate search', () => {
  it('is NO_VERIFIED_RESULTS rather than execution failure', async () => {
    const result = await executePlacePoiSearch(
      { prompt: 'map Zzyzxq Qorblat Coffeeworks within 2 km of 997 de la Commune' },
      {
        geocodeResolver: async () => ORIGIN_GEOCODE,
        fetchFn: async () => ({ ok: true, json: async () => ({ features: [] }) })
      }
    );
    assert.equal(result.ok, true);
    assert.equal(result.status, 'NO_VERIFIED_RESULTS');
    assert.equal(result.places.length, 0);
    assert.equal(result.mapResult.features.length, 0);
  });
});

describe('layer title', () => {
  it('formats ephemeral AI MAP title', () => {
    assert.equal(formatDynamicPlaceLayerTitle('Starbucks', 2000), 'AI MAP · Starbucks · 2 km');
  });
});
