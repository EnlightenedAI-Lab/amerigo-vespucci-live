import test from 'node:test';
import assert from 'node:assert/strict';
import { expandConversationInput } from '../public/spatial/spatial-conversation-resolve.js';
import { patchConversationState } from '../public/spatial/spatial-conversation-state.js';
import {
  buildCategorySummaryTableModel,
  buildOperationalFeaturesTableModel,
  getRowCellValue
} from '../public/spatial/results-table-model.js';
import {
  buildCategoryDefinitionExpression,
  inheritRendererForCategories
} from '../public/spatial/source-presentation.js';

const XRAY_STATE = {
  lastXraySourceId: 'OSM_NA_AMENITIES',
  lastXraySemanticField: 'amenity',
  lastXrayRadiusKm: 3,
  lastXrayLocation: '997 de la Commune',
  lastXrayCategories: [
    { value: 'charging_station', count: 117 },
    { value: 'pharmacy', count: 31 },
    { value: 'restaurant', count: 666 }
  ]
};

const MAP_RESULT = {
  action: 'CATEGORY_COUNTS_WITHIN',
  summary: { displayMode: 'category_counts', radiusMeters: 3000 },
  xrayResult: {
    semanticField: 'amenity',
    radiusKm: 3,
    totalCategories: 3,
    totalFeaturesRepresented: 814,
    categories: XRAY_STATE.lastXrayCategories
  }
};

const PRESENTATION = {
  semanticField: 'amenity',
  renderer: {
    type: 'uniqueValue',
    field1: 'amenity',
    uniqueValueInfos: [
      { value: 'charging_station', symbol: { type: 'esriPMS', imageData: 'abc', contentType: 'image/png' } },
      { value: 'pharmacy', symbol: { type: 'esriPMS', imageData: 'def', contentType: 'image/png' } },
      { value: 'restaurant', symbol: { type: 'esriPMS', imageData: 'ghi', contentType: 'image/png' } }
    ],
    defaultSymbol: { type: 'esriPMS', imageData: 'zzz', contentType: 'image/png' }
  }
};

test('category summary model includes checkbox column and selection state', () => {
  const selected = new Set(['pharmacy']);
  const model = buildCategorySummaryTableModel(MAP_RESULT, PRESENTATION, { selectedCategories: selected });
  assert.equal(model.mode, 'category_summary');
  assert.ok(model.columns.some((col) => col.id === '_select'));
  const pharmacyRow = model.rows.find((row) => row.categoryValue === 'pharmacy');
  assert.equal(pharmacyRow.selected, true);
  const chargingRow = model.rows.find((row) => row.categoryValue === 'charging_station');
  assert.equal(chargingRow.selected, false);
  const cell = getRowCellValue(pharmacyRow, '_select');
  assert.match(cell, /checked/);
});

test('buildCategoryDefinitionExpression supports multiple categories', () => {
  const expr = buildCategoryDefinitionExpression('amenity', ['charging_station', 'pharmacy']);
  assert.equal(expr, "amenity IN ('charging_station','pharmacy')");
});

test('inheritRendererForCategories preserves unique symbols for selected categories', () => {
  const renderer = inheritRendererForCategories(PRESENTATION, 'amenity', ['charging_station', 'pharmacy']);
  assert.equal(renderer.type, 'uniqueValue');
  assert.equal(renderer.uniqueValueInfos.length, 2);
  assert.deepEqual(renderer.uniqueValueInfos.map((info) => info.value), ['charging_station', 'pharmacy']);
});

test('operational features table model includes category and source columns', () => {
  const features = [
    { attributes: { OBJECTID: 10, amenity: 'charging_station', name: 'Charge 1' } },
    { attributes: { OBJECTID: 11, amenity: 'pharmacy', name: 'Pharma 1' } }
  ];
  const model = buildOperationalFeaturesTableModel(features, MAP_RESULT.xrayResult);
  assert.equal(model.mode, 'operational_features');
  assert.equal(model.rows.length, 2);
  assert.ok(model.columns.some((col) => col.id === 'category' || col.canonical === 'category'));
  const row = model.rows.find((entry) => entry.mapObjectId === 10);
  assert.equal(row.layerId, 'iqai-xray-operational');
  assert.equal(row.values.category, 'charging_station');
  assert.equal(row.values.source, 'OpenStreetMap Amenities');
});

test('Show me the charging stations expands to XRAY_ADD_CATEGORY', () => {
  patchConversationState(XRAY_STATE);
  const expanded = expandConversationInput('Show me the charging stations');
  assert.equal(expanded.ok, true);
  assert.equal(expanded.metaAction, 'XRAY_ADD_CATEGORY');
  assert.equal(expanded.xrayCategoryValue, 'charging_station');
});

test('Add pharmacies expands to XRAY_ADD_CATEGORY', () => {
  patchConversationState(XRAY_STATE);
  const expanded = expandConversationInput('Add pharmacies.');
  assert.equal(expanded.ok, true);
  assert.equal(expanded.metaAction, 'XRAY_ADD_CATEGORY');
  assert.equal(expanded.xrayCategoryValue, 'pharmacy');
});

test('Remove pharmacies expands to XRAY_REMOVE_CATEGORY', () => {
  patchConversationState(XRAY_STATE);
  const expanded = expandConversationInput('Remove pharmacies.');
  assert.equal(expanded.ok, true);
  assert.equal(expanded.metaAction, 'XRAY_REMOVE_CATEGORY');
  assert.equal(expanded.xrayCategoryValue, 'pharmacy');
});

test('Clear amenities expands to XRAY_CLEAR_CATEGORIES', () => {
  patchConversationState(XRAY_STATE);
  const expanded = expandConversationInput('Clear amenities');
  assert.equal(expanded.ok, true);
  assert.equal(expanded.metaAction, 'XRAY_CLEAR_CATEGORIES');
});
