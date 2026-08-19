/**
 * WorldView live navigation authority.
 *
 * Portable camera context for MAP / 3D / STREET 360. Not FocusRef, not
 * ObjectRef, not World State view identity. DROP PIN remains spatial-focus.js.
 *
 * VIEW INPUT → this store → active view adapters.
 */

import {
  MONTREAL_OPERATIONAL_SCALE
} from '../../spatial/montreal-operational-config.js';

export const WORLDVIEW_NAV_SOURCE = Object.freeze({
  MAP: 'MAP',
  VISUAL_3D: '3D VISUAL',
  STREET_360: 'STREET 360',
  FOCUS: 'FOCUS',
  OPEN: 'OPEN'
});

/** Calibrated to operational 2D scale 144448 ↔ default 3D range 1000 m. */
export const WORLDVIEW_SCALE_PER_RANGE_METER = MONTREAL_OPERATIONAL_SCALE / 1000;

export const WORLDVIEW_NAV_TOLERANCE = Object.freeze({
  centerMeters: 12,
  rangeRatio: 0.08,
  headingDeg: 2.5,
  debounceMs: 48,
  echoMs: 320,
  streetRelocateMeters: 80
});

/** Neighborhood context so a ~50 m Street trace is visible. Not Street FOV.
 *  Tied to an operational WebMap LOD (1/4 of 144448) so MapView can actually
 *  adopt it instead of snapping back to city scale. */
export const STREET_OPERATING_SCALE = MONTREAL_OPERATIONAL_SCALE / 4;
export const STREET_OPERATING_RANGE_METERS = STREET_OPERATING_SCALE / WORLDVIEW_SCALE_PER_RANGE_METER;
export const STREET_OPERATING_RANGE_CEILING_METERS = 720;
/** Neighborhood MapView LOD so a ~50 m Street trace is operator-visible.
 *  Independent of 3D camera range (which stays on STREET_OPERATING_RANGE_METERS). */
export const STREET_MAP_OPERATING_SCALE = 9000;

let streetOperatingScaleArmed = false;
let operatorHoldsMapScale = false;

export function armStreetOperatingScale() {
  streetOperatingScaleArmed = true;
  operatorHoldsMapScale = false;
}

export function disarmStreetOperatingScale() {
  streetOperatingScaleArmed = false;
}

export function noteOperatorMapScaleIntent() {
  operatorHoldsMapScale = true;
  streetOperatingScaleArmed = false;
}

export function operatorHoldsMapScaleIntent() {
  return operatorHoldsMapScale === true;
}

export function isStreetOperatingScaleArmed() {
  return streetOperatingScaleArmed === true;
}

export function streetOperatingScalePatch(current) {
  if (operatorHoldsMapScale || !streetOperatingScaleArmed) return {};
  const range = Number(current?.rangeMeters);
  if (Number.isFinite(range) && range > 0 && range <= STREET_OPERATING_RANGE_CEILING_METERS) {
    return {};
  }
  return {
    rangeMeters: STREET_OPERATING_RANGE_METERS,
    scale: STREET_OPERATING_SCALE
  };
}

export function noteStreetOperatingScaleApplied(nav) {
  return Number(nav?.rangeMeters) > 0 && Number(nav.rangeMeters) <= STREET_OPERATING_RANGE_CEILING_METERS;
}

export function offsetMeters(a, b) {
  const lon1 = Number(a?.longitude ?? a?.lng);
  const lat1 = Number(a?.latitude ?? a?.lat);
  const lon2 = Number(b?.longitude ?? b?.lng);
  const lat2 = Number(b?.latitude ?? b?.lat);
  if (![lon1, lat1, lon2, lat2].every(Number.isFinite)) return null;
  const toRad = (degrees) => (degrees * Math.PI) / 180;
  const radius = 6371000;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const sine = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * radius * Math.asin(Math.min(1, Math.sqrt(sine)));
}

export function headingDeltaDeg(a, b) {
  const left = Number(a);
  const right = Number(b);
  if (!Number.isFinite(left) || !Number.isFinite(right)) return null;
  const delta = Math.abs(((left - right + 540) % 360) - 180);
  return delta;
}

