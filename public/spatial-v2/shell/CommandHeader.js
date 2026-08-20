import { HEADER_STATUS_SLOTS, SHELL_SLOTS } from './layout-registry.js';
import { formatTimeDock } from './TimeDock.js';

function statusCell(slot) {
  const major = slot.emphasis === 'major';
  const valueId = slot.id === 'time' ? ' id="iqai-v2-header-time-value"' : '';
  const shortLabel = slot.shortLabel && slot.shortLabel !== slot.label
    ? `<span class="iqai-v2-status__label-short">${slot.shortLabel}</span>`
    : '';
  return `
    <div
      class="iqai-v2-status${major ? ' iqai-v2-status--major' : ' iqai-v2-status--lamp'}"
      data-iqai-status="${slot.id}"
      title="${slot.label} — ${slot.value}"
    >
      ${major ? '' : '<span class="iqai-v2-status__lamp" aria-hidden="true"></span>'}
      <span class="iqai-v2-status__label">
        <span class="iqai-v2-status__label-full">${slot.label}</span>
        ${shortLabel}
      </span>
      <span class="iqai-v2-status__value" data-state="${slot.state}"${valueId}>${slot.value}</span>
    </div>
  `;
}

export function compactSystemStatusValue(mapState) {
  if (mapState === 'READY') return { value: 'MAP READY', state: 'map-ready' };
  if (mapState === 'ERROR') return { value: 'MAP ERROR', state: 'map-error' };
  return { value: 'SHELL ONLY', state: 'shell-only' };
}

export function renderCommandHeader() {
  const { id, slot } = SHELL_SLOTS.commandHeader;
  const detailSlots = HEADER_STATUS_SLOTS.filter((item) => item.id !== 'time');

  return `
    <header
      id="${id}"
      class="iqai-v2-header"
      data-iqai-slot="${slot}"
      data-iqai-system-status-open="false"
      role="banner"
    >
      <div class="iqai-v2-header__primary" data-iqai-header-primary>
        <div class="iqai-v2-brand">
          <img
            class="iqai-v2-brand__logo"
            src="/spatial/assets/iqai-logo.svg"
            width="72"
            height="23"
            alt="IQAI"
          />
          <div class="iqai-v2-brand__lockup">
            <span class="iqai-v2-brand__product">SPATIAL</span>
          </div>
        </div>

        <form class="iqai-v2-search" data-iqai-search-form autocomplete="off">
          <label>
            <span class="iqai-v2-visually-hidden">Search</span>
            <input
              class="iqai-v2-search__input"
              type="search"
              name="place"
              placeholder="Search"
              data-iqai-search-input
            />
          </label>
        </form>

        <nav class="iqai-v2-header__commands" aria-label="Command surfaces">
          <div class="iqai-v2-header__surfaces" role="radiogroup" aria-label="Map surface">
            <button type="button" data-iqai-image-surface="MAP" aria-pressed="true">MAP</button>
            <button type="button" data-iqai-image-surface="AERIAL" aria-pressed="false">AERIAL</button>
            <button type="button" data-iqai-image-surface="HISTORY" aria-pressed="false">HISTORY</button>
            <button type="button" data-iqai-library-toggle aria-pressed="false">LIBRARY</button>
            <button type="button" data-iqai-remote-sensing-toggle aria-pressed="false">REMOTE SENSING</button>
          </div>
          <div class="iqai-v2-view-switcher" data-iqai-view-switcher>
            <button type="button" class="iqai-v2-visually-hidden" data-iqai-view="MAP" aria-pressed="true">MAP</button>
            <button type="button" data-iqai-view="3D VISUAL" aria-pressed="false">3D</button>
            <button type="button" data-iqai-view="STREET 360" aria-pressed="false">STREET 360</button>
            <button type="button" data-iqai-view="3D ANALYZE" aria-pressed="false">3D ANALYZE</button>
          </div>
        </nav>

        <button
          type="button"
          class="iqai-v2-theme-toggle"
          data-iqai-theme-toggle
          aria-label="Switch color theme"
        >WHITE</button>
        <button
          type="button"
          class="iqai-v2-ask-toggle"
          data-iqai-ask-toggle
          aria-expanded="false"
          aria-label="Ask IQAI"
          aria-controls="${SHELL_SLOTS.askIqaiDock.id}"
        >BRAIN</button>
      </div>

      <div class="iqai-v2-visually-hidden" data-iqai-system-status-detail>
        ${detailSlots.map(statusCell).join('')}
      </div>
    </header>
  `;
}

