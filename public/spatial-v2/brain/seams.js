/**
 * IQAI Brain / Memory architecture seam.
 * Not Brain Phase 0. Model-independent. No training. No mission knowledge in weights.
 *
 * Operator → IQAI Brain → local model provider → cloud model providers
 *   → World State → capabilities → results → World State
 *
 * A future local reasoning adapter may wrap a locally installed model family.
 * That adapter is not IQAI's identity.
 */

export const BRAIN_SEAM = Object.freeze({
  id: 'iqai.brain.seam/0',
  implemented: false,
  reason: 'Brain Phase 0 is a later bounded mission. This wave preserves the host and provider-neutral seam only.',
  flow: Object.freeze([
    'OPERATOR',
    'IQAI BRAIN',
    'LOCAL MODEL PROVIDER',
    'CLOUD MODEL PROVIDERS',
    'WORLD STATE',
    'CAPABILITIES',
    'RESULTS',
    'WORLD STATE'
  ]),
  localFirst: true,
  cloudFallbackForbiddenWhenLocalMissing: true,
  identityIsNotAModelName: true
});

export function createBrainSeam({ modelProviderRegistry } = {}) {
  const local = modelProviderRegistry?.primaryLocal?.() || null;
  return Object.freeze({
    ...BRAIN_SEAM,
    localProviderId: local?.providerId || null,
    localProviderState: 'NOT CONNECTED'
  });
}
