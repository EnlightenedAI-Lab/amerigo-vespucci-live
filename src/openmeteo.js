import { logger } from './logger.js';

export const CONDITIONS_ATTRIBUTION = 'Weather and marine forecast data by Open-Meteo.com; normalized by Amerigo Vespucci Live.';
export const CONDITIONS_BASIS = 'Model-derived conditions at the nearest available forecast grid cell; not onboard observations and not for navigation.';
const KMH_TO_KN = 0.539956803;
const MS_TO_KN = 1.943844492;
const MPH_TO_KN = 0.868976242;

export function parseUtcTimestamp(value) {
  if (!value) return null;
  const text = String(value);
  const date = new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(text) ? text : `${text}Z`);
  return Number.isFinite(date.getTime()) ? date : null;
}
export function wmoWeatherText(code) {
  const c = Number(code);
  if (c === 0) return 'Clear';
  if (c === 1) return 'Mainly clear';
  if (c === 2) return 'Partly cloudy';
  if (c === 3) return 'Overcast';
  if ([45, 48].includes(c)) return 'Fog';
  if ((c >= 51 && c <= 57) || [80].includes(c)) return 'Drizzle';
  if ((c >= 61 && c <= 67) || (c >= 80 && c <= 82)) return 'Rain showers';
  if (c >= 71 && c <= 77) return 'Snow';
  if (c >= 85 && c <= 86) return 'Snow showers';
  if (c >= 95 && c <= 99) return 'Thunderstorm';
  return null;
}
export function finite(value) { if (value === null || value === undefined || value === '') return null; const n = Number(value); return Number.isFinite(n) ? n : null; }
export function metersToKm(value) { const n = finite(value); return n == null ? null : n / 1000; }
export function currentVelocityToKnots(value, unit) {
  const n = finite(value); if (n == null) return null;
  const u = String(unit || '').toLowerCase().replaceAll(' ', '');
  if (['kn', 'kt', 'kts', 'knots', 'knot'].includes(u)) return n;
  if (['km/h', 'kmh', 'kilometresperhour', 'kilometersperhour'].includes(u)) return n * KMH_TO_KN;
  if (['m/s', 'ms', 'mps', 'metrespersecond', 'meterspersecond'].includes(u)) return n * MS_TO_KN;
  if (['mph', 'mi/h', 'milesperhour'].includes(u)) return n * MPH_TO_KN;
  return n;
}
function includedIndices(times = [], start, hours) {
  const startMs = start?.getTime(); if (!Number.isFinite(startMs)) return [];
  const endMs = startMs + hours * 3600_000;
  return times.map((t, i) => [parseUtcTimestamp(t)?.getTime(), i]).filter(([ms]) => Number.isFinite(ms) && ms >= startMs && ms <= endMs).map(([, i]) => i);
}
function maxAt(values = [], indices, transform = finite) { const nums = indices.map((i) => transform(values[i])).filter((v) => v != null); return nums.length ? Math.max(...nums) : null; }
function minAt(values = [], indices, transform = finite) { const nums = indices.map((i) => transform(values[i])).filter((v) => v != null); return nums.length ? Math.min(...nums) : null; }
function sumAt(values = [], indices, transform = finite) { const nums = indices.map((i) => transform(values[i])).filter((v) => v != null); return nums.length ? nums.reduce((a, b) => a + b, 0) : null; }
function range(times = [], indices) { return { ForecastStart: indices.length ? parseUtcTimestamp(times[indices[0]])?.getTime() : null, ForecastEnd: indices.length ? parseUtcTimestamp(times[indices.at(-1)])?.getTime() : null }; }

