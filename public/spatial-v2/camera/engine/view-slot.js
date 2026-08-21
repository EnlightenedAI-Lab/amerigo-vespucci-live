/**
 * VIEW SLOT contract.
 * A slot is a VIEW onto an existing camera, not a new camera.
 * Does not own authored pose. Does not invent capture time.
 * Production V1: geometric presentation only. No Street360. No sweep. No virtual zoom UI.
 */

import { wrapHeading } from './geodesy.js';

export const VIEW_SLOT_KIND = 'VIEW_SLOT';
export const REPRESENTATION_KIND = Object.freeze({
  GEOMETRIC: 'geometric'
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

export function createViewSlot(input = {}) {
  const rawHeading = input.viewHeading;
  const viewHeading = rawHeading == null || rawHeading === ''
    ? null
    : (Number.isFinite(Number(rawHeading)) ? wrapHeading(rawHeading) : null);
  const cameraRef = input.cameraRef ? String(input.cameraRef) : null;
  return Object.freeze({
    kind: VIEW_SLOT_KIND,
    slotId: String(input.slotId || 'view-slot'),
    cameraRef,
    representationKind: REPRESENTATION_KIND.GEOMETRIC,
    viewHeading,
    active: input.active === true,
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
