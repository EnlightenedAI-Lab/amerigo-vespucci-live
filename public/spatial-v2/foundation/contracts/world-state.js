/**
 * Canonical serializable World State. Provider objects and runtime handles
 * are prohibited. PolicyService remains authorization authority; security
 * fields here are an effective snapshot only.
 */

import { SCHEMA_IDS, SCHEMA_VERSION } from './schema-ids.js';
import { validateFocusRef } from './focus-ref.js';
import { createEmptySelectionSet, validateSelectionSet } from './selection-set.js';
import { createGeometryRef } from './geometry-ref.js';
import { createDefaultTemporalContext, validateTemporalContext } from './temporal-context.js';
import { createAssumptionRef, createScenarioRef } from './scenario-ref.js';
import {
  createId,
  failClosed,
  isoNow,
  optionalString,
  rejectUnknownKeys,
  requireArray,
  requireInteger,
  requirePlainObject,
  requireString
} from './validate.js';

export const VIEW_ID = Object.freeze({
  MAP: 'MAP',
  STREET_360: 'STREET 360',
  VISUAL_3D: '3D VISUAL',
  ANALYZE_3D: '3D ANALYZE'
});

export const VIEW_LIFECYCLE = Object.freeze({
  MOUNT_ONCE: 'MOUNT_ONCE',
  DEFERRED: 'DEFERRED',
  REGISTERED: 'REGISTERED'
});

export const OPERATOR_MODE = Object.freeze({
  NORMAL: 'NORMAL',
  EXPERT: 'EXPERT'
});

const WORLD_KEYS = [
  'schemaId',
  'schemaVersion',
  'stateId',
  'revision',
  'createdAt',
  'updatedAt',
  'activeFocus',
  'selection',
  'aoi',
  'workspace',
  'views',
  'cameras',
  'layers',
  'temporal',
  'sources',
  'results',
  'worlds',
  'assumptions',
  'security',
  'context'
];

const WORKSPACE_KEYS = ['workspaceId', 'kind', 'activeToolIds'];
const VIEWS_KEYS = ['primaryViewId', 'activeViewIds', 'byId'];
const VIEW_REF_KEYS = ['viewId', 'lifecycle'];
const CAMERAS_KEYS = ['byViewId'];
const CAMERA_KEYS = ['viewId', 'retained', 'spatialReferenceRef', 'center', 'scale', 'heading', 'tilt'];
const CENTER_KEYS = ['x', 'y', 'z'];
const LAYERS_KEYS = ['orderedLayerInstanceIds', 'byId'];
const LAYER_INSTANCE_KEYS = [
  'instanceId',
  'layerId',
  'worldId',
  'visible',
  'opacity',
  'order',
  'activeObservationRef',
  'filterRef',
  'styleRef',
  'status',
  'lastReceiptRef'
];
const SOURCES_KEYS = ['sourceRefs', 'provenanceRefs', 'evidenceRefs'];
const RESULTS_KEYS = ['analysisResultRefs', 'aiResultRefs'];
const WORLDS_KEYS = ['activeWorldId', 'baselineWorldId', 'compareWorldIds', 'scenarioRefs'];
const SECURITY_KEYS = ['identityRef', 'policySnapshotRef', 'effectiveRightsSnapshot'];
const RIGHTS_SNAPSHOT_KEYS = ['snapshotOnly', 'authority', 'unknownIsDeny', 'grants'];
const CONTEXT_KEYS = ['sessionId', 'missionId', 'operatorMode', 'activityCursor'];

function stringRefList(value, label) {
  return requireArray(value ?? [], label).map((item, index) => requireString(item, `${label}[${index}]`));
}

export function createWorkspaceState(input = {}, options = {}) {
  requirePlainObject(input, 'workspace');
  rejectUnknownKeys(input, 'workspace', WORKSPACE_KEYS);
  return {
    workspaceId: input.workspaceId ? requireString(input.workspaceId, 'workspaceId') : createId('workspace', options.idFactory),
    kind: requireString(input.kind || 'OPERATOR_SESSION', 'workspace.kind'),
    activeToolIds: stringRefList(input.activeToolIds, 'activeToolIds')
  };
}

