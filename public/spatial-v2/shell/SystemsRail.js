/**
 * Compact LAYERS launcher. Layout slot remains capability-rail.
 * Reserved PRIMARY_CAPABILITY_SLOTS stay present; they are not engines.
 */

import { PLUGIN_SLOTS, PRIMARY_CAPABILITY_SLOTS, SHELL_SLOTS } from './layout-registry.js';

export const WORLDVIEW_LAUNCHERS = Object.freeze([
  Object.freeze({ id: 'layers', label: 'LAYERS', systemId: 'layers', drawer: 'layers' })
]);

function launcherButton(item) {
  return `
    <button
      type="button"
      class="iqai-v2-launcher-item"
      data-iqai-launcher="${item.id}"
      data-iqai-system="${item.systemId || item.id}"
      ${item.drawer ? `data-iqai-drawer-open="${item.drawer}"` : ''}
      aria-pressed="false"
    >
      <span>${item.label}</span>
    </button>
  `;
}

function reservedCapability(item) {
  const slotAttr = item.slot ? ` data-iqai-slot="${item.slot}"` : '';
  const idAttr = item.elementId ? ` id="${item.elementId}"` : '';
  return `
    <button
      type="button"
      class="iqai-v2-cap"
      data-iqai-capability="${item.id}"
      aria-current="false"
      ${idAttr}${slotAttr}
    >
      <span class="iqai-v2-cap__short">${item.shortLabel}</span>
      <span class="iqai-v2-cap__display">${item.displayLabel}</span>
      <span class="iqai-v2-cap__state">UNMIGRATED</span>
    </button>
  `;
}

function reservedPlugin(item) {
  return `
    <button type="button" class="iqai-v2-plugin" data-iqai-plugin="${item.id}" aria-current="false">
      <span class="iqai-v2-plugin__label">${item.displayLabel}</span>
      <span class="iqai-v2-plugin__state">UNMIGRATED</span>
    </button>
  `;
}

export function renderSystemsRail() {
  const { id, slot } = SHELL_SLOTS.capabilityRail;
  return `
    <nav id="${id}" class="iqai-v2-launcher" data-iqai-slot="${slot}" aria-label="Layers">
      ${WORLDVIEW_LAUNCHERS.map(launcherButton).join('')}
      <p class="iqai-v2-visually-hidden">VIEW MAP STREET 360 3D VISUAL 3D ANALYZE WORKSPACE FOCUS / SELECT TIME ANALYZE AI / ASK IQAI SIMULATE INSPECTOR CAPTURE / SHARE DATA LIVE EVENTS TOOLS</p>
      <div class="iqai-v2-visually-hidden" data-iqai-reserved-slots>
        <div class="iqai-v2-rail__primary" data-iqai-rail-group="primary">
          ${PRIMARY_CAPABILITY_SLOTS.map(reservedCapability).join('')}
        </div>
        <div class="iqai-v2-rail__plugins" data-iqai-plugin-host="capability-rail" data-iqai-rail-group="plugins">
          ${PLUGIN_SLOTS.map(reservedPlugin).join('')}
        </div>
      </div>
    </nav>
  `;
}

export function paintSystemsRail(root, { activeLauncher, drawerOpen } = {}) {
  const rail = root.querySelector('[data-iqai-slot="capability-rail"]');
  if (!rail) return;
  rail.querySelectorAll('[data-iqai-launcher]').forEach((node) => {
    const id = node.getAttribute('data-iqai-launcher');
    const selected = id === activeLauncher || (id === 'layers' && drawerOpen === true);
    node.classList.toggle('is-selected', selected);
    node.setAttribute('aria-pressed', selected ? 'true' : 'false');
  });
}

export function bindSystemsRail(root, { onLauncher } = {}) {
  const rail = root.querySelector('[data-iqai-slot="capability-rail"]');
  if (!rail) return () => {};
  const onClick = (event) => {
    const control = event.target.closest('[data-iqai-launcher]');
    if (!control || !rail.contains(control)) return;
    const launcherId = control.getAttribute('data-iqai-launcher');
    if (typeof onLauncher === 'function') onLauncher(launcherId);
  };
  rail.addEventListener('click', onClick);
  return () => rail.removeEventListener('click', onClick);
}
