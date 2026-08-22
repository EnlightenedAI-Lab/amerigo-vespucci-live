/**
 * Camera Guided Next — derived from live product state.
 * Session tour progress only. Does not copy Camera truth. Does not open the wall.
 */

import { getActiveSpatialFocus } from '../map/spatial-focus.js';
import {
  CAMERA_OPERATOR_MODE,
  getCameraOperatorMode
} from './operator-mode.js';
import {
  getLastCoveragePlan,
  listAutoPlanCameras,
  focusPointFromFocusRef,
  rememberedCoverageTarget,
  coverageTargetPoint
} from './engine/coverage-plan.js';
import { getCameraWallSnapshot, subscribeCameraWall } from './engine/camera-wall.js';
import {
  getLastVisualCoverage,
  isVisualCoverageSearching,
  subscribeVisualCoverage
} from './engine/visual-coverage.js';
import { getLastCameraQuerySnapshot, subscribeCameraQuery } from './spatial-camera-adapter.js';
import {
  getRepresentationAttachStatus,
  getSlotRepresentationSnapshot,
  subscribeSlotRepresentations
} from './provider/slot-representations.js';

export const GUIDED_STATE = Object.freeze({
  TARGET_REQUIRED: 'TARGET_REQUIRED',
  TARGET_READY: 'TARGET_READY',
  PLAN_READY: 'PLAN_READY',
  WALL_CLOSED: 'WALL_CLOSED',
  PROVIDER_LOADING: 'PROVIDER_LOADING',
  INSPECT_CAMERA: 'INSPECT_CAMERA',
  TOUR_COMPLETE: 'TOUR_COMPLETE',
  BLOCKED: 'BLOCKED',
  GUIDED_OFF: 'GUIDED_OFF'
});

export const GUIDED_STATUS = Object.freeze({
  NEXT: 'NEXT',
  BLOCKED: 'BLOCKED',
  LOADING: 'LOADING',
  READY: 'READY',
  OFF: 'OFF'
});

export const GUIDED_CONTROL = Object.freeze({
  LOOK_AROUND: 'LOOK_AROUND',
  FOCUS: 'FOCUS',
  GENERATE_CAMERA_COVERAGE: 'GENERATE_CAMERA_COVERAGE',
  VIEW_EXISTING_360: 'VIEW_EXISTING_360',
  PLACE_CAMERA: 'PLACE_CAMERA',
  BUILD_RELEVANT_WALL: 'BUILD_RELEVANT_WALL',
  CAMERA_01: 'CAMERA_01',
  CAMERA_02: 'CAMERA_02',
  CAMERA_03: 'CAMERA_03'
});

const listeners = new Set();
let enabled = true;
let inspectedSlotIds = new Set();
let lastGenerateReason = null;
let lastWallOpen = false;

function emit() {
  const snapshot = getGuidedNextSnapshot();
  for (const listener of listeners) {
    try { listener(snapshot); } catch { /* ignore */ }
  }
}

function guidance({
  state,
  nextAction,
  targetControl = null,
  status,
  blockedReason = null,
  label,
  greenCount = 0
}) {
  return Object.freeze({
    enabled,
    state,
    nextAction,
    targetControl,
    status,
    blockedReason,
    label,
    greenCount,
    inspectedSlotIds: Object.freeze([...inspectedSlotIds]),
    mutatesCameraPose: false,
    opensWall: false
  });
}

function slotHasProvider(pack) {
  return Boolean(
    pack?.representation?.providerId
    || pack?.google?.providerId
    || pack?.mapillary?.providerId
  );
}

function cameraControl(index) {
  const ordinal = String(index + 1).padStart(2, '0');
  return `CAMERA_${ordinal}`;
}

function queryHasRun(query) {
  if (!query) return false;
  const reason = query.emptyReason || query.reason;
  return reason !== 'NO_QUERY';
}

function hasPlanTarget(input) {
  if (coverageTargetPoint(input.planTarget)) return true;
  return (input.autoPlanCameras || []).some((camera) => coverageTargetPoint(camera?.targetFocus));
}

