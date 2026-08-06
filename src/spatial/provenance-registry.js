/**
 * Provenance metadata for active layers and identify results.
 */
export class ProvenanceRegistry {
  constructor() {
    /** @type {Map<string, object>} */
    this.entries = new Map();
  }

  /**
   * @param {string} layerId
   * @param {object} catalogLayer
   * @param {object} runtime
   */
  set(layerId, catalogLayer, runtime = {}) {
    this.entries.set(layerId, {
      layerId,
      title: catalogLayer.title,
      provider: catalogLayer.provider,
      service: catalogLayer.endpoint || catalogLayer.portalItemId || null,
      layerName: catalogLayer.layerName,
      sourceModelRun: runtime.modelRun || null,
      validTime: runtime.validTime || null,
      retrievalTime: runtime.retrievalTime || new Date().toISOString(),
      units: catalogLayer.units,
      evidenceClass: runtime.evidenceClass || catalogLayer.evidenceClass,
      costClass: catalogLayer.costClass,
      licence: catalogLayer.licenceStatus,
      attribution: catalogLayer.attribution,
      coverage: catalogLayer.coverage,
      caveat: catalogLayer.notForNavigation,
      providerUrl: runtime.providerUrl || catalogLayer.endpoint || null,
      ...runtime.extra
    });
  }

  get(layerId) {
    return this.entries.get(layerId) || null;
  }

  list() {
    return [...this.entries.values()];
  }

  clear() {
    this.entries.clear();
  }
}
