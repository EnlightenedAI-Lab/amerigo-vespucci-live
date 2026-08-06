function formatDirection(deg) {
  if (deg === null || deg === undefined || deg === '') return null;
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  const idx = Math.round(Number(deg) / 45) % 8;
  return `${Number(deg)}° ${dirs[idx]}`;
}

function formatTime(iso) {
  if (!iso) return null;
  try { return new Date(iso).toLocaleString(); } catch { return iso; }
}

function infoRow(label, value, tooltip = '') {
  if (value === null || value === undefined || value === '') return '';
  const tip = tooltip ? ` title="${tooltip}"` : '';
  return `<div class="info-row"><span class="info-label"${tip}>${label}</span><span class="info-value">${value}</span></div>`;
}

function emptyCard(msg) {
  return `<p class="empty-state">${msg}</p>`;
}

export function renderVesselInfo(vessel) {
  if (!vessel || vessel.empty) return emptyCard('No vessel position available.');
  const p = vessel.properties || {};
  const freshness = vessel.freshness || 'unknown';
  return [
    infoRow('Vessel', p.VesselName || 'Amerigo Vespucci'),
    infoRow('MMSI', p.MMSI),
    infoRow('Speed', p.SpeedKnots != null ? `${p.SpeedKnots} kn` : null, 'Speed over ground from AIS'),
    infoRow('Course', p.Course != null ? `${p.Course}°` : null, 'Direction of movement over ground'),
    infoRow('Heading', p.Heading != null ? `${p.Heading}°` : null, 'Bow orientation'),
    infoRow('Navigation', p.NavStatus),
    infoRow('Last verified', formatTime(p.LastAIS), 'Last AIS position report'),
    infoRow('Source', vessel.source),
    infoRow('Freshness', `<span class="freshness-badge ${freshness}">${freshness}</span>`, 'Based on age of last AIS report'),
    vessel.ageSeconds != null ? infoRow('Age', `${vessel.ageSeconds}s`) : ''
  ].filter(Boolean).join('');
}

export function renderWeatherInfo(conditions) {
  if (!conditions || conditions.empty) return emptyCard('No weather data.');
  const p = conditions.properties || {};
  const rows = [
    infoRow('Air temperature', p.AirTempC != null ? `${p.AirTempC} °C` : null),
    infoRow('Condition', p.WeatherText),
    infoRow('Wind', p.WindKnots != null ? `${p.WindKnots} kn from ${formatDirection(p.WindFromDeg) || '—'}` : null),
    infoRow('Gusts', p.GustKnots != null ? `${p.GustKnots} kn` : null),
    infoRow('Visibility', p.VisibilityKM != null ? `${p.VisibilityKM} km` : null),
    infoRow('Pressure', p.PressureHPA != null ? `${p.PressureHPA} hPa` : null)
  ].filter(Boolean);
  return rows.length ? rows.join('') : emptyCard('No weather values available.');
}

export function renderSeaStateInfo(conditions) {
  if (!conditions || conditions.empty) return emptyCard('No sea state data.');
  const p = conditions.properties || {};
  const rows = [
    infoRow('Wave height', p.WaveHeightM != null ? `${p.WaveHeightM} m` : null),
    infoRow('Wave direction', formatDirection(p.WaveFromDeg)),
    infoRow('Wave period', p.WavePeriodS != null ? `${p.WavePeriodS} s` : null),
    infoRow('Swell', p.SwellHeightM != null ? `${p.SwellHeightM} m from ${formatDirection(p.SwellFromDeg) || '—'}, ${p.SwellPeriodS || '—'} s` : null),
    infoRow('Sea temperature', p.SeaTempC != null ? `${p.SeaTempC} °C` : null)
  ].filter(Boolean);
  return rows.length ? rows.join('') : emptyCard('No sea state values available.');
}

export function renderCurrentInfo(conditions) {
  if (!conditions || conditions.empty) return emptyCard('No current data.');
  const p = conditions.properties || {};
  if (p.CurrentKnots == null) return emptyCard('No current data.');
  return [
    infoRow('Speed', `${p.CurrentKnots} kn`, 'Ocean current speed'),
    infoRow('Direction', formatDirection(p.CurrentToDeg), 'Direction current flows toward')
  ].join('');
}

