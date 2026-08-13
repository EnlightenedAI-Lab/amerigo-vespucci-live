/**
 * Point Intelligence visual proof 1 — hydrometric + SWOB station collapse.
 * Presentation model only. Does not alter canonical bundle evidence.
 */
import { getObservationId } from './point-intelligence-map-presentation.js';
import { AOI_CLASS, formatAoiDistanceLabel, haversineMeters } from './point-intelligence-aoi-geometry.js';

export const PI_PROOF_VISUAL_FAMILIES = Object.freeze({
  HYDROMETRIC: 'hydrometric',
  WEATHER: 'weather',
  CLIMATE: 'climate',
  WEATHER_CURRENT: 'weather-current',
  AIR_QUALITY: 'air-quality'
});

export const PI_PROOF_SOURCE_FAMILIES = Object.freeze([
  'hydrometric',
  'hydrometric-measurement',
  'weather',
  'weather-current',
  'climate',
  'climate-hourly',
  'air-quality'
]);

export const FRESHNESS_CLASS = Object.freeze({
  CURRENT: 'CURRENT',
  RECENT: 'RECENT',
  STALE: 'STALE',
  REGISTRY: 'REGISTRY'
});

/** Family-specific age thresholds for NEAR_REAL_TIME observations (seconds). */
export const FRESHNESS_POLICY = Object.freeze({
  hydrometric: { currentSeconds: 30 * 60, recentSeconds: 3 * 60 * 60 },
  weather: { currentSeconds: 15 * 60, recentSeconds: 60 * 60 },
  'weather-current': { currentSeconds: 15 * 60, recentSeconds: 60 * 60 },
  'air-quality': { currentSeconds: 30 * 60, recentSeconds: 2 * 60 * 60 },
  'climate-hourly': { currentSeconds: 90 * 60, recentSeconds: 6 * 60 * 60 },
  climate: { currentSeconds: 0, recentSeconds: 0 }
});

const ATMOSPHERE_MERGE_METERS = 60;

export function isProofSourceFamily(family) {
  return PI_PROOF_SOURCE_FAMILIES.includes(String(family || ''));
}

export function visualFamilyForSource(family) {
  if (family === 'hydrometric' || family === 'hydrometric-measurement') {
    return PI_PROOF_VISUAL_FAMILIES.HYDROMETRIC;
  }
  if (family === 'weather') return PI_PROOF_VISUAL_FAMILIES.WEATHER;
  if (family === 'weather-current') return PI_PROOF_VISUAL_FAMILIES.WEATHER_CURRENT;
  if (family === 'climate' || family === 'climate-hourly') return PI_PROOF_VISUAL_FAMILIES.CLIMATE;
  if (family === 'air-quality') return PI_PROOF_VISUAL_FAMILIES.AIR_QUALITY;
  return null;
}

function propsOf(result) {
  return result?.properties && typeof result.properties === 'object' ? result.properties : {};
}

function parseTime(value) {
  if (value == null || value === '') return null;
  const ms = Date.parse(String(value));
  return Number.isFinite(ms) ? ms : null;
}

export function observationTimestampMs(result) {
  return parseTime(
    result?.observation?.observedAt
    || result?.temporal?.DATETIME
    || result?.temporal?.['date_tm-value']
    || result?.temporal?.lastUpdated
    || result?.properties?.DATETIME
    || result?.properties?.['date_tm-value']
  );
}

export function hydrometricStationId(result) {
  const props = propsOf(result);
  const id = props.STATION_NUMBER || props.IDENTIFIER || props.station_id || null;
  return id != null && String(id).trim() ? String(id).trim() : null;
}

export function swobStationId(result) {
  const props = propsOf(result);
  const id = props['tc_id-value']
    || props.tc_id
    || props['stn_id-value']
    || props.stn_id
    || props['clim_id-value']
    || props.clim_id
    || null;
  if (id != null && String(id).trim()) return String(id).trim();
  const name = props['stn_nam-value'] || props.stn_nam || props.STATION_NAME;
  const coords = result?.geometry?.coordinates;
  if (name && Array.isArray(coords) && coords.length >= 2) {
    return `${String(name).trim()}:${Number(coords[0]).toFixed(4)},${Number(coords[1]).toFixed(4)}`;
  }
  return null;
}

