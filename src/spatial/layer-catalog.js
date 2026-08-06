/** @typedef {'FREE_PUBLIC'|'FREE_WITH_ACCOUNT'|'ARCGIS_SUBSCRIBER'|'ARCGIS_CREDIT_CONSUMING'|'COMMERCIAL'|'UNKNOWN'} CostClass */
/** @typedef {'OBSERVED'|'MODELLED'|'FORECAST'|'CLIMATOLOGY'|'ESTIMATED'|'REFERENCE'} EvidenceClass */

export const COST_CLASSES = Object.freeze([
  'FREE_PUBLIC', 'FREE_WITH_ACCOUNT', 'ARCGIS_SUBSCRIBER',
  'ARCGIS_CREDIT_CONSUMING', 'COMMERCIAL', 'UNKNOWN'
]);

export const EVIDENCE_CLASSES = Object.freeze([
  'OBSERVED', 'MODELLED', 'FORECAST', 'CLIMATOLOGY', 'ESTIMATED', 'REFERENCE'
]);

export const MODES = Object.freeze(['navigation', 'ocean', 'weather', 'satellite', 'intelligence']);

/** Retired HYCOM — must never be selected as live currents. */
export const RETIRED_HYCOM_ITEM_ID = 'a6f2ca97544b45f69daea38668ccbdcf';

const NOT_FOR_NAV = 'Situational awareness only — not for navigation.';

/**
 * IQAI Spatial layer catalog — authoritative provider metadata.
 * revalidatedAt: ISO date when metadata was last verified against provider docs.
 */
