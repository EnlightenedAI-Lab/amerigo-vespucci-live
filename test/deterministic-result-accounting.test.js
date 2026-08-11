import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildDeterministicAccounting,
  buildExecutionReceipt,
  computeCategoryAccounting
} from '../public/spatial/deterministic-result-accounting.js';

test('buildDeterministicAccounting marks complete when all attributes loaded', () => {
  const accounting = buildDeterministicAccounting({
    layer: { maxRecordCount: 2000 },
    objectIds: [1, 2, 3, 4, 5],
    attributeRecordsLoaded: 5,
    objectIdQueryUsed: true,
    truncated: false
  });
  assert.equal(accounting.totalMatchingObjectIds, 5);
  assert.equal(accounting.complete, true);
  assert.equal(accounting.truncated, false);
  assert.equal(accounting.sourceMaxRecordCount, 2000);
});

test('buildDeterministicAccounting marks truncated when attribute load is short', () => {
  const accounting = buildDeterministicAccounting({
    layer: { maxRecordCount: 2000 },
    objectIds: [1, 2, 3, 4, 5],
    attributeRecordsLoaded: 3,
    objectIdQueryUsed: true,
    truncated: true
  });
  assert.equal(accounting.complete, false);
  assert.equal(accounting.truncated, true);
});

test('computeCategoryAccounting separates renderer-matched and unmatched values', () => {
  const mapResult = {
    datasetResults: [{
      features: [
        { rawAttributes: { amenity: 'bench' } },
        { rawAttributes: { amenity: 'bench' } },
        { rawAttributes: { amenity: 'custom_tag' } }
      ]
    }]
  };
  const presentation = {
    renderer: {
      type: 'uniqueValue',
      field1: 'amenity',
      uniqueValueInfos: [{ value: 'bench', symbol: { type: 'esriPMS' } }],
      defaultSymbol: { type: 'esriPMS' }
    }
  };
  const stats = computeCategoryAccounting(mapResult, presentation);
  assert.equal(stats.rawDistinctCategoryCount, 2);
  assert.equal(stats.rendererClassCount, 1);
  assert.equal(stats.matchedRendererCategoryCount, 1);
  assert.equal(stats.unmatchedResultCategoryCount, 1);
  assert.equal(stats.defaultSymbolCategoryCount, 1);
  assert.equal(stats.defaultSymbolFeatureCount, 1);
});

test('computeCategoryAccounting infers category count from renderer classes when features are empty', () => {
  const mapResult = { datasetResults: [{ features: [] }] };
  const presentation = {
    uniqueValueInfos: Array.from({ length: 27 }, (_, index) => ({
      value: `cat_${index}`,
      symbol: { type: 'esriPMS' }
    })),
    renderer: {
      type: 'uniqueValue',
      field1: 'amenity',
      uniqueValueInfos: Array.from({ length: 27 }, (_, index) => ({
        value: `cat_${index}`,
        symbol: { type: 'esriPMS' }
      }))
    }
  };
  const stats = computeCategoryAccounting(mapResult, presentation);
  assert.equal(stats.rawDistinctCategoryCount, 27);
});

test('buildExecutionReceipt exposes executedAt and never references executed', () => {
  const receipt = buildExecutionReceipt(
    {
      supported: true,
      summary: { matchedFeatures: 7380, spatialOperation: 'Within 3 km', dataset: 'Amenities' },
      datasetResults: [{ datasetId: 'webmap:test', displayName: 'Amenities' }]
    },
    { totalMatchingObjectIds: 7380, complete: true, truncated: false }
  );
  assert.ok(receipt.executedAt);
  assert.doesNotMatch(receipt.executedAt, /invalid/i);
  assert.equal(Object.prototype.hasOwnProperty.call(receipt, 'executed'), false);
  assert.equal(receipt.result.totalCount, 7380);
});

test('queryCompleteObjectIds accepts ArcGIS array return shape', async () => {
  const { queryCompleteObjectIds } = await import('../public/spatial/deterministic-result-accounting.js');
  const layer = {
    maxRecordCount: 2000,
    queryObjectIds: async () => [1, 2, 3, 4, 5]
  };
  const result = await queryCompleteObjectIds(layer, {});
  assert.equal(result.objectIdQueryUsed, true);
  assert.equal(result.objectIds.length, 5);
});

test('queryCompleteObjectIds falls back to returnIdsOnly queryFeatures', async () => {
  const { queryCompleteObjectIds } = await import('../public/spatial/deterministic-result-accounting.js');
  const layer = {
    maxRecordCount: 2000,
    queryObjectIds: async () => [],
    createQuery: () => ({}),
    queryFeatures: async (query) => {
      assert.equal(query.returnIdsOnly, true);
      return { objectIds: [10, 11, 12] };
    }
  };
  const spatialQuery = {
    clone() { return this; },
    geometry: null,
    spatialRelationship: 'intersects',
    where: '1=1'
  };
  const result = await queryCompleteObjectIds(layer, spatialQuery);
  assert.equal(result.objectIdQueryUsed, true);
  assert.deepEqual(result.objectIds, [10, 11, 12]);
});
