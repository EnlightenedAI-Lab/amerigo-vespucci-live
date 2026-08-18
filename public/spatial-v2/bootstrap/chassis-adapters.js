/**
 * Chassis-only adapters. These mutate World State through ResultCommitter.
 * They do not import map, imagery, Street 360, or 3D engines.
 */

import {
  EFFECT_CLASS,
  TRUTH_CLASS,
  VIEW_ID,
  createId,
  failClosed
} from '../foundation/contracts/index.js';

function resultOf({ idFactory, resultType, statePatch, truthClass }) {
  return {
    result: {
      resultId: createId('result', idFactory),
      resultType,
      truthClass: truthClass || TRUTH_CLASS.CALCULATED,
      statePatch: statePatch || null,
      receiptRef: null
    }
  };
}

export function bindChassisAdapters({ chassisRegistrar, capabilityRegistry, stateStore, idFactory }) {
  if (!chassisRegistrar || typeof chassisRegistrar.bindAdapter !== 'function') {
    failClosed('CHASSIS_REGISTRAR_REQUIRED', 'Chassis adapters require the trusted chassis registrar.');
  }
  chassisRegistrar.bindAdapter('chassis.inspect-world', '1.0.0', {
    execute(_action, { world }) {
      return resultOf({
        idFactory,
        resultType: 'world-diagnostic',
        truthClass: TRUTH_CLASS.CALCULATED,
        statePatch: null
      });
    }
  });

  chassisRegistrar.bindAdapter('chassis.set-active-system', '1.0.0', {
    execute(action, { world }) {
      const systemId = String(action.input?.systemId || '').trim();
      if (!systemId) {
        return resultOf({ idFactory, resultType: 'workspace-selection' });
      }
      return resultOf({
        idFactory,
        resultType: 'workspace-selection',
        statePatch: {
          patchId: createId('patch', idFactory),
          baseRevision: action.baseWorldRevision,
          actorRef: action.actorRef,
          source: action.source,
          capabilityId: action.capabilityId,
          actionId: action.actionId,
          effectClass: EFFECT_CLASS.SESSION_MUTATION,
          fields: {
            workspace: {
              workspaceId: world.workspace.workspaceId,
              kind: world.workspace.kind,
              activeToolIds: [systemId]
            }
          }
        }
      });
    }
  });

  chassisRegistrar.bindAdapter('view.select', '1.0.0', {
    execute(action, { world }) {
      const viewId = String(action.input?.viewId || VIEW_ID.MAP).trim();
      const known = world.views.byId[viewId];
      if (!known) {
        return resultOf({ idFactory, resultType: 'view-selection' });
      }
      return resultOf({
        idFactory,
        resultType: 'view-selection',
        statePatch: {
          patchId: createId('patch', idFactory),
          baseRevision: action.baseWorldRevision,
          actorRef: action.actorRef,
          source: action.source,
          capabilityId: action.capabilityId,
          actionId: action.actionId,
          effectClass: EFFECT_CLASS.SESSION_MUTATION,
          fields: {
            views: {
              primaryViewId: world.views.primaryViewId,
              activeViewIds: [viewId],
              byId: world.views.byId
            }
          }
        }
      });
    }
  });

  return { stateStore };
}