export function createViewStateRef(input = {}) {
  requirePlainObject(input, 'ViewStateRef');
  rejectUnknownKeys(input, 'ViewStateRef', VIEW_REF_KEYS);
  const viewId = requireString(input.viewId, 'viewId');
  const lifecycle = input.lifecycle ? requireString(input.lifecycle, 'lifecycle') : null;
  if (lifecycle && !Object.values(VIEW_LIFECYCLE).includes(lifecycle)) {
    failClosed('UNKNOWN_ENUM', 'View lifecycle is unknown.', { lifecycle });
  }
  return { viewId, lifecycle };
}

function defaultViews() {
  return {
    primaryViewId: VIEW_ID.MAP,
    activeViewIds: [VIEW_ID.MAP],
    byId: {
      [VIEW_ID.MAP]: createViewStateRef({ viewId: VIEW_ID.MAP, lifecycle: VIEW_LIFECYCLE.MOUNT_ONCE }),
      [VIEW_ID.STREET_360]: createViewStateRef({ viewId: VIEW_ID.STREET_360, lifecycle: VIEW_LIFECYCLE.DEFERRED }),
      [VIEW_ID.VISUAL_3D]: createViewStateRef({ viewId: VIEW_ID.VISUAL_3D, lifecycle: VIEW_LIFECYCLE.DEFERRED }),
      [VIEW_ID.ANALYZE_3D]: createViewStateRef({ viewId: VIEW_ID.ANALYZE_3D, lifecycle: VIEW_LIFECYCLE.REGISTERED })
    }
  };
}

export function createViewsState(input) {
  if (input == null) return defaultViews();
  requirePlainObject(input, 'views');
  rejectUnknownKeys(input, 'views', VIEWS_KEYS);
  const byIdInput = requirePlainObject(input.byId || {}, 'views.byId');
  const byId = {};
  for (const [key, value] of Object.entries(byIdInput)) {
    const ref = createViewStateRef(value);
    if (ref.viewId !== key) {
      failClosed('INVALID_VIEW_REF', 'views.byId key must equal viewId.', { key, viewId: ref.viewId });
    }
    byId[key] = ref;
  }
  const primaryViewId = requireString(input.primaryViewId || VIEW_ID.MAP, 'primaryViewId');
  const activeViewIds = stringRefList(input.activeViewIds || [primaryViewId], 'activeViewIds');
  if (!byId[primaryViewId]) {
    failClosed('UNKNOWN_VIEW', 'primaryViewId is not present in views.byId.', { primaryViewId });
  }
  for (const viewId of activeViewIds) {
    if (!byId[viewId]) {
      failClosed('UNKNOWN_VIEW', 'activeViewId is not present in views.byId.', { viewId });
    }
  }
  return { primaryViewId, activeViewIds, byId };
}

function validateCenter(center) {
  if (center == null) return null;
  requirePlainObject(center, 'camera.center');
  rejectUnknownKeys(center, 'camera.center', CENTER_KEYS);
  if (!Number.isFinite(center.x) || !Number.isFinite(center.y)) {
    failClosed('INVALID_NUMBER', 'camera.center x/y must be finite.');
  }
  return {
    x: center.x,
    y: center.y,
    z: center.z == null ? null : Number(center.z)
  };
}

export function createCameraState(input = {}) {
  requirePlainObject(input, 'CameraState');
  rejectUnknownKeys(input, 'CameraState', CAMERA_KEYS);
  const scale = input.scale;
  const heading = input.heading;
  const tilt = input.tilt;
  if (scale != null && (typeof scale !== 'number' || !Number.isFinite(scale))) {
    failClosed('INVALID_NUMBER', 'camera.scale must be finite or null.');
  }
  if (heading != null && (typeof heading !== 'number' || !Number.isFinite(heading))) {
    failClosed('INVALID_NUMBER', 'camera.heading must be finite or null.');
  }
  if (tilt != null && (typeof tilt !== 'number' || !Number.isFinite(tilt))) {
    failClosed('INVALID_NUMBER', 'camera.tilt must be finite or null.');
  }
  return {
    viewId: requireString(input.viewId, 'viewId'),
    retained: input.retained !== false,
    spatialReferenceRef: optionalString(input.spatialReferenceRef, 'spatialReferenceRef'),
    center: validateCenter(input.center),
    scale: scale ?? null,
    heading: heading ?? null,
    tilt: tilt ?? null
  };
}

