/**
 * ResultCommitter is the only module allowed to apply capability/job results
 * onto StateStore. JobManager completion is not World State mutation.
 * Only a PolicyService-issued, scoped, unconsumed decision may authorize a commit.
 */

import { EFFECT_CLASS } from '../foundation/contracts/activity-event.js';
import { POLICY_OUTCOME } from '../foundation/contracts/policy.js';
import { createResult } from '../foundation/contracts/result.js';
import { failClosed, frozenClone } from '../foundation/contracts/validate.js';

export function createResultCommitter({ stateStore, policyService }) {
  if (!stateStore || typeof stateStore.applyPatch !== 'function') {
    failClosed('MISSING_STATE_STORE', 'ResultCommitter requires the canonical StateStore.');
  }
  if (!policyService || typeof policyService.consumeIssuedDecision !== 'function') {
    failClosed('MISSING_POLICY_SERVICE', 'ResultCommitter requires PolicyService-issued decisions.');
  }

  return Object.freeze({
    commit({
      action,
      result,
      policyDecision,
      effectClass,
      actorRef,
      capabilityId,
      sessionId,
      resourceRefs,
      policyAction,
      identityRef
    }) {
      const world = stateStore.getSnapshot();
      const decision = policyService.consumeIssuedDecision(policyDecision, {
        actionId: action?.actionId || null,
        actorRef: actorRef || action?.actorRef || null,
        identityRef: identityRef || actorRef || action?.actorRef || null,
        capabilityId: capabilityId || action?.capabilityId || null,
        policyAction: policyAction || policyDecision?.policyAction || null,
        effectClass: effectClass || null,
        resourceRefs: Array.isArray(resourceRefs) ? resourceRefs : (policyDecision?.resourceRefs || []),
        worldId: action?.worldId || null,
        sessionId: sessionId || world.context?.sessionId || null,
        worldRevision: action?.baseWorldRevision ?? null
      });
      if (decision.outcome !== POLICY_OUTCOME.ALLOW) {
        failClosed('POLICY_DENIED', 'ResultCommitter cannot apply a denied decision.', {
          outcome: decision.outcome,
          reasonCodes: decision.reasonCodes
        });
      }
      const typed = createResult(result);
      if (!typed.statePatch) {
        return Object.freeze({
          ok: true,
          mutated: false,
          result: frozenClone(typed),
          snapshot: stateStore.getSnapshot()
        });
      }
      if (effectClass === EFFECT_CLASS.READ_ONLY) {
        failClosed('READ_ONLY_MUTATION', 'READ_ONLY results cannot carry a state patch.');
      }
      if (effectClass === EFFECT_CLASS.EXTERNAL_WRITE && !decision.grantId) {
        failClosed('MISSING_GRANT', 'External writes require a scoped authorization grant.');
      }
      if (action == null || typeof action.baseWorldRevision !== 'number') {
        failClosed('MISSING_ACTION_REVISION', 'ActionEnvelope baseWorldRevision is required for commit.');
      }
      if (
        typed.statePatch.baseRevision != null
        && typed.statePatch.baseRevision !== action.baseWorldRevision
      ) {
        failClosed('ADAPTER_REVISION_OVERRIDE', 'Adapter cannot replace ActionEnvelope revision.', {
          actionRevision: action.baseWorldRevision,
          adapterRevision: typed.statePatch.baseRevision
        });
      }
      if (action.baseWorldRevision !== stateStore.getRevision()) {
        failClosed('STALE_REVISION', 'Stale ActionEnvelope was rejected before StateStore mutation.', {
          actionRevision: action.baseWorldRevision,
          worldRevision: stateStore.getRevision()
        });
      }
      const patch = {
        ...typed.statePatch,
        actorRef: typed.statePatch.actorRef || actorRef || action?.actorRef,
        source: typed.statePatch.source || action?.source,
        capabilityId: typed.statePatch.capabilityId || capabilityId || action?.capabilityId,
        actionId: typed.statePatch.actionId || action?.actionId,
        effectClass: typed.statePatch.effectClass || effectClass,
        baseRevision: action.baseWorldRevision,
        receiptRef: typed.receiptRef,
        traceId: action?.traceId
      };
      const applied = stateStore.applyPatch(patch);
      if (applied.ok !== true) {
        failClosed(applied.code || 'COMMIT_REJECTED', 'StateStore rejected the capability patch.', {
          code: applied.code || null
        });
      }
      return Object.freeze({
        ok: true,
        mutated: true,
        result: frozenClone(typed),
        snapshot: applied.snapshot,
        receipt: applied.receipt || null,
        activityEvent: applied.activityEvent || null
      });
    }
  });
}
