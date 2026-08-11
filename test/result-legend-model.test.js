import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildResultScopedLegend,
  deriveResultCategoryCounts,
  normalizeRendererClassValue,
  resolveRendererClass,
  buildRendererClassIndex,
  legendSymbolUrlFromSource
} from '../public/spatial/result-legend-model.js';
import { getSourcePresentation } from '../public/spatial/source-presentation.js';

test('deriveResultCategoryCounts excludes zero-count and ignores semanticValue fallback', () => {
  const mapResult = {
    supported: true,
    datasetResults: [{
      renderMeta: { semanticField: 'amenity', semanticValue: 'bench' },
      features: [
        { rawAttributes: { amenity: 'restaurant' } },
        { rawAttributes: { amenity: 'restaurant' } },
        { rawAttributes: { amenity: 'cafe' } }
      ]
    }],
    summary: { matchedFeatures: 3 }
  };
  const counts = deriveResultCategoryCounts(mapResult);
  assert.equal(counts.categories.length, 2);
  assert.equal(counts.categories.find((entry) => entry.value === 'bench'), undefined);
  assert.equal(counts.categories.find((entry) => entry.value === 'restaurant')?.count, 2);
});

test('renderer class matching is value-based not label-based', () => {
  const index = buildRendererClassIndex({
    type: 'uniqueValue',
    field1: 'amenity',
    uniqueValueInfos: [{
      value: 'bicycle_parking',
      label: 'Bicycle Parking',
      symbol: { type: 'esriPMS', imageData: 'abc', contentType: 'image/png', width: 10, height: 10 }
    }]
  });
  const match = resolveRendererClass(index, 'bicycle_parking');
  assert.equal(match?.rawValue, 'bicycle_parking');
  assert.equal(match?.label, 'Bicycle Parking');
  assert.equal(resolveRendererClass(index, 'Bicycle Parking'), null);
});

test('normalizeRendererClassValue trims and lowercases', () => {
  assert.equal(normalizeRendererClassValue('  Bench '), 'bench');
  assert.equal(normalizeRendererClassValue(12), '12');
});

test('buildResultScopedLegend only includes present result categories with source symbols', async () => {
  const presentation = await getSourcePresentation();
  const mapResult = {
    supported: true,
    summary: { matchedFeatures: 4 },
    datasetResults: [{
      renderMeta: { semanticField: 'amenity' },
      features: [
        { rawAttributes: { amenity: 'bench' } },
        { rawAttributes: { amenity: 'bench' } },
        { rawAttributes: { amenity: 'restaurant' } },
        { rawAttributes: { amenity: 'cafe' } }
      ]
    }]
  };
  const legend = buildResultScopedLegend(mapResult, presentation);
  assert.equal(legend.resultCategoryCount, 3);
  assert.ok(legend.sourceRendererClassCount >= 30);
  assert.ok(legend.sourceRendererClassCount > legend.resultCategoryCount);
  assert.equal(legend.entries.length, 3);
  assert.ok(legend.entries.every((entry) => entry.resultCount > 0));
  assert.ok(legend.entries.every((entry) => entry.symbolUrl));
  assert.ok(legend.entries.every((entry) => entry.sourceClassMatched));
  assert.deepEqual(legend.unmatchedLegendCategories, []);
});

test('legendSymbolUrlFromSource uses sanitized picture-marker data URL', () => {
  const url = legendSymbolUrlFromSource({
    type: 'esriPMS',
    imageData: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    contentType: 'image/png',
    width: 10,
    height: 10
  });
  assert.match(url || '', /^data:image\/png;base64,/);
});
