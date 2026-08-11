/**
 * Coverage receipt — compact source-family and provider scope accounting.
 */
import { RESEARCH_EXECUTION } from '../intelligence-layer-research-contract.js';

export const DEGRADED_REASON = Object.freeze({
  LIVE_PROVIDER_FAILED: 'LIVE_PROVIDER_FAILED',
  LIVE_FALLBACK_USED: 'LIVE_FALLBACK_USED',
  SOCIAL_COVERAGE_INCOMPLETE: 'SOCIAL_COVERAGE_INCOMPLETE',
  WEB_COVERAGE_INCOMPLETE: 'WEB_COVERAGE_INCOMPLETE',
  CORPUS_ONLY_SUCCESS: 'CORPUS_ONLY_SUCCESS',
  PARTIAL_BRANCH_FAILURE: 'PARTIAL_BRANCH_FAILURE',
  FIRST_RESULT_DEADLINE: 'FIRST_RESULT_DEADLINE'
});

function uniqueUrls(candidates = []) {
  const urls = new Set();
  for (const candidate of candidates) {
    for (const report of candidate.sourceReports || []) {
      if (report?.url) urls.add(report.url);
    }
  }
  return urls;
}

/**
 * @param {object} input
 */
export function buildCoverageReceipt(input = {}) {
  const {
    execution = RESEARCH_EXECUTION.FAST,
    objectiveClass = null,
    selectionPlan = null,
    liveResult = {},
    corpusResult = {},
    providerReceipts = [],
    admittedEventIds = []
  } = input;

  const failures = liveResult.failures || [];
  const attempted = providerReceipts.map((r) => r.provider).filter(Boolean);
  const successful = providerReceipts.filter((r) => r.status === 'SUCCESS').map((r) => r.provider);
  const failed = providerReceipts.filter((r) => r.status === 'FAILED').map((r) => r.provider);

  const sourceFamiliesAttempted = new Set();
  const sourceFamiliesSuccessful = new Set();
  for (const receipt of providerReceipts) {
    for (const family of receipt.sourceFamilies || []) sourceFamiliesAttempted.add(family);
    if (receipt.status === 'SUCCESS') {
      for (const family of receipt.sourceFamilies || []) sourceFamiliesSuccessful.add(family);
    }
  }
  if (corpusResult?.events?.length) {
    sourceFamiliesAttempted.add('CORPUS');
    sourceFamiliesSuccessful.add('CORPUS');
  }

  const degradedReasonCodes = [];
  if (liveResult.fallbackUsed) degradedReasonCodes.push(DEGRADED_REASON.LIVE_FALLBACK_USED);
  if (failures.length) degradedReasonCodes.push(DEGRADED_REASON.LIVE_PROVIDER_FAILED);
  if (liveResult.partialFailure) degradedReasonCodes.push(DEGRADED_REASON.PARTIAL_BRANCH_FAILURE);
  if (liveResult.deadlineExceeded) degradedReasonCodes.push(DEGRADED_REASON.FIRST_RESULT_DEADLINE);
  if (attempted.includes('GROK_XAI') && !successful.includes('GROK_XAI')) {
    degradedReasonCodes.push(DEGRADED_REASON.SOCIAL_COVERAGE_INCOMPLETE);
  }
  if (!successful.length && corpusResult?.events?.length) {
    degradedReasonCodes.push(DEGRADED_REASON.CORPUS_ONLY_SUCCESS);
  }

  const allCandidates = liveResult.candidates || [];
  const urls = uniqueUrls(allCandidates);

  return {
    execution,
    objectiveClass: objectiveClass || selectionPlan?.objectiveClass || null,
    sourceFamiliesAttempted: [...sourceFamiliesAttempted],
    sourceFamiliesSuccessful: [...sourceFamiliesSuccessful],
    liveProvidersAttempted: attempted,
    liveProvidersSuccessful: successful,
    liveProvidersFailed: failed,
    corpusCoverage: Boolean(corpusResult?.events?.length),
    authoritativeCoverage: false,
    socialCoverage: successful.includes('GROK_XAI'),
    uniqueSourceUrls: urls.size,
    independentLineageCount: null,
    unresolvedCoverageGaps: degradedReasonCodes,
    degradedReasonCodes: [...new Set(degradedReasonCodes)],
    admittedEventCount: admittedEventIds.length,
    selectionReason: selectionPlan?.selectionReason || null,
    primaryProvider: selectionPlan?.primary?.providerLabel || liveResult.provider || null,
    fallbackEligible: Boolean(selectionPlan?.fallback),
    firstResultDeadlineMs: selectionPlan?.firstResultDeadlineMs || null
  };
}
