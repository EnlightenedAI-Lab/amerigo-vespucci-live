/**
 * Dual control cards — Deterministic GIS + AI Spatial.
 */
import { AI_MAP_UI_ENABLED } from '../ai-map-ui-config.js';

export { AI_MAP_UI_ENABLED };

export class CommandBar {
  /** @param {HTMLElement} root */
  constructor(root) {
    this.root = root;
    this.detRunning = false;
    this.aiRunning = false;
    this.aiAvailable = false;
    this.aiProviderLabel = '';
    this.aiModel = '';
    this.semanticFallback = false;
    this.render();
    this.bind();
    void this.loadRuntimeConfig();
  }

  render() {
    if (!this.root) return;
    this.root.innerHTML = `
      <div class="control-deck">
        <article class="control-card control-card--deterministic">
          <div class="control-card__head">
            <span class="control-card__eyebrow">Direct controlled GIS</span>
            <h3 class="control-card__title">MAP COMMAND</h3>
          </div>
          <div class="control-input-row">
            <input type="text" class="control-input" id="spatial-deterministic-input"
              placeholder="Map fire stations within 3 km of 997 de la Commune…"
              aria-label="Deterministic GIS command" />
            <button type="button" class="control-run" id="spatial-deterministic-run" disabled>RUN</button>
          </div>
          <p class="control-card__provenance" id="spatial-deterministic-provenance">Deterministic NLP · GIS execution · $0 LLM cost</p>
          <p class="control-card__feedback" id="spatial-deterministic-feedback" hidden></p>
        </article>
        <article class="control-card control-card--ai${AI_MAP_UI_ENABLED ? '' : ' control-card--disabled'}">
          <div class="control-card__head">
            <span class="control-card__eyebrow">Ask naturally</span>
            <h3 class="control-card__title">AI MAP</h3>
            <span class="control-card__status" id="spatial-ai-status-badge" hidden></span>
            <span class="control-card__model" id="spatial-ai-model-badge" hidden></span>
          </div>
          <div class="control-input-row">
            <input type="text" class="control-input" id="spatial-ai-input"
              placeholder="Map fire stations within 3 km of an address…"
              aria-label="AI MAP natural-language request" />
            <button type="button" class="control-run control-run--ai" id="spatial-ai-run" disabled>RUN</button>
          </div>
          <p class="control-card__provenance" id="spatial-ai-provenance">Governed planning · validated execution</p>
          <p class="control-card__chain" id="spatial-ai-chain" hidden></p>
          <p class="control-card__feedback" id="spatial-ai-feedback" hidden></p>
        </article>
      </div>
    `;
    this.detInput = this.root.querySelector('#spatial-deterministic-input');
    this.detRunBtn = this.root.querySelector('#spatial-deterministic-run');
    this.detProvenance = this.root.querySelector('#spatial-deterministic-provenance');
    this.detFeedback = this.root.querySelector('#spatial-deterministic-feedback');
    this.aiInput = this.root.querySelector('#spatial-ai-input');
    this.aiRunBtn = this.root.querySelector('#spatial-ai-run');
    this.aiProvenance = this.root.querySelector('#spatial-ai-provenance');
    this.aiChain = this.root.querySelector('#spatial-ai-chain');
    this.aiFeedback = this.root.querySelector('#spatial-ai-feedback');
    this.aiModelBadge = this.root.querySelector('#spatial-ai-model-badge');
    this.aiStatusBadge = this.root.querySelector('#spatial-ai-status-badge');
  }

  bind() {
    this.wireInput(this.detInput, () => this.updateDetRunState(), () => this.runDeterministic());
    this.detRunBtn?.addEventListener('click', () => this.runDeterministic());
    this.wireInput(this.aiInput, () => this.updateAiRunState(), () => this.runAi());
    this.aiRunBtn?.addEventListener('click', () => this.runAi());
  }

