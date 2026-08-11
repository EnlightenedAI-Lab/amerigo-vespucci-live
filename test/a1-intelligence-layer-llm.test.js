import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  candidateToLiveDocument,
  llmCandidateToEvent,
  resolveSemanticConceptForRequest,
  summarizeIntelligenceEvents
} from '../src/spatial/intelligence-layer-event-pipeline.js';

describe('intelligence-layer event pipeline', () => {
  it('converts LLM candidate to live document without coordinates', () => {
    const doc = candidateToLiveDocument({
      concept: 'shootings',
      title: 'Shots fired on Galt Street',
      description: 'Police responded to reports of gunfire.',
      occurredAt: '2026-08-08T04:00:00.000Z',
      locationText: 'Galt Street near Hadley Street, Montréal',
      municipality: 'Montréal',
      sourceReports: [{
        publisher: 'Noovo Info',
        url: 'https://example.com/article',
        title: 'Shots fired',
        evidenceOrigin: 'live'
      }]
    }, 0);

    assert.equal(doc.sourceUrl, 'https://example.com/article');
    assert.match(doc.excerpt, /Galt Street/i);
    assert.equal(doc.retrievalProvider, 'openai-web-search-v1');
  });

  it('summarizes mapped and unresolved counts', () => {
    const summary = summarizeIntelligenceEvents([
      { mappable: true, geometry: { type: 'Point', coordinates: [-73.5, 45.5] }, sourceReports: [{ sourceUrl: 'https://a.com' }] },
      { mappable: false, geometry: null, sourceReports: [{ sourceUrl: 'https://b.com' }] }
    ]);
    assert.equal(summary.distinctEvents, 2);
    assert.equal(summary.mappable, 1);
    assert.equal(summary.unresolved, 1);
    assert.ok(summary.domains.length >= 1);
  });

  it('maps shootings concept id to firearm semantic concept', () => {
    assert.equal(resolveSemanticConceptForRequest({ conceptId: 'shootings' }), 'FIREARM_INCIDENT');
  });

  it('converts grounded LLM candidate to event without coordinates when geocoding skipped', () => {
    const event = llmCandidateToEvent({
      concept: 'shooting',
      title: 'Shots fired on Galt Street',
      description: 'Police responded to reports of gunfire.',
      occurredAt: '2026-08-08T04:00:00.000Z',
      locationText: 'Galt Street near Hadley Street, Montréal',
      municipality: 'Montréal',
      sourceReports: [{
        publisher: 'Noovo Info',
        url: 'https://example.com/article',
        title: 'Shots fired',
        publishedAt: '2026-08-08',
        evidenceOrigin: 'live'
      }]
    }, 'FIREARM_INCIDENT', 0, { geometry: null, geometrySource: 'SKIPPED', mappable: false });

    assert.equal(event.concept, 'FIREARM_INCIDENT');
    assert.equal(event.mappable, false);
    assert.equal(event.sourceReports[0].sourceUrl, 'https://example.com/article');
    assert.match(event.locationText, /Galt Street/i);
  });
});
