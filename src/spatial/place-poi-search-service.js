/**
 * PLACE_POI_SEARCH V1 — Esri-first deterministic place search.
 * Geocoding: ArcGIS World GeocodeServer
 * POI records: Esri-hosted OSM_NA_Amenities FeatureServer (approved external source)
 */
import { randomUUID } from 'node:crypto';
import { geocodeMontrealMapLocation } from './public-safety-geocode.js';
import { getApprovedExternalSource, SOURCE_IDS } from './approved-external-source-registry.js';
import { haversineDistanceMeters } from './public-safety-geometry.js';
import { selectNearest, attachDistanceLabels, formatRadiusKm } from './spatial-operations.js';
import { validateGeographicCoordinates } from './external-feature-query.js';
import { buildMapActionPlanFromMapResult } from './orchestrator/map-action-plan-builder.js';
import { validateMapActionPlan } from './orchestrator/map-action-validator.js';
import { parsePlacePoiIntent, isPlacePoiV1Enabled } from './place-poi-intent.js';

const QUERY_TIMEOUT_MS = 30_000;

function escapeSqlLiteral(value) {
  return String(value || '').replace(/'/g, "''");
}

function buildPoiWhereClause(poi = {}) {
  const parts = [];
  if (poi.amenity) {
    parts.push(`amenity = '${escapeSqlLiteral(poi.amenity)}'`);
  }
  if (poi.namePattern) {
    const pattern = escapeSqlLiteral(poi.namePattern);
    parts.push(`(UPPER(name) LIKE UPPER('%${pattern}%') OR UPPER(name_en) LIKE UPPER('%${pattern}%') OR UPPER(name_fr) LIKE UPPER('%${pattern}%'))`);
  }
  return parts.length ? parts.join(' AND ') : '1=1';
}

function layerQueryUrl(source) {
  return `${String(source.serviceUrl).replace(/\/$/, '')}/${source.layerId}/query`;
}

async function fetchJson(url, fetchFn) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), QUERY_TIMEOUT_MS);
  try {
    const response = await fetchFn(url, { signal: controller.signal });
    if (!response.ok) return { ok: false, error: `HTTP ${response.status}` };
    const data = await response.json();
    if (data?.error) return { ok: false, error: data.error.message || 'ArcGIS query error' };
    return { ok: true, data };
  } catch (error) {
    return { ok: false, error: error?.message || 'Request failed' };
  } finally {
    clearTimeout(timer);
  }
}

function normalizePoiFeature(rawFeature, poi, origin, source, queryReceiptId) {
  const raw = rawFeature.attributes || {};
  const geometry = rawFeature.geometry || {};
  const longitude = geometry.x;
  const latitude = geometry.y;
  const coordCheck = validateGeographicCoordinates(longitude, latitude, source.id);
  if (!coordCheck.ok) throw new Error(coordCheck.message);

  const objectId = raw.OBJECTID ?? raw.ObjectID ?? null;
  const street = [raw.addr_housenumber, raw.addr_street].filter(Boolean).join(' ').trim();
  const city = raw.addr_city || raw.addr_state || '';
  const address = [street, city].filter(Boolean).join(', ') || null;

  return {
    placeId: `osm:${objectId}`,
    featureId: `poi:${objectId}`,
    objectId,
    name: raw.name || raw.name_en || raw.name_fr || poi.label,
    category: poi.category || poi.amenity || 'place',
    amenity: raw.amenity || poi.amenity || null,
    address,
    latitude,
    longitude,
    geometry: { type: 'Point', coordinates: [longitude, latitude] },
    provider: source.id,
    providerLayerRef: `${source.id}:${source.layerId}`,
    sourceReceipt: {
      queryReceiptId,
      sourceId: source.id,
      providerLayerRef: `${source.id}:${source.layerId}`,
      objectId,
      osmId: raw.osm_id || null
    }
  };
}

