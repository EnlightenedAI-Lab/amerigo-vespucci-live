/**
 * CAMERA WALL store — View Slots, not cameras.
 * NUMBER OF CAMERAS ≠ NUMBER OF WALL SLOTS.
 * Session-only. Does not create an operational camera store.
 * Does not mutate CameraPose, heading, FOV, or Spatial SelectionSet.
 */

import { createCameraRef } from '../camera-ref.js';
import {
  TRI_VIEW_HEAVY_BUDGET,
  WALL_MODE,
  WALL_SLOT_CAP,
  createViewSlot,
  heavyViewerPolicy,
  layoutForCount,
  resolveHeavyBudget
} from './view-slot.js';

const listeners = new Set();
const slots = new Map();
let activeSlotId = null;
let layout = 0;
let seq = 0;
let open = false;
let wallMode = WALL_MODE.TRI_VIEW;
let enlargedSlotId = null;
let wallSource = 'CAMERA';

function emit() {
  const snapshot = getCameraWallSnapshot();
  for (const listener of listeners) {
    try {
      listener(snapshot);
    } catch (error) {
      console.warn('[IQAI CAMERA WALL] listener failed', error);
    }
  }
}

function nextSlotId() {
  seq += 1;
  return `view-slot-${seq}`;
}

function writeSlot(input, { activate = false } = {}) {
  const slotId = String(input.slotId || nextSlotId());
  const existing = slots.get(slotId);
  const merged = createViewSlot({
    ...(existing || {}),
    ...input,
    slotId,
    active: activate || (activeSlotId === slotId)
  });
  slots.set(slotId, merged);
  if (activate) {
    activeSlotId = slotId;
    for (const [id, slot] of slots) {
      slots.set(id, createViewSlot({ ...slot, active: id === slotId }));
    }
  }
  return slots.get(slotId);
}

export function relevantCameraIdsFromQuery(snapshot = {}, cap = WALL_SLOT_CAP) {
  const rows = Array.isArray(snapshot.relevant)
    ? snapshot.relevant
    : (Array.isArray(snapshot.results) ? snapshot.results.filter((item) => item?.relevant) : []);
  const ids = [];
  const seen = new Set();
  for (const item of rows) {
    const id = item?.cameraId || item?.cameraRef?.cameraId || (typeof item?.cameraRef === 'string' ? item.cameraRef : null);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
    if (ids.length >= cap) break;
  }
  return Object.freeze(ids);
}

export function assignCameraToSlot(slotId, cameraRef, camera = null) {
  const slot = slots.get(slotId);
  if (!slot) return null;
  const nextRef = cameraRef ? String(cameraRef) : null;
  const cameraChanged = slot.cameraRef !== nextRef;
  const seedHeading = Number.isFinite(Number(camera?.heading)) ? Number(camera.heading) : null;
  writeSlot({
    slotId,
    cameraRef: nextRef,
    viewHeading: cameraChanged
      ? seedHeading
      : (Number.isFinite(Number(slot.viewHeading)) ? slot.viewHeading : seedHeading)
  });
  emit();
  return slots.get(slotId);
}

export function setActiveSlot(slotId) {
  if (!slotId || !slots.has(slotId)) return getActiveWallSlot();
  writeSlot({ slotId }, { activate: true });
  emit();
  return getActiveWallSlot();
}

export function setSlotRepresentation(slotId, representationKind, options = {}) {
  if (!slotId || !slots.has(slotId)) return null;
  writeSlot({ slotId, representationKind });
  if (options.emit !== false) emit();
  return slots.get(slotId);
}

export function getActiveWallSlot() {
  return activeSlotId ? slots.get(activeSlotId) || null : null;
}

export function listWallSlots() {
  return Array.from(slots.values());
}

