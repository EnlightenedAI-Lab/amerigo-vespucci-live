/**
 * Deterministic selected-location synthesis from accepted Point Intelligence evidence.
 * No LLM prose — explicit ranking and field rules only.
 */
import {
  DEFAULT_RADIUS_METERS,
  getPointIntelligenceFamilyMetadata,
  POINT_INTELLIGENCE_FAMILY_ORDER
} from './point-intelligence-config.js';
import {
  deriveCoverageState,
  temporalClassificationBucket
} from './point-intelligence-lif-model.js';
import { formatTemporalClassificationLabel } from './point-intelligence-status.js';
import {
  extractPrimaryMeasurementLine,
  extractStationTitle,
  formatClickDistance,
  formatClimateObservationDate,
  formatMeasurement,
  formatObservationTimestamp,
  groupResultsByAuthoritativeStation,
  resolveResultProperties
} from './point-intelligence-presentation.js';

/**
 * Synthesis precedence (documented for Control Tower):
 * A. Near-real-time measurements (weather, current weather, AQHI, hydrometric measurement)
 * B. Recent climate-hourly observations
 * C. Historical climate daily context (station-grouped)
 * D. Nearest hydrometric station registry metadata (never as live observation)
 * E. Explicit NO_RESULTS / provider-issue coverage gaps
 *
 * Within a tier: nearer distance first, then newer observation time.
 */
const TEMPORAL_RANK = Object.freeze({
  NEAR_REAL_TIME: 0,
  RECENT: 1,
  HISTORICAL: 2,
  STATIC: 3
});

const CURRENT_FAMILIES = Object.freeze([
  'weather',
  'weather-current',
  'air-quality',
  'hydrometric-measurement'
]);

const CONTEXT_FAMILIES = Object.freeze([
  'climate-hourly',
  'climate'
]);

function observationTimestamp(result) {
  const props = resolveResultProperties(result);
  return result?.observation?.observedAt
    || props.LOCAL_DATETIME
    || props.OBSERVATION_DATETIME
    || props.LOCAL_DATE
    || props.DATETIME
    || props.DATETIME_LST
    || props.lastUpdated
    || props['date_tm-value']
    || result?.temporal?.LOCAL_DATE
    || result?.temporal?.['date_tm-value']
    || result?.temporal?.lastUpdated
    || null;
}

function temporalRank(result) {
  const key = String(result?.temporalClassification || '').toUpperCase();
  return TEMPORAL_RANK[key] ?? 9;
}

function compareEvidenceUsefulness(a, b) {
  const tr = temporalRank(a) - temporalRank(b);
  if (tr !== 0) return tr;
  const distA = Number.isFinite(a?.clickDistanceMeters) ? a.clickDistanceMeters : Infinity;
  const distB = Number.isFinite(b?.clickDistanceMeters) ? b.clickDistanceMeters : Infinity;
  if (distA !== distB) return distA - distB;
  const timeA = new Date(observationTimestamp(a) || 0).getTime();
  const timeB = new Date(observationTimestamp(b) || 0).getTime();
  return timeB - timeA;
}

function pickBestResult(results) {
  if (!results?.length) return null;
  return [...results].sort(compareEvidenceUsefulness)[0];
}

function formatObservationMeasurement(observation) {
  if (!observation || observation.value == null) return null;
  const label = ({
    air_temp: 'Temperature',
    avg_air_temp_pst1hr: 'Temperature (1 hr avg)',
    rel_hum: 'Humidity',
    stn_pres: 'Pressure',
    temperature: 'Temperature',
    TEMP: 'Temperature',
    aqhi: 'AQHI',
    LEVEL: 'Water level',
    DISCHARGE: 'Discharge'
  })[observation.property] || observation.property?.replace(/_/g, ' ') || 'Measurement';
  const unit = observation.unit === 'C' ? '°C'
    : observation.unit === 'AQHI' ? 'AQHI'
      : observation.unit ? observation.unit : '';
  const value = formatMeasurement(observation.value, unit);
  return value ? `${label}: ${value}` : null;
}

