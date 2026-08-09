/**
 * Aircraft selected-feature display (presentation only).
 */
import { ADSB_SOURCE_NAME, ADSB_SOURCE_LICENSE } from './aircraft-live-config.js';

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function isLiveAircraftFeature(attributes) {
  return attributes?.iqaiType === 'live_aircraft';
}

function metaRow(label, value, options = {}) {
  const valueClass = options.emphasis
    ? 'detail-meta-value detail-item-value-emphasis'
    : 'detail-meta-value';
  return `
    <div class="detail-meta-item">
      <div class="detail-meta-label">${escapeHtml(label)}</div>
      <div class="${valueClass}">${escapeHtml(value ?? '—')}</div>
    </div>`;
}

function formatObservedAt(attributes) {
  if (attributes.observedAt) {
    try {
      return new Date(attributes.observedAt).toLocaleString();
    } catch {
      return attributes.observedAt;
    }
  }
  return '—';
}

function formatFeedAge(attributes) {
  const age = attributes.ageSeconds;
  if (age == null || age === '') return '—';
  const seconds = Number(age);
  if (!Number.isFinite(seconds)) return '—';
  if (seconds < 60) return `${Math.round(seconds)} sec`;
  const mins = Math.floor(seconds / 60);
  const secs = Math.round(seconds % 60);
  return secs ? `${mins} min ${secs} sec` : `${mins} min`;
}

/**
 * @param {object} attributes
 * @param {{ layerTitle?: string }} [options]
 */
export function buildLiveAircraftFeatureHtml(attributes = {}, options = {}) {
  const callsign = attributes.callsign || '—';
  const registration = attributes.registration || '—';
  const typeCode = attributes.typeCode || '—';
  const classLabel = attributes.aircraftClassLabel || attributes.aircraftClass || 'Unknown';
  const altitude = attributes.altitude != null ? `${attributes.altitude} ft` : '—';
  const speed = attributes.speed != null ? `${attributes.speed} kt` : '—';
  const heading = attributes.headingDegrees != null ? `${Math.round(attributes.headingDegrees)}°` : '—';
  const verticalRate = attributes.verticalRate != null ? `${attributes.verticalRate} ft/min` : '—';
  const squawk = attributes.squawk || '—';

  const rows = [
    metaRow('Callsign', callsign, { emphasis: true }),
    metaRow('Registration', registration),
    metaRow('Type', typeCode),
    metaRow('Class', classLabel, { emphasis: true }),
    metaRow('Altitude', altitude),
    metaRow('Ground speed', speed),
    metaRow('Heading', heading),
    metaRow('Vertical rate', verticalRate),
    metaRow('Squawk', squawk),
    metaRow('Last observed', formatObservedAt(attributes)),
    metaRow('Feed age', formatFeedAge(attributes)),
    metaRow('Source', attributes.sourceName || ADSB_SOURCE_NAME),
    metaRow('License', attributes.sourceLicense || ADSB_SOURCE_LICENSE),
    metaRow('Spatial precision', attributes.spatialPrecision || 'Live reported aircraft position')
  ];

  const subtitle = options.layerTitle || 'Aircraft — Live';

  return `
    <div class="detail-feature-card detail-feature-card-aircraft">
      <div class="detail-feature-title detail-feature-title-aircraft">AIRCRAFT</div>
      <div class="detail-feature-subtitle">${escapeHtml(subtitle)}</div>
      <div class="detail-feature-meta">${rows.join('')}</div>
    </div>`;
}
