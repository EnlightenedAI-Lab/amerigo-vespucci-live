import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  isAgent2TemporalQuerySupported,
  buildAgent2SearchQueryPlan,
  AGENT2_QUERY_SUPPORT
} from '../public/spatial/open-world-intelligence-temporal-mapping.js';
import { PI_TIME_MODE, PI_KNOWLEDGE_SEMANTICS } from '../public/spatial/point-intelligence-temporal-state.js';
import { buildOpenWorldIntelligenceRequest } from '../public/spatial/open-world-intelligence-request.js';
import { normalizeOpenWorldSearchResponse, pickIncidentTitle } from '../public/spatial/open-world-intelligence-model.js';
import { sanitizeOpenWorldInspectorRecord, assertNoOpenWorldSecretsExposed } from '../public/spatial/open-world-intelligence-inspector-safe.js';
import { INTELLIGENCE_CONNECTORS_ROOT } from '../src/spatial/intelligence-routes-loader.js';

test('KNOWN AS OF requires AT', () => {
  const invalid = isAgent2TemporalQuerySupported({
    timeMode: PI_TIME_MODE.LATEST,
    interpretation: PI_KNOWLEDGE_SEMANTICS.KNOWN_AS_OF
  });
  assert.equal(invalid.status, AGENT2_QUERY_SUPPORT.INVALID);

  const valid = isAgent2TemporalQuerySupported({
    timeMode: PI_TIME_MODE.AT,
    interpretation: PI_KNOWLEDGE_SEMANTICS.KNOWN_AS_OF
  });
  assert.equal(valid.status, AGENT2_QUERY_SUPPORT.SUPPORTED);
});

test('ACTIVE supported for LATEST only', () => {
  assert.equal(isAgent2TemporalQuerySupported({
    timeMode: PI_TIME_MODE.LATEST,
    interpretation: PI_KNOWLEDGE_SEMANTICS.ACTIVE
  }).status, AGENT2_QUERY_SUPPORT.SUPPORTED);

  assert.equal(isAgent2TemporalQuerySupported({
    timeMode: PI_TIME_MODE.RANGE,
    interpretation: PI_KNOWLEDGE_SEMANTICS.ACTIVE
  }).status, AGENT2_QUERY_SUPPORT.UNSUPPORTED);
});

test('buildAgent2SearchQueryPlan maps KNOWN AS OF to AS_OF archive', () => {
  const plan = buildAgent2SearchQueryPlan({
    keyword: 'bridge',
    interpretation: PI_KNOWLEDGE_SEMANTICS.KNOWN_AS_OF,
    temporal: { mode: PI_TIME_MODE.AT, at: '2026-08-05T14:05:00.000Z' }
  });
  assert.equal(plan.ok, true);
  assert.equal(plan.plan.archive.mode, 'AS_OF');
  assert.equal(plan.plan.archive.asOf, '2026-08-05T14:05:00.000Z');
});

test('request builder forbids connector authority fields', () => {
  const blocked = buildOpenWorldIntelligenceRequest({
    keyword: 'bridge',
    connectorUrl: 'http://evil'
  });
  assert.equal(blocked.ok, false);
});

test('OperationalIncident map dedup in normalization', () => {
  const normalized = normalizeOpenWorldSearchResponse({
    incidentsGeoJson: {
      features: [
        { id: 'inc-1', properties: { operationalIncidentId: 'inc-1', memberEventCandidateCount: 5 }, geometry: { type: 'Point', coordinates: [-73.57, 45.50] } },
        { id: 'inc-1-dup', properties: { operationalIncidentId: 'inc-1', memberEventCandidateCount: 5 }, geometry: { type: 'Point', coordinates: [-73.57, 45.50] } }
      ]
    },
    archive: { observations: [] }
  }, { latitude: 45.50, longitude: -73.57, radiusMeters: 5000 });

  assert.equal(normalized.summary.mapIncidentMarkers, 1);
  assert.equal(normalized.accounting.agent2IncidentsReturned, 2);
  assert.equal(normalized.accounting.agent2IncidentsDeduped, 1);
});