export function getCameraWallSnapshot() {
  const items = listWallSlots();
  const budget = resolveHeavyBudget({ open, mode: wallMode, enlargedSlotId });
  const policy = heavyViewerPolicy(items, activeSlotId, {
    budget,
    enlargedSlotId
  });
  return Object.freeze({
    kind: 'CAMERA_WALL',
    open,
    layout,
    mode: wallMode,
    enlargedSlotId,
    slotCount: items.length,
    renderedCount: items.length,
    activeSlotId,
    slots: Object.freeze(items),
    rendered: Object.freeze(items),
    active: getActiveWallSlot(),
    cameraRefs: Object.freeze(items.map((slot) => createCameraRef(slot.cameraRef)).filter(Boolean)),
    ownership: 'SESSION_VIEW_SLOT',
    persistence: 'SESSION_ONLY',
    operationalCameraStore: false,
    worldStateCameras: false,
    mutatesCameraPose: false,
    cap: WALL_SLOT_CAP,
    maxHeavyViewers: budget,
    triViewBudget: TRI_VIEW_HEAVY_BUDGET,
    heavyViewer: policy,
    source: wallSource
  });
}

export function subscribeCameraWall(listener) {
  if (typeof listener !== 'function') return () => {};
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function resetCameraWall(options = {}) {
  slots.clear();
  activeSlotId = null;
  seq = 0;
  layout = 0;
  open = false;
  wallMode = WALL_MODE.TRI_VIEW;
  enlargedSlotId = null;
  wallSource = 'CAMERA';
  if (options.emit !== false) emit();
  return getCameraWallSnapshot();
}

export function enlargeWallSlot(slotId) {
  if (!open || !slotId || !slots.has(slotId)) return getCameraWallSnapshot();
  enlargedSlotId = slotId;
  writeSlot({ slotId }, { activate: true });
  emit();
  return getCameraWallSnapshot();
}

export function restoreWallTriView() {
  if (!open) return getCameraWallSnapshot();
  enlargedSlotId = null;
  wallMode = WALL_MODE.TRI_VIEW;
  emit();
  return getCameraWallSnapshot();
}

export function closeCameraWall() {
  return resetCameraWall();
}

export function buildVisualCoverageWall(viewpoints = []) {
  const items = Array.isArray(viewpoints) ? viewpoints.slice(0, WALL_SLOT_CAP) : [];
  resetCameraWall({ emit: false });
  wallSource = 'VISUAL_COVERAGE';
  if (!items.length) {
    open = false;
    emit();
    return getCameraWallSnapshot();
  }
  layout = layoutForCount(items.length);
  open = true;
  wallMode = WALL_MODE.TRI_VIEW;
  enlargedSlotId = null;
  items.forEach((viewpoint, index) => {
    writeSlot({
      cameraRef: null,
      source: 'VISUAL_COVERAGE',
      visualViewpointId: viewpoint.viewpointId || `view-360-${String(index + 1).padStart(2, '0')}`,
      viewHeading: Number.isFinite(Number(viewpoint.viewHeadingTowardTarget))
        ? Number(viewpoint.viewHeadingTowardTarget)
        : null,
      representationKind: viewpoint.representationKind || null
    }, { activate: index === 0 });
  });
  emit();
  return getCameraWallSnapshot();
}

export function buildRelevantCameraWall(snapshot = {}, camerasById = null) {
  const cameraIds = relevantCameraIdsFromQuery(snapshot);
  resetCameraWall({ emit: false });
  wallSource = 'CAMERA';
  if (!cameraIds.length) {
    open = false;
    emit();
    return getCameraWallSnapshot();
  }
  layout = layoutForCount(cameraIds.length);
  open = true;
  wallMode = WALL_MODE.TRI_VIEW;
  enlargedSlotId = null;
  cameraIds.forEach((cameraId, index) => {
    const camera = camerasById?.get?.(cameraId)
      || camerasById?.[cameraId]
      || snapshot.relevant?.find((item) => (item.cameraId || item.cameraRef) === cameraId)
      || null;
    const slot = writeSlot({
      cameraRef: cameraId,
      viewHeading: Number.isFinite(Number(camera?.heading ?? camera?.cameraHeading))
        ? Number(camera.heading ?? camera.cameraHeading)
        : null
    }, { activate: index === 0 });
    return slot;
  });
  emit();
  return getCameraWallSnapshot();
}
