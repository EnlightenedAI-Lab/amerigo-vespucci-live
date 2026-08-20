/** Canonical :8793 operational symbology adapted to the Spatial V2 SVG paint surface. */

export const VISUAL = {
  moving: { hue: '#8a9aaa', label: 'Transit' },
  aircraft: { hue: '#c5d0d8', label: 'Aircraft' },
  event: { hue: '#c45c5c', label: 'Recent event' },
  facility: { hue: '#9aa8b5', label: 'Static facility' },
  territory: { hue: '#7d8b96', label: 'Jurisdiction' },
  affected: { hue: '#c9a227', label: 'Affected area' },
  environment: { hue: '#6ea8d8', label: 'Environmental' },
  historical: { hue: '#8a8178', label: 'Historical context' },
  wildfire: { hue: '#ff6a2b', label: 'Wildfire' }
};

export const OPERATIONAL_ZOOM = 14;

export const LAYER_CLASS = {
  stm: 'moving',
  aircraft: 'aircraft',
  'recent-crime': 'event',
  'fire-interventions': 'event',
  'civic-311': 'event',
  pdq: 'facility',
  fire: 'facility',
  hospitals: 'facility',
  bixi: 'facility',
  'traffic-cameras': 'facility',
  'pdq-territories': 'territory',
  hydro: 'affected',
  'road-works': 'affected',
  'qc-511': 'affected',
  weather: 'environment',
  'sun-daylight': 'environment',
  'air-quality': 'environment',
  hydrometric: 'environment',
  'bike-counters': 'environment',
  'wildfire-active': 'wildfire',
  'wildfire-hotspots': 'wildfire',
  'wildfire-perimeters': 'wildfire',
  'wildfire-fwi': 'wildfire',
  'spvm-crime': 'historical',
  'intersection-counts': 'historical',
  exo: 'unavailable',
  rem: 'unavailable',
  'road-traffic': 'unavailable',
  'snow-ops': 'unavailable'
};

export const CLUSTER_LAYERS = {
  stm: { disableAt: 14, radius: 56, kind: 'bus' },
  aircraft: { disableAt: 13, radius: 40, kind: 'air' },
  'fire-interventions': { disableAt: 14, radius: 64, kind: 'fire-event' },
  'recent-crime': { disableAt: 13, radius: 36, kind: 'crime' },
  bixi: { disableAt: 14, radius: 44, kind: 'bike' },
  'wildfire-active': { disableAt: 9, radius: 52, kind: 'wildfire' },
  'wildfire-hotspots': { disableAt: 10, radius: 40, kind: 'hotspot' }
};

export const MARKER_STYLE = {
  moving: 'circle',
  aircraft: 'circle',
  event: 'diamond',
  facility: 'square',
  territory: 'square',
  affected: 'diamond',
  environment: 'triangle',
  historical: 'circle',
  wildfire: 'diamond',
  unavailable: 'cross'
};

export const SOLAR = {
  daylight: '#ffe7b0',
  civil: '#ef9840',
  nautical: '#3ec8e0',
  astronomical: '#7a63e0',
  night: '#1b1548',
  terminator: '#fff4d0',
  casing: '#0b0e14'
};

export function visualClass(layerId) {
  return LAYER_CLASS[layerId] || 'facility';
}

export function markerStyleFor(layerId) {
  return MARKER_STYLE[visualClass(layerId)] || 'circle';
}

function parseStamp(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'number' && Number.isFinite(value)) return value > 1e12 ? value : value * 1000;
  const raw = String(value).trim();
  if (/^\d{10}$/.test(raw)) return Number(raw) * 1000;
  if (/^\d{13}$/.test(raw)) return Number(raw);
  const ms = Date.parse(raw);
  return Number.isFinite(ms) ? ms : null;
}

export function freshnessState(props = {}) {
  if (Number.isFinite(Number(props.ageSeconds))) {
    const age = Number(props.ageSeconds);
    if (age <= 20) return 'fresh';
    if (age <= 90) return 'aging';
    return 'stale';
  }
  const stamp = parseStamp(
    props.vehicleTimestamp
    || props.observedAt
    || props.feedTimestampIso
    || props.feedTimestamp
    || props.lastReported
  );
  if (stamp == null) return 'unknown';
  const age = (Date.now() - stamp) / 1000;
  if (age <= 30) return 'fresh';
  if (age <= 90) return 'aging';
  return 'stale';
}