export function climateStationId(result) {
  const props = propsOf(result);
  const id = props.CLIMATE_IDENTIFIER
    || props['clim_id-value']
    || props.clim_id
    || props.CLIMATE_ID
    || null;
  return id != null && String(id).trim() ? String(id).trim() : null;
}

export function citypageStationId(result) {
  const props = propsOf(result);
  const name = (typeof props.name === 'object' ? (props.name.en || props.name.fr) : props.name)
    || props.CITY
    || result?.stationName
    || null;
  if (name && String(name).trim()) return String(name).trim();
  return result?.nativeRecordId ? String(result.nativeRecordId) : null;
}

export function aqhiStationId(result) {
  const props = propsOf(result);
  const id = props.location_id
    || props.location_name_en
    || props.location_name_fr
    || result?.stationName
    || null;
  return id != null && String(id).trim() ? String(id).trim() : null;
}

export function proofStationAssetKey(result) {
  const family = result?.category || result?.nativeCollectionId;
  const visual = visualFamilyForSource(family);
  if (visual === PI_PROOF_VISUAL_FAMILIES.HYDROMETRIC) {
    const id = hydrometricStationId(result);
    return id ? `hydro:${id}` : null;
  }
  if (visual === PI_PROOF_VISUAL_FAMILIES.WEATHER_CURRENT) {
    const id = citypageStationId(result);
    return id ? `citypage:${id}` : null;
  }
  if (visual === PI_PROOF_VISUAL_FAMILIES.AIR_QUALITY) {
    const id = aqhiStationId(result);
    return id ? `aqhi:${id}` : null;
  }
  if (visual === PI_PROOF_VISUAL_FAMILIES.WEATHER || visual === PI_PROOF_VISUAL_FAMILIES.CLIMATE) {
    const climateId = climateStationId(result);
    if (climateId) return `climate:${climateId}`;
    const swobId = swobStationId(result);
    if (swobId) return `swob:${swobId}`;
    const coords = result?.geometry?.coordinates;
    if (Array.isArray(coords) && coords.length >= 2) {
      return `geom:${Number(coords[0]).toFixed(4)},${Number(coords[1]).toFixed(4)}`;
    }
  }
  return null;
}

function pointCoords(result) {
  const coords = result?.geometry?.type === 'Point' ? result.geometry.coordinates : null;
  if (!Array.isArray(coords) || coords.length < 2) return null;
  const lon = Number(coords[0]);
  const lat = Number(coords[1]);
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
  return { longitude: lon, latitude: lat };
}

function stationDisplayName(result, stationId) {
  const props = propsOf(result);
  return props.STATION_NAME
    || props['stn_nam-value']
    || props.stn_nam
    || (typeof props.name === 'object' ? (props.name.en || props.name.fr) : props.name)
    || stationId
    || null;
}

function classifyFreshness(visualFamily, ageSeconds, hasLiveMeasurement) {
  if (visualFamily === 'climate') return FRESHNESS_CLASS.STALE;
  if (!hasLiveMeasurement) {
    return visualFamily === 'hydrometric' ? FRESHNESS_CLASS.REGISTRY : FRESHNESS_CLASS.STALE;
  }
  if (!Number.isFinite(ageSeconds) || ageSeconds < 0) return FRESHNESS_CLASS.STALE;
  const policy = FRESHNESS_POLICY[visualFamily] || FRESHNESS_POLICY.weather;
  if (ageSeconds <= policy.currentSeconds) return FRESHNESS_CLASS.CURRENT;
  if (ageSeconds <= policy.recentSeconds) return FRESHNESS_CLASS.RECENT;
  return FRESHNESS_CLASS.STALE;
}

function numericObservation(result, property) {
  const obs = result?.observation;
  if (obs?.property === property && obs.value != null && Number.isFinite(Number(obs.value))) {
    return { value: Number(obs.value), unit: obs.unit || null, observedAt: obs.observedAt || null };
  }
  const props = propsOf(result);
  if (props[property] != null && Number.isFinite(Number(props[property]))) {
    return {
      value: Number(props[property]),
      unit: property === 'LEVEL' ? 'm' : property === 'DISCHARGE' ? 'm3/s' : null,
      observedAt: result?.observation?.observedAt || result?.temporal?.DATETIME || null
    };
  }
  return null;
}

