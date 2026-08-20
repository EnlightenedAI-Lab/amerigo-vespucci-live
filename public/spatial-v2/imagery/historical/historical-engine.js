/**
 * HISTORY engine for Spatial V2.
 * Auto-discovers on activation. Capture date is IMAGE DATE.
 * Playback skips unconfirmed frames. Compare is HISTORY-to-HISTORY only.
 */

import { DATE_KIND } from '../imagery-contract.js';
import { IMAGE_SURFACE_FAILURE } from '../command/image-surface-mode.js';
import { formatImageDate } from '../command/image-date.js';
import { acquisitionFromWaybackMetadata } from '../providers/esri-wayback-provider.js';
import {
  COVERAGE_STATUS,
  DISPLAY_TRUTH,
  buildTimelineModel,
  calendarModel,
  displayEvidenceConfirmed,
  exportPermission,
  isDisplayConfirmed,
  sourceDetails,
  usefulCaptures
} from './historical-contract.js';
import {
  applyMetadataCoverage,
  enabledHistoricalProviders,
  waybackAdapter
} from './historical-providers.js';
import {
  getLastPaint,
  getLockedViewpoint,
  historicalSurfaceUsesGoogle,
  initHistoricalSurface,
  renderHistoricalSurface,
  setSwipeMode,
  setSwipeRatio,
  showPrimaryObservation,
  sleep
} from './historical-surface.js';

const METADATA_PROXY = '/api/spatial-v2/imagery/wayback/metadata';
const RESOLVE_CONCURRENCY = 8;

const listeners = new Set();

let engineState = 'IDLE';
let clientState = null;
let observations = [];
let useful = [];
let selectedId = null;
let activatedId = null;
let compareAId = null;
let compareBId = null;
let swipeEnabled = false;
let playing = false;
let playbackSpeed = 1;
let lastError = null;
let lastEvidence = null;
let place = null;
let playIndex = 0;

function emit() {
  const snapshot = getHistoricalEngineSnapshot();
  for (const listener of listeners) {
    try { listener(snapshot); } catch (error) {
      console.warn('[IQAI V2] historical engine listener failed', error);
    }
  }
}

function byId(id) {
  return observations.find((item) => item.observationId === id) || null;
}

function replaceObservation(next) {
  observations = observations.map((item) => (
    item.observationId === next.observationId ? next : item
  ));
  useful = usefulCaptures(observations);
}

export function subscribeHistoricalEngine(listener) {
  listeners.add(listener);
  listener(getHistoricalEngineSnapshot());
  return () => listeners.delete(listener);
}

export function getHistoricalEngineSnapshot() {
  const selected = byId(selectedId);
  const activated = byId(activatedId);
  const displayed = isDisplayConfirmed(activated) ? activated : null;
  const confirmed = useful.filter((item) => isDisplayConfirmed(item));
  return {
    engineState,
    clientState,
    place,
    viewpoint: getLockedViewpoint(),
    observations,
    useful,
    confirmed,
    selected,
    activated,
    displayed,
    selectedId,
    activatedId,
    displayedId: displayed?.observationId || null,
    displayConfirmed: Boolean(displayed),
    displayState: activated?.displayState || DISPLAY_TRUTH.NONE,
    imageDate: formatImageDate(selected),
    publicationDate: selected?.publicationDate || null,
    timeline: buildTimelineModel(observations, selectedId),
    calendar: calendarModel(observations),
    compareA: byId(compareAId),
    compareB: byId(compareBId),
    swipeEnabled,
    playing,
    playbackSpeed,
    playIndex,
    lastError,
    lastEvidence,
    sourceDetails: sourceDetails(selected),
    export: exportPermission(displayed || selected, 'HISTORY'),
    googlePixelsPresent: historicalSurfaceUsesGoogle(),
    historicalPixelsPresent: Boolean(displayed)
  };
}

