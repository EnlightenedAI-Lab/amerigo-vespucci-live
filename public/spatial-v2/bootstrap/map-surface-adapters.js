/**
 * Migrated MAP / focus / layers adapters.
 * They commit World State only. They do not construct MapView or rewrite engines.
 */

import {
  EFFECT_CLASS,
  TRUTH_CLASS,
  VIEW_ID,
  createDropPinFocusRef,
  createId,
  failClosed
} from '../foundation/contracts/index.js';

const AUTHORED_LAYER_ID = 'authored-operational-map';

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

function viewPatch(action, world, viewId, idFactory) {
  const known = world.views.byId[viewId];
  if (!known) return null;
  return {
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
  };
}

export function bindMapSurfaceAdapters({ capabilityRegistry, idFactory }) {
  if (!capabilityRegistry || typeof capabilityRegistry.bindAdapter !== 'function') {
    failClosed('ADAPTER_REGISTRY_REQUIRED', 'Map surface adapters require the public capability registry.');
  }

  capabilityRegistry.bindAdapter('map', '1.0.0', {
    execute(action, { world }) {
      const patch = viewPatch(action, world, VIEW_ID.MAP, idFactory);
      return resultOf({
        idFactory,
        resultType: 'map-view',
        statePatch: patch
      });
    }
  });

  capabilityRegistry.bindAdapter('focus.set', '1.0.0', {
    execute(action) {
      const longitude = Number(action.input?.longitude);
      const latitude = Number(action.input?.latitude);
      if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) {
        failClosed('INVALID_FOCUS_GEOMETRY', 'DROP PIN focus requires finite longitude and latitude.');
      }
      const focus = createDropPinFocusRef({
        longitude,
        latitude,
        address: action.input?.address || null,
        sourceView: VIEW_ID.MAP,
        focusId: action.input?.focusId,
        establishedAt: action.requestedAt
      }, {
        now: () => action.requestedAt,
        idFactory
      });
      return resultOf({
        idFactory,
        resultType: 'spatial-focus',
        statePatch: {
          patchId: createId('patch', idFactory),
          baseRevision: action.baseWorldRevision,
          actorRef: action.actorRef,
          source: action.source,
          capabilityId: action.capabilityId,
          actionId: action.actionId,
          effectClass: EFFECT_CLASS.SESSION_MUTATION,
          fields: { activeFocus: focus }
        }
      });
    }
  });

  capabilityRegistry.bindAdapter('layers.set-visibility', '1.0.0', {
    execute(action, { world }) {
      const instanceId = String(action.input?.instanceId || '').trim();
      const visible = action.input?.visible === true;
      const current = world.layers?.byId?.[instanceId];
      if (!instanceId || !current) {
        return resultOf({ idFactory, resultType: 'layer-visibility' });
      }
      const byId = { ...world.layers.byId, [instanceId]: { ...current, visible } };
      return resultOf({
        idFactory,
        resultType: 'layer-visibility',
        statePatch: {
          patchId: createId('patch', idFactory),
          baseRevision: action.baseWorldRevision,
          actorRef: action.actorRef,
          source: action.source,
          capabilityId: action.capabilityId,
          actionId: action.actionId,
          effectClass: EFFECT_CLASS.SESSION_MUTATION,
          fields: {
            layers: {
              orderedLayerInstanceIds: [...world.layers.orderedLayerInstanceIds],
              byId
            }
          }
        }
      });
    }
  });

  capabilityRegistry.bindAdapter('layers.sync-authored', '1.0.0', {
    execute(action, { world }) {
      const incoming = Array.isArray(action.input?.layers) ? action.input.layers : [];
      const byId = {};
      const orderedLayerInstanceIds = [];
      for (const [instanceId, current] of Object.entries(world.layers?.byId || {})) {
        if (current?.layerId === 'session-agol' || current?.status === 'SESSION') {
          orderedLayerInstanceIds.push(instanceId);
          byId[instanceId] = current;
        }
      }
      incoming.forEach((item, index) => {
        const instanceId = String(item?.instanceId || '').trim();
        if (!instanceId || byId[instanceId]) return;
        orderedLayerInstanceIds.push(instanceId);
        byId[instanceId] = {
          instanceId,
          layerId: String(item.layerId || AUTHORED_LAYER_ID),
          worldId: world.worlds.activeWorldId,
          visible: item.visible !== false,
          opacity: Number.isFinite(Number(item.opacity)) ? Number(item.opacity) : 1,
          order: Number.isFinite(Number(item.order)) ? Number(item.order) : index,
          activeObservationRef: null,
          filterRef: null,
          styleRef: null,
          status: item.status || (String(item.layerId) === 'session-agol' ? 'SESSION' : 'AUTHORED'),
          lastReceiptRef: null
        };
      });
      return resultOf({
        idFactory,
        resultType: 'layer-catalog',
        statePatch: {
          patchId: createId('patch', idFactory),
          baseRevision: action.baseWorldRevision,
          actorRef: action.actorRef,
          source: action.source,
          capabilityId: action.capabilityId,
          actionId: action.actionId,
          effectClass: EFFECT_CLASS.SESSION_MUTATION,
          fields: { layers: { orderedLayerInstanceIds, byId } }
        }
      });
    }
  });

  capabilityRegistry.bindAdapter('layers.set-opacity', '1.0.0', {
    execute(action, { world }) {
      const instanceId = String(action.input?.instanceId || '').trim();
      const opacity = Number(action.input?.opacity);
      const current = world.layers?.byId?.[instanceId];
      if (!instanceId || !current || !Number.isFinite(opacity)) {
        return resultOf({ idFactory, resultType: 'layer-opacity' });
      }
      const byId = { ...world.layers.byId, [instanceId]: { ...current, opacity: Math.min(1, Math.max(0, opacity)) } };
      return resultOf({
        idFactory,
        resultType: 'layer-opacity',
        statePatch: {
          patchId: createId('patch', idFactory),
          baseRevision: action.baseWorldRevision,
          actorRef: action.actorRef,
          source: action.source,
          capabilityId: action.capabilityId,
          actionId: action.actionId,
          effectClass: EFFECT_CLASS.SESSION_MUTATION,
          fields: {
            layers: {
              orderedLayerInstanceIds: [...world.layers.orderedLayerInstanceIds],
              byId
            }
          }
        }
      });
    }
  });

  capabilityRegistry.bindAdapter('layers.add-session', '1.0.0', {
    execute(action, { world }) {
      const instanceId = String(action.input?.instanceId || '').trim();
      if (!instanceId) return resultOf({ idFactory, resultType: 'layer-session' });
      const current = world.layers?.byId || {};
      if (current[instanceId]) return resultOf({ idFactory, resultType: 'layer-session' });
      const next = {
        instanceId,
        layerId: 'session-agol',
        worldId: world.worlds.activeWorldId,
        visible: true,
        opacity: 1,
        order: Object.keys(current).length,
        activeObservationRef: null,
        filterRef: null,
        styleRef: null,
        status: 'SESSION',
        lastReceiptRef: null
      };
      return resultOf({
        idFactory,
        resultType: 'layer-session',
        statePatch: {
          patchId: createId('patch', idFactory),
          baseRevision: action.baseWorldRevision,
          actorRef: action.actorRef,
          source: action.source,
          capabilityId: action.capabilityId,
          actionId: action.actionId,
          effectClass: EFFECT_CLASS.SESSION_MUTATION,
          fields: {
            layers: {
              orderedLayerInstanceIds: [...(world.layers?.orderedLayerInstanceIds || []), instanceId],
              byId: { ...current, [instanceId]: next }
            }
          }
        }
      });
    }
  });

  capabilityRegistry.bindAdapter('temporal.set-requested', '1.0.0', {
    execute(action, { world }) {
      const current = world.temporal;
      const instant = action.input?.instant || null;
      const requested = instant
        ? { instantOrInterval: `${instant}T00:00:00.000Z`, precision: 'DAY' }
        : null;
      return resultOf({
        idFactory,
        resultType: 'temporal-context',
        statePatch: {
          patchId: createId('patch', idFactory),
          baseRevision: action.baseWorldRevision,
          actorRef: action.actorRef,
          source: action.source,
          capabilityId: action.capabilityId,
          actionId: action.actionId,
          effectClass: EFFECT_CLASS.SESSION_MUTATION,
          fields: {
            temporal: {
              ...current,
              requested,
              acquisition: current.acquisition,
              match: current.acquisition ? current.match : 'NONE',
              limitation: current.acquisition
                ? current.limitation
                : 'Historical imagery providers are not migrated. Requested time is intent only.'
            }
          }
        }
      });
    }
  });
}
