/**
 * In-memory activity log for foundation Mission 1.
 * External side effects are never claimed reversed here.
 */

import { createActivityEvent } from '../foundation/contracts/activity-event.js';
import { createId, frozenClone } from '../foundation/contracts/validate.js';

export function createActivityLog({ idFactory, now } = {}) {
  const events = [];

  return Object.freeze({
    record(input) {
      const event = createActivityEvent({
        ...input,
        eventId: input.eventId || createId('activity', idFactory)
      }, { now });
      events.push(event);
      return frozenClone(event);
    },
    list() {
      return events.map((event) => frozenClone(event));
    },
    atCursor(cursor) {
      if (!cursor) return null;
      return frozenClone(events.find((event) => event.eventId === cursor) || null);
    },
    sliceThrough(cursor) {
      if (!cursor) return [];
      const index = events.findIndex((event) => event.eventId === cursor);
      if (index < 0) return [];
      return events.slice(0, index + 1).map((event) => frozenClone(event));
    }
  });
}
