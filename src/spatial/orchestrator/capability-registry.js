/**
 * Static V1 capability and agent registry — configuration-backed, no runtime self-registration.
 */
import {
  CAPABILITY_AUTHORITATIVE_DATA_QUERY,
  CAPABILITY_VERSION,
  MAP_ACTION_TYPES
} from './contracts.js';

/** @type {import('./contracts.js').AgentCapability[]} */
export const CAPABILITY_REGISTRY = Object.freeze([
  {
    capabilityId: CAPABILITY_AUTHORITATIVE_DATA_QUERY,
    version: CAPABILITY_VERSION,
    displayName: 'Authoritative Data Query',
    inputSchemaId: 'iqai.orchestrator.authoritative-data-query.input.v1',
    outputSchemaId: 'iqai.orchestrator.authoritative-data-query.output.v1',
    mode: 'DETERMINISTIC',
    features: ['WITHIN', 'NEAREST', 'LOCATE', 'COUNT', 'CLEAR'],
    constraints: {
      providerNeutral: true,
      noLlmGeometry: true,
      sessionOnly: true
    },
    determinismClass: 'DETERMINISTIC',
    health: 'AVAILABLE',
    performance: { expectedLatencyClass: 'DATA_BOUND' },
    cost: { billingClass: 'LOW' }
  },
  {
    capabilityId: 'MAP_ACTION_PLAN_BUILDER',
    version: CAPABILITY_VERSION,
    displayName: 'Map Action Plan Builder',
    inputSchemaId: 'iqai.orchestrator.map-plan-builder.input.v1',
    outputSchemaId: 'iqai.orchestrator.map-plan-builder.output.v1',
    mode: 'DETERMINISTIC',
    features: ['MAP_ACTION_PLAN'],
    constraints: { providerNeutral: true, sessionOnly: true },
    determinismClass: 'DETERMINISTIC',
    health: 'AVAILABLE'
  },
  {
    capabilityId: 'MAP_ACTION_EXECUTOR',
    version: CAPABILITY_VERSION,
    displayName: 'Map Action Executor',
    inputSchemaId: 'iqai.orchestrator.map-executor.input.v1',
    outputSchemaId: 'iqai.orchestrator.map-executor.output.v1',
    mode: 'DETERMINISTIC',
    features: Object.keys(MAP_ACTION_TYPES),
    constraints: { providerNeutral: true, sessionOnly: true, noPersistence: true },
    determinismClass: 'DETERMINISTIC',
    health: 'AVAILABLE'
  },
  {
    capabilityId: 'CORPUS_SEARCH',
    version: CAPABILITY_VERSION,
    displayName: 'Corpus Search',
    inputSchemaId: 'iqai.orchestrator.corpus-search.input.v1',
    outputSchemaId: 'iqai.orchestrator.corpus-search.output.v1',
    mode: 'DETERMINISTIC',
    features: ['CORPUS'],
    constraints: { providerNeutral: true, sessionOnly: true },
    determinismClass: 'DETERMINISTIC',
    health: 'AVAILABLE'
  },
  {
    capabilityId: 'LIVE_INTELLIGENCE_RETRIEVAL',
    version: CAPABILITY_VERSION,
    displayName: 'Live Intelligence Retrieval',
    inputSchemaId: 'iqai.orchestrator.live-retrieval.input.v1',
    outputSchemaId: 'iqai.orchestrator.live-retrieval.output.v1',
    mode: 'RESEARCH',
    features: ['STREAM', 'FAST', 'DEEP'],
    constraints: { providerNeutral: true },
    determinismClass: 'NON_DETERMINISTIC',
    health: 'AVAILABLE'
  },
  {
    capabilityId: 'GOVERN_CANDIDATE',
    version: CAPABILITY_VERSION,
    displayName: 'Govern Candidate',
    inputSchemaId: 'iqai.orchestrator.govern-candidate.input.v1',
    outputSchemaId: 'iqai.orchestrator.govern-candidate.output.v1',
    mode: 'DETERMINISTIC',
    features: ['ADMISSION_GATE'],
    constraints: { agent2Adapter: true, notEvidenceIntegrity: true },
    determinismClass: 'DETERMINISTIC',
    health: 'AVAILABLE'
  },
  {
    capabilityId: 'SPATIAL_PROXIMITY_ANALYSIS',
    version: CAPABILITY_VERSION,
    displayName: 'Spatial Proximity Analysis',
    inputSchemaId: 'iqai.orchestrator.spatial-proximity.input.v1',
    outputSchemaId: 'iqai.orchestrator.spatial-proximity.output.v1',
    mode: 'DETERMINISTIC',
    features: ['PROXIMITY', 'WITHIN_DISTANCE', 'HOSPITAL_OVERLAY'],
    constraints: { providerNeutral: true, noLlmGeometry: true, crossAgent: true },
    determinismClass: 'DETERMINISTIC',
    health: 'AVAILABLE'
  },
  {
    capabilityId: 'GEOCODE_LOCATION',
    version: CAPABILITY_VERSION,
    displayName: 'Geocode Location',
    inputSchemaId: 'iqai.orchestrator.geocode.input.v1',
    outputSchemaId: 'iqai.orchestrator.geocode.output.v1',
    mode: 'DETERMINISTIC',
    features: ['ESRI_NATIVE'],
    constraints: { providerNeutral: true, noLlmGeometry: true },
    determinismClass: 'DETERMINISTIC',
    health: 'AVAILABLE'
  },
  {
    capabilityId: 'DATA_VERSION_ENRICHMENT',
    version: CAPABILITY_VERSION,
    displayName: 'Data Version Enrichment',
    inputSchemaId: 'iqai.orchestrator.data-version.input.v1',
    outputSchemaId: 'iqai.orchestrator.data-version.output.v1',
    mode: 'DETERMINISTIC',
    features: ['UPDATE_FEATURES'],
    constraints: { providerNeutral: true, sessionOnly: true },
    determinismClass: 'DETERMINISTIC',
    health: 'AVAILABLE'
  }
]);

