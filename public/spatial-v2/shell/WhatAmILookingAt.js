import { EXPERIENCE_MODE } from './command-center-state.js';

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
  return `
    <div class="iqai-v2-explanation__field">
      <dt>${label}</dt>
      <dd>${escapeHtml(value)}</dd>
    </div>
  `;
}

function renderExplanation({ state, ground, time }) {
  const observation = time?.selected || ground?.receipt?.observation || null;
  const question = state.lastAskReceipt?.input || 'No question submitted.';
  const shows = observation?.establishes
    || (state.activeCapability === 'map'
      ? 'The accepted operational map canvas.'
      : 'No accepted imagery observation or scientific result.');
  const doesNotProve = observation?.doesNotEstablish
    || 'Map presence does not confirm a claim, event, condition, or pixel-level imagery acceptance.';
  const resolution = Number.isFinite(observation?.gsdMeters)
    ? `${observation.gsdMeters} m`
    : 'UNKNOWN';
  const quality = [
    resolution !== 'UNKNOWN' ? `Resolution ${resolution}` : 'Resolution unknown',
    observation?.limitation || time?.limitation || 'Quality metadata unknown',
    'Wayback/Nearmap pixel proof remains PARTIAL'
  ].join(' · ');
  const date = [
    `Requested ${time?.requestedDate || 'NONE'}`,
    `Capture ${observation?.acquisitionDate || 'UNKNOWN'}`,
    `Release ${observation?.releaseDate || 'UNKNOWN'}`,
    `Online ${observation?.firstPublicDate || 'UNKNOWN'}`,
    `Vintage ${observation?.vintageLabel || observation?.vintageYear || 'UNKNOWN'}`
  ].join(' · ');

  return `
    <div class="iqai-v2-explanation" data-iqai-explanation>
      <p class="iqai-v2-explanation__connection">AI EXPLANATION · NOT CONNECTED</p>
      <dl>
        ${explanationField('QUESTION', question)}
        ${explanationField('IQAI SELECTED', selectedLabel(state, observation))}
        ${explanationField('WHY', whyLabel(state))}
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
