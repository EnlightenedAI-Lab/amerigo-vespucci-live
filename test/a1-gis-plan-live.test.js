import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createServer } from '../src/server.js';
import { createPreviewConfig, createPreviewState } from '../src/demo-map-api.js';
import { parseModelResponseEnvelope } from '../src/spatial/a1-gis-plan-model-parser.js';
import {
  setGisPlanProviderCallOverride,
  clearGisPlanProviderCallOverride
} from '../src/spatial/a1-gis-plan-model-provider.js';
import {
  planNaturalLanguageGISRequest,
  executeNaturalLanguageGISRequest
} from '../src/spatial/a1-gis-plan-natural-language-service.js';
import { clearLiveModelAuditTrail } from '../src/spatial/a1-gis-plan-provenance.js';
import { adaptValidatedPlanToExecution } from '../src/spatial/a1-gis-plan-adapter.js';

const LOCATION = '997 de la Commune';
const DECARIE = '6939 Décarie Boulevard';

function envelope(type, payload) {
  return JSON.stringify({ type, ...payload });
}

function mockProvider(responseFactory) {
  setGisPlanProviderCallOverride(async (userRequest, context) => ({
    rawContent: typeof responseFactory === 'function'
      ? responseFactory(userRequest, context)
      : responseFactory,
    provider: 'MOCK',
    model: 'mock-gis-plan-generator',
    providerLabel: 'Mock'
  }));
}

function postJson(port, path, body) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = http.request({
      hostname: '127.0.0.1',
      port,
      path,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      }
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(data || '{}') }));
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

test.afterEach(() => {
  clearGisPlanProviderCallOverride();
  clearLiveModelAuditTrail();
});

test('response parser accepts PLAN, NEEDS_CLARIFICATION, UNSUPPORTED envelopes', () => {
  const plan = parseModelResponseEnvelope(envelope('PLAN', {
    plan: {
      schemaVersion: '1.0.0',
      operation: 'LOCATE',
      location: { type: 'address', text: LOCATION }
    }
  }));
  assert.equal(plan.ok, true);
  assert.equal(plan.type, 'PLAN');

  const clarify = parseModelResponseEnvelope(envelope('NEEDS_CLARIFICATION', {
    question: 'Which dataset?'
  }));
  assert.equal(clarify.ok, true);
  assert.equal(clarify.type, 'NEEDS_CLARIFICATION');

  const unsupported = parseModelResponseEnvelope(envelope('UNSUPPORTED', {
    reason: 'Not supported'
  }));
  assert.equal(unsupported.ok, true);
  assert.equal(unsupported.type, 'UNSUPPORTED');
});

test('response parser rejects malformed JSON, unknown types, and extra envelope fields', () => {
  assert.equal(parseModelResponseEnvelope('not json').ok, false);
  assert.equal(parseModelResponseEnvelope('{"type":"DELETE_ALL"}').ok, false);
  assert.equal(parseModelResponseEnvelope('{"type":"PLAN","plan":{},"extra":1}').ok, false);
  assert.equal(parseModelResponseEnvelope('').code, 'MODEL_RESPONSE_EMPTY');
});

test('response parser accepts fenced JSON transport without semantic repair', () => {
  const fenced = 'Here is the plan:\n```json\n{"type":"UNSUPPORTED","reason":"nope"}\n```';
  const parsed = parseModelResponseEnvelope(fenced);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.type, 'UNSUPPORTED');
});

test('trust-bypass flags are rejected before provider call', async () => {
  let called = false;
  mockProvider(() => {
    called = true;
    return envelope('PLAN', { plan: { schemaVersion: '1.0.0', operation: 'CLEAR' } });
  });
  const result = await planNaturalLanguageGISRequest({
    text: 'clear result',
    context: {},
    options: { alreadyValidated: true }
  });
  assert.equal(result.status, 'INVALID_MODEL_OUTPUT');
  assert.equal(result.failureCode, 'TRUST_BYPASS_REJECTED');
  assert.equal(called, false);
});

test('provider failure returns PROVIDER_ERROR with zero GIS execution', async () => {
  setGisPlanProviderCallOverride(async () => {
    const err = new Error('timeout');
    err.code = 'MODEL_TIMEOUT';
    throw err;
  });
  let engineCalls = 0;
  const fakeEngine = async () => {
    engineCalls += 1;
    return { supported: true };
  };
  const result = await executeNaturalLanguageGISRequest({ text: 'map fire stations' }, fakeEngine);
  assert.equal(result.status, 'PROVIDER_ERROR');
  assert.equal(result.failureCode, 'MODEL_TIMEOUT');
  assert.equal(result.gisExecuted, false);
  assert.equal(engineCalls, 0);
});

