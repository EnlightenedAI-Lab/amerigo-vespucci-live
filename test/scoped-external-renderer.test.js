import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getSourcePresentation,
  inheritSourceRenderer,
  isScopedLayerSymbolSafe,
  sanitizeRendererForScopedLayer,
  sanitizeSymbolForScopedLayer
} from '../public/spatial/source-presentation.js';

test('scoped layer rejects WebMap style UUID esriPMS without imageData', () => {
  const symbol = {
    type: 'esriPMS',
    url: '83370bd2-1739-4fda-93b7-78a923a531dd',
    width: 10,
    height: 10
  };
  assert.equal(isScopedLayerSymbolSafe(symbol), false);
  assert.equal(sanitizeSymbolForScopedLayer(symbol), null);
});

test('scoped layer sanitizes esriPMS with embedded imageData to picture-marker', () => {
  const symbol = {
    type: 'esriPMS',
    url: '83370bd2-1739-4fda-93b7-78a923a531dd',
    imageData: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    contentType: 'image/png',
    width: 10.5,
    height: 10.5
  };
  assert.equal(isScopedLayerSymbolSafe(symbol), true);
  const sanitized = sanitizeSymbolForScopedLayer(symbol);
  assert.equal(sanitized?.type, 'picture-marker');
  assert.match(sanitized?.url || '', /^data:image\/png;base64,/);
  assert.equal(sanitized?.url.includes('83370bd2'), false);
});

test('pharmacy inherited renderer becomes scoped-safe simple renderer', async () => {
  const presentation = await getSourcePresentation();
  const inherited = inheritSourceRenderer(presentation, 'amenity', 'pharmacy');
  assert.equal(inherited?.type, 'uniqueValue');
  const scoped = sanitizeRendererForScopedLayer(inherited);
  assert.equal(scoped?.type, 'simple');
  assert.equal(scoped?.symbol?.type, 'picture-marker');
  assert.match(scoped?.symbol?.url || '', /^data:image\/png;base64,/);
});

test('simple-marker symbols pass through scoped sanitization', () => {
  const renderer = {
    type: 'simple',
    symbol: {
      type: 'esriSMS',
      style: 'esriSMSCircle',
      color: [80, 80, 80, 255],
      size: 10,
      outline: { color: [255, 255, 255, 255], width: 1.5 }
    }
  };
  const scoped = sanitizeRendererForScopedLayer(renderer);
  assert.equal(scoped?.type, 'simple');
  assert.equal(scoped?.symbol?.type, 'esriSMS');
});