export function deriveGuidedNext(input = {}) {
  const on = input.enabled !== false;
  if (!on) {
    return guidance({
      state: GUIDED_STATE.GUIDED_OFF,
      nextAction: null,
      status: GUIDED_STATUS.OFF,
      label: 'GUIDED OFF',
      greenCount: 0
    });
  }

  const hasFocus = Boolean(focusPointFromFocusRef(input.focusRef || null));
  const autoPlan = Array.isArray(input.autoPlanCameras) ? input.autoPlanCameras : [];
  const lastPlan = input.lastPlan || null;
  const hasCoverage = autoPlan.length >= 3
    || (lastPlan?.ok === true && Number(lastPlan.cameraCount) >= 3);
  const wall = input.wall || {};
  const wallOpen = wall.open === true;
  const attachInFlight = input.attachInFlight === true;
  const reps = input.representations?.slots || [];
  const inspected = new Set(input.inspectedSlotIds || []);
  const generateReason = input.lastGenerateReason || null;
  const visualSearching = input.visualSearching === true;
  const visual = input.visualCoverage || null;
  const visualWall = wall.source === 'VISUAL_COVERAGE'
    || (wall.slots || []).some((slot) => slot?.source === 'VISUAL_COVERAGE');
  const operatorMode = input.operatorMode || CAMERA_OPERATOR_MODE.CHOOSER;
  const relevantCount = Number(input.query?.relevantCount) || 0;
  const hasRecoverableTarget = hasFocus || hasPlanTarget(input);

  if (operatorMode === CAMERA_OPERATOR_MODE.LOOK_AROUND) {
    if (visualSearching) {
      return guidance({
        state: GUIDED_STATE.PROVIDER_LOADING,
        nextAction: 'FINDING STREET VIEWS',
        targetControl: GUIDED_CONTROL.LOOK_AROUND,
        status: GUIDED_STATUS.LOADING,
        label: 'FINDING STREET VIEWS',
        greenCount: 0
      });
    }
    if (visualWall && wallOpen) {
      return guidance({
        state: GUIDED_STATE.TOUR_COMPLETE,
        nextAction: '360 WALL READY',
        status: GUIDED_STATUS.READY,
        label: '360 WALL READY',
        greenCount: 0
      });
    }
    if (!hasFocus) {
      return guidance({
        state: GUIDED_STATE.TARGET_REQUIRED,
        nextAction: 'CLICK A POINT',
        targetControl: GUIDED_CONTROL.FOCUS,
        status: GUIDED_STATUS.NEXT,
        label: 'NEXT — CLICK ONE POINT',
        greenCount: 1
      });
    }
    if (visual?.ok === false && visual.reason === 'NO_STREET_360_REPRESENTATION') {
      return guidance({
        state: GUIDED_STATE.TARGET_REQUIRED,
        nextAction: 'CHANGE TARGET',
        targetControl: GUIDED_CONTROL.FOCUS,
        status: GUIDED_STATUS.NEXT,
        blockedReason: visual.emptyMessage || 'NO STREET 360 REPRESENTATION FOUND',
        label: 'NEXT — CHANGE TARGET',
        greenCount: 1
      });
    }
    return guidance({
      state: GUIDED_STATE.PROVIDER_LOADING,
      nextAction: 'FINDING STREET VIEWS',
      targetControl: GUIDED_CONTROL.LOOK_AROUND,
      status: GUIDED_STATUS.LOADING,
      label: 'FINDING STREET VIEWS',
      greenCount: 0
    });
  }

  if (operatorMode === CAMERA_OPERATOR_MODE.CHOOSER && !hasCoverage && !wallOpen && !generateReason) {
    return guidance({
      state: GUIDED_STATE.TARGET_READY,
      nextAction: 'LOOK AROUND A LOCATION',
      targetControl: GUIDED_CONTROL.LOOK_AROUND,
      status: GUIDED_STATUS.NEXT,
      label: 'NEXT — LOOK AROUND A LOCATION',
      greenCount: 1
    });
  }

  if (!hasFocus && !hasCoverage) {
    return guidance({
      state: GUIDED_STATE.TARGET_REQUIRED,
      nextAction: 'CHOOSE TARGET',
      targetControl: GUIDED_CONTROL.FOCUS,
      status: GUIDED_STATUS.NEXT,
      blockedReason: generateReason,
      label: 'NEXT — CHOOSE TARGET',
      greenCount: 1
    });
  }

  if (visualSearching) {
    return guidance({
      state: GUIDED_STATE.PROVIDER_LOADING,
      nextAction: 'FINDING STREET VIEWS',
      targetControl: GUIDED_CONTROL.VIEW_EXISTING_360,
      status: GUIDED_STATUS.LOADING,
      label: 'FINDING STREET VIEWS',
      greenCount: 0
    });
  }

  if (visualWall && wallOpen) {
    return guidance({
      state: GUIDED_STATE.TOUR_COMPLETE,
      nextAction: '360 WALL READY',
      status: GUIDED_STATUS.READY,
      label: '360 WALL READY',
      greenCount: 0
    });
  }

  if (visual?.ok === false && visual.reason === 'NO_STREET_360_REPRESENTATION') {
    return guidance({
      state: GUIDED_STATE.TARGET_REQUIRED,
      nextAction: 'CHOOSE NEW TARGET',
      targetControl: GUIDED_CONTROL.FOCUS,
      status: GUIDED_STATUS.NEXT,
      blockedReason: visual.emptyMessage || 'NO STREET 360 REPRESENTATION FOUND',
      label: 'NEXT — CHOOSE NEW TARGET',
      greenCount: 1
    });
  }

  if (!hasCoverage) {
    if (generateReason) {
      return guidance({
        state: GUIDED_STATE.BLOCKED,
        nextAction: 'GENERATE CAMERA COVERAGE',
        targetControl: GUIDED_CONTROL.GENERATE_CAMERA_COVERAGE,
        status: GUIDED_STATUS.BLOCKED,
        blockedReason: generateReason,
        label: `BLOCKED — ${generateReason}`,
        greenCount: 0
      });
    }
    return guidance({
      state: GUIDED_STATE.TARGET_READY,
      nextAction: 'GENERATE 3-CAMERA PLAN',
      targetControl: GUIDED_CONTROL.GENERATE_CAMERA_COVERAGE,
      status: GUIDED_STATUS.NEXT,
      label: 'NEXT — GENERATE 3-CAMERA PLAN',
      greenCount: 1
    });
  }

  if (!wallOpen) {
    if (relevantCount > 0 && hasRecoverableTarget) {
      return guidance({
        state: GUIDED_STATE.WALL_CLOSED,
        nextAction: 'OPEN CAMERA WALL',
        targetControl: GUIDED_CONTROL.BUILD_RELEVANT_WALL,
        status: GUIDED_STATUS.NEXT,
        label: 'NEXT — OPEN CAMERA WALL',
        greenCount: 1
      });
    }
    if (!hasRecoverableTarget) {
      return guidance({
        state: GUIDED_STATE.TARGET_REQUIRED,
        nextAction: 'CHOOSE TARGET',
        targetControl: GUIDED_CONTROL.FOCUS,
        status: GUIDED_STATUS.NEXT,
        blockedReason: generateReason,
        label: 'NEXT — CHOOSE TARGET',
        greenCount: 1
      });
    }
    if (!queryHasRun(input.query)) {
      return guidance({
        state: GUIDED_STATE.WALL_CLOSED,
        nextAction: 'RESTORING CAMERA RELEVANCE',
        targetControl: null,
        status: GUIDED_STATUS.LOADING,
        label: 'RESTORING CAMERA RELEVANCE',
        greenCount: 0
      });
    }
    return guidance({
      state: GUIDED_STATE.BLOCKED,
      nextAction: 'CHOOSE NEW TARGET',
      targetControl: GUIDED_CONTROL.FOCUS,
      status: GUIDED_STATUS.NEXT,
      blockedReason: 'NO RELEVANT CAMERAS FOR TARGET',
      label: 'NEXT — CHOOSE NEW TARGET',
      greenCount: 1
    });
  }

  const slots = wall.slots || [];
  const usable = slots
    .map((slot, index) => ({ slot, index, pack: reps.find((item) => item.slotId === slot.slotId) }))
    .filter((item) => slotHasProvider(item.pack));

  if (attachInFlight && usable.length === 0) {
    return guidance({
      state: GUIDED_STATE.PROVIDER_LOADING,
      nextAction: 'LOADING CAMERA VIEW',
      status: GUIDED_STATUS.LOADING,
      label: 'LOADING CAMERA VIEW',
      greenCount: 0
    });
  }

  if (!attachInFlight && usable.length === 0) {
    return guidance({
      state: GUIDED_STATE.BLOCKED,
      nextAction: 'INSPECT CAMERA',
      targetControl: GUIDED_CONTROL.CAMERA_01,
      status: GUIDED_STATUS.BLOCKED,
      blockedReason: 'NO CAMERA REPRESENTATION AVAILABLE',
      label: 'BLOCKED — NO CAMERA REPRESENTATION AVAILABLE',
      greenCount: 0
    });
  }

  const triViewOpen = wall.mode === 'TRI_VIEW' || Number(wall.layout) === 3 || Number(wall.slotCount) >= 2;
  if (triViewOpen) {
    const missing = slots
      .map((slot, index) => ({ slot, index, pack: reps.find((item) => item.slotId === slot.slotId) }))
      .filter((item) => !slotHasProvider(item.pack));
    if (missing.length) {
      const first = missing[0];
      const ordinal = String(first.index + 1).padStart(2, '0');
      return guidance({
        state: GUIDED_STATE.INSPECT_CAMERA,
        nextAction: `CAMERA ${ordinal} UNAVAILABLE`,
        targetControl: cameraControl(first.index),
        status: GUIDED_STATUS.BLOCKED,
        blockedReason: 'NO CAMERA REPRESENTATION AVAILABLE',
        label: `CAMERA ${ordinal} UNAVAILABLE`,
        greenCount: 0
      });
    }
    return guidance({
      state: GUIDED_STATE.TOUR_COMPLETE,
      nextAction: 'CAMERA WALL READY',
      status: GUIDED_STATUS.READY,
      label: 'CAMERA WALL READY',
      greenCount: 0
    });
  }

  const next = usable.find((item) => !inspected.has(item.slot.slotId));
  if (!next) {
    return guidance({
      state: GUIDED_STATE.TOUR_COMPLETE,
      nextAction: 'CAMERA INSPECTION READY',
      status: GUIDED_STATUS.READY,
      label: 'CAMERA INSPECTION READY',
      greenCount: 0
    });
  }

  const control = cameraControl(next.index);
  const ordinal = String(next.index + 1).padStart(2, '0');
  return guidance({
    state: GUIDED_STATE.INSPECT_CAMERA,
    nextAction: `INSPECT CAMERA ${ordinal}`,
    targetControl: control,
    status: GUIDED_STATUS.NEXT,
    label: `NEXT — INSPECT CAMERA ${ordinal}`,
    greenCount: 1
  });
}

