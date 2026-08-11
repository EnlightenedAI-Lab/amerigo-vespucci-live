/**
 * Machine-readable disposition accounting for intelligence source reports.
 */

export const REPORT_DISPOSITION = Object.freeze({
  RETRIEVED_ONLY: 'RETRIEVED_ONLY',
  NOT_EVENT: 'NOT_EVENT',
  EXTRACTION_FAILED: 'EXTRACTION_FAILED',
  OUTSIDE_GEOGRAPHY: 'OUTSIDE_GEOGRAPHY',
  OUTSIDE_TIME_WINDOW: 'OUTSIDE_TIME_WINDOW',
  MISSING_OCCURRENCE_TIME: 'MISSING_OCCURRENCE_TIME',
  MISSING_LOCATION: 'MISSING_LOCATION',
  CANDIDATE_CREATED: 'CANDIDATE_CREATED',
  GOVERNANCE_ADMIT: 'GOVERNANCE_ADMIT',
  GOVERNANCE_CAUTION: 'GOVERNANCE_CAUTION',
  GOVERNANCE_HOLD: 'GOVERNANCE_HOLD',
  GOVERNANCE_REJECT: 'GOVERNANCE_REJECT',
  DUPLICATE: 'DUPLICATE',
  GEOCODE_FAILED: 'GEOCODE_FAILED',
  ADMITTED_UNMAPPABLE: 'ADMITTED_UNMAPPABLE',
  MAPPED: 'MAPPED'
});

/**
 * @param {object} report
 * @param {number} index
 */
export function createReportLedgerEntry(report = {}, index = 0) {
  return {
    reportIndex: index + 1,
    url: report.url || report.sourceUrl || null,
    title: report.title || null,
    publisher: report.publisher || report.sourceName || null,
    disposition: REPORT_DISPOSITION.RETRIEVED_ONLY,
    reasonCodes: [],
    candidateTitle: null,
    admissionOutcome: null
  };
}

/**
 * @param {object[]} candidates
 * @param {object[]} groundingChunks
 */
export function initializeReportDispositionLedger(candidates = [], groundingChunks = []) {
  const urlToEntry = new Map();
  const entries = [];

  for (const chunk of groundingChunks || []) {
    if (!chunk?.uri) continue;
    const entry = createReportLedgerEntry({
      url: chunk.uri,
      title: chunk.title,
      publisher: chunk.title
    }, entries.length);
    urlToEntry.set(chunk.uri, entry);
    entries.push(entry);
  }

  for (const candidate of candidates || []) {
    for (const report of candidate.sourceReports || []) {
      if (!report?.url) continue;
      let entry = urlToEntry.get(report.url);
      if (!entry) {
        entry = createReportLedgerEntry(report, entries.length);
        urlToEntry.set(report.url, entry);
        entries.push(entry);
      }
      if (candidate._groundingFallback) {
        entry.disposition = REPORT_DISPOSITION.EXTRACTION_FAILED;
        entry.reasonCodes = ['STRUCTURED_EXTRACTION_EMPTY'];
      } else {
        entry.disposition = REPORT_DISPOSITION.CANDIDATE_CREATED;
        entry.candidateTitle = candidate.title || null;
      }
    }
  }

  return { entries, urlToEntry };
}

/**
 * @param {object} ledger
 * @param {object} event
 * @param {object} decision
 */
export function recordTemporalDisposition(ledger, event, decision) {
  for (const report of event.sourceReports || []) {
    const url = report.sourceUrl || report.url;
    const entry = ledger.urlToEntry?.get(url);
    if (!entry) continue;
    if (decision.admitted) continue;
    if (decision.reason === 'OUT_OF_RANGE') {
      entry.disposition = REPORT_DISPOSITION.OUTSIDE_TIME_WINDOW;
      entry.reasonCodes = [decision.reason];
    } else if (decision.reason === 'UNKNOWN_OCCURRENCE') {
      entry.disposition = REPORT_DISPOSITION.MISSING_OCCURRENCE_TIME;
      entry.reasonCodes = [decision.reason];
    }
  }
}

