import { EXPERIENCE_MODE, IMAGERY_VIEW } from './command-center-state.js';
import { GUIDED_ACTION, deriveGuidedNextAction, renderGuidedNextAction } from './guided-next-action.js';
import { projectImageryDisplayTruth } from './imagery-display-truth.js';
import {
  formatBestImageActionLabel,
  formatCaptureLine,
  formatReleaseLine,
  formatRetrievedLine,
  imageryProviderLabel
} from '../imagery/imagery-capture-receipt.js';
import { formatKnownResolution, IMAGERY_POOL } from '../imagery/imagery-contract.js';

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function sourceLabel(observation, ground) {
  return imageryProviderLabel(observation, ground);
}

function operatorSafeLimitation(text) {
  const raw = String(text || '').trim();
  if (!raw) return '';
  if (/[A-Z0-9_]+_(?:API_KEY|TOKEN|SECRET|PASSWORD)\b/i.test(raw) || /\bAPI_KEY\b/.test(raw)) {
    return 'A historical imagery source is not configured.';
  }
  if (/https?:\/\//i.test(raw)) return '';
  return raw.replace(/\s+/g, ' ').slice(0, 220);
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
  return formatKnownResolution(observation?.gsdMeters) || 'UNKNOWN';
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
  const all = Array.isArray(time?.observations) ? time.observations : [];
  if (!all.length) {
    return '<p class="iqai-v2-operator-imagery__empty">No observations discovered for this AOI and request.</p>';
  }
  const dated = all.filter((item) => item.providerId !== 'esri-wayback').slice(0, 6);
  const wayback = all.filter((item) => item.providerId === 'esri-wayback').slice(0, 6);
  const rows = [...dated, ...wayback];
  return `
    <div class="iqai-v2-operator-imagery__observations" aria-label="Discovered imagery observations">
      ${rows.map((observation) => `
        <button
          type="button"
          class="iqai-v2-operator-imagery__observation${observation.id === time.selectedId ? ' is-selected' : ''}"
          data-iqai-observation-id="${escapeHtml(observation.id)}"
          data-iqai-observation-provider="${escapeHtml(observation.providerId || '')}"
          aria-pressed="${observation.id === time.selectedId ? 'true' : 'false'}"
        >
          <span>${escapeHtml(observation.productName || observation.id)}</span>
          <span>${escapeHtml(formatCaptureLine(observation, { includeResolution: false }))}</span>
        </button>
      `).join('')}
    </div>
  `;
}

function nextAttr(guided, action) {
  return guided.recommendedAction === action ? ' data-iqai-next="true"' : '';
}

function renderOperatorImagery({ state, ground, time, mapState, guided, focus }) {
  const showHistory = state.imageryView === IMAGERY_VIEW.HISTORY;
  const showAll = state.imageryView === IMAGERY_VIEW.ALL;
  const showLatest = state.imageryView === IMAGERY_VIEW.LATEST;
  const latestShown = showLatest
    && time?.pool === IMAGERY_POOL.LATEST
    && (ground?.currentMode === 'NEARMAP'
      || ground?.currentMode === 'ESRI_WORLD_IMAGERY'
      || ground?.currentMode === 'GOOGLE_SATELLITE');
  const selected = latestShown
    ? (ground?.receipt?.observation || null)
    : (time?.selected || null);
  const canStep = Boolean(
    (showHistory || showAll)
    && time?.observations?.length
    && time.engineState !== 'APPLYING'
    && time.engineState !== 'DISCOVERING'
  );
  const displayTruth = projectImageryDisplayTruth(time, {
    ground,
    focus,
    imageryView: state.imageryView
  });
  const availability = availabilityLabel({ time, mapState, observation: selected });
  const requested = time?.requestedDate || 'NONE';
  const capture = selected
    ? formatCaptureLine(selected, { includeResolution: false })
    : (displayTruth.operatorMessage ? 'NONE' : 'CAPTURE DATE UNKNOWN');
  const release = formatReleaseLine(selected) || 'NONE';
  const retrieved = formatRetrievedLine(selected) || 'NONE';
  const bestImageLabel = formatBestImageActionLabel(time?.requestedDate);
  const quality = operatorSafeLimitation(
    displayTruth.operatorMessage
    || selected?.limitation
    || time?.limitation
    || 'Quality metadata not reported.'
  );
  const expert = state.experience === EXPERIENCE_MODE.EXPERT;
  const prompt = operatorSafeLimitation(displayTruth.operatorMessage || time?.limitation || '');

  return `
    <div
      class="iqai-v2-operator-imagery"
      data-iqai-operator-imagery
      data-iqai-guided-next-action="workflow"
      data-iqai-latest="${showLatest}"
      data-iqai-imagery-pool="${escapeHtml(time?.pool || '')}"
      data-iqai-display-state="${escapeHtml(displayTruth.displayState || 'NONE')}"
      data-iqai-display-confirmed="${displayTruth.displayConfirmed ? 'true' : 'false'}"
    >
      ${renderGuidedNextAction(guided, state.experience, 'inspector')}
      <div class="iqai-v2-operator-imagery__modes" aria-label="Imagery views">
        ${Object.values(IMAGERY_VIEW).map((mode) => modeButton(mode, state.imageryView)).join('')}
      </div>
      <dl class="iqai-v2-operator-imagery__facts">
        <div><dt>REQUESTED DATE</dt><dd>${escapeHtml(requested)}</dd></div>
        <div><dt>SELECTED</dt><dd>${escapeHtml(displayTruth.selectedLabel)}</dd></div>
        <div><dt>ACTIVATED</dt><dd>${escapeHtml(displayTruth.activatedLabel)}</dd></div>
        <div class="iqai-v2-operator-imagery__display">
          <dt>DISPLAY</dt>
          <dd data-iqai-display-label>${escapeHtml(displayTruth.displayLabel)}</dd>
        </div>
        <div><dt>CAPTURE DATE</dt><dd data-iqai-capture-date>${escapeHtml(capture)}</dd></div>
        <div><dt>RELEASE DATE</dt><dd data-iqai-release-date>${escapeHtml(release)}</dd></div>
        <div><dt>RETRIEVED DATE</dt><dd data-iqai-retrieved-date>${escapeHtml(retrieved)}</dd></div>
        <div><dt>SOURCE</dt><dd>${escapeHtml(sourceLabel(selected, ground))}</dd></div>
        <div><dt>RESOLUTION</dt><dd>${escapeHtml(resolutionLabel(selected))}</dd></div>
        <div><dt>QUALITY / LIMIT</dt><dd>${escapeHtml(quality)}</dd></div>
      </dl>
      <div class="iqai-v2-operator-imagery__discover">
        <label>
          REQUESTED DATE
          <input type="date" data-iqai-operator-imagery-date value="${escapeHtml(time?.requestedDate || '')}"${nextAttr(guided, GUIDED_ACTION.CHOOSE_DATE)}>
        </label>
        ${time?.requestedDate ? `<p data-iqai-best-image-near>${escapeHtml(bestImageLabel)}</p>` : ''}
        <button type="button" data-iqai-operator-imagery-action="discover"${nextAttr(guided, GUIDED_ACTION.SHOW_BEST_IMAGE)}>
          ${escapeHtml(bestImageLabel)}
        </button>
      </div>
      ${(showHistory || showAll) ? observationList(time) : ''}
      <div class="iqai-v2-operator-imagery__actions" aria-label="Imagery actions">
        <button type="button" data-iqai-operator-imagery-action="previous" ${canStep ? '' : 'disabled'}${nextAttr(guided, GUIDED_ACTION.PREVIOUS)}>
          PREVIOUS <span>${canStep ? 'AVAILABLE' : 'NOT AVAILABLE'}</span>
        </button>
        <button type="button" data-iqai-operator-imagery-action="next" ${canStep ? '' : 'disabled'}${nextAttr(guided, GUIDED_ACTION.NEXT)}>
          NEXT <span>${canStep ? 'AVAILABLE' : 'NOT AVAILABLE'}</span>
        </button>
        ${['COMPARE', 'SWIPE', 'PLAY', 'ACQUIRE'].map((action) => `
          <button type="button" disabled data-iqai-future-imagery-action="${action}"${action === 'COMPARE' ? nextAttr(guided, GUIDED_ACTION.COMPARE) : ''}>
            ${action} <span>${futureState(action, time, selected)}</span>
          </button>
        `).join('')}
      </div>
      ${expert ? `
        <div class="iqai-v2-operator-imagery__expert" data-iqai-imagery-expert-depth>
          <p class="iqai-v2-operator-imagery__expert-kicker">EXPERT DEPTH</p>
          <button type="button" data-iqai-operator-imagery-action="discover">DISCOVER</button>
          <button type="button" data-iqai-operator-imagery-action="activate">ACTIVATE</button>
          <pre>${escapeHtml([
            `providerId: ${selected?.providerId || 'null'}`,
            `observationId: ${selected?.id || 'null'}`,
            `dateKindUsed: ${selected?.dateKindUsed || 'unresolved'}`,
            `engineState: ${time?.engineState || 'IDLE'}`,
            `match: ${time?.matchKind || 'none'}`,
            `displayState: ${displayTruth.displayState || 'NONE'}`,
            `displayConfirmed: ${displayTruth.displayConfirmed}`
          ].join('\n'))}</pre>
          <button
            type="button"
            class="iqai-v2-operator-imagery__diagnostics"
            data-iqai-operator-imagery-action="diagnostics"
            aria-pressed="${state.diagnosticsOpen ? 'true' : 'false'}"
          >${state.diagnosticsOpen ? 'CLOSE' : 'OPEN'} ENGINEERING DIAGNOSTICS</button>
        </div>
      ` : ''}
      <p class="iqai-v2-operator-imagery__status" data-iqai-operator-imagery-prompt>
        ${escapeHtml(prompt || `${availability} · LATEST is current mosaic. HISTORY is archive. Capture and release stay separate.`)}
      </p>
    </div>
  `;
}

function paintPlainCapability(region, state, mapState) {
  const title = region.querySelector('.iqai-v2-region__title');
  const status = region.querySelector('.iqai-v2-region__state');
  const body = region.querySelector('.iqai-v2-region__body');
  if (title) title.textContent = 'WORKFLOW';
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
          ? 'The map is the instrument. Ask IQAI what you want to know or do.'
          : 'This application capability has no connected specialist in this milestone.'}</p>
      </div>
    `;
  }
}

export function paintOperatorImageryExperience(root, context) {
  const region = root.querySelector('[data-iqai-slot="situation-slot"]');
  if (!region) return;
  const { state, ground, time, mapState, focus } = context;
  const guided = context.guided || deriveGuidedNextAction({
    activeCapability: state.activeCapability,
    imageryView: state.imageryView,
    observationCount: time?.observations?.length || 0,
    displayConfirmed: time?.displayConfirmed === true,
    historyDateCommitted: state.historyDateCommitted
  });
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
  if (body) body.innerHTML = renderOperatorImagery({ ...context, guided });
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
    if (actionId === 'activate') handlers.onActivate?.();
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
