/**
 * DYNAMIC_PLACE_SEARCH — governed AI MAP place / POI execution.
 * Geocoding: ArcGIS World GeocodeServer
 * Places: ArcGIS Places near-point, with approved OSM_NA_Amenities fallback
 */
import { randomUUID } from 'node:crypto';
import { geocodeMontrealMapLocation } from './public-safety-geocode.js';
import { SOURCE_IDS } from './approved-external-source-registry.js';
import { attachDistanceLabels, formatRadiusKm } from './spatial-operations.js';
import { buildMapActionPlanFromMapResult } from './orchestrator/map-action-plan-builder.js';
import { validateMapActionPlan } from './orchestrator/map-action-validator.js';
import { parsePlacePoiIntent, isPlacePoiV1Enabled } from './place-poi-intent.js';
import { searchPlaces, PLACE_PROVIDERS } from './places-provider.js';
import {
  DYNAMIC_PLACE_ROUTE,
  DYNAMIC_PLACE_STATUS,
  isSuccessfulPlaceStatus
} from './dynamic-place-search-status.js';

function toMapPlace(normalized, poi) {
  const place = {
    placeId: normalized.id,
    featureId: normalized.id,
    name: normalized.name,
    latitude: normalized.latitude,
    longitude: normalized.longitude,
    geometry: { type: 'Point', coordinates: [normalized.longitude, normalized.latitude] },
    provider: normalized.provider,
    providerId: normalized.providerId,
    retrievedAt: normalized.retrievedAt,
    iqaiType: 'place_poi',
    sourceName: poi.label,
    spatialPrecision: normalized.provider === PLACE_PROVIDERS.ARCGIS_PLACES
      ? 'ArcGIS Places near-point'
      : 'ArcGIS FeatureServer headless query'
  };
  if (normalized.category) place.category = normalized.category;
  if (normalized.amenity) place.amenity = normalized.amenity;
  if (normalized.address) place.address = normalized.address;
  if (Number.isFinite(normalized.distanceMeters)) place.distanceMeters = normalized.distanceMeters;
  return place;
}

function buildProvenance({
  intent,
  origin,
  geocodeReceipt,
  searchResult,
  places,
  status
}) {
  return {
    route: DYNAMIC_PLACE_ROUTE,
    userPrompt: intent.sourceText,
    placeQuery: intent.placeText,
    anchorText: origin.locationText,
    resolvedAnchor: origin.matchedAddress || origin.locationText,
    anchorCoordinates: {
      latitude: origin.latitude,
      longitude: origin.longitude
    },
    radiusMeters: intent.radiusMeters,
    provider: searchResult.provider,
    providerQuery: searchResult.providerQuery,
    retrievedAt: searchResult.retrievedAt,
    resultCount: places.length,
    providerIds: places.map((place) => place.providerId).filter(Boolean),
    distances: places
      .map((place) => place.distanceMeters)
      .filter((value) => Number.isFinite(value)),
    status,
    fallbackFrom: searchResult.fallbackFrom || null,
    fallbackReason: searchResult.fallbackReason || null
  };
}

function buildMapResultFromPlaces(intent, origin, places, provenance, geocodeReceipt) {
  const features = places.map((place) => ({
    ...place,
    displayName: place.name
  }));

  return {
    supported: true,
    action: intent.mode === 'NEAREST' ? 'NEAREST' : 'WITHIN',
    prompt: intent.sourceText,
    capability: 'PLACE_POI_SEARCH',
    route: DYNAMIC_PLACE_ROUTE,
    layerTitle: intent.layerTitle,
    ephemeral: true,
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
      sourceId: provenance.provider || SOURCE_IDS.OSM_NA_AMENITIES,
      authority: provenance.provider === PLACE_PROVIDERS.ARCGIS_PLACES
        ? 'ArcGIS Places'
        : 'OpenStreetMap Amenities / OSM_NA_Amenities',
      iqaiType: 'place_poi',
      matchedFeatures: features.length,
      features,
      provenance
    }],
    summary: {
      status: provenance.status,
      execution: DYNAMIC_PLACE_ROUTE,
      matchedFeatures: features.length,
      radiusMeters: intent.radiusMeters,
      limit: intent.limit || null,
      spatialOperation: intent.mode,
      dataset: intent.poi.label,
      action: intent.mode === 'NEAREST' ? 'NEAREST' : 'WITHIN',
      displayMode: 'scoped'
    },
    source: {
      id: provenance.provider,
      name: provenance.provider === PLACE_PROVIDERS.ARCGIS_PLACES
        ? 'ArcGIS Places'
        : 'Esri OSM North America Amenities',
      authority: provenance.provider === PLACE_PROVIDERS.ARCGIS_PLACES
        ? 'Esri Places Service'
        : 'OpenStreetMap via ArcGIS FeatureServer',
      trust: 'TRUSTED_EXTERNAL'
    },
    geocodeReceipt,
    queryReceipt: provenance,
    provenance,
    resolvedLocationText: origin.locationText,
    matchedAddress: origin.matchedAddress
  };
}

function failureResult(code, message, extra = {}) {
  return {
    ok: false,
    status: extra.status || code,
    code,
    message,
    route: DYNAMIC_PLACE_ROUTE,
    ...extra
  };
}

/**
 * @param {object} input
 * @param {object} [options]
 */