  wireInput(input, onChange, onEnter) {
    if (!input) return;
    input.addEventListener('input', onChange);
    input.addEventListener('change', onChange);
    input.addEventListener('keyup', onChange);
    input.addEventListener('paste', () => requestAnimationFrame(onChange));
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.target.disabled) {
        event.preventDefault();
        onEnter();
      }
    });
  }

  async loadRuntimeConfig() {
    try {
      const response = await fetch('/api/spatial/ai-config', { cache: 'no-store' });
      const body = await response.json().catch(() => ({}));
      this.aiAvailable = Boolean(body.ai?.available);
      this.aiProviderLabel = body.ai?.providerLabel || '';
      this.aiModel = body.ai?.model || '';
      this.semanticFallback = Boolean(body.deterministic?.semanticFallback);
      this.updateDeterministicProvenance(body.deterministic);
      this.updateAiAvailability(body.ai);
      this.updateDetRunState();
      this.updateAiRunState();
    } catch {
      this.updateDeterministicProvenance();
    }
  }

  updateDeterministicProvenance(config = {}) {
    if (!this.detProvenance) return;
    const semantic = config.semanticFallback ?? this.semanticFallback;
    const model = config.semanticModel;
    let text = 'Rules-controlled · governed GIS execution · $0 LLM cost';
    if (semantic && model) {
      text = `Deterministic execution · local semantic assist (${model})`;
    } else if (semantic) {
      text = 'Deterministic execution · local semantic assist when needed';
    }
    this.detProvenance.textContent = text;
  }

  updateAiAvailability(ai = {}) {
    if (!AI_MAP_UI_ENABLED) {
      if (this.aiInput) {
        this.aiInput.disabled = true;
        this.aiInput.placeholder = 'Natural-language planning — not enabled';
      }
      if (this.aiRunBtn) {
        this.aiRunBtn.disabled = true;
        this.aiRunBtn.textContent = 'NOT ENABLED';
      }
      if (this.aiProvenance) {
        this.aiProvenance.textContent = 'AI MAP is not enabled in this build.';
      }
      if (this.aiModelBadge) this.aiModelBadge.hidden = true;
      return;
    }
    const available = ai.available ?? this.aiAvailable;
    if (this.aiInput) {
      this.aiInput.disabled = !available || this.aiRunning;
      this.aiInput.placeholder = available
        ? 'Map fire stations within 3 km of an address…'
        : 'AI MAP is unavailable — provider not configured';
    }
    if (this.aiRunBtn && !this.aiRunning) {
      this.aiRunBtn.textContent = 'RUN';
    }
    if (this.aiModelBadge) {
      if (available && (ai.providerLabel || this.aiProviderLabel)) {
        const label = ai.providerLabel || this.aiProviderLabel;
        const model = ai.model || this.aiModel;
        this.aiModelBadge.textContent = model ? `${label} · ${model}` : label;
        this.aiModelBadge.hidden = false;
      } else {
        this.aiModelBadge.hidden = true;
      }
    }
    if (!available && this.aiProvenance) {
      this.aiProvenance.textContent = 'AI MAP is unavailable until a model provider is configured.';
    } else if (this.aiProvenance && !this.aiRunning) {
      this.aiProvenance.textContent = 'Governed planning · validated execution';
    }
    this.updateAiRunState();
  }

  updateDetRunState() {
    if (!this.detRunBtn || !this.detInput) return;
    const hasText = this.detInput.value.trim().length > 0;
    this.detRunBtn.disabled = !hasText || this.detRunning;
    if (this.detRunBtn) this.detRunBtn.textContent = this.detRunning ? '…' : 'RUN';
  }

  updateAiRunState() {
    if (!this.aiRunBtn || !this.aiInput) return;
    const hasText = this.aiInput.value.trim().length > 0;
    const enabled = AI_MAP_UI_ENABLED && this.aiAvailable;
    this.aiRunBtn.disabled = !hasText || this.aiRunning || !enabled;
    if (!this.aiRunning) this.aiRunBtn.textContent = 'RUN';
  }

  /** @param {(prompt: string) => void | Promise<void>} fn */
  setDeterministicHandler(fn) {
    this.onDeterministicRun = fn;
  }

  /** @param {(prompt: string) => void | Promise<void>} fn */
  setAiHandler(fn) {
    this.onAiRun = fn;
  }

  setDeterministicRunning(running) {
    this.detRunning = running;
    if (this.detInput) this.detInput.disabled = running;
    this.updateDetRunState();
    if (this.aiInput && !this.aiRunning) {
      this.aiInput.disabled = !this.aiAvailable || !AI_MAP_UI_ENABLED;
    }
  }

  setAiRunning(running) {
    this.aiRunning = running;
    if (this.aiInput) {
      this.aiInput.disabled = running || !this.aiAvailable || !AI_MAP_UI_ENABLED;
    }
    if (this.aiRunBtn) {
      this.aiRunBtn.textContent = running ? '…' : 'RUN';
      this.aiRunBtn.disabled = running || !this.aiInput?.value.trim() || !this.aiAvailable || !AI_MAP_UI_ENABLED;
    }
    if (this.detInput && !this.detRunning) this.detInput.disabled = false;
    if (!running) this.setAiPhase('');
  }

  setAiPhase(phase) {
    if (!this.aiStatusBadge) return;
    const text = String(phase || '').trim();
    if (!text) {
      this.aiStatusBadge.hidden = true;
      this.aiStatusBadge.textContent = '';
      if (this.aiProvenance && this.aiAvailable) {
        this.aiProvenance.textContent = 'Governed planning · validated execution';
      }
      return;
    }
    this.aiStatusBadge.textContent = text;
    this.aiStatusBadge.hidden = false;
    if (this.aiProvenance) this.aiProvenance.textContent = text;
  }

  setAiPresentation({ message = '', chain = [], severity = 'info' } = {}) {
    this.setAiFeedback(message);
    this.setAiGovernanceChain(chain);
    if (this.aiFeedback) {
      this.aiFeedback.dataset.severity = severity;
    }
  }

  getDeterministicPrompt() {
    return this.detInput?.value.trim() || '';
  }

  getAiPrompt() {
    return this.aiInput?.value.trim() || '';
  }

  setDeterministicFeedback(text) {
    this.setFeedback(this.detFeedback, text);
  }

  setAiFeedback(text) {
    this.setFeedback(this.aiFeedback, text);
  }

  setAiGovernanceChain(stages = []) {
    if (!this.aiChain) return;
    if (!stages.length) {
      this.aiChain.hidden = true;
      this.aiChain.textContent = '';
      return;
    }
    this.aiChain.textContent = stages.join(' → ');
    this.aiChain.hidden = false;
  }

  setResultCounter(text) {
    void text;
  }

  setUnderstoodLine(text) {
    if (this._suppressDeterministicFeedback) return;
    this.setDeterministicFeedback(text ? `Understood: ${text}` : '');
  }

  setResponseLine(text) {
    if (this._suppressDeterministicFeedback) return;
    this.setDeterministicFeedback(text || '');
  }

  setRunning(running) {
    this.setDeterministicRunning(running);
  }

  setFeedback(el, text) {
    if (!el) return;
    if (!text) {
      el.hidden = true;
      el.textContent = '';
      return;
    }
    el.textContent = text;
    el.hidden = false;
  }

  async runDeterministic() {
    const prompt = this.getDeterministicPrompt();
    if (!prompt || this.detRunning) return;
    await this.onDeterministicRun?.(prompt);
  }

  async runAi() {
    if (!AI_MAP_UI_ENABLED) return;
    const prompt = this.getAiPrompt();
    if (!prompt || this.aiRunning || !this.aiAvailable) return;
    await this.onAiRun?.(prompt);
  }

  async run() {
    await this.runDeterministic();
  }
}
