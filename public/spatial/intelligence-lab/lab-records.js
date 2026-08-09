/**
 * Records drawer + raw fields + intelligence card helpers.
 */

import { escapeHtml } from './lab-hover.js';
import { englishLabelForCategory } from '../spvm-crime-taxonomy.js';

export function formatRecordDate(ymd) {
  if (!ymd) return '—';
  const d = new Date(`${ymd}T12:00:00`);
  return d.toLocaleDateString('en-CA', { year: 'numeric', month: 'long', day: 'numeric' });
}

export function buildIntelligenceCardHtml(record) {
  if (!record?.properties) return '';
  const p = record.properties;
  const cat = englishLabelForCategory(p.category) || p.category;
  return `
    <div class="intel-card">
      <h3 class="intel-card__title">${escapeHtml(cat.toUpperCase())}</h3>
      <dl class="intel-card__dl">
        <dt>Reported date</dt><dd>${escapeHtml(formatRecordDate(p.date))}</dd>
        <dt>Shift</dt><dd>${escapeHtml(p.shiftLabel || p.shift)}</dd>
        <dt>PDQ</dt><dd>${escapeHtml(p.pdq || '—')}</dd>
        <dt>Source</dt><dd>${escapeHtml(p.sourceName || 'SPVM open data')}</dd>
        <dt>Location</dt><dd>SPVM published location — privacy-displaced</dd>
      </dl>
      <div class="intel-card__actions">
        <button type="button" data-action="view-record">View record</button>
        <button type="button" data-action="show-pdq">Show PDQ</button>
        <button type="button" data-action="raw-fields">View raw fields</button>
      </div>
    </div>`;
}

export function buildRawFieldsHtml(record) {
  const p = record?.properties || {};
  const raw = p.raw || {};
  const rows = (keys) => keys.map((k) => `<tr><th>${escapeHtml(k)}</th><td>${escapeHtml(raw[k] ?? p[k] ?? '—')}</td></tr>`).join('');
  return `
    <div class="raw-fields">
      <h4>Source record</h4>
      <table class="raw-fields__table">${rows(['CATEGORIE', 'DATE', 'QUART', 'PDQ', 'X', 'Y', 'LONGITUDE', 'LATITUDE'])}</table>
      <h4>IQAI derived / normalized</h4>
      <table class="raw-fields__table">${rows(['category', 'date', 'shift', 'pdq', 'spatialPrecision'])}</table>
    </div>`;
}

export function renderRecordsTable(features, selectedKey, sort) {
  const rows = [...features].sort((a, b) => {
    const av = a.properties[sort.key] ?? '';
    const bv = b.properties[sort.key] ?? '';
    if (sort.key === 'date') return sort.dir * String(av).localeCompare(String(bv));
    return sort.dir * String(av).localeCompare(String(bv));
  });

  const th = (key, label) => `<th data-sort="${key}">${label}${sort.key === key ? (sort.dir < 0 ? ' ↓' : ' ↑') : ''}</th>`;

  const body = rows.map((f) => {
    const p = f.properties;
    const sel = p.recordKey === selectedKey ? ' class="is-selected"' : '';
    const loc = p.raw?.LONGITUDE != null ? `${Number(p.raw.LONGITUDE).toFixed(4)}, ${Number(p.raw.LATITUDE).toFixed(4)}` : '—';
    return `<tr data-key="${escapeHtml(p.recordKey)}"${sel}>
      <td>${escapeHtml(p.date)}</td>
      <td>${escapeHtml(englishLabelForCategory(p.category))}</td>
      <td>${escapeHtml(p.shiftLabel || p.shift)}</td>
      <td>${escapeHtml(p.pdq)}</td>
      <td>${escapeHtml(loc)}</td>
    </tr>`;
  }).join('');

  return `<table class="records-table"><thead><tr>
    ${th('date', 'Date')}${th('category', 'Category')}${th('shift', 'Shift')}${th('pdq', 'PDQ')}
    <th>Published location</th>
  </tr></thead><tbody>${body}</tbody></table>`;
}