/**
 * Trend only when ≥2 chronological observations of the same property exist.
 * @returns {object | null}
 */
export function computeDeterministicTrend(series = []) {
  const clean = series
    .filter((row) => Number.isFinite(row?.t) && Number.isFinite(row?.v))
    .sort((a, b) => a.t - b.t);
  if (clean.length < 2) return null;
  const first = clean[0];
  const last = clean[clean.length - 1];
  const windowHours = (last.t - first.t) / 3600000;
  if (!(windowHours > 0.05)) return null;
  const delta = last.v - first.v;
  return {
    property: first.property || last.property || null,
    unit: first.unit || last.unit || null,
    startValue: first.v,
    endValue: last.v,
    startTime: new Date(first.t).toISOString(),
    endTime: new Date(last.t).toISOString(),
    windowHours,
    delta,
    perHour: delta / windowHours
  };
}

function hydroPrimary(groupResults) {
  const measurements = groupResults.filter((r) => r.category === 'hydrometric-measurement'
    || r.nativeCollectionId === 'hydrometric-realtime');
  const ranked = [...measurements].sort((a, b) => (
    (observationTimestampMs(b) || 0) - (observationTimestampMs(a) || 0)
  ));
  for (const result of ranked) {
    const level = numericObservation(result, 'LEVEL');
    if (level) {
      return {
        result,
        property: 'LEVEL',
        label: 'WATER LEVEL',
        value: level.value,
        unit: level.unit === 'm' ? 'm' : (level.unit || 'm'),
        observedAt: level.observedAt
      };
    }
  }
  for (const result of ranked) {
    const discharge = numericObservation(result, 'DISCHARGE');
    if (discharge) {
      return {
        result,
        property: 'DISCHARGE',
        label: 'DISCHARGE',
        value: discharge.value,
        unit: discharge.unit === 'm3/s' ? 'm³/s' : (discharge.unit || 'm³/s'),
        observedAt: discharge.observedAt
      };
    }
  }
  return null;
}

function weatherPrimary(groupResults) {
  const ranked = [...groupResults].sort((a, b) => (
    (observationTimestampMs(b) || 0) - (observationTimestampMs(a) || 0)
  ));
  for (const result of ranked) {
    const obs = result.observation;
    if (obs?.value != null && Number.isFinite(Number(obs.value)) && /temp/i.test(String(obs.property || ''))) {
      const unit = obs.unit === 'C' || obs.unit === '°C' ? '°C' : (obs.unit || '°C');
      return {
        result,
        property: obs.property,
        label: 'TEMPERATURE',
        value: Number(obs.value),
        unit,
        observedAt: obs.observedAt
      };
    }
    const props = propsOf(result);
    const nested = props.currentConditions?.temperature;
    const nestedValue = nested?.value?.en ?? nested?.value;
    const temp = props.air_temp
      ?? props['air_temp-value']
      ?? props.TEMP
      ?? props.MEAN_TEMPERATURE
      ?? props.MEAN_TEMP
      ?? nestedValue;
    if (temp != null && Number.isFinite(Number(temp))) {
      return {
        result,
        property: 'air_temp',
        label: 'TEMPERATURE',
        value: Number(temp),
        unit: '°C',
        observedAt: result.observation?.observedAt || result.temporal?.['date_tm-value']
      };
    }
  }
  return ranked[0] ? {
    result: ranked[0],
    property: null,
    label: null,
    value: null,
    unit: null,
    observedAt: ranked[0].observation?.observedAt || ranked[0].temporal?.['date_tm-value']
  } : null;
}

function windHover(result) {
  const props = propsOf(result);
  const speed = props['wind_spd_scal-value'];
  const dir = props['wind_dir_10_min-value'] ?? props['wind_dir-value'];
  const unit = props['wind_spd_scal-value-uom'] || 'km/h';
  const hasSpeed = Number.isFinite(Number(speed));
  const hasDir = dir != null && dir !== '' && Number.isFinite(Number(dir));
  if (!hasSpeed && !hasDir) return null;
  return {
    speed: hasSpeed ? Number(speed) : null,
    directionDeg: hasDir ? Number(dir) : null,
    unit: hasSpeed ? unit : null
  };
}

function sourceFamilyOf(result) {
  return result?.category || result?.nativeCollectionId || null;
}

