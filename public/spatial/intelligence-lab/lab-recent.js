/**
 * Recent SPVM reports filter for intelligence lab (reuses /api/spatial/spvm/crime-90d).
 */

const THEFT_CATEGORIES = new Set([
  'Vol de véhicule à moteur',
  'Vol dans / sur véhicule à moteur'
]);

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

/**
 * @param {'off'|'24h'|'72h'} mode
 * @param {string} selectedCategory
 */
export function filterRecentSpvmFeatures(geojson, mode, selectedCategory, todayYmd = montrealTodayYmd()) {
  if (mode === 'off' || !geojson?.features) return [];
  const windowDays = mode === '24h' ? 1 : 3;
  const start = subtractDaysYmd(todayYmd, windowDays - 1);
  const cats = categoriesForRecentFilter(selectedCategory);

  return geojson.features.filter((f) => {
    const p = f.properties || {};
    const date = String(p.date || '');
    if (!date || date < start || date > todayYmd) return false;
    return cats.has(String(p.category || ''));
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

export const RECENT_LAYER_STYLE = {
  color: [220, 38, 38, 0.92],
  outline: [255, 255, 255, 0.95],
  size: 7,
  caveat: 'SPVM published location — privacy-displaced to intersection. Not an exact occurrence location.'
};