/**
 * Collect normalized measurement lines for one result (no fabrication).
 * @param {Record<string, unknown>} result
 * @param {string} family
 * @returns {string[]}
 */
export function collectSynthesisMeasurements(result, family) {
  const lines = [];
  const seen = new Set();
  const add = (text) => {
    if (!text || seen.has(text)) return;
    seen.add(text);
    lines.push(text);
  };

  const props = resolveResultProperties(result);
  const obsLine = formatObservationMeasurement(result?.observation);
  if (obsLine) add(obsLine);

  const primary = extractPrimaryMeasurementLine(result, family);
  if (primary && !lines.some((line) => line.includes(primary))) {
    if (family === 'weather' || family === 'weather-current') add(primary);
    else if (!obsLine) add(primary);
  }

  if (family === 'weather') {
    const windSpeed = props['wind_spd_scal-value'];
    const windDir = props['wind_dir_10_min-value'] ?? props['wind_dir-value'];
    const windUnit = props['wind_spd_scal-value-uom'] || 'km/h';
    if (Number.isFinite(Number(windSpeed))) {
      const wind = formatMeasurement(windSpeed, windUnit);
      add(windDir != null ? `Wind: ${wind} ${windDir}°` : `Wind: ${wind}`);
    }
    const humidity = props['rel_hum-value'] ?? props.RELATIVE_HUMIDITY;
    if (Number.isFinite(Number(humidity))) add(`Humidity: ${formatMeasurement(humidity, '%')}`);
    const pressure = props['stn_pres-value'] ?? props.PRESSURE;
    if (Number.isFinite(Number(pressure))) add(`Pressure: ${formatMeasurement(pressure, 'hPa')}`);
  }

  if (family === 'climate') {
    const mean = formatMeasurement(props.MEAN_TEMPERATURE ?? props.MEAN_TEMP, '°C');
    const min = formatMeasurement(props.MIN_TEMPERATURE ?? props.MIN_TEMP, '°C');
    const max = formatMeasurement(props.MAX_TEMPERATURE ?? props.MAX_TEMP, '°C');
    const precip = formatMeasurement(props.TOTAL_PRECIPITATION ?? props.TOTAL_PRECIP, 'mm');
    if (mean) add(`Mean: ${mean}`);
    if (min && max) add(`Min: ${min} · Max: ${max}`);
    else if (min) add(`Min: ${min}`);
    else if (max) add(`Max: ${max}`);
    if (precip) add(`Precipitation: ${precip}`);
  }

  if (family === 'air-quality' && Number.isFinite(Number(props.AQHI)) && !obsLine) {
    add(`AQHI: ${Number(props.AQHI)}`);
  }

  if (family === 'hydrometric-measurement') {
    const waterbody = props.WATERBODY_EN || props.WATERBODY_FR;
    if (waterbody) add(`Waterbody: ${waterbody}`);
  }

  return lines;
}

function familyLabel(family) {
  return getPointIntelligenceFamilyMetadata(family)?.label || family;
}

function buildObservationBlock(result, family) {
  const station = extractStationTitle(result, family);
  const observedRaw = observationTimestamp(result);
  const observedAt = family === 'climate'
    ? formatClimateObservationDate(observedRaw)
    : formatObservationTimestamp(observedRaw);
  const distance = formatClickDistance(result?.clickDistanceMeters);
  return {
    kind: 'observation',
    family,
    familyLabel: familyLabel(family),
    station,
    measurements: collectSynthesisMeasurements(result, family),
    observedAt: observedAt ? `Observed ${observedAt}` : null,
    distance: distance ? `${distance} away` : null,
    temporalLabel: formatTemporalClassificationLabel(result?.temporalClassification)
      || temporalClassificationBucket(result?.temporalClassification)
      || null
  };
}

