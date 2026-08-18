/**
 * PanelHost mounts registered panels and preserves presentation state.
 * It does not own queries, policy, or result truth.
 */

export function createPanelHost() {
  const presentation = new Map();
  return Object.freeze({
    setOpen(panelId, open) {
      presentation.set(panelId, { open: open === true });
    },
    isOpen(panelId) {
      return presentation.get(panelId)?.open === true;
    },
    snapshot() {
      return Object.freeze(Object.fromEntries([...presentation.entries()]));
    }
  });
}

export function renderPanelHost({ activeSystem, panels }) {
  const body = panels.map((panel) => `
    <section
      class="iqai-v2-panel"
      data-iqai-panel="${panel.id}"
      data-iqai-migration="${panel.migrationState}"
      ${panel.id === activeSystem ? '' : 'hidden'}
    >
      <header class="iqai-v2-panel__head">
        <h2>${panel.label}</h2>
        <span data-iqai-panel-state="${panel.id}">${panel.migrationState}</span>
      </header>
      <p>${panel.detail}</p>
    </section>
  `).join('');
  return `<div class="iqai-v2-panel-host" data-iqai-panel-host>${body}</div>`;
}