export function parseWeatherResponse(data, forecastHours = 24) {
  const currentTime = parseUtcTimestamp(data?.current?.time); if (!currentTime) return { status: 'unavailable', attributes: {} };
  const c = data.current || {}; const h = data.hourly || {}; const idx = includedIndices(h.time, currentTime, forecastHours);
  const code = finite(c.weather_code);
  return { status: 'ok', validTime: currentTime, gridLatitude: finite(data.latitude), gridLongitude: finite(data.longitude), attributes: {
    WeatherAt: currentTime.getTime(), WxGridLat: finite(data.latitude), WxGridLon: finite(data.longitude), AirTempC: finite(c.temperature_2m), FeelsLikeC: finite(c.apparent_temperature), HumidityPct: finite(c.relative_humidity_2m), PrecipMM: finite(c.precipitation), WeatherCode: code, WeatherText: code == null ? null : wmoWeatherText(code), CloudPct: finite(c.cloud_cover), PressureHPA: finite(c.pressure_msl), VisibilityKM: metersToKm(c.visibility), WindKnots: finite(c.wind_speed_10m), WindFromDeg: finite(c.wind_direction_10m), GustKnots: finite(c.wind_gusts_10m), MaxWind24Kn: maxAt(h.wind_speed_10m, idx), MaxGust24Kn: maxAt(h.wind_gusts_10m, idx), MinVis24KM: minAt(h.visibility, idx, metersToKm), Precip24MM: sumAt(h.precipitation, idx), ...range(h.time, idx) } };
}
export function parseMarineResponse(data, forecastHours = 24) {
  const currentTime = parseUtcTimestamp(data?.current?.time); if (!currentTime) return { status: 'unavailable', attributes: {} };
  const c = data.current || {}; const h = data.hourly || {}; const currentUnit = data.current_units?.ocean_current_velocity || data.hourly_units?.ocean_current_velocity; const hourlyUnit = data.hourly_units?.ocean_current_velocity || currentUnit; const idx = includedIndices(h.time, currentTime, forecastHours);
  return { status: 'ok', validTime: currentTime, gridLatitude: finite(data.latitude), gridLongitude: finite(data.longitude), attributes: {
    MarineAt: currentTime.getTime(), SeaGridLat: finite(data.latitude), SeaGridLon: finite(data.longitude), WaveHeightM: finite(c.wave_height), WaveFromDeg: finite(c.wave_direction), WavePeriodS: finite(c.wave_period), WindWaveM: finite(c.wind_wave_height), WindWaveFrom: finite(c.wind_wave_direction), WindWaveSec: finite(c.wind_wave_period), SwellHeightM: finite(c.swell_wave_height), SwellFromDeg: finite(c.swell_wave_direction), SwellPeriodS: finite(c.swell_wave_period), SeaTempC: finite(c.sea_surface_temperature), CurrentKnots: currentVelocityToKnots(c.ocean_current_velocity, currentUnit), CurrentToDeg: finite(c.ocean_current_direction), SeaLevelM: finite(c.sea_level_height_msl), MaxWave24M: maxAt(h.wave_height, idx), MaxSwell24M: maxAt(h.swell_wave_height, idx), MaxCurrent24Kn: maxAt(h.ocean_current_velocity, idx, (v) => currentVelocityToKnots(v, hourlyUnit)), ...range(h.time, idx) } };
}

