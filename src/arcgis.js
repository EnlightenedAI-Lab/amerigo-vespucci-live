import { logger } from './logger.js';
import { CONDITIONS_ATTRIBUTION, CONDITIONS_BASIS } from './openmeteo.js';
import { calculateEstimatedETA, createPositionKey, ESTIMATED_ROUTE_BASIS, haversineDistanceNM, parseDestinationConfig } from './navigation.js';
import {
  validateWebMercatorGeometry,
  webMercatorPointFromWgs84,
  webMercatorPolylineFromWgs84Points
} from './arcgis-geometry.js';

const FIELD_MAP = {
  MMSI: 'MMSI', VesselName: 'VesselName', SpeedKnots: 'SpeedKnots', Course: 'Course', Heading: 'Heading',
  Latitude: 'Latitude', Longitude: 'Longitude', LastAIS: 'LastAIS', Destination: 'Destination', NavStatus: 'NavStatus', Source: 'Source', PositionKey: 'PositionKey'
};

const TOKEN_EXPIRED_CODES = new Set([498, 499]);
const GENERATED_TOKEN_MINUTES = 120;
const TOKEN_RENEWAL_BUFFER_MS = 5 * 60 * 1000;

export class ArcGISClient {
  constructor(config) {
    this.config = config;
    this.token = config.arcgisToken;
    this.generatedTokenExpiresAt = null;
    this.featureServiceUrl = null;
    this.currentObjectId = null;
    this.travelledRouteObjectId = null;
    this.destinationObjectId = null;
    this.estimatedRouteObjectId = null;
    this.conditionsObjectId = null;
    this.conditionsWeatherAt = null;
    this.conditionsMarineAt = null;
  }

  async initialize() {
    await this.ensureValidToken();
    this.featureServiceUrl = this.config.arcgisFeatureServiceUrl
      || await this.resolveFeatureServiceUrl();
    this.currentObjectId = await this.findCurrentFeatureObjectId();
    if (this.config.enableConditions) await this.initializeConditionsFeature();
    logger.info('ArcGIS client initialized', { featureServiceUrl: this.featureServiceUrl, currentObjectId: this.currentObjectId });
  }

  canGenerateToken() { return Boolean(this.config.arcgisUsername && this.config.arcgisPassword); }
  async ensureValidToken() {
    if (!this.token || (this.generatedTokenExpiresAt && Date.now() > this.generatedTokenExpiresAt.getTime() - TOKEN_RENEWAL_BUFFER_MS)) await this.refreshToken();
  }
  async refreshToken() {
    if (!this.canGenerateToken()) throw new Error('ArcGIS token is missing or expired and ARCGIS_USERNAME/ARCGIS_PASSWORD are not configured for automatic renewal.');
    this.token = await this.generateToken();
    this.generatedTokenExpiresAt = new Date(Date.now() + GENERATED_TOKEN_MINUTES * 60 * 1000);
    logger.info('ArcGIS token renewed', { expiresAt: this.generatedTokenExpiresAt.toISOString() });
  }
  async generateToken() {
    const body = new URLSearchParams({ f: 'json', username: this.config.arcgisUsername, password: this.config.arcgisPassword, client: 'requestip', expiration: String(GENERATED_TOKEN_MINUTES) });
    const data = await this.rawPost(`${this.config.arcgisPortalUrl}/sharing/rest/generateToken`, body);
    if (!data.token) throw new Error(`ArcGIS token generation failed: ${JSON.stringify(data)}`);
    return data.token;
  }
  async resolveFeatureServiceUrl() {
    const item = await this.get(`${this.config.arcgisPortalUrl}/sharing/rest/content/items/${this.config.arcgisItemId}?f=json`);
    if (!item.url) throw new Error(`Could not resolve ArcGIS item URL: ${JSON.stringify(item)}`);
    return item.url;
  }
  layerUrl(layerId = this.config.currentLayerId) { return `${this.featureServiceUrl}/${layerId}`; }

  pointGeometryForWebMercatorLayer(longitude, latitude, context) {
    const geometry = webMercatorPointFromWgs84(longitude, latitude);
    validateWebMercatorGeometry(geometry, context);
    return geometry;
  }

  polylineGeometryForWebMercatorLayer(points, context) {
    const geometry = webMercatorPolylineFromWgs84Points(points);
    validateWebMercatorGeometry(geometry, context);
    return geometry;
  }


