import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveResearchMode,
  resolveResearchExecution,
  dedupeResearchCandidates,
  countGroundedSourceReports,
  createResearchPerformanceTimeline,
  RESEARCH_MODE,
  RESEARCH_EXECUTION
} from '../src/spatial/intelligence-layer-research-contract.js';
import {
  planSpatialCapability,
  SPATIAL_CAPABILITY
} from '../public/spatial/spatial-capability-router.js';
import { buildResearchControlBarModel } from '../public/spatial/intelligence-research-control-bar.js';

describe('intelligence research provider contract', () => {
  it('defaults to FAST Gemini when Gemini key exists', () => {
    const originalOpenAi = process.env.OPENAI_API_KEY;
    const originalGemini = process.env.GEMINI_API_KEY;
    process.env.OPENAI_API_KEY = 'test-openai';
    process.env.GEMINI_API_KEY = 'test-gemini';
    assert.equal(resolveResearchExecution({}), RESEARCH_EXECUTION.FAST);
    assert.equal(resolveResearchMode({}), RESEARCH_MODE.GEMINI);
    process.env.OPENAI_API_KEY = originalOpenAi;
    process.env.GEMINI_API_KEY = originalGemini;
  });

  it('uses DEEP multi-provider when execution profile is DEEP', () => {
    const originalOpenAi = process.env.OPENAI_API_KEY;
    const originalGemini = process.env.GEMINI_API_KEY;
    process.env.OPENAI_API_KEY = 'test-openai';
    process.env.GEMINI_API_KEY = 'test-gemini';
    assert.equal(resolveResearchMode({ researchExecution: 'DEEP' }), RESEARCH_MODE.MULTI);
    process.env.OPENAI_API_KEY = originalOpenAi;
    process.env.GEMINI_API_KEY = originalGemini;
  });

  it('builds performance timeline with first mappable timing', () => {
    const timeline = createResearchPerformanceTimeline();
    const started = Date.now();
    timeline.mark('requestAcknowledged');
    timeline.mark('firstMappableEvent');
    timeline.mark('researchComplete');
    const payload = timeline.toPayload(started);
    assert.ok(payload.timeToFirstMappableEventMs >= 0);
    assert.ok(payload.totalResearchTimeMs >= 0);
  });

  it('honors explicit GEMINI mode even when credentials are missing', () => {
    const originalGemini = process.env.GEMINI_API_KEY;
    delete process.env.GEMINI_API_KEY;
    assert.equal(resolveResearchMode({ researchProvider: 'GEMINI' }), RESEARCH_MODE.GEMINI);
    process.env.GEMINI_API_KEY = originalGemini;
  });

  it('dedupes duplicate provider candidates conservatively', () => {
    const merged = dedupeResearchCandidates([
      {
        provider: 'openai-web-search',
        candidates: [{
          title: 'Shooting',
          occurredAt: '2026-07-30T19:30:00Z',
          locationText: 'Rue A',
          sourceReports: [{ url: 'https://example.com/a' }]
        }]
      },
      {
        provider: 'gemini-google-search',
        candidates: [{
          title: 'Shooting',
          occurredAt: '2026-07-30T19:30:00Z',
          locationText: 'Rue A',
          sourceReports: [{ url: 'https://example.com/a' }]
        }]
      }
    ]);
    assert.equal(merged.length, 2);
  });

  it('counts grounded source reports and domains', () => {
    const stats = countGroundedSourceReports([
      {
        sourceReports: [
          { url: 'https://www.lapresse.ca/a', title: 'Fusillade', publisher: 'La Presse' },
          { url: 'https://www.cbc.ca/b', title: 'Shooting', publisher: 'CBC' }
        ]
      }
    ]);
    assert.equal(stats.rawSourceReports, 2);
    assert.equal(stats.distinctUrls, 2);
    assert.ok(stats.domains.includes('lapresse.ca'));
  });
});

