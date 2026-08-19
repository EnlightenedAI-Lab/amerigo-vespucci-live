import {
  countInView,
  crimeBreakdown,
  countMapBreakdown,
  ageLabel,
  maxStamp,
  uniqueCount,
  sumFinite,
  haversineMeters,
  viewCenter
} from './snapshot.js';
import { formatCount } from './scenes.js';

function layerOf(catalog, id) {
  return catalog?.layers?.find((row) => row.id === id) || null;
}

function payloadOf(catalog, id) {
  return layerOf(catalog, id)?.lastPayload || {};
}

function featuresOf(catalog, id) {
  return payloadOf(catalog, id)?.geojson?.features || [];
}

function observed(catalog, id) {
  const payload = payloadOf(catalog, id);
  if (!payload || payload.ok === false) return null;
  if (payload.featureCount != null) return Number(payload.featureCount);
  return featuresOf(catalog, id).length;
}

function inView(catalog, view, id) {
  const features = featuresOf(catalog, id);
  if (!features.length) return 0;
  return countInView(features, view);
}

function statusOf(catalog, id) {
  const payload = payloadOf(catalog, id);
  return payload?.status || layerOf(catalog, id)?.status || null;
}

export function truthLabel(status) {
  const raw = String(status || '').replaceAll('_', ' ');
  if (!raw) return null;
  if (raw === 'LIVE' || raw === 'NEAR-LIVE') return raw;
  if (raw === 'RECENT' || raw === 'CURRENT' || raw === 'SATELLITE DETECTION' || raw === 'SATELLITE-DERIVED ESTIMATE') {
    return `${raw} / NOT REAL-TIME`;
  }
  if (raw === 'STALE' || raw === 'HISTORICAL' || raw === 'STATIC') return raw;
  if (raw === 'AUTH REQUIRED' || raw === 'UNAVAILABLE' || raw === 'FAILED' || raw === 'EMPTY COVERAGE' || raw === 'UNSUPPORTED') {
    return raw;
  }
  return raw;
}

function finding(label, value, truth) {
  if (value == null || value === '') return null;
  return { label, value: String(value), truth: truth || null };
}

function topCategory(payload) {
  const cats = payload?.categories;
  if (!Array.isArray(cats) || !cats.length) return null;
  const top = cats[0];
  return `${top.french}${top.count != null ? ` · ${formatCount(top.count)}` : ''}`;
}

function topPdq(features) {
  const counts = {};
  for (const feature of features || []) {
    const pdq = feature.properties?.pdq;
    if (pdq == null || pdq === '') continue;
    const key = String(pdq);
    counts[key] = (counts[key] || 0) + 1;
  }
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  if (!entries.length) return null;
  return `${entries[0][0]} · ${formatCount(entries[0][1])}`;
}

function loc(value) {
  if (value == null || value === '') return null;
  if (typeof value !== 'object') return value;
  if (value.en != null && typeof value.en !== 'object') return value.en;
  if (value.fr != null && typeof value.fr !== 'object') return value.fr;
  if (value.value != null) return loc(value.value);
  return null;
}

function weatherObservation(catalog, view) {
  const stations = featuresOf(catalog, 'weather').filter((f) => f.properties?.weatherKind === 'citypage');
  if (!stations.length) return {};
  let pick = stations[0];
  const centre = viewCenter(view);
  if (centre) {
    let best = null;
    for (const feature of stations) {
      if (feature.geometry?.type !== 'Point') continue;
      const [lon, lat] = feature.geometry.coordinates || [];
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
      const meters = haversineMeters(centre.lat, centre.lon, lat, lon);
      if (!best || meters < best.meters) best = { meters, feature };
    }
    if (best?.feature) pick = best.feature;
  }
  const obs = pick.properties || {};
  const temp = loc(obs.temperature);
  const unit = loc(obs.temperatureUnit);
  const condition = loc(obs.condition);
  const name = loc(obs.name);
  const text = temp != null
    ? `${temp}${unit ? ` ${unit}` : ''}${condition ? ` · ${condition}` : ''}${name ? ` · ${name}` : ''}`
    : (condition || name || null);
  return { text, at: obs.lastUpdated || null };
}

