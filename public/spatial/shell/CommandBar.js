export class CommandBar {
  /** @param {HTMLElement} root */
  constructor(root) {
    this.root = root;
    this.mode = 'map';
    this.running = false;
    this.render();
    this.bind();
  }

  render() {
    if (!this.root) return;
    this.root.innerHTML = `
      <div class="command-bar">
        <div class="command-input-row">
          <input type="text" class="command-input" id="spatial-command-input"
            placeholder="Ask IQAI Spatial…" aria-label="Ask IQAI Spatial" />
          <button type="button" class="command-run" id="spatial-command-run" disabled>RUN</button>
        </div>
        <div class="command-result-counter" id="spatial-result-counter" hidden></div>
        <div class="command-understood-line" id="spatial-understood-line" hidden></div>
        <div class="command-response-line" id="spatial-response-line" hidden></div>
        <div class="command-modes" role="group" aria-label="Execution mode">
          <button type="button" class="command-mode is-active" data-mode="map" aria-pressed="true">
            <span class="command-mode-label">MAP</span>
            <span class="command-mode-sub">DETERMINISTIC</span>
          </button>
          <button type="button" class="command-mode" data-mode="investigate" aria-pressed="false">
            <span class="command-mode-label">INVESTIGATE</span>
            <span class="command-mode-sub">INTELLIGENCE</span>
          </button>
        </div>
      </div>
    `;
    this.input = this.root.querySelector('#spatial-command-input');
    this.runBtn = this.root.querySelector('#spatial-command-run');
    this.resultCounter = this.root.querySelector('#spatial-result-counter');
    this.understoodLine = this.root.querySelector('#spatial-understood-line');
    this.responseLine = this.root.querySelector('#spatial-response-line');
  }

  bind() {
    this.root?.querySelectorAll('.command-mode').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.mode = btn.dataset.mode || 'map';
        this.root.querySelectorAll('.command-mode').forEach((el) => {
          const active = el.dataset.mode === this.mode;
          el.classList.toggle('is-active', active);
          el.setAttribute('aria-pressed', String(active));
        });
        this.updateRunState();
        this.onModeChange?.(this.mode);
      });
    });

    if (this.input) {
      const onInputChange = () => this.updateRunState();
      this.input.addEventListener('input', onInputChange);
      this.input.addEventListener('change', onInputChange);
      this.input.addEventListener('keyup', onInputChange);
      this.input.addEventListener('paste', () => requestAnimationFrame(onInputChange));
      this.input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' && !this.runBtn?.disabled) {
          event.preventDefault();
          this.run();
        }
      });
    }

    if (this.runBtn) {
      this.runBtn.addEventListener('click', () => this.run());
    }

    this.updateRunState();
  }

  updateRunState() {
    if (!this.runBtn || !this.input) return;
    const hasText = this.input.value.trim().length > 0;
    const canRun = hasText && this.mode === 'map' && !this.running;
    this.runBtn.disabled = !canRun;
  }

  /** @param {(mode: string) => void} fn */
  setModeHandler(fn) {
    this.onModeChange = fn;
  }

  /** @param {(prompt: string) => void | Promise<void>} fn */
  setRunHandler(fn) {
    this.onRun = fn;
  }

  setRunning(running) {
    this.running = running;
    if (this.input) this.input.disabled = running;
    this.updateRunState();
  }

  getPrompt() {
    return this.input?.value.trim() || '';
  }

  setResultCounter(text) {
    if (!this.resultCounter) return;
    if (!text) {
      this.resultCounter.hidden = true;
      this.resultCounter.textContent = '';
      return;
    }
    this.resultCounter.textContent = text;
    this.resultCounter.hidden = false;
  }

  setUnderstoodLine(text) {
    if (!this.understoodLine) return;
    if (!text) {
      this.understoodLine.hidden = true;
      this.understoodLine.textContent = '';
      return;
    }
    this.understoodLine.textContent = `UNDERSTOOD: ${text}`;
    this.understoodLine.hidden = false;
  }

  setResponseLine(text) {
    if (!this.responseLine) return;
    if (!text) {
      this.responseLine.hidden = true;
      this.responseLine.textContent = '';
      return;
    }
    this.responseLine.textContent = text;
    this.responseLine.hidden = false;
  }

  async run() {
    const prompt = this.getPrompt();
    if (!prompt || this.mode !== 'map' || this.running) return;
    await this.onRun?.(prompt);
  }
}
