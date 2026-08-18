/**
 * Chassis catalog: register frozen views/layers/capabilities as honest
 * CHASSIS / UNMIGRATED / UNAVAILABLE records. Proven engines are not mounted.
 */

import {
  EFFECT_CLASS,
  EXECUTION_MODE,
  JOB_TARGET,
  LAYER_FAMILY,
  MIGRATION_STATE,
  POLICY_ACTION,
  UNDO_POLICY,
  VIEW_AVAILABILITY,
  VIEW_ID,
  VIEW_LIFECYCLE,
  failClosed
} from '../foundation/contracts/index.js';

export const CHASSIS_SYSTEMS = Object.freeze([
  Object.freeze({
    id: 'workspace',
    label: 'WORKSPACE',
    group: 'SESSION',
    migrationState: MIGRATION_STATE.CHASSIS,
    detail: 'Operator session workspace is chassis-backed. Custom arrangements are later.'
  }),
  Object.freeze({
    id: 'view',
    label: 'VIEW',
    group: 'SPATIAL',
    migrationState: MIGRATION_STATE.CHASSIS,
    detail: 'ViewHost owns lifecycle. Specialist adapters are unmigrated.'
  }),
  Object.freeze({
    id: 'focus',
    label: 'FOCUS / SELECT',
    group: 'SPATIAL',
    migrationState: MIGRATION_STATE.UNMIGRATED,
    detail: 'FocusRef/ObjectRef chassis exists. DROP PIN remains at the proven baseline.'
  }),
  Object.freeze({
    id: 'layers',
    label: 'LAYERS',
    group: 'SPATIAL',
    migrationState: MIGRATION_STATE.UNMIGRATED,
    detail: 'LayerRegistry is live. Authored/runtime layers are not migrated.'
  }),
  Object.freeze({
    id: 'time',
    label: 'TIME',
    group: 'SPATIAL',
    migrationState: MIGRATION_STATE.UNMIGRATED,
    detail: 'TemporalContext chassis exists. Time Engine remains at the proven baseline.'
  }),
  Object.freeze({
    id: 'analyze',
    label: 'ANALYZE',
    group: 'WORK',
    migrationState: MIGRATION_STATE.UNAVAILABLE,
    detail: 'Deterministic analysis engines are not connected.'
  }),
  Object.freeze({
    id: 'ask',
    label: 'AI / ASK IQAI',
    group: 'WORK',
    migrationState: MIGRATION_STATE.CHASSIS,
    detail: 'Ask is a shell front door. Brain Phase 0 is not implemented. Local model is NOT CONNECTED.'
  }),
  Object.freeze({
    id: 'simulate',
    label: 'SIMULATE',
    group: 'WORK',
    migrationState: MIGRATION_STATE.UNAVAILABLE,
    detail: 'Scenario Manager may exist later. No engine is connected. No fabricated world.'
  }),
  Object.freeze({
    id: 'inspector',
    label: 'INSPECTOR',
    group: 'EVIDENCE',
    migrationState: MIGRATION_STATE.CHASSIS,
    detail: 'InspectorHost projects World State. Popups are not the inspector.'
  }),
  Object.freeze({
    id: 'capture',
    label: 'CAPTURE / SHARE',
    group: 'EVIDENCE',
    migrationState: MIGRATION_STATE.UNAVAILABLE,
    detail: 'Export, share, and Portal publish are unavailable. No Portal writes.'
  })
]);

