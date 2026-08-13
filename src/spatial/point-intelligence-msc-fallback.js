/**
 * Direct MSC GeoMet Point Intelligence fallback.
 * Used when the Agent 5 broker is unreachable so Montréal Spatial still returns
 * per-family PASS / NO DATA / TIMEOUT / ERROR instead of a total request failure.
 */
import { randomUUID } from 'node:crypto';
import { POINT_INTELLIGENCE_FAMILY_ORDER } from '../../public/spatial/point-intelligence-config.js';

const MSC_ROOT = 'https://api.weather.gc.ca/collections';
const PROVIDER = 'MSC GeoMet';
const PROTOCOL = 'OGC_API';
const FAMILY_TIMEOUT_MS = 12000;
const FETCH_LIMIT = 100;
const MAX_RESULTS = 5;

const FAMILY_SPECS = Object.freeze([
  {
    informationFamily: 'weather',
    nativeId: 'swob-realtime',
    sortBy: '-date_tm-value',
    temporalClassification: 'NEAR_REAL_TIME',
    resultKind: 'DIRECT_MEASUREMENT',
    radiusMeters: 15000
  },
  {
    informationFamily: 'weather-current',
    nativeId: 'citypageweather-realtime',
    sortBy: null,
    temporalClassification: 'NEAR_REAL_TIME',
    resultKind: 'DIRECT_MEASUREMENT',
    radiusMeters: 25000
  },
  {
    informationFamily: 'climate',
    nativeId: 'climate-daily',
    sortBy: '-LOCAL_DATE',
    temporalClassification: 'HISTORICAL',
    resultKind: 'CLIMATE_DAILY_RECORD',
    radiusMeters: 15000
  },
  {
    informationFamily: 'climate-hourly',
    nativeId: 'climate-hourly',
    sortBy: '-LOCAL_DATE',
    temporalClassification: 'RECENT',
    resultKind: 'DIRECT_MEASUREMENT',
    radiusMeters: 15000
  },
  {
    informationFamily: 'air-quality',
    nativeId: 'aqhi-observations-realtime',
    sortBy: '-observation_datetime',
    temporalClassification: 'NEAR_REAL_TIME',
    resultKind: 'DIRECT_MEASUREMENT',
    radiusMeters: 40000
  },
  {
    informationFamily: 'hydrometric',
    nativeId: 'hydrometric-stations',
    sortBy: null,
    temporalClassification: 'STATIC',
    resultKind: 'STATION_REGISTRY',
    radiusMeters: 15000
  },
  {
    informationFamily: 'hydrometric-measurement',
    nativeId: 'hydrometric-realtime',
    sortBy: '-DATETIME',
    temporalClassification: 'NEAR_REAL_TIME',
    resultKind: 'DIRECT_MEASUREMENT',
    radiusMeters: 25000
  }
]);

function iqaiId(kind) {
  return `iqai.pi.${kind}.${randomUUID()}`;
}

function pointBbox(longitude, latitude, radiusMeters) {
  const retrieval = Math.ceil(radiusMeters * Math.SQRT2);
  const deltaLat = retrieval / 111320;
  const deltaLon = retrieval / (111320 * Math.max(Math.cos((latitude * Math.PI) / 180), 0.1));
  return [longitude - deltaLon, latitude - deltaLat, longitude + deltaLon, latitude + deltaLat].join(',');
}

export function haversineMeters(lon1, lat1, lon2, lat2) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.min(1, Math.sqrt(a)));
}

function firstLonLat(value) {
  if (!Array.isArray(value) || value.length < 2) return null;
  if (typeof value[0] === 'number' && typeof value[1] === 'number') {
    const lon = Number(value[0]);
    const lat = Number(value[1]);
    if (Number.isFinite(lon) && Number.isFinite(lat)) return { longitude: lon, latitude: lat };
    return null;
  }
  for (const child of value) {
    const found = firstLonLat(child);
    if (found) return found;
  }
  return null;
}