export function formatShellClock(date = new Date()) {
  return new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    timeZoneName: 'short'
  }).format(date);
}

export function updateHeaderStatus(root, statusId, value, state) {
  const cell = root.querySelector(`[data-iqai-status="${statusId}"]`);
  if (!cell) return;
  const valueEl = cell.querySelector('.iqai-v2-status__value');
  if (valueEl) {
    valueEl.textContent = value;
    if (state) valueEl.dataset.state = state;
  }
  const label = cell.querySelector('.iqai-v2-status__label-full')?.textContent || statusId;
  cell.title = `${label} — ${value}`;
}

export function paintSystemStatus(root, { mapState, open } = {}) {
  const compact = compactSystemStatusValue(mapState);
  const header = root.querySelector('[data-iqai-slot="command-header"]');
  const button = root.querySelector('[data-iqai-system-status]');
  const valueEl = root.querySelector('[data-iqai-system-status-value]');
  const detail = root.querySelector('[data-iqai-system-status-detail]');
  if (valueEl) {
    valueEl.textContent = compact.value;
    valueEl.dataset.state = compact.state;
  }
  if (button) {
    button.setAttribute('aria-expanded', open ? 'true' : 'false');
    button.classList.toggle('is-open', Boolean(open));
  }
  if (detail) detail.hidden = !open;
  if (header) header.dataset.iqaiSystemStatusOpen = open ? 'true' : 'false';
  root.dataset.iqaiSystemStatusOpen = open ? 'true' : 'false';
}

export function paintExperienceControl(root, experience) {
  root.dataset.iqaiExperience = String(experience || 'NORMAL').toLowerCase();
  root.querySelectorAll('[data-iqai-experience]').forEach((control) => {
    const selected = control.getAttribute('data-iqai-experience') === experience;
    control.classList.toggle('iqai-v2-mode--current', selected);
    control.setAttribute('aria-pressed', selected ? 'true' : 'false');
  });
  const models = root.querySelector('[data-iqai-model-selector]');
  if (models) models.hidden = experience !== 'EXPERT';
}

export function bindSystemStatusControl(root, handlers = {}) {
  const onClick = (event) => {
    const control = event.target.closest('[data-iqai-system-status]');
    if (!control || !root.contains(control)) return;
    if (typeof handlers.onToggle === 'function') handlers.onToggle();
  };
  root.addEventListener('click', onClick);
  return () => root.removeEventListener('click', onClick);
}

export function bindExperienceControls(root, handlers = {}) {
  const onClick = (event) => {
    const control = event.target.closest('[data-iqai-experience]');
    if (!control || !root.contains(control)) return;
    const experience = control.getAttribute('data-iqai-experience');
    if (experience && typeof handlers.onChange === 'function') {
      handlers.onChange(experience);
    }
  };
  root.addEventListener('click', onClick);
  return () => root.removeEventListener('click', onClick);
}

export function bindSearchControl(root, handlers = {}) {
  const form = root.querySelector('[data-iqai-search-form]');
  if (!form) return () => {};
  const onSubmit = (event) => {
    event.preventDefault();
    const input = form.querySelector('[data-iqai-search-input]');
    const query = String(input?.value || '').trim();
    if (query && typeof handlers.onSearch === 'function') handlers.onSearch(query);
  };
  form.addEventListener('submit', onSubmit);
  return () => form.removeEventListener('submit', onSubmit);
}

export function startHeaderClock(root) {
  const value = root.querySelector('#iqai-v2-time-value');
  if (!value) return () => {};

  const tick = () => {
    value.textContent = formatTimeDock();
  };
  tick();
  const timer = window.setInterval(tick, 1000);
  return () => window.clearInterval(timer);
}
