/**
 * Provider-neutral historical observation contract for Spatial V2 HISTORY.
 * Engine concepts consumed from the historical-imagery lab; chrome is not copied.
 * SELECTED != DISPLAY_CONFIRMED. Capture != publication.
 */

import {
  ACCESS_STATE,
  CAPTURE_PRECISION,
  DATE_KIND,
  RIGHTS,
  captureClock,
  formatKnownResolution,
  isoDateOnly
} from '../imagery-contract.js';
import { formatImageDate } from '../command/image-date.js';
import { IMAGE_SURFACE_FAILURE } from '../command/image-surface-mode.js';

export const HISTORICAL_SURFACE_ID = 'iqai-v2-historical-overhead';

export const COVERAGE_STATUS = Object.freeze({
  COVERED: 'COVERED',
  NONE: 'NONE',
  UNKNOWN: 'UNKNOWN'
});

export const EXPORT_STATUS = Object.freeze({
  PERMITTED: 'PERMITTED',
  EXPORT_RIGHTS_REVIEW_REQUIRED: 'EXPORT_RIGHTS_REVIEW_REQUIRED',
  PROHIBITED: 'PROHIBITED',
  UNKNOWN: 'UNKNOWN'
});

export const DISPLAY_TRUTH = Object.freeze({
  NONE: 'NONE',
  SELECTED: 'SELECTED',
  ACTIVATED: 'ACTIVATED',
  LAYER_ATTACHED: 'LAYER_ATTACHED',
  DISPLAY_NOT_CONFIRMED: 'DISPLAY_NOT_CONFIRMED',
  DISPLAY_CONFIRMED: 'DISPLAY_CONFIRMED'
});

export const TIMELINE_DENSITY = Object.freeze({
  TICKS: 'TICKS',
  YEARS: 'YEARS',
  AGGREGATE: 'AGGREGATE'
});

export function emptyHistoricalObservation(partial = {}) {
  return {
    provider: null,
    observationId: null,
    location: null,
    extent: null,
    publicationDate: null,
    captureDate: null,
    captureDateRange: null,
    capturePrecision: CAPTURE_PRECISION.UNKNOWN,
    resolution: null,
    gsdMeters: null,
    displayConfirmed: false,
    displayState: DISPLAY_TRUTH.NONE,
    coverageStatus: COVERAGE_STATUS.UNKNOWN,
    sourceMetadata: null,
    attribution: null,
    exportStatus: EXPORT_STATUS.UNKNOWN,
    rights: {
      display: RIGHTS.UNKNOWN,
      export: RIGHTS.UNKNOWN,
      cache: RIGHTS.UNKNOWN,
      analysis: RIGHTS.UNKNOWN,
      attributionRequired: true
    },
    accessState: ACCESS_STATE.STREAMABLE,
    productName: null,
    urlTemplate: null,
    releaseNum: null,
    ...partial
  };
}