test('incident title prefers headline over location label', () => {
  assert.equal(pickIncidentTitle({
    headline: 'heat warning',
    locationLabel: 'QC, CA',
    sourceFamily: 'ECCC'
  }), 'heat warning');

  const normalized = normalizeOpenWorldSearchResponse({
    incidentsGeoJson: {
      features: [{
        id: 'inc-fire',
        geometry: { type: 'Point', coordinates: [-73.57, 45.50] },
        properties: {
          operationalIncidentId: 'inc-fire',
          headline: 'forest fire advisory',
          locationLabel: 'QC, CA',
          sourceFamily: 'ECCC',
          primarySource: 'ECCC Weather Alerts'
        }
      }]
    },
    archive: { observations: [] }
  }, { latitude: 45.50, longitude: -73.57, radiusMeters: 50000 });

  assert.equal(normalized.operationalIncidents[0].title, 'forest fire advisory');
  assert.equal(normalized.operationalIncidents[0].locationLabel, 'QC, CA');
});

test('polygon incidents remain spatial when anchor is inside geometry', () => {
  const normalized = normalizeOpenWorldSearchResponse({
    incidentsGeoJson: {
      features: [{
        id: 'poly-1',
        geometry: {
          type: 'Polygon',
          coordinates: [[
            [-74, 45],
            [-73, 45],
            [-73, 46],
            [-74, 46],
            [-74, 45]
          ]]
        },
        properties: {
          operationalIncidentId: 'poly-1',
          headline: 'area warning',
          locationLabel: 'QC, CA'
        }
      }]
    },
    archive: { observations: [] }
  }, { latitude: 45.50, longitude: -73.57, radiusMeters: 3000 });

  assert.equal(normalized.spatial.length, 1);
  assert.equal(normalized.spatial[0].title, 'area warning');
});

test('non-spatial results retained', () => {
  const safe = sanitizeOpenWorldInspectorRecord({ title: 'ok', apiKey: 'evil', nested: { bearerToken: 'x' } });
  assert.equal(safe.apiKey, '[REDACTED]');
  assert.equal(safe.nested.bearerToken, '[REDACTED]');
  assertNoOpenWorldSecretsExposed(safe);
});

test('KNOWN AS OF archive reconstruction is Agent 2 authoritative', async () => {
  const storeMod = await import(pathToFileURL(resolve(
    INTELLIGENCE_CONNECTORS_ROOT,
    'src/intelligence/storage/store-singleton.js'
  )).href);
  const archiveMod = await import(pathToFileURL(resolve(
    INTELLIGENCE_CONNECTORS_ROOT,
    'src/intelligence/pipeline/observation-archive-search.js'
  )).href);
  const store = storeMod.resetIntelligenceStore(path.join(os.tmpdir(), `owi-asof-${Date.now()}`));
  store.append('observations', {
    observationId: 'obs-early',
    sourceId: 'cbc-news-rss',
    sourceTitle: 'Early article O1',
    publishedAt: '2026-08-05T10:00:00Z',
    retrievedAt: '2026-08-05T10:05:00Z',
    receivedAt: '2026-08-05T10:05:00Z',
    createdAt: '2026-08-05T10:05:00Z',
    publisher: 'CBC'
  });
  store.append('observations', {
    observationId: 'obs-late',
    sourceId: 'cbc-news-rss',
    sourceTitle: 'Late article O2',
    publishedAt: '2026-08-05T14:30:00Z',
    retrievedAt: '2026-08-05T14:20:00Z',
    receivedAt: '2026-08-05T14:20:00Z',
    createdAt: '2026-08-05T14:20:00Z',
    publisher: 'CBC'
  });

  const asOfResult = archiveMod.searchObservationArchive(store, {
    mode: 'AS_OF',
    asOf: '2026-08-05T14:05:00.000Z',
    sourceId: 'cbc-news-rss'
  });
  const asOfIds = (asOfResult.observations || []).map((o) => o.observationId);
  assert.ok(asOfIds.includes('obs-early'));
  assert.ok(!asOfIds.includes('obs-late'));

  const plan = buildAgent2SearchQueryPlan({
    keyword: '',
    interpretation: PI_KNOWLEDGE_SEMANTICS.KNOWN_AS_OF,
    temporal: { mode: PI_TIME_MODE.AT, at: '2026-08-05T14:05:00.000Z' }
  });
  assert.equal(plan.ok, true);
  assert.equal(plan.plan.archive.mode, 'AS_OF');
});
