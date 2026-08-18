/**
 * Scenario reference and ScenarioV1 schema.
 * Scenario Manager / Future Worlds UI is a later mission.
 */

import { SCHEMA_IDS } from './schema-ids.js';
import { TRUTH_CLASS } from './truth-envelope.js';
import {
  failClosed,
  optionalString,
  rejectUnknownKeys,
  requireArray,
  requireInteger,
  requirePlainObject,
  requireString
} from './validate.js';

export const SCENARIO_KIND = Object.freeze({
  DETERMINISTIC: 'DETERMINISTIC',
  GENERATIVE: 'GENERATIVE'
});

export const SCENARIO_STATUS = Object.freeze({
  DRAFT: 'DRAFT',
  READY: 'READY',
  RUNNING: 'RUNNING',
  COMPLETE: 'COMPLETE',
  FAILED: 'FAILED',
  UNAVAILABLE: 'UNAVAILABLE'
});

const REF_KEYS = ['scenarioId', 'worldId', 'revision'];

const SCENARIO_KEYS = [
  'schemaId',
  'scenarioId',
  'name',
  'kind',
  'baseline',
  'assumptions',
  'inputLayerRefs',
  'parameters',
  'horizon',
  'engineId',
  'modelId',
  'engineVersion',
  'seed',
  'status',
  'jobRef',
  'outputLayerRefs',
  'uncertainty',
  'confidence',
  'provenance',
  'generatedAt',
  'truthClass'
];

export function createScenarioRef(input = {}) {
  requirePlainObject(input, 'ScenarioRef');
  rejectUnknownKeys(input, 'ScenarioRef', REF_KEYS);
  return {
    scenarioId: requireString(input.scenarioId, 'scenarioId'),
    worldId: optionalString(input.worldId, 'worldId'),
    revision: input.revision == null ? null : requireInteger(input.revision, 'revision', { min: 0 })
  };
}

export function createAssumptionRef(input = {}) {
  requirePlainObject(input, 'AssumptionRef');
  rejectUnknownKeys(input, 'AssumptionRef', ['assumptionId', 'statement']);
  return {
    assumptionId: requireString(input.assumptionId, 'assumptionId'),
    statement: requireString(input.statement, 'statement')
  };
}

export function createScenario(input = {}) {
  requirePlainObject(input, 'Scenario');
  rejectUnknownKeys(input, 'Scenario', SCENARIO_KEYS);
  const kind = requireString(input.kind, 'kind');
  if (!Object.values(SCENARIO_KIND).includes(kind)) {
    failClosed('UNKNOWN_ENUM', 'Scenario kind is unknown.', { kind });
  }
  const status = requireString(input.status || SCENARIO_STATUS.UNAVAILABLE, 'status');
  if (!Object.values(SCENARIO_STATUS).includes(status)) {
    failClosed('UNKNOWN_ENUM', 'Scenario status is unknown.', { status });
  }
  const truthClass = requireString(
    input.truthClass || (kind === SCENARIO_KIND.GENERATIVE ? TRUTH_CLASS.AI_GENERATED : TRUTH_CLASS.SIMULATED),
    'truthClass'
  );
  if (kind === SCENARIO_KIND.GENERATIVE && truthClass !== TRUTH_CLASS.AI_GENERATED) {
    failClosed('TRUTH_CLASS_FORBIDDEN', 'Generative-world output cannot be promoted off AI-GENERATED.', { truthClass });
  }
  if (kind === SCENARIO_KIND.DETERMINISTIC && truthClass !== TRUTH_CLASS.SIMULATED) {
    failClosed(
      'TRUTH_CLASS_FORBIDDEN',
      'Deterministic/scientific scenario output must remain SIMULATED.',
      { truthClass }
    );
  }
  requirePlainObject(input.baseline || {}, 'baseline');
  return {
    schemaId: SCHEMA_IDS.SCENARIO,
    scenarioId: requireString(input.scenarioId, 'scenarioId'),
    name: requireString(input.name, 'name'),
    kind,
    baseline: {
      worldId: requireString(input.baseline.worldId, 'baseline.worldId'),
      revision: requireInteger(input.baseline.revision, 'baseline.revision', { min: 0 })
    },
    assumptions: requireArray(input.assumptions ?? [], 'assumptions').map((item) => createAssumptionRef(item)),
    inputLayerRefs: requireArray(input.inputLayerRefs ?? [], 'inputLayerRefs').map((ref, i) => requireString(ref, `inputLayerRefs[${i}]`)),
    parameters: input.parameters && typeof input.parameters === 'object' ? { ...input.parameters } : {},
    horizon: optionalString(input.horizon, 'horizon'),
    engineId: optionalString(input.engineId, 'engineId'),
    modelId: optionalString(input.modelId, 'modelId'),
    engineVersion: optionalString(input.engineVersion, 'engineVersion'),
    seed: optionalString(input.seed, 'seed'),
    status,
    jobRef: optionalString(input.jobRef, 'jobRef'),
    outputLayerRefs: requireArray(input.outputLayerRefs ?? [], 'outputLayerRefs').map((ref, i) => requireString(ref, `outputLayerRefs[${i}]`)),
    uncertainty: optionalString(input.uncertainty, 'uncertainty'),
    confidence: optionalString(input.confidence, 'confidence'),
    provenance: optionalString(input.provenance, 'provenance'),
    generatedAt: optionalString(input.generatedAt, 'generatedAt'),
    truthClass
  };
}

export function validateScenario(value) {
  return createScenario(value);
}
