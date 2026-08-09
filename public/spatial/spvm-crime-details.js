/**
 * SPVM crime feature detail card — no exact address or incident time.
 */

import {
  englishLabelForCategory,
  shiftUiLabelForValue
} from './spvm-crime-taxonomy.js';

function stacked(label, value) {
  return `<div class="detail-stack-item"><span class="detail-stack-label">${label}</span><span class="detail-stack-value">${value}</span></div>`;
}

/**
 * @param {object} attributes
 */
export function isSpvmCrimeFeature(attributes) {
  if (!attributes) return false;
  return Boolean(
    attributes.category
    && attributes.date
    && (attributes.shift || attributes.shiftLabel)
    && (attributes.spatialPrecision || attributes.sourceName)
  );
}

/**
 * @param {object} attributes
 */
export function buildSpvmCrimeFeatureHtml(attributes) {
  const french = String(attributes.category || '—');
  const english = englishLabelForCategory(french);
  const shift = shiftUiLabelForValue(attributes.shift) || attributes.shiftLabel || '—';

  return `
    <div class="detail-feature-card detail-spvm-crime">
      <div class="detail-feature-heading">SPVM REPORTED CRIME</div>
      ${stacked('Category', english)}
      ${stacked('Official category', french)}
      ${stacked('Reported date', attributes.date || '—')}
      ${stacked('Shift', shift)}
      ${stacked('PDQ', attributes.pdq || '—')}
      <div class="detail-section-heading">LOCATION PRECISION</div>
      ${stacked('Spatial precision', attributes.spatialPrecision || 'Privacy-obfuscated intersection')}
      <div class="detail-section-heading">TEMPORAL PRECISION</div>
      ${stacked('Temporal precision', attributes.temporalPrecision || 'Date + reporting shift')}
      <div class="detail-section-heading">SOURCE</div>
      ${stacked('Authority', attributes.sourceName || 'Service de police de la Ville de Montréal')}
      ${stacked('Dataset', attributes.dataset || 'Actes criminels')}
      ${stacked('License', 'CC BY 4.0')}
    </div>
  `;
}

/**
 * Selected crime detail for SPVM intelligence workspace (with phase-2 placeholders).
 * @param {object} attributes
 */
export function buildSpvmCrimeSelectionHtml(attributes) {
  const french = String(attributes.category || '—');
  const english = englishLabelForCategory(french);
  const shift = shiftUiLabelForValue(attributes.shift) || attributes.shiftLabel || '—';

  return `
    <div class="detail-feature-card detail-spvm-crime">
      <div class="detail-feature-heading">SELECTED CRIME</div>
      ${stacked('Category', english)}
      ${stacked('Reported date', attributes.date || '—')}
      ${stacked('Shift', shift)}
      ${stacked('PDQ', attributes.pdq || '—')}
      ${stacked('Spatial precision', attributes.spatialPrecision || 'Privacy-obfuscated intersection')}
      ${stacked('Temporal precision', attributes.temporalPrecision || 'Date + reporting shift')}
      ${stacked('Source', attributes.sourceName || 'Service de police de la Ville de Montréal')}
    </div>
    <div class="detail-section-heading">LOCAL CONTEXT</div>
    <p class="detail-muted">Local intelligence available in next analysis phase.</p>
    <div class="detail-section-heading">RELATED SIGNALS</div>
    <p class="detail-muted">No connected intelligence observations.</p>
  `;
}