function channelLabel(family) {
  if (family === 'weather') return 'SWOB WEATHER';
  if (family === 'weather-current') return 'CURRENT WEATHER';
  if (family === 'climate-hourly') return 'CLIMATE HOURLY';
  if (family === 'climate') return 'CLIMATE DAILY';
  if (family === 'air-quality') return 'AIR QUALITY';
  if (family === 'hydrometric-measurement' || family === 'hydrometric') return 'HYDROMETRIC';
  return String(family || '').replace(/-/g, ' ').toUpperCase();
}

function aqhiPrimary(groupResults) {
  const ranked = [...groupResults].sort((a, b) => (
    (observationTimestampMs(b) || 0) - (observationTimestampMs(a) || 0)
  ));
  for (const result of ranked) {
    const obs = result.observation;
    if (obs?.value != null && Number.isFinite(Number(obs.value))) {
      return {
        result,
        property: obs.property || 'aqhi',
        label: 'AQHI',
        value: Number(obs.value),
        unit: obs.unit || 'AQHI',
        observedAt: obs.observedAt
      };
    }
    const aqhi = propsOf(result).aqhi ?? propsOf(result).AQHI;
    if (aqhi != null && Number.isFinite(Number(aqhi))) {
      return {
        result,
        property: 'aqhi',
        label: 'AQHI',
        value: Number(aqhi),
        unit: 'AQHI',
        observedAt: result.observation?.observedAt || result.temporal?.observation_datetime
      };
    }
  }
  return null;
}

function pickPrimary(groupResults, visualFamily) {
  if (visualFamily === 'hydrometric') return hydroPrimary(groupResults);
  if (visualFamily === 'air-quality') return aqhiPrimary(groupResults);
  const weatherFirst = groupResults.filter((r) => sourceFamilyOf(r) === 'weather' || sourceFamilyOf(r) === 'weather-current');
  const hourly = groupResults.filter((r) => sourceFamilyOf(r) === 'climate-hourly');
  const daily = groupResults.filter((r) => sourceFamilyOf(r) === 'climate');
  return weatherPrimary(weatherFirst.length ? weatherFirst : (hourly.length ? hourly : daily));
}

function buildChannels(groupResults) {
  const byFamily = new Map();
  for (const result of groupResults) {
    const family = sourceFamilyOf(result);
    if (!family) continue;
    const mapped = family === 'hydrometric-measurement' ? 'hydrometric' : family;
    if (mapped === 'hydrometric' && family === 'hydrometric') {
      if (!byFamily.has('hydrometric')) byFamily.set('hydrometric', []);
      byFamily.get('hydrometric').push(result);
      continue;
    }
    if (!byFamily.has(mapped)) byFamily.set(mapped, []);
    byFamily.get(mapped).push(result);
  }
  const channels = [];
  const order = ['weather', 'weather-current', 'climate-hourly', 'climate', 'air-quality', 'hydrometric'];
  for (const family of order) {
    const rows = byFamily.get(family);
    if (!rows?.length) continue;
    let primary = null;
    if (family === 'hydrometric') primary = hydroPrimary(rows);
    else if (family === 'air-quality') primary = aqhiPrimary(rows);
    else primary = weatherPrimary(rows);
    channels.push({
      family,
      label: channelLabel(family),
      available: true,
      value: primary?.value ?? null,
      unit: primary?.unit ?? null,
      observedAt: primary?.observedAt ?? null
    });
  }
  return channels;
}

function mergeNearbyAtmosphereGroups(groups) {
  const entries = [...groups.entries()].map(([assetKey, results]) => {
    const coords = results.map(pointCoords).find(Boolean);
    const visual = visualFamilyForSource(sourceFamilyOf(results[0]));
    return { assetKey, results, coords, visual };
  });
  const atmosphere = entries.filter((row) => row.visual === 'weather' || row.visual === 'climate');
  const kept = entries.filter((row) => row.visual !== 'weather' && row.visual !== 'climate');
  const used = new Set();
  for (let i = 0; i < atmosphere.length; i += 1) {
    if (used.has(i) || !atmosphere[i].coords) continue;
    const merged = [...atmosphere[i].results];
    used.add(i);
    for (let j = i + 1; j < atmosphere.length; j += 1) {
      if (used.has(j) || !atmosphere[j].coords) continue;
      const dist = haversineMeters(
        atmosphere[i].coords.longitude,
        atmosphere[i].coords.latitude,
        atmosphere[j].coords.longitude,
        atmosphere[j].coords.latitude
      );
      if (dist <= ATMOSPHERE_MERGE_METERS) {
        merged.push(...atmosphere[j].results);
        used.add(j);
      }
    }
    kept.push({
      assetKey: atmosphere[i].assetKey,
      results: merged
    });
  }
  for (let i = 0; i < atmosphere.length; i += 1) {
    if (!used.has(i)) kept.push(atmosphere[i]);
  }
  const out = new Map();
  for (const row of kept) out.set(row.assetKey, row.results);
  return out;
}

