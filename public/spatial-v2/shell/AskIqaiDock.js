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

export function bindAskIqaiDock(root) {
  const form = root.querySelector('[data-iqai-ask-form]');
  if (!form) return;

  const status = form.querySelector('[data-iqai-ask-status]');
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (!status) return;
    status.hidden = false;
    status.textContent = 'NOT CONNECTED — Ask IQAI is a shell surface only.';
  });

  form.addEventListener('click', (event) => {
    const chip = event.target.closest('[data-iqai-quick-action]');
    if (!chip || !form.contains(chip)) return;
    const pressed = chip.getAttribute('aria-pressed') === 'true';
    chip.setAttribute('aria-pressed', pressed ? 'false' : 'true');
    chip.classList.toggle('is-pressed', !pressed);
  });
}
