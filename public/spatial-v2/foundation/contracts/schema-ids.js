/**
 * Canonical Spatial V2 foundation schema identities.
 * Mission 1 implements the World State / refs / time / truth / action /
 * result / scenario / CRS family. Registry engines are later missions.
 */

export const SCHEMA_VERSION = '1.0.0';

export const SCHEMA_IDS = Object.freeze({
  WORLD_STATE: 'iqai.spatial.world-state/1.0.0',
  FOCUS_REF: 'iqai.spatial.focus-ref/1.0.0',
  OBJECT_REF: 'iqai.spatial.object-ref/1.0.0',
  SELECTION_SET: 'iqai.spatial.selection-set/1.0.0',
  ACTION: 'iqai.spatial.action/1.0.0',
  RESULT: 'iqai.spatial.result/1.0.0',
  LAYER: 'iqai.spatial.layer/1.0.0',
  VIEW: 'iqai.spatial.view/1.0.0',
  TRUTH_ENVELOPE: 'iqai.truth-envelope/1.0.0',
  TEMPORAL_CONTEXT: 'iqai.temporal-context/1.0.0',
  SCENARIO: 'iqai.scenario/1.0.0',
  SPATIAL_REFERENCE: 'iqai.spatial-reference/1.0.0',
  ACTIVITY_EVENT: 'iqai.activity-event/1.0.0'
});

export function schemaVersionOf(schemaId) {
  const text = String(schemaId || '');
  const slash = text.lastIndexOf('/');
  return slash >= 0 ? text.slice(slash + 1) : SCHEMA_VERSION;
}

export function isCanonicalV1Schema(schemaId, schemaVersion, canonicalId) {
  const version = schemaVersionOf(canonicalId);
  if (schemaId != null && schemaId !== canonicalId) return false;
  if (schemaVersion != null && schemaVersion !== version) return false;
  return true;
}
