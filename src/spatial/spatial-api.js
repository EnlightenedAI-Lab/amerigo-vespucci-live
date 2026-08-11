import { LAYER_CATALOG } from './layer-catalog.js';
import { parseDestinationConfig } from '../navigation.js';

export function getSpatialPublicConfig(config, options = {}) {
  const destination = parseDestinationConfig(config);
  const googleMapsBrowserApiKey = String(config.googleMapsBrowserApiKey || '').trim();
  return {
    v2ShellEnabled: config.iqaiV2Enabled === true,
    v2Enabled: config.iqaiV2Enabled === true,
    spatialLayersEnabled: config.spatialLayersEnabled !== false,
    legacyUiEnabled: config.legacyUiEnabled !== false,
    radarEnabled: config.radarEnabled === true,
    preview: options.preview === true,
    mmsi: config.targetMmsi,
    vesselName: 'Amerigo Vespucci',
    destination,
    notForNavigation: 'Situational awareness only — not for navigation.',
    oceanViewWebmapId: config.oceanViewWebmapId,
    featureServiceUrl: config.arcgisFeatureServiceUrl,
    featureLayerIds: {
      current: config.currentLayerId,
      history: config.historyLayerId,
      travelled: config.travelledRouteLayerId,
      destination: config.destinationLayerId,
      estimated: config.estimatedRouteLayerId,
      conditions: config.conditionsLayerId
    },
    modes: ['navigation', 'ocean', 'weather', 'satellite', 'intelligence'],
    defaultMode: 'navigation',
    // Browser-restricted Maps JS key only (HTTP referrer restricted). Optional Street View V1.
    streetLevelContext: {
      configured: Boolean(googleMapsBrowserApiKey),
      provider: 'google-street-view',
      googleMapsBrowserApiKey: googleMapsBrowserApiKey || null
    }
  };
}

export function getSanitizedCatalog() {
  return LAYER_CATALOG.map((layer) => ({
    id: layer.id,
    title: layer.title,
    provider: layer.provider,
    sourceType: layer.sourceType,
    endpoint: layer.endpoint?.startsWith('/api/') ? layer.endpoint : layer.endpoint,
    portalItemId: layer.portalItemId || null,
    layerName: layer.layerName,
    evidenceClass: layer.evidenceClass,
    timeSupport: layer.timeSupport,
    costClass: layer.costClass,
    licenceStatus: layer.licenceStatus,
    attribution: layer.attribution,
    notForNavigation: layer.notForNavigation,
    defaultOpacity: layer.defaultOpacity,
    modes: layer.modes,
    enabled: layer.enabled,
    exclusiveGroup: layer.exclusiveGroup || null,
    retired: layer.retired || false,
    blockedReason: layer.blockedReason || null,
    revalidatedAt: layer.revalidatedAt
  }));
}
