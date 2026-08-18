import { SHELL_SLOTS } from './layout-registry.js';
import { renderOperatorGroundControl } from './OperatorGroundControl.js';

export function renderMapStage() {
  const { id, slot } = SHELL_SLOTS.mapStage;
  return `
    <main id="${id}" class="iqai-v2-stage" data-iqai-slot="${slot}" aria-label="Map stage">
      <div class="iqai-v2-stage__well" data-iqai-reserve="map" data-iqai-map-state="INITIALIZING">
        <div class="iqai-v2-map-host" data-iqai-map-host></div>
        <div
          class="iqai-v2-google-3d-stage"
          data-iqai-google-3d-stage
          aria-label="3D Visual"
          hidden
        ></div>
        <div
          class="iqai-v2-street-360-stage"
          data-iqai-street-360-stage
          aria-label="Street 360"
          hidden
        ></div>
        <div class="iqai-v2-stage__grid" aria-hidden="true"></div>
        <div class="iqai-v2-stage__placeholder" data-iqai-map-placeholder>
          <p class="iqai-v2-stage__kicker">MAP</p>
          <h1 class="iqai-v2-stage__title">Initializing map foundation</h1>
          <p class="iqai-v2-stage__state">INITIALIZING</p>
          <p class="iqai-v2-stage__note">Loading the authored Montréal WebMap. The shell stays available if the map cannot load.</p>
        </div>
        <div class="iqai-v2-stage__error" data-iqai-map-error hidden>
          <p class="iqai-v2-stage__kicker">MAP</p>
          <h1 class="iqai-v2-stage__title">Map foundation failed</h1>
          <p class="iqai-v2-stage__state">ERROR</p>
          <p class="iqai-v2-stage__note" data-iqai-map-error-message></p>
        </div>
        <div class="iqai-v2-map-nav" data-iqai-map-nav hidden></div>
        ${renderOperatorGroundControl()}
        <div class="iqai-v2-begin" data-iqai-begin>
          <p class="iqai-v2-begin__kicker">BEGIN</p>
          <p class="iqai-v2-begin__title">What do you want to know or do?</p>
          <p class="iqai-v2-begin__hint">Ask IQAI, or open Imagery from LOOK.</p>
        </div>
        <div class="iqai-v2-imagery-dock" data-iqai-imagery-dock hidden></div>
        <div class="iqai-v2-view-switcher" data-iqai-view-switcher>
          <span>VIEW</span>
          <button type="button" data-iqai-view="map" aria-pressed="true">MAP</button>
          <button type="button" data-iqai-view="street-360" aria-pressed="false">STREET 360</button>
          <button type="button" data-iqai-view="3d-visual" aria-pressed="false">3D VISUAL</button>
          <button type="button" data-iqai-view="3d-analyze" disabled aria-disabled="true">3D ANALYZE</button>
          <button type="button" data-iqai-drop-pin aria-pressed="false">DROP PIN</button>
        </div>
        <p class="iqai-v2-pointer-coords" data-iqai-pointer-coords hidden></p>
        <div class="iqai-v2-spatial-focus-receipt" data-iqai-spatial-focus-receipt hidden></div>
        <p class="iqai-v2-view-notice" data-iqai-view-notice hidden></p>
        <span data-iqai-street-360-date hidden></span>
        <div class="iqai-v2-google-3d-controls" data-iqai-google-3d-controls hidden>
          <div class="iqai-v2-google-3d-nav" data-iqai-google-3d-nav hidden>
            <span>NAV</span>
            <button type="button" data-iqai-google-3d-nav-action="tilt-minus">TILT -</button>
            <button type="button" data-iqai-google-3d-nav-action="tilt-plus">TILT +</button>
            <button type="button" data-iqai-google-3d-nav-action="rotate-left">ROTATE LEFT</button>
            <button type="button" data-iqai-google-3d-nav-action="rotate-right">ROTATE RIGHT</button>
            <button type="button" data-iqai-google-3d-nav-action="top">TOP</button>
            <button type="button" data-iqai-google-3d-nav-action="oblique">OBLIQUE</button>
            <button type="button" data-iqai-google-3d-nav-action="north">NORTH</button>
            <button type="button" data-iqai-google-3d-nav-action="fly">FLY TO POINT</button>
            <button type="button" data-iqai-google-3d-nav-action="orbit">ORBIT POINT</button>
            <button type="button" data-iqai-google-3d-nav-action="reset">RESET VIEW</button>
          </div>
          <div class="iqai-v2-google-3d-layers" data-iqai-google-3d-layers hidden>
            <span>LAYERS</span>
            <label>
              <input type="checkbox" data-iqai-google-3d-reference aria-label="REFERENCE">
              REFERENCE
            </label>
          </div>
        </div>
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
  const ground = root.querySelector('[data-iqai-operator-ground]');
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
  if (ground) {
    ground.hidden = snapshot.state !== 'READY';
  }
}