export function createCamerasState(input) {
  if (input == null) {
    return {
      byViewId: {
        [VIEW_ID.MAP]: createCameraState({ viewId: VIEW_ID.MAP, retained: true })
      }
    };
  }
  requirePlainObject(input, 'cameras');
  rejectUnknownKeys(input, 'cameras', CAMERAS_KEYS);
  const byViewIdInput = requirePlainObject(input.byViewId || {}, 'cameras.byViewId');
  const byViewId = {};
  for (const [key, value] of Object.entries(byViewIdInput)) {
    const camera = createCameraState(value);
    if (camera.viewId !== key) {
      failClosed('INVALID_CAMERA', 'cameras.byViewId key must equal viewId.', { key, viewId: camera.viewId });
    }
    byViewId[key] = camera;
  }
  return { byViewId };
}

export function createLayerInstanceState(input = {}) {
  requirePlainObject(input, 'LayerInstanceState');
  rejectUnknownKeys(input, 'LayerInstanceState', LAYER_INSTANCE_KEYS);
  const opacity = input.opacity;
  if (opacity != null && (typeof opacity !== 'number' || opacity < 0 || opacity > 1)) {
    failClosed('INVALID_NUMBER', 'Layer opacity must be between 0 and 1 or null.');
  }
  return {
    instanceId: requireString(input.instanceId, 'instanceId'),
    layerId: requireString(input.layerId, 'layerId'),
    worldId: requireString(input.worldId, 'worldId'),
    visible: input.visible !== false,
    opacity: opacity == null ? 1 : opacity,
    order: requireInteger(input.order ?? 0, 'order', { min: 0 }),
    activeObservationRef: optionalString(input.activeObservationRef, 'activeObservationRef'),
    filterRef: optionalString(input.filterRef, 'filterRef'),
    styleRef: optionalString(input.styleRef, 'styleRef'),
    status: optionalString(input.status, 'status'),
    lastReceiptRef: optionalString(input.lastReceiptRef, 'lastReceiptRef')
  };
}

export function createLayersState(input) {
  if (input == null) return { orderedLayerInstanceIds: [], byId: {} };
  requirePlainObject(input, 'layers');
  rejectUnknownKeys(input, 'layers', LAYERS_KEYS);
  const byIdInput = requirePlainObject(input.byId || {}, 'layers.byId');
  const byId = {};
  for (const [key, value] of Object.entries(byIdInput)) {
    const instance = createLayerInstanceState(value);
    if (instance.instanceId !== key) {
      failClosed('INVALID_LAYER_INSTANCE', 'layers.byId key must equal instanceId.', { key, instanceId: instance.instanceId });
    }
    byId[key] = instance;
  }
  const orderedLayerInstanceIds = stringRefList(input.orderedLayerInstanceIds, 'orderedLayerInstanceIds');
  for (const instanceId of orderedLayerInstanceIds) {
    if (!byId[instanceId]) {
      failClosed('UNKNOWN_LAYER_INSTANCE', 'orderedLayerInstanceIds contains an unknown instance.', { instanceId });
    }
  }
  return { orderedLayerInstanceIds, byId };
}

export function createSourcesState(input) {
  if (input == null) return { sourceRefs: [], provenanceRefs: [], evidenceRefs: [] };
  requirePlainObject(input, 'sources');
  rejectUnknownKeys(input, 'sources', SOURCES_KEYS);
  return {
    sourceRefs: stringRefList(input.sourceRefs, 'sourceRefs'),
    provenanceRefs: stringRefList(input.provenanceRefs, 'provenanceRefs'),
    evidenceRefs: stringRefList(input.evidenceRefs, 'evidenceRefs')
  };
}

export function createResultsState(input) {
  if (input == null) return { analysisResultRefs: [], aiResultRefs: [] };
  requirePlainObject(input, 'results');
  rejectUnknownKeys(input, 'results', RESULTS_KEYS);
  return {
    analysisResultRefs: stringRefList(input.analysisResultRefs, 'analysisResultRefs'),
    aiResultRefs: stringRefList(input.aiResultRefs, 'aiResultRefs')
  };
}

