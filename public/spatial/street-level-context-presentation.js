/**
 * Street-level context presentation — compact action + reversible panel.
 */
import { SLC_PANEL_STATE } from './street-level-context-config.js';

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatCoord(point) {
  if (!point) return '—';
  const lat = Number(point.latitude);
  const lon = Number(point.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return '—';
  return `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
}

/**
 * Compact Street View control HTML for the LIF anchor.
 * @param {{ hasLocation?: boolean, configured?: boolean, open?: boolean }} state
 */
export function renderStreetLevelContextActionHtml(state = {}) {
  const hasLocation = Boolean(state.hasLocation);
  const configured = Boolean(state.configured);
  const open = Boolean(state.open);

  let disabled = false;
  let title = 'Open Street View for the selected location';
  let label = open ? 'Close Street View' : 'Street View';
  let action = open ? 'close' : 'open';

  if (!hasLocation) {
    disabled = true;
    title = 'Select a map location first';
  } else if (!configured) {
    disabled = true;
    title = 'Street View is not configured (Google Maps browser API key missing)';
    label = 'Street View (not configured)';
    action = 'open';
  }

  return `
    <div class="slc-action" data-slc-action>
      <button
        type="button"
        class="slc-action__button"
        data-slc-${action}
        ${disabled ? 'disabled' : ''}
        title="${escapeHtml(title)}"
        aria-disabled="${disabled ? 'true' : 'false'}"
      >${escapeHtml(label)}</button>
    </div>`;
}

export function renderStreetLevelContextHostHtml() {
  return '<div id="slc-panel-host" class="slc-panel-host" hidden></div>';
}

/**
 * @param {ReturnType<import('./street-level-context-service.js').getStreetLevelContextState>} state
 */
export function renderStreetLevelContextPanelHtml(state) {
  if (!state || state.panelState === SLC_PANEL_STATE.CLOSED) {
    return '';
  }

  const requested = formatCoord(state.requestedLocation);
  const panorama = state.panoramaLocation
    ? formatCoord(state.panoramaLocation)
    : (state.panelState === SLC_PANEL_STATE.AVAILABLE ? 'SAME' : 'unavailable');
  const offset = Number.isFinite(state.offsetMeters)
    ? `${Math.round(state.offsetMeters)} m from IQAI location`
    : null;

  let body = '';
  if (state.panelState === SLC_PANEL_STATE.CHECKING) {
    body = '<p class="slc-panel__status" role="status">Checking Street View availability…</p>';
  } else if (state.panelState === SLC_PANEL_STATE.CONFIG_DISABLED) {
    body = `<p class="slc-panel__status slc-panel__status--muted" role="status">${escapeHtml(state.message || 'Street View is not configured')}</p>`;
  } else if (state.panelState === SLC_PANEL_STATE.NO_LOCATION) {
    body = `<p class="slc-panel__status slc-panel__status--muted" role="status">${escapeHtml(state.message || 'Select a map location first')}</p>`;
  } else if (state.panelState === SLC_PANEL_STATE.UNAVAILABLE) {
    body = `<p class="slc-panel__status" role="status">${escapeHtml(state.message || 'Street View unavailable near this location')}</p>`;
  } else if (state.panelState === SLC_PANEL_STATE.ERROR) {
    body = `<p class="slc-panel__status slc-panel__status--error" role="status">${escapeHtml(state.message || 'Street View failed to load')}</p>`;
  } else if (state.panelState === SLC_PANEL_STATE.AVAILABLE) {
    body = '<div id="slc-panorama" class="slc-panorama" role="img" aria-label="Google Street View panorama"></div>';
  }

  return `
    <aside class="slc-panel" data-slc-panel data-state="${escapeHtml(state.panelState)}" aria-label="Street View">
      <header class="slc-panel__header">
        <div>
          <h4 class="slc-panel__title">Street View</h4>
          <p class="slc-panel__subtitle">Visual context only — not IQAI evidence</p>
        </div>
        <button type="button" class="slc-panel__close" data-slc-close title="Close Street View">Close</button>
      </header>
      <dl class="slc-panel__meta">
        <div><dt>IQAI location</dt><dd data-slc-requested>${escapeHtml(requested)}</dd></div>
        <div><dt>Panorama location</dt><dd data-slc-panorama>${escapeHtml(panorama)}</dd></div>
        ${offset ? `<div><dt>Offset</dt><dd data-slc-offset>${escapeHtml(offset)}</dd></div>` : ''}
      </dl>
      <div class="slc-panel__body">${body}</div>
    </aside>`;
}

/**
 * Resolve action availability for the Street View button without opening.
 */
export function resolveStreetLevelActionState({ hasLocation, configured, panelState }) {
  const open = panelState && panelState !== SLC_PANEL_STATE.CLOSED;
  return {
    hasLocation: Boolean(hasLocation),
    configured: Boolean(configured),
    open: Boolean(open),
    canOpen: Boolean(hasLocation && configured && !open)
  };
}
