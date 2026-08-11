/**
 * Agent 2 GovernCandidate client — schema translation + in-process service call.
 * Agent 1 does NOT own admission policy; only validates response shape.
 */
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { INTELLIGENCE_CONNECTORS_ROOT } from '../intelligence-routes-loader.js';

export const GOVERN_CANDIDATE_PATH = '/api/spatial/intelligence/govern-candidate';

let agent2Modules = null;
let intelligenceStore = null;

async function loadAgent2Modules() {
  if (agent2Modules) return agent2Modules;
  const base = INTELLIGENCE_CONNECTORS_ROOT;
  const [gateMod, schemaMod, storeMod] = await Promise.all([
    import(pathToFileURL(resolve(base, 'src/intelligence/admission/intelligence-admission-gate.js')).href),
    import(pathToFileURL(resolve(base, 'src/intelligence/admission/intelligence-admission-schema.js')).href),
    import(pathToFileURL(resolve(base, 'src/intelligence/storage/store-singleton.js')).href)
  ]);
  const storeRoot = process.env.INTELLIGENCE_STORE_ROOT
    || resolve(base, 'data/intelligence/store');
  intelligenceStore = storeMod.getIntelligenceStore(storeRoot);
  agent2Modules = { gateMod, schemaMod, store: intelligenceStore };
  return agent2Modules;
}

/**
 * Map IQAI intelligence event → Agent 2 candidate contract.
 * @param {object} event
 */
export function mapEventToAgent2Candidate(event = {}) {
  const primary = Array.isArray(event.sourceReports) ? event.sourceReports[0] : null;
  return {
    candidateId: event.eventId || event.candidateId || null,
    eventId: event.eventId || null,
    eventVersion: event.eventVersion || event.governedEventVersion || '1',
    title: event.title || '',
    description: event.description || '',
    concept: event.concept || null,
    occurredAt: event.occurredAt || null,
    publishedAt: event.publishedAt || null,
    occurrenceSource: event.occurrenceSource || (event.occurredAt ? 'SOURCE_EXTRACTION' : null),
    occurrencePrecision: event.occurrencePrecision || null,
    occurrenceKnown: Boolean(event.occurredAt && (event.occurrenceSource || event.sourceReports?.length)),
    locationText: event.locationText
      || [event.neighbourhood, event.municipality].filter(Boolean).join(', ')
      || null,
    neighbourhood: event.neighbourhood || null,
    municipality: event.municipality || null,
    province: event.province || null,
    sourceUrl: primary?.url || primary?.sourceUrl || event.sourceUrl || null,
    sourceId: primary?.sourceId || event.sourceId || null,
    geometry: event.geometry || null,
    geometrySource: event.geometrySource || null,
    evidenceOrigin: event.evidenceOrigin || primary?.evidenceOrigin || null,
    provenance: primary?.provenance || event.provenance || null
  };
}

/**
 * @param {object} body
 */
export function validateGovernCandidateResponse(body = {}) {
  const issues = [];
  if (!body || body.ok === false) issues.push('GOVERN_CANDIDATE_FAILED');
  if (!body?.admissionDecision?.outcome) issues.push('MISSING_ADMISSION_OUTCOME');
  if (!body?.admissionDecision?.reasonCodes) issues.push('MISSING_REASON_CODES');
  return { valid: issues.length === 0, issues };
}

/**
 * @param {object} event
 * @param {object} request
 * @param {object} [context]
 */
export async function governCandidateViaAgent2(event = {}, request = {}, context = {}) {
  if (context.agent2Unavailable) {
    const err = new Error('Agent 2 governance unavailable');
    err.code = 'AGENT2_GOVERNANCE_UNAVAILABLE';
    throw err;
  }

  const started = Date.now();
  const { gateMod, schemaMod, store } = await loadAgent2Modules();
  const restStarted = Date.now();

  const body = {
    traceId: context.traceId || request.traceId || null,
    candidate: mapEventToAgent2Candidate(event),
    objectiveContext: {
      query: request.query,
      conceptId: request.conceptId || null,
      researchExecution: request.researchExecution || 'FAST'
    },
    temporalWindow: {
      from: request.from || null,
      to: request.to || null,
      temporalField: request.temporalField || 'OCCURRED'
    },
    geography: request.geography || request.geographicScope || null,
    policyContext: {
      admittedEventIds: [...(context.admittedEventIds || [])],
      knownEventIds: [...(context.admittedEventIds || [])],
      servingMode: context.servingMode || 'production'
    },
    includeTrace: true
  };

  const result = gateMod.governCandidate(body, store);
  const restRoundTripMs = Date.now() - restStarted;

  const validation = validateGovernCandidateResponse({
    ok: true,
    admissionDecision: result.admissionDecision,
    governedCandidate: result.governedCandidate,
    receipt: result.receipt
  });
  if (!validation.valid) {
    const err = new Error(validation.issues.join(', '));
    err.code = 'INVALID_GOVERN_CANDIDATE_RESPONSE';
    throw err;
  }

  const decision = result.admissionDecision;
  const outcome = decision.outcome;
  const admitted = outcome === schemaMod.ADMISSION_OUTCOME.ADMIT
    || outcome === schemaMod.ADMISSION_OUTCOME.ADMIT_WITH_CAUTION;

  const mergedCandidate = {
    ...event,
    eventId: decision.eventId || event.eventId,
    governedEventVersion: Number(decision.eventVersion || 1),
    admissionOutcome: outcome,
    permittedDisplayMode: decision.permittedDisplayMode,
    reasonCodes: decision.reasonCodes
  };

  if (result.governedCandidate?.locationText) {
    mergedCandidate.locationText = result.governedCandidate.locationText;
  }

  return {
    schemaVersion: schemaMod.ADMISSION_SCHEMA_VERSION,
    admission: decision,
    admissionDecision: decision,
    governedCandidate: result.governedCandidate,
    receipt: result.receipt,
    diagnosticTrace: result.diagnosticTrace || null,
    admissionTiming: result.admissionTiming || null,
    candidate: mergedCandidate,
    governedEventId: decision.eventId || event.eventId,
    governedEventVersion: Number(decision.eventVersion || 1),
    admitted,
    mapEligible: admitted,
    agent2RestLatencyMs: restRoundTripMs,
    agent2InternalLatencyMs: result._processingMs ?? null,
    latencyMs: Date.now() - started,
    endpoint: GOVERN_CANDIDATE_PATH
  };
}

export async function getAgent2AdmissionOutcomes() {
  const { schemaMod } = await loadAgent2Modules();
  return schemaMod.ADMISSION_OUTCOME;
}
