/**
 * Compact map-stage imagery receipt. Capture is the dominant clock.
 * Release is secondary. Retrieval never appears here.
 */

import {
  CAPTURE_PRECISION,
  DATE_KIND,
  captureClock,
  formatKnownResolution,
  isCurrentMosaicObservation
} from './imagery-contract.js';

export const CAPTURE_DATE_UNKNOWN = 'CAPTURE DATE UNKNOWN';

export function imageryProviderLabel(observation, ground) {
  const providerId = observation?.providerId;
  const mode = ground?.currentMode;
  if (providerId === 'esri-wayback') return 'ESRI WAYBACK';
  if (providerId === 'nearmap') return 'NEARMAP';
  if (providerId === 'nearmap-wms-latest' || mode === 'NEARMAP') return 'NEARMAP · CURRENT';
  if (providerId === 'esri-world-imagery' || mode === 'ESRI_WORLD_IMAGERY') {
    return 'ESRI WORLD IMAGERY · CURRENT';
  }
  if (providerId === 'google-map-tiles' || mode === 'GOOGLE_SATELLITE') {
    return 'GOOGLE CURRENT';
  }
  return String(observation?.productName || ground?.label || 'IMAGERY').toUpperCase();
}

export function formatCaptureLine(observation, options = {}) {
  const clock = captureClock(observation);
  const includeResolution = options.includeResolution !== false;
  const resolution = includeResolution ? formatKnownResolution(observation?.gsdMeters) : null;
  let capture = CAPTURE_DATE_UNKNOWN;
  if (clock.precision === CAPTURE_PRECISION.DAY) capture = `CAPTURED ${clock.display}`;
  else if (clock.precision === CAPTURE_PRECISION.MONTH) capture = `CAPTURED ${clock.display}`;
  else if (clock.precision === CAPTURE_PRECISION.YEAR) capture = `VINTAGE ${clock.display}`;
  if (resolution) capture = `${capture} · ${resolution}`;
  return capture;
}

export function formatReleaseLine(observation) {
  if (!observation) return null;
  if (isCurrentMosaicObservation(observation)) return null;
  if (observation.dateKindUsed === DATE_KIND.SERVICE_CURRENT) return null;
  if (!observation.releaseDate) return null;
  return `RELEASED ${observation.releaseDate}`;
}

export function formatImageryStageReceipt(observation, ground) {
  const obs = observation || ground?.receipt?.observation || null;
  if (!obs && !ground) return null;
  const provider = imageryProviderLabel(obs, ground);
  const capture = formatCaptureLine(obs);
  const release = formatReleaseLine(obs);
  return {
    provider,
    capture,
    release,
    lines: [provider, capture, release].filter(Boolean)
  };
}

export function formatBestImageActionLabel(requestedDate) {
  if (!requestedDate) return 'SHOW BEST IMAGE';
  return `BEST IMAGE NEAR ${requestedDate}`;
}

export function formatRetrievedLine(observation) {
  if (!observation?.retrievedDate) return null;
  const day = String(observation.retrievedDate).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(day) ? `RETRIEVED ${day}` : `RETRIEVED ${observation.retrievedDate}`;
}