function mergeCoincidentVisualFamily(groups, visualFamily, maxMeters) {
  const entries = [...groups.entries()].map(([assetKey, results]) => {
    const coords = results.map(pointCoords).find(Boolean);
    const visual = visualFamilyForSource(sourceFamilyOf(results[0]));
    return { assetKey, results, coords, visual };
  });
  const subset = entries.filter((row) => row.visual === visualFamily);
  const kept = entries.filter((row) => row.visual !== visualFamily);
  const used = new Set();
  for (let i = 0; i < subset.length; i += 1) {
    if (used.has(i) || !subset[i].coords) continue;
    const merged = [...subset[i].results];
    used.add(i);
    for (let j = i + 1; j < subset.length; j += 1) {
      if (used.has(j) || !subset[j].coords) continue;
      const dist = haversineMeters(
        subset[i].coords.longitude,
        subset[i].coords.latitude,
        subset[j].coords.longitude,
        subset[j].coords.latitude
      );
      if (dist <= maxMeters) {
        merged.push(...subset[j].results);
        used.add(j);
      }
    }
    kept.push({ assetKey: subset[i].assetKey, results: merged });
  }
  for (let i = 0; i < subset.length; i += 1) {
    if (!used.has(i)) kept.push(subset[i]);
  }
  const out = new Map();
  for (const row of kept) out.set(row.assetKey, row.results);
  return out;
}

function resolveVisualFamily(groupResults) {
  const sources = new Set(groupResults.map(sourceFamilyOf));
  if (sources.has('hydrometric') || sources.has('hydrometric-measurement')) return 'hydrometric';
  if (sources.has('air-quality')) return 'air-quality';
  if (sources.has('weather')) return 'weather';
  if (sources.has('weather-current')) return 'weather-current';
  if (sources.has('climate') || sources.has('climate-hourly')) return 'climate';
  return visualFamilyForSource(sourceFamilyOf(groupResults[0]));
}

function resolveStationId(groupResults, visualFamily) {
  if (visualFamily === 'hydrometric') return hydrometricStationId(groupResults[0]);
  if (visualFamily === 'air-quality') return aqhiStationId(groupResults[0]);
  if (visualFamily === 'weather-current') return citypageStationId(groupResults[0]);
  return climateStationId(groupResults[0]) || swobStationId(groupResults[0]) || citypageStationId(groupResults[0]);
}

/**
 * Collapse observations from all current PI families into one map object per physical station.
 */
