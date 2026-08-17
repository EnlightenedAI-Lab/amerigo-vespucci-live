import { SHELL_SLOTS } from './layout-registry.js';

export function renderMapStage() {
  const { id, slot } = SHELL_SLOTS.mapStage;
  return `
    <main id="${id}" class="iqai-v2-stage" data-iqai-slot="${slot}" aria-label="Map stage">
      <div class="iqai-v2-stage__well" data-iqai-reserve="map" data-iqai-map-state="INITIALIZING">
        <div class="iqai-v2-map-host" data-iqai-map-host></div>
        <div class="iqai-v2-stage__grid" aria-hidden="true"></div>
        <div class="iqai-v2-stage__placeholder" data-iqai-map-placeholder>
          <p class="iqai-v2-stage__kicker">MAP STAGE</p>
          <h1 class="iqai-v2-stage__title">Initializing map foundation</h1>
          <p class="iqai-v2-stage__state">INITIALIZING</p>
          <p class="iqai-v2-stage__note">Loading the authored Montréal WebMap. The shell stays available if the map cannot load.</p>
        </div>
        <div class="iqai-v2-stage__error" data-iqai-map-error hidden>
          <p class="iqai-v2-stage__kicker">MAP STAGE</p>
          <h1 class="iqai-v2-stage__title">Map foundation failed</h1>
          <p class="iqai-v2-stage__state">ERROR</p>
          <p class="iqai-v2-stage__note" data-iqai-map-error-message></p>
        </div>
        <div class="iqai-v2-map-nav" data-iqai-map-nav hidden></div>
        <div class="iqai-v2-imagery-dock" data-iqai-imagery-dock hidden></div>
      </div>
    </main>
  `;
}

export function applyMapFoundationToStage(root, snapshot) {
  const well = root.querySelector('.iqai-v2-stage__well');
  const placeholder = root.querySelector('[data-iqai-map-placeholder]');
  const errorPanel = root.querySelector('[data-iqai-map-error]');
  const errorMessage = root.querySelector('[data-iqai-map-error-message]');
  const nav = root.querySelector('[data-iqai-map-nav]');
  if (!well) return;

  well.dataset.iqaiMapState = snapshot.state;
  well.classList.toggle('is-map-ready', snapshot.state === 'READY');
  well.classList.toggle('is-map-error', snapshot.state === 'ERROR');

  if (placeholder) {
    placeholder.hidden = snapshot.state !== 'INITIALIZING';
  }
  if (errorPanel) {
    errorPanel.hidden = snapshot.state !== 'ERROR';
  }
  if (errorMessage && snapshot.state === 'ERROR') {
    errorMessage.textContent = snapshot.error || 'Map failed to load.';
  }
  if (nav) {
    nav.hidden = snapshot.state !== 'READY';
  }
}
