import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  GIS_CAPABILITY_REGISTRY,
  GIS_PLAN_SCHEMA_VERSION,
  OPERATION_REGISTRY,
  DATASET_REGISTRY,
  resolveDatasetKey,
  resolveOperationId
} from '../src/spatial/a1-gis-capability-registry.js';
import { validateGISPlan } from '../src/spatial/a1-gis-plan-validator.js';
import {
  adaptValidatedPlanToExecution,
  assertAdapterDoesNotCallArcgis
} from '../src/spatial/a1-gis-plan-adapter.js';
import {
  processGisPlan,
  executeValidatedGisPlan
} from '../src/spatial/a1-gis-plan-service.js';
import { clearPlanAuditTrail, getLatestPlanAudit } from '../src/spatial/a1-gis-plan-provenance.js';
import { planCompoundPrompt } from '../src/spatial/spatial-compound-planner.js';
import { DATASET_IDS } from '../src/spatial/dataset-registry.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_ROOT = path.join(__dirname, '..', 'tests', 'spatial', 'plan-fixtures');
const LOCATION = '997 de la Commune';

function loadFixture(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(FIXTURE_ROOT, relativePath), 'utf8'));
}

function listFixtures(subdir) {
  const dir = path.join(FIXTURE_ROOT, subdir);
  return fs.readdirSync(dir).filter((name) => name.endsWith('.json'));
}

test('capability registry exposes versioned schema and bounded operations', () => {
  assert.equal(GIS_CAPABILITY_REGISTRY.schemaId, 'iqai.spatial.gis-plan');
  assert.equal(GIS_PLAN_SCHEMA_VERSION, '1.0.0');
  assert.ok(Object.keys(OPERATION_REGISTRY).includes('WITHIN'));
  assert.ok(Object.keys(DATASET_REGISTRY).includes('amenities'));
  assert.ok(GIS_CAPABILITY_REGISTRY.nonAiAddressableOperations.includes('RESET_MAP'));
});

test('schema: valid, malformed, and unsupported version', () => {
  const valid = validateGISPlan({
    schemaVersion: '1.0.0',
    operation: 'CLEAR'
  });
  assert.equal(valid.valid, true);

  const malformed = validateGISPlan('not-json');
  assert.equal(malformed.valid, false);
  assert.equal(malformed.errors[0].code, 'MALFORMED_PLAN');

  const unsupported = validateGISPlan(loadFixture('invalid/unsupported-schema-version.json'));
  assert.equal(unsupported.valid, false);
  assert.equal(unsupported.errors.some((e) => e.code === 'SCHEMA_VERSION_UNSUPPORTED'), true);
});

test('operations: supported operations validate; missing fields and unknown operations reject', () => {
  for (const operationId of Object.keys(OPERATION_REGISTRY)) {
    const op = OPERATION_REGISTRY[operationId];
    const plan = { schemaVersion: '1.0.0', operation: operationId };
    if (op.requiresDataset) plan.dataset = 'fire_stations';
    if (op.requiresLocation) plan.location = { type: 'address', text: LOCATION };
    if (op.requiresRadius) plan.radius = { value: 3, unit: 'km' };
    if (op.requiresLimit) plan.limit = 3;
    const result = validateGISPlan(plan);
    assert.equal(result.valid, true, `${operationId} should validate with required fields`);
  }

  const missingRadius = validateGISPlan({
    schemaVersion: '1.0.0',
    operation: 'WITHIN',
    dataset: 'fire_stations',
    location: { type: 'address', text: LOCATION }
  });
  assert.equal(missingRadius.valid, false);
  assert.equal(missingRadius.errors.some((e) => e.code === 'INVALID_RADIUS'), true);

  const unknownOp = validateGISPlan({
    schemaVersion: '1.0.0',
    operation: 'BUFFER_AND_INTERSECT_AND_ROUTE',
    dataset: 'fire_stations'
  });
  assert.equal(unknownOp.valid, false);
  assert.equal(unknownOp.errors[0].code, 'UNSUPPORTED_OPERATION');
});

test('datasets: registry resolves aliases; unknown dataset and invalid combinations reject', () => {
  assert.equal(resolveDatasetKey('Fire Stations'), 'fire_stations');
  assert.equal(resolveDatasetKey('cops'), 'police_stations');
  assert.equal(resolveOperationId('within'), 'WITHIN');

  const unknown = validateGISPlan(loadFixture('invalid/unknown-dataset.json'));
  assert.equal(unknown.valid, false);
  assert.equal(unknown.errors.some((e) => e.code === 'UNSUPPORTED_DATASET'), true);

  const locateWithDataset = validateGISPlan({
    schemaVersion: '1.0.0',
    operation: 'LOCATE',
    dataset: 'fire_stations',
    location: { type: 'address', text: LOCATION }
  });
  assert.equal(locateWithDataset.valid, false);
  assert.equal(locateWithDataset.errors.some((e) => e.code === 'UNSUPPORTED_DATASET_OPERATION'), true);
});

