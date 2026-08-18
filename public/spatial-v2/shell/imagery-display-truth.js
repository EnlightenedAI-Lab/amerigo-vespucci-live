/**
 * Operator chrome projection of Time Engine display-truth.
 * Consumes displayConfirmed / displayState / selectedId / activeId.
 * Does not derive display from UI presence, map READY, or selectedId.
 * LATEST current mosaics are Ground, not Time Engine observations.
 */

import { DROP_PIN_THEN_LATEST, IMAGERY_POOL } from '../imagery/imagery-contract.js';
import { imageryProviderLabel } from '../imagery/imagery-capture-receipt.js';

const CURRENT_GROUND_MODES = new Set(['NEARMAP', 'ESRI_WORLD_IMAGERY', 'GOOGLE_SATELLITE']);

function hasDropPinFocus(focus) {
  return Boolean(
    focus
    && Number.isFinite(Number(focus.longitude))
    && Number.isFinite(Number(focus.latitude))
    && (focus.sourceType === 'DROP_PIN' || focus.source === 'drop-pin')
  );
}

function timeEngineTruth(time = {}) {
  const selectedId = time?.selectedId || null;
  const activatedId = time?.activatedId || time?.activeId || null;
  const displayConfirmed = time?.displayConfirmed === true;
  const displayState = time?.displayState ?? null;
  const selected = time?.selected || null;
  const activated = time?.activated || time?.active || null;
  const displayed = displayConfirmed
    ? (time?.displayed || activated)
    : null;

  let displayLabel = 'NONE';
  if (displayConfirmed === true) {
    displayLabel = 'DISPLAY_CONFIRMED';
  } else if (displayState && displayState !== 'NONE') {
    displayLabel = 'DISPLAY NOT CONFIRMED';
  } else if (selectedId || activatedId) {
    displayLabel = 'DISPLAY NOT CONFIRMED';
  }

  return {
    selectedId,
    activatedId,
    displayedId: displayed?.id || (displayConfirmed ? time?.displayedId || activatedId : null),
    displayConfirmed,
    displayState,
    selectedLabel: selected?.productName || selected?.id || 'NO OBSERVATION SELECTED',
    activatedLabel: activated?.productName || activated?.id || 'NOT ACTIVATED',
    displayedLabel: displayed?.productName || displayed?.id || null,
    displayLabel,
    operatorMessage: null
  };
}

export function projectImageryDisplayTruth(time = {}, context = {}) {
  const imageryView = context.imageryView || null;
  const ground = context.ground || null;
  const focus = context.focus || null;
  const latest = imageryView === 'LATEST' || time?.pool === IMAGERY_POOL.LATEST;

  if (latest && imageryView === 'LATEST') {
    if (!hasDropPinFocus(focus)) {
      return {
        selectedId: null,
        activatedId: null,
        displayedId: null,
        displayConfirmed: false,
        displayState: 'NONE',
        selectedLabel: 'NO PLACE SELECTED',
        activatedLabel: 'NOT ACTIVATED',
        displayedLabel: null,
        displayLabel: 'NONE',
        operatorMessage: DROP_PIN_THEN_LATEST
      };
    }
    if (time?.pool === IMAGERY_POOL.LATEST && CURRENT_GROUND_MODES.has(ground?.currentMode)) {
      const observation = ground?.receipt?.observation || null;
      const label = imageryProviderLabel(observation, ground);
      const applying = ground?.applyState === 'APPLYING' || time?.engineState === 'APPLYING';
      const confirmed = ground?.displayConfirmed === true
        || (ground?.currentMode !== 'NEARMAP' && ground?.applyState === 'READY');
      return {
        selectedId: observation?.id || ground.currentMode,
        activatedId: observation?.id || ground.currentMode,
        displayedId: confirmed ? (observation?.id || ground.currentMode) : null,
        displayConfirmed: confirmed,
        displayState: confirmed
          ? 'DISPLAY_CONFIRMED'
          : (applying ? 'ACTIVATED' : 'SELECTED'),
        selectedLabel: label,
        activatedLabel: label,
        displayedLabel: confirmed ? label : null,
        displayLabel: confirmed ? 'DISPLAY_CONFIRMED' : 'DISPLAY NOT CONFIRMED',
        operatorMessage: null
      };
    }
    return {
      ...timeEngineTruth(time),
      selectedLabel: 'NO OBSERVATION SELECTED',
      activatedLabel: 'NOT ACTIVATED',
      operatorMessage: 'Click LATEST to show current imagery at the pin.'
    };
  }

  if (imageryView === 'HISTORY' && !time?.selectedId) {
    return {
      ...timeEngineTruth(time),
      operatorMessage: 'HISTORY lists archive. Click a row to activate. Capture and release stay separate.'
    };
  }

  return timeEngineTruth(time);
}
