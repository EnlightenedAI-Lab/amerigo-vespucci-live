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
  THREE: 3,
  FOUR: 4
});
export const WALL_SLOT_CAP = 4;
export const HEAVY_VIEWER_LIMIT = 1;
export const TRI_VIEW_HEAVY_BUDGET = 4;
export const WALL_MODE = Object.freeze({
  TRI_VIEW: 'TRI_VIEW',
  MASTER_DETAIL: 'MASTER_DETAIL'
});

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
    availability: (cameraRef || input.visualViewpointId) ? SLOT_AVAILABILITY.AVAILABLE : SLOT_AVAILABILITY.IDLE,
    persistence: 'SESSION_ONLY',
    source: input.source === 'VISUAL_COVERAGE' ? 'VISUAL_COVERAGE' : 'CAMERA',
    visualViewpointId: input.visualViewpointId ? String(input.visualViewpointId) : null
  });
}

export function layoutForCount(count) {
  const n = Math.max(0, Math.min(WALL_SLOT_CAP, Number(count) || 0));
  if (n <= 1) return WALL_LAYOUT.ONE;
  if (n === 2) return WALL_LAYOUT.TWO;
  if (n === 3) return WALL_LAYOUT.THREE;
  return WALL_LAYOUT.FOUR;
}

export function resolveHeavyBudget({ open = false, mode = WALL_MODE.TRI_VIEW, enlargedSlotId = null } = {}) {
  if (!open) return 0;
  if (enlargedSlotId) return HEAVY_VIEWER_LIMIT;
  if (mode === WALL_MODE.TRI_VIEW) return TRI_VIEW_HEAVY_BUDGET;
  return HEAVY_VIEWER_LIMIT;
}

export function heavyViewerPolicy(slots = [], activeSlotId = null, options = {}) {
  const budget = Number(options.budget);
  const maxHeavyViewers = Number.isFinite(budget) && budget > 0 ? budget : HEAVY_VIEWER_LIMIT;
  const enlarged = options.enlargedSlotId || null;
  if (enlarged) {
    return Object.freeze({
      maxHeavyViewers: HEAVY_VIEWER_LIMIT,
      heavySlotId: enlarged,
      heavySlotIds: Object.freeze([enlarged]),
      liveDecoders: 1,
      inactivePlaceholder: true
    });
  }
  if (maxHeavyViewers > 1) {
    const heavySlotIds = (slots || []).slice(0, maxHeavyViewers).map((slot) => slot.slotId);
    return Object.freeze({
      maxHeavyViewers,
      heavySlotId: activeSlotId || heavySlotIds[0] || null,
      heavySlotIds: Object.freeze(heavySlotIds),
      liveDecoders: heavySlotIds.length,
      inactivePlaceholder: heavySlotIds.length < (slots || []).length
    });
  }
  const active = (slots || []).find((slot) => slot.slotId === activeSlotId) || null;
  const heavySlotId = active && isHeavyRepresentation(active.representationKind)
    ? active.slotId
    : null;
  return Object.freeze({
    maxHeavyViewers: HEAVY_VIEWER_LIMIT,
    heavySlotId,
    heavySlotIds: Object.freeze(heavySlotId ? [heavySlotId] : []),
    liveDecoders: heavySlotId ? 1 : 0,
    inactivePlaceholder: true
  });
}