export function rangeMetersFromMapScale(scale) {
  const value = Number(scale);
  if (!Number.isFinite(value) || value <= 0) return null;
  return value / WORLDVIEW_SCALE_PER_RANGE_METER;
}

export function mapScaleFromRangeMeters(rangeMeters) {
  const value = Number(rangeMeters);
  if (!Number.isFinite(value) || value <= 0) return null;
  return value * WORLDVIEW_SCALE_PER_RANGE_METER;
}

export function rangeMetersFromExtentWidth(widthMeters) {
  const width = Number(widthMeters);
  if (!Number.isFinite(width) || width <= 0) return null;
  return Math.max(80, width * 0.5);
}

export function cloneWorldviewNavigation(value) {
  if (!value) return null;
  const longitude = Number(value.longitude);
  const latitude = Number(value.latitude);
  if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) return null;
  const rangeMeters = Number(value.rangeMeters);
  const scale = Number(value.scale);
  const heading = Number(value.heading);
  return {
    longitude,
    latitude,
    rangeMeters: Number.isFinite(rangeMeters) && rangeMeters > 0
      ? rangeMeters
      : rangeMetersFromMapScale(scale),
    scale: Number.isFinite(scale) && scale > 0
      ? scale
      : mapScaleFromRangeMeters(rangeMeters),
    heading: Number.isFinite(heading) ? ((heading % 360) + 360) % 360 : null,
    sourceView: String(value.sourceView || WORLDVIEW_NAV_SOURCE.OPEN),
    revision: Number(value.revision) || 0,
    updatedAt: value.updatedAt || null
  };
}

export function navigationWithinTolerance(proposed, current, tolerance = WORLDVIEW_NAV_TOLERANCE) {
  if (!proposed || !current) return false;
  const center = offsetMeters(proposed, current);
  if (center == null || center > tolerance.centerMeters) return false;
  const nextRange = Number(proposed.rangeMeters);
  const prevRange = Number(current.rangeMeters);
  if (Number.isFinite(nextRange) && Number.isFinite(prevRange) && prevRange > 0) {
    const ratio = Math.abs(nextRange - prevRange) / prevRange;
    if (ratio > tolerance.rangeRatio) return false;
  }
  if (proposed.heading != null && current.heading != null) {
    const heading = headingDeltaDeg(proposed.heading, current.heading);
    if (heading != null && heading > tolerance.headingDeg) return false;
  }
  return true;
}

export function mergeNavigationPatch(current, patch, sourceView, revision) {
  const longitude = Number(patch.longitude ?? current?.longitude);
  const latitude = Number(patch.latitude ?? current?.latitude);
  let rangeMeters = Number(patch.rangeMeters);
  if (!Number.isFinite(rangeMeters) || rangeMeters <= 0) {
    rangeMeters = rangeMetersFromMapScale(patch.scale);
  }
  if (!Number.isFinite(rangeMeters) || rangeMeters <= 0) {
    rangeMeters = Number(current?.rangeMeters);
  }
  const heading = patch.heading === undefined
    ? current?.heading
    : (Number.isFinite(Number(patch.heading)) ? Number(patch.heading) : null);
  return cloneWorldviewNavigation({
    longitude,
    latitude,
    rangeMeters,
    heading,
    sourceView,
    revision,
    updatedAt: new Date().toISOString()
  });
}