export function buildProofStationRecords(results = [], options = {}) {
  const nowMs = Number.isFinite(options.nowMs) ? options.nowMs : Date.now();
  const retrievedAt = options.retrievedAt || new Date(nowMs).toISOString();
  const groups = new Map();

  for (const result of results) {
    if (!isProofSourceFamily(result?.category || result?.nativeCollectionId)) continue;
    const assetKey = proofStationAssetKey(result);
    if (!assetKey) continue;
    if (!pointCoords(result) && !groups.has(assetKey)) continue;
    if (!groups.has(assetKey)) groups.set(assetKey, []);
    groups.get(assetKey).push(result);
  }

  const mergedAtmosphere = mergeNearbyAtmosphereGroups(groups);
  const merged = mergeCoincidentVisualFamily(mergedAtmosphere, 'weather-current', ATMOSPHERE_MERGE_METERS);
  const records = [];
  for (const [assetKey, groupResults] of merged) {
    const visualFamily = resolveVisualFamily(groupResults);
    const coords = groupResults.map(pointCoords).find(Boolean);
    if (!coords) continue;

    const stationId = resolveStationId(groupResults, visualFamily);
    const named = groupResults.find((r) => stationDisplayName(r, stationId));
    const primary = pickPrimary(groupResults, visualFamily);
    const liveResult = primary?.result
      || groupResults.find((r) => ['hydrometric-measurement', 'weather', 'weather-current', 'air-quality'].includes(r.category))
      || groupResults[0];
    const observedMs = parseTime(primary?.observedAt) || observationTimestampMs(liveResult);
    const hasLiveMeasurement = primary?.value != null && visualFamily !== 'climate';
    const ageSeconds = primary?.value != null && Number.isFinite(observedMs)
      ? Math.max(0, (nowMs - observedMs) / 1000)
      : null;
    const freshnessClass = visualFamily === 'hydrometric' && !hasLiveMeasurement
      ? FRESHNESS_CLASS.REGISTRY
      : classifyFreshness(visualFamily === 'weather-current' ? 'weather-current' : visualFamily, ageSeconds, hasLiveMeasurement);

    const trendSeries = visualFamily === 'hydrometric'
      ? groupResults
        .map((result) => {
          const level = numericObservation(result, 'LEVEL');
          const t = parseTime(level?.observedAt) || observationTimestampMs(result);
          if (!level || !Number.isFinite(t)) return null;
          return { t, v: level.value, unit: level.unit, property: 'LEVEL' };
        })
        .filter(Boolean)
      : [];
    const trend = computeDeterministicTrend(trendSeries);
    const representativeId = getObservationId(liveResult);
    const observationIds = groupResults.map(getObservationId);
    const provenance = liveResult.provenance || {};
    const channels = buildChannels(groupResults);

    records.push({
      assetKey,
      stationId,
      stationName: [...new Set(groupResults.map((result) => stationDisplayName(result, stationId)).filter(Boolean))].join(' / ')
        || stationDisplayName(named || liveResult, stationId),
      family: visualFamily,
      subtype: visualFamily === 'hydrometric'
        ? (hasLiveMeasurement ? 'hydrometric-measurement' : 'hydrometric-registry')
        : visualFamily,
      longitude: coords.longitude,
      latitude: coords.latitude,
      primaryValue: primary?.value ?? null,
      primaryUnit: primary?.unit ?? null,
      primaryLabel: primary?.label ?? null,
      observationTime: Number.isFinite(observedMs) ? new Date(observedMs).toISOString() : null,
      retrievedTime: liveResult.retrievedAt || retrievedAt,
      ageSeconds,
      freshnessClass,
      rendererKey: liveResult.aoiClassification === 'INSIDE_AOI'
        ? `${visualFamily}-${freshnessClass}-inside`
        : liveResult.aoiClassification === 'SUPPORTING_EXTERNAL'
          ? `${visualFamily}-${freshnessClass}-external`
          : `${visualFamily}-${freshnessClass}`,
      trendValue: trend ? trend.perHour : null,
      trendDelta: trend ? trend.delta : null,
      trendUnit: trend?.unit || null,
      trendWindowHours: trend ? trend.windowHours : null,
      trend: trend || null,
      qualityState: null,
      qualityLabel: null,
      wind: visualFamily === 'weather' ? windHover(liveResult) : null,
      provider: liveResult.providerName || provenance.provider || 'MSC GeoMet',
      dataset: liveResult.nativeCollectionId || provenance.dataset || null,
      sourceUrl: provenance.source || provenance.sourceUrl || null,
      distanceMeters: liveResult.clickDistanceMeters ?? null,
      aoiClassification: liveResult.aoiClassification || null,
      aoiBoundaryDistanceMeters: liveResult.aoiBoundaryDistanceMeters ?? null,
      aoiNearestBoundary: liveResult.aoiNearestBoundary || null,
      acquisitionRole: liveResult.acquisitionRole || null,
      queryOriginDistanceMeters: liveResult.queryOriginDistanceMeters ?? null,
      lifRecordKey: representativeId,
      observationId: representativeId,
      observationIds,
      sourceFamilies: [...new Set(groupResults.map((r) => r.category).filter(Boolean))],
      channels
    });
  }

  records.sort((a, b) => (a.distanceMeters ?? 1e12) - (b.distanceMeters ?? 1e12));
  return records;
}