export function collectGuidedNextInput(extras = {}) {
  const wall = extras.wall || getCameraWallSnapshot();
  if (wall.open === true !== lastWallOpen) {
    inspectedSlotIds = new Set();
    lastWallOpen = wall.open === true;
  }
  return {
    enabled: extras.enabled ?? enabled,
    focusRef: extras.focusRef ?? getActiveSpatialFocus(),
    lastPlan: extras.lastPlan ?? getLastCoveragePlan(),
    autoPlanCameras: extras.autoPlanCameras ?? listAutoPlanCameras(),
    planTarget: extras.planTarget ?? rememberedCoverageTarget(),
    query: extras.query ?? getLastCameraQuerySnapshot(),
    wall,
    representations: extras.representations ?? getSlotRepresentationSnapshot(),
    attachInFlight: extras.attachInFlight ?? getRepresentationAttachStatus().inFlight,
    inspectedSlotIds: extras.inspectedSlotIds ?? [...inspectedSlotIds],
    lastGenerateReason: extras.lastGenerateReason ?? lastGenerateReason,
    visualCoverage: extras.visualCoverage ?? getLastVisualCoverage(),
    visualSearching: extras.visualSearching ?? isVisualCoverageSearching(),
    operatorMode: extras.operatorMode ?? getCameraOperatorMode()
  };
}

