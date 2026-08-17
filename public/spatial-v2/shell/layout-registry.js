/**
 * IQAI Spatial V2 — shell targeting contracts.
 * Stable identifiers only. Not a runtime capability registry.
 */

export const IQAI_SPATIAL_V2_SHELL_VERSION = 'shell-v1';

export const SHELL_SLOTS = Object.freeze({
  commandHeader: Object.freeze({ id: 'iqai-v2-command-header', slot: 'command-header' }),
  capabilityRail: Object.freeze({ id: 'iqai-v2-capability-rail', slot: 'capability-rail' }),
  mapStage: Object.freeze({ id: 'iqai-v2-map-stage', slot: 'map-stage' }),
  contextInspector: Object.freeze({ id: 'iqai-v2-context-inspector', slot: 'context-inspector' }),
  situationSlot: Object.freeze({ id: 'iqai-v2-situation-slot', slot: 'situation-slot' }),
  selectedObjectSlot: Object.freeze({ id: 'iqai-v2-selected-object-slot', slot: 'selected-object-slot' }),
  evidenceSlot: Object.freeze({ id: 'iqai-v2-evidence-slot', slot: 'evidence-slot' }),
  provenanceSlot: Object.freeze({ id: 'iqai-v2-provenance-slot', slot: 'provenance-slot' }),
  executionReceiptSlot: Object.freeze({
    id: 'iqai-v2-execution-receipt-slot',
    slot: 'execution-receipt-slot'
  }),
  askIqaiDock: Object.freeze({ id: 'iqai-v2-ask-iqai-dock', slot: 'ask-iqai-dock' }),
  buildSlot: Object.freeze({ id: 'iqai-v2-build-slot', slot: 'build-slot' })
});

export const SHELL_SLOT_IDS = Object.freeze(
  Object.values(SHELL_SLOTS).map((entry) => entry.slot)
);

export const HEADER_STATUS_SLOTS = Object.freeze([
  Object.freeze({
    id: 'situation',
    label: 'SITUATION',
    value: 'RESERVED',
    state: 'reserved',
    emphasis: 'major'
  }),
  Object.freeze({
    id: 'time',
    label: 'TIME',
    value: '—',
    state: 'live-clock',
    emphasis: 'major'
  }),
  Object.freeze({
    id: 'agol-portal',
    label: 'AGOL / PORTAL',
    shortLabel: 'AGOL / PORTAL',
    value: 'NOT CONNECTED',
    state: 'disconnected'
  }),
  Object.freeze({
    id: 'local-ai',
    label: 'LOCAL AI',
    shortLabel: 'LOCAL AI',
    value: 'NOT CONNECTED',
    state: 'disconnected'
  }),
  Object.freeze({
    id: 'cloud-ai',
    label: 'CLOUD AI',
    shortLabel: 'CLOUD AI',
    value: 'NOT CONNECTED',
    state: 'disconnected'
  }),
  Object.freeze({
    id: 'open-world-intelligence',
    label: 'OPEN-WORLD INTELLIGENCE',
    shortLabel: 'OPEN-WORLD',
    value: 'NOT CONNECTED',
    state: 'disconnected'
  }),
  Object.freeze({
    id: 'point-intelligence',
    label: 'POINT INTELLIGENCE',
    shortLabel: 'POINT INTEL',
    value: 'NOT CONNECTED',
    state: 'disconnected'
  }),
  Object.freeze({
    id: 'system-health',
    label: 'SYSTEM',
    value: 'SHELL ONLY',
    state: 'reserved'
  })
]);