function featurePoint(feature) {
  const fromGeom = firstLonLat(feature?.geometry?.coordinates);
  if (fromGeom) return fromGeom;
  const props = feature?.properties || {};
  const lat = Number(props.latitude ?? props.lat ?? props.LATITUDE);
  const lon = Number(props.longitude ?? props.lon ?? props.LONGITUDE);
  if (Number.isFinite(lat) && Number.isFinite(lon)) return { longitude: lon, latitude: lat };
  return null;
}

function extractTemporal(props, family) {
  const keysByFamily = {
    climate: ['LOCAL_DATE', 'CLIMATE_DATE'],
    'climate-hourly': ['LOCAL_DATE', 'UTC_DATE'],
    weather: ['date_tm-value'],
    'weather-current': ['lastUpdated'],
    'air-quality': ['observation_datetime'],
    'hydrometric-measurement': ['DATETIME', 'DATETIME_LST'],
    hydrometric: ['STATION_FIRST_DATE']
  };
  const out = {};
  for (const key of keysByFamily[family] || []) {
    if (props?.[key] != null) out[key] = props[key];
  }
  return Object.keys(out).length ? out : null;
}

function propValue(props, keys) {
  for (const key of keys) {
    if (props?.[key] != null) return { key, value: props[key] };
  }
  return null;
}

function extractObservation(props, family) {
  if (family === 'weather') {
    const candidates = [
      ['air_temp', 'air_temp-value', 'avg_air_temp_pst1hr', 'avg_air_temp_pst1hr-value'],
      ['rel_hum', 'rel_hum-value']
    ];
    const observedAt = props['date_tm-value'] || props.date_tm || null;
    for (const keys of candidates) {
      const hit = propValue(props, keys);
      if (hit) {
        return {
          property: hit.key.replace(/-value$/, ''),
          value: hit.value,
          unit: props[`${hit.key}-uom`] || props[`${hit.key.replace(/-value$/, '')}-uom`] || (hit.key.includes('hum') ? '%' : 'C'),
          observedAt
        };
      }
    }
    return null;
  }
  if (family === 'weather-current') {
    const temp = props.currentConditions?.temperature;
    const value = temp?.value?.en ?? temp?.value;
    if (value == null) return null;
    return {
      property: 'temperature',
      value,
      unit: temp?.units?.en ?? temp?.units ?? 'C',
      observedAt: props.currentConditions?.timestamp?.en ?? props.lastUpdated ?? null
    };
  }
  if (family === 'air-quality' && props.aqhi != null) {
    return {
      property: 'aqhi',
      value: props.aqhi,
      unit: 'AQHI',
      observedAt: props.observation_datetime || null
    };
  }
  if (family === 'climate') {
    const mean = props.MEAN_TEMPERATURE ?? props.MEAN_TEMP;
    if (mean != null) {
      return {
        property: 'MEAN_TEMPERATURE',
        value: mean,
        unit: 'C',
        observedAt: props.LOCAL_DATE || props.CLIMATE_DATE || null
      };
    }
  }
  if (family === 'climate-hourly' && props.TEMP != null) {
    return { property: 'TEMP', value: props.TEMP, unit: 'C', observedAt: props.LOCAL_DATE || null };
  }
  if (family === 'hydrometric-measurement') {
    if (props.LEVEL != null) {
      return { property: 'LEVEL', value: props.LEVEL, unit: 'm', observedAt: props.DATETIME || props.DATETIME_LST || null };
    }
    if (props.DISCHARGE != null) {
      return { property: 'DISCHARGE', value: props.DISCHARGE, unit: 'm3/s', observedAt: props.DATETIME || props.DATETIME_LST || null };
    }
  }
  return null;
}