export function renderVoyageInfo(data) {
  const dest = data.destination;
  const travelled = data.travelledRoute;
  const estimated = data.estimatedRoute;
  const parts = [];

  if (dest && !dest.empty && dest.properties) {
    parts.push(infoRow('Destination', dest.properties.DestinationName || dest.properties.PortCode));
  }
  if (travelled && !travelled.empty) {
    parts.push(infoRow('Observed track', travelled.label || 'Observed AIS track', 'Built from stored AIS history points'));
    if (travelled.pointCount) parts.push(infoRow('Track points', String(travelled.pointCount)));
  }
  if (estimated && !estimated.empty) {
    if (estimated.distanceNM != null) parts.push(infoRow('Est. distance', `${Number(estimated.distanceNM).toFixed(1)} NM`, 'Straight-line geographic distance'));
    if (estimated.estimatedETA) parts.push(infoRow('Est. ETA', formatTime(estimated.estimatedETA), 'Based on current speed; not official'));
    parts.push(`<p class="info-note">${estimated.disclaimer || 'Straight-line estimate — not an official navigational route'}</p>`);
  }

  return parts.length ? parts.join('') : emptyCard('No voyage data available.');
}

export function renderForecastInfo(conditions) {
  if (!conditions || conditions.empty) return emptyCard('No forecast data.');
  const p = conditions.properties || {};
  const rows = [
    infoRow('Max wind (24h)', p.MaxWind24Kn != null ? `${p.MaxWind24Kn} kn` : null),
    infoRow('Max gust (24h)', p.MaxGust24Kn != null ? `${p.MaxGust24Kn} kn` : null),
    infoRow('Max wave (24h)', p.MaxWave24M != null ? `${p.MaxWave24M} m` : null),
    infoRow('Max swell (24h)', p.MaxSwell24M != null ? `${p.MaxSwell24M} m` : null),
    p.ForecastStart && p.ForecastEnd
      ? infoRow('Forecast period', `${formatTime(p.ForecastStart)} – ${formatTime(p.ForecastEnd)}`)
      : ''
  ].filter(Boolean);
  return rows.length ? rows.join('') : emptyCard('No forecast values available.');
}

export function renderAllInfoCards(data) {
  const vessel = data.vessel;
  const conditions = data.conditions;

  const vesselHtml = renderVesselInfo(vessel);
  const weatherHtml = renderWeatherInfo(conditions);
  const seaHtml = renderSeaStateInfo(conditions);
  const currentHtml = renderCurrentInfo(conditions);
  const voyageHtml = renderVoyageInfo(data);
  const forecastHtml = renderForecastInfo(conditions);

  const set = (id, html) => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = html;
  };

  set('info-vessel', vesselHtml);
  set('info-weather', weatherHtml);
  set('info-sea', seaHtml);
  set('info-current', currentHtml);
  set('info-voyage', voyageHtml);
  set('info-forecast', forecastHtml);

  const attr = document.getElementById('conditions-attribution');
  if (attr) attr.textContent = conditions?.attribution || '';

  updateMobileSheet(vesselHtml, weatherHtml, seaHtml, currentHtml, voyageHtml, forecastHtml);
}

function updateMobileSheet(vessel, weather, sea, current, voyage, forecast) {
  const tabs = {
    vessel: vessel,
    weather: weather + sea + current,
    voyage: voyage,
    forecast: forecast
  };
  const content = document.getElementById('mobile-sheet-content');
  const tabBar = document.getElementById('mobile-tabs');
  if (!content || !tabBar) return;

  function showTab(name) {
    content.innerHTML = tabs[name] || emptyCard('No data.');
    tabBar.querySelectorAll('.mobile-tab').forEach((t) => {
      t.classList.toggle('active', t.dataset.tab === name);
    });
  }

  tabBar.querySelectorAll('.mobile-tab').forEach((btn) => {
    btn.onclick = () => showTab(btn.dataset.tab);
  });
  showTab('vessel');
}
