import {
  ACCESS_STATE,
  DATE_KIND,
  ENTITLEMENT_STATE,
  PROVIDER_KIND,
  RIGHTS,
  emptyObservation,
  emptyRights,
  isoDateOnly
} from '../imagery-contract.js';

export const NEARMAP_COVERAGE_PROXY = '/api/spatial-v2/imagery/nearmap/coverage';
export const NEARMAP_TILE_PROXY_TEMPLATE = '/api/spatial-v2/imagery/nearmap/tiles/{surveyId}/{level}/{col}/{row}.jpg';

function tileTemplateFor(surveyId) {
  return NEARMAP_TILE_PROXY_TEMPLATE.replace('{surveyId}', encodeURIComponent(surveyId));
}

export function observationFromNearmapSurvey(survey) {
  const surveyId = survey?.id || survey?.surveyId;
  const acquisitionDate = isoDateOnly(survey?.captureDate || survey?.acquisitionDate);
  const firstPublicDate = isoDateOnly(survey?.firstPublicDate);
  return emptyObservation({
    id: `nearmap:${surveyId}`,
    providerId: 'nearmap',
    productName: 'Nearmap Vertical',
    acquisitionDate,
    firstPublicDate,
    matchDate: acquisitionDate,
    dateKindUsed: DATE_KIND.ACQUISITION,
    gsdMeters: Number.isFinite(Number(survey?.pixelSize)) ? Number(survey.pixelSize) : null,
    sourceIdentity: {
      kind: 'nearmap-survey',
      surveyId,
      contentType: 'Vert'
    },
    rights: emptyRights({
      display: RIGHTS.PERMITTED,
      export: RIGHTS.PROHIBITED,
      cache: RIGHTS.PROHIBITED,
      analysis: RIGHTS.PROHIBITED
    }),
    limitation: 'Nearmap captureDate is the survey date. firstPublicDate is when the survey became public and is not used for matching. Display only in this milestone.',
    establishes: 'A dated Nearmap vertical survey for the requested AOI.',
    doesNotEstablish: 'Wayback release date, OWI AS_OF, PI AT/RANGE, or Situation time.',
    accessState: ACCESS_STATE.STREAMABLE,
    assets: surveyId ? [{ kind: 'webtile', urlTemplate: tileTemplateFor(surveyId) }] : []
  });
}

export const nearmapProvider = {
  id: 'nearmap',
  title: 'Nearmap',
  kind: PROVIDER_KIND.ARCHIVE,

  async probeEntitlement() {
    const response = await fetch(`${NEARMAP_COVERAGE_PROXY}?probe=1`, { cache: 'no-store' });
    const payload = await response.json().catch(() => ({}));
    return payload.entitlement || ENTITLEMENT_STATE.FAILED;
  },

  async discover(aoi) {
    const params = new URLSearchParams();
    params.set('aoi', aoi?.type || 'point');
    if (aoi?.longitude != null) params.set('longitude', String(aoi.longitude));
    if (aoi?.latitude != null) params.set('latitude', String(aoi.latitude));
    if (aoi?.xmin != null) params.set('xmin', String(aoi.xmin));
    if (aoi?.ymin != null) params.set('ymin', String(aoi.ymin));
    if (aoi?.xmax != null) params.set('xmax', String(aoi.xmax));
    if (aoi?.ymax != null) params.set('ymax', String(aoi.ymax));
    if (aoi?.wkid != null) params.set('wkid', String(aoi.wkid));
    const response = await fetch(`${NEARMAP_COVERAGE_PROXY}?${params}`, { cache: 'no-store' });
    const payload = await response.json().catch(() => ({}));
    const entitlement = payload.entitlement || ENTITLEMENT_STATE.FAILED;
    const surveys = Array.isArray(payload.surveys) ? payload.surveys : [];
    return {
      entitlement,
      observations: entitlement === ENTITLEMENT_STATE.READY
        ? surveys.map(observationFromNearmapSurvey)
        : [],
      limitation: payload.limitation || null,
      error: payload.error || null
    };
  },

  async createLayer(observation) {
    const { importArc } = await import('../../map/arcgis-sdk.js');
    const WebTileLayer = await importArc('@arcgis/core/layers/WebTileLayer.js');
    const surveyId = observation?.sourceIdentity?.surveyId;
    if (!surveyId) throw new Error('Nearmap observation is missing surveyId.');
    return new WebTileLayer({
      id: 'iqai-v2-imagery-time-observation',
      title: `Nearmap ${observation.acquisitionDate || surveyId}`,
      urlTemplate: tileTemplateFor(surveyId),
      copyright: 'Nearmap',
      popupEnabled: false,
      listMode: 'hide'
    });
  }
};