  async initializeConditionsFeature() {
    try {
      const params = new URLSearchParams({ f: 'json', where: `MMSI=${this.config.targetMmsi}`, outFields: 'OBJECTID,WeatherAt,MarineAt', returnGeometry: 'false' });
      const data = await this.get(`${this.layerUrl(this.config.conditionsLayerId)}/query?${params}`);
      const attrs = data.features?.[0]?.attributes;
      this.conditionsObjectId = attrs?.OBJECTID || null;
      this.conditionsWeatherAt = attrs?.WeatherAt ? new Date(attrs.WeatherAt) : null;
      this.conditionsMarineAt = attrs?.MarineAt ? new Date(attrs.MarineAt) : null;
    } catch (error) {
      logger.warn('Optional conditions layer initialization failed', { error: error.message });
    }
  }

  async upsertConditions(position, weather, marine) {
    const attrs = {
      MMSI: position.mmsi, VesselName: position.vesselName || 'Amerigo Vespucci', Latitude: position.latitude, Longitude: position.longitude,
      VesselAIS: position.lastAIS.getTime(), UpdatedAt: Date.now(), WeatherStatus: weather.status, MarineStatus: marine.status,
      Attribution: CONDITIONS_ATTRIBUTION, Basis: CONDITIONS_BASIS
    };
    if (weather.status === 'ok' && (!this.conditionsWeatherAt || weather.validTime > this.conditionsWeatherAt)) Object.assign(attrs, weather.attributes);
    if (marine.status === 'ok' && (!this.conditionsMarineAt || marine.validTime > this.conditionsMarineAt)) Object.assign(attrs, marine.attributes);
    const sourceTimes = [attrs.WeatherAt, attrs.MarineAt, this.conditionsWeatherAt?.getTime(), this.conditionsMarineAt?.getTime()].filter(Number.isFinite);
    if (sourceTimes.length) attrs.ConditionsAt = Math.max(...sourceTimes);
    if (this.conditionsObjectId) attrs.OBJECTID = this.conditionsObjectId;
    const feature = {
      attributes: attrs,
      geometry: this.pointGeometryForWebMercatorLayer(position.longitude, position.latitude, 'conditions layer')
    };
    const endpoint = this.conditionsObjectId ? 'updateFeatures' : 'addFeatures';
    const data = await this.post(this.layerUrl(this.config.conditionsLayerId), endpoint, new URLSearchParams({ f: 'json', features: JSON.stringify([feature]) }));
    const result = data.updateResults?.[0] || data.addResults?.[0];
    if (!result?.success) throw new Error(`ArcGIS conditions ${endpoint} failed: ${JSON.stringify(data)}`);
    if (!this.conditionsObjectId) this.conditionsObjectId = result.objectId;
    if (attrs.WeatherAt) this.conditionsWeatherAt = new Date(attrs.WeatherAt);
    if (attrs.MarineAt) this.conditionsMarineAt = new Date(attrs.MarineAt);
  }

  async findCurrentFeatureObjectId() { return this.findObjectId(this.config.currentLayerId, `MMSI=${this.config.targetMmsi}`); }

  async queryCurrentFeature() {
    const params = new URLSearchParams({
      f: 'json',
      where: `MMSI=${this.config.targetMmsi}`,
      outFields: '*',
      returnGeometry: 'true',
      resultRecordCount: '1'
    });
    const data = await this.get(`${this.layerUrl()}/query?${params}`);
    return data.features?.[0] || null;
  }

  async countHistoryFeatures() {
    const params = new URLSearchParams({ f: 'json', where: `MMSI=${this.config.targetMmsi}`, returnCountOnly: 'true' });
    const data = await this.get(`${this.layerUrl(this.config.historyLayerId)}/query?${params}`);
    return Number(data.count ?? 0);
  }
  async findObjectId(layerId, where) {
    const params = new URLSearchParams({ f: 'json', where, outFields: 'OBJECTID', returnGeometry: 'false' });
    const data = await this.get(`${this.layerUrl(layerId)}/query?${params}`);
    return data.features?.[0]?.attributes?.OBJECTID || null;
  }

  toFeature(position, options = {}) {
    const { includeObjectId = true, source = null, positionKey = null } = options;
    const attributes = {
      [FIELD_MAP.MMSI]: position.mmsi, [FIELD_MAP.VesselName]: position.vesselName || 'Amerigo Vespucci', [FIELD_MAP.SpeedKnots]: position.speedKnots,
      [FIELD_MAP.Course]: position.course, [FIELD_MAP.Heading]: position.heading, [FIELD_MAP.Latitude]: position.latitude, [FIELD_MAP.Longitude]: position.longitude,
      [FIELD_MAP.LastAIS]: position.lastAIS.getTime(), [FIELD_MAP.Destination]: position.destination || null, [FIELD_MAP.NavStatus]: position.navStatus || null
    };
    if (source) attributes[FIELD_MAP.Source] = source;
    if (positionKey) attributes[FIELD_MAP.PositionKey] = positionKey;
    if (includeObjectId && this.currentObjectId) attributes.OBJECTID = this.currentObjectId;
    return { attributes, geometry: { x: position.longitude, y: position.latitude, spatialReference: { wkid: 4326 } } };
  }

