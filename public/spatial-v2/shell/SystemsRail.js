/**
 * Structural systems rail. Layout slot remains capability-rail.
 * Reserved PRIMARY_CAPABILITY_SLOTS stay present; they are not engines.
 */

import { PLUGIN_SLOTS, PRIMARY_CAPABILITY_SLOTS, SHELL_SLOTS } from './layout-registry.js';
import { CHASSIS_SYSTEMS } from '../bootstrap/chassis-catalog.js';

const GROUPS = Object.freeze([
  Object.freeze({ id: 'SESSION', label: 'SESSION' }),
  Object.freeze({ id: 'SPATIAL', label: 'SPATIAL' }),
  Object.freeze({ id: 'WORK', label: 'WORK' }),
  Object.freeze({ id: 'EVIDENCE', label: 'EVIDENCE' })
]);

function systemButton(item) {
  const views = item.id === 'view'
    ? `
      <div class="iqai-v2-system__views" data-iqai-tool-host="rail-views">
        <button type="button" data-iqai-view="MAP" data-iqai-capability-dispatch="view.select" aria-pressed="true">MAP</button>
        <button type="button" data-iqai-view="STREET 360" data-iqai-capability-dispatch="view.select">STREET 360</button>
        <button type="button" data-iqai-view="3D VISUAL" data-iqai-capability-dispatch="view.select">3D VISUAL</button>
        <button type="button" data-iqai-view="3D ANALYZE" data-iqai-capability-dispatch="view.select">3D ANALYZE</button>
      </div>
    `
    : '';
  return `
    <button
      type="button"
      class="iqai-v2-system"
      data-iqai-system="${item.id}"
      data-iqai-capability-dispatch="chassis.set-active-system"
      data-iqai-migration="${item.migrationState}"
    >
      <span class="iqai-v2-system__label">${item.label}</span>
      <span class="iqai-v2-system__state">${item.migrationState}</span>
    </button>
    ${views}
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
    <nav id="${id}" class="iqai-v2-launcher" data-iqai-slot="${slot}" aria-label="Spatial operating systems">
      <p class="iqai-v2-launcher__kicker">SYSTEMS</p>
      <p class="iqai-v2-launcher__edition">PLATFORM CHASSIS V1</p>
      ${GROUPS.map((group, index) => `
        <div class="iqai-v2-family${index === 0 ? ' is-open' : ''}" data-iqai-family="${group.id}">
          <button type="button" class="iqai-v2-family__toggle" data-iqai-family-toggle="${group.id}" aria-expanded="${index === 0 ? 'true' : 'false'}">
            <span>${group.label}</span>
            <span>Registered hosts</span>
          </button>
          <div class="iqai-v2-family__tools">
            ${CHASSIS_SYSTEMS.filter((item) => item.group === group.id).map(systemButton).join('')}
          </div>
        </div>
      `).join('')}
      <div class="iqai-v2-family" data-iqai-family="reserved">
        <button type="button" class="iqai-v2-family__toggle" data-iqai-family-toggle="reserved" aria-expanded="false">
          <span>RESERVED SLOTS</span>
          <span>Not migrated engines</span>
        </button>
        <div class="iqai-v2-family__tools">
          <div class="iqai-v2-rail__primary" data-iqai-rail-group="primary">
            ${PRIMARY_CAPABILITY_SLOTS.map(reservedCapability).join('')}
          </div>
          <div class="iqai-v2-rail__plugins" data-iqai-plugin-host="capability-rail" data-iqai-rail-group="plugins">
            ${PLUGIN_SLOTS.map(reservedPlugin).join('')}
          </div>
        </div>
      </div>
    </nav>
  `;
}

export function paintSystemsRail(root, { activeSystem, activeViewId } = {}) {
  const rail = root.querySelector('[data-iqai-slot="capability-rail"]');
  if (!rail) return;
  rail.querySelectorAll('[data-iqai-system]').forEach((node) => {
    const selected = node.getAttribute('data-iqai-system') === activeSystem;
    node.classList.toggle('is-selected', selected);
  });
  rail.querySelectorAll('[data-iqai-view]').forEach((node) => {
    const selected = node.getAttribute('data-iqai-view') === activeViewId;
    node.setAttribute('aria-pressed', selected ? 'true' : 'false');
  });
}

export function bindSystemsRail(root, { onFamilyToggle } = {}) {
  const rail = root.querySelector('[data-iqai-slot="capability-rail"]');
  if (!rail) return () => {};
  const onClick = (event) => {
    const toggle = event.target.closest('[data-iqai-family-toggle]');
    if (!toggle || !rail.contains(toggle)) return;
    const familyId = toggle.getAttribute('data-iqai-family-toggle');
    rail.querySelectorAll('[data-iqai-family]').forEach((family) => {
      const open = family.getAttribute('data-iqai-family') === familyId
        ? !family.classList.contains('is-open')
        : false;
      family.classList.toggle('is-open', open);
      const button = family.querySelector('[data-iqai-family-toggle]');
      if (button) button.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
    if (typeof onFamilyToggle === 'function') onFamilyToggle(familyId);
  };
  rail.addEventListener('click', onClick);
  return () => rail.removeEventListener('click', onClick);
}
