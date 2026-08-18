import { HEADER_STATUS_SLOTS, SHELL_SLOTS } from './layout-registry.js';

function statusCell(slot) {
  const major = slot.emphasis === 'major';
  const valueId = slot.id === 'time' ? ' id="iqai-v2-time-value"' : '';
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
  const timeSlot = HEADER_STATUS_SLOTS.find((item) => item.id === 'time');
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
          <img class="iqai-v2-brand__logo" src="/spatial/assets/iqai-logo.svg" alt="IQAI" />
          <div class="iqai-v2-brand__lockup">
            <span class="iqai-v2-brand__product">IQAI SPATIAL</span>
            <span class="iqai-v2-brand__edition">MONTRÉAL</span>
          </div>
        </div>

        <div class="iqai-v2-header__site" data-iqai-header-site>MONTRÉAL</div>

        ${timeSlot ? statusCell(timeSlot) : ''}

        <button
          type="button"
          class="iqai-v2-system-status"
          data-iqai-system-status
          aria-expanded="false"
          aria-controls="iqai-v2-system-status-detail"
        >
          <span class="iqai-v2-status__label">SYSTEM STATUS</span>
          <span class="iqai-v2-status__value" data-iqai-system-status-value data-state="shell-only">SHELL ONLY</span>
        </button>

        <div class="iqai-v2-header__modes">
          <button
            type="button"
            class="iqai-v2-mode iqai-v2-mode--current"
            data-iqai-experience="NORMAL"
            aria-pressed="true"
          >NORMAL</button>
          <button
            type="button"
            class="iqai-v2-mode"
            data-iqai-experience="EXPERT"
            aria-pressed="false"
          >EXPERT</button>
          <button
            type="button"
            class="iqai-v2-mode iqai-v2-mode--presentation"
            data-iqai-mode="presentation"
            title="Presentation mode is reserved. Camera lock, chrome reduction, and replay are not implemented."
            aria-pressed="false"
            disabled
          >PRESENTATION</button>
        </div>
      </div>

      <div
        id="iqai-v2-system-status-detail"
        class="iqai-v2-header__detail"
        data-iqai-system-status-detail
        hidden
      >
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

export function startHeaderClock(root) {
  const value = root.querySelector('#iqai-v2-time-value');
  if (!value) return () => {};

  const tick = () => {
    value.textContent = formatShellClock();
    const cell = value.closest('[data-iqai-status]');
    if (cell) cell.title = `TIME — ${value.textContent}`;
  };
  tick();
  const timer = window.setInterval(tick, 1000);
  return () => window.clearInterval(timer);
}
