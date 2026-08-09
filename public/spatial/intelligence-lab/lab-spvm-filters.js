/**
 * SPVM recent report filtering — reuses /api/spatial/spvm/crime-90d.
 */

const THEFT_CATEGORIES = new Set([
  'Vol de véhicule à moteur',
  'Vol dans / sur véhicule à moteur'
]);

const SHIFT_MAP = {
  all: new Set(['jour', 'soir', 'nuit']),
  day: new Set(['jour']),
  evening: new Set(['soir']),
  night: new Set(['nuit'])
};

const WINDOW_DAYS = { '24h': 1, '72h': 3, '7d': 7, '30d': 30 };

export function montrealTodayYmd(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Toronto',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(now);
}

function subtractDaysYmd(ymd, days) {
  const [y, m, d] = String(ymd).split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

export function categoriesForRecentFilter(selectedCategory) {
  if (THEFT_CATEGORIES.has(selectedCategory)) return THEFT_CATEGORIES;
  return new Set([selectedCategory]);
}

export function normalizeSpvmFeature(feature, index = 0) {
  const p = feature.properties || {};
  const shift = String(p.shift || p.QUART || p.quart || '').toLowerCase();
  const category = String(p.category || p.CATEGORIE || '');
  const date = String(p.date || p.DATE || '').slice(0, 10);
  const pdq = p.pdq ?? p.PDQ ?? null;
  const coords = feature.geometry?.coordinates || [];
  const lng = p.longitude ?? p.LONGITUDE ?? coords[0];
  const lat = p.latitude ?? p.LATITUDE ?? coords[1];
  const key = `${date}|${category}|${shift}|${pdq}|${lng}|${lat}|${index}`;

  return {
    ...feature,
    properties: {
      ...p,
      recordKey: key,
      category,
      date,
      shift,
      shiftLabel: shiftLabel(shift),
      pdq: pdq != null ? String(pdq) : '',
      sourceName: p.sourceName || 'SPVM open data',
      dataset: p.dataset || 'Actes criminels',
      spatialPrecision: 'SPVM published location — privacy-displaced',
      raw: {
        CATEGORIE: p.CATEGORIE || category,
        DATE: p.DATE || date,
        QUART: p.QUART || shift,
        PDQ: p.PDQ ?? pdq,
        X: p.X ?? null,
        Y: p.Y ?? null,
        LONGITUDE: p.LONGITUDE ?? lng,
        LATITUDE: p.LATITUDE ?? lat
      }
    }
  };
}

function shiftLabel(shift) {
  if (shift === 'jour') return 'Day';
  if (shift === 'soir') return 'Evening';
  if (shift === 'nuit') return 'Night';
  return shift || '—';
}

export function maxSpvmDate(geojson) {
  let max = '';
  for (const f of geojson?.features || []) {
    const d = String(f.properties?.date || f.properties?.DATE || '').slice(0, 10);
    if (d > max) max = d;
  }
  return max || montrealTodayYmd();
}

export function recentFilterToday(geojson, todayYmd = montrealTodayYmd()) {
  const maxDate = maxSpvmDate(geojson);
  return maxDate < todayYmd ? maxDate : todayYmd;
}

export function minSpvmDate(geojson) {
  let min = '';
  for (const f of geojson?.features || []) {
    const d = String(f.properties?.date || f.properties?.DATE || '').slice(0, 10);
    if (d && (!min || d < min)) min = d;
  }
  return min;
}

/**
 * Base filter (category, shift, area) — no date window.
 */
export function applyBaseSpvmFilters(features, filters) {
  const cats = filters.allCategories
    ? null
    : categoriesForRecentFilter(filters.crimeCategory);
  const shifts = SHIFT_MAP[filters.shift] || SHIFT_MAP.all;

  return features.filter((f) => {
    const p = f.properties;
    if (cats && !cats.has(p.category)) return false;
    if (!shifts.has(p.shift)) return false;
    const coords = f.geometry?.coordinates;
    if (!coords || coords.length < 2) return false;
    if (filters.areaType === 'pdq' && filters.areaId && filters.pdqMembers?.size) {
      if (!filters.pdqMembers.has(String(p.pdq))) return false;
    }
    if (filters.areaType === 'arrondissement' && filters.pointInArea) {
      if (!filters.pointInArea(coords[0], coords[1])) return false;
    }
    return true;
  });
}

/**
 * Daily published-report counts for a calendar month (report DATE field).
 * @returns {Record<string, number>}
 */
export function dailyCountsForMonth(geojson, filters, monthYm) {
  if (!geojson?.features || !monthYm) return {};
  const [y, m] = monthYm.split('-').map(Number);
  const prefix = `${y}-${String(m).padStart(2, '0')}-`;
  const normalized = geojson.features.map((f, i) => normalizeSpvmFeature(f, i));
  const base = applyBaseSpvmFilters(normalized, filters);
  const counts = {};
  for (const f of base) {
    const d = f.properties.date;
    if (!d?.startsWith(prefix)) continue;
    counts[d] = (counts[d] || 0) + 1;
  }
  return counts;
}

export function aggregateByShift(features) {
  const counts = { jour: 0, soir: 0, nuit: 0 };
  for (const f of features) {
    const sh = f.properties.shift || 'jour';
    counts[sh] = (counts[sh] || 0) + 1;
  }
  return counts;
}

/**
 * @param {object} geojson
 * @param {{ timeWindow: string, reportDate?: string|null, crimeCategory: string, shift: string, areaType: string, areaId: string|null, pdqMembers?: Set<string>, pointInArea?: (lng: number, lat: number) => boolean, allCategories?: boolean }} filters
 */
export function filterSpvmFeatures(geojson, filters, todayYmd = montrealTodayYmd()) {
  if (!geojson?.features) return [];
  if (filters.timeWindow === 'off' && !filters.reportDate) return [];

  const cats = filters.allCategories
    ? null
    : categoriesForRecentFilter(filters.crimeCategory);
  const shifts = SHIFT_MAP[filters.shift] || SHIFT_MAP.all;

  let start = null;
  let end = null;

  if (filters.reportDate) {
    start = filters.reportDate;
    end = filters.reportDate;
  } else {
    const windowDays = WINDOW_DAYS[filters.timeWindow];
    if (!windowDays) return [];
    const asOf = recentFilterToday(geojson, todayYmd);
    start = subtractDaysYmd(asOf, windowDays - 1);
    end = asOf;
  }

  return geojson.features
    .map((f, i) => normalizeSpvmFeature(f, i))
    .filter((f) => {
      const p = f.properties;
      const date = p.date;
      if (!date || date < start || date > end) return false;
      if (cats && !cats.has(p.category)) return false;
      if (!shifts.has(p.shift)) return false;

      const coords = f.geometry?.coordinates;
      if (!coords || coords.length < 2) return false;

      if (filters.areaType === 'pdq' && filters.areaId) {
        const members = filters.pdqMembers;
        if (members?.size) {
          if (!members.has(String(p.pdq))) return false;
        }
      }

      if (filters.areaType === 'arrondissement' && filters.pointInArea) {
        if (!filters.pointInArea(coords[0], coords[1])) return false;
      }

      return true;
    });
}

let spvmCache = null;
let spvmCacheAt = 0;

export async function fetchSpvmGeojsonForLab() {
  const now = Date.now();
  if (spvmCache && now - spvmCacheAt < 5 * 60 * 1000) return spvmCache;
  const res = await fetch('/api/spatial/spvm/crime-90d');
  if (!res.ok) throw new Error('SPVM recent reports unavailable');
  spvmCache = await res.json();
  spvmCacheAt = now;
  return spvmCache;
}

/** @deprecated use filterSpvmFeatures */
export function filterRecentSpvmFeatures(geojson, mode, selectedCategory, todayYmd) {
  return filterSpvmFeatures(geojson, {
    timeWindow: mode,
    crimeCategory: selectedCategory,
    shift: 'all',
    areaType: 'all',
    areaId: null
  }, todayYmd);
}

export const RECENT_LAYER_STYLE = {
  color: [220, 38, 38, 0.92],
  outline: [255, 255, 255, 0.95],
  size: 7,
  caveat: 'SPVM published location — privacy-displaced. Not an exact occurrence location.'
};

export function aggregateByCategory(features) {
  const counts = {};
  for (const f of features) {
    const c = f.properties.category;
    counts[c] = (counts[c] || 0) + 1;
  }
  return counts;
}

export function dominantCategory(counts) {
  let best = null;
  let max = 0;
  for (const [cat, n] of Object.entries(counts)) {
    if (n > max) { max = n; best = cat; }
  }
  return best;
}