export const PRIMARY_CAPABILITY_SLOTS = Object.freeze([
  Object.freeze({
    id: 'map',
    shortLabel: 'MAP',
    displayLabel: 'MAP',
    stateLabel: 'RESERVED',
    description: 'Operational map surface'
  }),
  Object.freeze({
    id: 'point',
    shortLabel: 'POINT',
    displayLabel: 'POINT INTELLIGENCE',
    stateLabel: 'CAPABILITY SLOT',
    description: 'Point-level intelligence'
  }),
  Object.freeze({
    id: 'intelligence',
    shortLabel: 'INTELLIGENCE',
    displayLabel: 'OPEN-WORLD INTELLIGENCE',
    stateLabel: 'CAPABILITY SLOT',
    description: 'Open-world operational intelligence'
  }),
  Object.freeze({
    id: 'vision',
    shortLabel: 'VISION',
    displayLabel: 'VISION',
    stateLabel: 'CAPABILITY SLOT',
    description: 'Computer vision'
  }),
  Object.freeze({
    id: 'build',
    shortLabel: 'BUILD',
    displayLabel: 'BUILD',
    stateLabel: 'CAPABILITY SLOT',
    description: 'Create maps, instruments and temporary apps',
    slot: 'build-slot',
    elementId: 'iqai-v2-build-slot'
  })
]);

export const PLUGIN_SLOTS = Object.freeze([
  Object.freeze({
    id: 'data-layers',
    shortLabel: 'DATA & LAYERS',
    displayLabel: 'DATA & LAYERS',
    stateLabel: 'CAPABILITY SLOT'
  }),
  Object.freeze({
    id: 'imagery',
    shortLabel: 'IMAGERY',
    displayLabel: 'IMAGERY',
    stateLabel: 'CAPABILITY SLOT'
  }),
  Object.freeze({
    id: 'documents',
    shortLabel: 'DOCUMENTS',
    displayLabel: 'DOCUMENTS',
    stateLabel: 'CAPABILITY SLOT'
  })
]);

export const ASK_QUICK_ACTIONS = Object.freeze([
  Object.freeze({ id: 'map', label: 'MAP' }),
  Object.freeze({ id: 'analyze', label: 'ANALYZE' }),
  Object.freeze({ id: 'intelligence', label: 'INTELLIGENCE' }),
  Object.freeze({ id: 'vision', label: 'VISION' }),
  Object.freeze({ id: 'build', label: 'BUILD' })
]);

export const INSPECTOR_REGIONS = Object.freeze([
  Object.freeze({
    slot: 'situation-slot',
    id: 'iqai-v2-situation-slot',
    title: 'CURRENT SITUATION',
    stateLabel: 'RESERVED',
    body: 'No situation is loaded. This region is the governed current-situation surface.'
  }),
  Object.freeze({
    slot: 'selected-object-slot',
    id: 'iqai-v2-selected-object-slot',
    title: 'SELECTED OBJECT',
    stateLabel: 'RESERVED',
    body: 'No object selected.'
  }),
  Object.freeze({
    slot: 'evidence-slot',
    id: 'iqai-v2-evidence-slot',
    title: 'EVIDENCE',
    stateLabel: 'RESERVED',
    body: 'No evidence.'
  }),
  Object.freeze({
    slot: 'provenance-slot',
    id: 'iqai-v2-provenance-slot',
    title: 'PROVENANCE',
    stateLabel: 'RESERVED',
    body: 'No provenance.'
  }),
  Object.freeze({
    slot: 'execution-receipt-slot',
    id: 'iqai-v2-execution-receipt-slot',
    title: 'EXECUTION / RECEIPTS',
    stateLabel: 'RESERVED',
    body: 'No receipts.'
  })
]);

export const MAP_STAGE_RESERVES = Object.freeze([
  Object.freeze({ id: 'map', label: 'MAP' }),
  Object.freeze({ id: 'overlays', label: 'OVERLAYS' }),
  Object.freeze({ id: 'analysis', label: 'GENERATED ANALYSIS' }),
  Object.freeze({ id: 'selection', label: 'SELECTION' }),
  Object.freeze({ id: 'instruments', label: 'TEMPORARY INSTRUMENTS' })
]);