/** @type {import('./contracts.js').AgentRegistration[]} */
export const AGENT_REGISTRY = Object.freeze([
  {
    agentId: 'deterministic-gis-worker',
    implementationVersion: '1.0.0',
    capabilities: [CAPABILITY_AUTHORITATIVE_DATA_QUERY],
    eligibility: { deployment: 'in-process', trust: 'AUTHORITATIVE' },
    runtimeProfile: { side: 'server', sandbox: 'bounded' }
  },
  {
    agentId: 'map-plan-builder-worker',
    implementationVersion: '1.0.0',
    capabilities: ['MAP_ACTION_PLAN_BUILDER'],
    eligibility: { deployment: 'in-process', trust: 'AUTHORITATIVE' },
    runtimeProfile: { side: 'shared', sandbox: 'bounded' }
  },
  {
    agentId: 'arcgis-map-executor',
    implementationVersion: '1.0.0',
    capabilities: ['MAP_ACTION_EXECUTOR'],
    eligibility: { deployment: 'in-process', trust: 'AUTHORITATIVE' },
    runtimeProfile: { side: 'client', sandbox: 'bounded' }
  }
]);

/**
 * @param {string} capabilityId
 * @param {string} [version]
 */
export function lookupCapability(capabilityId, version = CAPABILITY_VERSION) {
  return CAPABILITY_REGISTRY.find((entry) =>
    entry.capabilityId === capabilityId && entry.version === version) || null;
}

/**
 * @param {string} agentId
 */
export function lookupAgent(agentId) {
  return AGENT_REGISTRY.find((entry) => entry.agentId === agentId) || null;
}

/**
 * @param {string} capabilityId
 * @param {string} [version]
 */
export function assertCapabilityAvailable(capabilityId, version = CAPABILITY_VERSION) {
  const capability = lookupCapability(capabilityId, version);
  if (!capability) {
    const err = new Error(`Capability not registered: ${capabilityId}@${version}`);
    err.code = 'CAPABILITY_NOT_FOUND';
    throw err;
  }
  if (capability.health !== 'AVAILABLE') {
    const err = new Error(`Capability unavailable: ${capabilityId}@${version}`);
    err.code = 'CAPABILITY_UNAVAILABLE';
    throw err;
  }
  return capability;
}