export function toHistoricalObservation(observation, extras = {}) {
  const clock = captureClock(observation);
  const captureDisplay = clock.precision === CAPTURE_PRECISION.UNKNOWN ? null : clock.display;
  const publicationDate = isoDateOnly(observation?.releaseDate) || null;
  return emptyHistoricalObservation({
    provider: observation?.providerId || extras.provider || null,
    observationId: observation?.id || null,
    location: extras.location || null,
    extent: extras.extent || null,
    publicationDate,
    captureDate: clock.precision === CAPTURE_PRECISION.DAY ? clock.date : captureDisplay,
    captureDateRange: extras.captureDateRange
      || (clock.precision === CAPTURE_PRECISION.MONTH ? clock.display : null)
      || (clock.precision === CAPTURE_PRECISION.YEAR ? String(clock.display) : null),
    capturePrecision: clock.precision,
    resolution: formatKnownResolution(observation?.gsdMeters) || extras.resolution || null,
    gsdMeters: Number.isFinite(Number(observation?.gsdMeters))
      ? Number(observation.gsdMeters)
      : null,
    displayConfirmed: extras.displayConfirmed === true,
    displayState: extras.displayState || DISPLAY_TRUTH.NONE,
    coverageStatus: extras.coverageStatus || COVERAGE_STATUS.UNKNOWN,
    sourceMetadata: {
      itemTitle: observation?.productName || null,
      sourceName: extras.sourceName || observation?.sourceIdentity?.sourceName || null,
      limitation: observation?.limitation || null,
      dateKindUsed: observation?.dateKindUsed || DATE_KIND.RELEASE,
      metadataLayerUrl: observation?.sourceIdentity?.metadataLayerUrl || null,
      ...extras.sourceMetadata
    },
    attribution: extras.attribution || null,
    exportStatus: extras.exportStatus || EXPORT_STATUS.EXPORT_RIGHTS_REVIEW_REQUIRED,
    rights: {
      display: observation?.rights?.display || RIGHTS.PERMITTED,
      export: observation?.rights?.export || RIGHTS.UNKNOWN,
      cache: observation?.rights?.cache || RIGHTS.UNKNOWN,
      analysis: observation?.rights?.analysis || RIGHTS.UNKNOWN,
      attributionRequired: observation?.rights?.attributionRequired !== false
    },
    productName: observation?.productName || null,
    urlTemplate: observation?.sourceIdentity?.itemURL
      || observation?.assets?.[0]?.urlTemplate
      || extras.urlTemplate
      || null,
    releaseNum: observation?.sourceIdentity?.releaseNum ?? null,
    raw: observation
  });
}

export function timelineSortKey(observation) {
  return observation?.captureDate
    || observation?.captureDateRange
    || '';
}

export function usefulCaptures(observations) {
  const list = Array.isArray(observations) ? observations : [];
  const covered = list.filter((item) => (
    item.coverageStatus === COVERAGE_STATUS.COVERED
    || item.displayConfirmed === true
  ));
  const groups = new Map();
  for (const item of covered) {
    let key;
    if (item.captureDate) key = `capture:${item.captureDate}`;
    else if (item.captureDateRange) key = `range:${item.captureDateRange}`;
    else continue;
    const current = groups.get(key);
    if (!current || rankBestAvailable([item, current])[0] === item) {
      groups.set(key, item);
    }
  }
  return [...groups.values()].sort((a, b) => timelineSortKey(a).localeCompare(timelineSortKey(b)));
}

export function rankBestAvailable(observations) {
  return [...(observations || [])].sort((a, b) => {
    const score = (item) => (
      (item.displayConfirmed ? 8 : 0)
      + (item.coverageStatus === COVERAGE_STATUS.COVERED ? 4 : 0)
      + (item.capturePrecision === CAPTURE_PRECISION.DAY ? 3
        : item.capturePrecision === CAPTURE_PRECISION.MONTH ? 2
          : item.capturePrecision === CAPTURE_PRECISION.YEAR ? 1 : 0)
      + (Number.isFinite(item.gsdMeters) && item.gsdMeters > 0 ? 1 : 0)
    );
    const delta = score(b) - score(a);
    if (delta) return delta;
    return timelineSortKey(b).localeCompare(timelineSortKey(a));
  });
}

export function yearGaps(observations, oldestYear, newestYear) {
  const years = new Set();
  for (const item of observations || []) {
    const year = Number(String(timelineSortKey(item)).slice(0, 4));
    if (Number.isFinite(year)) years.add(year);
  }
  const start = Number.isFinite(oldestYear) ? oldestYear : Math.min(...years);
  const end = Number.isFinite(newestYear) ? newestYear : Math.max(...years);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return [];
  const missing = [];
  for (let year = start; year <= end; year += 1) {
    if (!years.has(year)) missing.push(year);
  }
  return missing;
}

