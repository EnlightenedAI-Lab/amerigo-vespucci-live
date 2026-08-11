/**
 * Street-level context service — open/close Street View from selected IQAI location.
 * Never triggers Point Intelligence / Agent 2 / Agent 5 intelligence requests.
 */
import {
  SLC_PANEL_STATE,
  STREET_LEVEL_CONTEXT_PROVIDER_GOOGLE,
  STREET_LEVEL_CONTEXT_UI_ENABLED
} from './street-level-context-config.js';
import { createStreetLevelContextProvider } from './street-level-context-provider.js';

/** @type {import('./street-level-context-provider.js').createStreetLevelContextProvider extends Function ? any : never} */
let provider = null;
let googleRequestCount = 0;
let panelState = SLC_PANEL_STATE.CLOSED;
/** @type {{ latitude: number, longitude: number } | null} */
let requestedLocation = null;
/** @type {{ latitude: number, longitude: number } | null} */
let panoramaLocation = null;
/** @type {number | null} */
let offsetMeters = null;
let lastMessage = null;
let configured = false;
let configLoaded = false;
/** @type {object | null} */
let lastAvailability = null;

/** @type {Set<(state: object) => void>} */
const listeners = new Set();

function emit() {
  const snapshot = getStreetLevelContextState();
  for (const listener of listeners) {
    try { listener(snapshot); } catch { /* ignore */ }
  }
}

function ensureProvider(options = {}) {
  if (!provider || options.forceRecreate) {
    provider = createStreetLevelContextProvider(
      STREET_LEVEL_CONTEXT_PROVIDER_GOOGLE,
      options.providerOptions || {}
    );
  }
  return provider;
}

export function getStreetLevelContextState() {
  return {
    uiEnabled: STREET_LEVEL_CONTEXT_UI_ENABLED,
    configured,
    configLoaded,
    panelState,
    requestedLocation: requestedLocation ? { ...requestedLocation } : null,
    panoramaLocation: panoramaLocation ? { ...panoramaLocation } : null,
    offsetMeters,
    message: lastMessage,
    googleRequestCount,
    providerId: STREET_LEVEL_CONTEXT_PROVIDER_GOOGLE
  };
}

export function subscribeStreetLevelContextState(listener) {
  listeners.add(listener);
  listener(getStreetLevelContextState());
  return () => listeners.delete(listener);
}

export function getStreetLevelGoogleRequestCount() {
  return googleRequestCount;
}

export function resetStreetLevelGoogleRequestCount() {
  googleRequestCount = 0;
}

/**
 * Inject provider for deterministic tests (mocked Google).
 * @param {object | null} nextProvider
 * @param {{ configured?: boolean }} [meta]
 */
export function setStreetLevelContextProviderForTests(nextProvider, meta = {}) {
  provider = nextProvider;
  if (meta.configured != null) {
    configured = Boolean(meta.configured);
    configLoaded = true;
  } else if (nextProvider && typeof nextProvider.isConfigured === 'function') {
    configured = nextProvider.isConfigured();
    configLoaded = true;
  }
  emit();
}

/**
 * Apply public config (from /api/spatial/config). Does not load Street View imagery.
 * @param {{ configured?: boolean, googleMapsBrowserApiKey?: string, providerOptions?: object }} config
 */
export function applyStreetLevelContextConfig(config = {}) {
  const apiKey = String(config.googleMapsBrowserApiKey || '').trim();
  configured = Boolean(config.configured ?? apiKey);
  configLoaded = true;
  ensureProvider({
    forceRecreate: true,
    providerOptions: {
      apiKey,
      ...(config.providerOptions || {})
    }
  });
  emit();
  return getStreetLevelContextState();
}

/**
 * Update the IQAI selected location the Street View action is bound to.
 * Does not open Street View and does not mutate the caller's point object.
 * @param {{ latitude: number, longitude: number } | null} point
 */
export function setStreetLevelContextSelectedLocation(point) {
  if (!point || !Number.isFinite(Number(point.latitude)) || !Number.isFinite(Number(point.longitude))) {
    requestedLocation = null;
    if (panelState !== SLC_PANEL_STATE.CLOSED && panelState !== SLC_PANEL_STATE.CONFIG_DISABLED) {
      closeStreetLevelContext();
    } else {
      emit();
    }
    return getStreetLevelContextState();
  }

  const next = {
    latitude: Number(point.latitude),
    longitude: Number(point.longitude)
  };
  const changed = !requestedLocation
    || requestedLocation.latitude !== next.latitude
    || requestedLocation.longitude !== next.longitude;

  // Preserve caller identity: store a copy only.
  requestedLocation = next;

  if (changed && panelState !== SLC_PANEL_STATE.CLOSED) {
    // New IQAI selection — close Street View without auto-loading.
    closeStreetLevelContext({ preserveRequested: true });
  } else {
    emit();
  }
  return getStreetLevelContextState();
}

