/**
 * CapabilityRuntime.execute(ActionEnvelope) is the only execution path.
 * Shell hosts, BrainHost, and operator controls must not call adapters directly.
 */

import { EXECUTION_MODE, MIGRATION_STATE, isCapabilityExecutable } from '../foundation/contracts/capability.js';
import { createActionEnvelope } from '../foundation/contracts/action.js';
import { EFFECT_CLASS } from '../foundation/contracts/activity-event.js';
import { SCHEMA_IDS } from '../foundation/contracts/schema-ids.js';
import { createResult } from '../foundation/contracts/result.js';
import { TRUTH_CLASS } from '../foundation/contracts/truth-envelope.js';
import { POLICY_OUTCOME } from '../foundation/contracts/policy.js';
import {
  createId,
  failClosed,
  frozenClone
} from '../foundation/contracts/validate.js';
import { createSchemaGuard } from './schema-guard.js';

function viewCompatible(descriptor, world) {
  if (!descriptor.compatibleViews.length) return true;
  const active = world.views?.activeViewIds || [];
  return active.some((viewId) => descriptor.compatibleViews.includes(viewId));
}

function mayCauseSideEffect(effectClass) {
  return effectClass !== EFFECT_CLASS.READ_ONLY;
}

function typedFailure(code, message, extra = {}) {
  failClosed(code, message, {
    ...extra,
    receipt: Object.freeze({
      kind: 'CAPABILITY_FAILURE',
      code,
      executed: false,
      committed: false,
      capabilityId: extra.capabilityId || null,
      actionId: extra.actionId || null
    })
  });
}

