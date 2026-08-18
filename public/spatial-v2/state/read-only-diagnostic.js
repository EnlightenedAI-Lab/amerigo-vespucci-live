/**
 * Read-only World State diagnostic. Safe to expose without leaking handles
 * or secret material.
 */

export function createReadOnlyStateDiagnostic(snapshot) {
  return Object.freeze({
    schemaId: snapshot.schemaId,
    schemaVersion: snapshot.schemaVersion,
    stateId: snapshot.stateId,
    revision: snapshot.revision,
    hasFocus: snapshot.activeFocus != null,
    focusId: snapshot.activeFocus?.focusId ?? null,
    selectionCount: snapshot.selection?.objectRefs?.length ?? 0,
    primaryViewId: snapshot.views?.primaryViewId ?? null,
    activeViewIds: Object.freeze([...(snapshot.views?.activeViewIds || [])]),
    temporalLens: snapshot.temporal?.lens ?? null,
    activeWorldId: snapshot.worlds?.activeWorldId ?? null,
    baselineWorldId: snapshot.worlds?.baselineWorldId ?? null,
    activityCursor: snapshot.context?.activityCursor ?? null,
    operatorMode: snapshot.context?.operatorMode ?? null,
    securitySnapshotOnly: snapshot.security?.effectiveRightsSnapshot?.snapshotOnly === true
  });
}