async function fetchFamily(spec, longitude, latitude, requestedRadius, retrievedAt) {
  const radiusMeters = Math.max(requestedRadius || 3000, spec.radiusMeters);
  const bbox = pointBbox(longitude, latitude, radiusMeters);
  const params = new URLSearchParams({
    bbox,
    limit: String(FETCH_LIMIT)
  });
  if (spec.sortBy) params.set('sortby', spec.sortBy);
  const url = `${MSC_ROOT}/${spec.nativeId}/items?${params.toString()}`;
  const collectionUrl = `${MSC_ROOT}/${spec.nativeId}`;
  const queryReceiptId = iqaiId('qreceipt');
  const queryRequestId = iqaiId('qrequest');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FAMILY_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      headers: { Accept: 'application/geo+json, application/json' },
      signal: controller.signal
    });
    if (!response.ok) {
      return {
        informationFamily: spec.informationFamily,
        nativeId: spec.nativeId,
        status: 'PROVIDER_UNAVAILABLE',
        operatorStatus: 'UNAVAILABLE',
        resultCount: 0,
        results: [],
        error: `MSC GeoMet HTTP ${response.status}`,
        queryReceiptId,
        queryRequestId,
        temporalClassification: spec.temporalClassification
      };
    }
    const body = await response.json().catch(() => ({}));
    const features = Array.isArray(body.features) ? body.features : [];
    const withinRadius = [];
    for (const feature of features) {
      const point = featurePoint(feature);
      const distance = point
        ? haversineMeters(longitude, latitude, point.longitude, point.latitude)
        : null;
      if (distance != null && distance > radiusMeters) continue;
      const props = { ...(feature.properties || {}) };
      const nativeId = feature.id || props.STATION_NUMBER || props.CLIMATE_IDENTIFIER || props.id;
      const observation = extractObservation(props, spec.informationFamily);
      const temporal = extractTemporal(props, spec.informationFamily);
      const stationName = props.STATION_NAME
        || props['stn_nam-value']
        || props.stn_nam
        || (typeof props.name === 'object' ? (props.name?.en || props.name?.fr) : props.name)
        || props.CITY
        || null;
      withinRadius.push({
        resultId: iqaiId('result'),
        queryRequestId,
        queryReceiptId,
        providerName: PROVIDER,
        stationName,
        protocolFamily: PROTOCOL,
        nativeCollectionId: spec.nativeId,
        nativeRecordId: nativeId,
        category: spec.informationFamily,
        resultKind: spec.resultKind,
        temporalClassification: spec.temporalClassification,
        geometry: feature.geometry || null,
        spatialPrecision: feature.geometry?.type === 'Point' ? 'SOURCE_POINT' : 'SOURCE_GEOMETRY',
        clickDistanceMeters: distance,
        temporal,
        observation,
        properties: props,
        retrievedAt,
        provenance: {
          queryReceiptId,
          provider: PROVIDER,
          dataset: spec.nativeId,
          source: collectionUrl,
          sourceUrl: url,
          clickedLongitude: longitude,
          clickedLatitude: latitude,
          stationLongitude: point?.longitude ?? null,
          stationLatitude: point?.latitude ?? null,
          distanceMeters: distance,
          retrievalTimestamp: retrievedAt,
          observationTimestamp: observation?.observedAt
            || temporal?.LOCAL_DATE
            || temporal?.observation_datetime
            || temporal?.['date_tm-value']
            || temporal?.lastUpdated
            || null
        }
      });
    }
    withinRadius.sort((a, b) => {
      if (spec.informationFamily === 'climate') {
        const aHas = a.observation ? 0 : 1;
        const bHas = b.observation ? 0 : 1;
        if (aHas !== bHas) return aHas - bHas;
      }
      return (a.clickDistanceMeters ?? Infinity) - (b.clickDistanceMeters ?? Infinity);
    });
    const results = withinRadius.slice(0, MAX_RESULTS);
    return {
      informationFamily: spec.informationFamily,
      nativeId: spec.nativeId,
      status: results.length ? 'SUCCESS' : 'NO_RESULTS',
      operatorStatus: results.length ? 'PASS' : 'NO DATA',
      resultCount: results.length,
      results,
      error: null,
      queryReceiptId,
      queryRequestId,
      temporalClassification: spec.temporalClassification
    };
  } catch (error) {
    const timeout = error?.name === 'AbortError';
    return {
      informationFamily: spec.informationFamily,
      nativeId: spec.nativeId,
      status: timeout ? 'QUERY_TIMEOUT' : 'ERROR',
      operatorStatus: timeout ? 'TIMEOUT' : 'ERROR',
      resultCount: 0,
      results: [],
      error: timeout ? 'MSC GeoMet request timed out' : (error?.message || String(error)),
      queryReceiptId,
      queryRequestId,
      temporalClassification: spec.temporalClassification
    };
  } finally {
    clearTimeout(timer);
  }
}