function nearestPoint(features, view) {
  const centre = viewCenter(view);
  if (!centre || !features?.length) return null;
  let best = null;
  for (const feature of features) {
    if (feature.geometry?.type !== 'Point') continue;
    const [lon, lat] = feature.geometry.coordinates || [];
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const meters = haversineMeters(centre.lat, centre.lon, lat, lon);
    if (!best || meters < best.meters) {
      best = {
        meters,
        name: loc(feature.properties?.name) || null,
        at: feature.properties?.detectedAt || feature.properties?.observedAt || null
      };
    }
  }
  return best;
}

function formatKm(meters) {
  if (!Number.isFinite(meters)) return null;
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(meters >= 10000 ? 0 : 1)} km`;
}

function viewMeta(view) {
  const c = viewCenter(view);
  return {
    view: c ? `${c.lat.toFixed(3)}, ${c.lon.toFixed(3)}` : null,
    time: new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Toronto',
      year: 'numeric',
      month: 'short',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    }).format(new Date())
  };
}

function unavailable(catalog, id) {
  const status = statusOf(catalog, id);
  if (status === 'AUTH_REQUIRED' || status === 'UNAVAILABLE' || status === 'FAILED' || status === 'UNSUPPORTED') {
    return truthLabel(status);
  }
  return null;
}

function policeSentence(ctx) {
  const catalog = ctx.catalog;
  const view = ctx.view;
  const roads = (inView(catalog, view, 'road-works') || 0) + (inView(catalog, view, 'qc-511') || 0);
  const alerts = payloadOf(catalog, 'weather')?.alertCount;
  const hydro = payloadOf(catalog, 'hydro');
  const hydroN = Number(hydro.polygonCount ?? 0);
  const clauses = [];
  if (Number.isFinite(roads) && roads > 0) clauses.push('road / 511 records in the viewport');
  else clauses.push('no road / 511 records in the viewport');
  if (alerts === 0) clauses.push('no active ECCC weather alert in this fetch');
  else if (Number.isFinite(Number(alerts)) && Number(alerts) > 0) clauses.push(`${formatCount(alerts)} ECCC weather alert(s) in this fetch`);
  if (hydroN === 0) clauses.push('no Hydro outage areas loaded');
  else if (Number.isFinite(hydroN)) clauses.push(`${formatCount(hydroN)} Hydro outage area(s) loaded`);
  if (!clauses.length) return null;
  return `Current viewport shows ${clauses.join(', with ')}. Not a threat or risk score.`;
}

const FORBIDDEN_BRIEF = /risk score|threat score|predictive.?polic/i;

export function buildSceneBrief(scene, ctx) {
  const catalog = ctx.catalog;
  const view = ctx.view;
  const id = scene?.id;
  const meta = viewMeta(view);
  const findings = [];
  let chart = null;
  let sentence = null;
  let limitation = null;
  let truth = null;

  if (id === 'public-safety') {
    const crime = payloadOf(catalog, 'recent-crime');
    const crimeN = observed(catalog, 'recent-crime');
    findings.push(finding('RECENT CRIME', formatCount(crimeN), truthLabel(crime.status)));
    findings.push(finding('NEWEST / TOP CATEGORY', [crime.asOfDate || crime.latestSourceTimestamp, topCategory(crime)].filter(Boolean).join(' · ')));
    findings.push(finding('HIGHEST-COUNT PDQ', topPdq(featuresOf(catalog, 'recent-crime'))));
    findings.push(finding('FIRE INTERVENTIONS', formatCount(observed(catalog, 'fire-interventions')), truthLabel(statusOf(catalog, 'fire-interventions'))));
    findings.push(finding('HOSPITALS IN VIEW', formatCount(inView(catalog, view, 'hospitals'))));
    findings.push(finding(
      'CAMERAS / ROAD-511 IN VIEW',
      `${formatCount(inView(catalog, view, 'traffic-cameras')) || '0'} / ${formatCount((inView(catalog, view, 'road-works') || 0) + (inView(catalog, view, 'qc-511') || 0)) || '0'}`
    ));
    chart = crimeBreakdown(crime);
    limitation = 'DATE+QUART reports. Not live CAD. Window comparison is count only, not causation.';
    truth = 'CURRENT / NOT REAL-TIME';
  } else if (id === 'movement') {
    const stm = payloadOf(catalog, 'stm');
    findings.push(finding(
      'STM',
      `${formatCount(observed(catalog, 'stm')) || '0'} vehicles · ${formatCount(inView(catalog, view, 'stm')) || '0'} in view · ${formatCount(uniqueCount(featuresOf(catalog, 'stm'), 'routeId')) || '0'} routes`,
      truthLabel(stm.status)
    ));
    const bikes = sumFinite(featuresOf(catalog, 'bixi'), 'bikesAvailable');
    const docks = sumFinite(featuresOf(catalog, 'bixi'), 'docksAvailable');
    findings.push(finding(
      'BIXI',
      `${formatCount(observed(catalog, 'bixi')) || '0'} stations · ${bikes ? formatCount(bikes.sum) : '0'} bikes / ${docks ? formatCount(docks.sum) : '0'} docks`,
      truthLabel(statusOf(catalog, 'bixi'))
    ));
    findings.push(finding('CYCLIST COUNTERS', formatCount(observed(catalog, 'bike-counters')), truthLabel(statusOf(catalog, 'bike-counters'))));
    findings.push(finding('ROAD WORKS / 511', `${formatCount(observed(catalog, 'road-works')) || '0'} / ${formatCount(observed(catalog, 'qc-511')) || '0'}`));
    findings.push(finding(
      'CAMERAS / AIRCRAFT',
      `${formatCount(inView(catalog, view, 'traffic-cameras')) || '0'} cameras in view · ${formatCount(observed(catalog, 'aircraft')) || '0'} aircraft`,
      truthLabel(statusOf(catalog, 'aircraft'))
    ));
    findings.push(finding('LIVE SPEEDS', unavailable(catalog, 'road-traffic') || 'UNAVAILABLE'));
    limitation = 'STM live buses require STM_API_KEY. EXO is AUTH_REQUIRED. REM and live road speeds stay UNAVAILABLE.';
    truth = 'MIXED LIVE / NEAR-LIVE / UNAVAILABLE';
  } else if (id === 'infrastructure') {
    const hydro = payloadOf(catalog, 'hydro');
    findings.push(finding('HYDRO OUTAGE AREAS', formatCount(hydro.polygonCount ?? 0), truthLabel(hydro.status)));
    findings.push(finding('HYDRO POINTS', formatCount(hydro.pointCount ?? 0)));
    findings.push(finding('HOSPITALS', formatCount(observed(catalog, 'hospitals')), truthLabel(statusOf(catalog, 'hospitals'))));
    findings.push(finding('FIRE STATIONS', formatCount(observed(catalog, 'fire')), truthLabel(statusOf(catalog, 'fire'))));
    findings.push(finding('SNOW / ROAD OPS', unavailable(catalog, 'snow-ops') || truthLabel(statusOf(catalog, 'snow-ops'))));
    chart = [
      { label: 'Outage areas', count: Number(hydro.polygonCount || 0) },
      { label: 'Outage points', count: Number(hydro.pointCount || 0) }
    ].filter((row) => row.count > 0);
    const hydroTotal = chart.reduce((s, r) => s + r.count, 0);
    chart = hydroTotal ? chart.map((row) => ({ ...row, pct: Math.round((row.count / hydroTotal) * 100) })) : null;
    limitation = 'Hydro areas are approximate. Snow ops remain AUTH_REQUIRED.';
    truth = truthLabel(hydro.status);
  } else if (id === 'weather-impact') {
    const weather = payloadOf(catalog, 'weather');
    const aq = payloadOf(catalog, 'air-quality');
    const obs = weatherObservation(catalog, view);
    findings.push(finding('ACTIVE ALERTS', formatCount(weather.alertCount), truthLabel(weather.status)));
    findings.push(finding('LATEST OBSERVATION', obs.text));
    findings.push(finding('RADAR', weather.radar?.status || null));
    findings.push(finding(
      'RSQA LATEST',
      observed(catalog, 'air-quality') != null
        ? `${formatCount(observed(catalog, 'air-quality'))} stations · ${aq.latestSourceTimestamp || (aq.asOfDate ? `${aq.asOfDate} ${aq.asOfHour}:00 EST` : 'UNAVAILABLE')}`
        : null,
      truthLabel(aq.status)
    ));
    findings.push(finding(
      'WATER LATEST',
      observed(catalog, 'hydrometric') != null
        ? `${formatCount(observed(catalog, 'hydrometric'))} stations · ${maxStamp(featuresOf(catalog, 'hydrometric'), ['observedAt']) || 'UNAVAILABLE'}`
        : null,
      truthLabel(statusOf(catalog, 'hydrometric'))
    ));
    limitation = 'IQA is the published index, not a forecast. Radar is GeoMet pixels, not IPMA.';
    truth = 'LIVE weather · NEAR-LIVE AQ';
  } else if (id === 'wildfire') {
    const active = payloadOf(catalog, 'wildfire-active');
    const spots = featuresOf(catalog, 'wildfire-hotspots');
    findings.push(finding('QC ACTIVE-FIRE RECORDS', formatCount(active.quebecMatched), 'LAYER ROWS / NOT SIMULTANEOUS FIRES'));
    findings.push(finding('HOTSPOTS 24H', formatCount(observed(catalog, 'wildfire-hotspots')), 'SATELLITE DETECTION'));
    const nearest = nearestPoint(spots, view);
    findings.push(finding('NEAREST HOTSPOT', nearest ? `${formatKm(nearest.meters)}${nearest.at ? ` · ${nearest.at}` : ''}` : (spots.length ? null : 'None in loaded 24h set')));
    findings.push(finding('PERIMETERS IN VIEW', formatCount(inView(catalog, view, 'wildfire-perimeters'))));
    chart = countMapBreakdown(active.stageBreakdown, {
      OC: 'Out of control',
      BH: 'Being held',
      UC: 'Under control',
      EX: 'Extinguished',
      UN: 'Unknown'
    });
    limitation = 'Loaded-page stage bars are status rows, not unique fires. National CWFIS may lag SOPFEU.';
    truth = 'CURRENT / NOT REAL-TIME';
  } else if (id === 'police-picture') {
    const crime = payloadOf(catalog, 'recent-crime');
    const weather = payloadOf(catalog, 'weather');
    const hydro = payloadOf(catalog, 'hydro');
    findings.push(finding('RECENT REPORTS', formatCount(observed(catalog, 'recent-crime')), truthLabel(crime.status)));
    findings.push(finding(
      'ROAD / 511 IN VIEW',
      formatCount((inView(catalog, view, 'road-works') || 0) + (inView(catalog, view, 'qc-511') || 0))
    ));
    findings.push(finding('CAMERAS IN VIEW', formatCount(inView(catalog, view, 'traffic-cameras'))));
    findings.push(finding('WEATHER ALERTS', formatCount(weather.alertCount), truthLabel(weather.status)));
    findings.push(finding('HYDRO OUTAGE AREAS', formatCount(hydro.polygonCount ?? 0), truthLabel(hydro.status)));
    findings.push(finding('AIRCRAFT', formatCount(observed(catalog, 'aircraft')), truthLabel(statusOf(catalog, 'aircraft'))));
    chart = crimeBreakdown(crime);
    sentence = policeSentence(ctx);
    limitation = 'Observable signals only. No threat, danger, or predictive-policing score.';
    truth = 'MIXED CURRENT / NOT REAL-TIME';
  } else {
    for (const layerId of (scene?.layers || []).slice(0, 6)) {
      const layer = layerOf(catalog, layerId);
      if (!layer) continue;
      const payload = payloadOf(catalog, layerId);
      const value = payload.ok === false ? truthLabel(payload.status) : formatCount(observed(catalog, layerId));
      findings.push(finding(layer.title.toUpperCase(), value, truthLabel(payload.status || layer.status)));
    }
  }

  const brief = {
    title: scene?.title || 'SCENE',
    view: meta.view,
    time: meta.time,
    facts: findings.filter(Boolean).slice(0, 6),
    chart: chart || null,
    sentence,
    warning: limitation,
    truth
  };
  const serialized = JSON.stringify({ facts: brief.facts, sentence: brief.sentence, title: brief.title });
  if (FORBIDDEN_BRIEF.test(serialized)) {
    brief.sentence = 'Observable signals only. No threat, danger, or predictive-policing score.';
  }
  return brief;
}
