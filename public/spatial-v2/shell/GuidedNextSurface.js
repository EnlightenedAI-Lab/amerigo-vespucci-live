/**
 * Compact Guided Next readout and control highlighting.
 * Does not open Camera Wall. Does not mutate CameraPose.
 */

import { subscribeAuthoredCameras } from '../map/authored-cameras.js';
import { subscribeSpatialFocus } from '../map/spatial-focus.js';
import {
  GUIDED_CONTROL,
  GUIDED_STATUS,
  getGuidedNextSnapshot,
  isGuidedNextEnabled,
  setGuidedNextEnabled,
  subscribeGuidedNext,
  bindGuidedNextProductListeners
} from '../camera/guided-next.js';

let boundRoot = null;
let boundChassis = null;

function controlSelector(control) {
  if (control === GUIDED_CONTROL.LOOK_AROUND) return '[data-iqai-camera-look-around]';
  if (control === GUIDED_CONTROL.FOCUS) return '.iqai-v2-focus-tool[data-iqai-drop-pin]';
  if (control === GUIDED_CONTROL.GENERATE_CAMERA_COVERAGE) return '[data-iqai-camera-coverage-generate]';
  if (control === GUIDED_CONTROL.VIEW_EXISTING_360) return '[data-iqai-visual-coverage-build]';
  if (control === GUIDED_CONTROL.PLACE_CAMERA) return '[data-iqai-camera-plan-place]';
  if (control === GUIDED_CONTROL.BUILD_RELEVANT_WALL) return '[data-iqai-camera-wall-build]';
  const match = String(control || '').match(/^CAMERA_0?(\d+)$/);
  if (match) return `[data-iqai-camera-wall-selector="${Number(match[1])}"]`;
  return null;
}

function clearHighlights(root) {
  root.querySelectorAll('[data-iqai-guided]').forEach((el) => {
    delete el.dataset.iqaiGuided;
    el.removeAttribute('data-iqai-guided-badge');
    el.querySelector('[data-iqai-guided-badge]')?.remove();
  });
}

function applyHighlight(root, control, kind, badgeText) {
  const selector = controlSelector(control);
  if (!selector) return 0;
  const el = root.querySelector(selector);
  if (!el) return 0;
  el.dataset.iqaiGuided = kind;
  el.setAttribute('data-iqai-guided-badge', badgeText);
  if (!el.querySelector('[data-iqai-guided-badge]')) {
    const badge = document.createElement('span');
    badge.setAttribute('data-iqai-guided-badge', '');
    badge.textContent = badgeText;
    el.insertBefore(badge, el.firstChild);
  } else {
    el.querySelector('[data-iqai-guided-badge]').textContent = badgeText;
  }
  return 1;
}

function paintPanel(el, snapshot) {
  if (!el) return;
  el.dataset.iqaiGuidedState = snapshot.state || '';
  el.dataset.iqaiGuidedStatus = snapshot.status || '';
  el.dataset.iqaiGuidedControl = snapshot.targetControl || '';
  el.dataset.iqaiGuidedEnabled = snapshot.enabled ? 'true' : 'false';
  const step = el.querySelector('[data-iqai-guided-step]');
  const action = el.querySelector('[data-iqai-guided-action]');
  const reason = el.querySelector('[data-iqai-guided-reason]');
  const toggle = el.querySelector('[data-iqai-guided-toggle]');
  if (step) {
    step.hidden = snapshot.status === GUIDED_STATUS.BLOCKED ? false : true;
    step.textContent = snapshot.enabled ? `STATE ${snapshot.state || ''}` : 'GUIDED OFF';
  }
  if (action) {
    const label = snapshot.label || 'GUIDED NEXT';
    action.textContent = String(label).replace('NEXT — ', 'NEXT → ').replace('BLOCKED — ', 'BLOCKED → ');
  }
  if (reason) {
    reason.hidden = !snapshot.blockedReason;
    reason.textContent = snapshot.blockedReason || '';
  }
  if (toggle) toggle.textContent = snapshot.enabled ? 'GUIDED ON' : 'GUIDED OFF';
}

export function refreshGuidedNext(root = boundRoot) {
  if (!root) return getGuidedNextSnapshot();
  const snapshot = getGuidedNextSnapshot({
    focusRef: boundChassis?.stateStore?.getSnapshot()?.activeFocus
  });
  const panel = root.querySelector('[data-iqai-guided-next]');
  paintPanel(panel, snapshot);
  clearHighlights(root);
  if (snapshot.enabled === true && snapshot.targetControl) {
    const kind = snapshot.status === GUIDED_STATUS.BLOCKED ? 'blocked' : 'next';
    const badge = snapshot.status === GUIDED_STATUS.BLOCKED ? 'BLOCKED' : 'NEXT';
    applyHighlight(root, snapshot.targetControl, kind, badge);
  }
  return snapshot;
}

export function renderGuidedNextSurface() {
  return `
    <aside class="iqai-v2-guided-next" data-iqai-guided-next aria-label="Camera guided next">
      <p data-iqai-guided-action>NEXT → CHOOSE TARGET</p>
      <p data-iqai-guided-step hidden>STATE TARGET_REQUIRED</p>
      <p data-iqai-guided-reason hidden></p>
      <button type="button" data-iqai-guided-toggle>GUIDED ON</button>
    </aside>
  `;
}

export function bindGuidedNextSurface(root, options = {}) {
  const well = root?.querySelector('.iqai-v2-stage__well') || root;
  if (!well) return null;
  let el = well.querySelector('[data-iqai-guided-next]');
  if (!el) {
    well.insertAdjacentHTML('beforeend', renderGuidedNextSurface());
    el = well.querySelector('[data-iqai-guided-next]');
  }
  boundRoot = root;
  boundChassis = options.chassis || null;
  el.addEventListener('click', (event) => {
    if (!event.target.closest('[data-iqai-guided-toggle]')) return;
    event.preventDefault();
    setGuidedNextEnabled(!isGuidedNextEnabled());
    refreshGuidedNext(root);
  });
  const unsubProduct = bindGuidedNextProductListeners();
  const unsubGuided = subscribeGuidedNext(() => refreshGuidedNext(root));
  const unsubCameras = subscribeAuthoredCameras(() => refreshGuidedNext(root));
  const unsubFocus = subscribeSpatialFocus(() => refreshGuidedNext(root));
  const unsubWorld = typeof options.chassis?.stateStore?.subscribe === 'function'
    ? options.chassis.stateStore.subscribe(() => refreshGuidedNext(root))
    : () => {};
  refreshGuidedNext(root);
  return Object.freeze({
    snapshot: () => getGuidedNextSnapshot({
      focusRef: options.chassis?.stateStore?.getSnapshot()?.activeFocus
    }),
    refresh: () => refreshGuidedNext(root),
    element: el,
    dispose() {
      unsubProduct();
      unsubGuided();
      unsubCameras();
      unsubFocus();
      unsubWorld();
      if (boundRoot === root) {
        boundRoot = null;
        boundChassis = null;
      }
    }
  });
}
