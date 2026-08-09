/**
 * Vessel selected-feature display (presentation only).
 */
import { AISSTREAM_SOURCE_NAME, AISSTREAM_SOURCE_LICENSE } from './vessels-live-config.js';

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function isLiveVesselFeature(attributes) {
  return attributes?.iqaiType === 'live_vessel';
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
export function buildLiveVesselFeatureHtml(attributes = {}, options = {}) {
  const name = attributes.displayName || '—';
  const mmsi = attributes.mmsi || attributes.sourceObjectId || '—';
  const imo = attributes.imo || '—';
  const callsign = attributes.callsign || '—';
  const typeLabel = attributes.vesselClassLabel || attributes.vesselClass || 'Unknown';
  const navStatus = attributes.navigationStatusLabel || '—';
  const speed = attributes.speed != null ? `${attributes.speed} kn` : '—';
  const course = attributes.courseOverGround != null ? `${Math.round(attributes.courseOverGround)}°` : '—';
  const heading = attributes.headingDegrees != null ? `${Math.round(attributes.headingDegrees)}°` : '—';
  const destination = attributes.destination || '—';
  const eta = attributes.eta || '—';
  const draught = attributes.draught != null ? `${attributes.draught} m` : '—';

  const rows = [
    metaRow('Name', name, { emphasis: true }),
    metaRow('MMSI', mmsi),
    metaRow('IMO', imo),
    metaRow('Callsign', callsign),
    metaRow('Type', typeLabel, { emphasis: true }),
    metaRow('Navigation status', navStatus),
    metaRow('Speed', speed),
    metaRow('Course', course),
    metaRow('Heading', heading),
    metaRow('AIS-reported destination', destination),
    metaRow('AIS-reported ETA', eta),
    metaRow('Draught', draught),
    metaRow('Last AIS observation', formatObservedAt(attributes)),
    metaRow('Feed age', formatFeedAge(attributes)),
    metaRow('Source', attributes.sourceName || AISSTREAM_SOURCE_NAME),
    metaRow('License', attributes.sourceLicense || AISSTREAM_SOURCE_LICENSE),
    metaRow('Spatial precision', attributes.spatialPrecision || 'AIS reported position')
  ];

  return `
    <div class="detail-feature-card detail-feature-card-vessel">
      <div class="detail-feature-title detail-feature-title-vessel">LIVE VESSEL</div>
      <div class="detail-meta-grid">${rows.join('')}</div>
    </div>`;
}