async function mapPool(items, limit, worker) {
  const out = new Array(items.length);
  let cursor = 0;
  async function run() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      out[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return out;
}

async function probeMetadata(observation, aoi) {
  const metadataLayerUrl = observation?.raw?.sourceIdentity?.metadataLayerUrl
    || observation?.sourceMetadata?.metadataLayerUrl;
  if (!metadataLayerUrl || !aoi) {
    return { ...observation, coverageStatus: observation.coverageStatus };
  }
  const params = new URLSearchParams({
    metadataLayerUrl,
    longitude: String(aoi.longitude),
    latitude: String(aoi.latitude),
    scale: String(aoi.scale || '')
  });
  try {
    const response = await fetch(`${METADATA_PROXY}?${params}`, { cache: 'no-store' });
    if (!response.ok) return { ...observation };
    const payload = await response.json();
    if (!payload?.attributes) {
      return { ...observation, coverageStatus: COVERAGE_STATUS.NONE };
    }
    const merged = applyMetadataCoverage(observation, payload.attributes);
    const captureDate = acquisitionFromWaybackMetadata(payload.attributes);
    return {
      ...merged,
      captureDate: captureDate || merged.captureDate,
      capturePrecision: captureDate ? 'DAY' : merged.capturePrecision,
      sourceMetadata: {
        ...merged.sourceMetadata,
        dateKindUsed: captureDate ? DATE_KIND.ACQUISITION : DATE_KIND.RELEASE
      }
    };
  } catch {
    return { ...observation };
  }
}

async function confirmDisplay(observation) {
  const started = Date.now();
  let evidence = { ...getLastPaint(), confirmed: false, attempts: 0 };
  while (Date.now() - started < 18000) {
    evidence.attempts += 1;
    await renderHistoricalSurface();
    evidence = { ...getLastPaint(), attempts: evidence.attempts };
    evidence.confirmed = displayEvidenceConfirmed(evidence);
    if (evidence.confirmed) return { confirmed: true, evidence };
    await sleep(280);
  }
  evidence.confirmed = false;
  return { confirmed: false, evidence };
}

export async function mountHistoricalEngine(container, viewpoint) {
  place = {
    longitude: viewpoint.longitude,
    latitude: viewpoint.latitude,
    zoom: viewpoint.zoom
  };
  await initHistoricalSurface(container, viewpoint);
  emit();
  return getLockedViewpoint();
}

export async function discoverHistoricalImagery(viewpoint) {
  engineState = 'DISCOVERING';
  clientState = IMAGE_SURFACE_FAILURE.LOOKING;
  lastError = null;
  observations = [];
  useful = [];
  selectedId = null;
  activatedId = null;
  emit();
  try {
    if (viewpoint) place = { ...place, ...viewpoint };
    const providers = enabledHistoricalProviders();
    if (!providers.length) {
      clientState = IMAGE_SURFACE_FAILURE.SOURCE_UNAVAILABLE;
      engineState = 'ERROR';
      emit();
      return getHistoricalEngineSnapshot();
    }
    const discovered = await waybackAdapter.discover();
    observations = discovered.observations || [];
    if (!observations.length) {
      lastError = discovered.limitation || IMAGE_SURFACE_FAILURE.NONE;
      clientState = IMAGE_SURFACE_FAILURE.NONE;
      engineState = 'READY';
      emit();
      return getHistoricalEngineSnapshot();
    }
    const probed = await mapPool(observations, RESOLVE_CONCURRENCY, (item) => (
      probeMetadata(item, place)
    ));
    observations = probed;
    useful = usefulCaptures(observations);
    engineState = 'READY';
    const newestUseful = useful[useful.length - 1];
    const fallback = observations[0];
    if (newestUseful) {
      await selectObservation(newestUseful.observationId);
      return getHistoricalEngineSnapshot();
    }
    if (fallback) {
      clientState = IMAGE_SURFACE_FAILURE.DATE_UNKNOWN;
      await selectObservation(fallback.observationId);
      if (!getHistoricalEngineSnapshot().displayConfirmed) {
        clientState = IMAGE_SURFACE_FAILURE.NONE;
      }
      return getHistoricalEngineSnapshot();
    }
    clientState = IMAGE_SURFACE_FAILURE.NONE;
    emit();
    return getHistoricalEngineSnapshot();
  } catch (error) {
    lastError = String(error?.message || error);
    const network = /fetch|network|failed|unavailable/i.test(lastError);
    clientState = network ? IMAGE_SURFACE_FAILURE.NETWORK : IMAGE_SURFACE_FAILURE.SOURCE_UNAVAILABLE;
    engineState = 'ERROR';
    emit();
    return getHistoricalEngineSnapshot();
  }
}

export async function selectObservation(observationId, options = {}) {
  const observation = byId(observationId);
  if (!observation) throw new Error('Unknown historical observation.');
  selectedId = observationId;
  activatedId = observationId;
  swipeEnabled = false;
  if (options.pause !== false) playing = false;
  observation.displayState = DISPLAY_TRUTH.SELECTED;
  replaceObservation(observation);
  clientState = IMAGE_SURFACE_FAILURE.SELECTED_NOT_DISPLAYED;
  engineState = 'APPLYING';
  emit();
  await setSwipeMode(false);
  await showPrimaryObservation(observation);
  observation.displayState = DISPLAY_TRUTH.LAYER_ATTACHED;
  replaceObservation(observation);
  emit();
  const proof = await confirmDisplay(observation);
  lastEvidence = proof.evidence;
  observation.displayConfirmed = proof.confirmed === true;
  observation.displayState = proof.confirmed
    ? DISPLAY_TRUTH.DISPLAY_CONFIRMED
    : DISPLAY_TRUTH.DISPLAY_NOT_CONFIRMED;
  replaceObservation(observation);
  engineState = 'READY';
  clientState = proof.confirmed
    ? null
    : (formatImageDate(observation) === 'DATE UNKNOWN'
      ? IMAGE_SURFACE_FAILURE.DATE_UNKNOWN
      : IMAGE_SURFACE_FAILURE.SELECTED_NOT_DISPLAYED);
  emit();
  return getHistoricalEngineSnapshot();
}

function confirmedSequence() {
  const confirmed = useful.filter((item) => isDisplayConfirmed(item));
  return confirmed.length ? confirmed : useful;
}

export async function stepTimeline(delta) {
  const sequence = useful.length ? useful : observations;
  if (!sequence.length) return getHistoricalEngineSnapshot();
  const current = Math.max(0, sequence.findIndex((item) => item.observationId === (activatedId || selectedId)));
  let next = current;
  const direction = delta >= 0 ? 1 : -1;
  for (let i = 1; i <= sequence.length; i += 1) {
    const index = current + (direction * i);
    if (index < 0 || index >= sequence.length) break;
    const candidate = sequence[index];
    next = index;
    const result = await selectObservation(candidate.observationId);
    if (result.displayConfirmed) return result;
  }
  if (sequence[next] && sequence[next].observationId !== (activatedId || selectedId)) {
    return selectObservation(sequence[next].observationId);
  }
  return getHistoricalEngineSnapshot();
}

export async function setCompare(slot, observationId) {
  if (slot === 'A') compareAId = observationId;
  if (slot === 'B') compareBId = observationId;
  emit();
  if (compareAId && compareBId && swipeEnabled) {
    await setSwipeMode(true, byId(compareAId), byId(compareBId));
  }
  return getHistoricalEngineSnapshot();
}

export async function enableCompareSwipe(enabled = true) {
  if (!compareAId) compareAId = useful[0]?.observationId || selectedId;
  if (!compareBId) compareBId = useful[useful.length - 1]?.observationId || selectedId;
  const a = byId(compareAId);
  const b = byId(compareBId);
  if (a && !isDisplayConfirmed(a)) await selectObservation(a.observationId);
  if (b && b.observationId !== activatedId) await selectObservation(b.observationId);
  swipeEnabled = enabled === true && Boolean(compareAId && compareBId);
  playing = false;
  if (swipeEnabled) {
    await setSwipeMode(true, byId(compareAId), byId(compareBId));
  } else {
    await setSwipeMode(false);
    if (activatedId) await showPrimaryObservation(byId(activatedId));
  }
  emit();
  return getHistoricalEngineSnapshot();
}

export function setCompareSwipeRatio(ratio) {
  setSwipeRatio(ratio);
  emit();
  return getHistoricalEngineSnapshot();
}

export async function playThroughTime() {
  const sequence = useful.length ? useful : confirmedSequence();
  if (!sequence.length) return getHistoricalEngineSnapshot();
  const current = sequence.findIndex((item) => item.observationId === (activatedId || selectedId));
  playIndex = current >= 0 ? current : 0;
  playing = true;
  swipeEnabled = false;
  await setSwipeMode(false);
  emit();
  const run = async () => {
    while (playing) {
      playIndex = (playIndex + 1) % sequence.length;
      const observation = sequence[playIndex];
      if (observation) {
        const result = await selectObservation(observation.observationId, { pause: false });
        if (!playing) return;
        if (!result.displayConfirmed) continue;
      }
      emit();
      await sleep(Math.max(280, 1200 / playbackSpeed));
    }
  };
  run();
  return getHistoricalEngineSnapshot();
}

export function pausePlayback() {
  playing = false;
  emit();
  return getHistoricalEngineSnapshot();
}

export function resetHistoricalEngine() {
  playing = false;
  swipeEnabled = false;
  engineState = 'IDLE';
  clientState = null;
  observations = [];
  useful = [];
  selectedId = null;
  activatedId = null;
  compareAId = null;
  compareBId = null;
  lastError = null;
  lastEvidence = null;
  playIndex = 0;
  emit();
}
