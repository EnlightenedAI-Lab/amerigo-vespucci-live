import { EXPERIENCE_MODE, IMAGERY_VIEW } from './command-center-state.js';

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function sourceLabel(observation, ground) {
  if (observation?.providerId === 'esri-wayback') return 'Esri World Imagery Wayback';
  if (observation?.providerId === 'nearmap') return 'Nearmap';
  return observation?.productName || ground?.label || 'UNKNOWN';
}

function availabilityLabel({ time, mapState, observation }) {
  if (mapState === 'ERROR' || time?.engineState === 'ERROR') return 'NOT AVAILABLE';
  if (time?.engineState === 'APPLYING' || time?.engineState === 'DISCOVERING') return 'APPLYING';
  if (observation?.accessState) {
    return String(observation.accessState).replaceAll('_', ' ');
  }
  return mapState === 'READY' ? 'AVAILABLE' : 'RESERVED';
}

function resolutionLabel(observation) {
  return Number.isFinite(observation?.gsdMeters)
    ? `${observation.gsdMeters} m`
    : 'UNKNOWN';
}

function futureState(action, time, observation) {
  if (action !== 'ACQUIRE') return 'COMING LATER';
  if (!observation) return 'NOT AVAILABLE';
  if (
    time?.entitlements?.nearmap === 'entitlement-missing'
    && observation.providerId === 'nearmap'
  ) {
    return 'ENTITLEMENT REQUIRED';
  }
  return 'COMING LATER';
}

function modeButton(mode, current) {
  const label = mode === IMAGERY_VIEW.ALL ? 'ALL IMAGERY' : mode;
  return `
    <button
      type="button"
      class="iqai-v2-operator-imagery__mode${mode === current ? ' is-selected' : ''}"
      data-iqai-imagery-view="${mode}"
      aria-pressed="${mode === current ? 'true' : 'false'}"
    >${label}</button>
  `;
}

function observationList(time) {
  if (!time?.observations?.length) {
    return '<p class="iqai-v2-operator-imagery__empty">No observations discovered for this AOI and request.</p>';
  }
  return `
    <div class="iqai-v2-operator-imagery__observations" aria-label="Discovered imagery observations">
      ${time.observations.slice(0, 8).map((observation) => `
        <button
          type="button"
          class="iqai-v2-operator-imagery__observation${observation.id === time.selectedId ? ' is-selected' : ''}"
          data-iqai-observation-id="${escapeHtml(observation.id)}"
          aria-pressed="${observation.id === time.selectedId ? 'true' : 'false'}"
        >
          <span>${escapeHtml(observation.productName || observation.id)}</span>
          <span>${escapeHtml(observation.matchDate || observation.acquisitionDate || observation.releaseDate || 'DATE UNKNOWN')}</span>
        </button>
      `).join('')}
    </div>
  `;
}

function renderOperatorImagery({ state, ground, time, mapState }) {
  const selected = time?.selected || ground?.receipt?.observation || null;
  const active = time?.active || null;
  const canStep = Boolean(
    time?.observations?.length
    && time.engineState !== 'APPLYING'
    && time.engineState !== 'DISCOVERING'
  );
  const showHistory = state.imageryView === IMAGERY_VIEW.HISTORY;
  const showAll = state.imageryView === IMAGERY_VIEW.ALL;
  const availability = availabilityLabel({ time, mapState, observation: selected });
  const requested = time?.requestedDate || 'NONE';
  const capture = selected?.acquisitionDate || 'UNKNOWN';
  const release = selected?.releaseDate || 'UNKNOWN';
  const quality = selected?.limitation || time?.limitation || 'Quality metadata not reported.';
  const selectedLabel = selected?.productName || selected?.id || 'NO OBSERVATION SELECTED';
  const activeLabel = active?.productName || active?.id || 'NOT DISPLAYED';

  return `
    <div class="iqai-v2-operator-imagery" data-iqai-operator-imagery>
      <div class="iqai-v2-operator-imagery__modes" aria-label="Imagery views">
        ${Object.values(IMAGERY_VIEW).map((mode) => modeButton(mode, state.imageryView)).join('')}
      </div>
      <dl class="iqai-v2-operator-imagery__facts">
        <div><dt>REQUESTED</dt><dd>${escapeHtml(requested)}</dd></div>
        <div><dt>SELECTED</dt><dd>${escapeHtml(selectedLabel)}</dd></div>
        <div><dt>OBSERVED / DISPLAYED</dt><dd>${escapeHtml(activeLabel)}</dd></div>
        <div><dt>CAPTURE DATE</dt><dd>${escapeHtml(capture)}</dd></div>
        <div><dt>RELEASE DATE</dt><dd>${escapeHtml(release)}</dd></div>
        <div><dt>SOURCE</dt><dd>${escapeHtml(sourceLabel(selected, ground))}</dd></div>
        <div><dt>RESOLUTION</dt><dd>${escapeHtml(resolutionLabel(selected))}</dd></div>
        <div><dt>QUALITY / LIMIT</dt><dd>${escapeHtml(quality)}</dd></div>
      </dl>
      <div class="iqai-v2-operator-imagery__discover">
        ${showHistory ? `
          <label>
            REQUESTED DATE
            <input type="date" data-iqai-operator-imagery-date value="${escapeHtml(time?.requestedDate || '')}">
          </label>
        ` : ''}
        <button type="button" data-iqai-operator-imagery-action="discover">
          ${state.imageryView === IMAGERY_VIEW.LATEST ? 'FIND LATEST AVAILABLE' : 'FIND OBSERVATIONS'}
        </button>
      </div>
      ${(showHistory || showAll) ? observationList(time) : ''}
      <div class="iqai-v2-operator-imagery__actions" aria-label="Imagery actions">
        <button type="button" data-iqai-operator-imagery-action="previous" ${canStep ? '' : 'disabled'}>
          PREVIOUS <span>${canStep ? 'AVAILABLE' : 'NOT AVAILABLE'}</span>
        </button>
        <button type="button" data-iqai-operator-imagery-action="next" ${canStep ? '' : 'disabled'}>
          NEXT <span>${canStep ? 'AVAILABLE' : 'NOT AVAILABLE'}</span>
        </button>
        ${['COMPARE', 'SWIPE', 'PLAY', 'ACQUIRE'].map((action) => `
          <button type="button" disabled data-iqai-future-imagery-action="${action}">
            ${action} <span>${futureState(action, time, selected)}</span>
          </button>
        `).join('')}
      </div>
      ${state.experience === EXPERIENCE_MODE.EXPERT ? `
        <button
          type="button"
          class="iqai-v2-operator-imagery__diagnostics"
          data-iqai-operator-imagery-action="diagnostics"
          aria-pressed="${state.diagnosticsOpen ? 'true' : 'false'}"
        >${state.diagnosticsOpen ? 'CLOSE' : 'OPEN'} ENGINEERING DIAGNOSTICS</button>
      ` : ''}
      <p class="iqai-v2-operator-imagery__status">
        ${escapeHtml(availability)} · Latest uses the existing provider/date contract; no cloud-quality ranking or pixel proof is claimed.
      </p>
    </div>
  `;
}

