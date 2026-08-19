/**
 * BrainHost renders Ask / plans / clarifications / receipts and dispatches Brain requests.
 * It does not own models, routing policy, or capability execution.
 */

import { bindAskIqaiDock, paintAskIqaiDock, paintAskIqaiReceipt, renderAskIqaiDock } from '../shell/AskIqaiDock.js';
import { BRAIN_SEAM } from '../brain/seams.js';

export function renderBrainHost(seam = BRAIN_SEAM) {
  return `
    ${renderAskIqaiDock()}
    <aside class="iqai-v2-brain-seam" data-iqai-brain-host aria-label="IQAI Brain seam">
      <p class="iqai-v2-brain-seam__kicker">IQAI BRAIN</p>
      <p data-iqai-brain-state>NOT CONNECTED</p>
      <p data-iqai-brain-flow>${seam.flow.join(' → ')}</p>
      <p data-iqai-brain-reason>${seam.reason}</p>
    </aside>
  `;
}

export function paintBrainHost(root, { seam, localState } = {}) {
  const state = root.querySelector('[data-iqai-brain-state]');
  const reason = root.querySelector('[data-iqai-brain-reason]');
  if (state) state.textContent = localState || 'NOT CONNECTED';
  if (reason && seam?.reason) reason.textContent = seam.reason;
}

export { bindAskIqaiDock, paintAskIqaiDock, paintAskIqaiReceipt };
