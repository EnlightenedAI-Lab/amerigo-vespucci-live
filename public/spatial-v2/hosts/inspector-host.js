/**
 * InspectorHost projects ObjectRefs, evidence, provenance, and receipts from stores.
 * Popups are not identity. OBJECTID is never the application selection.
 */

import { renderContextInspector, setInspectorRegion, bindContextInspector, paintInspectorPane } from '../shell/ContextInspector.js';

export function renderInspectorHost() {
  return renderContextInspector();
}

export function paintInspectorHost(root, projection) {
  setInspectorRegion(root, 'situation-slot', {
    stateLabel: projection.situationState,
    body: projection.situation
  });
  setInspectorRegion(root, 'selected-object-slot', {
    stateLabel: projection.selectionState,
    body: projection.selection
  });
  setInspectorRegion(root, 'evidence-slot', {
    stateLabel: projection.evidenceState,
    body: projection.evidence
  });
  setInspectorRegion(root, 'provenance-slot', {
    stateLabel: projection.provenanceState,
    body: projection.provenance
  });
  setInspectorRegion(root, 'execution-receipt-slot', {
    stateLabel: projection.receiptState,
    body: projection.receipt
  });
}

export { bindContextInspector, paintInspectorPane };

export function projectInspector(world, extras = {}) {
  const focus = world.activeFocus;
  const selectionCount = world.selection?.objectRefs?.length || 0;
  return {
    situationState: extras.activeSystem ? 'CHASSIS' : 'RESERVED',
    situation: [
      `Workspace: ${world.workspace.kind}`,
      `Active system: ${extras.activeSystem || 'none'}`,
      `Active view: ${(world.views.activeViewIds || []).join(', ')}`,
      `Revision: ${world.revision}`,
      'This is the Spatial V2 platform chassis. Specialist engines are unmigrated.'
    ].join('\n'),
    selectionState: selectionCount ? 'SELECTED' : 'RESERVED',
    selection: selectionCount
      ? `${selectionCount} ObjectRef(s). Primary is not an ArcGIS OBJECTID.`
      : 'No ObjectRef selected. DROP PIN / Active Spatial Focus is unmigrated.',
    evidenceState: 'RESERVED',
    evidence: extras.evidence || 'No evidence envelopes. Proven capabilities are not migrated into this chassis.',
    provenanceState: 'CHASSIS',
    provenance: [
      'PolicyService is authorization authority.',
      'World State security is snapshot-only.',
      `Temporal lens: ${world.temporal.lens}`,
      'Requested time is not observation time.',
      extras.provenance || 'No provider provenance this wave.'
    ].join('\n'),
    receiptState: extras.receiptState || 'RESERVED',
    receipt: extras.receipt || 'No capability receipt. Ask remains fail-closed. No Portal write.'
  };
}
