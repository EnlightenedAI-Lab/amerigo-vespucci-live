import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { llmCandidateToEvent } from '../src/spatial/intelligence-layer-event-pipeline.js';
import { applyIntelligenceLayerTemporalGate } from '../src/spatial/intelligence-layer-temporal-gate.js';
import {
  initializeReportDispositionLedger,
  recordTemporalDisposition,
  summarizeReportDispositions,
  REPORT_DISPOSITION
} from '../src/spatial/report-disposition-ledger.js';
import { expandArcgisDiscoveryQueries } from '../public/spatial/arcgis-discovery-query-expansion.js';
import {
  rankArcgisDiscoveryResults,
  assessArcgisItemAuthority
} from '../public/spatial/arcgis-discovery-qualification.js';
import {
  extractArcgisDiscoverySearchQuery,
  resolveArcgisDiscoverySources
} from '../public/spatial/arcgis-data-add-discovery-command.js';

describe('intelligence occurrence preservation', () => {
  it('preserves source-backed occurredAt with occurrenceSource for lineage enrichment', () => {
    const event = llmCandidateToEvent({
      title: 'Structure fire on Rue Saint-Denis',
      description: 'Fire reported overnight',
      occurredAt: '2026-08-01T03:00:00Z',
      publishedAt: '2026-08-01T08:00:00Z',
      locationText: 'Rue Saint-Denis, Montréal',
      sourceReports: [{
        publisher: 'CBC',
        url: 'https://www.cbc.ca/news/example-fire',
        title: 'Fire on Saint-Denis',
        publishedAt: '2026-08-01T08:00:00Z',
        evidenceOrigin: 'live'
      }]
    }, 'FIRE_INCIDENT', 0, {
      geometry: { type: 'Point', coordinates: [-73.56, 45.51] },
      geometrySource: 'quebec-geocoder',
      mappable: true
    });

    assert.equal(event.occurredAt, '2026-08-01T03:00:00Z');
    assert.equal(event.occurrenceSource, 'SOURCE_EXTRACTION');
    assert.notEqual(event.occurredAt, event.publishedAt);
  });

  it('does not assign occurrenceSource for grounding fallback without occurredAt', () => {
    const event = llmCandidateToEvent({
      title: 'Reported incident',
      occurredAt: null,
      publishedAt: null,
      locationText: '',
      _groundingFallback: true,
      sourceReports: [{
        publisher: 'Web',
        url: 'https://example.com/report',
        title: 'Report',
        publishedAt: null,
        evidenceOrigin: 'live'
      }]
    }, 'FIRE_INCIDENT', 0, { geometry: null, mappable: false });

    assert.equal(event.occurredAt, null);
    assert.equal(event.occurrenceSource, null);
  });

  it('admits events with occurrenceSource through temporal gate', () => {
    const event = llmCandidateToEvent({
      title: 'Recent fire',
      occurredAt: '2026-08-08T02:00:00Z',
      publishedAt: '2026-08-08T06:00:00Z',
      locationText: 'Montréal',
      sourceReports: [{
        publisher: 'News',
        url: 'https://example.com/fire',
        title: 'Fire',
        publishedAt: '2026-08-08T06:00:00Z',
        evidenceOrigin: 'live'
      }]
    }, 'FIRE_INCIDENT', 0, { geometry: null, mappable: false });

    const gated = applyIntelligenceLayerTemporalGate([event], {
      from: '2026-07-11T00:00:00Z',
      to: '2026-08-10T23:59:59Z',
      temporalField: 'OCCURRED'
    });
    assert.equal(gated.events.length, 1);
    assert.equal(gated.events[0].occurredAt, '2026-08-08T02:00:00Z');
  });
});

describe('report disposition ledger', () => {
  it('tracks retrieved report to candidate to temporal rejection', () => {
    const ledger = initializeReportDispositionLedger([{
      title: 'Fire A',
      occurredAt: null,
      sourceReports: [{ url: 'https://example.com/a', title: 'A', publisher: 'News' }]
    }], [{ uri: 'https://example.com/a', title: 'A' }]);

    const event = {
      title: 'Fire A',
      occurredAt: null,
      sourceReports: [{ sourceUrl: 'https://example.com/a' }]
    };
    recordTemporalDisposition(ledger, event, {
      admitted: false,
      reason: 'UNKNOWN_OCCURRENCE'
    });

    const summary = summarizeReportDispositions(ledger);
    assert.equal(summary.reportsRetrieved, 1);
    assert.equal(summary.missingOccurrence, 1);
    assert.equal(ledger.entries[0].disposition, REPORT_DISPOSITION.MISSING_OCCURRENCE_TIME);
  });
});

describe('arcgis discovery expansion and qualification', () => {
  it('expands Montréal borough boundary queries bilingually', () => {
    const queries = expandArcgisDiscoveryQueries('Montréal borough boundaries');
    assert.ok(queries.includes('Montréal borough boundaries'));
    assert.ok(queries.some((q) => /arrondissement/i.test(q)));
    assert.ok(queries.some((q) => /Montreal/i.test(q) && !/Montréal/.test(q)));
  });

  it('does not force Living Atlas for authoritative municipal prompts', () => {
    const sources = resolveArcgisDiscoverySources(
      'Find an authoritative ArcGIS layer showing Montréal borough boundaries and add it to the map.'
    );
    assert.equal(sources[0], 'arcgis-online');
  });

  it('ranks Ville de Montréal borough layers above unrelated results', () => {
    const ranked = rankArcgisDiscoveryResults([
      {
        id: 'aaa',
        title: 'Random global layer',
        owner: 'someuser',
        type: 'Feature Service',
        snippet: 'generic'
      },
      {
        id: 'bbb',
        title: 'Limites des arrondissements',
        owner: 'ville.montreal.qc.ca',
        type: 'Feature Service',
        snippet: 'borough boundaries Montreal'
      }
    ], 'Montréal borough boundaries');

    assert.equal(ranked[0].id, 'bbb');
    assert.match(ranked[0].authorityBasis, /Ville de Montréal/i);
  });

  it('does not grant municipal authority from metadata alone', () => {
    const authority = assessArcgisItemAuthority({
      owner: 'abdelk42_utoronto',
      title: 'Built Environment Features',
      snippet: 'Données ouvertes Montréal cycling data'
    });
    assert.equal(authority.authorityWeight, 40);
    assert.match(authority.authorityBasis, /unverified|Montreal keyword/i);
  });

  it('grants authority when item provenance cites donnees.montreal.ca', () => {
    const authority = assessArcgisItemAuthority({
      owner: 'uqam2142',
      title: 'Réseau cyclable de la VDM',
      description: 'Couche provient de https://donnees.montreal.ca/dataset/pistes-cyclables'
    });
    assert.equal(authority.authorityWeight, 92);
    assert.match(authority.authorityBasis, /donnees\.montreal\.ca/i);
  });

  it('extracts borough query without hard-coded item id', () => {
    const query = extractArcgisDiscoverySearchQuery(
      'Find an authoritative ArcGIS layer showing Montréal borough boundaries and add it to the map.'
    );
    assert.match(query, /borough boundaries/i);
    assert.doesNotMatch(query, /[a-f0-9]{32}/i);
  });
});

describe('presentation isolation helpers', () => {
  it('assesses authority from actual owner metadata only', () => {
    const authority = assessArcgisItemAuthority({
      owner: 'ville.montreal.qc.ca',
      title: 'Arrondissements',
      snippet: 'Administrative boundaries'
    });
    assert.equal(authority.authorityLabel, 'Ville de Montréal');
  });
});