export function getGuidedNextSnapshot(extras = {}) {
  return deriveGuidedNext(collectGuidedNextInput(extras));
}

export function markGuidedSlotInspected(slotId) {
  if (!slotId) return getGuidedNextSnapshot();
  inspectedSlotIds.add(String(slotId));
  emit();
  return getGuidedNextSnapshot();
}

export function recordGuidedGenerateResult(result) {
  lastGenerateReason = result?.ok === false
    ? String(result.reason || 'GENERATION_FAILED')
    : null;
  emit();
  return getGuidedNextSnapshot();
}

export function setGuidedNextEnabled(next) {
  enabled = next !== false;
  emit();
  return getGuidedNextSnapshot();
}

export function isGuidedNextEnabled() {
  return enabled === true;
}

export function resetGuidedNextState({ emit: shouldEmit = true } = {}) {
  enabled = true;
  inspectedSlotIds = new Set();
  lastGenerateReason = null;
  lastWallOpen = false;
  if (shouldEmit) emit();
  return getGuidedNextSnapshot();
}

export function subscribeGuidedNext(listener) {
  if (typeof listener !== 'function') return () => {};
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function bindGuidedNextProductListeners() {
  const unsubWall = subscribeCameraWall(() => emit());
  const unsubRep = subscribeSlotRepresentations(() => emit());
  const unsubQuery = subscribeCameraQuery(() => emit());
  const unsubVisual = subscribeVisualCoverage(() => emit());
  return () => {
    unsubWall();
    unsubRep();
    unsubQuery();
    unsubVisual();
  };
}