export function createWorldviewNavigationController(options = {}) {
  const tolerance = { ...WORLDVIEW_NAV_TOLERANCE, ...(options.tolerance || {}) };
  const listeners = new Set();
  const applyingTo = new Set();
  const appliedRevisionBy = new Map();
  const ignoreUntil = new Map();
  let state = null;
  let revision = 0;
  let echoBudget = 0;

  function snapshot() {
    return cloneWorldviewNavigation(state);
  }

  function emit() {
    const next = snapshot();
    for (const listener of listeners) {
      try {
        listener(next);
      } catch (error) {
        console.warn('[IQAI V2] worldview navigation listener failed', error);
      }
    }
  }

  function beginApply(sourceView) {
    applyingTo.add(String(sourceView));
  }

  function endApply(sourceView, appliedRevision = state?.revision) {
    const source = String(sourceView);
    applyingTo.delete(source);
    if (Number.isFinite(Number(appliedRevision))) {
      appliedRevisionBy.set(source, Number(appliedRevision));
    }
    ignoreUntil.set(source, Date.now() + tolerance.echoMs);
  }

  function isApplying(sourceView) {
    return applyingTo.has(String(sourceView));
  }

  function propose(sourceView, patch = {}) {
    const source = String(sourceView || WORLDVIEW_NAV_SOURCE.OPEN);
    if (isApplying(source)) {
      return { accepted: false, reason: 'programmatic', snapshot: snapshot() };
    }
    const merged = mergeNavigationPatch(state, patch, source, revision + 1);
    if (!merged) {
      return { accepted: false, reason: 'invalid', snapshot: snapshot() };
    }
    if (navigationWithinTolerance(merged, state, tolerance)) {
      return { accepted: false, reason: 'tolerance', snapshot: snapshot() };
    }
    if (Date.now() < (ignoreUntil.get(source) || 0)) {
      echoBudget += 1;
      return { accepted: false, reason: 'echo', snapshot: snapshot(), echoBudget };
    }
    revision = merged.revision;
    state = merged;
    emit();
    return { accepted: true, reason: 'commit', snapshot: snapshot() };
  }

  function seedFromFocus(focus, extras = {}) {
    if (!focus) return { accepted: false, reason: 'invalid', snapshot: snapshot() };
    return propose(WORLDVIEW_NAV_SOURCE.FOCUS, {
      longitude: focus.longitude,
      latitude: focus.latitude,
      rangeMeters: extras.rangeMeters ?? state?.rangeMeters,
      scale: extras.scale ?? state?.scale,
      heading: extras.heading === undefined ? state?.heading : extras.heading
    });
  }

  function subscribe(listener) {
    listeners.add(listener);
    listener(snapshot());
    return () => listeners.delete(listener);
  }

  function reset() {
    state = null;
    revision = 0;
    echoBudget = 0;
    applyingTo.clear();
    appliedRevisionBy.clear();
    ignoreUntil.clear();
    streetOperatingScaleArmed = false;
    operatorHoldsMapScale = false;
    emit();
  }

  return {
    snapshot,
    propose,
    seedFromFocus,
    subscribe,
    beginApply,
    endApply,
    isApplying,
    getEchoBudget: () => echoBudget,
    getTolerance: () => ({ ...tolerance }),
    reset
  };
}

const shared = createWorldviewNavigationController();

export function getWorldviewNavigation() {
  return shared.snapshot();
}

export function proposeWorldviewNavigation(sourceView, patch) {
  return shared.propose(sourceView, patch);
}

export function seedWorldviewNavigationFromFocus(focus, extras) {
  return shared.seedFromFocus(focus, extras);
}

export function subscribeWorldviewNavigation(listener) {
  return shared.subscribe(listener);
}

export function beginWorldviewNavigationApply(sourceView) {
  shared.beginApply(sourceView);
}

export function endWorldviewNavigationApply(sourceView, revision) {
  shared.endApply(sourceView, revision);
}

export function isWorldviewNavigationApplying(sourceView) {
  return shared.isApplying(sourceView);
}

export function getWorldviewNavigationEchoBudget() {
  return shared.getEchoBudget();
}

export function resetWorldviewNavigationForTests() {
  shared.reset();
}

/**
 * Street 360 live capability of the current Google StreetViewPanorama seam.
 * Position/heading/zoom events exist. Street zoom is panorama FOV, not 2D scale.
 */
export function getStreet360LiveCapability() {
  return Object.freeze({
    provider: 'google-maps-js-streetview-panorama',
    positionEvents: true,
    events: Object.freeze([
      'position_changed',
      'pano_changed',
      'pov_changed',
      'zoom_changed',
      'links_changed'
    ]),
    headingFromPov: true,
    zoomToWorldScale: false,
    pitchToMap: false,
    pitchTo3dTilt: false,
    note: 'StreetViewPanorama exposes position, POV, and zoom. Zoom stays Street-only FOV. Pitch stays Street-only.'
  });
}
