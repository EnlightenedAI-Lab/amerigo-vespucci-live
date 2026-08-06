/**
 * Read-only anonymous ArcGIS FeatureServer REST client.
 * Never calls Data Docked, AISStream, or Open-Meteo.
 */
export class PublicArcGISClient {
  /**
   * @param {string} featureServiceUrl
   */
  constructor(featureServiceUrl) {
    if (!featureServiceUrl) throw new Error('featureServiceUrl is required');
    this.featureServiceUrl = String(featureServiceUrl).replace(/\/$/, '');
  }

  layerUrl(layerId) {
    return `${this.featureServiceUrl}/${layerId}`;
  }

  async get(url) {
    const res = await fetch(url);
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.error) {
      const message = data.error?.message || `HTTP ${res.status}`;
      throw new Error(`ArcGIS REST request failed: ${message}`);
    }
    return data;
  }

  async queryHistoryPoints(config) {
    const params = new URLSearchParams({
      f: 'json',
      where: `MMSI=${config.targetMmsi}`,
      outFields: '*',
      returnGeometry: 'true',
      orderByFields: 'LastAIS ASC',
      resultRecordCount: String(config.routeMaxHistoryPoints)
    });
    const data = await this.get(`${this.layerUrl(config.historyLayerId)}/query?${params}`);
    return (data.features || []).map((f) => ({
      latitude: Number(f.geometry?.y ?? f.attributes?.Latitude),
      longitude: Number(f.geometry?.x ?? f.attributes?.Longitude),
      attributes: f.attributes || {}
    }));
  }
}
