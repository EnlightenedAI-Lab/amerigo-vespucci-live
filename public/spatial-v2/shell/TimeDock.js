/**
 * Compact wall-clock / imagery calendar instrument.
 * NOW is session wall clock. Requested TARGET TIME is intent, never evidence.
 * Observation markers are real registered observations only.
 */

import { TEMPORAL_LENS, TEMPORAL_MATCH, TEMPORAL_PRECISION } from '../foundation/contracts/temporal-context.js';

const STRIP_YEARS = [2019, 2020, 2021, 2022, 2023, 2024, 2025, 2026];

export function formatTimeDock(date = new Date()) {
  const day = new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric'
  }).format(date).toUpperCase();
  const clock = new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZoneName: 'short'
  }).format(date);
  return `${day} · ${clock}`;
}

export function formatRequestedDay(iso) {
  if (!iso) return null;
  const day = String(iso).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : null;
}

function yearButtons() {
  return STRIP_YEARS.map((year) => (
    `<button type="button" class="iqai-v2-time-strip__year" data-iqai-time-year="${year}">${year}</button>`
  )).join('');
}

export function renderTimeDock() {
  const today = new Date().toISOString().slice(0, 10);
  return `
    <div class="iqai-v2-time-dock" data-iqai-time-dock data-iqai-time-strip aria-label="Time and imagery">
      <button type="button" class="iqai-v2-time-dock__now" data-iqai-time-dock-toggle aria-expanded="false" aria-controls="iqai-v2-time-drawer">
        <span class="iqai-v2-time-dock__icon" aria-hidden="true">
          <svg viewBox="0 0 16 16" width="13" height="13">
            <rect x="1.5" y="3" width="13" height="11.5" rx="1.2" fill="none" stroke="currentColor" stroke-width="1.2" />
            <path d="M1.5 6.5h13M5 1.5v3M11 1.5v3" fill="none" stroke="currentColor" stroke-width="1.2" />
          </svg>
        </span>
        <span class="iqai-v2-time-dock__kicker">NOW</span>
        <span class="iqai-v2-time-dock__value" id="iqai-v2-time-value">${formatTimeDock()}</span>
      </button>
      <label class="iqai-v2-time-strip__target">
        <span>TARGET</span>
        <input type="date" data-iqai-time-requested max="${today}" />
      </label>
      <div class="iqai-v2-time-strip__years" data-iqai-time-years>
        ${yearButtons()}
      </div>
      <div class="iqai-v2-time-strip__obs" data-iqai-time-observations>
        <span data-iqai-obs="google-360" data-iqai-obs-state="idle">GOOGLE 360</span>
        <span data-iqai-obs="nearmap" data-iqai-obs-state="not-connected">NEARMAP NOT CONNECTED</span>
        <span data-iqai-obs="wayback" data-iqai-obs-state="not-connected">WAYBACK NOT CONNECTED</span>
        <span data-iqai-obs="local" data-iqai-obs-state="not-connected">LOCAL NOT CONNECTED</span>
      </div>
    </div>
    <aside id="iqai-v2-time-drawer" class="iqai-v2-time-drawer" data-iqai-time-drawer hidden aria-label="Time and imagery details">
      <header class="iqai-v2-time-drawer__head">
        <h2>TIME / IMAGERY</h2>
        <button type="button" data-iqai-time-drawer-close aria-label="Close time">Close</button>
      </header>
      <div class="iqai-v2-time-drawer__body">
        <p class="iqai-v2-time-drawer__clock" data-iqai-time-clock="now">
          <strong>NOW</strong>
          <span data-iqai-time-now-copy>Session wall clock. Not imagery acquisition.</span>
        </p>
        <p class="iqai-v2-time-drawer__clock" data-iqai-time-clock="imagery">
          <strong>IMAGERY ACQUISITION</strong>
          <span data-iqai-time-imagery-copy>NOT MIGRATED — historical imagery providers are not connected. No acquisition date is shown.</span>
        </p>
        <p class="iqai-v2-time-drawer__note" data-iqai-time-limitation>Acquisition dates will appear on this calendar when imagery is migrated. Requested time is intent, never observation.</p>
      </div>
    </aside>
  `;
}

export function paintTimeDock(root, {
  date = new Date(),
  open = false,
  temporal = null,
  streetCapture = null
} = {}) {
  const value = root.querySelector('#iqai-v2-time-value');
  const drawer = root.querySelector('[data-iqai-time-drawer]');
  const toggle = root.querySelector('[data-iqai-time-dock-toggle]');
  const requested = root.querySelector('[data-iqai-time-requested]');
  const imagery = root.querySelector('[data-iqai-time-imagery-copy]');
  const limitation = root.querySelector('[data-iqai-time-limitation]');
  const google360 = root.querySelector('[data-iqai-obs="google-360"]');
  const targetDay = formatRequestedDay(temporal?.requested?.instantOrInterval);
  if (value) value.textContent = formatTimeDock(date);
  if (drawer) drawer.hidden = !open;
  if (toggle) toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
  root.dataset.iqaiTimeOpen = 'strip';
  if (requested) requested.value = targetDay || '';
  for (const button of root.querySelectorAll('[data-iqai-time-year]')) {
    const year = button.getAttribute('data-iqai-time-year');
    button.classList.toggle('is-active', Boolean(targetDay && targetDay.startsWith(year)));
  }
  if (imagery) {
    const acquisition = temporal?.acquisition?.start;
    imagery.textContent = acquisition
      ? `Acquisition: ${acquisition}`
      : 'NOT MIGRATED — historical imagery providers are not connected. No acquisition date is shown.';
  }
  if (limitation) {
    limitation.textContent = temporal?.limitation
      || 'Acquisition dates will appear on this calendar when imagery is migrated. Requested time is intent, never observation.';
  }
  if (google360) {
    if (streetCapture?.text && streetCapture.precision !== 'UNKNOWN') {
      google360.dataset.iqaiObsState = 'observed';
      google360.textContent = `GOOGLE 360 CAPTURED ${streetCapture.text}`;
    } else {
      google360.dataset.iqaiObsState = 'idle';
      google360.textContent = 'GOOGLE 360';
    }
  }
  void TEMPORAL_LENS;
  void TEMPORAL_MATCH;
  void TEMPORAL_PRECISION;
}

export function bindTimeDock(root, handlers = {}) {
  const onClick = (event) => {
    if (event.target.closest('[data-iqai-time-dock-toggle], [data-iqai-time-drawer-close]')) {
      event.preventDefault();
      handlers.onToggle?.();
      return;
    }
    const year = event.target.closest('[data-iqai-time-year]');
    if (year && root.contains(year)) {
      const value = `${year.getAttribute('data-iqai-time-year')}-08-15`;
      handlers.onRequestedDay?.(value);
    }
  };
  const onChange = (event) => {
    const input = event.target.closest('[data-iqai-time-requested]');
    if (!input || !root.contains(input)) return;
    handlers.onRequestedDay?.(input.value || null);
  };
  root.addEventListener('click', onClick);
  root.addEventListener('change', onChange);
  return () => {
    root.removeEventListener('click', onClick);
    root.removeEventListener('change', onChange);
  };
}
