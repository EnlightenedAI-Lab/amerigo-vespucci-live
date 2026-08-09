import { planLayerAwareClientCommand } from '../../../public/spatial/layer-aware-wiring.js';
import { generateMixedActionCases } from './mixed-action-generator.js';
import { FIXTURE_CATALOG } from './fixtures/catalog.js';

function normalizeLayerClientPlan(plan) {
  if (!plan?.handled) {
    return { kind: 'not_handled', reason: plan?.reason || null };
  }
  if (plan.error) {
    return { kind: 'clarification', message: plan.error };
  }
  if (plan.action === 'LAYER_COMPOUND_CONTROLS') {
    return {
      kind: 'layer_compound',
      operations: (plan.operations || []).map((op) => ({
        operation: op.operation,
        layers: (op.layers || []).map((l) => l.title).sort()
      }))
    };
  }
  const layers = (plan.layers || (plan.layer ? [plan.layer] : [])).map((l) => l.title).sort();
  return {
    kind: 'layer_client',
    action: plan.action,
    operation: plan.operation || plan.layerControl?.operation || null,
    layers
  };
}

function compareExpected(expected, actual) {
  if (expected.kind !== actual.kind) {
    return { equal: false, diff: `kind ${expected.kind} vs ${actual.kind}` };
  }
  if (expected.kind === 'clarification') {
    return { equal: Boolean(actual.message), diff: actual.message ? null : 'expected clarification' };
  }
  if (expected.kind === 'layer_compound') {
    if (expected.operations.length !== actual.operations?.length) {
      return { equal: false, diff: `operation count ${expected.operations.length} vs ${actual.operations?.length}` };
    }
    for (let i = 0; i < expected.operations.length; i += 1) {
      const e = expected.operations[i];
      const a = actual.operations[i];
      if (e.operation !== a.operation) {
        return { equal: false, diff: `step[${i}] operation ${e.operation} vs ${a.operation}` };
      }
      if (JSON.stringify(e.layers) !== JSON.stringify(a.layers)) {
        return { equal: false, diff: `step[${i}] layers ${e.layers} vs ${a.layers}` };
      }
    }
    return { equal: true, diff: null };
  }
  if (expected.kind === 'layer_client') {
    const normOp = (op) => (op || '').replace(/_LAYERS$/, '_LAYER');
    if (normOp(expected.operation) !== normOp(actual.operation)) {
      return { equal: false, diff: `operation ${expected.operation} vs ${actual.operation}` };
    }
    if (JSON.stringify(expected.layers) !== JSON.stringify(actual.layers)) {
      return { equal: false, diff: `layers ${expected.layers} vs ${actual.layers}` };
    }
    return { equal: true, diff: null };
  }
  return { equal: true, diff: null };
}

function isOppositeExecution(expected, actual) {
  if (expected.kind !== 'layer_compound' || actual.kind !== 'layer_compound') return false;
  for (let i = 0; i < expected.operations.length; i += 1) {
    const e = expected.operations[i];
    const a = actual.operations[i];
    if (!a) return false;
    const eShow = e.operation.includes('SHOW');
    const aShow = a.operation.includes('SHOW');
    const eHide = e.operation.includes('HIDE');
    const aHide = a.operation.includes('HIDE');
    if ((eShow && aHide) || (eHide && aShow)) return true;
    if (eShow && aShow && JSON.stringify(e.layers) !== JSON.stringify(a.layers)) {
      // wrong layers with show - check if hide layer got show
      const expectedHideLayers = expected.operations
        .filter((op) => op.operation.includes('HIDE'))
        .flatMap((op) => op.layers);
      if (expectedHideLayers.some((l) => a.layers.includes(l))) return true;
    }
  }
  return false;
}

function hasDroppedClauses(expected, actual) {
  if (expected.kind === 'layer_compound' && actual.kind === 'layer_compound') {
    return actual.operations.length < expected.operations.length;
  }
  if (expected.kind === 'layer_compound' && actual.kind === 'layer_client') {
    return true;
  }
  return false;
}

function hasPartialUnresolved(expected, actual) {
  if (expected.kind === 'layer_compound' && actual.kind === 'layer_client') {
    return true;
  }
  if (expected.kind === 'layer_compound' && actual.kind === 'not_handled') {
    return false;
  }
  if (expected.kind === 'layer_compound' && actual.kind === 'clarification') {
    return false;
  }
  return false;
}

export function runMixedActionConformance(options = {}) {
  const catalog = options.catalog || FIXTURE_CATALOG;
  const cases = generateMixedActionCases({ seed: options.seed ?? 42 });
  const start = Date.now();
  let passed = 0;
  let failed = 0;
  const failures = [];
  let oppositeExecutions = 0;
  let droppedClauses = 0;
  let partialExecutions = 0;

  for (const caseDef of cases) {
    const plan = planLayerAwareClientCommand(caseDef.prompt, catalog);
    const actual = normalizeLayerClientPlan(plan);
    const cmp = compareExpected(caseDef.expected, actual);
    if (cmp.equal) {
      passed += 1;
    } else {
      failed += 1;
      failures.push({ ...caseDef, actual, diff: cmp.diff });
      if (isOppositeExecution(caseDef.expected, actual)) oppositeExecutions += 1;
      if (hasDroppedClauses(caseDef.expected, actual)) droppedClauses += 1;
      if (hasPartialUnresolved(caseDef.expected, actual)) partialExecutions += 1;
    }
  }

  const runtimeMs = Date.now() - start;
  return {
    totalCases: cases.length,
    passed,
    failed,
    passRate: Number(((passed / cases.length) * 100).toFixed(2)),
    runtimeMs,
    oppositeExecutions,
    droppedClauses,
    partialExecutions,
    failures: failures.slice(0, 20)
  };
}
