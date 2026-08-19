/**
 * Recent SPVM reports filter — Intelligence Lab lab-spvm-filters.js calendar-day windows.
 * SPVM publishes DATE + QUART only. Clock-hour windows are not supported.
 */

export const CRIME_WINDOWS = {
  '1d': { days: 1, label: 'LATEST DAY' },
  '3d': { days: 3, label: 'LAST 3 DAYS' },
  '7d': { days: 7, label: 'LAST 7 DAYS' },
  '30d': { days: 30, label: 'LAST 30 DAYS' },
  '90d': { days: 90, label: 'LAST 90 DAYS' },
  '24h': { days: 1, label: 'LATEST DAY' }
};

export const UNSUPPORTED_CLOCK_WINDOWS = ['1h', '6h', '12h'];

export const SPVM_SOURCE_CATEGORIES = [
  { french: 'Vol de véhicule à moteur', english: 'Vehicle theft' },
  { french: 'Vol dans / sur véhicule à moteur', english: 'Theft from vehicle' },
  { french: 'Introduction', english: 'Break and enter' },
  { french: 'Méfait', english: 'Mischief' },
  { french: 'Vols qualifiés', english: 'Robbery / qualified theft' },
  { french: 'Infractions entrainant la mort', english: 'Death-related offence' }
];

export function montrealTodayYmd(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Toronto',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(now);
}

export function subtractDaysYmd(ymd, days) {
  const [y, m, d] = String(ymd).split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

export function maxSpvmDate(geojson) {
  let max = '';
  for (const feature of geojson?.features || []) {
    const d = String(feature.properties?.date || feature.properties?.DATE || '').slice(0, 10);
    if (d > max) max = d;
  }
  return max;
}

export function recentFilterToday(geojson, todayYmd = montrealTodayYmd()) {
  const maxDate = maxSpvmDate(geojson);
  if (!maxDate) return todayYmd;
  return maxDate < todayYmd ? maxDate : todayYmd;
}

export function normalizeCrimeWindow(windowId) {
  const key = String(windowId || '1d').toLowerCase();
  if (key === '24h') return '1d';
  return CRIME_WINDOWS[key] ? key : null;
}

export function windowBoundsForRecent(geojson, windowId = '1d', todayYmd = montrealTodayYmd()) {
  const normalized = normalizeCrimeWindow(windowId);
  const spec = normalized ? CRIME_WINDOWS[normalized] : null;
  if (!spec) return null;
  const asOf = recentFilterToday(geojson, todayYmd);
  return {
    windowId: normalized,
    windowDays: spec.days,
    label: spec.label,
    asOf,
    start: subtractDaysYmd(asOf, spec.days - 1),
    end: asOf
  };
}

export function filterRecentSpvmFeatures(geojson, windowId = '1d', category = null, todayYmd = montrealTodayYmd()) {
  const bounds = windowBoundsForRecent(geojson, windowId, todayYmd);
  if (!bounds || !geojson?.features) {
    return { bounds, features: [], categories: [] };
  }
  const wanted = category && category !== 'all' ? String(category) : null;
  const counts = new Map();
  const features = [];
  for (const feature of geojson.features) {
    const props = feature.properties || {};
    const date = String(props.date || props.DATE || '').slice(0, 10);
    if (!date) continue;
    if (date < bounds.start || date > bounds.end) continue;
    const cat = String(props.category || props.CATEGORIE || '').trim();
    if (cat) counts.set(cat, (counts.get(cat) || 0) + 1);
    if (wanted && cat !== wanted) continue;
    features.push(feature);
  }
  const categories = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([french, count]) => {
      const known = SPVM_SOURCE_CATEGORIES.find((row) => row.french === french);
      return { french, english: known?.english || null, count };
    });
  return { bounds, features, categories };
}

export function countInDateRange(geojson, start, end, category = null) {
  const wanted = category && category !== 'all' ? String(category) : null;
  let n = 0;
  for (const feature of geojson?.features || []) {
    const props = feature.properties || {};
    const date = String(props.date || props.DATE || '').slice(0, 10);
    if (!date || date < start || date > end) continue;
    const cat = String(props.category || props.CATEGORIE || '').trim();
    if (wanted && cat !== wanted) continue;
    n += 1;
  }
  return n;
}

export function minSpvmDate(geojson) {
  let min = '';
  for (const feature of geojson?.features || []) {
    const d = String(feature.properties?.date || feature.properties?.DATE || '').slice(0, 10);
    if (!d) continue;
    if (!min || d < min) min = d;
  }
  return min || null;
}

export function previousWindowFor(bounds) {
  if (!bounds?.start || !bounds.windowDays) return null;
  const end = subtractDaysYmd(bounds.start, 1);
  const start = subtractDaysYmd(end, bounds.windowDays - 1);
  return { start, end, days: bounds.windowDays };
}

export function crimeStatusForWindow(windowId) {
  const normalized = normalizeCrimeWindow(windowId);
  if (normalized === '1d' || normalized === '3d') return 'RECENT';
  return 'HISTORICAL';
}