  async upsertCurrentPosition(position) {
    const feature = this.toFeature(position, { includeObjectId: Boolean(this.currentObjectId) });
    const endpoint = this.currentObjectId ? 'updateFeatures' : 'addFeatures';
    const data = await this.post(this.layerUrl(), endpoint, new URLSearchParams({ f: 'json', features: JSON.stringify([feature]) }));
    const result = data.updateResults?.[0] || data.addResults?.[0];
    if (!result?.success) throw new Error(`ArcGIS ${endpoint} failed: ${JSON.stringify(data)}`);
    if (!this.currentObjectId) this.currentObjectId = result.objectId;
    logger.info('ArcGIS current position updated', { objectId: this.currentObjectId, lastAIS: position.lastAIS.toISOString() });
  }

  async addHistoryPosition(position, source) {
    const positionKey = createPositionKey(position, source);
    if (await this.historyPositionExists(positionKey)) return { inserted: false, reason: 'duplicate-position-key' };
    const latest = await this.getLatestHistoryTimestamp();
    if (latest && position.lastAIS <= latest) return { inserted: false, reason: 'not-newer-than-latest-history' };
    const feature = this.toFeature(position, { includeObjectId: false, source, positionKey });
    feature.geometry = this.pointGeometryForWebMercatorLayer(position.longitude, position.latitude, 'history layer');
    const data = await this.post(this.layerUrl(this.config.historyLayerId), 'addFeatures', new URLSearchParams({ f: 'json', features: JSON.stringify([feature]) }));
    const result = data.addResults?.[0];
    if (!result?.success) throw new Error(`ArcGIS history insert failed: ${JSON.stringify(data)}`);
    return { inserted: true, positionKey };
  }

  async historyPositionExists(positionKey) {
    const params = new URLSearchParams({ f: 'json', where: `PositionKey='${escapeSql(positionKey)}'`, outFields: 'OBJECTID', returnGeometry: 'false' });
    const data = await this.get(`${this.layerUrl(this.config.historyLayerId)}/query?${params}`);
    return Boolean(data.features?.length);
  }
  async getLatestHistoryTimestamp() {
    const params = new URLSearchParams({ f: 'json', where: `MMSI=${this.config.targetMmsi}`, outFields: 'LastAIS', returnGeometry: 'false', orderByFields: 'LastAIS DESC', resultRecordCount: '1' });
    const data = await this.get(`${this.layerUrl(this.config.historyLayerId)}/query?${params}`);
    const value = data.features?.[0]?.attributes?.LastAIS;
    return value ? new Date(value) : null;
  }
  async queryHistoryPoints(_config) {
    const params = new URLSearchParams({ f: 'json', where: `MMSI=${this.config.targetMmsi}`, outFields: 'MMSI,VesselName,LastAIS,Latitude,Longitude', returnGeometry: 'true', orderByFields: 'LastAIS ASC', resultRecordCount: String(this.config.routeMaxHistoryPoints) });
    const data = await this.get(`${this.layerUrl(this.config.historyLayerId)}/query?${params}`);
    return (data.features || []).map((f) => ({
      attributes: f.attributes,
      latitude: Number(f.attributes?.Latitude),
      longitude: Number(f.attributes?.Longitude)
    })).filter((p) => Number.isFinite(p.latitude) && Number.isFinite(p.longitude));
  }

  async upsertTravelledRoute() {
    const points = await this.queryHistoryPoints();
    if (points.length < 2) return { updated: false, pointCount: points.length };
    if (!this.travelledRouteObjectId) this.travelledRouteObjectId = await this.findObjectId(this.config.travelledRouteLayerId, `MMSI=${this.config.targetMmsi}`);
    const attrs = { MMSI: this.config.targetMmsi, VesselName: points.at(-1).attributes?.VesselName || 'Amerigo Vespucci', RouteType: 'Observed AIS track', PointCount: points.length, StartAIS: points[0].attributes.LastAIS, EndAIS: points.at(-1).attributes.LastAIS, LastUpdated: Date.now() };
    if (this.travelledRouteObjectId) attrs.OBJECTID = this.travelledRouteObjectId;
    const data = await this.post(this.layerUrl(this.config.travelledRouteLayerId), this.travelledRouteObjectId ? 'updateFeatures' : 'addFeatures', new URLSearchParams({ f: 'json', features: JSON.stringify([{ attributes: attrs, geometry: this.polylineGeometryForWebMercatorLayer(points.map((p) => ({ longitude: p.longitude, latitude: p.latitude })), 'travelled route layer') }]) }));
    const result = data.updateResults?.[0] || data.addResults?.[0];
    if (!result?.success) throw new Error(`ArcGIS travelled route upsert failed: ${JSON.stringify(data)}`);
    if (!this.travelledRouteObjectId) this.travelledRouteObjectId = result.objectId;
    return { updated: true, pointCount: points.length };
  }