export function formatAgeLabel(ageSeconds) {
  if (!Number.isFinite(ageSeconds)) return null;
  if (ageSeconds < 60) return `${Math.max(1, Math.round(ageSeconds))} s ago`;
  if (ageSeconds < 3600) return `${Math.round(ageSeconds / 60)} min ago`;
  if (ageSeconds < 86400) {
    const hours = ageSeconds / 3600;
    return `${hours >= 10 ? Math.round(hours) : hours.toFixed(1)} h ago`;
  }
  return `${Math.round(ageSeconds / 86400)} d ago`;
}

function familyHoverTitle(record) {
  if (record.family === 'hydrometric') return 'HYDROMETRIC STATION';
  if (record.family === 'air-quality') return 'AIR QUALITY STATION';
  if (record.family === 'weather-current') return 'CURRENT WEATHER';
  if (record.family === 'climate') return 'CLIMATE STATION';
  if ((record.channels || []).some((ch) => ch.family === 'climate' || ch.family === 'climate-hourly')) {
    return 'WEATHER / CLIMATE STATION';
  }
  return 'WEATHER STATION';
}

function formatChannelValue(channel) {
  if (channel.value != null && channel.unit) {
    const value = Number.isInteger(channel.value)
      ? String(channel.value)
      : Number(channel.value).toFixed(Math.abs(channel.value) >= 10 ? 1 : 2);
    return `${channel.label} ${value} ${channel.unit}`;
  }
  return `${channel.label} AVAILABLE`;
}

export function formatProofHoverModel(record) {
  if (!record) return null;
  const evidenceDriven = record.acquisitionRole === 'SUPPORTING_OBSERVATION';
  const lines = [];
  const title = record.stationName || record.stationId || 'Station';
  const familyLabel = familyHoverTitle(record);
  const channels = Array.isArray(record.channels) && record.channels.length
    ? record.channels
    : null;
  if (channels) {
    for (const channel of channels) lines.push(formatChannelValue(channel));
  } else if (record.primaryValue != null && record.primaryUnit) {
    const value = Number.isInteger(record.primaryValue)
      ? String(record.primaryValue)
      : Number(record.primaryValue).toFixed(Math.abs(record.primaryValue) >= 10 ? 1 : 2);
    lines.push(record.primaryLabel ? `${record.primaryLabel} ${value} ${record.primaryUnit}` : `${value} ${record.primaryUnit}`);
  }
  if (record.family === 'weather' && record.wind) {
    const bits = [];
    if (record.wind.directionDeg != null) bits.push(`${Math.round(record.wind.directionDeg)}°`);
    if (record.wind.speed != null) bits.push(`${record.wind.speed} ${record.wind.unit || 'km/h'}`);
    if (bits.length) lines.push(`WIND ${bits.join(' · ')}`);
  }
  const age = formatAgeLabel(record.ageSeconds);
  if (age && (record.family === 'hydrometric' || record.family === 'weather' || record.family === 'weather-current' || record.family === 'air-quality')) {
    lines.push(`UPDATED ${age}`);
  }
  const originDistance = formatAoiDistanceLabel(record.queryOriginDistanceMeters ?? record.distanceMeters);
  if (evidenceDriven && originDistance) {
    lines.push('DISTANCE FROM QUERY ORIGIN');
    lines.push(originDistance);
  }
  if (record.aoiClassification === AOI_CLASS.INSIDE_AOI) {
    lines.push('INSIDE ACQUISITION AREA');
  } else if (record.aoiClassification === AOI_CLASS.SUPPORTING_EXTERNAL) {
    const distance = formatAoiDistanceLabel(record.aoiBoundaryDistanceMeters);
    if (distance) lines.push(`${distance} OUTSIDE AOI`);
    lines.push('SUPPORTING OBSERVATION');
  } else if (evidenceDriven) {
    lines.push('ROLE');
    lines.push('SUPPORTING OBSERVATION');
    const source = /msc/i.test(String(record.provider || '')) ? 'MSC' : (record.provider || null);
    if (source) {
      lines.push('SOURCE');
      lines.push(source);
    }
  }
  return {
    title,
    familyLabel,
    freshnessClass: evidenceDriven ? '' : record.freshnessClass,
    evidenceDriven,
    lines
  };
}
