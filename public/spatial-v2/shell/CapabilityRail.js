import { PRIMARY_CAPABILITY_SLOTS, PLUGIN_SLOTS, SHELL_SLOTS } from './layout-registry.js';

const TASK_FAMILIES = Object.freeze([
  Object.freeze({
    id: 'look',
    label: 'LOOK',
    hint: 'Map, imagery, layers',
    capabilityIds: Object.freeze(['map']),
    pluginIds: Object.freeze(['imagery', 'data-layers'])
  }),
  Object.freeze({
    id: 'ask',
    label: 'INVESTIGATE',
    hint: 'Point, intelligence, vision, documents',
    capabilityIds: Object.freeze(['point', 'intelligence', 'vision']),
    pluginIds: Object.freeze(['documents'])
  }),
  Object.freeze({
    id: 'build',
    label: 'BUILD',
    hint: 'Create maps and instruments',
    capabilityIds: Object.freeze(['build']),
    pluginIds: Object.freeze([])
  })
]);

function capabilityButton(item, { selected = false } = {}) {
  const slotAttr = item.slot ? ` data-iqai-slot="${item.slot}"` : '';
  const idAttr = item.elementId ? ` id="${item.elementId}"` : '';
  const current = selected ? 'true' : 'false';
  const selectedClass = selected ? ' is-selected' : '';
  const description = item.description
    ? `<span class="iqai-v2-cap__desc">${item.description}</span>`
    : '';

  return `
    <button
      type="button"
      class="iqai-v2-cap${selectedClass}"
      data-iqai-capability="${item.id}"
      aria-current="${current}"
      ${idAttr}${slotAttr}
    >
      <span class="iqai-v2-cap__short">${item.shortLabel}</span>
      <span class="iqai-v2-cap__display">${item.displayLabel}</span>
      ${description}
      <span class="iqai-v2-cap__state">${item.stateLabel}</span>
    </button>
  `;
}

function pluginButton(item) {
  return `
    <button
      type="button"
      class="iqai-v2-plugin"
      data-iqai-plugin="${item.id}"
      aria-current="false"
    >
      <span class="iqai-v2-plugin__label">${item.displayLabel}</span>
      <span class="iqai-v2-plugin__state">${item.stateLabel}</span>
    </button>
  `;
}

function familyOf(capabilityId) {
  return TASK_FAMILIES.find((family) => (
    family.capabilityIds.includes(capabilityId) || family.pluginIds.includes(capabilityId)
  ))?.id || 'look';
}

export function renderCapabilityRail() {
  const { id, slot } = SHELL_SLOTS.capabilityRail;
  return `
    <nav id="${id}" class="iqai-v2-launcher" data-iqai-slot="${slot}" aria-label="Task families">
      <p class="iqai-v2-launcher__kicker">TASK</p>
      ${TASK_FAMILIES.map((family, index) => {
        const capabilities = PRIMARY_CAPABILITY_SLOTS.filter((item) => family.capabilityIds.includes(item.id));
        const plugins = PLUGIN_SLOTS.filter((item) => family.pluginIds.includes(item.id));
        return `
          <div class="iqai-v2-family${index === 0 ? ' is-open' : ''}" data-iqai-family="${family.id}">
            <button
              type="button"
              class="iqai-v2-family__toggle"
              data-iqai-family-toggle="${family.id}"
              aria-expanded="${index === 0 ? 'true' : 'false'}"
            >
              <span>${family.label}</span>
              <span>${family.hint}</span>
            </button>
            <div class="iqai-v2-family__tools">
              ${index === 0
                ? `<div class="iqai-v2-rail__primary" data-iqai-rail-group="primary">${capabilities.map((item, capIndex) => capabilityButton(item, { selected: capIndex === 0 })).join('')}</div>`
                : capabilities.map((item) => capabilityButton(item)).join('')}
              ${family.id === 'look'
                ? `<div class="iqai-v2-rail__plugins" data-iqai-plugin-host="capability-rail" data-iqai-rail-group="plugins">${plugins.map(pluginButton).join('')}</div>`
                : plugins.map(pluginButton).join('')}
            </div>
          </div>
        `;
      }).join('')}
    </nav>
  `;
}

export function setCapabilityStateLabel(root, capabilityId, stateLabel) {
  const state = root.querySelector(`[data-iqai-capability="${capabilityId}"] .iqai-v2-cap__state`);
  if (state) state.textContent = stateLabel;
}

export function setPluginStateLabel(root, pluginId, stateLabel) {
  const state = root.querySelector(`[data-iqai-plugin="${pluginId}"] .iqai-v2-plugin__state`);
  if (state) state.textContent = stateLabel;
}

export function paintCapabilitySelection(root, activeCapability) {
  const rail = root.querySelector('[data-iqai-slot="capability-rail"]');
  if (!rail) return;
  rail.querySelectorAll('[data-iqai-capability], [data-iqai-plugin]').forEach((node) => {
    const id = node.getAttribute('data-iqai-capability') || node.getAttribute('data-iqai-plugin');
    const selected = id === activeCapability;
    node.classList.toggle('is-selected', selected);
    node.setAttribute('aria-current', selected ? 'true' : 'false');
  });
  const openFamily = familyOf(activeCapability);
  rail.querySelectorAll('[data-iqai-family]').forEach((family) => {
    const open = family.getAttribute('data-iqai-family') === openFamily;
    family.classList.toggle('is-open', open);
    const toggle = family.querySelector('[data-iqai-family-toggle]');
    if (toggle) toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
  });
}

export function bindCapabilityRail(root, handlers = {}) {
  const rail = root.querySelector('[data-iqai-slot="capability-rail"]');
  if (!rail) return;

  rail.addEventListener('click', (event) => {
    const familyToggle = event.target.closest('[data-iqai-family-toggle]');
    if (familyToggle && rail.contains(familyToggle)) {
      const familyId = familyToggle.getAttribute('data-iqai-family-toggle');
      rail.querySelectorAll('[data-iqai-family]').forEach((family) => {
        const open = family.getAttribute('data-iqai-family') === familyId
          ? !family.classList.contains('is-open')
          : false;
        family.classList.toggle('is-open', open);
        const toggle = family.querySelector('[data-iqai-family-toggle]');
        if (toggle) toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      });
      return;
    }

    const button = event.target.closest('[data-iqai-capability], [data-iqai-plugin]');
    if (!button || !rail.contains(button)) return;

    const capabilityId = button.getAttribute('data-iqai-capability');
    const pluginId = button.getAttribute('data-iqai-plugin');
    paintCapabilitySelection(root, capabilityId || pluginId);
    if (capabilityId && typeof handlers.onCapability === 'function') {
      handlers.onCapability(capabilityId);
    }
    if (pluginId && typeof handlers.onPlugin === 'function') {
      handlers.onPlugin(pluginId);
    }
  });
}
