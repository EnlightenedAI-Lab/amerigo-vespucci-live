import { looksLikeWgs84Degrees, webMercatorToWgs84 } from './arcgis-geometry.js';
import { classifyFreshness, positionAgeSeconds } from './freshness.js';
import { CONDITIONS_ATTRIBUTION, CONDITIONS_BASIS } from './openmeteo.js';
import { ESTIMATED_ROUTE_BASIS } from './navigation.js';
import { stripSensitiveFields } from './security.js';

const EMPTY_COLLECTION = { type: 'FeatureCollection', features: [] };

const VESSEL_FIELDS = 'MMSI,VesselName,SpeedKnots,Course,Heading,Latitude,Longitude,LastAIS,Destination,NavStatus';
const HISTORY_FIELDS = `${VESSEL_FIELDS},Source,PositionKey`;
const TRAVELLED_ROUTE_FIELDS = 'MMSI,VesselName,RouteType,PointCount,StartAIS,EndAIS,LastUpdated';
const DESTINATION_FIELDS = 'DestinationName,PortCode,Latitude,Longitude,UpdatedAt';
const ESTIMATED_ROUTE_FIELDS = 'MMSI,VesselName,DestinationName,RouteType,DistanceNM,SpeedKnots,EstimatedETA,CalculatedAt,Basis';
const CONDITIONS_FIELDS = 'MMSI,VesselName,Latitude,Longitude,VesselAIS,ConditionsAt,WeatherAt,MarineAt,UpdatedAt,WeatherStatus,MarineStatus,Attribution,Basis,AirTempC,FeelsLikeC,HumidityPct,PrecipMM,WeatherCode,WeatherText,CloudPct,PressureHPA,VisibilityKM,WindKnots,WindFromDeg,GustKnots,WaveHeightM,WaveFromDeg,WavePeriodS,WindWaveM,WindWaveFrom,WindWaveSec,SwellHeightM,SwellFromDeg,SwellPeriodS,SeaTempC,CurrentKnots,CurrentToDeg,SeaLevelM,MaxWind24Kn,MaxGust24Kn,MinVis24KM,Precip24MM,MaxWave24M,MaxSwell24M,MaxCurrent24Kn,ForecastStart,ForecastEnd';

/**
 * Convert an ArcGIS epoch-ms date field to ISO string.
 * @param {number|string|null|undefined} value
 * @returns {string|null}
 */
