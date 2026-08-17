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

const URL_TEMPLATE = 'https://mt{subDomain}.google.com/vt/lyrs=s&x={col}&y={row}&z={level}';

export const legacyGoogleSatelliteDemoProvider = {
  id: 'legacy-google-satellite-demo',
  title: 'Google Satellite (legacy demo)',
  kind: PROVIDER_KIND.CURRENT_GROUND,

  describe() {
    return {
      id: this.id,
      title: this.title,
      kind: this.kind,
      modeId: GROUND_MODE.LEGACY_GOOGLE_SATELLITE_DEMO
    };
  },

  async probeEntitlement() {
    return ENTITLEMENT_STATE.READY;
  },

  observationFor() {
    return emptyObservation({
      id: 'legacy-google-satellite-demo:current',
      providerId: this.id,
      productName: 'Google Satellite (legacy XYZ demo)',
      dateKindUsed: DATE_KIND.SERVICE_CURRENT,
      rights: emptyRights({
        display: RIGHTS.PERMITTED,
        export: RIGHTS.PROHIBITED,
        cache: RIGHTS.PROHIBITED,
        analysis: RIGHTS.PROHIBITED
      }),
      limitation: 'Internal engineering demo. Unofficial XYZ tiles. Not Google Map Tiles API. Not a dated capture. Display only. Analysis, cache packaging, Time Machine, and export are prohibited.',
      establishes: 'Current unofficial Google satellite tile display only.',
      doesNotEstablish: 'Capture date, Time Machine archive, analysis rights, export rights, official Map Tiles API entitlement, Situation time.',
      sourceIdentity: { kind: 'webtile', hostFamily: 'mt*.google.com' }
    });
  },

  async createBasemap() {
    const [Basemap, WebTileLayer] = await Promise.all([
      importArc('@arcgis/core/Basemap.js'),
      importArc('@arcgis/core/layers/WebTileLayer.js')
    ]);
    const tiles = new WebTileLayer({
      id: 'iqai-ground-legacy-google-satellite-demo-tiles',
      title: 'Google Satellite (legacy demo)',
      urlTemplate: URL_TEMPLATE,
      subDomains: ['0', '1', '2', '3'],
      copyright: 'Google',
      popupEnabled: false,
      listMode: 'hide'
    });
    const basemap = new Basemap({
      id: 'iqai-ground-legacy-google-satellite-demo',
      title: 'Google Satellite (legacy demo)',
      baseLayers: [tiles]
    });
    await basemap.load().catch(() => {});
    return basemap;
  }
};
