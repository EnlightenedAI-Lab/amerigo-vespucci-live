/**
 * Bounded undo. Session-local fields may rewind. External writes require a
 * compensating capability and are not state-rewound.
 */

import { EFFECT_CLASS, UNDO_POLICY } from '../foundation/contracts/activity-event.js';
import { failClosed } from '../foundation/contracts/validate.js';

export function createUndoManager({ applyRestorePatch }) {
  const tokens = new Map();

  function register({
    tokenId,
    afterRevision,
    beforeFields,
    effectClass,
    undoPolicy
  }) {
    const reversible = undoPolicy === UNDO_POLICY.UNDOABLE && effectClass === EFFECT_CLASS.SESSION_MUTATION;
    const record = Object.freeze({
      tokenId,
      afterRevision,
      beforeFields: beforeFields ? { ...beforeFields } : null,
      effectClass,
      undoPolicy,
      reversible,
      consumed: false
    });
    tokens.set(tokenId, record);
    return record;
  }

  function undo(tokenId, { currentRevision } = {}) {
    const record = tokens.get(tokenId);
    if (!record) failClosed('UNKNOWN_UNDO_TOKEN', 'Undo token is unknown.', { tokenId });
    if (record.consumed) failClosed('UNDO_CONSUMED', 'Undo token was already used.', { tokenId });
    if (record.undoPolicy === UNDO_POLICY.NON_UNDOABLE) {
      failClosed('UNDO_FORBIDDEN', 'This activity is not undoable.');
    }
    if (record.undoPolicy === UNDO_POLICY.COMPENSATING || record.effectClass !== EFFECT_CLASS.SESSION_MUTATION) {
      failClosed(
        'REQUIRES_COMPENSATING_CAPABILITY',
        'External or destructive effects cannot be rewound through World State.',
        { effectClass: record.effectClass, undoPolicy: record.undoPolicy }
      );
    }
    if (currentRevision !== record.afterRevision) {
      failClosed('UNDO_STALE', 'Undo is only valid against the immediately following revision.', {
        currentRevision,
        afterRevision: record.afterRevision
      });
    }
    const restored = applyRestorePatch(record.beforeFields, tokenId);
    tokens.set(tokenId, Object.freeze({ ...record, consumed: true }));
    return restored;
  }

  function get(tokenId) {
    return tokens.get(tokenId) || null;
  }

  return Object.freeze({ register, undo, get });
}