function resolveBundleState(families) {
  const statuses = families.map((f) => f.status);
  const hasSuccess = statuses.some((s) => s === 'SUCCESS');
  const hasFailure = statuses.some((s) => ['PROVIDER_UNAVAILABLE', 'QUERY_TIMEOUT', 'ERROR'].includes(s));
  const hasNoResults = statuses.some((s) => s === 'NO_RESULTS');
  if (hasSuccess && (hasFailure || hasNoResults)) return 'PARTIAL_RESULTS';
  if (hasSuccess) return 'SUCCESS';
  if (hasFailure && !hasSuccess) return hasNoResults ? 'PARTIAL_RESULTS' : 'PARTIAL_FAILURE';
  if (hasNoResults) return 'PARTIAL_RESULTS';
  return 'PARTIAL_FAILURE';
}

/**
 * @param {{ geometry?: { coordinates?: number[] }, radiusMeters?: number }} request
 */
export async function executeMscPointIntelligenceBundle(request = {}) {
  const [longitude, latitude] = request.geometry?.coordinates || [];
  const radiusMeters = Number(request.radiusMeters) > 0 ? Number(request.radiusMeters) : 3000;
  const startedAt = new Date().toISOString();
  const t0 = Date.now();
  const bundleId = iqaiId('bundle');
  const orchestrationId = iqaiId('bundleorch');

  const settled = await Promise.allSettled(
    FAMILY_SPECS.map((spec) => fetchFamily(spec, longitude, latitude, radiusMeters, startedAt))
  );
  const families = settled.map((entry, index) => {
    if (entry.status === 'fulfilled') return entry.value;
    const spec = FAMILY_SPECS[index];
    return {
      informationFamily: spec.informationFamily,
      nativeId: spec.nativeId,
      status: 'ERROR',
      operatorStatus: 'ERROR',
      resultCount: 0,
      results: [],
      error: entry.reason?.message || String(entry.reason),
      temporalClassification: spec.temporalClassification
    };
  });

  const bundleState = resolveBundleState(families);
  const completedAt = new Date().toISOString();
  return {
    schemaVersion: '1.0.0',
    bundleId,
    orchestrationId,
    bundleState,
    query: {
      schemaVersion: '1.0.0',
      geometry: { type: 'Point', coordinates: [longitude, latitude] },
      radiusMeters,
      domains: [],
      selectionMode: 'AUTO',
      informationFamilies: 'AUTO',
      temporalIntent: { mode: 'LATEST' }
    },
    plannerDecision: {
      selectionMode: 'AUTO',
      informationFamilies: 'AUTO',
      fallback: 'MSC_GEOMET_DIRECT',
      eligible: FAMILY_SPECS.map((spec) => spec.nativeId)
    },
    families,
    queryReceipts: families.map((f) => ({ queryReceiptId: f.queryReceiptId })).filter((r) => r.queryReceiptId),
    relationships: {
      familyAvailability: {
        requested: POINT_INTELLIGENCE_FAMILY_ORDER.length,
        withResults: families.filter((f) => f.resultCount > 0).length
      }
    },
    networkRequests: FAMILY_SPECS.length,
    error: null,
    fallback: 'MSC_GEOMET_DIRECT',
    queryTimestamp: startedAt,
    clicked: { longitude, latitude },
    timings: {
      startedAt,
      completedAt,
      totalMs: Date.now() - t0
    }
  };
}

export function shouldUseMscFallback(brokerResult) {
  if (!brokerResult) return true;
  if (!brokerResult.ok) return true;
  const body = brokerResult.body || {};
  if (!Array.isArray(body.families) || body.families.length === 0) return true;
  if (body.bundleState === 'NO_VERIFIED_CAPABILITY' || body.bundleState === 'NO_APPLICABLE_CAPABILITY') {
    return true;
  }
  return false;
}
