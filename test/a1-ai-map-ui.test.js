import test from 'node:test';
import assert from 'node:assert/strict';
import { AI_MAP_UI_ENABLED } from '../public/spatial/ai-map-ui-config.js';
import {
  formatAiMapUiResponse,
  formatAiMapSuccessMessage,
  formatAiMapSuccessChain
} from '../public/spatial/ai-map-ui-status.js';

test('AI MAP UI gate is enabled', () => {
  assert.equal(AI_MAP_UI_ENABLED, true);
});

test('formatAiMapUiResponse handles clarification, unsupported, provider, and invalid output', () => {
  const clarify = formatAiMapUiResponse({
    status: 'NEEDS_CLARIFICATION',
    question: 'Which type of station do you mean — police, fire, or transit?'
  });
  assert.match(clarify.message, /station/i);
  assert.equal(clarify.severity, 'info');

  const unsupported = formatAiMapUiResponse({
    status: 'UNSUPPORTED',
    reason: 'Layer deletion is not supported.'
  });
  assert.match(unsupported.message, /not currently supported/i);

  const provider = formatAiMapUiResponse({
    status: 'PROVIDER_ERROR',
    failureCode: 'MODEL_TIMEOUT'
  });
  assert.match(provider.message, /temporarily unavailable/i);

  const invalid = formatAiMapUiResponse({
    status: 'INVALID_MODEL_OUTPUT'
  });
  assert.match(invalid.message, /valid GIS plan/i);
});

test('formatAiMapSuccessMessage produces analyst-friendly confirmations', () => {
  const nearest = formatAiMapSuccessMessage({
    summary: { action: 'NEAREST', dataset: 'Police Stations', matchedFeatures: 3 }
  });
  assert.match(nearest, /3/i);

  const locate = formatAiMapSuccessMessage({
    summary: { action: 'LOCATE', location: '6939 Décarie Boulevard' }
  });
  assert.match(locate, /6939 Décarie/i);
});

test('formatAiMapSuccessChain includes provider and model when present', () => {
  const chain = formatAiMapSuccessChain({
    aiPlan: { provider: 'OPENAI', model: 'gpt-4o-mini' }
  });
  assert.match(chain.join(' '), /OPENAI/i);
  assert.match(chain.join(' '), /gpt-4o-mini/i);
});