test('parameters: radius bounds, nearest limit, units, location, and context reference', () => {
  const negative = validateGISPlan(loadFixture('invalid/negative-radius.json'));
  assert.equal(negative.valid, false);
  assert.equal(negative.errors.some((e) => e.code === 'INVALID_RADIUS'), true);

  const excessive = validateGISPlan({
    schemaVersion: '1.0.0',
    operation: 'WITHIN',
    dataset: 'fire_stations',
    location: { type: 'address', text: LOCATION },
    radius: { value: 500, unit: 'km' }
  });
  assert.equal(excessive.valid, false);
  assert.equal(excessive.errors.some((e) => e.code === 'INVALID_RADIUS'), true);

  const badLimit = validateGISPlan({
    schemaVersion: '1.0.0',
    operation: 'NEAREST',
    dataset: 'police_stations',
    location: { type: 'address', text: LOCATION },
    limit: 0
  });
  assert.equal(badLimit.valid, false);
  assert.equal(badLimit.errors.some((e) => e.code === 'INVALID_LIMIT'), true);

  const normalizedStringRadius = validateGISPlan({
    schemaVersion: '1.0.0',
    operation: 'WITHIN',
    dataset: 'fire_stations',
    location: { type: 'address', text: LOCATION },
    radius: '3 km'
  });
  assert.equal(normalizedStringRadius.valid, true);
  assert.equal(normalizedStringRadius.normalizedPlan.radius.value, 3);

  const contextRef = validateGISPlan({
    schemaVersion: '1.0.0',
    operation: 'NEAREST',
    dataset: 'police_stations',
    locationRef: { type: 'conversation', ref: 'last_location' },
    limit: 3
  }, GIS_CAPABILITY_REGISTRY, { previousLocationText: LOCATION });
  assert.equal(contextRef.valid, true);
  assert.equal(contextRef.normalizedPlan.location.text, LOCATION);

  const missingContext = validateGISPlan({
    schemaVersion: '1.0.0',
    operation: 'NEAREST',
    dataset: 'police_stations',
    locationRef: { type: 'conversation', ref: 'last_location' },
    limit: 3
  });
  assert.equal(missingContext.valid, false);
  assert.equal(missingContext.errors.some((e) => e.code === 'CONTEXT_REFERENCE_UNAVAILABLE'), true);
});

test('filters: approved active_only filter; invalid field/operator and raw SQL reject', () => {
  const approved = validateGISPlan(loadFixture('valid/within-fire-active-only.json'));
  assert.equal(approved.valid, true);
  assert.equal(approved.normalizedPlan.filters[0].fieldSemantic, 'active_only');

  const invalidField = validateGISPlan({
    schemaVersion: '1.0.0',
    operation: 'WITHIN',
    dataset: 'fire_stations',
    location: { type: 'address', text: LOCATION },
    radius: { value: 3, unit: 'km' },
    filters: [{ fieldSemantic: 'secret_column', operator: 'equals', value: true }]
  });
  assert.equal(invalidField.valid, false);
  assert.equal(invalidField.errors.some((e) => e.code === 'INVALID_FILTER'), true);

  const sqlInjection = validateGISPlan({
    schemaVersion: '1.0.0',
    operation: 'WITHIN',
    dataset: 'fire_stations',
    location: { type: 'address', text: LOCATION },
    radius: { value: 3, unit: 'km' },
    filters: [{ fieldSemantic: 'active_only', operator: 'equals', value: 'true; DROP TABLE x' }]
  });
  assert.equal(sqlInjection.valid, false);

  const policeFilter = validateGISPlan({
    schemaVersion: '1.0.0',
    operation: 'WITHIN',
    dataset: 'police_stations',
    location: { type: 'address', text: LOCATION },
    radius: { value: 3, unit: 'km' },
    filters: [{ fieldSemantic: 'active_only', operator: 'equals', value: true }]
  });
  assert.equal(policeFilter.valid, false);
});

test('security boundary: prohibited internal ArcGIS fields reject before execution', () => {
  const invalidFixtures = listFixtures('invalid');
  let passed = 0;
  for (const file of invalidFixtures) {
    const fixture = loadFixture(`invalid/${file}`);
    const result = validateGISPlan(fixture);
    assert.equal(result.valid, false, `${file} must be rejected`);
    passed += 1;
  }
  assert.ok(passed >= 7);

  const codeCases = [
    { field: 'javascript', value: 'alert(1)' },
    { field: 'whereClause', value: "1=1" },
    { field: 'browserGlobal', value: 'window.map' },
    { field: 'arcgisRequest', value: { url: 'https://example.com' } }
  ];
  for (const item of codeCases) {
    const plan = {
      schemaVersion: '1.0.0',
      operation: 'WITHIN',
      dataset: 'fire_stations',
      location: { type: 'address', text: LOCATION },
      radius: { value: 3, unit: 'km' },
      [item.field]: item.value
    };
    const result = validateGISPlan(plan);
    assert.equal(result.valid, false);
    assert.equal(result.errors.some((e) => e.code === 'PROHIBITED_INTERNAL_FIELD'), true);
  }
});