export function registerChassisCatalog({
  viewRegistry,
  layerRegistry,
  capabilityRegistry,
  modelProviderRegistry,
  chassisRegistrar
}) {
  if (!chassisRegistrar || typeof chassisRegistrar.register !== 'function') {
    failClosed('CHASSIS_REGISTRAR_REQUIRED', 'Chassis catalog requires the trusted chassis registrar.');
  }
  viewRegistry.register({
    viewId: VIEW_ID.MAP,
    title: 'MAP',
    lifecycle: VIEW_LIFECYCLE.MOUNT_ONCE,
    availability: VIEW_AVAILABILITY.UNMIGRATED,
    requiresFocus: false,
    retainsCamera: true,
    retainsSelection: true,
    consumesTime: true,
    adapterId: null,
    unavailableReason: 'Persistent MapView remains at the proven baseline and is not mounted in this wave.',
    migrationState: MIGRATION_STATE.UNMIGRATED
  });
  viewRegistry.register({
    viewId: VIEW_ID.STREET_360,
    title: 'STREET 360',
    lifecycle: VIEW_LIFECYCLE.DEFERRED,
    availability: VIEW_AVAILABILITY.UNMIGRATED,
    requiresFocus: true,
    adapterId: null,
    unavailableReason: 'Street 360 remains at the proven baseline and is not mounted in this wave.',
    migrationState: MIGRATION_STATE.UNMIGRATED
  });
  viewRegistry.register({
    viewId: VIEW_ID.VISUAL_3D,
    title: '3D VISUAL',
    lifecycle: VIEW_LIFECYCLE.DEFERRED,
    availability: VIEW_AVAILABILITY.UNMIGRATED,
    requiresFocus: true,
    adapterId: null,
    unavailableReason: 'Google Photorealistic 3D remains at the proven baseline and is not mounted in this wave.',
    migrationState: MIGRATION_STATE.UNMIGRATED
  });
  viewRegistry.register({
    viewId: VIEW_ID.ANALYZE_3D,
    title: '3D ANALYZE',
    lifecycle: VIEW_LIFECYCLE.REGISTERED,
    availability: VIEW_AVAILABILITY.UNAVAILABLE,
    adapterId: null,
    unavailableReason: '3D ANALYZE has no specialist engine in this wave.',
    migrationState: MIGRATION_STATE.UNAVAILABLE
  });

  layerRegistry.register({
    layerId: 'chassis-session-workspace',
    title: 'Session workspace',
    family: LAYER_FAMILY.SESSION_INVESTIGATION,
    availability: MIGRATION_STATE.CHASSIS,
    migrationState: MIGRATION_STATE.CHASSIS,
    defaultVisibility: true,
    selectable: false,
    analyzable: false,
    compatibleViews: [VIEW_ID.MAP],
    source: { catalogOrigin: 'SESSION' },
    rights: { display: 'ALLOW', analysis: 'DENY', aiUse: 'DENY', export: 'DENY', share: 'DENY', cache: 'DENY' }
  });
  layerRegistry.register({
    layerId: 'authored-operational-map',
    title: 'Authored operational map',
    family: LAYER_FAMILY.OPERATIONAL,
    availability: MIGRATION_STATE.UNMIGRATED,
    migrationState: MIGRATION_STATE.UNMIGRATED,
    source: { catalogOrigin: 'AUTHORED_WEBMAP', providerId: 'arcgis-webmap' },
    compatibleViews: [VIEW_ID.MAP],
    selectable: true,
    analyzable: false,
    rights: { display: 'ALLOW', analysis: 'DENY', aiUse: 'DENY', export: 'DENY', share: 'DENY', cache: 'DENY' }
  });

  const chassisCaps = [
    {
      id: 'chassis.inspect-world',
      owner: 'tool-builder',
      title: 'Inspect World State',
      resultType: 'world-diagnostic',
      requiredPolicyAction: POLICY_ACTION.DISPLAY,
      effectClass: EFFECT_CLASS.READ_ONLY,
      execution: { mode: EXECUTION_MODE.SYNC, targets: [] },
      migrationState: MIGRATION_STATE.CHASSIS,
      adapterId: 'chassis.inspect-world'
    },
    {
      id: 'chassis.set-active-system',
      owner: 'tool-builder',
      title: 'Select chassis system',
      resultType: 'workspace-selection',
      requiredPolicyAction: POLICY_ACTION.DISPLAY,
      effectClass: EFFECT_CLASS.SESSION_MUTATION,
      undoPolicy: UNDO_POLICY.UNDOABLE,
      execution: { mode: EXECUTION_MODE.SYNC, targets: [] },
      migrationState: MIGRATION_STATE.CHASSIS,
      adapterId: 'chassis.set-active-system',
      compatibleViews: []
    },
    {
      id: 'view.select',
      owner: 'tool-builder',
      title: 'Select registered view',
      resultType: 'view-selection',
      requiredPolicyAction: POLICY_ACTION.DISPLAY,
      effectClass: EFFECT_CLASS.SESSION_MUTATION,
      undoPolicy: UNDO_POLICY.UNDOABLE,
      execution: { mode: EXECUTION_MODE.SYNC, targets: [] },
      migrationState: MIGRATION_STATE.CHASSIS,
      adapterId: 'view.select'
    },
    {
      id: 'map',
      owner: 'arcgis',
      title: 'Operational map',
      resultType: 'map-view',
      requiredPolicyAction: POLICY_ACTION.DISPLAY,
      effectClass: EFFECT_CLASS.SESSION_MUTATION,
      execution: { mode: EXECUTION_MODE.SYNC, targets: [] },
      migrationState: MIGRATION_STATE.UNMIGRATED,
      unavailableReason: 'Persistent MapView remains at the proven baseline and is not migrated.'
    },
    {
      id: 'imagery',
      owner: 'arcgis',
      title: 'Imagery',
      resultType: 'imagery-observation',
      requiredPolicyAction: POLICY_ACTION.DISPLAY,
      effectClass: EFFECT_CLASS.SESSION_MUTATION,
      execution: { mode: EXECUTION_MODE.SYNC, targets: [] },
      migrationState: MIGRATION_STATE.UNMIGRATED,
      unavailableReason: 'Imagery Ground and Time Engine remain at the proven baseline and are not migrated.'
    },
    {
      id: 'analysis',
      owner: 'arcgis',
      title: 'Analyze',
      resultType: 'analysis-result',
      requiredPolicyAction: POLICY_ACTION.ANALYSIS,
      effectClass: EFFECT_CLASS.SESSION_MUTATION,
      execution: { mode: EXECUTION_MODE.JOB, targets: [JOB_TARGET.RASTER_EO] },
      migrationState: MIGRATION_STATE.UNAVAILABLE,
      unavailableReason: 'Analysis engines are not connected.'
    },
    {
      id: 'simulate',
      owner: 'simulation',
      title: 'Simulate',
      resultType: 'scenario',
      requiredPolicyAction: POLICY_ACTION.ANALYSIS,
      effectClass: EFFECT_CLASS.SESSION_MUTATION,
      execution: { mode: EXECUTION_MODE.JOB, targets: [JOB_TARGET.SIMULATION] },
      migrationState: MIGRATION_STATE.UNAVAILABLE,
      unavailableReason: 'No simulation engine is connected. Missing engines stay UNAVAILABLE.'
    },
    {
      id: 'capture.share',
      owner: 'tool-builder',
      title: 'Capture / Share',
      resultType: 'quick-map',
      requiredPolicyAction: POLICY_ACTION.PORTAL_PUBLISH,
      effectClass: EFFECT_CLASS.EXTERNAL_WRITE,
      execution: { mode: EXECUTION_MODE.SYNC, targets: [] },
      migrationState: MIGRATION_STATE.UNAVAILABLE,
      unavailableReason: 'Capture, share, and Portal publish are unavailable. No Portal writes.'
    }
  ];
  for (const cap of chassisCaps) {
    if (cap.migrationState === MIGRATION_STATE.CHASSIS) {
      chassisRegistrar.register(cap);
    } else {
      capabilityRegistry.register(cap);
    }
  }

  modelProviderRegistry.register({
    providerId: 'local-reasoning',
    kind: 'LOCAL_REASONING',
    locality: 'LOCAL',
    capabilities: ['reason'],
    acceptedDataClasses: ['session-non-secret'],
    primaryForBrain: true
  });
  modelProviderRegistry.register({
    providerId: 'cloud-reasoning',
    kind: 'CLOUD_REASONING',
    locality: 'CLOUD',
    capabilities: ['reason'],
    acceptedDataClasses: [],
    primaryForBrain: false
  });
}
