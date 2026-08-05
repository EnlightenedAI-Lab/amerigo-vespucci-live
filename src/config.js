import 'dotenv/config';

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

  return {
    aisstreamApiKey: process.env.AISSTREAM_API_KEY,
    aisstreamUrl: process.env.AISSTREAM_URL || 'wss://stream.aisstream.io/v0/stream',
    targetMmsi: Number(process.env.TARGET_MMSI || '247999000'),
    arcgisItemId: process.env.ARCGIS_ITEM_ID,
    arcgisToken: process.env.ARCGIS_TOKEN,
    arcgisUsername: process.env.ARCGIS_USERNAME,
    arcgisPassword: process.env.ARCGIS_PASSWORD,
    arcgisPortalUrl: process.env.ARCGIS_PORTAL_URL || 'https://www.arcgis.com',
    currentLayerId: Number(process.env.ARCGIS_CURRENT_LAYER_ID || '0'),
    historyLayerId: Number(process.env.ARCGIS_HISTORY_LAYER_ID || '1'),
    enableHistory: /^true$/i.test(process.env.ENABLE_HISTORY || 'false'),
    historyMinIntervalSeconds: Number(process.env.HISTORY_MIN_INTERVAL_SECONDS || '300'),
    healthStaleAfterSeconds: Number(process.env.HEALTH_STALE_AFTER_SECONDS || '1800'),
    port: Number(process.env.PORT || '3000'),
    logLevel: process.env.LOG_LEVEL || 'info'
  };
}