export function recencyRank(props = {}) {
  const date = String(props.date || props.createdAt || '').slice(0, 10);
  const asOf = String(props.asOfDate || props.windowEnd || date).slice(0, 10);
  if (!date || !asOf) return 2;
  const a = Date.parse(`${date}T00:00:00`);
  const b = Date.parse(`${asOf}T00:00:00`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 2;
  const days = Math.max(0, Math.round((b - a) / 86400000));
  if (days <= 0) return 3;
  if (days <= 2) return 2;
  return 1;
}

export function headingDeg(props = {}) {
  const raw = props.bearing ?? props.heading ?? props.headingDegrees;
  if (raw == null || raw === '') return null;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0 || value > 360) return null;
  return value % 360;
}

function reticleMarkup() {
  return '<svg class="sym-reticle" viewBox="0 0 32 32" aria-hidden="true"><path d="M6 12 V6 H12 M20 6 H26 V12 M26 20 V26 H20 M12 26 H6 V20" fill="none" stroke="currentColor" stroke-width="1.7"/></svg>';
}

function htmlSymbol(markup, { size, cls, heading = null, selected = false }) {
  const rotation = heading == null ? '' : `--rot:${heading}deg`;
  const headingClass = heading == null ? 'no-heading' : 'has-heading';
  return {
    kind: 'html',
    size,
    html: `<span class="sym-shell sym-contrast ${cls} ${headingClass}"><span class="sym-rot" style="${rotation}">${markup}</span>${selected ? reticleMarkup() : ''}</span>`
  };
}

function busSvg(tick) {
  return tick
    ? '<svg viewBox="0 0 24 24" aria-hidden="true"><rect class="bus-body" x="9.4" y="5" width="5.2" height="14" rx="1"/></svg>'
    : '<svg viewBox="0 0 24 24" aria-hidden="true"><rect class="bus-body" x="7" y="2.4" width="10" height="19.2" rx="2"/><rect class="bus-cab" x="8" y="2.6" width="8" height="4.2" rx="0.8"/><rect class="bus-win" x="8.2" y="8.2" width="7.6" height="2"/><rect class="bus-win" x="8.2" y="11.4" width="7.6" height="2"/><rect class="wheel" x="5.2" y="6.2" width="2" height="3.4" rx="0.5"/><rect class="wheel" x="16.8" y="6.2" width="2" height="3.4" rx="0.5"/><rect class="wheel" x="5.2" y="15.2" width="2" height="3.4" rx="0.5"/><rect class="wheel" x="16.8" y="15.2" width="2" height="3.4" rx="0.5"/></svg>';
}

function airSvg() {
  return '<svg viewBox="0 0 24 24" aria-hidden="true"><path class="air-body" d="M12 2.2 L13.4 9.2 L22 11.1 L13.4 12.4 L12.8 18.2 L16 21 L12 19.4 L8 21 L11.2 18.2 L10.6 12.4 L2 11.1 L10.6 9.2 Z"/></svg>';
}

function bikeSvg() {
  return '<svg viewBox="0 0 24 24" aria-hidden="true"><circle class="wheel" cx="8" cy="16.2" r="3.5"/><circle class="wheel" cx="16.4" cy="16.2" r="3.5"/><path class="frame" d="M8 16.2 L12.4 8 L16.4 16.2 M12.4 8 L12.4 6 M10.2 11.8 H14.4"/></svg>';
}

function cameraSvg() {
  return '<svg viewBox="0 0 24 24" aria-hidden="true"><rect class="halo" x="2.6" y="7.4" width="18.8" height="13.2" rx="2"/><rect class="body" x="3.6" y="8.4" width="16.8" height="11.2" rx="1.5"/><circle class="lens" cx="12" cy="14" r="3.4"/><rect class="hood" x="8.6" y="5.6" width="6.8" height="3" rx="0.5"/></svg>';
}

function fireStationSvg() {
  return '<svg viewBox="0 0 24 24" aria-hidden="true"><path class="halo" d="M1.8 11.4 L12 2.6 L22.2 11.4 V22.2 H1.8 Z"/><path class="body" d="M3 11.5 L12 3.8 L21 11.5 V21 H3 Z"/><rect class="door" x="9.8" y="13.8" width="4.4" height="7.2"/><path class="flame" d="M12 7 C10.2 9.4 10.5 11.4 12 12.5 C13.5 11.4 13.8 9.4 12 7 Z"/></svg>';
}

