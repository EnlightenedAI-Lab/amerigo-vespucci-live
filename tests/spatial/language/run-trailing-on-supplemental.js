import { interpretSpatialLanguage } from '../../../src/spatial/spatial-language-interpreter.js';
import { planLayerAwareClientCommand } from '../../../public/spatial/layer-aware-wiring.js';
import { generateTrailingOnSupplementalCases, FIXTURE_CATALOG } from './trailing-on-supplemental.js';
import { normalizeGisPlan, normalizeLayerClientPlan } from './canonical-plan.js';

function normalizePlan(caseDef, raw) {
  if (caseDef.path === 'gis') return normalizeGisPlan(raw);
  return normalizeLayerClientPlan(raw);
}

function compare(expected, actual) {
  if (expected.kind !== actual.kind) return false;
  if (expected.kind === 'not_handled') return actual.reason === expected.reason;
  if (expected.kind === 'clarification') return Boolean(actual.message);
  if (expected.kind === 'layer_client') {
    if (expected.action && actual.action !== expected.action) return false;
    if (expected.operation && actual.operation !== expected.operation) return false;
    if (expected.layers?.length && JSON.stringify(expected.layers) !== JSON.stringify(actual.layers)) return false;
    return true;
  }
  if (expected.kind === 'gis') {
    const ec = expected.commands[0];
    const ac = actual.commands[0];
    return ec.action === ac.action
      && ec.dataset === ac.dataset
      && ec.radiusKm === ac.radiusKm
      && String(ec.location).toLowerCase() === String(ac.location).toLowerCase();
  }
  return true;
}

export function runTrailingOnSupplemental() {
  const cases = generateTrailingOnSupplementalCases();
  let passed = 0;
  let failed = 0;
  for (const c of cases) {
    const raw = c.path === 'gis'
      ? interpretSpatialLanguage(c.prompt, { webmapLayerCatalog: FIXTURE_CATALOG })
      : planLayerAwareClientCommand(c.prompt, FIXTURE_CATALOG);
    const actual = normalizePlan(c, raw);
    if (compare(c.expected, actual)) passed += 1;
    else failed += 1;
  }
  return { total: cases.length, passed, failed };
}
