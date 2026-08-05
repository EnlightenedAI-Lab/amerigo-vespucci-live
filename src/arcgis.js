import { logger } from './logger.js';

const FIELD_MAP = {
  MMSI: 'MMSI', VesselName: 'VesselName', SpeedKnots: 'SpeedKnots', Course: 'Course', Heading: 'Heading',
  Latitude: 'Latitude', Longitude: 'Longitude', LastAIS: 'LastAIS', Destination: 'Destination', NavStatus: 'NavStatus'
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
  }

  async initialize() {
    await this.ensureValidToken();
    this.featureServiceUrl = await this.resolveFeatureServiceUrl();
    this.currentObjectId = await this.findCurrentFeatureObjectId();
    logger.info('ArcGIS client initialized', { featureServiceUrl: this.featureServiceUrl, currentObjectId: this.currentObjectId });
  }

  canGenerateToken() {
    return Boolean(this.config.arcgisUsername && this.config.arcgisPassword);
  }

  async ensureValidToken() {
    if (!this.token || (this.generatedTokenExpiresAt && Date.now() > this.generatedTokenExpiresAt.getTime() - TOKEN_RENEWAL_BUFFER_MS)) {
      await this.refreshToken();
    }
  }

  async refreshToken() {
    if (!this.canGenerateToken()) {
      throw new Error('ArcGIS token is missing or expired and ARCGIS_USERNAME/ARCGIS_PASSWORD are not configured for automatic renewal.');
    }
    this.token = await this.generateToken();
    this.generatedTokenExpiresAt = new Date(Date.now() + GENERATED_TOKEN_MINUTES * 60 * 1000);
    logger.info('ArcGIS token renewed', { expiresAt: this.generatedTokenExpiresAt.toISOString() });
  }

  async generateToken() {
    const body = new URLSearchParams({
      f: 'json',
      username: this.config.arcgisUsername,
      password: this.config.arcgisPassword,
      client: 'requestip',
      expiration: String(GENERATED_TOKEN_MINUTES)
    });
    const data = await this.rawPost(`${this.config.arcgisPortalUrl}/sharing/rest/generateToken`, body);
    if (!data.token) throw new Error(`ArcGIS token generation failed: ${JSON.stringify(data)}`);
    return data.token;
  }

  async resolveFeatureServiceUrl() {
    const url = `${this.config.arcgisPortalUrl}/sharing/rest/content/items/${this.config.arcgisItemId}?f=json`;
    const item = await this.get(url);
    if (!item.url) throw new Error(`Could not resolve ArcGIS item URL: ${JSON.stringify(item)}`);
    return item.url;
  }

  layerUrl(layerId = this.config.currentLayerId) {
    return `${this.featureServiceUrl}/${layerId}`;
  }

  async findCurrentFeatureObjectId() {
    const where = `MMSI=${this.config.targetMmsi}`;
    const params = new URLSearchParams({ f: 'json', where, outFields: 'OBJECTID', returnGeometry: 'false' });
    const data = await this.get(`${this.layerUrl()}/query?${params}`);
    return data.features?.[0]?.attributes?.OBJECTID || null;
  }

  toFeature(position, options = {}) {
    const { includeObjectId = true } = options;
    const attributes = {
      [FIELD_MAP.MMSI]: position.mmsi,
      [FIELD_MAP.VesselName]: position.vesselName || 'Amerigo Vespucci',
      [FIELD_MAP.SpeedKnots]: position.speedKnots,
      [FIELD_MAP.Course]: position.course,
      [FIELD_MAP.Heading]: position.heading,
      [FIELD_MAP.Latitude]: position.latitude,
      [FIELD_MAP.Longitude]: position.longitude,
      [FIELD_MAP.LastAIS]: position.lastAIS.getTime(),
      [FIELD_MAP.Destination]: position.destination || null,
      [FIELD_MAP.NavStatus]: position.navStatus || null
    };
    if (includeObjectId && this.currentObjectId) attributes.OBJECTID = this.currentObjectId;
    return { attributes, geometry: { x: position.longitude, y: position.latitude, spatialReference: { wkid: 4326 } } };
  }

  async upsertCurrentPosition(position) {
    const feature = this.toFeature(position, { includeObjectId: Boolean(this.currentObjectId) });
    const params = new URLSearchParams({ f: 'json', features: JSON.stringify([feature]) });
    const endpoint = this.currentObjectId ? 'updateFeatures' : 'addFeatures';
    const data = await this.post(this.layerUrl(), endpoint, params);
    const result = data.updateResults?.[0] || data.addResults?.[0];
    if (!result?.success) throw new Error(`ArcGIS ${endpoint} failed: ${JSON.stringify(data)}`);
    if (!this.currentObjectId) this.currentObjectId = result.objectId;
    logger.info('ArcGIS current position updated', { objectId: this.currentObjectId, lastAIS: position.lastAIS.toISOString() });
  }

  async addHistoryPosition(position) {
    const historyFeature = this.toFeature(position, { includeObjectId: false });
    const params = new URLSearchParams({ f: 'json', features: JSON.stringify([historyFeature]) });
    const data = await this.post(this.layerUrl(this.config.historyLayerId), 'addFeatures', params);
    const result = data.addResults?.[0];
    if (!result?.success) logger.warn('ArcGIS history insert failed', data);
  }

  addToken(url) {
    const parsed = new URL(url);
    parsed.searchParams.set('token', this.token);
    return parsed.toString();
  }

  async get(url, retryOnTokenRenewal = true) {
    await this.ensureValidToken();
    const data = await this.rawGet(this.addToken(url));
    return this.retryAfterTokenRenewal(data, retryOnTokenRenewal, () => this.get(url, false));
  }

  async post(baseUrl, endpoint, body, retryOnTokenRenewal = true) {
    await this.ensureValidToken();
    const authedBody = new URLSearchParams(body);
    authedBody.set('token', this.token);
    const data = await this.rawPost(`${baseUrl}/${endpoint}`, authedBody);
    return this.retryAfterTokenRenewal(data, retryOnTokenRenewal, () => this.post(baseUrl, endpoint, body, false));
  }

  async retryAfterTokenRenewal(data, retryOnTokenRenewal, retry) {
    if (!this.isTokenExpiredResponse(data)) return data;
    if (!retryOnTokenRenewal) return data;
    logger.warn('ArcGIS token expired or invalid; renewing and retrying request', { code: data.error.code, message: data.error.message });
    await this.refreshToken();
    return retry();
  }

  isTokenExpiredResponse(data) {
    return TOKEN_EXPIRED_CODES.has(Number(data?.error?.code));
  }

  async rawGet(url) {
    const res = await fetch(url);
    return res.json();
  }

  async rawPost(url, body) {
    const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body });
    return res.json();
  }
}
