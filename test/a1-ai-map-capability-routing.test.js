import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { extractArcgisDiscoverySearchQuery } from '../public/spatial/arcgis-data-add-discovery-command.js';
import { parseIntelligenceMapIntent } from '../public/spatial/intelligence-layer-intent.js';

describe('ArcGIS discovery command helpers', () => {
  it('extracts borough boundary search query from NL prompt', () => {
    const query = extractArcgisDiscoverySearchQuery(
      'Find an authoritative ArcGIS layer showing Montréal borough boundaries and add it to the map.'
    );
    assert.match(query, /borough boundaries/i);
    assert.match(query, /montréal|montreal/i);
  });
});

describe('intelligence intent guard against non-intelligence objectives', () => {
  it('does not parse Starbucks POI as intelligence research', () => {
    assert.equal(parseIntelligenceMapIntent('map starbucks near 997 de la commune'), null);
  });

  it('does not parse ArcGIS discovery as intelligence research', () => {
    assert.equal(
      parseIntelligenceMapIntent('Find an authoritative ArcGIS layer showing Montréal borough boundaries and add it to the map.'),
      null
    );
  });
});
