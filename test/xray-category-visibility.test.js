import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCategorySummaryTableModel,
  getRowCellValue
} from '../public/spatial/results-table-model.js';
import {
  buildCategoryDefinitionExpression
} from '../public/spatial/source-presentation.js';
import {
  buildOperationalLegendEntries
} from '../public/spatial/operational-legend.js';

const MAP_RESULT = {
  action: 'CATEGORY_COUNTS_WITHIN',
  summary: { displayMode: 'category_counts', radiusMeters: 2000 },
  xrayResult: {
    semanticField: 'amenity',
    radiusKm: 2,
    totalCategories: 4,
    totalFeaturesRepresented: 100,
    categories: [
      { value: 'pub', count: 10 },
      { value: 'restaurant', count: 50 },
      { value: 'pharmacy', count: 20 },
      { value: 'charging_station', count: 20 }
    ]
  }
};

const PRESENTATION = {
  semanticField: 'amenity',
  renderer: {
    type: 'uniqueValue',
    field1: 'amenity',
    uniqueValueInfos: [
      { value: 'pub', symbol: { type: 'esriPMS', imageData: 'a', contentType: 'image/png' } },
      { value: 'restaurant', symbol: { type: 'esriPMS', imageData: 'b', contentType: 'image/png' } }
    ]
  }
};

test('all categories visible — all checkboxes checked', () => {
  const visible = new Set(['pub', 'restaurant', 'pharmacy', 'charging_station']);
  const model = buildCategorySummaryTableModel(MAP_RESULT, PRESENTATION, { visibleCategories: visible });
  assert.equal(model.totalCount, 4);
  for (const row of model.rows) {
    assert.equal(row.selected, true, `${row.categoryValue} should be checked`);
    assert.match(getRowCellValue(row, '_select'), /checked/);
  }
});

test('hide one category — checkbox unchecked, others remain checked', () => {
  const visible = new Set(['restaurant', 'pharmacy', 'charging_station']);
  const model = buildCategorySummaryTableModel(MAP_RESULT, PRESENTATION, { visibleCategories: visible });
  const pubRow = model.rows.find((row) => row.categoryValue === 'pub');
  assert.equal(pubRow.selected, false);
  assert.doesNotMatch(getRowCellValue(pubRow, '_select'), /checked/);
  const restaurantRow = model.rows.find((row) => row.categoryValue === 'restaurant');
  assert.equal(restaurantRow.selected, true);
});

test('clear all — empty definition expression shows zero features', () => {
  const expr = buildCategoryDefinitionExpression('amenity', []);
  assert.equal(expr, '1=0');
});

test('operational legend reflects visible categories only', () => {
  const visible = new Set(['restaurant', 'pharmacy']);
  const filtered = {
    ...MAP_RESULT.xrayResult,
    categories: MAP_RESULT.xrayResult.categories.filter((entry) => visible.has(entry.value))
  };
  const entries = buildOperationalLegendEntries(filtered, PRESENTATION);
  assert.equal(entries.length, 2);
  assert.deepEqual(entries.map((e) => e.value), ['restaurant', 'pharmacy']);
  assert.ok(!entries.some((e) => e.value === 'pub'));
});

test('pagination model rows retain visibility across full inventory', () => {
  const visible = new Set(['restaurant']);
  const model = buildCategorySummaryTableModel(MAP_RESULT, PRESENTATION, { visibleCategories: visible });
  assert.equal(model.rows.length, 4);
  const page1Rows = model.rows.slice(0, 2);
  const page2Rows = model.rows.slice(2);
  assert.equal(page1Rows.find((r) => r.categoryValue === 'pub').selected, false);
  assert.equal(page2Rows.find((r) => r.categoryValue === 'charging_station').selected, false);
  assert.equal(page1Rows.find((r) => r.categoryValue === 'restaurant').selected, true);
});
