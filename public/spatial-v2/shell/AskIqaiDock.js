import { ASK_QUICK_ACTIONS, SHELL_SLOTS } from './layout-registry.js';

export function renderAskIqaiDock() {
  const { id, slot } = SHELL_SLOTS.askIqaiDock;
  return `
    <section id="${id}" class="iqai-v2-ask" data-iqai-slot="${slot}" aria-label="Ask IQAI">
      <form class="iqai-v2-ask__form" data-iqai-ask-form="true" autocomplete="off">
        <div class="iqai-v2-ask__top">
          <h2 class="iqai-v2-ask__label">ASK IQAI</h2>
          <div class="iqai-v2-ask__actions" aria-label="Quick actions">
            ${ASK_QUICK_ACTIONS.map((action) => `
              <button
                type="button"
                class="iqai-v2-chip"
                data-iqai-quick-action="${action.id}"
                aria-pressed="false"
              >${action.label}</button>
            `).join('')}
          </div>
        </div>
        <div class="iqai-v2-ask__row">
          <label class="iqai-v2-ask__field">
            <span class="iqai-v2-visually-hidden">Ask IQAI</span>
            <textarea
              class="iqai-v2-ask__input"
              name="ask"
              rows="1"
              placeholder="Ask a question or describe what you want to build..."
            ></textarea>
          </label>
          <button type="submit" class="iqai-v2-ask__send">SEND</button>
        </div>
        <p class="iqai-v2-ask__status" data-iqai-ask-status hidden></p>
      </form>
    </section>
  `;
}

function receiptMessage(receipt) {
  if (!receipt) return 'FAILED — No Ask receipt was produced.';
  if (receipt.state === 'ROUTED') {
    const message = receipt.result?.message || receipt.capabilityLabel || receipt.capabilityId;
    return `ROUTED — ${message}${/[.!?]$/.test(message) ? '' : '.'}`;
  }
  if (receipt.state === 'UNAVAILABLE') {
    return `UNAVAILABLE — ${receipt.result?.message || 'The requested capability is not available.'}`;
  }
  if (receipt.state === 'FAILED') {
    return `FAILED — ${receipt.error || 'The capability failed without a reported reason.'}`;
  }
  if (receipt.reason === 'EMPTY_INPUT') {
    return 'UNROUTED — Enter a question. No capability was executed.';
  }
  return 'UNROUTED — No registered capability accepted this request.';
}

export function paintAskIqaiReceipt(root, receipt) {
  const status = root.querySelector('[data-iqai-ask-status]');
  if (!status) return;
  status.hidden = false;
  status.dataset.iqaiAskState = receipt?.state || 'FAILED';
  status.textContent = receiptMessage(receipt);
}

export function bindAskIqaiDock(root, handlers = {}) {
  const form = root.querySelector('[data-iqai-ask-form]');
  if (!form) return () => {};

  const status = form.querySelector('[data-iqai-ask-status]');
  const input = form.querySelector('[name="ask"]');
  const onSubmit = async (event) => {
    event.preventDefault();
    if (!status) return;
    status.hidden = false;
    status.dataset.iqaiAskState = 'APPLYING';
    status.textContent = 'APPLYING — Resolving against registered application capabilities.';
    const selected = form.querySelector('[data-iqai-quick-action][aria-pressed="true"]');
    if (typeof handlers.onSubmit !== 'function') {
      paintAskIqaiReceipt(root, {
        state: 'UNAVAILABLE',
        result: { message: 'The Ask capability bus is not available.' }
      });
      return;
    }
    const receipt = await handlers.onSubmit({
      text: input?.value || '',
      quickActionId: selected?.getAttribute('data-iqai-quick-action') || null
    });
    paintAskIqaiReceipt(root, receipt);
  };

  const onClick = (event) => {
    const chip = event.target.closest('[data-iqai-quick-action]');
    if (!chip || !form.contains(chip)) return;
    const pressed = chip.getAttribute('aria-pressed') === 'true';
    form.querySelectorAll('[data-iqai-quick-action]').forEach((item) => {
      const nextPressed = item === chip && !pressed;
      item.setAttribute('aria-pressed', nextPressed ? 'true' : 'false');
      item.classList.toggle('is-pressed', nextPressed);
    });
  };

  form.addEventListener('submit', onSubmit);
  form.addEventListener('click', onClick);
  return () => {
    form.removeEventListener('submit', onSubmit);
    form.removeEventListener('click', onClick);
  };
}
