import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseIntelligenceMapIntent, buildIntelligenceRequestFromIntent, classifyIntelligenceConceptId } from '../public/spatial/intelligence-layer-intent.js';
import { planSpatialCapability } from '../public/spatial/spatial-capability-router.js';
import {
  normalizeIntelligenceSearchResponse,
  formatIntelligenceResultMessage
} from '../public/spatial/intelligence-layer-model.js';
import {
  registerIntelligenceLayer,
  buildIntelligenceLayerIdentity,
  isIntelligenceLayerId
} from '../public/spatial/intelligence-layer-registry.js';
import { buildLiveSearchPayload } from '../public/spatial/intelligence-layer-request.js';
import { resolveTimeWindowDates, TIME_WINDOWS } from '../public/spatial/intelligence-layer-config.js';

describe('intelligence-layer intent', () => {
  it('parses shootings Montreal last 7 days command', () => {
    const intent = parseIntelligenceMapIntent('Map shootings reported in Montreal in the last 7 days');
    assert.ok(intent);
    assert.equal(intent.action, 'CREATE_INTELLIGENCE_LAYER');
    assert.match(intent.query, /shootings/i);
    assert.equal(intent.geography, 'Greater Montréal');
    assert.equal(intent.timeWindow, TIME_WINDOWS.DAYS_7);
    assert.equal(intent.includeLive, true);
  });

  it('parses Quebec fires with 48 hour window as 24h bucket', () => {
    const intent = parseIntelligenceMapIntent('Map fires reported in Quebec in the last 48 hours');
    assert.ok(intent);
    assert.equal(intent.geography, 'Québec');
    assert.match(intent.query, /fires/i);
  });

  it('returns null for unrelated GIS prompts', () => {
    assert.equal(parseIntelligenceMapIntent('Map fire stations within 3 km of 997 de la Commune'), null);
  });

  it('classifies fires/explosions/hazmat objective without shootings contamination', () => {
    const prompt = 'Find significant fires, explosions, or hazmat incidents in Montréal in the last 30 days and map them.';
    const intent = parseIntelligenceMapIntent(prompt);
    assert.ok(intent);
    assert.equal(intent.conceptId, 'fires');
    assert.ok(!/shootings/i.test(intent.query));
    assert.ok(!/firearm/i.test(intent.query));

    const request = buildIntelligenceRequestFromIntent(intent);
    assert.equal(request.conceptId, 'fires');
    assert.equal(request.conceptLabel, 'Fires');
    assert.ok(!/shootings/i.test(request.query));

    const normalized = normalizeIntelligenceSearchResponse({
      query: request.query,
      geographicScope: { label: intent.geography },
      events: [],
      combined: { distinctEvents: 0, mappable: 0, unresolved: 0 },
      executionStatus: 'SUCCESS',
      liveRetrieval: { status: 'SUCCESS' }
    }, request);
    assert.match(normalized.layerTitle, /Fires/);
    assert.doesNotMatch(normalized.layerTitle, /Shootings/);
  });

  it('classifies shootings objective distinctly from fires/hazmat', () => {
    const prompt = 'Find shootings or firearm incidents in Montréal in the last 30 days and map them.';
    const intent = parseIntelligenceMapIntent(prompt);
    assert.ok(intent);
    assert.equal(intent.conceptId, 'shootings');
    assert.match(intent.query, /shootings|firearm/i);

    const request = buildIntelligenceRequestFromIntent(intent);
    const normalized = normalizeIntelligenceSearchResponse({
      query: request.query,
      geographicScope: { label: intent.geography },
      events: [],
      combined: { distinctEvents: 0, mappable: 0, unresolved: 0 },
      executionStatus: 'SUCCESS',
      liveRetrieval: { status: 'SUCCESS' }
    }, request);
    assert.match(normalized.layerTitle, /Shootings/);
    assert.doesNotMatch(normalized.layerTitle, /\bFires\b/);
  });

  it('does not inherit stale category across sequential AI MAP objectives', () => {
    const shootings = parseIntelligenceMapIntent('Find shootings or firearm incidents in Montréal in the last 30 days and map them.');
    assert.equal(shootings.conceptId, 'shootings');

    const fires = parseIntelligenceMapIntent('Find significant fires, explosions, or hazmat incidents in Montréal in the last 30 days and map them.');
    assert.equal(fires.conceptId, 'fires');
    assert.notEqual(fires.conceptId, shootings.conceptId);

    const firesAgain = parseIntelligenceMapIntent('Find significant fires, explosions, or hazmat incidents in Montréal in the last 30 days and map them.');
    assert.equal(firesAgain.conceptId, 'fires');
  });

  it('routes explicit AI MAP objective through capability router without prior-category leakage', () => {
    planSpatialCapability('Find shootings or firearm incidents in Montréal in the last 30 days and map them.');
    const plan = planSpatialCapability('Find significant fires, explosions, or hazmat incidents in Montréal in the last 30 days and map them.');
    assert.equal(plan.capability, 'INTELLIGENCE_RESEARCH');
    assert.equal(plan.parsedIntent.conceptId, 'fires');
  });

  it('leaves deterministic GIS commands outside intelligence classification', () => {
    assert.equal(classifyIntelligenceConceptId('Map fire stations within 3 km of 997 de la Commune'), null);
    assert.equal(parseIntelligenceMapIntent('Map fire stations within 3 km of 997 de la Commune'), null);
    const plan = planSpatialCapability('Map fire stations within 3 km of 997 de la Commune');
    assert.notEqual(plan.capability, 'INTELLIGENCE_RESEARCH');
  });
});