export const LAYER_CATALOG = Object.freeze([
  {
    id: 'basemap-ocean-base',
    title: 'World Ocean Base',
    provider: 'Esri',
    sourceType: 'ArcGISTiledMapServiceLayer',
    endpoint: 'https://services.arcgisonline.com/ArcGIS/rest/services/Ocean/World_Ocean_Base/MapServer',
    portalItemId: '1e126e7520f9466c9ca28b8f28b5e500',
    layerName: 'World_Ocean_Base',
    style: 'default',
    units: null,
    coverage: 'Global ocean',
    evidenceClass: 'REFERENCE',
    timeSupport: 'static',
    costClass: 'FREE_PUBLIC',
    licenceStatus: 'Esri Terms of Use',
    attribution: 'Esri, GEBCO, NOAA, National Geographic, and other contributors',
    notForNavigation: NOT_FOR_NAV,
    defaultOpacity: 1,
    minScale: 0,
    maxScale: 0,
    modes: ['navigation', 'ocean', 'weather', 'satellite', 'intelligence'],
    revalidatedAt: '2026-08-06',
    enabled: true,
    exclusiveGroup: null
  },
  {
    id: 'basemap-ocean-reference',
    title: 'World Ocean Reference',
    provider: 'Esri',
    sourceType: 'VectorTileLayer',
    endpoint: 'https://basemaps.arcgis.com/arcgis/rest/services/World_Basemap_v2/VectorTileServer',
    portalItemId: '94329802cbfa44a18f423e6f1a0b875c',
    layerName: 'World_Basemap_v2',
    style: 'reference',
    units: null,
    coverage: 'Global',
    evidenceClass: 'REFERENCE',
    timeSupport: 'static',
    costClass: 'FREE_PUBLIC',
    licenceStatus: 'Esri Terms of Use',
    attribution: 'Esri',
    notForNavigation: NOT_FOR_NAV,
    defaultOpacity: 1,
    minScale: 0,
    maxScale: 0,
    modes: ['navigation', 'ocean', 'weather', 'satellite', 'intelligence'],
    revalidatedAt: '2026-08-06',
    enabled: true,
    exclusiveGroup: null,
    basemapRole: 'reference'
  },
  {
    id: 'copernicus-current',
    title: 'Copernicus Marine Current Forecast',
    provider: 'Copernicus Marine',
    sourceType: 'WMTSLayer',
    endpoint: 'https://wmts.marine.copernicus.eu/teroWmts/GLOBAL_ANALYSISFORECAST_PHY_001_024/cmems_mod_glo_phy-cur_anfc_0.083deg_PT6H-i_202406',
    layerName: 'GLOBAL_ANALYSISFORECAST_PHY_001_024/cmems_mod_glo_phy-cur_anfc_0.083deg_PT6H-i_202406/sea_water_velocity',
    style: 'cmap:speed,vectorStyle:solidAndVector',
    units: 'm/s',
    coverage: 'Global ocean',
    evidenceClass: 'FORECAST',
    timeSupport: 'time-enabled-6h',
    costClass: 'FREE_PUBLIC',
    licenceStatus: 'Copernicus Marine Service Licence',
    attribution: 'Copernicus Marine Service',
    notForNavigation: NOT_FOR_NAV,
    defaultOpacity: 0.85,
    minScale: 0,
    maxScale: 0,
    modes: ['ocean'],
    revalidatedAt: '2026-08-06',
    enabled: true,
    exclusiveGroup: 'ocean-analytical',
    wmtsCapabilities: 'https://wmts.marine.copernicus.eu/teroWmts/GLOBAL_ANALYSISFORECAST_PHY_001_024/cmems_mod_glo_phy-cur_anfc_0.083deg_PT6H-i_202406?SERVICE=WMTS&version=1.0.0&REQUEST=GetCapabilities',
    depthDefault: -0.49402499198913574
  },
  {
    id: 'noaa-current-climatology',
    title: 'Typical Current Flow — NOAA drifter climatology (2005–2023)',
    provider: 'NOAA / University of Miami',
    sourceType: 'ImageryTileLayer',
    endpoint: 'https://tiledimageservices.arcgis.com/P3ePLMYs2RVChkJx/arcgis/rest/services/annual_drifter_mean_v3/ImageServer',
    portalItemId: '3f453a562771441f9d42a2f03c9b6111',
    layerName: 'annual_drifter_mean_v3',
    style: 'flow-renderer',
    units: 'cm/s',
    coverage: 'Global ocean',
    evidenceClass: 'CLIMATOLOGY',
    timeSupport: 'static-climatology-2005-2023',
    costClass: 'FREE_PUBLIC',
    licenceStatus: 'CC BY 4.0',
    attribution: 'NOAA / University of Miami drifter climatology',
    notForNavigation: NOT_FOR_NAV,
    defaultOpacity: 0.85,
    minScale: 0,
    maxScale: 0,
    modes: ['ocean'],
    revalidatedAt: '2026-08-06',
    enabled: true,
    exclusiveGroup: 'ocean-analytical'
  },
  {
    id: 'hycom-retired',
    title: 'HYCOM Global Ocean (RETIRED)',
    provider: 'Esri Living Atlas',
    sourceType: 'ImageryTileLayer',
    endpoint: null,
    portalItemId: RETIRED_HYCOM_ITEM_ID,
    layerName: 'HYCOM',
    style: 'flow-renderer',
    units: 'm/s',
    coverage: 'Global',
    evidenceClass: 'MODELLED',
    timeSupport: 'retired-2024-09',
    costClass: 'FREE_PUBLIC',
    licenceStatus: 'Retired service',
    attribution: 'HYCOM (retired)',
    notForNavigation: NOT_FOR_NAV,
    defaultOpacity: 0,
    minScale: 0,
    maxScale: 0,
    modes: [],
    revalidatedAt: '2026-08-06',
    enabled: false,
    exclusiveGroup: null,
    retired: true,
    retiredNote: 'HYCOM stopped updating September 2024; retires December 2026. Not for live use.'
  },
  {
    id: 'copernicus-wave-vhm0',
    title: 'Significant Wave Height (VHM0)',
    provider: 'Copernicus Marine',
    sourceType: 'WMTSLayer',
    endpoint: 'https://wmts.marine.copernicus.eu/teroWmts/GLOBAL_ANALYSISFORECAST_WAV_001_027/cmems_mod_glo_wav_anfc_0.083deg_PT3H-i_202411',
    layerName: 'GLOBAL_ANALYSISFORECAST_WAV_001_027/cmems_mod_glo_wav_anfc_0.083deg_PT3H-i_202411/VHM0',
    style: 'default',
    units: 'm',
    coverage: 'Global ocean',
    evidenceClass: 'FORECAST',
    timeSupport: 'time-enabled-3h',
    costClass: 'FREE_PUBLIC',
    licenceStatus: 'Copernicus Marine Service Licence',
    attribution: 'Copernicus Marine Service',
    notForNavigation: NOT_FOR_NAV,
    defaultOpacity: 0.8,
    minScale: 0,
    maxScale: 0,
    modes: ['ocean'],
    revalidatedAt: '2026-08-06',
    enabled: true,
    exclusiveGroup: 'ocean-analytical',
    wmtsCapabilities: 'https://wmts.marine.copernicus.eu/teroWmts/GLOBAL_ANALYSISFORECAST_WAV_001_027/cmems_mod_glo_wav_anfc_0.083deg_PT3H-i_202411?SERVICE=WMTS&version=1.0.0&REQUEST=GetCapabilities'
  },
  {
    id: 'gebco-bathymetry',
    title: 'GEBCO 2025 Bathymetry',
    provider: 'GEBCO',
    sourceType: 'WMSLayer',
    endpoint: 'https://wms.gebco.net/2025/mapserv?',
    layerName: 'gebco_2025',
    style: 'default',
    units: 'm depth',
    coverage: 'Global ocean floor',
    evidenceClass: 'REFERENCE',
    timeSupport: 'static-GEBCO_2025',
    costClass: 'FREE_PUBLIC',
    licenceStatus: 'GEBCO Terms of Use',
    attribution: 'GEBCO Compilation Group (2025) GEBCO_2025 Grid (doi:10.5285/1c44ce99-0a0d-5f4f-e063-7086abcab1f1)',
    notForNavigation: NOT_FOR_NAV,
    defaultOpacity: 0.45,
    minScale: 0,
    maxScale: 0,
    modes: ['navigation'],
    revalidatedAt: '2026-08-06',
    enabled: true,
    exclusiveGroup: null,
    wmsVersion: '1.3.0'
  },
  {
    id: 'openseamap-seamarks',
    title: 'OpenSeaMap Seamarks',
    provider: 'OpenSeaMap',
    sourceType: 'WebTileLayer',
    endpoint: 'https://tiles.openseamap.org/seamark/{z}/{x}/{y}.png',
    layerName: 'seamark',
    style: 'default',
    units: null,
    coverage: 'Global coastal',
    evidenceClass: 'REFERENCE',
    timeSupport: 'community-maintained',
    costClass: 'FREE_PUBLIC',
    licenceStatus: 'ODbL seamark data; CC BY-SA 2.0 rendered tiles',
    attribution: 'OpenSeaMap; OpenStreetMap contributors',
    notForNavigation: NOT_FOR_NAV,
    defaultOpacity: 0.9,
    minScale: 0,
    maxScale: 0,
    modes: ['navigation'],
    revalidatedAt: '2026-08-06',
    enabled: true,
    exclusiveGroup: null
  },
  {
    id: 'wpi-ports',
    title: 'World Port Index',
    provider: 'NGA',
    sourceType: 'FeatureLayer',
    endpoint: '/api/spatial/ports',
    layerName: 'world-port-index',
    style: 'scale-dependent-graphics',
    units: null,
    coverage: 'Global ports',
    evidenceClass: 'REFERENCE',
    timeSupport: 'publication-snapshot',
    costClass: 'FREE_PUBLIC',
    licenceStatus: 'NGA World Port Index',
    attribution: 'National Geospatial-Intelligence Agency (NGA) World Port Index',
    notForNavigation: NOT_FOR_NAV,
    defaultOpacity: 1,
    minScale: 500000,
    maxScale: 0,
    modes: ['navigation', 'intelligence'],
    revalidatedAt: '2026-08-06',
    enabled: true,
    exclusiveGroup: null
  },
  {
    id: 'gibs-viirs-truecolor',
    title: 'VIIRS True Colour (NOAA-20)',
    provider: 'NASA GIBS',
    sourceType: 'WebTileLayer',
    endpoint: 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_NOAA20_CorrectedReflectance_TrueColor/default/{Time}/GoogleMapsCompatible_Level9/{level}/{row}/{col}.jpeg',
    layerName: 'VIIRS_NOAA20_CorrectedReflectance_TrueColor',
    style: 'true-color',
    units: null,
    coverage: 'Global',
    evidenceClass: 'OBSERVED',
    timeSupport: 'daily-archive-2018',
    costClass: 'FREE_PUBLIC',
    licenceStatus: 'NASA EOSDIS',
    attribution: 'NASA EOSDIS GIBS',
    notForNavigation: NOT_FOR_NAV,
    defaultOpacity: 1,
    minScale: 0,
    maxScale: 0,
    modes: ['satellite'],
    revalidatedAt: '2026-08-06',
    enabled: true,
    exclusiveGroup: 'satellite-analytical',
    wmtsCapabilities: 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/1.0.0/WMTSCapabilities.xml'
  },
  {
    id: 'ship-density-historical',
    title: 'Historical AIS density, Jan 2015–Feb 2021',
    provider: 'World Bank / IMF',
    sourceType: 'ImageryTileLayer',
    endpoint: 'https://tiledimageservices.arcgis.com/P3ePLMYs2RVChkJx/arcgis/rest/services/Global_Ship_Density_Global/ImageServer',
    portalItemId: '2f72eb72cc0b403bb19a7cd1853f3d94',
    layerName: 'Global_Ship_Density_Global',
    style: 'density',
    units: 'relative density',
    coverage: 'Global',
    evidenceClass: 'REFERENCE',
    timeSupport: 'historical-2015-2021',
    costClass: 'FREE_PUBLIC',
    licenceStatus: 'CC BY 4.0',
    attribution: 'World Bank / IMF Global Ship Density',
    notForNavigation: NOT_FOR_NAV,
    defaultOpacity: 0.65,
    minScale: 0,
    maxScale: 0,
    modes: ['intelligence'],
    revalidatedAt: '2026-08-06',
    enabled: true,
    exclusiveGroup: 'intelligence-analytical'
  },
  {
    id: 'eez-boundaries',
    title: 'Marine Regions EEZ Boundaries',
    provider: 'VLIZ Marine Regions',
    sourceType: 'WFS',
    endpoint: 'https://geo.vliz.be/geoserver/MarineRegions/wfs',
    layerName: 'eez_boundaries',
    style: 'line',
    units: null,
    coverage: 'Global maritime boundaries',
    evidenceClass: 'REFERENCE',
    timeSupport: 'Marine Regions v12',
    costClass: 'FREE_PUBLIC',
    licenceStatus: 'Marine Regions citation required',
    attribution: 'Flanders Marine Institute (VLIZ) — Marine Regions',
    notForNavigation: NOT_FOR_NAV,
    defaultOpacity: 0.7,
    minScale: 0,
    maxScale: 0,
    modes: ['intelligence'],
    revalidatedAt: '2026-08-06',
    enabled: true,
    exclusiveGroup: null
  },
  {
    id: 'ipma-radar-azores',
    title: 'IPMA Azores Radar',
    provider: 'IPMA',
    sourceType: 'RadarFrames',
    endpoint: 'https://www.ipma.pt/resources.www/transf/radar/imgs-radar-az.json',
    layerName: 'azo',
    style: 'observed-radar',
    units: 'dBZ',
    coverage: 'Azores region',
    evidenceClass: 'OBSERVED',
    timeSupport: 'latest-frames',
    costClass: 'UNKNOWN',
    licenceStatus: 'UNKNOWN — permission review required',
    attribution: 'IPMA',
    notForNavigation: NOT_FOR_NAV,
    defaultOpacity: 0.75,
    minScale: 0,
    maxScale: 0,
    modes: ['weather'],
    revalidatedAt: '2026-08-06',
    enabled: false,
    exclusiveGroup: null,
    imageRoot: 'https://www.ipma.pt/resources.www/transf/radar/azo/',
    bounds: { swLat: 32.83497, swLon: -35.01827, neLat: 44.06629, neLon: -21.19264 },
    blockedReason: 'Permission review required — not enabled in production'
  },
  {
    id: 'vespucci-operational',
    title: 'Amerigo Vespucci Operational Layers',
    provider: 'IQAI / ArcGIS Hosted',
    sourceType: 'FeatureService',
    endpoint: null,
    portalItemId: '86f1b6a9b6124da5b362964749b5d797',
    layerName: 'Amerigo_Vespucci_Live',
    style: 'operational',
    units: null,
    coverage: 'Voyage corridor',
    evidenceClass: 'OBSERVED',
    timeSupport: 'live-ais-updates',
    costClass: 'ARCGIS_SUBSCRIBER',
    licenceStatus: 'Org-hosted feature service',
    attribution: 'Amerigo Vespucci Live / IQAI Spatial',
    notForNavigation: NOT_FOR_NAV,
    defaultOpacity: 1,
    minScale: 0,
    maxScale: 0,
    modes: MODES,
    revalidatedAt: '2026-08-06',
    enabled: true,
    exclusiveGroup: null,
    trackerLayer: true
  },
  {
    id: 'open-meteo-conditions',
    title: 'Open-Meteo Marine/Weather',
    provider: 'Open-Meteo',
    sourceType: 'API',
    endpoint: '/api/conditions',
    layerName: 'point-forecast',
    style: 'panel',
    units: 'mixed',
    coverage: 'Vessel vicinity',
    evidenceClass: 'FORECAST',
    timeSupport: 'model-run',
    costClass: 'FREE_PUBLIC',
    licenceStatus: 'Open-Meteo Terms — noncommercial unless licensed plan',
    attribution: 'Weather and marine forecast data by Open-Meteo.com',
    notForNavigation: NOT_FOR_NAV,
    defaultOpacity: 1,
    minScale: 0,
    maxScale: 0,
    modes: ['weather', 'navigation', 'ocean'],
    revalidatedAt: '2026-08-06',
    enabled: true,
    exclusiveGroup: null,
    trackerLayer: true
  }
]);

