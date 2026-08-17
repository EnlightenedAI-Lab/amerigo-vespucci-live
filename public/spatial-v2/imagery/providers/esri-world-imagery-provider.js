import {
  DATE_KIND,
  ENTITLEMENT_STATE,
  GROUND_MODE,
  PROVIDER_KIND,
  RIGHTS,
  emptyObservation,
  emptyRights
} from '../imagery-contract.js';
import { importArc } from '../../map/arcgis-sdk.js';

const STYLE_ID = 'arcgis/imagery';
const FALLBACK_LEGACY_ID = 'satellite';

export const esriWorldImageryProvider = {
  id: 'esri-world-imagery',
  title: 'Esri World Imagery',
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
      id: 'esri-world-imagery:current',
      providerId: this.id,
      productName: 'Esri World Imagery',
      dateKindUsed: DATE_KIND.SERVICE_CURRENT,
      rights: emptyRights({
        display: RIGHTS.PERMITTED,
        export: RIGHTS.UNKNOWN,
        cache: RIGHTS.UNKNOWN,
        analysis: RIGHTS.UNKNOWN
      }),
      limitation: 'Current Living Atlas mosaic; capture date not resolved in this milestone.',
      establishes: 'Current Esri World Imagery mosaic display.',
      doesNotEstablish: 'A dated capture, Time Machine archive, or Situation time.',
      sourceIdentity: { kind: 'basemap-style', id: STYLE_ID }
    });
  },

  async createBasemap() {
    const Basemap = await importArc('@arcgis/core/Basemap.js');
    try {
      const styled = new Basemap({
        style: { id: STYLE_ID },
        id: 'iqai-ground-esri-world-imagery',
        title: 'Esri World Imagery'
      });
      await styled.load();
      return styled;
    } catch {
      const fromId = Basemap.fromId(FALLBACK_LEGACY_ID);
      if (!fromId) throw new Error('Esri World Imagery basemap is unavailable.');
      fromId.id = 'iqai-ground-esri-world-imagery';
      fromId.title = 'Esri World Imagery';
      await fromId.load();
      return fromId;
    }
  }
};
