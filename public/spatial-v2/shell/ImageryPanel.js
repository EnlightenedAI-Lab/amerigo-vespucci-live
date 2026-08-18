import {
  DATE_KIND,
  DISPLAY_STATE,
  GROUND_APPLY_STATE,
  GROUND_MODE
} from '../imagery/imagery-contract.js';
import {
  getGroundReceipt,
  getGroundSnapshot,
  initGroundController,
  listGroundModes,
  setGroundMode,
  subscribeGroundController
} from '../imagery/ground-controller.js';
import {
  activateObservation,
  deactivateObservation,
  discoverImageryTime,
  getTimeEngineSnapshot,
  initTimeEngine,
  nextObservation,
  previousObservation,
  setTimeEngineOptions,
  subscribeTimeEngine
} from '../imagery/time-engine.js';

function modeButton(mode, currentMode, applyState) {
  const selected = mode.id === currentMode;
  const applying = applyState === GROUND_APPLY_STATE.APPLYING && selected;
  const disabled = !mode.enabled || applyState === GROUND_APPLY_STATE.APPLYING;
  return `
    <button
      type="button"
      class="iqai-v2-imagery-mode${selected ? ' is-selected' : ''}${mode.enabled ? '' : ' is-disabled'}"
      data-iqai-ground-mode="${mode.id}"
      ${disabled ? 'disabled' : ''}
      ${selected ? 'aria-current="true"' : 'aria-current="false"'}
      title="${mode.limitation || mode.label}"
    >
      <span class="iqai-v2-imagery-mode__label">${mode.label}</span>
      <span class="iqai-v2-imagery-mode__gate">${mode.enabled ? (applying ? 'APPLYING' : (selected ? 'ACTIVE' : 'READY')) : 'NOT THIS MILESTONE'}</span>
    </button>
  `;
}

function renderTimeMachine(snapshot = getTimeEngineSnapshot()) {
  return `
    <p class="iqai-v2-imagery-panel__kicker">TIME MACHINE</p>
    <div class="iqai-v2-imagery-time__fields">
      <label>AOI
        <select data-iqai-time-aoi>
          <option value="viewport" ${snapshot.aoiMode === 'viewport' ? 'selected' : ''}>VIEWPORT</option>
          <option value="point" ${snapshot.aoiMode === 'point' ? 'selected' : ''}>POINT</option>
        </select>
      </label>
      <label>REQUESTED DATE
        <input type="date" data-iqai-time-date value="${snapshot.requestedDate || ''}">
      </label>
      <label>PROVIDER
        <select data-iqai-time-provider>
          <option value="all" ${snapshot.providerFilter === 'all' ? 'selected' : ''}>ALL</option>
          <option value="wayback" ${snapshot.providerFilter === 'wayback' ? 'selected' : ''}>WAYBACK</option>
          <option value="nearmap" ${snapshot.providerFilter === 'nearmap' ? 'selected' : ''}>NEARMAP</option>
        </select>
      </label>
    </div>
    <div class="iqai-v2-imagery-time__actions">
      <button type="button" class="iqai-v2-imagery-btn" data-iqai-time-action="discover">DISCOVER</button>
      <button type="button" class="iqai-v2-imagery-btn" data-iqai-time-action="activate">ACTIVATE</button>
      <button type="button" class="iqai-v2-imagery-btn" data-iqai-time-action="deactivate">DEACTIVATE</button>
      <button type="button" class="iqai-v2-imagery-btn" data-iqai-time-action="previous">PREV</button>
      <button type="button" class="iqai-v2-imagery-btn" data-iqai-time-action="next">NEXT</button>
    </div>
    <p class="iqai-v2-imagery-time__readout" data-iqai-time-readout></p>
    <p class="iqai-v2-imagery-panel__note" data-iqai-time-note></p>
  `;
}

function timeReadout(snapshot) {
  const selected = snapshot.selected;
  const lines = [
    `State: ${snapshot.engineState}`,
    `Wayback: ${snapshot.entitlements.wayback}`,
    `Nearmap: ${snapshot.entitlements.nearmap}`,
    `Count: ${snapshot.observations.length}`,
    `Match: ${snapshot.matchKind}`,
    `Delta days: ${snapshot.deltaDays == null ? 'null' : snapshot.deltaDays}`,
    selected ? `Selected: ${selected.productName || selected.id}` : 'Selected: none',
    selected ? `matchDate: ${selected.matchDate || 'null'}` : null,
    selected ? `releaseDate: ${selected.releaseDate || 'null'}` : null,
    selected ? `acquisitionDate: ${selected.acquisitionDate || 'null'}` : null,
    selected ? `firstPublicDate: ${selected.firstPublicDate || 'null'}` : null,
    selected ? `dateKindUsed: ${selected.dateKindUsed}` : null,
    snapshot.activeId ? `Activated: ${snapshot.activeId}` : 'Activated: none',
    `Attached: ${snapshot.layerAttached ? 'yes' : 'no'}`,
    `Loaded: ${snapshot.layerLoaded ? 'yes' : 'no'}`,
    `LayerView: ${snapshot.layerViewReady ? 'yes' : 'no'}`,
    `Network: ${snapshot.networkConfirmed ? 'yes' : 'no'}`,
    `Display: ${snapshot.displayState || DISPLAY_STATE.NONE}`,
    snapshot.displayConfirmed ? 'DISPLAY_CONFIRMED' : 'IMAGE SELECTED — DISPLAY NOT CONFIRMED',
    snapshot.error || snapshot.limitation || null
  ];
  return lines.filter(Boolean).join('\n');
}

