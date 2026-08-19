const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

export class BrainModelAdapter {
  constructor({ provider, model, runtime, mode, capabilities = {} }) {
    if (new.target === BrainModelAdapter) {
      throw new TypeError('BrainModelAdapter is an interface and must be subclassed');
    }
    this.provider = provider;
    this.model = model;
    this.runtime = runtime;
    this.mode = mode;
    this.capabilities = Object.freeze({ ...capabilities });
  }

  async generate() {
    throw new Error('generate() must be implemented');
  }

  async health() {
    throw new Error('health() must be implemented');
  }

  metadata() {
    return Object.freeze({
      provider: this.provider,
      model: this.model,
      runtime: this.runtime,
      mode: this.mode,
      capabilities: this.capabilities
    });
  }
}

export class DeterministicMockAdapter extends BrainModelAdapter {
  constructor() {
    super({
      provider: 'deterministic-mock',
      model: 'candidate-selector-v1',
      runtime: 'in-process',
      mode: 'MOCK',
      capabilities: {
        structuredOutput: true,
        multimodal: false,
        advisoryOnly: true
      }
    });
  }

  async health() {
    return { ok: true, status: 'READY', ...this.metadata() };
  }

  async generate({ selectionContext = {} } = {}) {
    const inferenceIds = (selectionContext.inferenceCandidates ?? []).map((candidate) => candidate.id);
    const actions = selectionContext.actionCandidates ?? [];
    const intent = selectionContext.intent;
    const preferredTypes = intent === 'TIME'
      ? ['COMPARE_TIME', 'QUERY_GIS', 'OPEN_STREET_360']
      : intent === 'OBJECT' || intent === 'AUTHORITY'
        ? ['QUERY_GIS', 'OPEN_SCENE_3D', 'MEASURE', 'PLACE_CAMERA']
        : ['QUERY_GIS', 'OPEN_STREET_360', 'OPEN_SCENE_3D', 'MEASURE', 'COMPARE_TIME', 'INSPECT_MAP'];
    const actionIds = [...actions]
      .sort((left, right) => {
        const leftRank = preferredTypes.indexOf(left.actionType);
        const rightRank = preferredTypes.indexOf(right.actionType);
        return (leftRank < 0 ? 999 : leftRank) - (rightRank < 0 ? 999 : rightRank);
      })
      .slice(0, 3)
      .map((candidate) => candidate.id);

    return JSON.stringify({ inferenceIds, actionIds });
  }
}

function normalizeOllamaEndpoint(endpoint) {
  const url = new URL(endpoint);
  if (!LOOPBACK_HOSTS.has(url.hostname)) {
    throw new TypeError('Ollama endpoint must be loopback-only for this isolated lab');
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new TypeError('Ollama endpoint must use http or https');
  }
  return url.toString().replace(/\/$/, '');
}

function normalizeImages(media) {
  if (!Array.isArray(media) || media.length === 0) return [];
  return media.map((item, index) => {
    if (!item || item.kind !== 'image' || typeof item.data !== 'string') {
      throw new TypeError(`media[${index}] is not a supported future image input`);
    }
    return item.data.replace(/^data:image\/[^;]+;base64,/, '');
  });
}

export class OllamaGemmaAdapter extends BrainModelAdapter {
  constructor({
    model = process.env.IQAI_BRAIN_MODEL || 'gemma4:e4b-it-qat',
    endpoint = process.env.OLLAMA_HOST || 'http://127.0.0.1:11434'
  } = {}) {
    super({
      provider: 'ollama',
      model,
      runtime: 'Ollama local',
      mode: 'LOCAL',
      capabilities: {
        structuredOutput: true,
        multimodal: true,
        audio: false,
        advisoryOnly: true
      }
    });
    this.endpoint = normalizeOllamaEndpoint(endpoint);
    this.lastGenerationMetrics = null;
  }

  metadata() {
    return Object.freeze({
      ...super.metadata(),
      lastGenerationMetrics: this.lastGenerationMetrics
    });
  }

  async health() {
    try {
      const response = await fetch(`${this.endpoint}/api/tags`, {
        signal: AbortSignal.timeout(5000)
      });
      if (!response.ok) {
        return { ok: false, status: `HTTP_${response.status}`, ...this.metadata() };
      }
      const payload = await response.json();
      const installed = (payload.models ?? []).some((entry) => (
        entry.name === this.model || entry.model === this.model
      ));
      return {
        ok: installed,
        status: installed ? 'READY' : 'MODEL_NOT_INSTALLED',
        installedModels: (payload.models ?? []).map((entry) => entry.name ?? entry.model),
        ...this.metadata()
      };
    } catch (error) {
      return { ok: false, status: 'UNAVAILABLE', error: error.message, ...this.metadata() };
    }
  }

  async generate({ prompt, media = [] } = {}) {
    if (typeof prompt !== 'string' || prompt.length === 0) {
      throw new TypeError('prompt is required');
    }
    const images = normalizeImages(media);
    const body = {
      model: this.model,
      prompt,
      stream: false,
      format: 'json',
      options: {
        temperature: 0,
        seed: 42,
        num_predict: 256
      }
    };
    if (images.length > 0) body.images = images;

    const response = await fetch(`${this.endpoint}/api/generate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120000)
    });
    if (!response.ok) {
      const detail = (await response.text()).slice(0, 500);
      throw new Error(`Ollama generate failed (${response.status}): ${detail}`);
    }
    const payload = await response.json();
    if (typeof payload.response !== 'string') {
      throw new Error('Ollama response did not contain generated text');
    }
    this.lastGenerationMetrics = Object.freeze({
      loadTimeMs: Number.isFinite(payload.load_duration) ? payload.load_duration / 1_000_000 : null,
      totalTimeMs: Number.isFinite(payload.total_duration) ? payload.total_duration / 1_000_000 : null,
      promptTokens: Number.isFinite(payload.prompt_eval_count) ? payload.prompt_eval_count : null,
      outputTokens: Number.isFinite(payload.eval_count) ? payload.eval_count : null
    });
    return payload.response;
  }
}

export function createModelAdapter(provider = process.env.IQAI_BRAIN_PROVIDER || 'ollama') {
  if (provider === 'mock') return new DeterministicMockAdapter();
  if (provider === 'ollama') return new OllamaGemmaAdapter();
  throw new TypeError(`Unsupported model provider: ${provider}`);
}