function buildContextBlock(group, family) {
  const latest = group.latest;
  const observedRaw = observationTimestamp(latest);
  const latestLabel = family === 'climate'
    ? formatClimateObservationDate(observedRaw)
    : formatObservationTimestamp(observedRaw);
  const distance = formatClickDistance(latest?.clickDistanceMeters);
  const count = group.results.length;
  const station = group.title;
  const headline = family === 'climate'
    ? `Climate evidence available from ${station}`
    : `Recent climate observations from ${station}`;

  return {
    kind: 'context',
    family,
    familyLabel: familyLabel(family),
    station,
    headline,
    latestObservation: latestLabel ? `Latest observation ${latestLabel}` : null,
    observationCount: count > 1 ? `${count} observations available` : null,
    measurements: collectSynthesisMeasurements(latest, family),
    distance: distance ? `${distance} away` : null,
    temporalLabel: formatTemporalClassificationLabel(latest?.temporalClassification)
      || (family === 'climate' ? 'Historical record' : 'Recent observation')
  };
}

function buildWaterRegistryBlock(result) {
  const props = resolveResultProperties(result);
  const station = extractStationTitle(result, 'hydrometric');
  const stationId = props.STATION_NUMBER || props.IDENTIFIER || null;
  const distance = formatClickDistance(result?.clickDistanceMeters);
  return {
    kind: 'water-registry',
    family: 'hydrometric',
    familyLabel: familyLabel('hydrometric'),
    headline: 'Nearest hydrometric station',
    station,
    stationId: stationId ? String(stationId) : null,
    distance: distance ? `${distance} away` : null,
    temporalLabel: 'Station registry metadata'
  };
}

function buildCoverageGapBlock(row, radiusMeters) {
  const radiusLabel = formatClickDistance(radiusMeters) || `${radiusMeters} m`;
  const checked = row.coverageState === 'NO_LOCAL_EVIDENCE'
    && String(row.queryState || '').toUpperCase() === 'NO_RESULTS';
  return {
    kind: 'coverage-gap',
    family: row.informationFamily,
    familyLabel: row.label || familyLabel(row.informationFamily),
    message: `No local evidence within ${radiusLabel}`,
    footnote: checked ? 'Source checked successfully' : null
  };
}

function buildProviderIssueBlock(row) {
  return {
    kind: 'provider-issue',
    family: row.informationFamily,
    familyLabel: row.label || familyLabel(row.informationFamily),
    message: 'Source temporarily unavailable',
    footnote: row.queryState ? String(row.queryState).replace(/_/g, ' ').toLowerCase() : null
  };
}

function listFamilyRows(response, radiusMeters) {
  const families = response?.families || {};
  return POINT_INTELLIGENCE_FAMILY_ORDER
    .filter((key) => families[key])
    .map((key) => {
      const entry = families[key];
      const meta = getPointIntelligenceFamilyMetadata(key);
      return {
        informationFamily: key,
        label: meta.label,
        queryState: entry.queryState,
        hasEvidence: Boolean(entry.hasEvidence),
        results: Array.isArray(entry.results) ? entry.results : [],
        coverageState: deriveCoverageState(entry.queryState, entry.hasEvidence),
        temporalClassification: entry.temporalClassification
          || entry.results?.[0]?.temporalClassification
          || null
      };
    });
}

function isCurrentFamilyResult(result, family) {
  const temporal = String(result?.temporalClassification || '').toUpperCase();
  if (temporal === 'HISTORICAL' || temporal === 'STATIC') return false;
  if (family === 'hydrometric-measurement') return temporal === 'NEAR_REAL_TIME';
  return CURRENT_FAMILIES.includes(family);
}

/**
 * @param {object} response Adapted multi-family bundle response
 * @param {object} [point]
 * @param {{ radiusMeters?: number }} [options]
 */
