/**
 * Convert LLM research candidates into geocoded events via Agent 2 pipeline.
 */
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { INTELLIGENCE_CONNECTORS_ROOT } from './intelligence-routes-loader.js';
import { normalizeTemporalInstant } from './intelligence-layer-temporal-gate.js';

let connectorsCache = null;

const LAYER_CONCEPT_TO_SEMANTIC = Object.freeze({
  shootings: 'FIREARM_INCIDENT',
  fires: 'FIRE_INCIDENT',
  traffic: 'COLLISION_INCIDENT',
  kidnappings: 'MISSING_PERSON_INCIDENT',
  crime: 'ROBBERY_INCIDENT'
});

const LIVE_RESOLVER_IDS = ['quebec-geocoder', 'canada-news-geocoder'];

async function loadConnectors() {
  if (connectorsCache) return connectorsCache;
  const base = INTELLIGENCE_CONNECTORS_ROOT;
  const [
    searchPlanMod,
    dedupMod,
    semanticMod,
    locationMod
  ] = await Promise.all([
    import(pathToFileURL(resolve(base, 'src/intelligence/pipeline/intelligence-search-plan.js')).href),
    import(pathToFileURL(resolve(base, 'src/intelligence/retrieval/live-event-dedup.js')).href),
    import(pathToFileURL(resolve(base, 'src/intelligence/pipeline/intelligence-semantic-concepts.js')).href),
    import(pathToFileURL(resolve(base, 'src/intelligence/location/location-resolver.js')).href)
  ]);
  connectorsCache = { searchPlanMod, dedupMod, semanticMod, locationMod };
  return connectorsCache;
}

/**
 * @param {object} request
 * @param {object[]} candidates
 * @param {object} [semanticMod]
 */
export function resolveSemanticConceptForRequest(request = {}, candidates = [], semanticMod = null) {
  if (request.semanticConceptId) return request.semanticConceptId;
  if (request.conceptId && LAYER_CONCEPT_TO_SEMANTIC[request.conceptId]) {
    return LAYER_CONCEPT_TO_SEMANTIC[request.conceptId];
  }

  const resolveFromQuery = semanticMod?.resolveSemanticConceptFromQuery;
  if (!resolveFromQuery) return null;

  const direct = resolveFromQuery(request.query || '');
  if (direct) return direct;

  for (const token of String(request.query || '').split(/\s+/)) {
    const concept = resolveFromQuery(token);
    if (concept) return concept;
  }

  for (const candidate of candidates) {
    const concept = resolveFromQuery(candidate.concept || candidate.title || '');
    if (concept) return concept;
  }

  return null;
}

/**
 * @param {object} candidate
 * @param {number} index
 */
export function candidateToLiveDocument(candidate, index = 0, options = {}) {
  const primary = Array.isArray(candidate.sourceReports) ? candidate.sourceReports[0] : null;
  const url = primary?.url || null;
  const title = candidate.title || primary?.title || 'Untitled event';
  const retrievalProvider = options.retrievalProvider || 'openai-web-search-v1';
  const sourceId = options.researchOrigin || 'openai-web-research';
  const excerpt = [
    candidate.description || '',
    candidate.locationText ? `Location: ${candidate.locationText}` : '',
    candidate.municipality ? `Municipality: ${candidate.municipality}` : '',
    candidate.neighbourhood ? `Neighbourhood: ${candidate.neighbourhood}` : ''
  ].filter(Boolean).join('\n');

  return {
    documentId: `llm-web-${index}-${Buffer.from(String(url || title)).toString('base64url').slice(0, 24)}`,
    sourceId,
    sourceName: primary?.publisher || 'Web source',
    sourceUrl: url,
    publishedAt: candidate.publishedAt || candidate.occurredAt || null,
    retrievedAt: new Date().toISOString(),
    title,
    excerpt,
    articleContent: excerpt,
    language: 'unknown',
    retrievalProvider,
    provenance: {
      acquisitionMode: 'SESSION',
      evidenceOrigin: primary?.evidenceOrigin || 'live',
      llmResearch: true
    }
  };
}

function buildSourceReports(candidate, index = 0, options = {}) {
  const retrievalProvider = options.retrievalProvider || 'openai-web-search-v1';
  const sourceId = options.researchOrigin || 'openai-web-research';
  return (candidate.sourceReports || [])
    .filter((report) => report?.url)
    .map((report) => ({
      evidenceOrigin: report.evidenceOrigin || 'live',
      documentId: `llm-web-${index}-${Buffer.from(String(report.url)).toString('base64url').slice(0, 24)}`,
      sourceId,
      sourceName: report.publisher || 'Web source',
      sourceUrl: report.url,
      publishedAt: report.publishedAt || candidate.publishedAt || candidate.occurredAt || null,
      retrievedAt: new Date().toISOString(),
      title: report.title || candidate.title,
      excerpt: candidate.description || '',
      language: 'unknown',
      retrievalProvider,
      provenance: {
        acquisitionMode: 'SESSION',
        evidenceOrigin: report.evidenceOrigin || 'live',
        llmResearch: true
      }
    }));
}