function paintPlainCapability(region, state, mapState) {
  const title = region.querySelector('.iqai-v2-region__title');
  const status = region.querySelector('.iqai-v2-region__state');
  const body = region.querySelector('.iqai-v2-region__body');
  if (title) title.textContent = 'CURRENT CAPABILITY';
  if (status) {
    status.textContent = state.activeCapability === 'map'
      ? (mapState || 'INITIALIZING')
      : 'NOT CONNECTED';
  }
  if (body) {
    const label = state.activeCapability === 'map'
      ? 'Operational map'
      : state.activeCapability.replaceAll('-', ' ');
    body.innerHTML = `
      <div class="iqai-v2-current-capability">
        <strong>${escapeHtml(label.toUpperCase())}</strong>
        <p>${state.activeCapability === 'map'
          ? 'The persistent map is the primary operational instrument.'
          : 'This application capability has no connected specialist in this milestone.'}</p>
      </div>
    `;
  }
}

export function paintOperatorImageryExperience(root, context) {
  const region = root.querySelector('[data-iqai-slot="situation-slot"]');
  if (!region) return;
  const { state, ground, time, mapState } = context;
  if (state.activeCapability !== 'imagery') {
    paintPlainCapability(region, state, mapState);
    return;
  }
  const title = region.querySelector('.iqai-v2-region__title');
  const status = region.querySelector('.iqai-v2-region__state');
  const body = region.querySelector('.iqai-v2-region__body');
  if (title) title.textContent = 'IMAGERY';
  if (status) {
    status.textContent = availabilityLabel({
      time,
      mapState,
      observation: time?.selected || ground?.receipt?.observation
    });
  }
  if (body) body.innerHTML = renderOperatorImagery(context);
}

export function bindOperatorImageryExperience(root, handlers = {}) {
  const region = root.querySelector('[data-iqai-slot="situation-slot"]');
  if (!region) return () => {};

  const onClick = (event) => {
    const view = event.target.closest('[data-iqai-imagery-view]');
    if (view && region.contains(view)) {
      handlers.onView?.(view.getAttribute('data-iqai-imagery-view'));
      return;
    }
    const observation = event.target.closest('[data-iqai-observation-id]');
    if (observation && region.contains(observation)) {
      handlers.onSelect?.(observation.getAttribute('data-iqai-observation-id'));
      return;
    }
    const action = event.target.closest('[data-iqai-operator-imagery-action]');
    if (!action || !region.contains(action) || action.disabled) return;
    const actionId = action.getAttribute('data-iqai-operator-imagery-action');
    if (actionId === 'discover') handlers.onDiscover?.();
    if (actionId === 'previous') handlers.onPrevious?.();
    if (actionId === 'next') handlers.onNext?.();
    if (actionId === 'diagnostics') handlers.onDiagnostics?.();
  };
  const onChange = (event) => {
    const input = event.target.closest('[data-iqai-operator-imagery-date]');
    if (input && region.contains(input)) handlers.onRequestedDate?.(input.value);
  };

  region.addEventListener('click', onClick);
  region.addEventListener('change', onChange);
  return () => {
    region.removeEventListener('click', onClick);
    region.removeEventListener('change', onChange);
  };
}
