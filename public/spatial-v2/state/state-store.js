/**
 * Canonical StateStore: single writer, monotonic revision, immutable snapshots.
 * Stale patches fail closed and are archived as receipts. They never overwrite.
 */

import {
  ACTION_SOURCE,
  EFFECT_CLASS,
  UNDO_POLICY,
  applyWorldStateFields,
  createWorldState,
  deriveUndoPolicy,
  PATCHABLE_WORLD_FIELDS
} from '../foundation/contracts/index.js';
import {
  createId,
  failClosed,
  frozenClone,
  isoNow,
  rejectUnknownKeys,
  requireInteger,
  requirePlainObject,
  requireString
} from '../foundation/contracts/validate.js';
import { createActivityLog } from './activity-log.js';
import { createReadOnlyStateDiagnostic } from './read-only-diagnostic.js';
import { assertSerializableWorldState, deserializeWorldState, serializeWorldState } from './serialization.js';
import { createSnapshotStore } from './snapshot-store.js';
import { createUndoManager } from './undo-manager.js';

const PATCH_KEYS = [
  'patchId',
  'baseRevision',
  'actorRef',
  'source',
  'capabilityId',
  'actionId',
  'effectClass',
  'undoPolicy',
  'fields',
  'requestedAt',
  'worldId',
  'receiptRef',
  'traceId'
];

function validatePatch(patch) {
  requirePlainObject(patch, 'StatePatch');
  rejectUnknownKeys(patch, 'StatePatch', PATCH_KEYS);
  const source = requireString(patch.source, 'source');
  if (!Object.values(ACTION_SOURCE).includes(source)) {
    failClosed('UNKNOWN_ENUM', 'Patch source is unknown.', { source });
  }
  const effectClass = requireString(patch.effectClass, 'effectClass');
  if (!Object.values(EFFECT_CLASS).includes(effectClass)) {
    failClosed('UNKNOWN_ENUM', 'effectClass is unknown.', { effectClass });
  }
  const undoPolicy = requireString(patch.undoPolicy || deriveUndoPolicy(effectClass), 'undoPolicy');
  if (!Object.values(UNDO_POLICY).includes(undoPolicy)) {
    failClosed('UNKNOWN_ENUM', 'undoPolicy is unknown.', { undoPolicy });
  }
  if (
    (effectClass === EFFECT_CLASS.EXTERNAL_WRITE || effectClass === EFFECT_CLASS.DESTRUCTIVE)
    && undoPolicy === UNDO_POLICY.UNDOABLE
  ) {
    failClosed('UNDO_FORBIDDEN', 'External or destructive patches cannot be state-rewound.');
  }
  const fields = patch.fields == null ? {} : requirePlainObject(patch.fields, 'fields');
  for (const key of Object.keys(fields)) {
    if (!PATCHABLE_WORLD_FIELDS.includes(key)) {
      failClosed('UNKNOWN_WORLD_STATE_FIELD', `Cannot patch '${key}'.`, { key });
    }
  }
  if (effectClass === EFFECT_CLASS.READ_ONLY && Object.keys(fields).length > 0) {
    failClosed('READ_ONLY_MUTATION', 'READ_ONLY patches cannot mutate World State.');
  }
  if (effectClass !== EFFECT_CLASS.READ_ONLY && Object.keys(fields).length === 0) {
    failClosed('EMPTY_PATCH', 'Mutating patches must include at least one World State field.');
  }
  return {
    patchId: patch.patchId ? requireString(patch.patchId, 'patchId') : null,
    baseRevision: requireInteger(patch.baseRevision, 'baseRevision', { min: 0 }),
    actorRef: requireString(patch.actorRef, 'actorRef'),
    source,
    capabilityId: patch.capabilityId == null ? null : requireString(patch.capabilityId, 'capabilityId'),
    actionId: patch.actionId == null ? null : requireString(patch.actionId, 'actionId'),
    effectClass,
    undoPolicy,
    fields,
    requestedAt: patch.requestedAt || null,
    worldId: patch.worldId == null ? null : requireString(patch.worldId, 'worldId'),
    receiptRef: patch.receiptRef == null ? null : requireString(patch.receiptRef, 'receiptRef'),
    traceId: patch.traceId == null ? null : requireString(patch.traceId, 'traceId')
  };
}

function pickFields(world, keys) {
  const picked = {};
  for (const key of keys) picked[key] = world[key];
  return frozenClone(picked);
}