function buildMapResultFromPlaces(intent, origin, places, provenance, geocodeReceipt) {
  const features = places.map((place) => ({
    ...place,
    displayName: place.name,
    iqaiType: 'place_poi',
    sourceName: intent.poi.label,
    spatialPrecision: 'ArcGIS FeatureServer headless query'
  }));

  return {
    supported: true,
    action: intent.mode === 'NEAREST' ? 'NEAREST' : 'WITHIN',
    prompt: intent.sourceText,
    capability: 'PLACE_POI_SEARCH',
    layerTitle: intent.layerTitle,
    origin: {
      latitude: origin.latitude,
      longitude: origin.longitude,
      locationText: origin.locationText,
      matchedAddress: origin.matchedAddress
    },
    request: {
      action: intent.mode === 'NEAREST' ? 'NEAREST' : 'WITHIN',
      radiusMeters: intent.radiusMeters,
      limit: intent.limit || null,
      placeQuery: intent.placeText,
      poiKind: intent.poi.kind
    },
    features,
    datasetResults: [{
      datasetId: `poi:${intent.poi.label}`,
      conceptId: `POI:${intent.poi.category || intent.poi.label}`,
      displayName: intent.poi.label,
      sourceId: SOURCE_IDS.OSM_NA_AMENITIES,
      authority: 'OpenStreetMap Amenities / OSM_NA_Amenities',
      iqaiType: 'place_poi',
      matchedFeatures: features.length,
      features,
      provenance
    }],
    summary: {
      status: 'Controlled',
      execution: 'PLACE_POI_SEARCH',
      matchedFeatures: features.length,
      radiusMeters: intent.radiusMeters,
      limit: intent.limit || null,
      spatialOperation: intent.mode,
      dataset: intent.poi.label,
      action: intent.mode === 'NEAREST' ? 'NEAREST' : 'WITHIN',
      displayMode: 'scoped'
    },
    source: {
      id: SOURCE_IDS.OSM_NA_AMENITIES,
      name: 'Esri OSM North America Amenities',
      authority: 'OpenStreetMap via ArcGIS FeatureServer',
      catalogueUrl: provenance.catalogueUrl,
      trust: 'TRUSTED_EXTERNAL'
    },
    geocodeReceipt,
    queryReceipt: provenance,
    resolvedLocationText: origin.locationText,
    matchedAddress: origin.matchedAddress
  };
}

/**
 * @param {object} input
 * @param {object} [options]
 */