/**
 * @param {object} ledger
 * @param {object} governed
 */
export function recordGovernanceDisposition(ledger, governed = {}) {
  const event = governed.candidate || governed;
  const outcome = governed.admission?.outcome || governed.admissionDecision?.outcome || null;
  const reasonCodes = governed.admission?.reasonCodes || governed.admissionDecision?.reasonCodes || [];

  for (const report of event.sourceReports || []) {
    const url = report.sourceUrl || report.url;
    const entry = ledger.urlToEntry?.get(url);
    if (!entry) continue;
    entry.admissionOutcome = outcome;
    entry.reasonCodes = reasonCodes;

    if (outcome === 'ADMIT') {
      entry.disposition = REPORT_DISPOSITION.GOVERNANCE_ADMIT;
    } else if (outcome === 'ADMIT_WITH_CAUTION') {
      entry.disposition = REPORT_DISPOSITION.GOVERNANCE_CAUTION;
    } else if (outcome === 'HOLD') {
      entry.disposition = REPORT_DISPOSITION.GOVERNANCE_HOLD;
    } else if (outcome === 'REJECT') {
      entry.disposition = REPORT_DISPOSITION.GOVERNANCE_REJECT;
    }

    if (reasonCodes.includes('DUPLICATE_EVENT')) {
      entry.disposition = REPORT_DISPOSITION.DUPLICATE;
    }
    if (!event.mappable || !event.geometry) {
      if (entry.disposition === REPORT_DISPOSITION.GOVERNANCE_ADMIT
        || entry.disposition === REPORT_DISPOSITION.GOVERNANCE_CAUTION) {
        entry.disposition = REPORT_DISPOSITION.ADMITTED_UNMAPPABLE;
      } else if (!event.locationText) {
        entry.disposition = REPORT_DISPOSITION.MISSING_LOCATION;
      } else {
        entry.disposition = REPORT_DISPOSITION.GEOCODE_FAILED;
      }
    }
  }
}

/**
 * @param {object} ledger
 * @param {object} event
 */
export function recordMappedDisposition(ledger, event = {}) {
  for (const report of event.sourceReports || []) {
    const url = report.sourceUrl || report.url;
    const entry = ledger.urlToEntry?.get(url);
    if (!entry) continue;
    entry.disposition = REPORT_DISPOSITION.MAPPED;
  }
}

/**
 * @param {object} ledger
 */
export function summarizeReportDispositions(ledger = {}) {
  const entries = ledger.entries || [];
  const counts = {};
  for (const value of Object.values(REPORT_DISPOSITION)) {
    counts[value] = 0;
  }
  for (const entry of entries) {
    counts[entry.disposition] = (counts[entry.disposition] || 0) + 1;
  }

  return {
    reportsRetrieved: entries.length,
    candidateEventsExtracted: entries.filter((entry) => entry.candidateTitle || entry.disposition === REPORT_DISPOSITION.MAPPED || entry.disposition === REPORT_DISPOSITION.CANDIDATE_CREATED || entry.disposition === REPORT_DISPOSITION.EXTRACTION_FAILED).length,
    admitted: counts.GOVERNANCE_ADMIT + counts.GOVERNANCE_CAUTION + counts.MAPPED + counts.ADMITTED_UNMAPPABLE,
    admitWithCaution: counts.GOVERNANCE_CAUTION,
    hold: counts.GOVERNANCE_HOLD,
    reject: counts.GOVERNANCE_REJECT,
    duplicates: counts.DUPLICATE,
    geocodeFailures: counts.GEOCODE_FAILED,
    missingOccurrence: counts.MISSING_OCCURRENCE_TIME,
    outsideTimeWindow: counts.OUTSIDE_TIME_WINDOW,
    mapped: counts.MAPPED,
    entries
  };
}