describe('intelligence-layer request', () => {
  it('builds live-search payload with production corpus and live retrieval', () => {
    const request = buildIntelligenceRequestFromIntent({
      conceptId: 'shootings',
      geography: 'Greater Montréal',
      timeWindow: TIME_WINDOWS.DAYS_7
    });
    const payload = buildLiveSearchPayload(request);
    assert.equal(payload.conceptId, 'shootings');
    assert.equal(payload.corpusMode, 'production');
    assert.equal(payload.includeLive, true);
    assert.equal(payload.temporalField, 'OCCURRED');
    assert.ok(payload.from);
    assert.ok(payload.to);
  });
});

describe('intelligence-layer model', () => {
  it('normalizes mappable and unresolved counts from live-search shape', () => {
    const normalized = normalizeIntelligenceSearchResponse({
      query: 'shootings',
      geographicScope: { label: 'Greater Montréal' },
      events: [
        { eventId: 'a', mappable: true, geometry: { type: 'Point', coordinates: [-73.5, 45.5] }, title: 'A' },
        { eventId: 'b', mappable: false, title: 'B' }
      ],
      combined: { distinctEvents: 2, mappable: 1, unresolved: 1 },
      executionStatus: 'SUCCESS',
      liveRetrieval: { status: 'SUCCESS' }
    }, {
      query: 'shootings',
      conceptLabel: 'Shootings / Firearm Incidents',
      geography: 'Greater Montréal',
      timeLabel: 'Last 7 days'
    });

    assert.equal(normalized.totalEvents, 2);
    assert.equal(normalized.mappedCount, 1);
    assert.equal(normalized.unresolvedCount, 1);
    assert.match(normalized.layerTitle, /Shootings/);
    assert.match(normalized.layerTitle, /Greater Montréal/);
  });

  it('formats operational result message from actual counts', () => {
    const message = formatIntelligenceResultMessage({
      totalEvents: 5,
      mappedCount: 3,
      unresolvedCount: 2,
      geography: 'Greater Montréal',
      timeLabel: 'Last 7 days',
      layerTitle: 'Shootings — Greater Montréal — Last 7 days'
    });
    assert.match(message, /5 distinct events/);
    assert.match(message, /3 had supported map locations/);
    assert.match(message, /2 remain location-unresolved/);
  });
});

describe('intelligence-layer registry', () => {
  it('assigns stable iqai-intel layer ids', () => {
    const request = buildIntelligenceRequestFromIntent({
      conceptId: 'fires',
      geography: 'Greater Montréal',
      timeWindow: TIME_WINDOWS.DAYS_7
    });
    const identity = buildIntelligenceLayerIdentity(request);
    const first = registerIntelligenceLayer({ request, identity });
    assert.ok(isIntelligenceLayerId(first.layerId));
    const second = registerIntelligenceLayer({ request, identity });
    assert.equal(second.replaced, true);
  });
});

describe('intelligence-layer time windows', () => {
  it('resolves 7-day window dates', () => {
    const now = new Date('2026-08-10T12:00:00.000Z');
    const { from, to, label } = resolveTimeWindowDates(TIME_WINDOWS.DAYS_7, now);
    assert.equal(label, 'Last 7 days');
    assert.ok(new Date(from) < new Date(to));
  });
});