export function buildLocationSynthesisModel(response, point = {}, options = {}) {
  const radiusMeters = options.radiusMeters
    ?? response?.spatialSummary?.radiusMeters
    ?? response?.request?.radiusMeters
    ?? DEFAULT_RADIUS_METERS;
  const rows = listFamilyRows(response, radiusMeters);
  /** @type {Array<{ id: string, title: string, blocks: object[] }>} */
  const sections = [];

  const currentBlocks = [];
  for (const family of CURRENT_FAMILIES) {
    const row = rows.find((entry) => entry.informationFamily === family);
    if (!row?.hasEvidence) continue;
    const eligible = row.results.filter((result) => isCurrentFamilyResult(result, family));
    const best = pickBestResult(eligible);
    if (!best) continue;
    currentBlocks.push(buildObservationBlock(best, family));
  }
  if (currentBlocks.length) {
    sections.push({ id: 'current', title: 'Current conditions', blocks: currentBlocks });
  }

  const contextBlocks = [];
  for (const family of CONTEXT_FAMILIES) {
    const row = rows.find((entry) => entry.informationFamily === family);
    if (!row?.hasEvidence) continue;
    const groups = groupResultsByAuthoritativeStation(row.results, family);
    if (!groups.length) continue;
    contextBlocks.push(buildContextBlock(groups[0], family));
  }
  if (contextBlocks.length) {
    sections.push({ id: 'context', title: 'Recent / historical context', blocks: contextBlocks });
  }

  const hydroRow = rows.find((entry) => entry.informationFamily === 'hydrometric');
  if (hydroRow?.hasEvidence) {
    const best = pickBestResult(hydroRow.results);
    if (best) {
      sections.push({
        id: 'water',
        title: 'Water',
        blocks: [buildWaterRegistryBlock(best)]
      });
    }
  }

  const coverageBlocks = [
    ...rows
      .filter((row) => row.coverageState === 'NO_LOCAL_EVIDENCE')
      .map((row) => buildCoverageGapBlock(row, radiusMeters)),
    ...rows
      .filter((row) => row.coverageState === 'PROVIDER_ISSUE')
      .map((row) => buildProviderIssueBlock(row))
  ];
  if (coverageBlocks.length) {
    sections.push({ id: 'coverage', title: 'Coverage', blocks: coverageBlocks });
  }

  return {
    sections,
    radiusMeters,
    coordsLabel: formatCoordsLabel(point, response)
  };
}

function formatCoordsLabel(point, response) {
  const lat = point?.latitude ?? point?.lat ?? response?.summary?.clickedCoordinates?.[1];
  const lon = point?.longitude ?? point?.lon ?? response?.summary?.clickedCoordinates?.[0];
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
}

/**
 * Single-family compatibility synthesis (targeted drill-down path).
 * @param {object} response
 * @param {string} family
 * @param {Array<object>} results
 * @param {object} [point]
 */