async function resolveLiveGeometry(locationText, request, locationMod, trace = null) {
  if (!locationText) return { geometry: null, geometrySource: null, mappable: false };
  if (request.skipGeocoding) return { geometry: null, geometrySource: 'SKIPPED', mappable: false };

  const started = Date.now();
  const resolvers = locationMod.getResolvers(LIVE_RESOLVER_IDS);
  const candidates = await locationMod.resolveLocation(locationText, resolvers);
  const durationMs = Date.now() - started;
  const best = candidates
    .filter((c) => c.candidateGeometry?.coordinates?.length === 2)
    .sort((a, b) => (b.confidence || 0) - (a.confidence || 0))[0];
  trace?.recordAgent2Call({
    name: 'location-resolve',
    durationMs,
    roundTripMs: durationMs
  });
  if (!best) {
    trace?.recordGeocode({ durationMs, success: false, mappable: false });
    return { geometry: null, geometrySource: null, mappable: false };
  }
  const mappable = (best.confidence || 0) >= 0.7;
  trace?.recordGeocode({
    durationMs,
    success: true,
    mappable,
    resolver: best.resolver || null
  });
  return {
    geometry: best.candidateGeometry,
    geometrySource: best.resolver,
    mappable
  };
}

/**
 * @param {object} candidate
 * @param {string|null} conceptId
 * @param {number} index
 * @param {object} spatial
 */
export function llmCandidateToEvent(candidate, conceptId, index, spatial, options = {}) {
  const sourceReports = buildSourceReports(candidate, index, options);
  const locationText = candidate.locationText
    || [candidate.neighbourhood, candidate.municipality].filter(Boolean).join(', ')
    || '';
  const occurredAt = normalizeTemporalInstant(candidate.occurredAt);
  const publishedAt = normalizeTemporalInstant(candidate.publishedAt);
  const hasSourceBackedOccurrence = Boolean(
    occurredAt
    && sourceReports.length
    && !candidate._groundingFallback
  );

  return {
    eventId: null,
    concept: conceptId || candidate.concept || 'UNKNOWN',
    title: candidate.title || sourceReports[0]?.title || 'Untitled event',
    description: candidate.description || '',
    occurredAt,
    publishedAt,
    occurrenceSource: hasSourceBackedOccurrence
      ? (candidate.occurrenceSource || 'SOURCE_EXTRACTION')
      : null,
    occurrencePrecision: hasSourceBackedOccurrence
      ? (candidate.occurrencePrecision || 'DAY')
      : null,
    municipality: candidate.municipality || '',
    neighbourhood: candidate.neighbourhood || '',
    locationText,
    geometry: spatial.geometry,
    geometrySource: spatial.geometrySource,
    mappable: spatial.mappable,
    sourceReports,
    provenance: 'live',
    evidenceOrigin: 'live',
    confidence: spatial.mappable ? 0.75 : 0.55,
    researchOrigin: options.researchOrigin || 'openai-web-research'
  };
}

/**
 * @param {object[]} candidates
 * @param {object} request
 */
export async function processLlmEventCandidates(candidates = [], request = {}, hooks = {}) {
  const trace = hooks.trace || null;
  const grounded = candidates.filter((candidate) =>
    Array.isArray(candidate.sourceReports)
    && candidate.sourceReports.some((report) => report?.url));
  if (!grounded.length) return [];

  const { searchPlanMod, dedupMod, semanticMod, locationMod } = await loadConnectors();
  const conceptId = resolveSemanticConceptForRequest(request, grounded, semanticMod);
  const searchPlan = conceptId
    ? {
      concept: conceptId,
      expandedTerms: semanticMod.buildExpandedTermsForConcept(conceptId)
    }
    : searchPlanMod.interpretSearchPlan(request.query || request.concept, {
      searchMode: 'semantic',
      geographicScope: request.geography || request.geographicScope
    });

  const providerOptions = {
    retrievalProvider: request.retrievalProvider || 'openai-web-search-v1',
    researchOrigin: request.researchOrigin || 'openai-web-research'
  };

  const events = [];
  for (let i = 0; i < grounded.length; i += 1) {
    const candidate = grounded[i];
    const locationText = candidate.locationText
      || [candidate.neighbourhood, candidate.municipality].filter(Boolean).join(', ');
    const spatial = await resolveLiveGeometry(locationText, request, locationMod, trace);
    const event = llmCandidateToEvent(
      candidate,
      conceptId || searchPlan.concept,
      i,
      spatial,
      {
        ...providerOptions,
        researchOrigin: candidate._researchProvider || providerOptions.researchOrigin
      }
    );
    event.eventId = dedupMod.buildEventId({
      concept: event.concept,
      publishedAt: event.publishedAt,
      locationText: event.locationText,
      title: event.title
    });
    events.push(event);
    hooks.onEventProcessed?.(event, { index: i });
  }

  return dedupMod.deduplicateEvents(events).map((event) => ({
    ...event,
    concept: event.concept || searchPlan.concept || request.query,
    researchOrigin: event.researchOrigin || request.researchOrigin || 'openai-web-research'
  }));
}

/**
 * @param {object[]} corpusEvents
 * @param {object[]} webEvents
 */
export async function mergeIntelligenceEvents(corpusEvents = [], webEvents = []) {
  const { dedupMod } = await loadConnectors();
  return dedupMod.combineCorpusAndLiveEvents(corpusEvents, webEvents);
}

/**
 * @param {object[]} events
 */
export function summarizeIntelligenceEvents(events = []) {
  const mappable = events.filter((e) => e.mappable && e.geometry);
  const unresolved = events.filter((e) => !e.mappable || !e.geometry);
  const domains = [...new Set(
    events.flatMap((e) => (e.sourceReports || []).map((r) => {
      try {
        return r.sourceUrl ? new URL(r.sourceUrl).hostname.replace(/^www\./, '') : null;
      } catch {
        return null;
      }
    }))
  )].filter(Boolean).sort();

  return {
    distinctEvents: events.length,
    mappable: mappable.length,
    unresolved: unresolved.length,
    domains
  };
}
