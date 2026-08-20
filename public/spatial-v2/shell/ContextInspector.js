import { INSPECTOR_REGIONS, SHELL_SLOTS } from './layout-registry.js';

const SHEET_PANES = Object.freeze([
  Object.freeze({ slot: 'situation-slot', label: 'WORKFLOW' }),
  Object.freeze({ slot: 'selected-object-slot', label: 'OBJECT' }),
  Object.freeze({ slot: 'evidence-slot', label: 'EVIDENCE' }),
  Object.freeze({ slot: 'provenance-slot', label: 'SOURCE' }),
  Object.freeze({ slot: 'execution-receipt-slot', label: 'RESULT' })
]);

function inspectorRegion(region, active) {
  return `
    <section
      id="${region.id}"
      class="iqai-v2-region${active ? ' is-active' : ''}"
      data-iqai-slot="${region.slot}"
      ${active ? '' : 'hidden'}
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
    <aside id="${id}" class="iqai-v2-inspector" data-iqai-slot="${slot}" aria-label="Object / Evidence / Source / Result">
      <div class="iqai-v2-inspector__commands" data-iqai-observe-commands>
        <button type="button" class="iqai-v2-inspector__collapse" data-iqai-inspector-collapse aria-label="Collapse inspector">›</button>
        <button type="button" class="iqai-v2-focus-tool" data-iqai-woa aria-pressed="false" title="World Object Acquisition">WOA</button>
        <button type="button" class="iqai-v2-trace-tool" data-iqai-add-set title="Add acquired object to collected set">ADD TO SET</button>
        <button type="button" class="iqai-v2-trace-tool" data-iqai-export-csv title="Export collected set CSV">EXPORT CSV</button>
      </div>
      <div class="iqai-v2-sheet__tabs" role="tablist" aria-label="Intelligence panes">
        ${SHEET_PANES.map((pane, index) => `
          <button
            type="button"
            class="iqai-v2-sheet__tab${index === 0 ? ' is-active' : ''}"
            data-iqai-sheet-pane="${pane.slot}"
            role="tab"
            aria-selected="${index === 0 ? 'true' : 'false'}"
          >${pane.label}</button>
        `).join('')}
      </div>
      <div class="iqai-v2-sheet__panes">
        ${INSPECTOR_REGIONS.map((region, index) => inspectorRegion(region, index === 0)).join('')}
      </div>
    </aside>
  `;
}

export function setInspectorRegion(root, slot, { stateLabel, body, html } = {}) {
  const region = root.querySelector(`[data-iqai-slot="${slot}"]`);
  if (!region) return;
  const state = region.querySelector('.iqai-v2-region__state');
  const bodyEl = region.querySelector('.iqai-v2-region__body');
  if (state && stateLabel != null) state.textContent = stateLabel;
  if (!bodyEl) return;
  if (html) bodyEl.innerHTML = html;
  else if (body != null) bodyEl.textContent = body;
}

export function paintInspectorPane(root, slot) {
  const inspector = root.querySelector('[data-iqai-slot="context-inspector"]');
  if (!inspector) return;
  inspector.querySelectorAll('[data-iqai-sheet-pane]').forEach((tab) => {
    const active = tab.getAttribute('data-iqai-sheet-pane') === slot;
    tab.classList.toggle('is-active', active);
    tab.setAttribute('aria-selected', active ? 'true' : 'false');
  });
  inspector.querySelectorAll('.iqai-v2-region').forEach((region) => {
    const active = region.getAttribute('data-iqai-slot') === slot;
    region.classList.toggle('is-active', active);
    region.hidden = !active;
  });
}

export function bindContextInspector(root, handlers = {}) {
  const inspector = root.querySelector('[data-iqai-slot="context-inspector"]');
  if (!inspector) return () => {};
  const onClick = (event) => {
    const tab = event.target.closest('[data-iqai-sheet-pane]');
    if (!tab || !inspector.contains(tab)) return;
    const slot = tab.getAttribute('data-iqai-sheet-pane');
    paintInspectorPane(root, slot);
    handlers.onPane?.(slot);
  };
  inspector.addEventListener('click', onClick);
  return () => inspector.removeEventListener('click', onClick);
}
