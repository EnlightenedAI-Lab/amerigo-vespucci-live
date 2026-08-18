import {
  ACCESS_STATE,
  DATE_KIND,
  ENTITLEMENT_STATE,
  PROVIDER_KIND,
  RIGHTS,
  emptyObservation,
  emptyRights,
  isoDateFromCompact,
  isoDateOnly
} from '../imagery-contract.js';

export const WAYBACK_CONFIG_URL = 'https://s3-us-west-2.amazonaws.com/config.maptiles.arcgis.com/waybackconfig.json';
export const WAYBACK_CONFIG_PROXY = '/api/spatial-v2/imagery/wayback/config';
export const WAYBACK_METADATA_PROXY = '/api/spatial-v2/imagery/wayback/metadata';

export function releaseDateFromWaybackTitle(title) {
  const match = String(title || '').match(/Wayback (\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : null;
}

export function parseWaybackConfig(config) {
  if (!config || typeof config !== 'object') return [];
  const records = [];
  for (const [key, entry] of Object.entries(config)) {
    if (!entry || typeof entry !== 'object') continue;
    const releaseNum = Number(entry.releaseNum ?? key);
    const releaseDate = isoDateOnly(entry.releaseDateLabel)
      || releaseDateFromWaybackTitle(entry.itemTitle);
    if (!entry.itemURL) continue;
    records.push({
      releaseNum: Number.isFinite(releaseNum) ? releaseNum : null,
      releaseDate,
      itemTitle: entry.itemTitle || null,
      itemURL: entry.itemURL,
      itemID: entry.itemID || null,
      metadataLayerUrl: entry.metadataLayerUrl || null,
      metadataLayerItemID: entry.metadataLayerItemID || null,
      layerIdentifier: entry.layerIdentifier || null
    });
  }
  records.sort((a, b) => String(b.releaseDate || '').localeCompare(String(a.releaseDate || '')));
  return records;
}

export function acquisitionFromWaybackMetadata(attributes) {
  if (!attributes || typeof attributes !== 'object') return null;
  const fromDateField = isoDateOnly(attributes.SRC_DATE2);
  if (fromDateField) return fromDateField;
  return isoDateFromCompact(attributes.SRC_DATE);
}

function observationFromRelease(release) {
  return emptyObservation({
    id: `wayback:${release.releaseNum ?? release.layerIdentifier}`,
    providerId: 'esri-wayback',
    productName: release.itemTitle || 'Esri World Imagery Wayback',
    acquisitionDate: null,
    releaseDate: release.releaseDate,
    matchDate: null,
    retrievedDate: null,
    dateKindUsed: DATE_KIND.RELEASE,
    sourceIdentity: {
      kind: 'wayback-release',
      releaseNum: release.releaseNum,
      layerIdentifier: release.layerIdentifier,
      itemID: release.itemID,
      itemURL: release.itemURL,
      metadataLayerUrl: release.metadataLayerUrl
    },
    rights: emptyRights({
      display: RIGHTS.PERMITTED,
      export: RIGHTS.UNKNOWN,
      cache: RIGHTS.UNKNOWN,
      analysis: RIGHTS.UNKNOWN
    }),
    limitation: 'Wayback releaseDate is the mosaic publication date, not the pixel capture date. Capture stays null until metadata SRC_DATE/SRC_DATE2 is resolved at the AOI and scale.',
    establishes: 'A dated World Imagery Wayback mosaic release.',
    doesNotEstablish: 'Pixel acquisition date unless metadata is resolved. Not OWI AS_OF, PI AT/RANGE, or Situation time.',
    accessState: ACCESS_STATE.STREAMABLE,
    assets: [{ kind: 'webtile', urlTemplate: release.itemURL }]
  });
}

async function fetchConfigJson() {
  const attempts = [WAYBACK_CONFIG_PROXY, WAYBACK_CONFIG_URL];
  let lastError = null;
  for (const url of attempts) {
    try {
      const response = await fetch(url, { cache: 'no-store' });
      if (!response.ok) {
        lastError = new Error(`Wayback config HTTP ${response.status}`);
        continue;
      }
      return await response.json();
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error('Wayback config is unavailable.');
}

export const esriWaybackProvider = {
  id: 'esri-wayback',
  title: 'Esri World Imagery Wayback',
  kind: PROVIDER_KIND.ARCHIVE,

  async probeEntitlement() {
    try {
      const config = await fetchConfigJson();
      const releases = parseWaybackConfig(config);
      if (!releases.length) return ENTITLEMENT_STATE.FAILED;
      return ENTITLEMENT_STATE.READY;
    } catch {
      return ENTITLEMENT_STATE.FAILED;
    }
  },

  async discover() {
    const config = await fetchConfigJson();
    const releases = parseWaybackConfig(config);
    return {
      entitlement: ENTITLEMENT_STATE.READY,
      observations: releases.map(observationFromRelease),
      limitation: releases.length
        ? null
        : 'Wayback config contained no releases.'
    };
  },

  async resolveAcquisition(observation, aoi) {
    if (!observation?.sourceIdentity?.metadataLayerUrl || !aoi) {
      return { ...observation, acquisitionDate: observation?.acquisitionDate ?? null };
    }
    const params = new URLSearchParams({
      metadataLayerUrl: observation.sourceIdentity.metadataLayerUrl,
      longitude: String(aoi.longitude),
      latitude: String(aoi.latitude),
      scale: String(aoi.scale || '')
    });
    try {
      const response = await fetch(`${WAYBACK_METADATA_PROXY}?${params}`, { cache: 'no-store' });
      if (!response.ok) {
        return {
          ...observation,
          acquisitionDate: null,
          limitation: `${observation.limitation || ''} Metadata query did not resolve a capture date.`.trim()
        };
      }
      const payload = await response.json();
      const acquisitionDate = acquisitionFromWaybackMetadata(payload.attributes || {});
      return {
        ...observation,
        acquisitionDate,
        matchDate: acquisitionDate || null,
        gsdMeters: Number.isFinite(Number(payload.attributes?.SRC_RES))
          ? Number(payload.attributes.SRC_RES)
          : observation.gsdMeters,
        dateKindUsed: acquisitionDate ? DATE_KIND.ACQUISITION : DATE_KIND.RELEASE,
        limitation: acquisitionDate
          ? 'Wayback releaseDate is mosaic publication. acquisitionDate is metadata SRC_DATE/SRC_DATE2 at this AOI and scale.'
          : `${observation.limitation || ''} Metadata returned no capture date.`.trim()
      };
    } catch {
      return {
        ...observation,
        acquisitionDate: null,
        limitation: `${observation.limitation || ''} Metadata query failed; capture date stays null.`.trim()
      };
    }
  },

  async createLayer(observation) {
    const { importArc } = await import('../../map/arcgis-sdk.js');
    const WebTileLayer = await importArc('@arcgis/core/layers/WebTileLayer.js');
    const urlTemplate = this.urlTemplateFor(observation);
    if (!urlTemplate) throw new Error('Wayback observation is missing a tile template.');
    return new WebTileLayer({
      id: 'iqai-v2-imagery-time-observation',
      title: observation.productName || 'Esri World Imagery Wayback',
      urlTemplate,
      copyright: 'Esri World Imagery Wayback',
      visible: true,
      opacity: 1,
      popupEnabled: false,
      listMode: 'hide'
    });
  },

  urlTemplateFor(observation) {
    return observation?.sourceIdentity?.itemURL || observation?.assets?.[0]?.urlTemplate || null;
  },

  bindLayer(layer, observation) {
    const urlTemplate = this.urlTemplateFor(observation);
    if (!layer || !urlTemplate) throw new Error('Wayback observation is missing a tile template.');
    layer.urlTemplate = urlTemplate;
    layer.title = observation.productName || 'Esri World Imagery Wayback';
    layer.copyright = 'Esri World Imagery Wayback';
    layer.visible = true;
    layer.opacity = 1;
    layer.popupEnabled = false;
    layer.listMode = 'hide';
    if (typeof layer.refresh === 'function') layer.refresh();
    return layer;
  }
};
