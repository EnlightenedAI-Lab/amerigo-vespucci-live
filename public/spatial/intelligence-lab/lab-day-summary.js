/**
 * Compact day-summary for selected reported-activity date.
 */

import { englishLabelForCategory } from '../spvm-crime-taxonomy.js';
import { aggregateByCategory } from './lab-spvm-filters.js';
import { formatPdqId } from './lab-labels.js';
import { relatedIntelligencePlaceholder, buildRelatedIntelligenceRequest } from './lab-related-intelligence.js';

export function formatReportDateLong(ymd) {
  if (!ymd) return '—';
  const d = new Date(`${ymd}T12:00:00`);
  return d.toLocaleDateString('en-CA', { year: 'numeric', month: 'long', day: 'numeric' });
}

export function aggregateByShift(features) {
  const counts = { jour: 0, soir: 0, nuit: 0 };
  for (const f of features) {
    const sh = f.properties.shift || 'jour';
    counts[sh] = (counts[sh] || 0) + 1;
  }
  return counts;
}

export function aggregateByPdq(features) {
  const counts = {};
  for (const f of features) {
    const p = f.properties.pdq || '—';
    counts[p] = (counts[p] || 0) + 1;
  }
  return Object.entries(counts).sort((a, b) => b[1] - a[1]);
}

export function aggregateByArrondissement(features, arrondissements, pointInArrond) {
  if (!pointInArrond || !arrondissements?.length) return [];
  const counts = {};
  for (const f of features) {
    const [lng, lat] = f.geometry.coordinates;
    for (const a of arrondissements) {
      if (pointInArrond(a.id, lng, lat)) {
        counts[a.id] = (counts[a.id] || 0) + 1;
        break;
      }
    }
  }
  return Object.entries(counts)
    .map(([id, n]) => {
      const a = arrondissements.find((x) => x.id === id);
      return { id, name: a?.name || id, count: n };
    })
    .sort((a, b) => b.count - a.count);
}

const SHIFT_LABELS = { jour: 'Day', soir: 'Evening', nuit: 'Night' };

/**
 * @param {import('geojson').Feature[]} features — filtered for selected report date
 */
export function buildDaySummaryHtml(features, reportDate, options = {}) {
  const total = features.length;
  const catCounts = aggregateByCategory(features);
  const shiftCounts = aggregateByShift(features);
  const pdqTop = aggregateByPdq(features).slice(0, 5);
  const arrondTop = aggregateByArrondissement(
    features,
    options.arrondissements,
    options.pointInArrond
  ).slice(0, 5);

  const catRows = Object.entries(catCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([c, n]) => `<li>${englishLabelForCategory(c)}: <strong>${n}</strong></li>`)
    .join('') || '<li>No reports in current filters</li>';

  const shiftRows = Object.entries(shiftCounts)
    .filter(([, n]) => n > 0)
    .map(([s, n]) => `<li>${SHIFT_LABELS[s] || s}: <strong>${n}</strong></li>`)
    .join('');

  const pdqRows = pdqTop.map(([p, n]) => `<li>PDQ ${p}: <strong>${n}</strong></li>`).join('')
    || '<li>—</li>';

  const arrondRows = arrondTop.map((a) => `<li>${a.name}: <strong>${a.count}</strong></li>`).join('')
    || '<li>—</li>';

  const riReq = buildRelatedIntelligenceRequest({
    reportDate,
    category: options.category,
    shift: options.shift,
    areaType: options.areaType,
    areaId: options.areaId,
    areaName: options.areaName
  });

  return `
    <div class="day-summary">
      <header class="day-summary__header">
        <span class="day-summary__eyebrow">Reported activity</span>
        <h3 class="day-summary__date">${formatReportDateLong(reportDate)}</h3>
        <p class="day-summary__total">${total} published report${total === 1 ? '' : 's'}</p>
        <p class="day-summary__caveat">SPVM report date + shift — not exact offence occurrence time.</p>
      </header>
      <div class="day-summary__grid">
        <section>
          <h4>By category</h4>
          <ul class="day-summary__list">${catRows}</ul>
        </section>
        <section>
          <h4>By report shift</h4>
          <ul class="day-summary__list">${shiftRows || '<li>—</li>'}</ul>
        </section>
        <section>
          <h4>Top PDQs</h4>
          <ul class="day-summary__list">${pdqRows}</ul>
        </section>
        <section>
          <h4>Top arrondissements</h4>
          <ul class="day-summary__list">${arrondRows}</ul>
        </section>
      </div>
      <details class="day-summary__ri">
        <summary>Related intelligence (future)</summary>
        <p>${relatedIntelligencePlaceholder(riReq)}</p>
      </details>
    </div>`;
}