export function renderImageryPanel() {
  const modes = listGroundModes();
  const snapshot = getGroundSnapshot();
  return `
    <section class="iqai-v2-imagery-panel" data-iqai-imagery-panel aria-label="Imagery ground">
      <header class="iqai-v2-imagery-panel__head">
        <h2 class="iqai-v2-imagery-panel__title">IMAGERY</h2>
        <span class="iqai-v2-imagery-panel__state" data-iqai-imagery-ground-state>${snapshot.applyState || GROUND_APPLY_STATE.IDLE}</span>
      </header>
      <p class="iqai-v2-imagery-panel__kicker">GROUND</p>
      <div class="iqai-v2-imagery-modes" data-iqai-ground-modes>
        ${modes.map((mode) => modeButton(mode, snapshot.currentMode || GROUND_MODE.AUTHORED_WEBMAP, snapshot.applyState)).join('')}
      </div>
      <p class="iqai-v2-imagery-panel__note" data-iqai-imagery-ground-note></p>
      <div class="iqai-v2-imagery-time" data-iqai-imagery-time-host>
        ${renderTimeMachine()}
      </div>
    </section>
  `;
}

function noteFor(snapshot) {
  const mode = listGroundModes().find((item) => item.id === snapshot.currentMode);
  if (snapshot.error) return snapshot.error;
  const observation = snapshot.receipt?.observation;
  const parts = [
    snapshot.label || mode?.label || snapshot.currentMode,
    observation?.limitation || mode?.limitation || ''
  ].filter(Boolean);
  return parts.join(' — ');
}

export function paintImageryGround(root, snapshot = getGroundSnapshot()) {
  const panel = root.querySelector('[data-iqai-imagery-panel]');
  if (!panel) return;
  const stateEl = panel.querySelector('[data-iqai-imagery-ground-state]');
  const noteEl = panel.querySelector('[data-iqai-imagery-ground-note]');
  const host = panel.querySelector('[data-iqai-ground-modes]');
  if (stateEl) stateEl.textContent = snapshot.applyState || GROUND_APPLY_STATE.IDLE;
  if (noteEl) noteEl.textContent = noteFor(snapshot);
  if (host) {
    host.innerHTML = listGroundModes()
      .map((mode) => modeButton(mode, snapshot.currentMode, snapshot.applyState))
      .join('');
  }
}

export function paintImageryTime(root, snapshot = getTimeEngineSnapshot()) {
  const readout = root.querySelector('[data-iqai-time-readout]');
  const note = root.querySelector('[data-iqai-time-note]');
  const date = root.querySelector('[data-iqai-time-date]');
  const aoi = root.querySelector('[data-iqai-time-aoi]');
  const provider = root.querySelector('[data-iqai-time-provider]');
  if (readout) readout.textContent = timeReadout(snapshot);
  if (note) note.textContent = snapshot.selected?.limitation || snapshot.limitation || '';
  if (date && snapshot.requestedDate && date.value !== snapshot.requestedDate) date.value = snapshot.requestedDate;
  if (aoi) aoi.value = snapshot.aoiMode;
  if (provider) provider.value = snapshot.providerFilter;
}

function readTimeOptions(root) {
  return {
    aoiMode: root.querySelector('[data-iqai-time-aoi]')?.value,
    requestedDate: root.querySelector('[data-iqai-time-date]')?.value,
    providerFilter: root.querySelector('[data-iqai-time-provider]')?.value
  };
}

export function bindImageryPanel(root) {
  const dock = root.querySelector('[data-iqai-imagery-dock]');
  if (!dock) return () => {};

  dock.innerHTML = renderImageryPanel();
  paintImageryGround(root);
  paintImageryTime(root);

  const onClick = (event) => {
    const groundButton = event.target.closest('[data-iqai-ground-mode]');
    if (groundButton && !groundButton.disabled) {
      const modeId = groundButton.getAttribute('data-iqai-ground-mode');
      if (modeId) void setGroundMode(modeId).catch(() => {});
      return;
    }
    const actionButton = event.target.closest('[data-iqai-time-action]');
    if (!actionButton) return;
    const action = actionButton.getAttribute('data-iqai-time-action');
    const options = readTimeOptions(root);
    if (action === 'discover') void discoverImageryTime(options).catch(() => {});
    if (action === 'activate') void activateObservation().catch(() => {});
    if (action === 'deactivate') void deactivateObservation().catch(() => {});
    if (action === 'previous') void previousObservation().catch(() => {});
    if (action === 'next') void nextObservation().catch(() => {});
  };
  const onChange = (event) => {
    if (!event.target.closest('[data-iqai-time-aoi], [data-iqai-time-date], [data-iqai-time-provider]')) return;
    setTimeEngineOptions(readTimeOptions(root));
  };
  dock.addEventListener('click', onClick);
  dock.addEventListener('change', onChange);

  const unsubGround = subscribeGroundController((snapshot) => {
    paintImageryGround(root, snapshot);
  });
  const unsubTime = subscribeTimeEngine((snapshot) => {
    paintImageryTime(root, snapshot);
  });

  return () => {
    dock.removeEventListener('click', onClick);
    dock.removeEventListener('change', onChange);
    unsubGround();
    unsubTime();
  };
}

export function setImageryDockOpen(root, open) {
  const dock = root.querySelector('[data-iqai-imagery-dock]');
  if (!dock) return;
  dock.hidden = !open;
}

export function isImageryDockOpen(root) {
  const dock = root.querySelector('[data-iqai-imagery-dock]');
  return Boolean(dock && !dock.hidden);
}

export async function bootImageryGround(root) {
  await initGroundController();
  await initTimeEngine().catch(() => {});
  bindImageryPanel(root);
  return getGroundReceipt();
}