function policeSvg() {
  return '<svg viewBox="0 0 24 24" aria-hidden="true"><path class="halo" d="M12 1.4 L21 5.2 V12.2 C21 17.6 16.4 21.2 12 22.8 C7.6 21.2 3 17.6 3 12.2 V5.2 Z"/><path class="body" d="M12 2.6 L19.4 5.8 V12 C19.4 16.8 15.6 20 12 21.4 C8.4 20 4.6 16.8 4.6 12 V5.8 Z"/></svg>';
}

function hospitalSvg() {
  return '<svg viewBox="0 0 24 24" aria-hidden="true"><rect class="halo" x="2" y="2" width="20" height="20" rx="2.2"/><rect class="body" x="3.2" y="3.2" width="17.6" height="17.6" rx="1.6"/><path class="cross" d="M12 6.2 V17.8 M6.2 12 H17.8"/></svg>';
}

function crimeKind(props = {}) {
  const key = String(props.category || '');
  if (key.includes('Introduction')) return 'intro';
  if (key.includes('Méfait') || key.includes('Mefait')) return 'mefait';
  if (key.includes('dans / sur')) return 'fromveh';
  if (key.includes('Vol de véhicule')) return 'veh';
  if (key.includes('qualifiés') || key.includes('qualifies')) return 'robbery';
  if (key.includes('mort')) return 'death';
  return 'other';
}

function crimeSvg(kind) {
  const inner = {
    intro: '<rect class="mod" x="10.2" y="10.2" width="3.6" height="3.6"/>',
    mefait: '<path class="mod" d="M8.5 12 H15.5"/>',
    fromveh: '<path class="mod" d="M8.2 13.2 V10.4 H15.8 V13.2"/>',
    veh: '<path class="mod" d="M8.4 14.2 L12 9.4 L15.6 14.2"/>',
    robbery: '<path class="mod" d="M12 8.6 L15.2 12 L12 15.4 L8.8 12 Z"/>',
    death: '<path class="mod" d="M9 9 L15 15 M15 9 L9 15"/>'
  }[kind] || '';
  return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.2 L21.8 12 L12 21.8 L2.2 12 Z"/>${inner}</svg>`;
}

function fireEventSvg() {
  return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 1.8 L22.2 12 L12 22.2 L1.8 12 Z"/><path class="flame" d="M12 7.2 C10 9.8 10.4 12.2 12 13.6 C13.6 12.2 14 9.8 12 7.2 Z"/></svg>';
}

function civicSvg() {
  return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.4 L21.6 12 L12 21.6 L2.4 12 Z"/></svg>';
}

function envMark(layerId, props = {}) {
  const iqa = Number(props.iqa);
  const label = layerId === 'air-quality' && Number.isFinite(iqa) ? String(Math.round(iqa)) : '';
  if (layerId === 'air-quality') return `<svg viewBox="0 0 24 24" aria-hidden="true"><circle class="ring-outer" cx="12" cy="12" r="10"/><circle class="ring-inner" cx="12" cy="12" r="6.4"/><text x="12" y="14.2" text-anchor="middle">${label}</text></svg>`;
  if (layerId === 'hydrometric') return '<svg viewBox="0 0 24 24" aria-hidden="true"><circle class="ring-outer" cx="12" cy="12" r="10"/><path class="wave" d="M6 12 Q8.5 8.8 11 12 T16 12 T21 12"/></svg>';
  if (layerId === 'weather') return '<svg viewBox="0 0 24 24" aria-hidden="true"><circle class="ring-outer" cx="12" cy="12" r="10"/><circle class="core" cx="12" cy="12" r="3.1"/></svg>';
  if (layerId === 'sun-daylight') return '<svg viewBox="0 0 24 24" aria-hidden="true"><circle class="core" cx="12" cy="12" r="3.4"/><path class="ray" d="M12 3 V6 M12 18 V21 M3 12 H6 M18 12 H21 M5.6 5.6 L7.7 7.7 M16.3 16.3 L18.4 18.4 M18.4 5.6 L16.3 7.7 M7.7 16.3 L5.6 18.4"/></svg>';
  return '<svg viewBox="0 0 24 24" aria-hidden="true"><circle class="ring-outer" cx="12" cy="12" r="10"/><circle class="ring-inner" cx="12" cy="12" r="5"/></svg>';
}

