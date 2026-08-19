/**
 * MapView adapter for shared WorldView navigation.
 * Reads/writes portable center, scale, heading. Does not create MapView.
 * FOCUS-seeded navigation does not steal the operator's current 2D framing.
 */

import {
  WORLDVIEW_NAV_SOURCE,
  WORLDVIEW_NAV_TOLERANCE,
  STREET_MAP_OPERATING_SCALE,
  beginWorldviewNavigationApply,
  endWorldviewNavigationApply,
  getWorldviewNavigation,
  isStreetOperatingScaleArmed,
  isWorldviewNavigationApplying,
  mapScaleFromRangeMeters,
  navigationWithinTolerance,
  noteOperatorMapScaleIntent,
  operatorHoldsMapScaleIntent,
  proposeWorldviewNavigation,
  rangeMetersFromExtentWidth,
  rangeMetersFromMapScale,
  subscribeWorldviewNavigation
} from './worldview-navigation.js';

export function readMapViewNavigation(view) {
  if (!view) return null;
  const longitude = Number(view.center?.longitude);
  const latitude = Number(view.center?.latitude);
  if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) return null;
  const scale = Number(view.scale);
  const fromScale = rangeMetersFromMapScale(scale);
  const heading = Number(view.rotation);
  return {
    longitude,
    latitude,
    scale: Number.isFinite(scale) && scale > 0 ? scale : mapScaleFromRangeMeters(fromScale),
    rangeMeters: fromScale || rangeMetersFromExtentWidth(Number(view.extent?.width)),
    heading: Number.isFinite(heading) ? heading : 0
  };
}

export function applyWorldviewNavigationToMapView(view, nav) {
  if (!view || !nav) return false;
  const current = readMapViewNavigation(view);
  const streetSource = nav.sourceView === WORLDVIEW_NAV_SOURCE.STREET_360;
  const keepStreetScale = nav.sourceView === WORLDVIEW_NAV_SOURCE.VISUAL_3D
    && isStreetOperatingScaleArmed();
  const comparable = streetSource
    ? { ...nav, heading: current?.heading }
    : nav;
  if (navigationWithinTolerance(comparable, current)) return false;
  beginWorldviewNavigationApply(WORLDVIEW_NAV_SOURCE.MAP);
  try {
    let scale = Number(nav.scale) || mapScaleFromRangeMeters(nav.rangeMeters);
    if (streetSource) {
      scale = operatorHoldsMapScaleIntent()
        ? (Number(current?.scale) || scale)
        : STREET_MAP_OPERATING_SCALE;
    } else if (keepStreetScale) {
      scale = Number(current?.scale) || mapScaleFromRangeMeters(current?.rangeMeters);
    }
    if (view.constraints) {
      view.constraints.snapToZoom = false;
      const minScale = Number(view.constraints.minScale);
      if (Number.isFinite(minScale) && Number.isFinite(scale) && minScale > scale) {
        view.constraints.minScale = 0;
      }
    }
    const target = {};
    if (Number.isFinite(nav.longitude) && Number.isFinite(nav.latitude)) {
      view.center = [nav.longitude, nav.latitude];
      if (typeof view.center?.longitude !== 'number') {
        view.center = { longitude: nav.longitude, latitude: nav.latitude };
      }
      target.center = [nav.longitude, nav.latitude];
    }
    if (Number.isFinite(scale) && scale > 0) {
      view.scale = scale;
      target.scale = scale;
    }
    if (!streetSource && Number.isFinite(Number(nav.heading))) {
      view.rotation = Number(nav.heading);
      target.rotation = Number(nav.heading);
    }
    view.__iqaiLastNavApply = {
      sourceView: nav.sourceView,
      scale: target.scale ?? null,
      longitude: nav.longitude,
      latitude: nav.latitude,
      at: Date.now()
    };
    if (typeof view.goTo === 'function' && (target.center || target.scale)) {
      void view.goTo(target, { animate: false, duration: 0 });
    }
  } finally {
    endWorldviewNavigationApply(WORLDVIEW_NAV_SOURCE.MAP, nav.revision);
  }
  return true;
}

export function attachWorldviewMapAdapter(view, options = {}) {
  if (!view) return () => {};
  const handles = [];
  let debounceTimer = null;
  let lastSample = readMapViewNavigation(view);
  const debounceMs = options.debounceMs ?? WORLDVIEW_NAV_TOLERANCE.debounceMs;

  function sampleAndPropose(force = false) {
    if (isWorldviewNavigationApplying(WORLDVIEW_NAV_SOURCE.MAP)) return;
    const sample = readMapViewNavigation(view);
    if (!sample) return;
    if (!force && lastSample && navigationWithinTolerance(sample, lastSample)) return;
    lastSample = sample;
    proposeWorldviewNavigation(WORLDVIEW_NAV_SOURCE.MAP, sample);
  }

  function schedulePropose() {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => sampleAndPropose(true), debounceMs);
  }

  if (typeof view.watch === 'function') {
    handles.push(view.watch('stationary', (stationary) => {
      if (stationary) {
        clearTimeout(debounceTimer);
        sampleAndPropose(true);
      } else {
        schedulePropose();
      }
    }));
    handles.push(view.watch('center.longitude', schedulePropose));
    handles.push(view.watch('center.latitude', schedulePropose));
    handles.push(view.watch('scale', schedulePropose));
    handles.push(view.watch('rotation', schedulePropose));
    handles.push(view.watch('viewpoint', schedulePropose));
  }
  if (typeof view.on === 'function') {
    handles.push(view.on('drag', schedulePropose));
    handles.push(view.on('mouse-wheel', () => {
      noteOperatorMapScaleIntent();
      schedulePropose();
    }));
    handles.push(view.on('pointer-up', () => sampleAndPropose(true)));
  }

  const poll = setInterval(() => sampleAndPropose(false), 200);

  const unsubscribe = subscribeWorldviewNavigation((nav) => {
    if (!nav) return;
    if (nav.sourceView === WORLDVIEW_NAV_SOURCE.MAP) return;
    if (nav.sourceView === WORLDVIEW_NAV_SOURCE.FOCUS) return;
    if (nav.sourceView === WORLDVIEW_NAV_SOURCE.OPEN) return;
    applyWorldviewNavigationToMapView(view, nav);
    lastSample = readMapViewNavigation(view) || lastSample;
  });

  if (!getWorldviewNavigation()) {
    const initial = readMapViewNavigation(view);
    if (initial) proposeWorldviewNavigation(WORLDVIEW_NAV_SOURCE.OPEN, initial);
  }

  return () => {
    clearTimeout(debounceTimer);
    clearInterval(poll);
    unsubscribe();
    for (const handle of handles) {
      try {
        handle?.remove?.();
      } catch {
        // ArcGIS watch handle may already be destroyed with the view.
      }
    }
  };
}