export function createWorldsState(input, options = {}) {
  if (input == null) {
    const baselineWorldId = createId('world-baseline', options.idFactory);
    return {
      activeWorldId: baselineWorldId,
      baselineWorldId,
      compareWorldIds: [],
      scenarioRefs: []
    };
  }
  requirePlainObject(input, 'worlds');
  rejectUnknownKeys(input, 'worlds', WORLDS_KEYS);
  const baselineWorldId = input.baselineWorldId
    ? requireString(input.baselineWorldId, 'baselineWorldId')
    : createId('world-baseline', options.idFactory);
  return {
    activeWorldId: requireString(input.activeWorldId || baselineWorldId, 'activeWorldId'),
    baselineWorldId,
    compareWorldIds: stringRefList(input.compareWorldIds, 'compareWorldIds'),
    scenarioRefs: requireArray(input.scenarioRefs ?? [], 'scenarioRefs').map((ref) => (
      typeof ref === 'string' ? ref : createScenarioRef(ref).scenarioId
    ))
  };
}

const POLICY_AUTHORITY = 'PolicyService';

function createRightsSnapshot(input) {
  if (input == null) {
    return {
      snapshotOnly: true,
      authority: POLICY_AUTHORITY,
      unknownIsDeny: true,
      grants: []
    };
  }
  requirePlainObject(input, 'effectiveRightsSnapshot');
  rejectUnknownKeys(input, 'effectiveRightsSnapshot', RIGHTS_SNAPSHOT_KEYS);
  if (input.snapshotOnly === false) {
    failClosed(
      'POLICY_AUTHORITY_INJECTION',
      'World State security is snapshot/reference only and cannot claim live Policy authority.'
    );
  }
  if (input.unknownIsDeny === false) {
    failClosed('POLICY_FAIL_OPEN', 'Unknown rights must remain fail-closed. PolicyService remains authority.');
  }
  if (input.authority != null && input.authority !== POLICY_AUTHORITY) {
    failClosed(
      'POLICY_AUTHORITY_INJECTION',
      'PolicyService remains the sole authorization authority.',
      { authority: input.authority }
    );
  }
  const grants = stringRefList(input.grants, 'grants');
  if (grants.length > 0) {
    failClosed(
      'POLICY_GRANT_INJECTION',
      'World State cannot admit caller-minted authorization grants. PolicyService remains authority.'
    );
  }
  return {
    snapshotOnly: true,
    authority: POLICY_AUTHORITY,
    unknownIsDeny: true,
    grants: []
  };
}

export function createSecuritySnapshot(input) {
  if (input == null) {
    return {
      identityRef: null,
      policySnapshotRef: null,
      effectiveRightsSnapshot: createRightsSnapshot()
    };
  }
  requirePlainObject(input, 'security');
  rejectUnknownKeys(input, 'security', SECURITY_KEYS);
  return {
    identityRef: optionalString(input.identityRef, 'identityRef'),
    policySnapshotRef: optionalString(input.policySnapshotRef, 'policySnapshotRef'),
    effectiveRightsSnapshot: createRightsSnapshot(input.effectiveRightsSnapshot)
  };
}

export function createSessionContext(input, options = {}) {
  if (input == null) {
    return {
      sessionId: createId('session', options.idFactory),
      missionId: null,
      operatorMode: OPERATOR_MODE.NORMAL,
      activityCursor: null
    };
  }
  requirePlainObject(input, 'context');
  rejectUnknownKeys(input, 'context', CONTEXT_KEYS);
  const operatorMode = requireString(input.operatorMode || OPERATOR_MODE.NORMAL, 'operatorMode');
  if (!Object.values(OPERATOR_MODE).includes(operatorMode)) {
    failClosed('UNKNOWN_ENUM', 'operatorMode is unknown.', { operatorMode });
  }
  return {
    sessionId: input.sessionId ? requireString(input.sessionId, 'sessionId') : createId('session', options.idFactory),
    missionId: optionalString(input.missionId, 'missionId'),
    operatorMode,
    activityCursor: optionalString(input.activityCursor, 'activityCursor')
  };
}

