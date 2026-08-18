/**
 * Versioned World State snapshot store. Runtime handles and secrets are
 * excluded by the serialization gate. This is session-local only.
 */

import { validateWorldState } from '../foundation/contracts/world-state.js';
import { createId, frozenClone } from '../foundation/contracts/validate.js';
import { deserializeWorldState, serializeWorldState } from './serialization.js';

export function createSnapshotStore({ idFactory } = {}) {
  const byId = new Map();
  const named = new Map();

  function record(snapshot, { snapshotId, label } = {}) {
    const world = validateWorldState(snapshot);
    const json = serializeWorldState(world);
    const id = snapshotId || createId('snapshot', idFactory);
    const entry = Object.freeze({
      snapshotId: id,
      label: label || null,
      revision: world.revision,
      activityCursor: world.context.activityCursor,
      json
    });
    byId.set(id, entry);
    if (label) named.set(label, id);
    return { snapshotId: id, revision: world.revision, activityCursor: world.context.activityCursor };
  }

  function restore(snapshotId) {
    const entry = byId.get(snapshotId);
    if (!entry) {
      const error = new Error(`Unknown snapshot '${snapshotId}'.`);
      error.code = 'UNKNOWN_SNAPSHOT';
      throw error;
    }
    return validateWorldState(deserializeWorldState(entry.json));
  }

  function restoreNamed(label) {
    const id = named.get(label);
    if (!id) {
      const error = new Error(`Unknown named snapshot '${label}'.`);
      error.code = 'UNKNOWN_SNAPSHOT';
      throw error;
    }
    return restore(id);
  }

  function get(snapshotId) {
    const entry = byId.get(snapshotId);
    return entry ? frozenClone(entry) : null;
  }

  return Object.freeze({
    record,
    restore,
    restoreNamed,
    get,
    list() {
      return [...byId.values()].map((entry) => frozenClone({
        snapshotId: entry.snapshotId,
        label: entry.label,
        revision: entry.revision,
        activityCursor: entry.activityCursor
      }));
    }
  });
}
