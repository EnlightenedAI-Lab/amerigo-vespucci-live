const DWELL_MS = 480;
const CACHE_DECIMALS = 4;

const cache = new Map();
let timer = null;
let lastKey = '';
let generation = 0;

export const CURSOR_DWELL_MS = DWELL_MS;

function cacheKey(latitude, longitude) {
  return `${Number(latitude).toFixed(CACHE_DECIMALS)},${Number(longitude).toFixed(CACHE_DECIMALS)}`;
}

export function cancelDwell() {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
}

async function fetchJson(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(7000) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

export async function resolveContext(latitude, longitude) {
  const key = cacheKey(latitude, longitude);
  if (cache.has(key)) return cache.get(key);
  const [placePack, elevPack] = await Promise.allSettled([
    fetchJson(`/api/reverse?lat=${encodeURIComponent(latitude)}&lon=${encodeURIComponent(longitude)}`),
    fetchJson(`/api/elevation?lat=${encodeURIComponent(latitude)}&lon=${encodeURIComponent(longitude)}`)
  ]);
  const resolved = {
    latitude: Number(latitude),
    longitude: Number(longitude),
    place: placePack.status === 'fulfilled' ? (placePack.value.place || null) : null,
    placeSource: placePack.status === 'fulfilled' ? (placePack.value.source || null) : null,
    elevationMeters: elevPack.status === 'fulfilled' && Number.isFinite(Number(elevPack.value.meters))
      ? Number(elevPack.value.meters)
      : null,
    elevationSource: elevPack.status === 'fulfilled' ? (elevPack.value.source || null) : null
  };
  cache.set(key, resolved);
  return resolved;
}

export function scheduleDwell(longitude, latitude, onResolved) {
  const key = cacheKey(latitude, longitude);
  if (cache.has(key)) {
    onResolved?.(cache.get(key));
    return;
  }
  if (key === lastKey && timer) return;
  lastKey = key;
  cancelDwell();
  const token = ++generation;
  timer = setTimeout(async () => {
    timer = null;
    try {
      const resolved = await resolveContext(latitude, longitude);
      if (token !== generation) return;
      onResolved?.(resolved);
    } catch {
      if (token !== generation) return;
      onResolved?.(null);
    }
  }, DWELL_MS);
}

export function primeContext(latitude, longitude, value) {
  cache.set(cacheKey(latitude, longitude), value);
}
