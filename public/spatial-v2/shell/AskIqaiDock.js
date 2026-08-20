import { ASK_QUICK_ACTIONS, SHELL_SLOTS } from './layout-registry.js';

export function renderAskIqaiDock() {
  const { id, slot } = SHELL_SLOTS.askIqaiDock;
  return `
    <section id="${id}" class="iqai-v2-ask" data-iqai-slot="${slot}" data-iqai-ask-open="false" hidden aria-label="Ask IQAI">
      <form class="iqai-v2-ask__form" data-iqai-ask-form="true" autocomplete="off">
        <div class="iqai-v2-ask__top">
          <h2 class="iqai-v2-ask__label">ASK IQAI</h2>
          <button type="button" class="iqai-v2-ask__close" data-iqai-ask-close aria-label="Close Ask IQAI">Close</button>
          <p class="iqai-v2-ask__prompt iqai-v2-visually-hidden">Ask IQAI</p>
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
              placeholder="Ask, analyze or command…"
              data-iqai-ask-legacy="Ask a question or describe what you want to build..."
            ></textarea>
          </label>
          <button type="submit" class="iqai-v2-ask__send" data-iqai-guided-action="ASK">ASK</button>
        </div>
        <div class="iqai-v2-ask__models" data-iqai-model-selector hidden>
          <span>AUTO</span>
          <span>Grok</span>
          <span>Cloud</span>
          <span>Gemini</span>
        </div>
        <p class="iqai-v2-ask__status" data-iqai-ask-status hidden></p>
        <div class="iqai-v2-ask__confirm" data-iqai-ask-confirm hidden>
          <p class="iqai-v2-ask__confirm-title" data-iqai-ask-confirm-title></p>
          <p class="iqai-v2-ask__confirm-detail" data-iqai-ask-confirm-detail></p>
          <div class="iqai-v2-ask__confirm-actions">
            <button type="button" data-iqai-ask-confirm-yes>CONFIRM</button>
            <button type="button" data-iqai-ask-confirm-no>CANCEL</button>
          </div>
        </div>
      </form>
    </section>
  `;
}

function receiptMessage(receipt) {
  if (!receipt) return 'FAILED — No Ask receipt was produced.';
  if (receipt.result?.needsConfirmation) {
    return receipt.result.confirmationTitle || 'SHOW HYDRANTS WITHIN 500 M';
  }
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

export function paintAskIqaiDock(root, { open = false } = {}) {
  const dock = root.querySelector('[data-iqai-slot="ask-iqai-dock"]');
  if (!dock) return;
  dock.hidden = !open;
  dock.dataset.iqaiAskOpen = open ? 'true' : 'false';
  root.dataset.iqaiAsk = open ? 'open' : 'closed';
  const toggle = root.querySelector('[data-iqai-ask-toggle]');
  if (toggle) {
    toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    toggle.classList.toggle('is-open', open);
  }
}

export function paintAskIqaiReceipt(root, receipt) {
  const status = root.querySelector('[data-iqai-ask-status]');
  const confirm = root.querySelector('[data-iqai-ask-confirm]');
  const title = root.querySelector('[data-iqai-ask-confirm-title]');
  const detail = root.querySelector('[data-iqai-ask-confirm-detail]');
  if (status) {
    status.hidden = false;
    status.dataset.iqaiAskState = receipt?.result?.needsConfirmation
      ? 'CONFIRM'
      : (receipt?.state || 'FAILED');
    status.textContent = receiptMessage(receipt);
  }
  if (confirm) {
    const pending = receipt?.result?.needsConfirmation === true;
    confirm.hidden = !pending;
    if (title) title.textContent = pending ? (receipt.result.confirmationTitle || 'SHOW HYDRANTS WITHIN 500 M') : '';
    if (detail) detail.textContent = pending ? (receipt.result.confirmationDetail || 'Nothing has been drawn. Confirm to execute on this map.') : '';
  }
}

export function bindAskIqaiDock(root, handlers = {}) {
  const form = root.querySelector('[data-iqai-ask-form]');
  const dock = root.querySelector('[data-iqai-slot="ask-iqai-dock"]');
  const onToggle = (event) => {
    const control = event.target.closest('[data-iqai-ask-toggle], [data-iqai-ask-close]');
    if (!control || !root.contains(control)) return;
    handlers.onToggle?.();
  };
  if (!form) {
    root.addEventListener('click', onToggle);
    return () => root.removeEventListener('click', onToggle);
  }

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
    const confirmYes = event.target.closest('[data-iqai-ask-confirm-yes]');
    if (confirmYes && form.contains(confirmYes)) {
      event.preventDefault();
      void (async () => {
        if (typeof handlers.onConfirm !== 'function') return;
        const receipt = await handlers.onConfirm();
        paintAskIqaiReceipt(root, receipt);
      })();
      return;
    }
    const confirmNo = event.target.closest('[data-iqai-ask-confirm-no]');
    if (confirmNo && form.contains(confirmNo)) {
      event.preventDefault();
      void (async () => {
        if (typeof handlers.onCancel === 'function') {
          const receipt = await handlers.onCancel();
          paintAskIqaiReceipt(root, receipt);
          return;
        }
        paintAskIqaiReceipt(root, {
          state: 'UNROUTED',
          reason: 'NO_CAPABILITY_MATCH',
          result: { message: 'Cancelled. No map action was executed.' }
        });
      })();
      return;
    }
    const chip = event.target.closest('[data-iqai-quick-action]');
    if (chip && form.contains(chip)) {
      const pressed = chip.getAttribute('aria-pressed') === 'true';
      form.querySelectorAll('[data-iqai-quick-action]').forEach((item) => {
        const nextPressed = item === chip && !pressed;
        item.setAttribute('aria-pressed', nextPressed ? 'true' : 'false');
        item.classList.toggle('is-pressed', nextPressed);
      });
    }
  };

  form.addEventListener('submit', onSubmit);
  form.addEventListener('click', onClick);
  root.addEventListener('click', onToggle);
  return () => {
    form.removeEventListener('submit', onSubmit);
    form.removeEventListener('click', onClick);
    root.removeEventListener('click', onToggle);
    void dock;
  };
}
