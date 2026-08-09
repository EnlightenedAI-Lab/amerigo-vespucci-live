import { buildDemoMapData, finalizeDemoMapData, DEMO_MMSI } from '../test/demo/fixtures.js';

/**
 * Read-only map API backed by local demo fixtures.
 * Makes zero external network calls.
 */
export class DemoMapApiService {
  async getVessel() {
    return finalizeDemoMapData(buildDemoMapData()).vessel;
  }

  async getHistory() {
    return buildDemoMapData().history;
  }

  async getTravelledRoute() {
    return buildDemoMapData().travelledRoute;
  }

  async getDestination() {
    return buildDemoMapData().destination;
  }

  async getEstimatedRoute() {
    return buildDemoMapData().estimatedRoute;
  }

  async getConditions() {
    return finalizeDemoMapData(buildDemoMapData()).conditions;
  }

  async getMapData() {
    return finalizeDemoMapData(buildDemoMapData());
  }
}

export function createPreviewConfig(port = 3000) {
  return {
    preview: true,
    port,
    targetMmsi: DEMO_MMSI,
    enableHistory: true,
    enableConditions: true,
    healthStaleAfterSeconds: 1800,
    iqaiV2Enabled: false,
    spatialLayersEnabled: true,
    legacyUiEnabled: true,
    radarEnabled: false,
    preview: true,
    oceanViewWebmapId: '86f1b6a9b6124da5b362964749b5d797',
    arcgisPortalUrl: process.env.ARCGIS_PORTAL_URL || 'https://www.arcgis.com',
    montrealArcgisOAuthAppId: process.env.MONTREAL_ARCGIS_OAUTH_APP_ID || process.env.ARCGIS_OAUTH_APP_ID || '',
    montrealOperationalWebmapId: process.env.MONTREAL_OPERATIONAL_WEBMAP_ID || '2ec27986ecfb4dd188d058cae620be0d',
    arcgisFeatureServiceUrl: 'https://services9.arcgis.com/HWLvgMBDdrPG7U8N/arcgis/rest/services/Amerigo_Vespucci_Live/FeatureServer',
    currentLayerId: 0,
    historyLayerId: 1,
    travelledRouteLayerId: 2,
    destinationLayerId: 3,
    estimatedRouteLayerId: 4,
    conditionsLayerId: 5,
    destinationName: 'Ponta Delgada, Portugal',
    destinationPortCode: 'PTPDL',
    destinationLatitude: '37.734722',
    destinationLongitude: '-25.664444',
    etaMinSpeedKnots: 1,
    aisstreamApiKey: process.env.AISSTREAM_API_KEY || '',
    aisstreamUrl: process.env.AISSTREAM_URL || 'wss://stream.aisstream.io/v0/stream'
  };
}

export function createPreviewState() {
  const now = Date.now();
  return {
    lastPosition: null,
    lastPositionSource: 'demo-fixture',
    lastArcGISUpdate: new Date(now - 120_000),
    lastHistoryWrite: new Date(now - 900_000),
    historyPointCount: 7,
    lastTravelledRouteUpdate: new Date(now - 900_000),
    lastDestinationUpdate: new Date(now - 86_400_000),
    lastEstimatedRouteUpdate: new Date(now - 120_000),
    distanceRemainingNM: 285.4,
    estimatedETA: new Date(now + 30 * 3_600_000),
    lastDataDockedAttempt: null,
    lastDataDockedAccepted: null,
    aisClient: null,
    dataDockedClient: null,
    openMeteoClient: null,
    aisConnected: () => false
  };
}
