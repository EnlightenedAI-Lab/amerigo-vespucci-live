/**
 * Reported Activity Calendar — month view of SPVM published report dates.
 */

import { formatReportDateLong } from './lab-day-summary.js';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function parseMonth(ym) {
  const [y, m] = String(ym).split('-').map(Number);
  return { year: y, month: m };
}

function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function monthStartWeekday(year, month) {
  return new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
}

function padMonth(year, month) {
  return `${year}-${String(month).padStart(2, '0')}`;
}

function intensityClass(count, max) {
  if (!count) return 'cal-day--zero';
  if (!max) return 'cal-day--low';
  const r = count / max;
  if (r >= 0.75) return 'cal-day--high';
  if (r >= 0.4) return 'cal-day--med';
  return 'cal-day--low';
}

export class ReportedActivityCalendar {
  /**
   * @param {HTMLElement} container
   * @param {{ onMonthChange: (ym: string) => void, onDaySelect: (ymd: string|null) => void }} callbacks
   */
  constructor(container, callbacks = {}) {
    this.container = container;
    this.onMonthChange = callbacks.onMonthChange;
    this.onDaySelect = callbacks.onDaySelect;
    this.month = padMonth(new Date().getFullYear(), new Date().getMonth() + 1);
    this.dailyCounts = {};
    this.selectedDate = null;
    this.dataEndDate = null;
    this._bind();
  }

  _bind() {
    this.container.addEventListener('click', (e) => {
      const nav = e.target.closest('[data-cal-nav]');
      if (nav) {
        const { year, month } = parseMonth(this.month);
        let y = year;
        let m = month + Number(nav.dataset.calNav);
        if (m < 1) { m = 12; y -= 1; }
        if (m > 12) { m = 1; y += 1; }
        this.month = padMonth(y, m);
        this.onMonthChange?.(this.month);
        return;
      }
      const jump = e.target.closest('[data-cal-jump]');
      if (jump) {
        const y = Number(this.container.querySelector('[data-cal-year]')?.value);
        const m = Number(this.container.querySelector('[data-cal-month]')?.value);
        if (y && m) {
          this.month = padMonth(y, m);
          this.onMonthChange?.(this.month);
        }
        return;
      }
      const dayBtn = e.target.closest('[data-cal-day]');
      if (dayBtn) {
        const ymd = dayBtn.dataset.calDay;
        const next = this.selectedDate === ymd ? null : ymd;
        this.onDaySelect?.(next);
      }
    });
  }

  /**
   * @param {string} month YYYY-MM
   * @param {Record<string, number>} dailyCounts
   * @param {string|null} selectedDate YYYY-MM-DD
   * @param {string|null} dataEndDate latest report date in dataset
   */
  render(month, dailyCounts, selectedDate, dataEndDate) {
    this.month = month || this.month;
    this.dailyCounts = dailyCounts || {};
    this.selectedDate = selectedDate;
    this.dataEndDate = dataEndDate;

    const { year, month: mo } = parseMonth(this.month);
    const dim = daysInMonth(year, mo);
    const startWd = monthStartWeekday(year, mo);
    const maxCount = Math.max(0, ...Object.values(this.dailyCounts));
    const monthLabel = new Date(Date.UTC(year, mo - 1, 1)).toLocaleDateString('en-CA', {
      month: 'long',
      year: 'numeric',
      timeZone: 'UTC'
    });

    const years = [];
    const baseY = dataEndDate ? Number(dataEndDate.slice(0, 4)) : year;
    for (let y = baseY - 1; y <= baseY + 1; y += 1) years.push(y);

    let cells = '';
    for (let i = 0; i < startWd; i += 1) {
      cells += '<div class="cal-day cal-day--pad"></div>';
    }
    for (let d = 1; d <= dim; d += 1) {
      const ymd = `${year}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const count = this.dailyCounts[ymd] || 0;
      const isSelected = selectedDate === ymd;
      const isAfterData = dataEndDate && ymd > dataEndDate;
      const cls = [
        'cal-day',
        'cal-day--btn',
        intensityClass(count, maxCount),
        isSelected ? 'is-selected' : '',
        isAfterData ? 'is-after-data' : ''
      ].filter(Boolean).join(' ');
      cells += `<button type="button" class="${cls}" data-cal-day="${ymd}" title="${formatReportDateLong(ymd)}: ${count} published report${count === 1 ? '' : 's'}">
        <span class="cal-day__num">${d}</span>
        ${count ? `<span class="cal-day__count">${count}</span>` : ''}
      </button>`;
    }

    this.container.innerHTML = `
      <div class="cal-toolbar">
        <button type="button" class="cal-nav" data-cal-nav="-1" aria-label="Previous month">‹</button>
        <span class="cal-title">${monthLabel}</span>
        <button type="button" class="cal-nav" data-cal-nav="1" aria-label="Next month">›</button>
      </div>
      <div class="cal-jump">
        <select data-cal-month aria-label="Month">${Array.from({ length: 12 }, (_, i) => {
          const v = i + 1;
          return `<option value="${v}"${v === mo ? ' selected' : ''}>${new Date(Date.UTC(2000, i, 1)).toLocaleDateString('en-CA', { month: 'short', timeZone: 'UTC' })}</option>`;
        }).join('')}</select>
        <select data-cal-year aria-label="Year">${years.map((y) => `<option value="${y}"${y === year ? ' selected' : ''}>${y}</option>`).join('')}</select>
        <button type="button" class="btn-link" data-cal-jump>Go</button>
      </div>
      ${dataEndDate ? `<p class="cal-data-end">Data through ${formatReportDateLong(dataEndDate)}</p>` : ''}
      <div class="cal-weekdays">${WEEKDAYS.map((w) => `<span>${w}</span>`).join('')}</div>
      <div class="cal-grid">${cells}</div>
      <p class="cal-footnote">Counts = published reports (DATE field) matching current category, shift, and area filters.</p>
    `;
  }
}
