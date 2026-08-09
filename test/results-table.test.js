import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildResultsTableModel,
  hasFeatureResults,
  filterRows,
  sortRows,
  paginateRows,
  getRowCellValue,
  computeMapFeatureIdentity,
  RESULTS_TABLE_PAGE_SIZE
} from '../public/spatial/results-table-model.js';

const EXTERNAL_RESULT = {
  datasetId: 'concept:AMENITY:bank',
  conceptId: 'AMENITY:bank',
  displayName: 'Bank',
  sourceType: 'TRUSTED_EXTERNAL',
  renderMeta: { semanticField: 'amenity', semanticValue: 'bank' },
  features: Array.from({ length: 78 }, (_, i) => ({
    datasetId: 'concept:AMENITY:bank',
    conceptId: 'AMENITY:bank',
    iqaiType: 'osm_amenity',
    name: `Bank ${i + 1}`,
    address: `${i + 1} Rue Example`,
    distanceMeters: (i + 1) * 100,
    distanceLabel: `${((i + 1) * 0.1).toFixed(1)} km`,
    objectId: 1000 + i,
    sourceName: 'Bank',
    authority: 'OpenStreetMap Amenities / OSM_NA_Amenities',
    rawAttributes: {
      OBJECTID: 1000 + i,
      amenity: 'bank',
      name: `Bank ${i + 1}`,
      addr_street: `${i + 1} Rue Example`,
      addr_city: 'Montréal',
      operator: i % 2 === 0 ? 'TD' : null
    }
  }))
};

const PHARMACY_RESULT = {
  datasetId: 'concept:AMENITY:pharmacy',
  conceptId: 'AMENITY:pharmacy',
  displayName: 'Pharmacy',
  sourceType: 'TRUSTED_EXTERNAL',
  renderMeta: { semanticField: 'amenity', semanticValue: 'pharmacy' },
  features: Array.from({ length: 31 }, (_, i) => ({
    datasetId: 'concept:AMENITY:pharmacy',
    conceptId: 'AMENITY:pharmacy',
    name: `Pharmacy ${i + 1}`,
    distanceMeters: 500 + i,
    objectId: 2000 + i,
    rawAttributes: {
      OBJECTID: 2000 + i,
      amenity: 'pharmacy',
      name: `Pharmacy ${i + 1}`,
      addr_city: 'Montréal'
    }
  }))
};

test('bank scoped result produces matching table rows', () => {
  const model = buildResultsTableModel({
    supported: true,
    action: 'WITHIN',
    prompt: 'Show banks within 3 km of 997 de la Commune',
    datasetResults: [EXTERNAL_RESULT],
    summary: { matchedFeatures: 78 }
  });
  assert.equal(model.totalCount, 78);
  assert.equal(model.rows.length, 78);
});

test('pharmacy scoped result produces correct row count', () => {
  const model = buildResultsTableModel({
    supported: true,
    action: 'WITHIN',
    datasetResults: [PHARMACY_RESULT],
    summary: { matchedFeatures: 31 }
  });
  assert.equal(model.rows.length, 31);
});

test('columns derive from actual attributes not hard-coded dataset fields', () => {
  const model = buildResultsTableModel({
    supported: true,
    action: 'WITHIN',
    datasetResults: [EXTERNAL_RESULT]
  });
  const columnIds = model.columns.map((c) => c.id);
  assert.ok(columnIds.includes('name'));
  assert.ok(columnIds.includes('city'));
  assert.ok(columnIds.includes('operator'));
  assert.ok(columnIds.includes('amenity'));
  assert.ok(!columnIds.includes('stationNumber'));
});

test('missing values render safely', () => {
  const model = buildResultsTableModel({
    supported: true,
    action: 'WITHIN',
    datasetResults: [{
      datasetId: 'concept:AMENITY:bank',
      sourceType: 'TRUSTED_EXTERNAL',
      features: [{ rawAttributes: { OBJECTID: 1, amenity: 'bank' } }]
    }]
  });
  assert.equal(getRowCellValue(model.rows[0], 'operator'), '—');
});

test('sort and filter work', () => {
  const model = buildResultsTableModel({
    supported: true,
    action: 'WITHIN',
    datasetResults: [EXTERNAL_RESULT]
  });
  const filtered = filterRows(model.rows, 'TD');
  assert.ok(filtered.length > 0);
  assert.ok(filtered.every((row) => String(row.values.operator || '').includes('TD')));
  const sorted = sortRows(model.rows, 'name', 'desc');
  assert.ok(sorted[0].values.name > sorted[1].values.name);
});

test('pagination defaults to 50 rows per page', () => {
  const model = buildResultsTableModel({
    supported: true,
    action: 'WITHIN',
    datasetResults: [EXTERNAL_RESULT]
  });
  const page1 = paginateRows(model.rows, 1, RESULTS_TABLE_PAGE_SIZE);
  assert.equal(page1.pageRows.length, 50);
  assert.equal(page1.totalPages, 2);
});

test('x-ray category counts do not produce feature rows', () => {
  assert.equal(hasFeatureResults({
    supported: true,
    action: 'CATEGORY_COUNTS_WITHIN',
    xrayResult: { categories: [{ value: 'bank', count: 10 }] }
  }), false);
  assert.equal(buildResultsTableModel({
    supported: true,
    action: 'CATEGORY_COUNTS_WITHIN'
  }), null);
});

test('computeMapFeatureIdentity matches external OBJECTID', () => {
  const feature = EXTERNAL_RESULT.features[0];
  const identity = computeMapFeatureIdentity(EXTERNAL_RESULT, feature, 0, { scopedFallback: 1 });
  assert.equal(identity.mapObjectId, 1000);
  assert.equal(identity.layerId, 'iqai-concept-AMENITY:bank');
});

test('changing query replaces table model row set', () => {
  const bankModel = buildResultsTableModel({
    supported: true,
    action: 'WITHIN',
    datasetResults: [EXTERNAL_RESULT]
  });
  const pharmacyModel = buildResultsTableModel({
    supported: true,
    action: 'WITHIN',
    datasetResults: [PHARMACY_RESULT]
  });
  assert.equal(bankModel.rows.length, 78);
  assert.equal(pharmacyModel.rows.length, 31);
  assert.notEqual(bankModel.rows[0].datasetId, pharmacyModel.rows[0].datasetId);
});

test('compound query adds dataset column', () => {
  const model = buildResultsTableModel({
    supported: true,
    action: 'COMPOUND',
    datasetResults: [EXTERNAL_RESULT, PHARMACY_RESULT]
  });
  assert.equal(model.multiDataset, true);
  assert.ok(model.columns.some((col) => col.id === '_datasetLabel'));
});