  async upsertDestination() {
    const d = parseDestinationConfig(this.config);
    if (!this.destinationObjectId) this.destinationObjectId = await this.findObjectId(this.config.destinationLayerId, `PortCode='${escapeSql(d.portCode)}'`);
    const attrs = { DestinationName: d.name, PortCode: d.portCode, Latitude: d.latitude, Longitude: d.longitude, UpdatedAt: Date.now() };
    if (this.destinationObjectId) attrs.OBJECTID = this.destinationObjectId;
    const data = await this.post(this.layerUrl(this.config.destinationLayerId), this.destinationObjectId ? 'updateFeatures' : 'addFeatures', new URLSearchParams({ f: 'json', features: JSON.stringify([{ attributes: attrs, geometry: this.pointGeometryForWebMercatorLayer(d.longitude, d.latitude, 'destination layer') }]) }));
    const result = data.updateResults?.[0] || data.addResults?.[0];
    if (!result?.success) throw new Error(`ArcGIS destination upsert failed: ${JSON.stringify(data)}`);
    if (!this.destinationObjectId) this.destinationObjectId = result.objectId;
  }

  async upsertEstimatedRoute(position) {
    const d = parseDestinationConfig(this.config);
    const distanceNM = haversineDistanceNM(position, d);
    const eta = calculateEstimatedETA(position.lastAIS, distanceNM, position.speedKnots, this.config.etaMinSpeedKnots);
    if (!this.estimatedRouteObjectId) this.estimatedRouteObjectId = await this.findObjectId(this.config.estimatedRouteLayerId, `MMSI=${this.config.targetMmsi}`);
    const attrs = { MMSI: position.mmsi, VesselName: position.vesselName || 'Amerigo Vespucci', DestinationName: d.name, RouteType: 'Straight-line estimate', DistanceNM: distanceNM, SpeedKnots: position.speedKnots, EstimatedETA: eta?.getTime() || null, CalculatedAt: Date.now(), Basis: ESTIMATED_ROUTE_BASIS };
    if (this.estimatedRouteObjectId) attrs.OBJECTID = this.estimatedRouteObjectId;
    const data = await this.post(this.layerUrl(this.config.estimatedRouteLayerId), this.estimatedRouteObjectId ? 'updateFeatures' : 'addFeatures', new URLSearchParams({ f: 'json', features: JSON.stringify([{ attributes: attrs, geometry: this.polylineGeometryForWebMercatorLayer([position, d], 'estimated route layer') }]) }));
    const result = data.updateResults?.[0] || data.addResults?.[0];
    if (!result?.success) throw new Error(`ArcGIS estimated route upsert failed: ${JSON.stringify(data)}`);
    if (!this.estimatedRouteObjectId) this.estimatedRouteObjectId = result.objectId;
    return { distanceNM, estimatedETA: eta };
  }

  addToken(url) { const parsed = new URL(url); parsed.searchParams.set('token', this.token); return parsed.toString(); }
  async get(url, retryOnTokenRenewal = true) { await this.ensureValidToken(); const data = await this.rawGet(this.addToken(url)); return this.retryAfterTokenRenewal(data, retryOnTokenRenewal, () => this.get(url, false)); }
  async post(baseUrl, endpoint, body, retryOnTokenRenewal = true) { await this.ensureValidToken(); const authedBody = new URLSearchParams(body); authedBody.set('token', this.token); const data = await this.rawPost(`${baseUrl}/${endpoint}`, authedBody); return this.retryAfterTokenRenewal(data, retryOnTokenRenewal, () => this.post(baseUrl, endpoint, body, false)); }
  async retryAfterTokenRenewal(data, retryOnTokenRenewal, retry) { if (!this.isTokenExpiredResponse(data)) return data; if (!retryOnTokenRenewal) return data; logger.warn('ArcGIS token expired or invalid; renewing and retrying request', { code: data.error.code, message: data.error.message }); await this.refreshToken(); return retry(); }
  isTokenExpiredResponse(data) { return TOKEN_EXPIRED_CODES.has(Number(data?.error?.code)); }
  async rawGet(url) { const res = await fetch(url); return res.json(); }
  async rawPost(url, body) { const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body }); return res.json(); }
}

function escapeSql(value) { return String(value).replaceAll("'", "''"); }
