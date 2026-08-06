const DEFAULT_TIMEOUT_MS = 15000;
const MAX_RETRIES = 3;

/**
 * Provider health with circuit breaker and last-good state.
 */
export class ProviderHealth {
  constructor() {
    /** @type {Map<string, object>} */
    this.states = new Map();
  }

  _state(id) {
    if (!this.states.has(id)) {
      this.states.set(id, {
        status: 'idle',
        lastSuccess: null,
        lastError: null,
        lastDataTime: null,
        latencyMs: null,
        failures: 0,
        circuitOpenUntil: 0,
        lastGood: null
      });
    }
    return this.states.get(id);
  }

  isCircuitOpen(id) {
    const s = this._state(id);
    return Date.now() < s.circuitOpenUntil;
  }

  markLoading(id) {
    const s = this._state(id);
    if (this.isCircuitOpen(id)) return;
    s.status = 'loading';
  }

  markReady(id, payload = {}) {
    const s = this._state(id);
    s.status = 'ready';
    s.lastSuccess = new Date().toISOString();
    s.lastDataTime = payload.lastDataTime || s.lastSuccess;
    s.latencyMs = payload.latencyMs ?? s.latencyMs;
    s.failures = 0;
    s.circuitOpenUntil = 0;
    s.lastGood = payload.lastGood ?? s.lastGood;
    s.lastError = null;
  }

  markDegraded(id, message) {
    const s = this._state(id);
    s.status = 'degraded';
    s.lastError = message;
  }

  markError(id, error) {
    const s = this._state(id);
    s.status = 'error';
    s.lastError = String(error?.message || error);
    s.failures += 1;
    if (s.failures >= 3) {
      const backoff = Math.min(60000, 2000 * (2 ** (s.failures - 3)) + Math.random() * 1000);
      s.circuitOpenUntil = Date.now() + backoff;
    }
  }

  get(id) {
    return { id, ...this._state(id) };
  }

  alertCount() {
    return [...this.states.values()].filter((s) => s.status === 'error' || s.status === 'degraded').length;
  }

  /**
   * Execute provider fetch with timeout, retry, and health updates.
   */
  async run(id, fn, options = {}) {
    if (this.isCircuitOpen(id)) {
      const s = this._state(id);
      return { ok: false, circuitOpen: true, lastGood: s.lastGood };
    }
    const timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS;
    this.markLoading(id);
    let lastErr;
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      const started = Date.now();
      try {
        const result = await Promise.race([
          fn(attempt),
          new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), timeoutMs))
        ]);
        this.markReady(id, { latencyMs: Date.now() - started, lastGood: result, ...options.meta });
        return { ok: true, result };
      } catch (err) {
        lastErr = err;
        const jitter = Math.random() * 250;
        await new Promise((r) => setTimeout(r, (2 ** attempt) * 200 + jitter));
      }
    }
    this.markError(id, lastErr);
    const s = this._state(id);
    return { ok: false, error: lastErr?.message, lastGood: s.lastGood };
  }
}