export function createStateStore(options = {}) {
  const now = options.now;
  const idFactory = options.idFactory;
  const activityLog = createActivityLog({ idFactory, now });
  const snapshotStore = createSnapshotStore({ idFactory });
  const rejectedReceipts = [];
  const listeners = new Set();

  let world = createWorldState(options.initial || {}, { now, idFactory });
  assertSerializableWorldState(world);
  world = frozenClone(world);
  snapshotStore.record(world, { label: 'initial' });

  const notifySubscribers = () => {
    const snapshot = frozenClone(world);
    for (const listener of listeners) {
      try {
        listener(snapshot);
      } catch (error) {
        console.warn('[IQAI V2] StateStore listener failed', error);
      }
    }
    return snapshot;
  };

  const getSnapshot = () => frozenClone(world);

  function archiveStale(patch) {
    const receipt = frozenClone({
      receiptId: createId('stale', idFactory),
      kind: 'STALE_REVISION',
      patchId: patch.patchId,
      baseRevision: patch.baseRevision,
      currentRevision: world.revision,
      archivedAt: isoNow(now),
      overwritten: false
    });
    rejectedReceipts.push(receipt);
    return receipt;
  }

  function writeWorld(next) {
    assertSerializableWorldState(next);
    world = frozenClone(next);
    snapshotStore.record(world);
    return getSnapshot();
  }

  const undoManager = createUndoManager({
    applyRestorePatch(beforeFields, tokenId) {
      return applyValidatedPatch({
        patchId: createId('undo-patch', idFactory),
        baseRevision: world.revision,
        actorRef: 'system:undo',
        source: ACTION_SOURCE.SYSTEM,
        capabilityId: null,
        actionId: null,
        effectClass: EFFECT_CLASS.SESSION_MUTATION,
        undoPolicy: UNDO_POLICY.NON_UNDOABLE,
        fields: beforeFields,
        requestedAt: isoNow(now),
        worldId: world.worlds.activeWorldId,
        receiptRef: tokenId,
        traceId: tokenId
      }, { skipUndoRegistration: true });
    }
  });

  function applyValidatedPatch(patch, { skipUndoRegistration = false } = {}) {
    if (patch.worldId && patch.worldId !== world.worlds.activeWorldId) {
      failClosed('WORLD_MISMATCH', 'Patch worldId does not match active world.', {
        worldId: patch.worldId,
        activeWorldId: world.worlds.activeWorldId
      });
    }
    if (patch.baseRevision !== world.revision) {
      return {
        ok: false,
        code: 'STALE_REVISION',
        snapshot: getSnapshot(),
        receipt: archiveStale(patch)
      };
    }

    const fieldKeys = Object.keys(patch.fields);
    const beforeFields = pickFields(world, fieldKeys);
    const beforeRevision = world.revision;
    const requestedAt = isoNow(patch.requestedAt || now);
    const patchId = patch.patchId || createId('patch', idFactory);

    let next = applyWorldStateFields(world, patch.fields, { now: () => requestedAt, idFactory });
    const eventId = createId('activity', idFactory);
    next = {
      ...next,
      revision: beforeRevision + 1,
      updatedAt: requestedAt,
      context: {
        ...next.context,
        activityCursor: eventId
      }
    };
    next = createWorldState(next, { now: () => requestedAt, idFactory });

    const snapshot = writeWorld(next);
    const undoToken = skipUndoRegistration ? null : createId('undo', idFactory);
    if (undoToken) {
      undoManager.register({
        tokenId: undoToken,
        afterRevision: snapshot.revision,
        beforeFields,
        effectClass: patch.effectClass,
        undoPolicy: patch.undoPolicy
      });
    }

    const activityEvent = activityLog.record({
      eventId,
      actorRef: patch.actorRef,
      source: patch.source,
      capabilityId: patch.capabilityId,
      patchId,
      beforeRevision,
      afterRevision: snapshot.revision,
      effectClass: patch.effectClass,
      undoPolicy: patch.undoPolicy,
      receiptRef: patch.receiptRef,
      undoToken,
      recordedAt: requestedAt
    });
    notifySubscribers();

    return {
      ok: true,
      snapshot,
      activityEvent,
      patchId,
      diagnostic: createReadOnlyStateDiagnostic(snapshot)
    };
  }

  function settleImportedSnapshot(imported, { actorRef, receiptRef }) {
    const requestedAt = isoNow(now);
    const eventId = createId('activity', idFactory);
    const beforeRevision = world.revision;
    const next = createWorldState({
      ...imported,
      revision: beforeRevision + 1,
      updatedAt: requestedAt,
      context: {
        ...imported.context,
        activityCursor: eventId
      }
    }, { now: () => requestedAt, idFactory });
    const snapshot = writeWorld(next);
    const activityEvent = activityLog.record({
      eventId,
      actorRef,
      source: ACTION_SOURCE.SYSTEM,
      capabilityId: null,
      patchId: null,
      beforeRevision,
      afterRevision: snapshot.revision,
      effectClass: EFFECT_CLASS.SESSION_MUTATION,
      undoPolicy: UNDO_POLICY.NON_UNDOABLE,
      receiptRef,
      undoToken: null,
      recordedAt: requestedAt
    });
    notifySubscribers();
    return { ok: true, snapshot, activityEvent };
  }

  return Object.freeze({
    getSnapshot,
    getRevision() {
      return world.revision;
    },
    getFocus() {
      return frozenClone(world.activeFocus);
    },
    getSelection() {
      return frozenClone(world.selection);
    },
    getDiagnostic() {
      return createReadOnlyStateDiagnostic(world);
    },
    subscribe(listener) {
      listeners.add(listener);
      listener(getSnapshot());
      return () => listeners.delete(listener);
    },
    applyPatch(rawPatch) {
      const patch = validatePatch(rawPatch);
      return applyValidatedPatch(patch);
    },
    undo(tokenId) {
      return undoManager.undo(tokenId, { currentRevision: world.revision });
    },
    recordNamedSnapshot(label) {
      return snapshotStore.record(world, { label });
    },
    restoreNamedSnapshot(label) {
      const restored = snapshotStore.restoreNamed(label);
      return settleImportedSnapshot(restored, {
        actorRef: 'system:restore',
        receiptRef: label
      });
    },
    serialize() {
      return serializeWorldState(world);
    },
    restoreFromJson(text) {
      const parsed = deserializeWorldState(text);
      const restored = createWorldState(parsed, { now, idFactory });
      return settleImportedSnapshot(restored, {
        actorRef: 'system:restore',
        receiptRef: restored.stateId
      });
    },
    getRejectedReceipts() {
      return rejectedReceipts.map((receipt) => frozenClone(receipt));
    },
    getActivityLog() {
      return activityLog.list();
    },
    getSnapshotStore() {
      return snapshotStore;
    }
  });
}