function wildfireMark(layerId) {
  if (layerId === 'wildfire-hotspots') return '<svg viewBox="0 0 24 24" aria-hidden="true"><circle class="core" cx="12" cy="12" r="2.4"/><path class="spark" d="M12 3.4 V8.2 M12 15.8 V20.6 M3.4 12 H8.2 M15.8 12 H20.6"/></svg>';
  if (layerId === 'wildfire-fwi') return '<svg viewBox="0 0 24 24" aria-hidden="true"><rect class="box" x="6.4" y="6.4" width="11.2" height="11.2"/><circle class="core" cx="12" cy="12" r="1.6"/></svg>';
  return '<svg viewBox="0 0 24 24" aria-hidden="true"><path class="pin" d="M12 1.6 C7.8 8.2 6.2 12.2 6.2 15.6 C6.2 19.2 8.7 22.2 12 22.2 C15.3 22.2 17.8 19.2 17.8 15.6 C17.8 12.2 16.2 8.2 12 1.6 Z"/><path class="flame" d="M12 8.2 C10.4 10.8 10.6 13 12 14.2 C13.4 13 13.6 10.8 12 8.2 Z"/></svg>';
}

function subsolarSymbol(selected) {
  return {
    kind: 'html',
    size: 96,
    html: `<div class="sun-subsolar-mark${selected ? ' is-selected' : ''}"><div class="sun-orb"><i class="sun-halo"></i><i class="sun-ring r-outer"></i><span class="sun-ticks" aria-hidden="true"></span><b class="sun-disc"></b></div><label><span>SUN</span>SUBSOLAR POINT</label></div>`
  };
}

export function pointSymbol(layerId, props = {}, { selected = false, zoom = 11 } = {}) {
  if (layerId === 'sun-daylight' && props.sunKind === 'subsolar') return subsolarSymbol(selected);
  const cls = visualClass(layerId);
  if (cls === 'moving' || cls === 'aircraft') {
    const kind = cls === 'aircraft' ? 'air' : 'bus';
    const tick = kind === 'bus' && zoom < OPERATIONAL_ZOOM;
    const size = selected ? 26 : (tick ? 11 : (kind === 'air' ? 20 : 18));
    return htmlSymbol(kind === 'air' ? airSvg() : busSvg(tick), {
      size,
      selected,
      heading: headingDeg(props),
      cls: `sym-moving is-${kind} is-${freshnessState(props)}${selected ? ' is-selected' : ''}`
    });
  }
  if (cls === 'facility') {
    const kind = {
      pdq: 'police',
      fire: 'fire',
      hospitals: 'hospital',
      bixi: 'capacity',
      'traffic-cameras': 'camera'
    }[layerId] || 'generic';
    const close = zoom >= OPERATIONAL_ZOOM;
    const size = selected ? 28 : ({
      fire: close ? 20 : 18,
      police: close ? 18 : 16,
      hospital: close ? 18 : 16,
      camera: close ? 18 : 15,
      capacity: close ? 16 : 14,
      generic: 18
    }[kind] || 18);
    const markup = {
      camera: cameraSvg(),
      capacity: bikeSvg(),
      fire: fireStationSvg(),
      police: policeSvg(),
      hospital: hospitalSvg()
    }[kind] || policeSvg();
    return htmlSymbol(markup, { size, selected, cls: `sym-facility is-${kind}${selected ? ' is-selected' : ''}` });
  }
  if (cls === 'event') {
    const rank = recencyRank(props);
    const variant = layerId === 'fire-interventions' ? 'fire' : (layerId === 'civic-311' ? 'civic' : 'crime');
    const size = selected ? 22 : (variant === 'fire' ? 16 + rank : 13 + rank * 2);
    const markup = variant === 'fire' ? fireEventSvg() : (variant === 'civic' ? civicSvg() : crimeSvg(crimeKind(props)));
    return htmlSymbol(markup, { size, selected, cls: `sym-event is-${variant} rank-${rank}${selected ? ' is-selected' : ''}` });
  }
  if (cls === 'environment') {
    if (layerId === 'sun-daylight') {
      return htmlSymbol(envMark(layerId, props), {
        size: selected ? 16 : 11,
        selected,
        cls: `sym-sun${selected ? ' is-selected' : ''}`
      });
    }
    const iqa = Number(props.iqa);
    const band = !Number.isFinite(iqa) ? 'unknown' : (iqa <= 25 ? 'good' : (iqa <= 50 ? 'ok' : 'poor'));
    return htmlSymbol(envMark(layerId, props), {
      size: selected ? 22 : (layerId === 'air-quality' ? 20 : 16),
      selected,
      cls: `sym-env is-${layerId} band-${band}${selected ? ' is-selected' : ''}`
    });
  }
  if (cls === 'wildfire') {
    const variant = layerId === 'wildfire-hotspots' ? 'hotspot' : (layerId === 'wildfire-fwi' ? 'fwi' : 'active');
    const size = selected ? (variant === 'active' ? 22 : 16) : (variant === 'active' ? 16 : 11);
    const stage = variant === 'active' && props.stage ? ` stage-${String(props.stage).toUpperCase()}` : '';
    return htmlSymbol(wildfireMark(layerId), {
      size,
      selected,
      cls: `sym-wildfire is-${variant}${stage}${selected ? ' is-selected' : ''}`
    });
  }
  if (cls === 'historical') {
    return {
      kind: 'circle',
      radius: selected ? 5 : 2.2,
      fill: VISUAL.historical.hue,
      fillOpacity: selected ? 0.85 : 0.28,
      stroke: VISUAL.historical.hue,
      strokeWidth: selected ? 2 : 0
    };
  }
  if (layerId === 'road-works') {
    return {
      kind: 'circle',
      radius: selected ? 6 : 3.2,
      fill: VISUAL.affected.hue,
      fillOpacity: selected ? 0.95 : 0.7,
      stroke: '#1c1810',
      strokeWidth: selected ? 2 : 0.6
    };
  }
  if (layerId === 'hydro') {
    return {
      kind: 'circle',
      radius: selected ? 6 : 4,
      fill: VISUAL.affected.hue,
      fillOpacity: 0.9,
      stroke: '#1c1810',
      strokeWidth: selected ? 2 : 1
    };
  }
  return {
    kind: 'circle',
    radius: selected ? 6 : 4,
    fill: VISUAL.facility.hue,
    fillOpacity: 0.8,
    stroke: selected ? '#e8edf2' : VISUAL.facility.hue,
    strokeWidth: selected ? 2 : 1
  };
}

