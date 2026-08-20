/**
 * Historical provider registry. Wayback is the first archive adapter.
 * Future providers plug into the same HISTORY experience without UI redesign.
 * Québec / Nearmap / local / drone / client are extension points only.
 */

import { esriWaybackProvider } from '../providers/esri-wayback-provider.js';
import {
  COVERAGE_STATUS,
  EXPORT_STATUS,
  toHistoricalObservation
} from './historical-contract.js';

export const HISTORICAL_PROVIDER_IDS = Object.freeze({
  ESRI_WAYBACK: 'esri-wayback',
  MRNF_QUEBEC: 'mrnf-quebec',
  CMM_ORTHOPHOTO: 'cmm-orthophoto',
  NEARMAP_ARCHIVE: 'nearmap-archive',
  LOCAL_HIGHRES: 'local-highres',
  DRONE: 'drone',
  CLIENT: 'client'
});

const waybackAdapter = {
  id: HISTORICAL_PROVIDER_IDS.ESRI_WAYBACK,
  kind: 'archive',
  title: 'Historical overhead',
  attribution: 'Esri World Imagery Wayback',

  async discover() {
    const result = await esriWaybackProvider.discover();
    return {
      provider: this.id,
      entitlement: result.entitlement,
      limitation: result.limitation,
      observations: (result.observations || []).map((item) => toHistoricalObservation(item, {
        provider: this.id,
        coverageStatus: COVERAGE_STATUS.UNKNOWN,
        attribution: this.attribution,
        exportStatus: EXPORT_STATUS.EXPORT_RIGHTS_REVIEW_REQUIRED
      }))
    };
  },

  urlTemplateFor(observation) {
    return observation?.urlTemplate
      || esriWaybackProvider.urlTemplateFor(observation?.raw || observation);
  }
};

export const HISTORICAL_PROVIDER_REGISTRY = Object.freeze({
  [HISTORICAL_PROVIDER_IDS.ESRI_WAYBACK]: waybackAdapter,
  [HISTORICAL_PROVIDER_IDS.MRNF_QUEBEC]: null,
  [HISTORICAL_PROVIDER_IDS.CMM_ORTHOPHOTO]: null,
  [HISTORICAL_PROVIDER_IDS.NEARMAP_ARCHIVE]: null,
  [HISTORICAL_PROVIDER_IDS.LOCAL_HIGHRES]: null,
  [HISTORICAL_PROVIDER_IDS.DRONE]: null,
  [HISTORICAL_PROVIDER_IDS.CLIENT]: null
});

export function enabledHistoricalProviders() {
  return Object.values(HISTORICAL_PROVIDER_REGISTRY).filter(Boolean);
}

export function applyMetadataCoverage(observation, attributes) {
  if (!attributes) {
    return {
      ...observation,
      coverageStatus: COVERAGE_STATUS.NONE
    };
  }
  return {
    ...observation,
    coverageStatus: COVERAGE_STATUS.COVERED,
    gsdMeters: Number.isFinite(Number(attributes.SRC_RES))
      ? Number(attributes.SRC_RES)
      : observation.gsdMeters,
    resolution: Number.isFinite(Number(attributes.SRC_RES))
      ? (Number(attributes.SRC_RES) < 1
        ? `${Number((Number(attributes.SRC_RES) * 100).toFixed(1))} CM`
        : `${Number(Number(attributes.SRC_RES).toFixed(2))} M`)
      : observation.resolution,
    sourceMetadata: {
      ...observation.sourceMetadata,
      sourceName: attributes.NICE_NAME || attributes.SRC_DESC || null
    }
  };
}

export { waybackAdapter };
