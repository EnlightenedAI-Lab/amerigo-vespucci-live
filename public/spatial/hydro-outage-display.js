/**
 * Hydro-Québec outage selected-feature display (presentation only).
 */
import { HYDRO_SOURCE_NAME } from './hydro-quebec-outages-config.js';

const CREW_STATUS_DISPLAY = {
  A: 'Work Assigned',
  R: 'Crew En Route',
  L: 'Crew At Work'
};

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function isHydroOutageFeature(attributes) {
  const type = attributes?.iqaiType;
  return type === 'hydro_quebec_outage' || type === 'hydro_quebec_outage_area';
}

export function parseHydroLocalTimestamp(value) {
  const text = String(value || '').trim();
  if (!text) return null;
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (match) {
    const [, y, mo, d, h, mi, s] = match;
    return new Date(
      Number(y),
      Number(mo) - 1,
      Number(d),
      Number(h),
      Number(mi),
      Number(s || 0)
    );
  }
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function formatHydroLocalDateTime(value) {
  const date = parseHydroLocalTimestamp(value);
  if (!date) return null;
  return date.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  });
}

export function formatDurationMinutes(totalMinutes) {
  if (!Number.isFinite(totalMinutes) || totalMinutes < 0) return null;
  const minutes = Math.round(totalMinutes);
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (hours > 0 && mins > 0) return `${hours} h ${mins} min`;
  if (hours > 0) return `${hours} h`;
  return `${mins} min`;
}

export function formatCrewStatusDisplay(attributes = {}) {
  const code = String(attributes.crewStatusCode || '').trim().toUpperCase();
  if (CREW_STATUS_DISPLAY[code]) return CREW_STATUS_DISPLAY[code];
  const label = String(attributes.crewStatusLabel || '').trim();
  if (label && label.toLowerCase() !== 'unknown') return label;
  return 'Unknown';
}

export function formatEstimatedRestorationDisplay(attributes = {}) {
  const formatted = formatHydroLocalDateTime(attributes.estimatedRestoration);
  return formatted || 'Unknown';
}

export function deriveHydroOutageTiming(attributes = {}) {
  const now = Date.now();
  const start = parseHydroLocalTimestamp(attributes.outageStart);
  const restoration = parseHydroLocalTimestamp(attributes.estimatedRestoration);
  const derived = {};

  if (start) {
    const activeMinutes = (now - start.getTime()) / 60000;
    if (activeMinutes >= 0) {
      derived.outageActive = formatDurationMinutes(activeMinutes);
    }
  }

  if (restoration) {
    const deltaMinutes = (restoration.getTime() - now) / 60000;
    if (deltaMinutes > 0) {
      derived.restorationIn = formatDurationMinutes(deltaMinutes);
    } else if (deltaMinutes < 0) {
      derived.restorationOverdue = formatDurationMinutes(Math.abs(deltaMinutes));
    }
  }

  return derived;
}

function hasLinkedOutageOperationalData(attributes = {}) {
  return Boolean(
    attributes.outageId
    && (
      attributes.customersAffected != null
      || attributes.outageStart
      || attributes.estimatedRestoration
      || attributes.crewStatusCode
      || attributes.causeCategory
    )
  );
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

function formatFeedTimestamp(attributes = {}) {
  if (attributes.feedTimestamp) {
    const iso = String(attributes.feedTimestamp);
    const parsed = new Date(iso);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toLocaleString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit'
      });
    }
  }
  return attributes.feedTimestamp || '—';
}

/**
 * @param {object} attributes
 * @param {{ layerTitle?: string }} [options]
 */
export function buildHydroOutageFeatureHtml(attributes = {}, options = {}) {
  const isArea = attributes.iqaiType === 'hydro_quebec_outage_area';
  const linked = isArea && hasLinkedOutageOperationalData(attributes);
  const heading = isArea && !linked
    ? 'HYDRO-QUÉBEC OUTAGE AREA'
    : 'HYDRO-QUÉBEC OUTAGE';

  const rows = [];
  const timing = deriveHydroOutageTiming(attributes);

  if (!isArea || linked) {
    const customers = attributes.customersAffected;
    rows.push(metaRow(
      'Customers affected',
      customers != null && customers !== '' ? String(customers) : '—',
      { emphasis: true }
    ));

    const started = formatHydroLocalDateTime(attributes.outageStart);
    rows.push(metaRow('Started', started || '—'));

    rows.push(metaRow('Estimated restoration', formatEstimatedRestorationDisplay(attributes)));

    rows.push(metaRow('Crew status', formatCrewStatusDisplay(attributes), { emphasis: true }));

    const cause = String(attributes.causeCategory || '').trim();
    rows.push(metaRow('Cause', cause && cause !== 'Unknown' ? cause : 'Unknown'));

    if (timing.outageActive) {
      rows.push(metaRow('Outage active', timing.outageActive));
    }
    if (timing.restorationIn) {
      rows.push(metaRow('Estimated restoration in', timing.restorationIn));
    }
    if (timing.restorationOverdue) {
      rows.push(metaRow('Estimated restoration overdue by', timing.restorationOverdue));
    }
  }

  rows.push(metaRow('Affected area', 'Approximate'));

  rows.push(metaRow('Source', attributes.sourceName || HYDRO_SOURCE_NAME));
  rows.push(metaRow('Last feed update', formatFeedTimestamp(attributes)));

  if (isArea) {
    rows.push(metaRow('Spatial precision', attributes.spatialPrecision || 'Approximate outage area'));
  }

  const secondary = [];
  if (attributes.municipalityId) {
    secondary.push(metaRow('Municipality ID', attributes.municipalityId));
  }
  if (attributes.outageId && isArea) {
    secondary.push(metaRow('Outage ID', attributes.outageId));
  }
  if (attributes.messageId) {
    secondary.push(metaRow('Message ID', attributes.messageId));
  }
  if (attributes.sourceVersion) {
    secondary.push(metaRow('Feed version', attributes.sourceVersion));
  }
  if (attributes.causeCode && attributes.causeCategory !== 'Unknown') {
    secondary.push(metaRow('Cause code', attributes.causeCode));
  }

  const subtitle = options.layerTitle || (isArea ? 'Current Outage Areas' : 'Current Outage Points');

  return `
    <div class="detail-feature-card detail-feature-card-hydro">
      <div class="detail-feature-title detail-feature-title-hydro">${escapeHtml(heading)}</div>
      <div class="detail-feature-subtitle">${escapeHtml(subtitle)}</div>
      <div class="detail-feature-meta">${rows.join('')}</div>
      ${secondary.length ? `<div class="detail-feature-meta detail-feature-meta-secondary">${secondary.join('')}</div>` : ''}
    </div>`;
}