describe('spatial capability router', () => {
  it('routes shootings NL to intelligence research', () => {
    const plan = planSpatialCapability('Map shootings reported in Montreal in the last 30 days');
    assert.equal(plan.capability, SPATIAL_CAPABILITY.INTELLIGENCE_RESEARCH);
    assert.equal(plan.available, true);
  });

  it('routes fires/hazmat intelligence without shootings contamination', () => {
    const plan = planSpatialCapability('Find significant fires, explosions, or hazmat incidents in Montréal in the last 30 days and map them.');
    assert.equal(plan.capability, SPATIAL_CAPABILITY.INTELLIGENCE_RESEARCH);
    assert.equal(plan.parsedIntent.conceptId, 'fires');
  });

  it('routes Starbucks POI without intelligence fabrication', () => {
    const plan = planSpatialCapability('map starbucks near 997 de la commune');
    assert.equal(plan.capability, SPATIAL_CAPABILITY.PLACE_POI_SEARCH);
    assert.equal(plan.available, true);
    assert.equal(plan.executionAuthority, 'PLACE_POI_SERVICE');
  });

  it('routes ArcGIS borough boundary discovery without intelligence layer fabrication', () => {
    const plan = planSpatialCapability('Find an authoritative ArcGIS layer showing Montréal borough boundaries and add it to the map.');
    assert.equal(plan.capability, SPATIAL_CAPABILITY.ARCGIS_DATA_DISCOVERY);
    assert.equal(plan.available, true);
    assert.notEqual(plan.capability, SPATIAL_CAPABILITY.INTELLIGENCE_RESEARCH);
  });

  it('routes clear map to deterministic GIS', () => {
    const plan = planSpatialCapability('clear map');
    assert.equal(plan.capability, SPATIAL_CAPABILITY.DETERMINISTIC_GIS);
    assert.equal(plan.available, true);
  });

  it('routes GIS prompts to deterministic GIS', () => {
    const plan = planSpatialCapability('Map fire stations within 3 km of 997 de la Commune');
    assert.equal(plan.capability, SPATIAL_CAPABILITY.DETERMINISTIC_GIS);
    assert.equal(plan.available, true);
  });

  it('routes semantic GIS radius prompts to deterministic GIS, not perimeter analysis', () => {
    const toilets = planSpatialCapability('map toilets 500 meters from 997 de la commune');
    const toiletsWithin = planSpatialCapability('map toilets within 500 meters of 997 de la commune');
    const bathrooms = planSpatialCapability('Show bathrooms within 5 km of 997 de la Commune');
    assert.equal(toilets.capability, SPATIAL_CAPABILITY.DETERMINISTIC_GIS);
    assert.equal(toilets.available, true);
    assert.equal(toiletsWithin.capability, SPATIAL_CAPABILITY.DETERMINISTIC_GIS);
    assert.equal(toiletsWithin.available, true);
    assert.equal(bathrooms.capability, SPATIAL_CAPABILITY.DETERMINISTIC_GIS);
    assert.equal(bathrooms.available, true);
  });

  it('routes selected-event evidence questions to point intelligence', () => {
    const plan = planSpatialCapability('Why is this event on the map?');
    assert.equal(plan.capability, SPATIAL_CAPABILITY.POINT_INTELLIGENCE);
  });

  it('does not inherit stale capability across sequential prompts', () => {
    const intelligence = planSpatialCapability('Find significant fires, explosions, or hazmat incidents in Montréal in the last 30 days and map them.');
    const clear = planSpatialCapability('clear map');
    const arcgis = planSpatialCapability('Find an authoritative ArcGIS layer showing Montréal borough boundaries and add it to the map.');
    const gis = planSpatialCapability('Map fire stations within 3 km of 997 de la Commune');
    const poi = planSpatialCapability('Map Starbucks near 997 de la Commune');
    const intelligenceAgain = planSpatialCapability('Find significant fires, explosions, or hazmat incidents in Montréal in the last 30 days and map them.');

    assert.equal(intelligence.capability, SPATIAL_CAPABILITY.INTELLIGENCE_RESEARCH);
    assert.equal(clear.capability, SPATIAL_CAPABILITY.DETERMINISTIC_GIS);
    assert.equal(arcgis.capability, SPATIAL_CAPABILITY.ARCGIS_DATA_DISCOVERY);
    assert.equal(gis.capability, SPATIAL_CAPABILITY.DETERMINISTIC_GIS);
    assert.equal(poi.capability, SPATIAL_CAPABILITY.PLACE_POI_SEARCH);
    assert.equal(poi.available, true);
    assert.equal(intelligenceAgain.capability, SPATIAL_CAPABILITY.INTELLIGENCE_RESEARCH);
    assert.equal(intelligenceAgain.parsedIntent.conceptId, 'fires');
  });

  it('recognizes Starbucks POI intent with execution available', () => {
    const plan = planSpatialCapability('Show all Starbucks in Montreal');
    assert.equal(plan.capability, SPATIAL_CAPABILITY.PLACE_POI_SEARCH);
    assert.equal(plan.available, true);
    assert.equal(plan.executionAuthority, 'PLACE_POI_SERVICE');
  });
});

describe('research control bar model', () => {
  it('builds metrics from real execution metadata', () => {
    const model = buildResearchControlBarModel({
      layers: [{
        normalized: {
          layerTitle: 'Shootings',
          totalEvents: 2,
          mappedCount: 1,
          unresolvedCount: 1,
          combined: { domains: ['spvm.qc.ca', 'cbc.ca'] },
          researchAudit: {
            mode: 'GEMINI',
            execution: 'FAST',
            openaiInvoked: false,
            geminiInvoked: true,
            googleSearchInvoked: true,
            iqaiCorpusInvoked: true
          },
          temporalGate: { rejected: 1 }
        },
        raw: {
          researchConsolidation: { rawSourceReports: 5 },
          researchPerformance: { timeToFirstMappableEventMs: 4200 }
        }
      }]
    });
    assert.equal(model.research.providers, 'GEMINI · IQAI');
    assert.equal(model.evidence.reports, 5);
    assert.equal(model.evidence.domains, 2);
    assert.equal(model.spatial.mapped, 1);
    assert.equal(model.temporal.label, 'IN WINDOW');
    assert.equal(model.retrieval, 'SUCCESS');
    assert.equal(model.coverage, 'OPEN WEB · NON-EXHAUSTIVE');
  });

  it('does not show GPT when OpenAI did not participate', () => {
    const model = buildResearchControlBarModel({
      layers: [{
        normalized: {
          totalEvents: 1,
          mappedCount: 1,
          unresolvedCount: 0,
          researchAudit: {
            openaiInvoked: false,
            geminiInvoked: true,
            googleSearchInvoked: true,
            iqaiCorpusInvoked: true
          }
        },
        raw: { researchConsolidation: { rawSourceReports: 2 } }
      }]
    });
    assert.equal(model.research.providers, 'GEMINI · IQAI');
    assert.ok(!model.research.providers.includes('GPT'));
  });
});