export function clusterSymbol(kind, count) {
  return {
    kind: 'html',
    size: 26,
    html: `<span class="sym-cluster is-${kind}">${Number(count) || 0}</span>`
  };
}

export function featureLabel(layerId, props = {}) {
  if (layerId === 'stm') return props.routeId ? String(props.routeId) : null;
  if (layerId === 'aircraft') return props.callsign || props.registration || null;
  return props.name || null;
}

export function isInteractiveFeature(layerId, feature) {
  if (layerId !== 'sun-daylight') return true;
  return feature?.properties?.sunKind === 'subsolar';
}

export function pathStyle(layerId, feature, { selected = false, emphasize = null } = {}) {
  const cls = visualClass(layerId);
  const geom = feature?.geometry?.type;
  const props = feature?.properties || {};
  const sunKind = props.sunKind;
  const hydroArea = props.hydroKind === 'area';
  const weatherAlert = props.weatherKind === 'alert';
  const wildfireArea = layerId === 'wildfire-perimeters'
    || (cls === 'wildfire' && (geom === 'Polygon' || geom === 'MultiPolygon'));
  const sunOn = (kind) => !emphasize || emphasize === kind;
  if (layerId === 'sun-daylight' && /-fill$/.test(String(sunKind)) || (layerId === 'sun-daylight' && sunKind === 'night')) {
    const kind = sunKind === 'civil-fill' ? 'CIVIL' : (sunKind === 'nautical-fill' ? 'NAUTICAL' : (sunKind === 'astronomical-fill' ? 'ASTRONOMICAL' : 'NIGHT'));
    const fill = sunKind === 'civil-fill' ? SOLAR.civil : (sunKind === 'nautical-fill' ? SOLAR.nautical : (sunKind === 'astronomical-fill' ? SOLAR.astronomical : SOLAR.night));
    const normal = sunKind === 'night' ? 0.22 : (sunKind === 'civil-fill' ? 0.07 : (sunKind === 'nautical-fill' ? 0.06 : 0.08));
    return { color: fill, weight: 0, fillColor: fill, fillOpacity: sunOn(kind) ? (emphasize === kind ? normal + 0.09 : normal) : 0.02, interactive: false };
  }
  if (layerId === 'sun-daylight' && (sunKind === 'terminator-casing' || sunKind === 'terminator-halo')) {
    return { color: SOLAR.casing, weight: (!emphasize || emphasize === 'DAYLIGHT' || emphasize === 'NIGHT') ? 7.5 : 5.5, opacity: 0.88, fill: false, interactive: false };
  }
  if (layerId === 'sun-daylight' && sunKind === 'terminator') {
    const strong = !emphasize || emphasize === 'DAYLIGHT' || emphasize === 'NIGHT';
    return { color: SOLAR.terminator, weight: strong ? 2.55 : 1.35, opacity: strong ? 1 : 0.42, fill: false, interactive: false };
  }
  if (layerId === 'sun-daylight' && /-(casing|line)$/.test(String(sunKind))) {
    const kind = sunKind.startsWith('civil') ? 'CIVIL' : (sunKind.startsWith('nautical') ? 'NAUTICAL' : 'ASTRONOMICAL');
    const casing = sunKind.endsWith('casing');
    const color = casing ? SOLAR.casing : (kind === 'CIVIL' ? SOLAR.civil : (kind === 'NAUTICAL' ? SOLAR.nautical : SOLAR.astronomical));
    const dash = kind === 'NAUTICAL' ? '6 5' : (kind === 'ASTRONOMICAL' ? '2 6' : null);
    const on = sunOn(kind);
    return {
      color,
      weight: casing ? (emphasize === kind ? 4 : 2.8) : (emphasize === kind ? 2 : 1.2),
      opacity: on ? (casing ? 0.7 : 0.95) : 0.15,
      dashArray: dash,
      fill: false,
      interactive: false
    };
  }
  if (cls === 'territory') {
    return {
      color: selected ? '#c5cdd4' : VISUAL.territory.hue,
      weight: selected ? 1.8 : 1.05,
      dashArray: '5 4',
      fillColor: VISUAL.territory.hue,
      fillOpacity: selected ? 0.05 : 0.018
    };
  }
  if (hydroArea || (cls === 'affected' && (geom === 'Polygon' || geom === 'MultiPolygon'))) {
    return {
      color: selected ? '#e4d08a' : VISUAL.affected.hue,
      weight: selected ? 2.6 : 1.2,
      fillColor: VISUAL.affected.hue,
      fillOpacity: selected ? 0.22 : 0.12
    };
  }
  if (wildfireArea) {
    return {
      color: selected ? '#f7f2e8' : '#2a1810',
      weight: selected ? 2.4 : 1.5,
      fillColor: '#c2410c',
      fillOpacity: selected ? 0.2 : 0.11,
      className: 'wildfire-perimeter'
    };
  }
  if (geom === 'LineString' || geom === 'MultiLineString') {
    return { color: VISUAL.affected.hue, weight: selected ? 3.2 : 2.2, opacity: selected ? 1 : 0.85, fill: false };
  }
  if (weatherAlert) {
    return {
      color: VISUAL.environment.hue,
      weight: selected ? 2 : 1,
      dashArray: '4 3',
      fillColor: VISUAL.environment.hue,
      fillOpacity: selected ? 0.16 : 0.08
    };
  }
  return { color: VISUAL.facility.hue, weight: 1, fillColor: VISUAL.facility.hue, fillOpacity: 0.08 };
}

export function hexToRgb(hex, alpha = 1) {
  const raw = String(hex || '#9aa8b5').replace('#', '');
  const n = parseInt(raw.length === 3 ? raw.split('').map((c) => c + c).join('') : raw, 16);
  if (!Number.isFinite(n)) return [154, 168, 181, alpha];
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255, alpha];
}

export function pointRenderer(layerId, color) {
  return {
    type: 'simple',
    symbol: {
      type: 'simple-marker',
      style: markerStyleFor(layerId),
      color: hexToRgb(color, 0.92),
      size: visualClass(layerId) === 'aircraft' ? 9 : 8,
      outline: { color: [244, 240, 234, 0.85], width: 0.8 }
    }
  };
}

export function fillRenderer(layerId, color) {
  return {
    type: 'simple',
    symbol: {
      type: 'simple-fill',
      color: hexToRgb(color, visualClass(layerId) === 'affected' ? 0.28 : 0.18),
      outline: { color: hexToRgb(color, 0.9), width: 1.2 }
    }
  };
}

export function lineRenderer(color) {
  return {
    type: 'simple',
    symbol: { type: 'simple-line', color: hexToRgb(color, 0.9), width: 2 }
  };
}
