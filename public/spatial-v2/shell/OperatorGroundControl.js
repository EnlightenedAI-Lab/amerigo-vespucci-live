/**
 * Operator GROUND overlay. Calls existing Ground Controller setGroundMode().
 * Does not create a second ground engine.
 */

import { GROUND_APPLY_STATE, GROUND_MODE } from '../imagery/imagery-contract.js';
import {
  getGroundSnapshot,
  listGroundModes,
  setGroundMode
} from '../imagery/ground-controller.js';

export const OPERATOR_GROUND_CHOICES = Object.freeze([
  Object.freeze({ id: GROUND_MODE.NEARMAP, label: 'NEARMAP' }),
  Object.freeze({ id: GROUND_MODE.ESRI_WORLD_IMAGERY, label: 'ESRI WORLD IMAGERY' }),
  Object.freeze({ id: GROUND_MODE.AUTHORED_WEBMAP, label: 'AUTHORED MAP' }),
  Object.freeze({ id: GROUND_MODE.PURE_BLACK, label: 'BLACK' }),
  Object.freeze({ id: GROUND_MODE.PURE_WHITE, label: 'WHITE' })
]);

export const OPERATOR_GROUND_MODE_IDS = Object.freeze(
  OPERATOR_GROUND_CHOICES.map((choice) => choice.id)
);

let pendingMode = null;

function choiceFor(modeId) {
  return OPERATOR_GROUND_CHOICES.find((choice) => choice.id === modeId) || null;
}

function operatorSafeLimitation(text) {
  const raw = String(text || '').trim();
  if (!raw) return '';
  if (/https?:\/\//i.test(raw)) return '';
  if (/[?&](?:SERVICE|REQUEST|LAYERS|BBOX|WIDTH|HEIGHT|STYLES|FORMAT)=/i.test(raw)) return '';
  if (/\b(?:layerId|layer id)\b/i.test(raw)) return '';
  return raw.replace(/\s+/g, ' ').slice(0, 160);
}

export function formatOperatorGroundStatus(snapshot = {}, options = {}) {
  const pending = options.pendingMode || null;
  const switching = Boolean(pending && pending !== snapshot.currentMode);
  const applying = snapshot.applyState === GROUND_APPLY_STATE.APPLYING || switching;
  const modeId = applying && pending
    ? pending
    : (snapshot.currentMode || GROUND_MODE.AUTHORED_WEBMAP);
  const choice = choiceFor(modeId);
  const label = choice?.label || snapshot.label || modeId;
  const listed = (options.modes || []).find((item) => item.id === modeId);
  const enabled = listed ? listed.enabled !== false : true;
  const limitation = operatorSafeLimitation(listed?.limitation || snapshot.error);

  if (modeId === GROUND_MODE.NEARMAP && applying) {
    return 'NEARMAP · CURRENT GROUND · APPLYING';
  }

  if (enabled === false) {
    return limitation ? `${label} · UNAVAILABLE · ${limitation}` : `${label} · UNAVAILABLE`;
  }

  if (modeId === GROUND_MODE.NEARMAP) {
    if (snapshot.currentMode === GROUND_MODE.NEARMAP && snapshot.displayConfirmed === true) {
      return 'NEARMAP · CURRENT GROUND · DISPLAY CONFIRMED';
    }
    return 'NEARMAP · CURRENT GROUND · DISPLAY NOT CONFIRMED';
  }

  if (applying) return `${label} · APPLYING`;
  return label;
}

export function renderOperatorGroundControl() {
  const snapshot = getGroundSnapshot();
  const current = snapshot.currentMode || GROUND_MODE.AUTHORED_WEBMAP;
  const status = formatOperatorGroundStatus(snapshot, {
    pendingMode,
    modes: listGroundModes()
  });
  return `
    <div class="iqai-v2-operator-ground" data-iqai-operator-ground hidden>
      <label class="iqai-v2-operator-ground__label" for="iqai-v2-operator-ground-select">GROUND</label>
      <select
        id="iqai-v2-operator-ground-select"
        class="iqai-v2-operator-ground__select"
        data-iqai-operator-ground-select
        aria-label="Ground"
      >
        ${OPERATOR_GROUND_CHOICES.map((choice) => `
          <option value="${choice.id}" ${choice.id === current ? 'selected' : ''}>${choice.label}</option>
        `).join('')}
      </select>
      <p class="iqai-v2-operator-ground__status" data-iqai-operator-ground-status>${status}</p>
    </div>
  `;
}

export function paintOperatorGroundControl(root, snapshot = getGroundSnapshot()) {
  const host = root.querySelector('[data-iqai-operator-ground]');
  if (!host) return;
  const select = host.querySelector('[data-iqai-operator-ground-select]');
  const status = host.querySelector('[data-iqai-operator-ground-status]');
  const applying = snapshot.applyState === GROUND_APPLY_STATE.APPLYING;
  const selectedId = pendingMode || snapshot.currentMode || GROUND_MODE.AUTHORED_WEBMAP;
  if (select) {
    if (select.value !== selectedId) select.value = selectedId;
    select.disabled = applying || Boolean(pendingMode);
  }
  if (status) {
    status.textContent = formatOperatorGroundStatus(snapshot, {
      pendingMode,
      modes: listGroundModes()
    });
  }
}

export function bindOperatorGroundControl(root, handlers = {}) {
  const onChange = (event) => {
    const select = event.target.closest('[data-iqai-operator-ground-select]');
    if (!select || !root.contains(select)) return;
    const modeId = select.value;
    pendingMode = modeId;
    paintOperatorGroundControl(root);
    const apply = typeof handlers.onChange === 'function'
      ? handlers.onChange(modeId)
      : setGroundMode(modeId);
    void Promise.resolve(apply).catch(() => {}).finally(() => {
      pendingMode = null;
      paintOperatorGroundControl(root);
    });
  };
  root.addEventListener('change', onChange);
  return () => root.removeEventListener('change', onChange);
}
