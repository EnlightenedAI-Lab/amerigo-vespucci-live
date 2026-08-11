/** Analyst Point Intelligence UI product gate — single source of truth. */
export const POINT_INTELLIGENCE_UI_ENABLED = true;

/** Verified Agent 5 informationFamily keys (V2). */
export const POINT_INTELLIGENCE_FAMILIES = Object.freeze({
  HYDROMETRIC: 'hydrometric',
  CLIMATE: 'climate',
  WEATHER: 'weather',
  WEATHER_CURRENT: 'weather-current',
  CLIMATE_HOURLY: 'climate-hourly',
  AIR_QUALITY: 'air-quality',
  HYDROMETRIC_MEASUREMENT: 'hydrometric-measurement'
});

/** All verified families queried on a multi-capability map click. */
export const POINT_INTELLIGENCE_FAMILY_ORDER = Object.freeze([
  POINT_INTELLIGENCE_FAMILIES.WEATHER,
  POINT_INTELLIGENCE_FAMILIES.WEATHER_CURRENT,
  POINT_INTELLIGENCE_FAMILIES.CLIMATE,
  POINT_INTELLIGENCE_FAMILIES.CLIMATE_HOURLY,
  POINT_INTELLIGENCE_FAMILIES.AIR_QUALITY,
  POINT_INTELLIGENCE_FAMILIES.HYDROMETRIC,
  POINT_INTELLIGENCE_FAMILIES.HYDROMETRIC_MEASUREMENT
]);

/** Analyst-facing result groups (presentation only). */
export const POINT_INTELLIGENCE_FAMILY_GROUPS = Object.freeze([
  {
    id: 'weather',
    label: 'Weather',
    families: [POINT_INTELLIGENCE_FAMILIES.WEATHER],
    sublabel: 'SWOB near-real-time observations'
  },
  {
    id: 'weather-current',
    label: 'Current Weather',
    families: [POINT_INTELLIGENCE_FAMILIES.WEATHER_CURRENT],
    sublabel: 'City/place current conditions'
  },
  {
    id: 'climate',
    label: 'Climate',
    families: [POINT_INTELLIGENCE_FAMILIES.CLIMATE, POINT_INTELLIGENCE_FAMILIES.CLIMATE_HOURLY],
    sublabels: {
      climate: 'Historical daily climate records',
      'climate-hourly': 'Recent hourly climate observations'
    }
  },
  {
    id: 'air-quality',
    label: 'Air Quality',
    families: [POINT_INTELLIGENCE_FAMILIES.AIR_QUALITY],
    sublabel: 'AQHI near-real-time observations'
  },
  {
    id: 'hydrometric',
    label: 'Hydrometric',
    families: [POINT_INTELLIGENCE_FAMILIES.HYDROMETRIC, POINT_INTELLIGENCE_FAMILIES.HYDROMETRIC_MEASUREMENT],
    sublabels: {
      hydrometric: 'Station registry',
      'hydrometric-measurement': 'Near-real-time water measurements'
    }
  }
]);

/** Scalable domain taxonomy for Location Intelligence Focus (presentation only). */
export const POINT_INTELLIGENCE_DOMAINS = Object.freeze([
  { id: 'weather-atmosphere', label: 'Weather & Atmosphere', order: 10 },
  { id: 'climate', label: 'Climate', order: 20 },
  { id: 'air-environment', label: 'Air & Environment', order: 30 },
  { id: 'hydrology', label: 'Hydrology', order: 40 }
]);

/**
 * Central family presentation metadata — domain, label, ordering.
 * Presentation only; does not affect Agent 5 planning.
 */
export const POINT_INTELLIGENCE_FAMILY_METADATA = Object.freeze({
  [POINT_INTELLIGENCE_FAMILIES.WEATHER]: {
    label: 'Weather',
    domainId: 'weather-atmosphere',
    order: 10
  },
  [POINT_INTELLIGENCE_FAMILIES.WEATHER_CURRENT]: {
    label: 'Current Weather',
    domainId: 'weather-atmosphere',
    order: 20
  },
  [POINT_INTELLIGENCE_FAMILIES.CLIMATE]: {
    label: 'Climate (Daily)',
    domainId: 'climate',
    order: 10
  },
  [POINT_INTELLIGENCE_FAMILIES.CLIMATE_HOURLY]: {
    label: 'Climate (Hourly)',
    domainId: 'climate',
    order: 20
  },
  [POINT_INTELLIGENCE_FAMILIES.AIR_QUALITY]: {
    label: 'Air Quality',
    domainId: 'air-environment',
    order: 10
  },
  [POINT_INTELLIGENCE_FAMILIES.HYDROMETRIC]: {
    label: 'Hydrometric (Registry)',
    domainId: 'hydrology',
    order: 10
  },
  [POINT_INTELLIGENCE_FAMILIES.HYDROMETRIC_MEASUREMENT]: {
    label: 'Hydrometric (Measurement)',
    domainId: 'hydrology',
    order: 20
  }
});

/**
 * @param {string} family
 */
export function getPointIntelligenceFamilyMetadata(family) {
  const meta = POINT_INTELLIGENCE_FAMILY_METADATA[family];
  if (meta) {
    const domain = POINT_INTELLIGENCE_DOMAINS.find((d) => d.id === meta.domainId);
    return {
      ...meta,
      domainOrder: domain?.order ?? 999,
      domainLabel: domain?.label ?? 'Other'
    };
  }
  return {
    label: String(family || 'Unknown').replace(/-/g, ' '),
    domainId: 'other',
    domainOrder: 999,
    domainLabel: 'Other',
    order: 999
  };
}

export function listPointIntelligenceDomains() {
  return [...POINT_INTELLIGENCE_DOMAINS].sort((a, b) => a.order - b.order);
}

export const DEFAULT_RADIUS_METERS = 3000;
export const MAX_RADIUS_METERS = 50000;

/** V3 bundle product execution — AUTO family selection only. */
export const POINT_INTELLIGENCE_BUNDLE_AUTO = 'AUTO';

/** V3 bundle product temporal intent — LATEST only. */
export const POINT_INTELLIGENCE_TEMPORAL_LATEST = Object.freeze({ mode: 'LATEST' });

export function isVerifiedPointIntelligenceFamily(value) {
  return Object.values(POINT_INTELLIGENCE_FAMILIES).includes(value);
}
