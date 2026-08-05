import { logger } from './logger.js';

const FIELD_MAP = {
  MMSI: 'MMSI', VesselName: 'VesselName', SpeedKnots: 'SpeedKnots', Course: 'Course', Heading: 'Heading',
  Latitude: 'Latitude', Longitude: 'Longitude', LastAIS: 'LastAIS', Destination: 'Destination', NavStatus: 'NavStatus'
};

export class ArcGISClient {
  constructor(config) {
    this.config = config;
    this.token = config.arcgisToken;
    this.featureServiceUrl = null;
    this.currentObjectId = null;
  }

  async initialize() {
    if (!this.token) this.token = await this.generateToken();
    this.featureServiceUrl = await this.resolveFeatureServiceUrl();
    this.currentObjectId = await this.findCurrentFeatureObjectId();
    logger.info('ArcGIS client initialized', { featureServiceUrl: this.featureServiceUrl, currentObjectId: this.currentObjectId });
  }

  async generateToken() {
    const body = new URLSearchParams({ f: 'json', username: this.config.arcgisUsername, password: this.config.arcgisPassword, client: 'referer', referer: 'https://www.arcgis.com', expiration: '120' });
    const data = await this.post(`${this.config.arcgisPortalUrl}/sharing/rest/generateToken`, body);
    if (!data.token) throw new Error(`ArcGIS token generation failed: ${JSON.stringify(data)}`);
    return data.token;
  }

  async resolveFeatureServiceUrl() {
    const url = `${this.config.arcgisPortalUrl}/sharing/rest/content/items/${this.config.arcgisItemId}?f=json&token=${encodeURIComponent(this.token)}`;
    const res = await fetch(url);
    const item = await res.json();
    if (!item.url) throw new Error(`Could not resolve ArcGIS item URL: ${JSON.stringify(item)}`);
    return item.url;
  }

  layerUrl(layerId = this.config.currentLayerId) {
    return `${this.featureServiceUrl}/${layerId}`;
  }

  async findCurrentFeatureObjectId() {
    const where = `MMSI=${this.config.targetMmsi}`;
    const params = new URLSearchParams({ f: 'json', token: this.token, where, outFields: 'OBJECTID', returnGeometry: 'false' });
    const data = await this.get(`${this.layerUrl()}/query?${params}`);
    return data.features?.[0]?.attributes?.OBJECTID || null;
  }

  toFeature(position) {
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
    if (this.currentObjectId) attributes.OBJECTID = this.currentObjectId;
    return { attributes, geometry: { x: position.longitude, y: position.latitude, spatialReference: { wkid: 4326 } } };
  }

  async upsertCurrentPosition(position) {
    const feature = this.toFeature(position);
    const params = new URLSearchParams({ f: 'json', token: this.token });
    let endpoint = 'addFeatures';
    if (this.currentObjectId) {
      endpoint = 'updateFeatures';
      params.set('features', JSON.stringify([feature]));
    } else {
      params.set('features', JSON.stringify([feature]));
    }
    const data = await this.post(`${this.layerUrl()}/${endpoint}`, params);
    const result = data.updateResults?.[0] || data.addResults?.[0];
    if (!result?.success) throw new Error(`ArcGIS ${endpoint} failed: ${JSON.stringify(data)}`);
    if (!this.currentObjectId) this.currentObjectId = result.objectId;
    logger.info('ArcGIS current position updated', { objectId: this.currentObjectId, lastAIS: position.lastAIS.toISOString() });
  }

  async addHistoryPosition(position) {
    const params = new URLSearchParams({ f: 'json', token: this.token, features: JSON.stringify([this.toFeature(position)]) });
    const data = await this.post(`${this.layerUrl(this.config.historyLayerId)}/addFeatures`, params);
    const result = data.addResults?.[0];
    if (!result?.success) logger.warn('ArcGIS history insert failed', data);
  }

  async get(url) {
    const res = await fetch(url);
    return res.json();
  }

  async post(url, body) {
    const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body });
    return res.json();
  }
}