export function createCapabilityRuntime({
  capabilityRegistry,
  getExecutableAdapter,
  policyGuard,
  resultCommitter,
  jobManager,
  stateStore,
  now,
  idFactory,
  preconditions = {},
  schemaGuard
}) {
  const schemas = schemaGuard || createSchemaGuard();
  const resolveAdapter = typeof getExecutableAdapter === 'function'
    ? getExecutableAdapter
    : (typeof capabilityRegistry.takeRuntimeAdapterLookup === 'function'
      ? capabilityRegistry.takeRuntimeAdapterLookup()
      : (id, version) => capabilityRegistry.getAdapter(id, version));

  return Object.freeze({
    async execute(rawAction) {
      const action = createActionEnvelope(rawAction, { now });
      const world = stateStore.getSnapshot();
      if (action.worldId !== world.worlds.activeWorldId) {
        failClosed('WORLD_MISMATCH', 'Action worldId does not match active world.', {
          worldId: action.worldId,
          activeWorldId: world.worlds.activeWorldId
        });
      }
      const descriptor = capabilityRegistry.require(action.capabilityId);
      if (descriptor.migrationState === MIGRATION_STATE.UNAVAILABLE) {
        failClosed('CAPABILITY_UNAVAILABLE', descriptor.unavailableReason || 'Capability is unavailable.', {
          capabilityId: descriptor.id
        });
      }
      if (descriptor.migrationState === MIGRATION_STATE.UNMIGRATED) {
        failClosed('CAPABILITY_UNMIGRATED', descriptor.unavailableReason || 'Capability is registered but not migrated.', {
          capabilityId: descriptor.id
        });
      }
      if (descriptor.migrationState === MIGRATION_STATE.NOT_CONNECTED) {
        failClosed('CAPABILITY_NOT_CONNECTED', descriptor.unavailableReason || 'Capability is not connected.', {
          capabilityId: descriptor.id
        });
      }
      if (!isCapabilityExecutable(descriptor.migrationState)) {
        failClosed('CAPABILITY_NOT_EXECUTABLE', 'Capability is not in an executable migration state.', {
          capabilityId: descriptor.id,
          migrationState: descriptor.migrationState
        });
      }
      if (
        descriptor.migrationState === MIGRATION_STATE.CHASSIS
        && (typeof capabilityRegistry.isChassisTrusted !== 'function'
          || !capabilityRegistry.isChassisTrusted(descriptor.id, descriptor.version))
      ) {
        failClosed(
          'UNTRUSTED_CHASSIS_REGISTRATION',
          'CHASSIS execution requires authoritative trusted registration.',
          { capabilityId: descriptor.id }
        );
      }
      try {
        schemas.validate(descriptor.inputSchema, action.input, 'input');
      } catch (error) {
        typedFailure('INVALID_INPUT', 'Capability input failed the declared input schema.', {
          capabilityId: descriptor.id,
          actionId: action.actionId,
          cause: error.code || null
        });
      }
      for (const preconditionId of descriptor.preconditionIds) {
        const check = preconditions[preconditionId];
        if (typeof check !== 'function') {
          failClosed('UNKNOWN_PRECONDITION', 'Capability precondition is unknown.', { preconditionId });
        }
        if (!check(world, action)) {
          failClosed('PRECONDITION_FAILED', 'Capability precondition failed.', { preconditionId });
        }
      }
      if (!viewCompatible(descriptor, world)) {
        failClosed('INCOMPATIBLE_VIEW', 'Capability is not compatible with the active view.', {
          capabilityId: descriptor.id,
          activeViewIds: world.views.activeViewIds
        });
      }
      const decision = policyGuard.authorize({
        actorContext: {
          actorRef: action.actorRef,
          identityRef: action.actorRef,
          source: action.source
        },
        capabilityId: descriptor.id,
        policyAction: descriptor.requiredPolicyAction,
        resourceRefs: [],
        requestedRights: descriptor.requiredRights,
        effectClass: descriptor.effectClass,
        dataClassifications: [],
        worldId: action.worldId,
        sessionId: world.context.sessionId,
        actionId: action.actionId,
        worldRevision: action.baseWorldRevision
      });
      if (decision.outcome !== POLICY_OUTCOME.ALLOW) {
        return Object.freeze({
          ok: false,
          code: 'POLICY_DENIED',
          decision: frozenClone(decision),
          executed: false
        });
      }

      if (mayCauseSideEffect(descriptor.effectClass) && action.baseWorldRevision !== world.revision) {
        failClosed('STALE_REVISION', 'Stale ActionEnvelope was rejected before adapter execution.', {
          capabilityId: descriptor.id,
          actionRevision: action.baseWorldRevision,
          worldRevision: world.revision
        });
      }

      if (descriptor.execution.mode === EXECUTION_MODE.JOB) {
        const job = jobManager.enqueue({
          capabilityId: descriptor.id,
          actorRef: action.actorRef,
          worldId: action.worldId,
          baseWorldRevision: action.baseWorldRevision,
          target: descriptor.execution.targets[0] || 'LOCAL_CPU',
          inputRef: action.actionId
        });
        return Object.freeze({
          ok: true,
          executed: false,
          job: frozenClone(job),
          decision: frozenClone(decision)
        });
      }

      const adapter = resolveAdapter(descriptor.id, descriptor.version);
      if (!adapter) {
        failClosed('UNKNOWN_ADAPTER', 'Capability has no bound adapter.', { capabilityId: descriptor.id });
      }
      const adapterOutput = await adapter.execute(action, { world, decision });
      const rawResult = adapterOutput.result || {
        resultId: createId('result', idFactory),
        resultType: descriptor.resultType,
        truthClass: adapterOutput.truthClass || TRUTH_CLASS.CALCULATED,
        statePatch: adapterOutput.statePatch || null,
        receiptRef: action.actionId
      };
      if (rawResult.schemaId && rawResult.schemaId !== descriptor.outputSchema) {
        typedFailure('INVALID_OUTPUT', 'Adapter output schema does not match the declared output schema.', {
          capabilityId: descriptor.id,
          actionId: action.actionId,
          declared: descriptor.outputSchema,
          actual: rawResult.schemaId
        });
      }
      let result;
      try {
        if (descriptor.outputSchema !== SCHEMA_IDS.RESULT) {
          schemas.validate(descriptor.outputSchema, rawResult, 'output');
        }
        result = createResult(rawResult);
      } catch (error) {
        typedFailure('INVALID_OUTPUT', 'Adapter output failed the declared output schema.', {
          capabilityId: descriptor.id,
          actionId: action.actionId,
          cause: error.code || null
        });
      }
      if (result.resultType !== descriptor.resultType) {
        typedFailure('RESULT_TYPE_MISMATCH', 'Adapter result type does not match the capability contract.', {
          capabilityId: descriptor.id,
          actionId: action.actionId,
          declared: descriptor.resultType,
          actual: result.resultType
        });
      }
      const committed = resultCommitter.commit({
        action,
        result,
        policyDecision: decision,
        effectClass: descriptor.effectClass,
        actorRef: action.actorRef,
        capabilityId: descriptor.id,
        sessionId: world.context.sessionId,
        resourceRefs: [],
        policyAction: descriptor.requiredPolicyAction,
        identityRef: action.actorRef
      });
      return Object.freeze({
        ok: committed.ok,
        executed: true,
        result: committed.result,
        snapshot: committed.snapshot,
        decision: frozenClone(decision),
        activityEvent: committed.activityEvent || null,
        receipt: committed.receipt || null
      });
    }
  });
}