export function arcgisDateToIso(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  const date = new Date(n);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

/**
 * Normalize ArcGIS attributes for API output.
 * @param {Record<string, unknown>} attrs
 * @returns {Record<string, unknown>}
 */
export function normalizeAttributes(attrs = {}) {
  const result = {};
  for (const [key, value] of Object.entries(attrs)) {
    if (key === 'OBJECTID') continue;
    if (key.endsWith('At') || key === 'LastAIS' || key === 'StartAIS' || key === 'EndAIS' || key === 'EstimatedETA' || key === 'CalculatedAt' || key === 'UpdatedAt' || key === 'LastUpdated' || key === 'VesselAIS' || key === 'ForecastStart' || key === 'ForecastEnd') {
      result[key] = arcgisDateToIso(value);
    } else {
      result[key] = value;
    }
  }
  return result;
}

/**
 * Convert ArcGIS point geometry to GeoJSON coordinates [lon, lat].
 * @param {{ x?: number, y?: number }|null} geometry
 * @param {Record<string, unknown>} [attrs]
 * @returns {[number, number]|null}
 */
function normalizeVertex(lon, lat, attrs = {}) {
  const attrLon = Number(attrs.Longitude);
  const attrLat = Number(attrs.Latitude);
  if (looksLikeWgs84Degrees(attrLon, attrLat)) return [attrLon, attrLat];
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
  if (looksLikeWgs84Degrees(lon, lat)) return [lon, lat];
  if (Math.abs(lon) > 180 || Math.abs(lat) > 90) return webMercatorToWgs84(lon, lat);
  return [lon, lat];
}

export function pointToCoordinates(geometry, attrs = {}) {
  const lon = Number(geometry?.x);
  const lat = Number(geometry?.y);
  if (Number.isFinite(lon) && Number.isFinite(lat)) {
    return normalizeVertex(lon, lat, attrs);
  }
  const attrLon = Number(attrs.Longitude);
  const attrLat = Number(attrs.Latitude);
  if (looksLikeWgs84Degrees(attrLon, attrLat)) return [attrLon, attrLat];
  return null;
}

/**
 * Convert ArcGIS polyline geometry to GeoJSON LineString coordinates.
 * @param {{ paths?: number[][][] }|null} geometry
 * @returns {number[][]|null}
 */
export function polylineToCoordinates(geometry, attrs = {}) {
  const path = geometry?.paths?.[0];
  if (!Array.isArray(path) || path.length < 2) return null;
  const coords = path.map((vertex) => {
    if (typeof vertex === 'string') {
      const parts = vertex.trim().split(/\s+/);
      return normalizeVertex(Number(parts[0]), Number(parts[1]), attrs);
    }
    return normalizeVertex(Number(vertex[0]), Number(vertex[1]), attrs);
  }).filter(Boolean);
  return coords.length >= 2 ? coords : null;
}

/**
 * @param {'Point'|'LineString'} type
 * @param {number[]|number[][]} coordinates
 * @param {Record<string, unknown>} properties
 * @returns {import('geojson').Feature|null}
 */
export function toGeoJsonFeature(type, coordinates, properties) {
  if (!coordinates) return null;
  return { type: 'Feature', geometry: { type, coordinates }, properties: normalizeAttributes(properties) };
}

/**
 * @param {Array<import('geojson').Feature|null|undefined>} features
 * @returns {import('geojson').FeatureCollection}
 */
export function toFeatureCollection(features) {
  return { type: 'FeatureCollection', features: features.filter(Boolean) };
}

/**
 * @param {Array<{ geometry?: object, attributes?: Record<string, unknown> }>} arcgisFeatures
 * @param {'point'|'polyline'} geometryType
 * @returns {import('geojson').FeatureCollection}
 */
export function arcgisFeaturesToGeoJson(arcgisFeatures, geometryType) {
  const features = (arcgisFeatures || []).map((f) => {
    if (geometryType === 'point') {
      const coords = pointToCoordinates(f.geometry, f.attributes);
      return toGeoJsonFeature('Point', coords, f.attributes || {});
    }
    const coords = polylineToCoordinates(f.geometry, f.attributes || {});
    return toGeoJsonFeature('LineString', coords, f.attributes || {});
  });
  return toFeatureCollection(features);
}

/**
 * Read-only map data service — queries ArcGIS layers only.
 */
export class MapApiService {
  /**
   * @param {import('./arcgis.js').ArcGISClient} arcgis
   * @param {ReturnType<import('./config.js').loadConfig>} config
   * @param {object} [state]
   */
  constructor(arcgis, config, state = {}) {
    this.arcgis = arcgis;
    this.config = config;
    this.state = state;
  }

  async queryLayer(layerId, where, outFields, geometryType = 'point', options = {}) {
    const params = new URLSearchParams({
      f: 'json',
      where,
      outFields,
      returnGeometry: 'true',
      ...(options.orderByFields ? { orderByFields: options.orderByFields } : {}),
      ...(options.resultRecordCount ? { resultRecordCount: String(options.resultRecordCount) } : {})
    });
    const data = await this.arcgis.get(`${this.arcgis.layerUrl(layerId)}/query?${params}`);
    if (data.error) throw new Error(`Layer ${layerId} query failed`);
    return arcgisFeaturesToGeoJson(data.features || [], geometryType);
  }

  async getVessel() {
    const collection = await this.queryLayer(
      this.config.currentLayerId,
      `MMSI=${this.config.targetMmsi}`,
      VESSEL_FIELDS,
      'point'
    );
    const feature = collection.features[0] || null;
    const lastAIS = feature?.properties?.LastAIS || null;
    const source = this.state.lastPositionSource || null;
    return {
      geojson: feature ? { type: 'FeatureCollection', features: [feature] } : EMPTY_COLLECTION,
      properties: feature?.properties || null,
      freshness: classifyFreshness(lastAIS),
      ageSeconds: positionAgeSeconds(lastAIS),
      lastAIS,
      source,
      empty: !feature
    };
  }

  async getHistory() {
    const geojson = await this.queryLayer(
      this.config.historyLayerId,
      `MMSI=${this.config.targetMmsi}`,
      HISTORY_FIELDS,
      'point',
      { orderByFields: 'LastAIS ASC', resultRecordCount: this.config.routeMaxHistoryPoints }
    );
    return {
      geojson,
      count: geojson.features.length,
      label: 'Observed AIS track',
      empty: geojson.features.length === 0
    };
  }

  async getTravelledRoute() {
    const geojson = await this.queryLayer(
      this.config.travelledRouteLayerId,
      `MMSI=${this.config.targetMmsi}`,
      TRAVELLED_ROUTE_FIELDS,
      'polyline'
    );
    const props = geojson.features[0]?.properties || {};
    return {
      geojson,
      label: props.RouteType || 'Observed AIS track',
      pointCount: props.PointCount ?? null,
      empty: geojson.features.length === 0
    };
  }

  async getDestination() {
    const geojson = await this.queryLayer(
      this.config.destinationLayerId,
      '1=1',
      DESTINATION_FIELDS,
      'point'
    );
    return {
      geojson,
      properties: geojson.features[0]?.properties || null,
      empty: geojson.features.length === 0
    };
  }

  async getEstimatedRoute() {
    const geojson = await this.queryLayer(
      this.config.estimatedRouteLayerId,
      `MMSI=${this.config.targetMmsi}`,
      ESTIMATED_ROUTE_FIELDS,
      'polyline'
    );
    const props = geojson.features[0]?.properties || {};
    return {
      geojson,
      label: props.RouteType || 'Straight-line estimate',
      basis: props.Basis || ESTIMATED_ROUTE_BASIS,
      disclaimer: 'Straight-line estimate — not an official navigational route',
      distanceNM: props.DistanceNM ?? null,
      estimatedETA: props.EstimatedETA ?? null,
      empty: geojson.features.length === 0
    };
  }

  async getConditions() {
    const geojson = await this.queryLayer(
      this.config.conditionsLayerId,
      `MMSI=${this.config.targetMmsi}`,
      CONDITIONS_FIELDS,
      'point'
    );
    const props = geojson.features[0]?.properties || null;
    return {
      geojson,
      properties: props,
      warning: CONDITIONS_BASIS,
      attribution: props?.Attribution || CONDITIONS_ATTRIBUTION,
      weatherStatus: props?.WeatherStatus || null,
      marineStatus: props?.MarineStatus || null,
      conditionsAt: props?.ConditionsAt || null,
      empty: geojson.features.length === 0
    };
  }

  async getMapData() {
    const [vessel, history, travelledRoute, destination, estimatedRoute, conditions] = await Promise.all([
      this.getVessel(),
      this.getHistory(),
      this.getTravelledRoute(),
      this.getDestination(),
      this.getEstimatedRoute(),
      this.getConditions()
    ]);
    const fetchedAt = new Date().toISOString();
    return stripSensitiveFields({
      vessel,
      history,
      travelledRoute,
      destination,
      estimatedRoute,
      conditions,
      meta: {
        fetchedAt,
        mmsi: this.config.targetMmsi,
        source: 'arcgis',
        freshness: {
          vessel: vessel.freshness,
          vesselAgeSeconds: vessel.ageSeconds,
          vesselLastAIS: vessel.lastAIS
        },
        timestamps: {
          lastArcGISUpdate: this.state.lastArcGISUpdate?.toISOString() || null,
          lastHistoryWrite: this.state.lastHistoryWrite?.toISOString() || null,
          lastTravelledRouteUpdate: this.state.lastTravelledRouteUpdate?.toISOString() || null,
          lastDestinationUpdate: this.state.lastDestinationUpdate?.toISOString() || null,
          lastEstimatedRouteUpdate: this.state.lastEstimatedRouteUpdate?.toISOString() || null,
          lastConditionsUpdate: this.state.openMeteoClient?.health?.().lastConditionsUpdate || null
        }
      }
    });
  }
}

/**
 * Create cached read handlers for map API endpoints.
 * @param {MapApiService} mapApi
 * @param {import('./map-cache.js').MapCache} cache
 */
export function createMapApiHandlers(mapApi, cache) {
  async function cached(key, fetcher) {
    const hit = cache.get(key);
    if (hit) return { ...hit.data, cached: true, fetchedAt: hit.fetchedAt.toISOString(), expiresAt: hit.expiresAt.toISOString() };
    const data = await fetcher();
    const entry = cache.set(key, data);
    return { ...data, cached: false, fetchedAt: entry.fetchedAt.toISOString(), expiresAt: entry.expiresAt.toISOString() };
  }

  return {
    vessel: () => cached('vessel', () => mapApi.getVessel()),
    history: () => cached('history', () => mapApi.getHistory()),
    travelledRoute: () => cached('travelledRoute', () => mapApi.getTravelledRoute()),
    destination: () => cached('destination', () => mapApi.getDestination()),
    estimatedRoute: () => cached('estimatedRoute', () => mapApi.getEstimatedRoute()),
    conditions: () => cached('conditions', () => mapApi.getConditions()),
    mapData: () => cached('mapData', () => mapApi.getMapData())
  };
}
