/**
 * VIEW SLOT contract.
 * A slot is a VIEW onto an existing camera, not a new camera.
 * Does not own authored pose. Does not invent capture time.
 * Provider representations are optional and are not the planned Camera.
 */

import { wrapHeading } from './geodesy.js';

export const VIEW_SLOT_KIND = 'VIEW_SLOT';
export const REPRESENTATION_KIND = Object.freeze({
  GEOMETRIC: 'geometric',
  STREET360: 'street360',
  MAPILLARY: 'mapillary'
});
export const SLOT_AVAILABILITY = Object.freeze({
  IDLE: 'IDLE',
  AVAILABLE: 'AVAILABLE'
});
export const WALL_LAYOUT = Object.freeze({
  ONE: 1,
  TWO: 2,
  THREE: 3
});
export const WALL_SLOT_CAP = 3;
export const HEAVY_VIEWER_LIMIT = 1;

export function isHeavyRepresentation(kind) {
  return kind === REPRESENTATION_KIND.STREET360 || kind === REPRESENTATION_KIND.MAPILLARY;
}

export function createViewSlot(input = {}) {
  const rawHeading = input.viewHeading;
  const viewHeading = rawHeading == null || rawHeading === ''
    ? null
    : (Number.isFinite(Number(rawHeading)) ? wrapHeading(rawHeading) : null);
  const cameraRef = input.cameraRef ? String(input.cameraRef) : null;
  const representationKind = input.representationKind === REPRESENTATION_KIND.STREET360
    || input.representationKind === REPRESENTATION_KIND.MAPILLARY
    ? input.representationKind
    : REPRESENTATION_KIND.GEOMETRIC;
  return Object.freeze({
    kind: VIEW_SLOT_KIND,
    slotId: String(input.slotId || 'view-slot'),
    cameraRef,
    representationKind,
    viewHeading,
    active: input.active === true,
    heavyViewer: input.active === true && isHeavyRepresentation(representationKind),
    availability: cameraRef ? SLOT_AVAILABILITY.AVAILABLE : SLOT_AVAILABILITY.IDLE,
    persistence: 'SESSION_ONLY'
  });
}

export function layoutForCount(count) {
  const n = Math.max(0, Math.min(WALL_SLOT_CAP, Number(count) || 0));
  if (n <= 1) return WALL_LAYOUT.ONE;
  if (n === 2) return WALL_LAYOUT.TWO;
  return WALL_LAYOUT.THREE;
}

export function heavyViewerPolicy(slots = [], activeSlotId = null) {
  const active = (slots || []).find((slot) => slot.slotId === activeSlotId) || null;
  const heavySlotId = active && isHeavyRepresentation(active.representationKind)
    ? active.slotId
    : null;
  return Object.freeze({
    maxHeavyViewers: HEAVY_VIEWER_LIMIT,
    heavySlotId,
    liveDecoders: heavySlotId ? 1 : 0,
    inactivePlaceholder: true
  });
}
