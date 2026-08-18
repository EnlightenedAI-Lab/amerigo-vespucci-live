import { EXPERIENCE_MODE } from './command-center-state.js';
import { projectImageryDisplayTruth } from './imagery-display-truth.js';
import {
  formatCaptureLine,
  formatReleaseLine,
  formatRetrievedLine,
  imageryProviderLabel
} from '../imagery/imagery-capture-receipt.js';
import { formatKnownResolution } from '../imagery/imagery-contract.js';

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

function selectedLabel(state, observation) {
  if (state.activeCapability === 'imagery') {
    return observation
      ? `${state.imageryView} imagery · ${observation.productName || observation.id}`
      : `${state.imageryView} imagery context · no observation selected`;
  }
  if (state.activeCapability === 'map') return 'Persistent operational map';
  return `${String(state.activeCapability).replaceAll('-', ' ')} capability`;
}

function whyLabel(state) {
  const receipt = state.lastAskReceipt;
  if (receipt?.state === 'ROUTED') {
    return `Accepted by the explicit ${receipt.capabilityLabel || receipt.capabilityId} application route. No AI rationale was generated.`;
  }
  if (state.activeCapability === 'imagery') {
    return 'Selected explicitly from the capability rail. No AI rationale was generated.';
  }
  return 'No AI selection has been made.';
}

function explanationField(label, value) {
  const valueAttr = label === 'DISPLAY' ? ' data-iqai-display-label' : '';
  return `
    <div class="iqai-v2-explanation__field">
      <dt>${label}</dt>
      <dd${valueAttr}>${escapeHtml(value)}</dd>
    </div>
  `;
}

function renderExplanation({ state, ground, time, focus }) {
  const latestShown = state.imageryView === 'LATEST'
    && time?.pool === 'LATEST'
    && (ground?.currentMode === 'NEARMAP'
      || ground?.currentMode === 'ESRI_WORLD_IMAGERY'
      || ground?.currentMode === 'GOOGLE_SATELLITE');
  const observation = latestShown
    ? (ground?.receipt?.observation || null)
    : (time?.selected || null);
  const displayTruth = projectImageryDisplayTruth(time, {
    ground,
    focus,
    imageryView: state.imageryView
  });
  const question = state.lastAskReceipt?.input || 'No question submitted.';
  const shows = displayTruth.displayConfirmed
    ? (observation?.establishes
      || 'Display-confirmed imagery on the operational map. Wayback/Nearmap pixel proof remains PARTIAL / ArcGIS-owned.')
    : (state.activeCapability === 'map'
      ? 'The accepted operational map canvas. Map presence is not imagery display confirmation.'
      : 'No display-confirmed imagery. A selected or activated observation is not a displayed image.');
  const doesNotProve = observation?.doesNotEstablish
    || 'Map presence does not confirm a claim, event, condition, or pixel-level imagery acceptance.';
  const resolution = formatKnownResolution(observation?.gsdMeters) || 'UNKNOWN';
  const quality = [
    resolution !== 'UNKNOWN' ? `Resolution ${resolution}` : 'Resolution unknown',
    observation?.limitation || time?.limitation || 'Quality metadata unknown',
    'Wayback/Nearmap pixel proof remains PARTIAL / ArcGIS-owned'
  ].join(' · ');
  const date = [
    `REQUESTED ${time?.requestedDate || 'NONE'}`,
    formatCaptureLine(observation, { includeResolution: false }),
    formatReleaseLine(observation) || 'RELEASE NONE',
    formatRetrievedLine(observation) || 'RETRIEVED NONE'
  ].join(' · ');

  return `
    <div
      class="iqai-v2-explanation"
      data-iqai-explanation
      data-iqai-display-state="${escapeHtml(displayTruth.displayState || 'NONE')}"
      data-iqai-display-confirmed="${displayTruth.displayConfirmed ? 'true' : 'false'}"
    >
      <p class="iqai-v2-explanation__connection">AI EXPLANATION · NOT CONNECTED</p>
      <dl>
        ${explanationField('QUESTION', question)}
        ${explanationField('IQAI SELECTED', selectedLabel(state, observation))}
        ${explanationField('WHY', whyLabel(state))}
        ${explanationField('DISPLAY', displayTruth.displayLabel)}
        ${explanationField('WHAT IT SHOWS', shows)}
        ${explanationField('WHAT IT DOES NOT PROVE', doesNotProve)}
        ${explanationField('SOURCE', sourceLabel(observation, ground))}
        ${explanationField('DATE', date)}
        ${explanationField('QUALITY', quality)}
      </dl>
      <details class="iqai-v2-explanation__expert" ${state.experience === EXPERIENCE_MODE.EXPERT ? 'open' : ''}>
        <summary>EXPERT DETAILS</summary>
        <pre>${escapeHtml([
          `providerId: ${observation?.providerId || 'null'}`,
          `observationId: ${observation?.id || 'null'}`,
          `dateKindUsed: ${observation?.dateKindUsed || 'unresolved'}`,
          `match: ${time?.matchKind || 'none'}`,
          `deltaDays: ${time?.deltaDays == null ? 'null' : time.deltaDays}`,
          `timeEngine: ${time?.engineState || 'IDLE'}`,
          `displayState: ${displayTruth.displayState || 'NONE'}`,
          `displayConfirmed: ${displayTruth.displayConfirmed}`,
          `waybackEntitlement: ${time?.entitlements?.wayback || 'unknown'}`,
          `nearmapEntitlement: ${time?.entitlements?.nearmap || 'unknown'}`,
          `askReceipt: ${state.lastAskReceipt?.receiptId || 'none'}`
        ].join('\n'))}</pre>
      </details>
    </div>
  `;
}

export function paintWhatAmILookingAt(root, context) {
  const region = root.querySelector('[data-iqai-slot="evidence-slot"]');
  if (!region) return;
  const title = region.querySelector('.iqai-v2-region__title');
  const status = region.querySelector('.iqai-v2-region__state');
  const body = region.querySelector('.iqai-v2-region__body');
  if (title) title.textContent = 'WHAT AM I LOOKING AT?';
  if (status) status.textContent = 'NOT CONNECTED';
  if (body) body.innerHTML = renderExplanation(context);
}