export async function executePlacePoiSearch(input = {}, options = {}) {
  const started = Date.now();
  if (!isPlacePoiV1Enabled()) {
    return failureResult('DISABLED', 'Place POI search is disabled.', {
      status: DYNAMIC_PLACE_STATUS.EXECUTION_FAILURE
    });
  }

  const intent = input.intent || parsePlacePoiIntent(input.prompt);
  if (!intent) {
    return failureResult(
      DYNAMIC_PLACE_STATUS.QUERY_NOT_UNDERSTOOD,
      'Could not parse dynamic place search request.',
      { status: DYNAMIC_PLACE_STATUS.QUERY_NOT_UNDERSTOOD }
    );
  }

  let origin = input.originContext || null;
  if (intent.usesHere) {
    if (!origin?.latitude || !origin?.longitude) {
      return failureResult('HERE_CONTEXT_REQUIRED', 'Select a map location or provide an explicit address instead of "here".', {
        status: DYNAMIC_PLACE_STATUS.ANCHOR_NOT_RESOLVED,
        intent
      });
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
      return failureResult(
        DYNAMIC_PLACE_STATUS.ANCHOR_NOT_RESOLVED,
        geocode.message,
        {
          status: DYNAMIC_PLACE_STATUS.ANCHOR_NOT_RESOLVED,
          intent,
          performance: { geocodeMs: Date.now() - geocodeStarted }
        }
      );
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

  const queryStarted = Date.now();
  let searchResult;
  try {
    searchResult = await searchPlaces({
      query: intent.poi.searchText || intent.placeText,
      point: { latitude: origin.latitude, longitude: origin.longitude },
      radiusMeters: intent.radiusMeters,
      limit: intent.mode === 'NEAREST' ? (intent.limit || 1) : intent.limit,
      poi: intent.poi
    }, options);
  } catch {
    return failureResult(
      DYNAMIC_PLACE_STATUS.EXECUTION_FAILURE,
      'Dynamic place search failed during provider query.',
      { status: DYNAMIC_PLACE_STATUS.EXECUTION_FAILURE, geocodeReceipt, intent }
    );
  }

  if (!isSuccessfulPlaceStatus(searchResult.status)) {
    return failureResult(
      searchResult.status,
      searchResult.message || 'Place provider query failed.',
      {
        status: searchResult.status,
        intent,
        geocodeReceipt,
        queryReceipt: searchResult.providerQuery,
        provider: searchResult.provider,
        performance: { timeToFirstPOIMs: Date.now() - queryStarted }
      }
    );
  }

  let places = searchResult.places.map((item) => toMapPlace(item, intent.poi));
  if (intent.mode !== 'NEAREST') {
    places = places.filter((place) => (
      !Number.isFinite(place.distanceMeters) || place.distanceMeters <= intent.radiusMeters
    ));
  }
  places.sort((a, b) => (a.distanceMeters ?? 0) - (b.distanceMeters ?? 0));
  if (intent.mode === 'NEAREST' && intent.limit) {
    places = places.slice(0, intent.limit);
  }
  places = attachDistanceLabels(places);

  const status = places.length ? DYNAMIC_PLACE_STATUS.PASS : DYNAMIC_PLACE_STATUS.NO_VERIFIED_RESULTS;
  const provenance = buildProvenance({
    intent,
    origin,
    geocodeReceipt,
    searchResult,
    places,
    status
  });

  const mapResult = buildMapResultFromPlaces(intent, origin, places, provenance, geocodeReceipt);
  const taskResult = {
    resultId: randomUUID(),
    resultVersion: 1,
    output: { mapResult }
  };
  const mapActionPlan = buildMapActionPlanFromMapResult(taskResult, {
    graphId: input.graphId || randomUUID(),
    sessionScope: input.sessionScope || `poi:${taskResult.resultId}`
  });
  const validation = validateMapActionPlan(mapActionPlan, {
    sessionScope: mapActionPlan.sessionScope,
    expectedResultVersion: 1,
    mapResultPayload: mapResult
  });

  if (!validation.approved) {
    return failureResult(
      DYNAMIC_PLACE_STATUS.EXECUTION_FAILURE,
      'POI map action plan rejected by validator.',
      {
        status: DYNAMIC_PLACE_STATUS.EXECUTION_FAILURE,
        code: 'MAP_PLAN_REJECTED',
        validation,
        geocodeReceipt,
        queryReceipt: provenance,
        intent
      }
    );
  }

  const message = places.length
    ? `Found ${places.length} ${intent.poi.label} result(s) near ${origin.matchedAddress || origin.locationText}.`
    : `No verified ${intent.poi.label} results within ${formatRadiusKm(intent.radiusMeters)} km of ${origin.matchedAddress || origin.locationText}.`;

  return {
    ok: true,
    status,
    code: status,
    route: DYNAMIC_PLACE_ROUTE,
    intent,
    places,
    geocodeReceipt,
    queryReceipt: provenance,
    provenance,
    mapResult,
    mapActionPlan,
    validation,
    layerTitle: intent.layerTitle,
    message,
    provider: {
      service: searchResult.provider,
      geocoder: 'ArcGIS World GeocodeServer',
      esriPlacesApi: searchResult.provider === PLACE_PROVIDERS.ARCGIS_PLACES,
      fallbackFrom: searchResult.fallbackFrom || null
    },
    performance: {
      timeToFirstPOIMs: Date.now() - queryStarted,
      timeToRenderedPOIsMs: null,
      totalMs: Date.now() - started
    }
  };
}

export { parsePlacePoiIntent, isPlacePoiV1Enabled };
