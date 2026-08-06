import 'dotenv/config';

export const DEFAULT_FEATURE_SERVICE_URL =
  'https://services9.arcgis.com/HWLvgMBDdrPG7U8N/arcgis/rest/services/Amerigo_Vespucci_Live/FeatureServer';

export function loadConfig(options = {}) {
  const { requireAIS = true, requireArcGIS = true } = options;
  const required = ['ARCGIS_ITEM_ID'];
  if (requireAIS) required.push('AISSTREAM_API_KEY');
  const missing = required.filter((name) => !process.env[name]);
  if (requireArcGIS && !process.env.ARCGIS_TOKEN && !(process.env.ARCGIS_USERNAME && process.env.ARCGIS_PASSWORD)) {
    missing.push('ARCGIS_TOKEN or ARCGIS_USERNAME/ARCGIS_PASSWORD');
  }
  if (missing.length > 0) {
    throw new Error(`Missing required environment variable(s): ${missing.join(', ')}`);
  }

  const iqaiV2Enabled = /^true$/i.test(process.env.IQAI_V2_ENABLED || '');
  const spatialLayersEnabled = process.env.SPATIAL_LAYERS_ENABLED == null
    ? true
    : /^true$/i.test(process.env.SPATIAL_LAYERS_ENABLED);
  const legacyUiEnabled = process.env.LEGACY_UI_ENABLED == null
    ? true
    : /^true$/i.test(process.env.LEGACY_UI_ENABLED);
  const enableDataDocked = /^true$/i.test(process.env.ENABLE_DATA_DOCKED || '')
    && Boolean(process.env.DATADOCKED_API_KEY);

  return {
    aisstreamApiKey: process.env.AISSTREAM_API_KEY,
    aisstreamUrl: process.env.AISSTREAM_URL || 'wss://stream.aisstream.io/v0/stream',
    targetMmsi: Number(process.env.TARGET_MMSI || '247999000'),
    arcgisItemId: process.env.ARCGIS_ITEM_ID,
    arcgisToken: process.env.ARCGIS_TOKEN,
    arcgisUsername: process.env.ARCGIS_USERNAME,
    arcgisPassword: process.env.ARCGIS_PASSWORD,
    arcgisPortalUrl: process.env.ARCGIS_PORTAL_URL || 'https://www.arcgis.com',
    arcgisFeatureServiceUrl: process.env.ARCGIS_FEATURE_SERVICE_URL || DEFAULT_FEATURE_SERVICE_URL,
    currentLayerId: Number(process.env.ARCGIS_CURRENT_LAYER_ID || '0'),
    historyLayerId: Number(process.env.ARCGIS_HISTORY_LAYER_ID || '1'),
    travelledRouteLayerId: Number(process.env.ARCGIS_TRAVELLED_ROUTE_LAYER_ID || '2'),
    destinationLayerId: Number(process.env.ARCGIS_DESTINATION_LAYER_ID || '3'),
    estimatedRouteLayerId: Number(process.env.ARCGIS_ESTIMATED_ROUTE_LAYER_ID || '4'),
    enableConditions: /^true$/i.test(process.env.ENABLE_CONDITIONS || 'true'),
    conditionsLayerId: Number(process.env.ARCGIS_CONDITIONS_LAYER_ID || '5'),
    openMeteoWeatherBaseUrl: process.env.OPEN_METEO_WEATHER_BASE_URL || 'https://api.open-meteo.com/v1/forecast',
    openMeteoMarineBaseUrl: process.env.OPEN_METEO_MARINE_BASE_URL || 'https://marine-api.open-meteo.com/v1/marine',
    openMeteoApiKey: process.env.OPEN_METEO_API_KEY || '',
    openMeteoRefreshSeconds: Number(process.env.OPEN_METEO_REFRESH_SECONDS || '1800'),
    openMeteoForecastHours: Number(process.env.OPEN_METEO_FORECAST_HOURS || '24'),
    openMeteoMaxPositionAgeSeconds: Number(process.env.OPEN_METEO_MAX_POSITION_AGE_SECONDS || '21600'),
    openMeteoRequestTimeoutSeconds: Number(process.env.OPEN_METEO_REQUEST_TIMEOUT_SECONDS || '15'),
    enableHistory: /^false$/i.test(process.env.ENABLE_HISTORY || '') ? false : true,
    historyMinIntervalSeconds: Number(process.env.HISTORY_MIN_INTERVAL_SECONDS || '300'),
    routeMaxHistoryPoints: Number(process.env.ROUTE_MAX_HISTORY_POINTS || '5000'),
    etaMinSpeedKnots: Number(process.env.ETA_MIN_SPEED_KNOTS || '1'),
    destinationName: process.env.DESTINATION_NAME || 'Ponta Delgada, Portugal',
    destinationPortCode: process.env.DESTINATION_PORT_CODE || 'PTPDL',
    destinationLatitude: process.env.DESTINATION_LATITUDE || '37.734722',
    destinationLongitude: process.env.DESTINATION_LONGITUDE || '-25.664444',
    healthStaleAfterSeconds: Number(process.env.HEALTH_STALE_AFTER_SECONDS || '1800'),
    datadockedApiKey: process.env.DATADOCKED_API_KEY,
    datadockedBaseUrl: process.env.DATADOCKED_BASE_URL || 'https://datadocked.com/api/vessels_operations',
    datadockedPollIntervalSeconds: Number(process.env.DATADOCKED_POLL_INTERVAL_SECONDS || '1800'),
    datadockedAisStaleSeconds: Number(process.env.DATADOCKED_AIS_STALE_SECONDS || '300'),
    port: Number(process.env.PORT || '3000'),
    logLevel: process.env.LOG_LEVEL || 'info',
    iqaiV2Enabled,
    spatialLayersEnabled,
    legacyUiEnabled,
    radarEnabled: /^true$/i.test(process.env.RADAR_ENABLED || ''),
    enableDataDocked,
    oceanViewWebmapId: process.env.OCEAN_VIEW_WEBMAP_ID || '86f1b6a9b6124da5b362964749b5d797'
  };
}