export function buildTimelineModel(observations, selectedId = null) {
  const useful = usefulCaptures(observations);
  const count = useful.length;
  const density = count <= 8
    ? TIMELINE_DENSITY.TICKS
    : (count <= 24 ? TIMELINE_DENSITY.YEARS : TIMELINE_DENSITY.AGGREGATE);
  const byYear = new Map();
  for (const item of useful) {
    const year = Number(String(timelineSortKey(item)).slice(0, 4));
    if (!Number.isFinite(year)) continue;
    if (!byYear.has(year)) byYear.set(year, []);
    byYear.get(year).push(item);
  }
  const years = [];
  const keys = [...byYear.keys()].sort((a, b) => a - b);
  const gaps = yearGaps(useful);
  const gapSet = new Set(gaps);
  if (keys.length) {
    for (let year = keys[0]; year <= keys[keys.length - 1]; year += 1) {
      years.push({
        year,
        empty: gapSet.has(year) || !byYear.has(year),
        captures: byYear.get(year) || []
      });
    }
  }
  return {
    density,
    selectedId,
    captures: useful,
    years,
    gaps,
    ticks: density === TIMELINE_DENSITY.TICKS
      ? useful.map((item) => ({
        observationId: item.observationId,
        label: formatImageDate(item),
        selected: item.observationId === selectedId
      }))
      : []
  };
}

export function calendarModel(observations, openYear = null) {
  const timeline = buildTimelineModel(observations);
  const year = Number(openYear);
  const row = Number.isFinite(year)
    ? timeline.years.find((item) => item.year === year)
    : null;
  const months = new Map();
  for (const item of row?.captures || []) {
    const text = timelineSortKey(item);
    const month = /^\d{4}-\d{2}/.test(text) ? text.slice(0, 7) : String(year);
    if (!months.has(month)) months.set(month, []);
    months.get(month).push(item);
  }
  return {
    years: timeline.years,
    openYear: Number.isFinite(year) ? year : null,
    months: [...months.entries()].map(([key, captures]) => ({
      key,
      label: key.length === 7 ? key : String(year),
      captures
    }))
  };
}

export function isDisplayConfirmed(observation) {
  return observation?.displayConfirmed === true
    && observation?.displayState === DISPLAY_TRUTH.DISPLAY_CONFIRMED;
}

export function displayEvidenceConfirmed(evidence) {
  return Boolean(
    evidence?.paintedTiles >= 1
    && evidence?.opaquePixelCount >= 256
    && evidence?.opaqueShare >= 0.05
    && evidence?.contrast >= 16
  );
}

export function exportPermission(observation, surfaceMode) {
  if (surfaceMode === 'MAP' || surfaceMode === 'AERIAL') {
    return {
      permitted: false,
      status: EXPORT_STATUS.PROHIBITED,
      reason: IMAGE_SURFACE_FAILURE.EXPORT_NOT_PERMITTED,
      detail: 'EXPORT NOT PERMITTED FOR THIS SOURCE'
    };
  }
  const exportRight = observation?.rights?.export;
  const status = observation?.exportStatus;
  if (exportRight === RIGHTS.PERMITTED && status === EXPORT_STATUS.PERMITTED) {
    return { permitted: true, status: EXPORT_STATUS.PERMITTED, reason: null, detail: null };
  }
  return {
    permitted: false,
    status: status || EXPORT_STATUS.EXPORT_RIGHTS_REVIEW_REQUIRED,
    reason: IMAGE_SURFACE_FAILURE.EXPORT_NOT_PERMITTED,
    detail: 'EXPORT NOT PERMITTED FOR THIS SOURCE'
  };
}

export function sourceDetails(observation) {
  if (!observation) return null;
  return {
    source: observation.attribution || observation.productName || null,
    imageDate: formatImageDate(observation),
    publicationDate: observation.publicationDate || null,
    resolution: observation.resolution || null,
    coverage: observation.coverageStatus || null,
    attribution: observation.attribution || null,
    rights: observation.rights || null,
    limitation: observation.sourceMetadata?.limitation || null
  };
}

export { IMAGE_SURFACE_FAILURE };
