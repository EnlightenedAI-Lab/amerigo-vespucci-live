/**
 * Agent 1 AI-addressable GIS capability registry.
 * Describes ONLY capabilities that already exist in the deterministic engine.
 * No ArcGIS URLs, layer IDs, or runtime internals are exposed.
 */

export const GIS_PLAN_SCHEMA_ID = 'iqai.spatial.gis-plan';
export const GIS_PLAN_SCHEMA_VERSION = '1.0.0';
export const SUPPORTED_SCHEMA_VERSIONS = ['1.0.0'];

export const A1_GIS_PLAN_CONTRACT_VERSION = 'A1-AIMAP-CONTRACT-01';

/** @readonly */
export const PRODUCT_LIMITS = {
  maxRadiusKm: 50,
  minRadiusM: 50,
  minNearestLimit: 1,
  maxNearestLimit: 25,
  maxLocationTextLength: 300,
  coordinateCrs: 'EPSG:4326'
};

/** Fields that must never appear in a candidate GIS plan. */
export const PROHIBITED_PLAN_FIELDS = [
  'objectIds',
  'objectId',
  'layerId',
  'layerUrl',
  'serviceUrl',
  'renderer',
  'layerView',
  'featureFilter',
  'webmapId',
  'javascript',
  'code',
  'sql',
  'whereClause',
  'browserGlobal',
  'arcgisRequest',
  'executeJavaScript',
  'deleteLayer',
  'removeLayer',
  'setFilter',
  'featureServerId',
  'mapView',
  'portalItemId',
  'geometryEngine',
  'queryFeatures'
];

/** @readonly */
export const DATASET_REGISTRY = {
  fire_stations: {
    key: 'fire_stations',
    displayName: 'Fire Stations',
    pluralLabel: 'fire stations',
    aliases: ['fire', 'fire station', 'fire stations', 'caserne', 'casernes', 'pompier', 'pompiers'],
    engineDatasetId: 'FIRE_STATIONS',
    supportsActiveOnlyFilter: true
  },
  police_stations: {
    key: 'police_stations',
    displayName: 'Police Stations',
    pluralLabel: 'police stations',
    aliases: ['police', 'police station', 'police stations', 'spvm', 'cops'],
    engineDatasetId: 'POLICE_STATIONS',
    supportsActiveOnlyFilter: false
  },
  schools: {
    key: 'schools',
    displayName: 'Schools',
    pluralLabel: 'schools',
    aliases: ['school', 'école', 'ecole', 'établissement scolaire'],
    engineDatasetId: 'SCHOOLS',
    supportsActiveOnlyFilter: false
  },
  hospitals: {
    key: 'hospitals',
    displayName: 'Hospitals',
    pluralLabel: 'hospitals',
    aliases: ['hospital', 'hôpital', 'hopital'],
    engineDatasetId: 'HOSPITALS',
    supportsActiveOnlyFilter: false
  },
  transit: {
    key: 'transit',
    displayName: 'Transit Stops',
    pluralLabel: 'transit',
    aliases: ['transit', 'transit stops', 'bus stop', 'bus stops', 'stm', 'arrêt', 'arret'],
    engineDatasetId: 'TRANSIT',
    supportsActiveOnlyFilter: false
  },
  amenities: {
    key: 'amenities',
    displayName: 'Amenities',
    pluralLabel: 'amenities',
    aliases: ['amenity', 'amenities', 'osm amenities'],
    engineDatasetId: 'AMENITIES',
    supportsActiveOnlyFilter: false
  }
};

/** Approved filter field semantics — not raw source column names. */
export const FILTER_FIELD_SEMANTICS = {
  active_only: {
    key: 'active_only',
    valueType: 'boolean',
    operators: ['equals'],
    permittedDatasets: ['fire_stations']
  }
};

