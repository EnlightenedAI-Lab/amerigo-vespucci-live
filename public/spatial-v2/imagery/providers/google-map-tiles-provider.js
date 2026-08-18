import {
  DATE_KIND,
  ENTITLEMENT_STATE,
  GROUND_MODE,
  PROVIDER_KIND,
  PROVIDER_READINESS_STATE,
  RIGHTS,
  emptyObservation,
  emptyRights
} from '../imagery-contract.js';

export const GOOGLE_MAP_TILES_STATUS = '/api/spatial-v2/imagery/google/status';

function unavailableStatus(error) {
  return {
    providerId: 'google-map-tiles',
    readinessState: PROVIDER_READINESS_STATE.UNAVAILABLE,
    entitlement: ENTITLEMENT_STATE.FAILED,
    configured: null,
    runtimeIntegrated: false,
    limitation: String(error?.message || error || 'Official Google Map Tiles readiness is unavailable.')
  };
}

export const googleMapTilesProvider = {
  id: 'google-map-tiles',
  title: 'Google Satellite (official)',
  kind: PROVIDER_KIND.CURRENT_GROUND,

  describe() {
    return {
      id: this.id,
      title: this.title,
      kind: this.kind,
      modeId: GROUND_MODE.GOOGLE_SATELLITE,
      status: GOOGLE_MAP_TILES_STATUS
    };
  },

  async probeReadiness() {
    try {
      const response = await fetch(GOOGLE_MAP_TILES_STATUS, { cache: 'no-store' });
      const payload = await response.json().catch(() => ({}));
      if (response.status === 404) {
        return {
          providerId: this.id,
          readinessState: PROVIDER_READINESS_STATE.NOT_CONFIGURED,
          entitlement: ENTITLEMENT_STATE.ENTITLEMENT_MISSING,
          configured: false,
          runtimeIntegrated: false,
          limitation: 'Official Google Map Tiles API configuration and runtime endpoint are not present in the active server process.'
        };
      }
      return {
        providerId: this.id,
        readinessState: payload.readinessState || PROVIDER_READINESS_STATE.UNAVAILABLE,
        entitlement: payload.entitlement || ENTITLEMENT_STATE.FAILED,
        configured: payload.configured === true,
        runtimeIntegrated: payload.runtimeIntegrated === true,
        limitation: payload.limitation || payload.error || null
      };
    } catch (error) {
      return unavailableStatus(error);
    }
  },

  observationFor(status = {}) {
    return emptyObservation({
      id: 'google-map-tiles:current',
      providerId: this.id,
      productName: this.title,
      dateKindUsed: DATE_KIND.SERVICE_CURRENT,
      rights: emptyRights({
        display: RIGHTS.UNKNOWN,
        export: RIGHTS.PROHIBITED,
        cache: RIGHTS.PROHIBITED,
        analysis: RIGHTS.PROHIBITED
      }),
      limitation: status.limitation
        || 'Official Google Map Tiles API is not configured. Current ground only; no Time Machine, analysis, cache, or export.',
      establishes: status.readinessState === PROVIDER_READINESS_STATE.READY
        ? 'Official Google current-ground display.'
        : null,
      doesNotEstablish: 'Capture date, historical observation, analysis rights, export rights, OWI AS_OF, PI AT/RANGE, or Situation time.',
      sourceIdentity: {
        kind: 'google-map-tiles-api',
        official: true,
        currentGroundOnly: true
      }
    });
  },

  async createBasemap() {
    const status = await this.probeReadiness();
    throw new Error(
      status.limitation
      || 'Official Google Map Tiles API ground runtime is unavailable.'
    );
  }
};