test('invalid model output creates zero GIS execution', async () => {
  mockProvider(envelope('PLAN', {
    plan: {
      schemaVersion: '1.0.0',
      operation: 'WITHIN',
      dataset: 'fire_stations',
      objectIds: [1, 2, 3],
      location: { type: 'address', text: LOCATION },
      radius: { value: 3, unit: 'km' }
    }
  }));
  let engineCalls = 0;
  const fakeEngine = async () => {
    engineCalls += 1;
    return { supported: true };
  };
  const result = await executeNaturalLanguageGISRequest({
    text: 'map fire stations within 3 km'
  }, fakeEngine);
  assert.equal(result.status, 'INVALID_MODEL_OUTPUT');
  assert.equal(result.failureCode, 'PROHIBITED_INTERNAL_FIELD');
  assert.equal(result.gisExecuted, false);
  assert.equal(engineCalls, 0);
});

test('NEEDS_CLARIFICATION and UNSUPPORTED create zero GIS execution', async () => {
  let engineCalls = 0;
  const fakeEngine = async () => {
    engineCalls += 1;
    return { supported: true };
  };

  mockProvider(envelope('NEEDS_CLARIFICATION', { question: 'Which stations?' }));
  const clarify = await executeNaturalLanguageGISRequest({
    text: 'Show me the nearest stations.'
  }, fakeEngine);
  assert.equal(clarify.status, 'NEEDS_CLARIFICATION');
  assert.equal(clarify.gisExecuted, false);

  mockProvider(envelope('UNSUPPORTED', { reason: 'Delete layers is not supported.' }));
  const unsupported = await executeNaturalLanguageGISRequest({
    text: 'Delete every layer.'
  }, fakeEngine);
  assert.equal(unsupported.status, 'UNSUPPORTED');
  assert.equal(unsupported.gisExecuted, false);
  assert.equal(engineCalls, 0);
});

test('valid mock plans reach adapter and deterministic engine only after validation', async () => {
  const cases = [
    {
      text: `Map fire stations within 3 km of ${LOCATION}.`,
      plan: {
        schemaVersion: '1.0.0',
        operation: 'WITHIN',
        dataset: 'fire_stations',
        location: { type: 'address', text: LOCATION },
        radius: { value: 3, unit: 'km' }
      },
      operation: 'WITHIN',
      dataset: 'fire_stations'
    },
    {
      text: `Show the 3 nearest police stations to ${LOCATION}.`,
      plan: {
        schemaVersion: '1.0.0',
        operation: 'NEAREST',
        dataset: 'police_stations',
        location: { type: 'address', text: LOCATION },
        limit: 3
      },
      operation: 'NEAREST',
      dataset: 'police_stations'
    },
    {
      text: 'How many amenities are within 500 metres of this address?',
      plan: {
        schemaVersion: '1.0.0',
        operation: 'COUNT',
        dataset: 'amenities',
        locationRef: { type: 'conversation', ref: 'last_location' },
        radius: { value: 500, unit: 'm' }
      },
      operation: 'COUNT',
      dataset: 'amenities',
      context: { previousLocationText: LOCATION }
    },
    {
      text: `Locate ${DECARIE}.`,
      plan: {
        schemaVersion: '1.0.0',
        operation: 'LOCATE',
        location: { type: 'address', text: DECARIE }
      },
      operation: 'LOCATE',
      dataset: null
    }
  ];

  for (const item of cases) {
    mockProvider(envelope('PLAN', { plan: item.plan }));
    let enginePrompt = null;
    const fakeEngine = async (prompt) => {
      enginePrompt = prompt;
      return { supported: true, action: item.operation };
    };
    const result = await executeNaturalLanguageGISRequest({
      text: item.text,
      context: item.context || {}
    }, fakeEngine);
    assert.equal(result.status, 'VALID_PLAN', item.text);
    assert.equal(result.gisExecuted, true);
    assert.equal(result.normalizedPlan.operation, item.operation);
    if (item.dataset) assert.equal(result.normalizedPlan.dataset, item.dataset);
    assert.ok(enginePrompt);
    assert.equal(enginePrompt, adaptValidatedPlanToExecution(result.normalizedPlan).prompt);
  }
});

