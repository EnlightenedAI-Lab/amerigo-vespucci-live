import { HEADER_STATUS_SLOTS, SHELL_SLOTS } from './layout-registry.js';

function statusCell(slot) {
  const major = slot.emphasis === 'major' ? ' iqai-v2-status--major' : '';
  const valueId = slot.id === 'time' ? ' id="iqai-v2-time-value"' : '';
  const shortLabel = slot.shortLabel && slot.shortLabel !== slot.label
    ? `<span class="iqai-v2-status__label-short">${slot.shortLabel}</span>`
    : '';
  return `
    <div class="iqai-v2-status${major}" data-iqai-status="${slot.id}">
      <span class="iqai-v2-status__label">
        <span class="iqai-v2-status__label-full">${slot.label}</span>
        ${shortLabel}
      </span>
      <span class="iqai-v2-status__value" data-state="${slot.state}"${valueId}>${slot.value}</span>
    </div>
  `;
}

export function renderCommandHeader() {
  const { id, slot } = SHELL_SLOTS.commandHeader;
  const major = HEADER_STATUS_SLOTS.filter((item) => item.emphasis === 'major');
  const rest = HEADER_STATUS_SLOTS.filter((item) => item.emphasis !== 'major');

  return `
    <header id="${id}" class="iqai-v2-header" data-iqai-slot="${slot}" role="banner">
      <div class="iqai-v2-brand">
        <img class="iqai-v2-brand__logo" src="/spatial/assets/iqai-logo.svg" alt="IQAI" />
        <div class="iqai-v2-brand__lockup">
          <span class="iqai-v2-brand__product">IQAI SPATIAL</span>
          <span class="iqai-v2-brand__edition">V2 COMMAND CENTER</span>
        </div>
      </div>

      <div class="iqai-v2-header__situation">
        ${major.map(statusCell).join('')}
      </div>

      <div class="iqai-v2-header__health" aria-label="System identity and health">
        ${rest.map(statusCell).join('')}
      </div>

      <div class="iqai-v2-header__modes">
        <span class="iqai-v2-mode iqai-v2-mode--current" data-iqai-mode="operator">OPERATOR</span>
        <button
          type="button"
          class="iqai-v2-mode iqai-v2-mode--presentation"
          data-iqai-mode="presentation"
          title="Presentation mode is reserved. Camera lock, chrome reduction, and replay are not implemented."
          aria-pressed="false"
        >PRESENTATION</button>
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
  const cell = root.querySelector(`[data-iqai-status="${statusId}"] .iqai-v2-status__value`);
  if (!cell) return;
  cell.textContent = value;
  if (state) cell.dataset.state = state;
}

export function startHeaderClock(root) {
  const value = root.querySelector('#iqai-v2-time-value');
  if (!value) return () => {};

  const tick = () => {
    value.textContent = formatShellClock();
  };
  tick();
  const timer = window.setInterval(tick, 1000);
  return () => window.clearInterval(timer);
}