export function buildSingleFamilySynthesisModel(response, family, results = [], point = {}) {
  const radiusMeters = response?.request?.radiusMeters ?? DEFAULT_RADIUS_METERS;
  /** @type {Array<{ id: string, title: string, blocks: object[] }>} */
  const sections = [];

  if (!results.length) {
    return { sections, radiusMeters, coordsLabel: formatCoordsLabel(point, response) };
  }

  if (CURRENT_FAMILIES.includes(family)) {
    const eligible = results.filter((result) => isCurrentFamilyResult(result, family));
    const best = pickBestResult(eligible);
    if (best) {
      sections.push({
        id: 'current',
        title: 'Current conditions',
        blocks: [buildObservationBlock(best, family)]
      });
    }
  } else if (CONTEXT_FAMILIES.includes(family)) {
    const groups = groupResultsByAuthoritativeStation(results, family);
    if (groups[0]) {
      sections.push({
        id: 'context',
        title: 'Recent / historical context',
        blocks: [buildContextBlock(groups[0], family)]
      });
    }
  } else if (family === 'hydrometric') {
    const best = pickBestResult(results);
    if (best) {
      sections.push({
        id: 'water',
        title: 'Water',
        blocks: [buildWaterRegistryBlock(best)]
      });
    }
  }

  return {
    sections,
    radiusMeters,
    coordsLabel: formatCoordsLabel(point, response)
  };
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderMetaLine(block) {
  return [block.observedAt, block.distance, block.temporalLabel]
    .filter(Boolean)
    .map((bit) => escapeHtml(bit))
    .join(' · ');
}

function renderObservationBlock(block) {
  const measurementsHtml = (block.measurements || []).map((line) => (
    `<div class="lif-synthesis__measurement">${escapeHtml(line)}</div>`
  )).join('');
  const meta = renderMetaLine(block);
  return `
    <article class="lif-synthesis__block lif-synthesis__block--observation" data-pi-family="${escapeHtml(block.family)}">
      <div class="lif-synthesis__family">${escapeHtml(block.familyLabel)}</div>
      <div class="lif-synthesis__station">${escapeHtml(block.station)}</div>
      ${measurementsHtml}
      ${meta ? `<div class="lif-synthesis__meta">${meta}</div>` : ''}
    </article>`;
}

function renderContextBlock(block) {
  const measurementsHtml = (block.measurements || []).map((line) => (
    `<div class="lif-synthesis__measurement">${escapeHtml(line)}</div>`
  )).join('');
  const metaBits = [block.latestObservation, block.observationCount, block.distance, block.temporalLabel]
    .filter(Boolean)
    .map((bit) => escapeHtml(bit))
    .join(' · ');
  return `
    <article class="lif-synthesis__block lif-synthesis__block--context" data-pi-family="${escapeHtml(block.family)}">
      <div class="lif-synthesis__headline">${escapeHtml(block.headline)}</div>
      ${measurementsHtml}
      ${metaBits ? `<div class="lif-synthesis__meta">${metaBits}</div>` : ''}
    </article>`;
}

function renderWaterBlock(block) {
  const metaBits = [
    block.stationId ? `Station ${block.stationId}` : null,
    block.distance,
    block.temporalLabel
  ].filter(Boolean).map((bit) => escapeHtml(bit)).join(' · ');
  return `
    <article class="lif-synthesis__block lif-synthesis__block--water" data-pi-family="hydrometric">
      <div class="lif-synthesis__headline">${escapeHtml(block.headline)}</div>
      <div class="lif-synthesis__station">${escapeHtml(block.station)}</div>
      ${metaBits ? `<div class="lif-synthesis__meta">${metaBits}</div>` : ''}
    </article>`;
}

function renderCoverageBlock(block) {
  const footnote = block.footnote ? ` · ${block.footnote}` : '';
  return `
    <article class="lif-synthesis__block lif-synthesis__block--coverage" data-pi-family="${escapeHtml(block.family)}" data-coverage="${escapeHtml(block.kind)}">
      <div class="lif-synthesis__family">${escapeHtml(block.familyLabel)}</div>
      <div class="lif-synthesis__meta">${escapeHtml(block.message)}${footnote ? ` · ${escapeHtml(block.footnote)}` : ''}</div>
    </article>`;
}

function renderSynthesisBlock(block) {
  switch (block.kind) {
    case 'observation': return renderObservationBlock(block);
    case 'context': return renderContextBlock(block);
    case 'water-registry': return renderWaterBlock(block);
    case 'coverage-gap':
    case 'provider-issue':
      return renderCoverageBlock(block);
    default:
      return '';
  }
}

/**
 * @param {ReturnType<typeof buildLocationSynthesisModel>} model
 */
export function renderLocationSynthesisHtml(model) {
  if (!model?.sections?.length) return '';
  const sectionsHtml = model.sections.map((section) => `
    <div class="lif-synthesis__section" data-section="${escapeHtml(section.id)}">
      <h5 class="lif-synthesis__heading">${escapeHtml(section.title)}</h5>
      ${section.blocks.map(renderSynthesisBlock).join('')}
    </div>`).join('');

  return `
    <section class="lif-synthesis" aria-label="Selected location synthesis">
      <h4 class="lif-section-title">Selected location</h4>
      ${sectionsHtml}
    </section>`;
}

export const LOCATION_SYNTHESIS_RULES = Object.freeze({
  precedence: [
    'Near-real-time measurements (weather, current weather, AQHI, hydrometric measurement)',
    'Recent climate-hourly station context',
    'Historical climate daily station context',
    'Nearest hydrometric station registry metadata (not a live observation)',
    'Explicit NO_RESULTS and provider-issue coverage gaps'
  ],
  withinTier: 'Nearer distance first, then newer observation timestamp',
  temporalSeparation: 'Historical and registry metadata never appear under Current conditions'
});
