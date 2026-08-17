import { INSPECTOR_REGIONS, SHELL_SLOTS } from './layout-registry.js';

function inspectorRegion(region) {
  return `
    <section
      id="${region.id}"
      class="iqai-v2-region"
      data-iqai-slot="${region.slot}"
    >
      <header class="iqai-v2-region__head">
        <h2 class="iqai-v2-region__title">${region.title}</h2>
        <span class="iqai-v2-region__state">${region.stateLabel}</span>
      </header>
      <div class="iqai-v2-region__body">${region.body}</div>
    </section>
  `;
}

export function renderContextInspector() {
  const { id, slot } = SHELL_SLOTS.contextInspector;
  return `
    <aside id="${id}" class="iqai-v2-inspector" data-iqai-slot="${slot}" aria-label="Context and evidence">
      ${INSPECTOR_REGIONS.map(inspectorRegion).join('')}
    </aside>
  `;
}

export function setInspectorRegion(root, slot, { stateLabel, body } = {}) {
  const region = root.querySelector(`[data-iqai-slot="${slot}"]`);
  if (!region) return;
  const state = region.querySelector('.iqai-v2-region__state');
  const bodyEl = region.querySelector('.iqai-v2-region__body');
  if (state && stateLabel != null) state.textContent = stateLabel;
  if (bodyEl && body != null) bodyEl.textContent = body;
}