export function createWorldState(input = {}, options = {}) {
  requirePlainObject(input, 'WorldState');
  rejectUnknownKeys(input, 'WorldState', WORLD_KEYS);
  if (input.schemaId != null && input.schemaId !== SCHEMA_IDS.WORLD_STATE) {
    failClosed(
      'UNSUPPORTED_SCHEMA',
      'World State V1 rejects unsupported schema identity. Silent normalization is forbidden.',
      {
        schemaId: input.schemaId,
        expectedSchemaId: SCHEMA_IDS.WORLD_STATE
      }
    );
  }
  if (input.schemaVersion != null && input.schemaVersion !== SCHEMA_VERSION) {
    failClosed(
      'UNSUPPORTED_SCHEMA_VERSION',
      'World State V1 rejects unsupported schema version. Silent normalization is forbidden.',
      {
        schemaVersion: input.schemaVersion,
        expectedSchemaVersion: SCHEMA_VERSION
      }
    );
  }
  const createdAt = requireString(input.createdAt || isoNow(options.now), 'createdAt');
  const worlds = createWorldsState(input.worlds, options);
  return {
    schemaId: SCHEMA_IDS.WORLD_STATE,
    schemaVersion: SCHEMA_VERSION,
    stateId: input.stateId ? requireString(input.stateId, 'stateId') : createId('world-state', options.idFactory),
    revision: requireInteger(input.revision ?? 1, 'revision', { min: 1 }),
    createdAt,
    updatedAt: requireString(input.updatedAt || createdAt, 'updatedAt'),
    activeFocus: input.activeFocus == null ? null : validateFocusRef(input.activeFocus),
    selection: input.selection ? validateSelectionSet(input.selection) : createEmptySelectionSet({ ...options, now: createdAt }),
    aoi: input.aoi == null ? null : createGeometryRef(input.aoi, options),
    workspace: createWorkspaceState(input.workspace || {}, options),
    views: createViewsState(input.views),
    cameras: createCamerasState(input.cameras),
    layers: createLayersState(input.layers),
    temporal: input.temporal ? validateTemporalContext(input.temporal) : createDefaultTemporalContext(),
    sources: createSourcesState(input.sources),
    results: createResultsState(input.results),
    worlds,
    assumptions: requireArray(input.assumptions ?? [], 'assumptions').map((item) => createAssumptionRef(item)),
    security: createSecuritySnapshot(input.security),
    context: createSessionContext(input.context, options)
  };
}

export function validateWorldState(value) {
  return createWorldState(value);
}

export const PATCHABLE_WORLD_FIELDS = Object.freeze([
  'activeFocus',
  'selection',
  'aoi',
  'workspace',
  'views',
  'cameras',
  'layers',
  'temporal',
  'sources',
  'results',
  'worlds',
  'assumptions',
  'security',
  'context'
]);

export function applyWorldStateFields(world, fields, options = {}) {
  requirePlainObject(world, 'WorldState');
  requirePlainObject(fields, 'patch fields');
  const next = { ...world };
  for (const key of Object.keys(fields)) {
    if (!PATCHABLE_WORLD_FIELDS.includes(key)) {
      failClosed('UNKNOWN_WORLD_STATE_FIELD', `Cannot patch '${key}'.`, { key });
    }
    if (key === 'activeFocus') next.activeFocus = fields.activeFocus == null ? null : validateFocusRef(fields.activeFocus);
    else if (key === 'selection') next.selection = validateSelectionSet(fields.selection);
    else if (key === 'aoi') next.aoi = fields.aoi == null ? null : createGeometryRef(fields.aoi, options);
    else if (key === 'workspace') next.workspace = createWorkspaceState(fields.workspace, options);
    else if (key === 'views') next.views = createViewsState(fields.views);
    else if (key === 'cameras') next.cameras = createCamerasState(fields.cameras);
    else if (key === 'layers') next.layers = createLayersState(fields.layers);
    else if (key === 'temporal') next.temporal = validateTemporalContext(fields.temporal);
    else if (key === 'sources') next.sources = createSourcesState(fields.sources);
    else if (key === 'results') next.results = createResultsState(fields.results);
    else if (key === 'worlds') next.worlds = createWorldsState(fields.worlds, options);
    else if (key === 'assumptions') next.assumptions = requireArray(fields.assumptions, 'assumptions').map((item) => createAssumptionRef(item));
    else if (key === 'security') next.security = createSecuritySnapshot(fields.security);
    else if (key === 'context') next.context = createSessionContext(fields.context, options);
  }
  return createWorldState(next, options);
}