export function getLayerById(id) {
  return LAYER_CATALOG.find((l) => l.id === id) || null;
}

export function getLayersForMode(mode) {
  return LAYER_CATALOG.filter((l) => l.enabled && l.modes.includes(mode));
}

export function getExclusiveGroups() {
  return [...new Set(LAYER_CATALOG.map((l) => l.exclusiveGroup).filter(Boolean))];
}

export function validateLayerRecord(layer) {
  const errors = [];
  if (!layer.id) errors.push('missing id');
  if (!layer.title) errors.push('missing title');
  if (!layer.provider) errors.push('missing provider');
  if (!COST_CLASSES.includes(layer.costClass)) errors.push(`invalid costClass: ${layer.costClass}`);
  if (!EVIDENCE_CLASSES.includes(layer.evidenceClass)) errors.push(`invalid evidenceClass: ${layer.evidenceClass}`);
  if (!layer.attribution) errors.push('missing attribution');
  if (!layer.licenceStatus) errors.push('missing licenceStatus');
  if (!layer.revalidatedAt) errors.push('missing revalidatedAt');
  if (layer.enabled && !layer.provider) errors.push('enabled layer missing provider');
  if (layer.portalItemId === RETIRED_HYCOM_ITEM_ID && layer.enabled) {
    errors.push('retired HYCOM cannot be enabled');
  }
  return errors;
}

export function validateCatalog() {
  const allErrors = [];
  for (const layer of LAYER_CATALOG) {
    const errors = validateLayerRecord(layer);
    if (errors.length) allErrors.push({ id: layer.id, errors });
  }
  return allErrors;
}

export function isRetiredHycomItem(itemId) {
  return itemId === RETIRED_HYCOM_ITEM_ID;
}
