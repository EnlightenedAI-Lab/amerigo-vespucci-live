import {
  DATE_KIND,
  ENTITLEMENT_STATE,
  GROUND_MODE,
  PROVIDER_KIND,
  RIGHTS,
  emptyObservation,
  emptyRights
} from '../imagery-contract.js';
import {
  AERIAL_PROOF_CAPTURE_DATE,
  AERIAL_PROOF_RELEASE,
  WAYBACK_AERIAL_URL_TEMPLATE,
  createIqaiWaybackBasemap
} from '../../map/iqai-public-basemap.js';

const STYLE_ID = 'arcgis/imagery';

export const esriWorldImageryProvider = {
  id: 'esri-world-imagery',
  title: 'Esri World Imagery Wayback',
  kind: PROVIDER_KIND.CURRENT_GROUND,

  describe() {
    return {
      id: this.id,
      title: this.title,
      kind: this.kind,
      modeId: GROUND_MODE.ESRI_WORLD_IMAGERY,
      styleId: STYLE_ID
    };
  },

  async probeEntitlement() {
    return ENTITLEMENT_STATE.READY;
  },

  observationFor() {
    return emptyObservation({
      id: `esri-wayback:${AERIAL_PROOF_RELEASE}`,
      providerId: this.id,
      productName: 'Esri World Imagery Wayback',
      acquisitionDate: AERIAL_PROOF_CAPTURE_DATE,
      dateKindUsed: DATE_KIND.ACQUISITION,
      rights: emptyRights({
        display: RIGHTS.PERMITTED,
        export: RIGHTS.UNKNOWN,
        cache: RIGHTS.UNKNOWN,
        analysis: RIGHTS.UNKNOWN
      }),
      limitation: 'Temporary AERIAL proof uses Wayback release 26334. IMAGE DATE is 28 MAY 2025 capture, not current aerial.',
      establishes: 'Dated Esri World Imagery Wayback mosaic display.',
      doesNotEstablish: 'Current Google or Nearmap aerial. Not OWI AS_OF, PI AT/RANGE, or Situation time.',
      sourceIdentity: {
        kind: 'wayback-release',
        releaseNum: AERIAL_PROOF_RELEASE,
        url: WAYBACK_AERIAL_URL_TEMPLATE
      }
    });
  },

  async createBasemap() {
    return createIqaiWaybackBasemap();
  }
};