export class OpenMeteoClient {
  constructor(config, arcgis, state) { this.config = config; this.arcgis = arcgis; this.state = state; this.timer = null; this.inFlight = false; this.lastFetchAt = null; }
  start() { if (!this.config.enableConditions) return; this.timer = setInterval(() => this.refreshIfDue(), Math.max(30, this.config.openMeteoRefreshSeconds) * 1000); }
  stop() { if (this.timer) clearInterval(this.timer); }
  async onPosition() { if (!this.config.enableConditions) return; await this.refreshIfDue(true); }
  health() { const p = this.state.lastConditionsPosition; return { conditionsEnabled: this.config.enableConditions, lastConditionsAttempt: iso(this.state.lastConditionsAttempt), lastConditionsUpdate: iso(this.state.lastConditionsUpdate), lastWeatherValidTime: iso(this.state.lastWeatherValidTime), lastMarineValidTime: iso(this.state.lastMarineValidTime), weatherStatus: this.state.weatherStatus || null, marineStatus: this.state.marineStatus || null, conditionsLatitude: p?.latitude ?? null, conditionsLongitude: p?.longitude ?? null, conditionsPositionAIS: iso(p?.lastAIS), conditionsAgeSeconds: p?.lastAIS ? Math.floor((Date.now() - p.lastAIS.getTime()) / 1000) : null, nextConditionsRefresh: this.lastFetchAt ? new Date(this.lastFetchAt.getTime() + this.config.openMeteoRefreshSeconds * 1000).toISOString() : null }; }
  async refreshIfDue(immediate = false) { const now = Date.now(); if (this.inFlight) return { skipped: 'in-flight' }; if (!this.state.lastPosition) return { skipped: 'no-position' }; if (now - this.state.lastPosition.lastAIS.getTime() > this.config.openMeteoMaxPositionAgeSeconds * 1000) return { skipped: 'stale-position' }; if (this.lastFetchAt && now - this.lastFetchAt.getTime() < this.config.openMeteoRefreshSeconds * 1000) return { skipped: 'throttled' }; this.lastFetchAt = new Date(); return this.refresh(this.state.lastPosition); }
  async refresh(position) { this.inFlight = true; this.state.lastConditionsAttempt = new Date(); try { const [w, m] = await Promise.allSettled([this.fetchWeather(position), this.fetchMarine(position)]); const weather = w.status === 'fulfilled' ? parseWeatherResponse(w.value, this.config.openMeteoForecastHours) : { status: 'error', attributes: {} }; const marine = m.status === 'fulfilled' ? parseMarineResponse(m.value, this.config.openMeteoForecastHours) : { status: 'error', attributes: {} }; await this.arcgis.upsertConditions(position, weather, marine); this.state.weatherStatus = weather.status; this.state.marineStatus = marine.status; if (weather.validTime) this.state.lastWeatherValidTime = weather.validTime; if (marine.validTime) this.state.lastMarineValidTime = marine.validTime; this.state.lastConditionsUpdate = new Date(); this.state.lastConditionsPosition = position; } catch (error) { logger.warn('Optional Open-Meteo conditions update failed', { error: error.message }); } finally { this.inFlight = false; } }
  fetchWeather(p) { return this.fetchJson(this.config.openMeteoWeatherBaseUrl, p, ['temperature_2m','apparent_temperature','relative_humidity_2m','precipitation','weather_code','cloud_cover','pressure_msl','visibility','wind_speed_10m','wind_direction_10m','wind_gusts_10m'], ['precipitation','visibility','wind_speed_10m','wind_gusts_10m'], true); }
  fetchMarine(p) { return this.fetchJson(this.config.openMeteoMarineBaseUrl, p, ['wave_height','wave_direction','wave_period','wind_wave_height','wind_wave_direction','wind_wave_period','swell_wave_height','swell_wave_direction','swell_wave_period','sea_surface_temperature','ocean_current_velocity','ocean_current_direction','sea_level_height_msl'], ['wave_height','swell_wave_height','ocean_current_velocity'], false); }
  async fetchJson(base, p, current, hourly, weather) { const ac = new AbortController(); const timeout = setTimeout(() => ac.abort(), this.config.openMeteoRequestTimeoutSeconds * 1000); const url = new URL(base); Object.entries({ latitude: p.latitude, longitude: p.longitude, timezone: 'GMT', cell_selection: 'sea', forecast_hours: this.config.openMeteoForecastHours, current: current.join(','), hourly: hourly.join(',') }).forEach(([k, v]) => url.searchParams.set(k, v)); if (weather) url.searchParams.set('wind_speed_unit', 'kn'); if (this.config.openMeteoApiKey) url.searchParams.set('apikey', this.config.openMeteoApiKey); try { const res = await fetch(url, { signal: ac.signal }); if (!res.ok) throw new Error(`Open-Meteo HTTP ${res.status}`); return await res.json(); } finally { clearTimeout(timeout); } }
}
function iso(d) { return d instanceof Date ? d.toISOString() : null; }