test('adversarial mock responses are rejected without GIS execution', async () => {
  const adversarial = [
    {
      label: 'delete layers',
      response: envelope('UNSUPPORTED', { reason: 'Layer deletion is not supported.' })
    },
    {
      label: 'feature server url in plan',
      response: envelope('PLAN', {
        plan: {
          schemaVersion: '1.0.0',
          operation: 'WITHIN',
          dataset: 'fire_stations',
          serviceUrl: 'https://example.com/FeatureServer/0',
          location: { type: 'address', text: LOCATION },
          radius: { value: 3, unit: 'km' }
        }
      })
    },
    {
      label: 'object ids',
      response: envelope('PLAN', {
        plan: {
          schemaVersion: '1.0.0',
          operation: 'WITHIN',
          dataset: 'fire_stations',
          objectIds: [1, 2, 3],
          location: { type: 'address', text: LOCATION },
          radius: { value: 3, unit: 'km' }
        }
      })
    },
    {
      label: 'javascript injection envelope',
      response: '{"type":"PLAN","plan":{"schemaVersion":"1.0.0","operation":"CLEAR","javascript":"window.location.reload()"}}'
    },
    {
      label: 'unsupported dataset',
      response: envelope('UNSUPPORTED', { reason: 'nuclear_plants is not an Agent 1 dataset.' })
    },
    {
      label: 'unsupported predicate',
      response: envelope('UNSUPPORTED', { reason: 'Ownership predicates on amenities are not supported.' })
    },
    {
      label: 'prompt injection',
      response: envelope('PLAN', {
        plan: {
          schemaVersion: '1.0.0',
          operation: 'WITHIN',
          dataset: 'fire_stations',
          arcgisRequest: { url: 'https://example.com' },
          location: { type: 'address', text: LOCATION },
          radius: { value: 3, unit: 'km' }
        }
      })
    }
  ];

  let engineCalls = 0;
  const fakeEngine = async () => {
    engineCalls += 1;
    return { supported: true };
  };

  let passed = 0;
  for (const item of adversarial) {
    mockProvider(item.response);
    const result = await executeNaturalLanguageGISRequest({ text: item.label }, fakeEngine);
    assert.notEqual(result.status, 'VALID_PLAN', item.label);
    assert.equal(result.gisExecuted, false, item.label);
    passed += 1;
  }
  assert.equal(engineCalls, 0);
  assert.equal(passed, adversarial.length);
});

test('ai-map plan API rejects invalid output and trust bypass without execution', async () => {
  const server = createServer(createPreviewState(), createPreviewConfig(), null, { preview: true }).listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const { port } = server.address();
  try {
    mockProvider(envelope('PLAN', {
      plan: {
        schemaVersion: '1.0.0',
        operation: 'WITHIN',
        dataset: 'fire_stations',
        renderer: 'red',
        location: { type: 'address', text: LOCATION },
        radius: { value: 3, unit: 'km' }
      }
    }));
    const invalid = await postJson(port, '/api/spatial/ai-map/plan', {
      prompt: 'map fire stations'
    });
    assert.equal(invalid.status, 422);
    assert.equal(invalid.body.status, 'INVALID_MODEL_OUTPUT');
    assert.equal(invalid.body.gisExecuted, false);

    const bypass = await postJson(port, '/api/spatial/ai-map/plan', {
      prompt: 'map fire stations',
      alreadyValidated: true
    });
    assert.equal(bypass.status, 400);
    assert.equal(bypass.body.failureCode, 'TRUST_BYPASS_REJECTED');
  } finally {
    server.close();
  }
});

test('ai-map execute API uses validated adapter prompt only', async () => {
  const server = createServer(createPreviewState(), createPreviewConfig(), null, { preview: true }).listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const { port } = server.address();
  try {
    mockProvider(envelope('PLAN', {
      plan: {
        schemaVersion: '1.0.0',
        operation: 'CLEAR'
      }
    }));
    const result = await postJson(port, '/api/spatial/ai-map', { prompt: 'clear result' });
    assert.equal(result.status, 200);
    assert.equal(result.body.supported, true);
    assert.equal(result.body.gisExecuted, true);
    assert.equal(result.body.aiPlan?.adaptation?.prompt, 'clear result');
  } finally {
    server.close();
  }
});

test('live provider integration when API key configured', async (t) => {
  const hasKey = Boolean(String(process.env.OPENAI_API_KEY || process.env.XAI_API_KEY || '').trim());
  if (!hasKey) {
    t.skip('No live model API key configured');
    return;
  }

  const result = await planNaturalLanguageGISRequest({
    text: `Map fire stations within 3 km of ${LOCATION}.`
  });
  assert.ok(['VALID_PLAN', 'INVALID_MODEL_OUTPUT', 'UNSUPPORTED', 'NEEDS_CLARIFICATION'].includes(result.status));
  if (result.status === 'VALID_PLAN') {
    assert.equal(result.normalizedPlan.operation, 'WITHIN');
    assert.equal(result.normalizedPlan.dataset, 'fire_stations');
    assert.equal(result.normalizedPlan.radius.value, 3);
  }
  assert.equal(result.gisExecuted, false);
});