export async function executePlacePoiSearch(input = {}, options = {}) {
  const started = Date.now();
  if (!isPlacePoiV1Enabled()) {
    return { ok: false, code: 'DISABLED', message: 'Place POI search is disabled.' };
  }

  const intent = input.intent || parsePlacePoiIntent(input.prompt);
  if (!intent) {
    return { ok: false, code: 'UNRECOGNIZED_PROMPT', message: 'Could not parse place POI request.' };
  }

  const source = getApprovedExternalSource(SOURCE_IDS.OSM_NA_AMENITIES);
  if (!source) {
    return { ok: false, code: 'PROVIDER_UNAVAILABLE', message: 'Approved POI provider is not registered.' };
  }

  let origin = input.originContext || null;
  if (intent.usesHere) {
    if (!origin?.latitude || !origin?.longitude) {
      return { ok: false, code: 'HERE_CONTEXT_REQUIRED', message: 'Select a map location or provide an explicit address instead of "here".' };
    }
    origin = {
      latitude: origin.latitude,
      longitude: origin.longitude,
      locationText: origin.label || 'Selected location',
      matchedAddress: origin.matchedAddress || origin.label || null
    };
  } else {
    const geocodeStarted = Date.now();
    let geocode;
    if (typeof options.geocodeResolver === 'function' || typeof input.geocodeResolver === 'function') {
      const resolver = options.geocodeResolver || input.geocodeResolver;
      geocode = await resolver(intent.locationText);
    } else {
      geocode = await geocodeMontrealMapLocation(intent.locationText, {
        minScore: options.minScore
      });
    }
    if (!geocode.ok) {
      return {
        ok: false,
        code: 'GEOCODE_FAILED',
        message: geocode.message,
        performance: { geocodeMs: Date.now() - geocodeStarted }
      };
    }
    origin = {
      latitude: geocode.candidate.latitude,
      longitude: geocode.candidate.longitude,
      locationText: intent.locationText,
      matchedAddress: geocode.candidate.resolvedAddress,
      geocoder: geocode.candidate.geocoder,
      geocoderUrl: geocode.candidate.geocoderUrl
    };
  }

  const geocodeReceipt = {
    geocoder: origin.geocoder || 'ArcGIS World GeocodeServer',
    geocoderUrl: origin.geocoderUrl || null,
    locationText: origin.locationText,
    matchedAddress: origin.matchedAddress,
    latitude: origin.latitude,
    longitude: origin.longitude
  };

  const fetchFn = options.fetchFn || globalThis.fetch;
  const where = buildPoiWhereClause(intent.poi);
  const spatialParams = new URLSearchParams({
    geometry: `${origin.longitude},${origin.latitude}`,
    geometryType: 'esriGeometryPoint',
    spatialRel: 'esriSpatialRelIntersects',
    distance: String(intent.radiusMeters),
    units: 'esriSRUnit_Meter',
    inSR: '4326'
  });

  const queryReceiptId = randomUUID();
  const queryStarted = Date.now();
  const outFields = source.fields.join(',');
  const fetchUrl = `${layerQueryUrl(source)}?where=${encodeURIComponent(where)}&outFields=${encodeURIComponent(outFields)}&returnGeometry=true&outSR=4326&f=json&resultRecordCount=2000&${spatialParams.toString()}`;
  const fetchResult = await fetchJson(fetchUrl, fetchFn);
  if (!fetchResult.ok) {
    return {
      ok: false,
      code: 'PROVIDER_UNAVAILABLE',
      message: fetchResult.error || 'POI provider query failed.',
      geocodeReceipt,
      performance: { timeToFirstPOIMs: Date.now() - queryStarted }
    };
  }

  const rawFeatures = fetchResult.data?.features || [];
  let places = [];
  try {
    for (const feature of rawFeatures) {
      places.push(normalizePoiFeature(feature, intent.poi, origin, source, queryReceiptId));
    }
  } catch (error) {
    return { ok: false, code: 'INVALID_PROVIDER_GEOMETRY', message: error.message, geocodeReceipt };
  }

  if (intent.mode === 'NEAREST' && intent.limit) {
    places = selectNearest(places, origin, intent.limit);
  } else {
    places = places
      .map((place) => ({
        ...place,
        distanceMeters: haversineDistanceMeters(
          origin.latitude,
          origin.longitude,
          place.latitude,
          place.longitude
        )
      }))
      .filter((place) => place.distanceMeters <= intent.radiusMeters)
      .sort((a, b) => a.distanceMeters - b.distanceMeters);
  }
  places = attachDistanceLabels(places);

  const timeToFirstPOIMs = Date.now() - queryStarted;
  const provenance = {
    queryReceiptId,
    sourceId: source.id,
    sourceTitle: source.title,
    provider: source.provider,
    providerLayerRef: `${source.id}:${source.layerId}`,
    geocoder: geocodeReceipt.geocoder,
    spatialOperation: intent.mode,
    radiusMeters: intent.radiusMeters,
    radiusLabel: `${formatRadiusKm(intent.radiusMeters)} km`,
    where,
    resultCount: places.length,
    queryTime: new Date().toISOString(),
    catalogueUrl: source.provenance?.catalogueUrl || null,
    attribution: source.attribution,
    licence: source.licence
  };

  const mapResult = buildMapResultFromPlaces(intent, origin, places, provenance, geocodeReceipt);
  const taskResult = {
    resultId: queryReceiptId,
    resultVersion: 1,
    output: { mapResult }
  };
  const mapActionPlan = buildMapActionPlanFromMapResult(taskResult, {
    graphId: input.graphId || randomUUID(),
    sessionScope: input.sessionScope || `poi:${queryReceiptId}`
  });
  const validation = validateMapActionPlan(mapActionPlan, {
    sessionScope: mapActionPlan.sessionScope,
    expectedResultVersion: 1,
    mapResultPayload: mapResult
  });

  if (!validation.approved) {
    return {
      ok: false,
      code: 'MAP_PLAN_REJECTED',
      message: 'POI map action plan rejected by validator.',
      validation,
      geocodeReceipt,
      queryReceipt: provenance
    };
  }

  const message = places.length
    ? `Found ${places.length} ${intent.poi.label} result(s) near ${origin.matchedAddress || origin.locationText}.`
    : `No ${intent.poi.label} results found within ${formatRadiusKm(intent.radiusMeters)} km of ${origin.matchedAddress || origin.locationText}.`;

  return {
    ok: true,
    intent,
    places,
    geocodeReceipt,
    queryReceipt: provenance,
    mapResult,
    mapActionPlan,
    validation,
    layerTitle: intent.layerTitle,
    message,
    provider: {
      service: 'OSM_NA_AMENITIES FeatureServer',
      geocoder: 'ArcGIS World GeocodeServer',
      esriPlacesApi: false
    },
    performance: {
      timeToFirstPOIMs,
      timeToRenderedPOIsMs: null,
      totalMs: Date.now() - started
    }
  };
}

export { parsePlacePoiIntent, isPlacePoiV1Enabled };