/**
 * Explicit user action: check/load Street View for the current selected location.
 * @param {HTMLElement | null | (() => HTMLElement | null)} panoramaContainer
 * @param {object} [options]
 */
export async function openStreetLevelContext(panoramaContainer, options = {}) {
  if (!STREET_LEVEL_CONTEXT_UI_ENABLED) {
    panelState = SLC_PANEL_STATE.CLOSED;
    lastMessage = 'Street View UI is disabled';
    emit();
    return getStreetLevelContextState();
  }

  const point = options.requestedLocation || requestedLocation;
  if (!point) {
    panelState = SLC_PANEL_STATE.NO_LOCATION;
    panoramaLocation = null;
    offsetMeters = null;
    lastMessage = 'Select a map location first';
    emit();
    return getStreetLevelContextState();
  }

  // Always copy — never alias caller / IQAI selected location.
  requestedLocation = {
    latitude: Number(point.latitude),
    longitude: Number(point.longitude)
  };

  const active = ensureProvider({ providerOptions: options.providerOptions });
  if (!configured || (typeof active.isConfigured === 'function' && !active.isConfigured())) {
    panelState = SLC_PANEL_STATE.CONFIG_DISABLED;
    panoramaLocation = null;
    offsetMeters = null;
    lastMessage = 'Street View is not configured (missing Google Maps browser API key)';
    emit();
    return getStreetLevelContextState();
  }

  panelState = SLC_PANEL_STATE.CHECKING;
  panoramaLocation = null;
  offsetMeters = null;
  lastMessage = null;
  emit();

  // One user open → one accounted Google session (metadata ± panorama).
  // Never classified as Point Intelligence / Agent 2 / Agent 5 intelligence requests.
  if (!options.skipGoogleCount) {
    googleRequestCount += 1;
  }

  try {
    const availability = await active.checkAvailability(requestedLocation);
    if (!availability.available) {
      panelState = availability.status === 'CONFIG_DISABLED'
        ? SLC_PANEL_STATE.CONFIG_DISABLED
        : SLC_PANEL_STATE.UNAVAILABLE;
      panoramaLocation = null;
      offsetMeters = null;
      lastMessage = availability.message || 'Street View unavailable near this location';
      emit();
      return getStreetLevelContextState();
    }

    panoramaLocation = availability.panorama ? { ...availability.panorama } : null;
    offsetMeters = availability.offsetMeters ?? null;
    panelState = SLC_PANEL_STATE.AVAILABLE;
    lastMessage = null;
    // Stash availability for a follow-up mount after UI paints #slc-panorama.
    lastAvailability = availability;
    emit();

    const container = typeof panoramaContainer === 'function'
      ? panoramaContainer()
      : panoramaContainer;

    if (container) {
      await active.openPanorama(container, {
        requested: requestedLocation,
        availability
      });
      emit();
    }

    return getStreetLevelContextState();
  } catch (error) {
    panelState = SLC_PANEL_STATE.ERROR;
    panoramaLocation = null;
    offsetMeters = null;
    lastMessage = error?.message || 'Street View failed to load';
    lastAvailability = null;
    emit();
    return getStreetLevelContextState();
  }
}

/**
 * Mount interactive panorama into a container after UI has rendered AVAILABLE state.
 * Does not increment Google request count (open already did).
 * @param {HTMLElement | null} container
 */
export async function mountStreetLevelPanorama(container) {
  if (!container || panelState !== SLC_PANEL_STATE.AVAILABLE || !requestedLocation) {
    return getStreetLevelContextState();
  }
  const active = ensureProvider();
  const availability = lastAvailability || {
    available: true,
    requested: requestedLocation,
    panorama: panoramaLocation,
    offsetMeters
  };
  await active.openPanorama(container, {
    requested: requestedLocation,
    availability
  });
  emit();
  return getStreetLevelContextState();
}

/**
 * Close Street View without re-querying IQAI intelligence.
 * @param {{ preserveRequested?: boolean }} [options]
 */
export function closeStreetLevelContext(options = {}) {
  try {
    provider?.closePanorama?.();
  } catch {
    /* ignore */
  }
  panelState = SLC_PANEL_STATE.CLOSED;
  panoramaLocation = null;
  offsetMeters = null;
  lastMessage = null;
  lastAvailability = null;
  if (!options.preserveRequested && options.clearRequested) {
    requestedLocation = null;
  }
  emit();
  return getStreetLevelContextState();
}

export function resetStreetLevelContextState() {
  try {
    provider?.closePanorama?.();
  } catch {
    /* ignore */
  }
  provider = null;
  panelState = SLC_PANEL_STATE.CLOSED;
  requestedLocation = null;
  panoramaLocation = null;
  offsetMeters = null;
  lastMessage = null;
  lastAvailability = null;
  configured = false;
  configLoaded = false;
  googleRequestCount = 0;
  emit();
}
