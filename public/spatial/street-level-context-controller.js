/**
 * Street-level context controller — binds Street View to selected IQAI location.
 * Explicit user action only. Does not own map-click selection authority.
 */
import {
  applyStreetLevelContextConfig,
  closeStreetLevelContext,
  getStreetLevelContextState,
  mountStreetLevelPanorama,
  openStreetLevelContext,
  setStreetLevelContextSelectedLocation,
  subscribeStreetLevelContextState
} from './street-level-context-service.js';
import {
  STREET_LEVEL_CONTEXT_CONFIG_PATH,
  STREET_LEVEL_CONTEXT_UI_ENABLED
} from './street-level-context-config.js';
import {
  renderStreetLevelContextActionHtml,
  renderStreetLevelContextPanelHtml,
  resolveStreetLevelActionState
} from './street-level-context-presentation.js';
import {
  getPointIntelligenceState,
  subscribePointIntelligenceState
} from './point-intelligence-service.js';

let sectionEl = null;
let configPromise = null;
let unsubPi = null;
let unsubSlc = null;
let observer = null;
let syncScheduled = false;

async function ensureConfig() {
  if (!STREET_LEVEL_CONTEXT_UI_ENABLED) {
    applyStreetLevelContextConfig({ configured: false });
    return getStreetLevelContextState();
  }
  if (configPromise) return configPromise;
  configPromise = (async () => {
    try {
      const res = await fetch(STREET_LEVEL_CONTEXT_CONFIG_PATH, { cache: 'no-store' });
      const body = await res.json().catch(() => ({}));
      const slc = body.streetLevelContext || {};
      return applyStreetLevelContextConfig({
        configured: Boolean(slc.configured),
        googleMapsBrowserApiKey: slc.googleMapsBrowserApiKey || ''
      });
    } catch {
      return applyStreetLevelContextConfig({ configured: false });
    }
  })();
  return configPromise;
}

function actionHost() {
  return sectionEl?.querySelector('[data-slc-action-host]') || null;
}

function panelHost() {
  return sectionEl?.querySelector('#slc-panel-host') || null;
}

function syncActionButton() {
  const host = actionHost();
  if (!host) return;
  const pi = getPointIntelligenceState();
  const slc = getStreetLevelContextState();
  const actionState = resolveStreetLevelActionState({
    hasLocation: Boolean(pi.lastClickedPoint || slc.requestedLocation),
    configured: slc.configured,
    panelState: slc.panelState
  });
  host.innerHTML = renderStreetLevelContextActionHtml(actionState);
}

function syncPanel() {
  const host = panelHost();
  if (!host) return;
  const slc = getStreetLevelContextState();
  if (slc.panelState === 'CLOSED') {
    host.hidden = true;
    host.innerHTML = '';
    sectionEl?.classList.remove('slc-section--open');
    return;
  }
  host.hidden = false;
  host.innerHTML = renderStreetLevelContextPanelHtml(slc);
  sectionEl?.classList.add('slc-section--open');
}

function syncUi() {
  syncActionButton();
  syncPanel();
}

function scheduleSyncUi() {
  if (syncScheduled) return;
  syncScheduled = true;
  queueMicrotask(() => {
    syncScheduled = false;
    syncUi();
  });
}

async function handleOpen() {
  await ensureConfig();
  const state = await openStreetLevelContext(null);
  // Paint AVAILABLE / UNAVAILABLE shell before optional panorama mount.
  syncUi();
  if (state.panelState !== 'AVAILABLE') return;
  const panoramaEl = panelHost()?.querySelector('#slc-panorama');
  if (panoramaEl) {
    await mountStreetLevelPanorama(panoramaEl);
  }
}

function handleClose() {
  closeStreetLevelContext();
}

function onClick(event) {
  const target = event.target;
  if (!(target instanceof Element)) return;
  if (target.closest('[data-slc-open]')) {
    event.preventDefault();
    void handleOpen();
    return;
  }
  if (target.closest('[data-slc-close]')) {
    event.preventDefault();
    handleClose();
  }
}

/**
 * @param {HTMLElement | null} container — `#spatial-point-intelligence-section`
 */
export function mountStreetLevelContext(container) {
  sectionEl = container;
  if (!sectionEl || !STREET_LEVEL_CONTEXT_UI_ENABLED) return () => {};

  sectionEl.addEventListener('click', onClick);

  unsubPi = subscribePointIntelligenceState((piState) => {
    setStreetLevelContextSelectedLocation(piState.lastClickedPoint);
    scheduleSyncUi();
  });

  unsubSlc = subscribeStreetLevelContextState(() => {
    scheduleSyncUi();
  });

  observer = new MutationObserver(() => {
    // LIF HTML rebuilds wipe action/panel hosts — re-sync without re-query.
    if (!actionHost()?.querySelector('[data-slc-action]') || (
      getStreetLevelContextState().panelState !== 'CLOSED' && !panelHost()?.querySelector('[data-slc-panel]')
    )) {
      scheduleSyncUi();
    }
  });
  observer.observe(sectionEl, { childList: true, subtree: true });

  void ensureConfig().then(() => scheduleSyncUi());

  return () => {
    sectionEl?.removeEventListener('click', onClick);
    unsubPi?.();
    unsubSlc?.();
    observer?.disconnect();
    unsubPi = null;
    unsubSlc = null;
    observer = null;
    sectionEl = null;
  };
}

export async function preloadStreetLevelContextConfig() {
  return ensureConfig();
}
