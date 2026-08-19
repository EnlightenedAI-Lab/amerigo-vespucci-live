/**
 * InspectorHost projects ObjectRefs, evidence, provenance, and receipts from stores.
 * Popups are not identity. OBJECTID is never the application selection.
 */

import { renderContextInspector, setInspectorRegion, bindContextInspector, paintInspectorPane } from '../shell/ContextInspector.js';
import { objectRefKey } from '../foundation/contracts/index.js';

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
    body: projection.selection,
    html: projection.selectionHtml || null
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
  const refs = world.selection?.objectRefs || [];
  const primaryId = world.selection?.primaryObjectRefId || null;
  const primary = refs.find((ref) => objectRefKey(ref) === primaryId) || null;
  return {
    situationState: extras.activeSystem ? 'CHASSIS' : 'RESERVED',
    situation: [
      `Workspace: ${world.workspace.kind}`,
      `Active system: ${extras.activeSystem || 'none'}`,
      `Active view: ${(world.views.activeViewIds || []).join(', ')}`,
      `Revision: ${world.revision}`,
      extras.situationNote || 'DROP PIN is WHERE. Acquired ObjectRef is WHAT.'
    ].join('\n'),
    selectionState: primary ? 'ACQUIRED' : 'RESERVED',
    selection: extras.acquiredInspect?.body && primary
      ? extras.acquiredInspect.body
      : (primary
        ? [
            'OBJECT ACQUIRED',
            `KIND: ${String(primary.kind || '').toUpperCase()}`,
            `LABEL: ${primary.label || primary.id}`,
            `NAMESPACE: ${primary.namespace}`,
            `ID: ${primary.id}`,
            `DATASET: ${primary.datasetRef}`,
            `DATASET VERSION: ${primary.datasetVersion}`,
            `SOURCE: ${primary.sourceRef}`,
            'Primary ObjectRef is not an ArcGIS OBJECTID.'
          ].join('\n')
        : 'No ObjectRef acquired. Hover/candidate is not acquisition. DROP PIN remains WHERE.'),
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