/** @readonly */
export const OPERATION_REGISTRY = {
  LOCATE: {
    id: 'LOCATE',
    aliases: ['locate', 'geocode', 'mark'],
    requiredFields: [],
    optionalFields: ['location', 'locationRef', 'requestedOutput'],
    permittedDatasets: [],
    requiresDataset: false,
    requiresLocation: true,
    requiresRadius: false,
    requiresLimit: false,
    permitsFilters: false,
    producesSpatialResult: true,
    expectsMapRendering: true,
    permitsConversationContext: true
  },
  SHOW: {
    id: 'SHOW',
    aliases: ['show', 'display', 'map'],
    requiredFields: ['dataset'],
    optionalFields: ['filters', 'requestedOutput'],
    permittedDatasets: Object.keys(DATASET_REGISTRY),
    requiresDataset: true,
    requiresLocation: false,
    requiresRadius: false,
    requiresLimit: false,
    permitsFilters: true,
    producesSpatialResult: true,
    expectsMapRendering: true,
    permitsConversationContext: false
  },
  WITHIN: {
    id: 'WITHIN',
    aliases: ['within', 'around', 'inside radius'],
    requiredFields: ['dataset', 'radius'],
    optionalFields: ['location', 'locationRef', 'filters', 'requestedOutput'],
    permittedDatasets: Object.keys(DATASET_REGISTRY),
    requiresDataset: true,
    requiresLocation: true,
    requiresRadius: true,
    requiresLimit: false,
    permitsFilters: true,
    producesSpatialResult: true,
    expectsMapRendering: true,
    permitsConversationContext: true
  },
  NEAREST: {
    id: 'NEAREST',
    aliases: ['nearest', 'closest'],
    requiredFields: ['dataset', 'limit'],
    optionalFields: ['location', 'locationRef', 'filters', 'requestedOutput'],
    permittedDatasets: Object.keys(DATASET_REGISTRY),
    requiresDataset: true,
    requiresLocation: true,
    requiresRadius: false,
    requiresLimit: true,
    permitsFilters: true,
    producesSpatialResult: true,
    expectsMapRendering: true,
    permitsConversationContext: true
  },
  COUNT: {
    id: 'COUNT',
    aliases: ['count', 'how many'],
    requiredFields: ['dataset', 'radius'],
    optionalFields: ['location', 'locationRef', 'filters', 'requestedOutput'],
    permittedDatasets: Object.keys(DATASET_REGISTRY),
    requiresDataset: true,
    requiresLocation: true,
    requiresRadius: true,
    requiresLimit: false,
    permitsFilters: true,
    producesSpatialResult: true,
    expectsMapRendering: false,
    permitsConversationContext: true
  },
  CLEAR: {
    id: 'CLEAR',
    aliases: ['clear', 'clear result', 'remove results'],
    requiredFields: [],
    optionalFields: ['requestedOutput'],
    permittedDatasets: [],
    requiresDataset: false,
    requiresLocation: false,
    requiresRadius: false,
    requiresLimit: false,
    permitsFilters: false,
    producesSpatialResult: false,
    expectsMapRendering: false,
    permitsConversationContext: false,
    semantic: 'CLEAR_RESULT'
  }
};

/** Operations implemented in the engine but NOT AI-addressable in this sprint. */
export const NON_AI_ADDRESSABLE_OPERATIONS = ['INSIDE', 'FILTER', 'RESET_MAP', 'SHOW_LAYER'];

export const GIS_CAPABILITY_REGISTRY = {
  schemaId: GIS_PLAN_SCHEMA_ID,
  schemaVersion: GIS_PLAN_SCHEMA_VERSION,
  contractVersion: A1_GIS_PLAN_CONTRACT_VERSION,
  productLimits: PRODUCT_LIMITS,
  prohibitedFields: PROHIBITED_PLAN_FIELDS,
  datasets: DATASET_REGISTRY,
  operations: OPERATION_REGISTRY,
  filterSemantics: FILTER_FIELD_SEMANTICS,
  nonAiAddressableOperations: NON_AI_ADDRESSABLE_OPERATIONS
};

/**
 * @param {string} raw
 */
export function resolveDatasetKey(raw) {
  const text = String(raw || '').trim().toLowerCase().replace(/\s+/g, '_');
  if (!text) return null;
  if (DATASET_REGISTRY[text]) return text;
  for (const dataset of Object.values(DATASET_REGISTRY)) {
    if (dataset.key === text) return dataset.key;
    if (dataset.aliases.some((alias) => alias.toLowerCase().replace(/\s+/g, '_') === text)) {
      return dataset.key;
    }
    if (dataset.displayName.toLowerCase().replace(/\s+/g, '_') === text) return dataset.key;
  }
  const loose = String(raw || '').trim().toLowerCase();
  for (const dataset of Object.values(DATASET_REGISTRY)) {
    if (dataset.aliases.some((alias) => loose === alias || loose.includes(alias))) {
      return dataset.key;
    }
  }
  return null;
}

/**
 * @param {string} raw
 */
export function resolveOperationId(raw) {
  const text = String(raw || '').trim().toUpperCase().replace(/\s+/g, '_');
  if (!text) return null;
  if (OPERATION_REGISTRY[text]) return text;
  if (NON_AI_ADDRESSABLE_OPERATIONS.includes(text)) return null;
  for (const op of Object.values(OPERATION_REGISTRY)) {
    if (op.aliases.some((alias) => alias.toUpperCase().replace(/\s+/g, '_') === text)) {
      return op.id;
    }
  }
  const loose = String(raw || '').trim().toLowerCase();
  for (const op of Object.values(OPERATION_REGISTRY)) {
    if (op.aliases.some((alias) => loose === alias)) return op.id;
  }
  return null;
}
