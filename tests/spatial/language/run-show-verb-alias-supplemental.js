import { planLayerAwareClientCommand } from '../../../public/spatial/layer-aware-wiring.js';
import { generateShowVerbAliasMixedCases, FIXTURE_CATALOG } from './show-verb-alias-supplemental.js';

function normalizePlan(plan) {
  if (!plan?.handled) return { kind: 'not_handled' };
  if (plan.error) return { kind: 'clarification', message: plan.error };
  if (plan.action === 'LAYER_COMPOUND_CONTROLS') {
    return {
      kind: 'layer_compound',
      operations: plan.operations.map((op) => ({
        operation: op.operation,
        layers: op.layers.map((l) => l.title).sort()
      }))
    };
  }
  return {
    kind: 'layer_client',
    action: plan.action,
    operation: plan.operation,
    layers: (plan.layers || []).map((l) => l.title).sort()
  };
}

function compare(expected, actual) {
  if (expected.kind !== actual.kind) return false;
  if (expected.kind === 'clarification') return Boolean(actual.message);
  if (expected.kind === 'layer_compound') {
    return expected.operations.every((e, i) => {
      const a = actual.operations[i];
      return e.operation === a.operation && JSON.stringify(e.layers) === JSON.stringify(a.layers);
    });
  }
  if (expected.kind === 'layer_client') {
    return expected.operation === actual.operation
      && JSON.stringify(expected.layers) === JSON.stringify(actual.layers);
  }
  return true;
}

export function runShowVerbAliasSupplemental() {
  const cases = generateShowVerbAliasMixedCases();
  let passed = 0;
  let failed = 0;
  for (const c of cases) {
    const plan = planLayerAwareClientCommand(c.prompt, FIXTURE_CATALOG);
    const actual = normalizePlan(plan);
    if (compare(c.expected, actual)) passed += 1;
    else failed += 1;
  }
  return { total: cases.length, passed, failed };
}
