import { PRIMARY_CAPABILITY_SLOTS, PLUGIN_SLOTS, SHELL_SLOTS } from './layout-registry.js';

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

export function renderCapabilityRail() {
  const { id, slot } = SHELL_SLOTS.capabilityRail;
  return `
    <nav id="${id}" class="iqai-v2-rail" data-iqai-slot="${slot}" aria-label="Capabilities">
      <div class="iqai-v2-rail__section">
        <h2 class="iqai-v2-rail__heading">CAPABILITIES</h2>
        <div class="iqai-v2-rail__primary" data-iqai-rail-group="primary">
          ${PRIMARY_CAPABILITY_SLOTS.map((item, index) => capabilityButton(item, { selected: index === 0 })).join('')}
        </div>
      </div>
      <div class="iqai-v2-rail__section iqai-v2-rail__section--plugins">
        <h2 class="iqai-v2-rail__heading">PLUGINS</h2>
        <div
          class="iqai-v2-rail__plugins"
          data-iqai-plugin-host="capability-rail"
          data-iqai-rail-group="plugins"
        >
          ${PLUGIN_SLOTS.map(pluginButton).join('')}
        </div>
      </div>
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

export function bindCapabilityRail(root, handlers = {}) {
  const rail = root.querySelector('[data-iqai-slot="capability-rail"]');
  if (!rail) return;

  rail.addEventListener('click', (event) => {
    const button = event.target.closest('[data-iqai-capability], [data-iqai-plugin]');
    if (!button || !rail.contains(button)) return;

    rail.querySelectorAll('[data-iqai-capability], [data-iqai-plugin]').forEach((node) => {
      node.classList.toggle('is-selected', node === button);
      node.setAttribute('aria-current', node === button ? 'true' : 'false');
    });

    const capabilityId = button.getAttribute('data-iqai-capability');
    const pluginId = button.getAttribute('data-iqai-plugin');
    if (capabilityId && typeof handlers.onCapability === 'function') {
      handlers.onCapability(capabilityId);
    }
    if (pluginId && typeof handlers.onPlugin === 'function') {
      handlers.onPlugin(pluginId);
    }
  });
}