test('adapter: normalized plans produce deterministic prompts; never calls ArcGIS', () => {
  assert.equal(assertAdapterDoesNotCallArcgis(), true);

  const cases = [
    {
      fixture: 'valid/within-fire-3km.json',
      manual: `map fire stations within 3km of ${LOCATION}`,
      action: 'WITHIN',
      datasetId: DATASET_IDS.FIRE_STATIONS
    },
    {
      fixture: 'valid/nearest-police-3.json',
      manual: `3 nearest police stations to ${LOCATION}`,
      action: 'NEAREST',
      datasetId: DATASET_IDS.POLICE_STATIONS
    },
    {
      fixture: null,
      plan: {
        schemaVersion: '1.0.0',
        operation: 'COUNT',
        dataset: 'fire_stations',
        location: { type: 'address', text: LOCATION },
        radius: { value: 3, unit: 'km' }
      },
      manual: `how many fire stations within 3 km of ${LOCATION}`,
      action: 'COUNT',
      datasetId: DATASET_IDS.FIRE_STATIONS
    },
    {
      fixture: 'valid/locate-address.json',
      manual: `locate ${LOCATION}`,
      action: 'LOCATE',
      datasetId: null
    }
  ];

  for (const item of cases) {
    const validated = item.fixture
      ? validateGISPlan(loadFixture(item.fixture))
      : validateGISPlan(item.plan);
    assert.equal(validated.valid, true, item.fixture || item.manual);
    const adapted = adaptValidatedPlanToExecution(validated.normalizedPlan);
    assert.equal(adapted.type, 'prompt');
    const manualPlan = planCompoundPrompt(item.manual);
    const structuredPlan = planCompoundPrompt(adapted.prompt);
    assert.equal(manualPlan.supported, true, `manual unsupported: ${item.manual}`);
    assert.equal(structuredPlan.supported, true, `structured unsupported: ${adapted.prompt}`);
    assert.equal(structuredPlan.commands[0].action, item.action);
    if (item.datasetId) {
      assert.equal(structuredPlan.commands[0].datasetIds[0], item.datasetId);
    }
  }
});

test('transaction: invalid plan never invokes deterministic GIS execution', async () => {
  clearPlanAuditTrail();
  let invoked = false;
  const fakeEngine = async () => {
    invoked = true;
    return { supported: true };
  };

  const rejected = await executeValidatedGisPlan(loadFixture('invalid/object-ids.json'), {}, fakeEngine);
  assert.equal(rejected.valid, false);
  assert.equal(rejected.executed, false);
  assert.equal(invoked, false);

  const audit = getLatestPlanAudit();
  assert.equal(audit.valid, false);
  assert.ok(audit.errors.length > 0);
});

test('valid fixtures pass validation and produce audit provenance', () => {
  clearPlanAuditTrail();
  const validFiles = listFixtures('valid');
  let passed = 0;
  for (const file of validFiles) {
    const processed = processGisPlan(loadFixture(`valid/${file}`));
    assert.equal(processed.valid, true, file);
    assert.ok(processed.adaptation?.prompt || processed.adaptation?.metaAction);
    passed += 1;
  }
  assert.equal(passed, validFiles.length);
});

test('CLEAR plan adapts to clear result meta prompt', () => {
  const result = validateGISPlan({ schemaVersion: '1.0.0', operation: 'CLEAR' });
  assert.equal(result.valid, true);
  const adapted = adaptValidatedPlanToExecution(result.normalizedPlan);
  assert.equal(adapted.prompt, 'clear result');
  assert.equal(adapted.metaAction, 'CLEAR_RESULT');
});

test('gis-plan execute API rejects invalid plans before mapper', async () => {
  const http = await import('node:http');
  const { createServer } = await import('../src/server.js');
  const { createPreviewConfig, createPreviewState } = await import('../src/demo-map-api.js');
  const server = createServer(createPreviewState(), createPreviewConfig(), null, { preview: true }).listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const { port } = server.address();
  try {
    const payload = JSON.stringify({ plan: loadFixture('invalid/object-ids.json') });
    const body = await new Promise((resolve, reject) => {
      const req = http.request({
        hostname: '127.0.0.1',
        port,
        path: '/api/spatial/gis-plan/execute',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload)
        }
      }, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(data) }));
      });
      req.on('error', reject);
      req.write(payload);
      req.end();
    });
    assert.equal(body.status, 422);
    assert.equal(body.body.valid, false);
    assert.equal(body.body.executed, false);
  } finally {
    server.close();
  }
});
