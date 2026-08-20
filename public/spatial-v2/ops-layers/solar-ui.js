/**
 * Solar Intelligence V4.1 operator experience adapted from the canonical :8793
 * donor. It drives the existing operational-layer controller and retained
 * ArcGIS MapView; it does not create a map or a competing selection system.
 */
import {
  refreshSolar,
  setSolarArea,
  setSolarEmphasis,
  setSolarInstant,
  snapshot,
  subscribeOpsLayers
} from './controller.js';
import { getMapView, subscribeMapFoundation } from '../map/map-foundation.js';

const TZ = 'America/Toronto';
const MONTREAL = { latitude: 45.5088, longitude: -73.5617, zoom: 11 };
const POP_ROWS = [
  ['DAYLIGHT', 'daylightPopulation', 'DAYLIGHT', 'daylight'],
  ['CIVIL', 'civilPopulation', 'CIVIL TWILIGHT', 'civil'],
  ['NAUTICAL', 'nauticalPopulation', 'NAUTICAL TWILIGHT', 'nautical'],
  ['ASTRONOMICAL', 'astronomicalPopulation', 'ASTRONOMICAL TWILIGHT', 'astronomical'],
  ['NIGHT', 'nightPopulation', 'NIGHT', 'night']
];

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value == null || value === false) continue;
    if (key === 'text') node.textContent = value;
    else if (key === 'class') node.className = value;
    else if (key === 'hidden' || key === 'disabled') node[key] = Boolean(value);
    else node.setAttribute(key, value);
  }
  for (const child of [].concat(children)) if (child) node.append(child);
  return node;
}

function fmtCount(value) {
  return Number.isFinite(Number(value)) ? Number(value).toLocaleString('en-CA') : '—';
}

function fmtDuration(ms) {
  if (!Number.isFinite(ms) || ms < 0) return '—';
  const total = Math.round(ms / 60000);
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  return hours ? `${hours}H ${String(minutes).padStart(2, '0')}M` : `${minutes}M`;
}

function localMinutes(date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).formatToParts(date);
  return Number(parts.find((part) => part.type === 'hour')?.value || 0) * 60
    + Number(parts.find((part) => part.type === 'minute')?.value || 0);
}

function dateFromLocalMinutes(base, minutes) {
  const current = localMinutes(base);
  return new Date(base.getTime() + (Number(minutes) - current) * 60000);
}

function compass8(bearing) {
  const labels = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  return labels[Math.round((((Number(bearing) % 360) + 360) % 360) / 45) % 8];
}

function humanState(sun) {
  return {
    DAYLIGHT: 'DAYLIGHT',
    CIVIL: 'CIVIL TWILIGHT',
    NAUTICAL: 'NAUTICAL TWILIGHT',
    ASTRONOMICAL: 'ASTRONOMICAL TWILIGHT',
    NIGHT: 'NIGHT'
  }[sun?.illuminationState || sun?.phase] || sun?.illuminationState || sun?.phase || '—';
}

function clockPart(value) {
  return String(value || '').match(/(\d{2}:\d{2})/)?.[1] || '—';
}

function eventCountdown(sun, at) {
  const phase = sun?.illuminationState || sun?.phase;
  const sunset = Date.parse(sun?.sunsetUtc || '');
  const sunrise = Date.parse(sun?.sunriseUtc || '');
  if (phase === 'DAYLIGHT' && Number.isFinite(sunset) && sunset > at.getTime()) {
    return { label: 'UNTIL SUNSET', text: fmtDuration(sunset - at.getTime()), at: sunset };
  }
  if (phase !== 'DAYLIGHT' && Number.isFinite(sunrise) && sunrise > at.getTime()) {
    return { label: 'UNTIL SUNRISE', text: fmtDuration(sunrise - at.getTime()), at: sunrise };
  }
  const next = sun?.nextTransition;
  return next ? { label: `UNTIL ${next.kind}`, text: fmtDuration(Number(next.inMinutes) * 60000) } : { label: 'NEXT CHANGE', text: '—' };
}

function compassSvg(azimuth) {
  const rotation = Number.isFinite(Number(azimuth)) ? Number(azimuth) : 0;
  return `<svg class="solar-compass-face" viewBox="0 0 72 72" aria-hidden="true">
    <circle class="sc-ring" cx="36" cy="36" r="33"/>
    <circle class="sc-ring-inner" cx="36" cy="36" r="24"/>
    <path d="M36 4 V10 M36 62 V68 M4 36 H10 M62 36 H68" fill="none" stroke="currentColor"/>
    <text x="36" y="14" text-anchor="middle" fill="currentColor">N</text>
    <g transform="rotate(${rotation} 36 36)"><polygon class="sc-needle" points="36,10 39.2,36 36,39.5 32.8,36"/></g>
    <circle class="sc-hub" cx="36" cy="36" r="3.2"/>
  </svg>`;
}

function totalDark(population) {
  if (!population?.available) return 0;
  return (population.civilPopulation || 0)
    + (population.nauticalPopulation || 0)
    + (population.astronomicalPopulation || 0)
    + (population.nightPopulation || 0);
}

export function bindSolarIntelligence(root) {
  const hud = root?.querySelector('[data-iqai-solar-hud]');
  if (!hud) return null;
  let ui = 'simple';
  let page = 'home';
  let placePending = false;
  let place = null;
  let playTimer = null;
  let playUntil = null;
  let playSpeed = 1;
  let watchedView = null;
  let clickHandle = null;
  let moveHandle = null;
  let moveTimer = null;

  hud.replaceChildren(
    el('div', { class: 'solar-chrome' }, [
      el('div', { class: 'solar-brand', text: 'SOLAR INTELLIGENCE' }),
      el('div', { class: 'solar-live', id: 'solar-mode', text: 'LIVE / NOW' }),
      el('button', { type: 'button', class: 'ops-btn is-primary', id: 'solar-ui-simple', text: 'SIMPLE' }),
      el('button', { type: 'button', class: 'ops-btn', id: 'solar-ui-advanced', text: 'ADVANCED' })
    ]),
    el('div', { id: 'solar-simple' }, [
      el('div', { class: 'solar-ask', id: 'solar-ask', text: 'WHAT DO YOU WANT TO KNOW?' }),
      el('div', { class: 'solar-home', id: 'solar-home' }, [
        el('button', { type: 'button', class: 'solar-launch', id: 'solar-act-now', text: 'NOW IN MONTRÉAL' }),
        el('button', { type: 'button', class: 'solar-launch', id: 'solar-act-line', text: 'SHOW DAY / NIGHT LINE' }),
        el('button', { type: 'button', class: 'solar-launch', id: 'solar-act-people', text: 'HOW MANY PEOPLE ARE IN DARKNESS?' }),
        el('button', { type: 'button', class: 'solar-launch', id: 'solar-act-play', text: 'PLAY THE NEXT 24 HOURS' }),
        el('button', { type: 'button', class: 'solar-launch is-optional', id: 'solar-act-place', text: 'CHECK A PLACE' })
      ]),
      el('div', { class: 'solar-clock-simple', id: 'solar-clock-simple', hidden: true }),
      el('div', { class: 'solar-answer', id: 'solar-answer' })
    ]),
    el('div', { id: 'solar-advanced', hidden: true }, [
      el('div', { class: 'solar-clock', id: 'solar-clock', text: '—' }),
      el('div', { class: 'solar-body' }, [
        el('div', { class: 'solar-compass', id: 'solar-compass' }),
        el('div', { class: 'solar-readout' }, [
          el('div', { class: 'solar-state', id: 'solar-state', text: '—' }),
          el('div', { class: 'solar-azel', id: 'solar-azel', text: '—' }),
          el('div', { class: 'solar-eta', id: 'solar-eta', text: '—' })
        ])
      ]),
      el('div', { class: 'solar-actions' }, [
        el('button', { type: 'button', class: 'ops-btn is-primary', id: 'solar-now', text: 'NOW' }),
        el('button', { type: 'button', class: 'ops-btn', id: 'solar-minus', text: '−1H' }),
        el('button', { type: 'button', class: 'ops-btn', id: 'solar-plus', text: '+1H' }),
        el('button', { type: 'button', class: 'ops-btn', id: 'solar-play', text: 'PLAY' }),
        el('button', { type: 'button', class: 'ops-btn', id: 'solar-show', text: 'SHOW DAY / NIGHT LINE' })
      ]),
      el('input', { type: 'range', id: 'solar-scrub', min: '0', max: '1439', step: '5', value: '0' }),
      el('div', { class: 'solar-term', id: 'solar-term', text: 'DAY / NIGHT LINE' }),
      el('div', { class: 'solar-legend', id: 'solar-legend' }),
      el('div', { class: 'solar-pop-head' }, [
        el('div', { class: 'solar-pop-title', text: 'RESIDENT POPULATION BY ILLUMINATION STATE' }),
        el('div', { class: 'solar-pop-census', text: '2021 CENSUS' })
      ]),
      el('div', { class: 'solar-areas' }, [
        el('button', { type: 'button', class: 'ops-btn is-primary', id: 'solar-area-mtl', text: 'MONTRÉAL' }),
        el('button', { type: 'button', class: 'ops-btn', id: 'solar-area-view', text: 'CURRENT VIEW' }),
        el('button', { type: 'button', class: 'ops-btn', id: 'solar-area-ca', text: 'CANADA' })
      ]),
      el('div', { class: 'solar-pop', id: 'solar-pop' })
    ]),
    el('div', { class: 'solar-next', id: 'solar-next' })
  );

  for (const [id, , label, color] of POP_ROWS) {
    hud.querySelector('#solar-legend')?.append(el('button', {
      type: 'button',
      class: 'sl-btn',
      'data-sun-class': id
    }, [el('i', { class: `sl sl-${color === 'daylight' ? 'day' : color === 'nautical' ? 'naut' : color === 'astronomical' ? 'astro' : color}` }), el('b', { text: label.replace(' TWILIGHT', '') })]));
  }

  function solarSnapshot() {
    return snapshot().solar || {};
  }

  function payload() {
    return solarSnapshot().payload || {};
  }

  function currentInstant() {
    const at = solarSnapshot().at;
    return at ? new Date(at) : new Date();
  }

  function isLive() {
    return !solarSnapshot().at;
  }

  function isActive() {
    return solarSnapshot().visible === true;
  }

  function stopPlay() {
    if (playTimer) clearTimeout(playTimer);
    playTimer = null;
    playUntil = null;
    const button = hud.querySelector('#solar-play');
    if (button) button.textContent = 'PLAY';
  }

  async function setLive() {
    stopPlay();
    await setSolarInstant(null);
  }

  async function setSimulated(date) {
    await setSolarInstant(date);
  }

  async function shiftHours(hours) {
    await setSimulated(new Date(currentInstant().getTime() + Number(hours) * 3600000));
  }

  function playStep() {
    if (!playUntil) return;
    const next = new Date(currentInstant().getTime() + 15 * 60000);
    if (next >= playUntil) {
      void setSimulated(playUntil).then(stopPlay);
      return;
    }
    void setSimulated(next).finally(() => {
      if (!playUntil) return;
      playTimer = setTimeout(playStep, Math.max(90, Math.round(320 / playSpeed)));
    });
  }

  async function startPlay(hours = 24) {
    stopPlay();
    if (isLive()) await setSolarInstant(new Date());
    playUntil = new Date(currentInstant().getTime() + hours * 3600000);
    const button = hud.querySelector('#solar-play');
    if (button) button.textContent = 'PAUSE';
    playTimer = setTimeout(playStep, 80);
    render();
  }

  function togglePlay() {
    if (playTimer) stopPlay();
    else void startPlay(24);
    render();
  }

  function showTerminator() {
    const nearest = payload().sunState?.terminatorNearest;
    const view = getMapView();
    if (!nearest || !view?.goTo) return;
    void view.goTo({
      center: [nearest.lon, nearest.lat],
      zoom: Math.min(5, Number(view.zoom) || 5)
    }, { duration: 800 });
  }

  function renderPopulation(population) {
    const box = hud.querySelector('#solar-pop');
    if (!box) return;
    box.replaceChildren();
    if (!population?.available) {
      box.append(
        el('div', { class: 'pop-block', text: population?.message || population?.status || 'UNAVAILABLE' }),
        el('div', { class: 'pop-meta', text: [population?.analysisArea, population?.method, '2021 CENSUS'].filter(Boolean).join(' · ') })
      );
      return;
    }
    for (const [id, key, label, color] of POP_ROWS) {
      const row = el('button', {
        type: 'button',
        class: `pop-row pop-${color}${solarSnapshot().emphasize === id ? ' is-on' : ''}`,
        'data-sun-class': id
      }, [
        el('i', { class: `swatch sw-${color}` }),
        el('span', { text: label }),
        el('b', { text: fmtCount(population[key]) })
      ]);
      box.append(row);
    }
    box.append(
      el('div', { class: 'pop-total' }, [
        el('span', { text: 'TOTAL RESIDENT POPULATION' }),
        el('b', { text: fmtCount(population.totalPopulation) })
      ]),
      el('div', { class: 'pop-meta', text: `SOURCE  ${population.source || '2021 CENSUS'}` }),
      el('div', { class: 'pop-meta', text: `ANALYSIS AREA  ${population.analysisArea || '—'}` }),
      el('div', { class: 'pop-meta', text: `METHOD  ${population.method || '—'} · DA ${fmtCount(population.daFeaturesUsed)}` }),
      el('div', { class: 'pop-note', text: population.occupancyNote || 'Resident population. Not current occupancy.' })
    );
  }

  function answerActions(actions) {
    return el('div', { class: 'solar-answer-actions' }, actions.map((action) => {
      const button = el('button', { type: 'button', class: `ops-btn${action.primary ? ' is-primary' : ''}`, text: action.label });
      button.addEventListener('click', action.run);
      return button;
    }));
  }

  function renderSimple(sun, population) {
    const home = hud.querySelector('#solar-home');
    const ask = hud.querySelector('#solar-ask');
    const clock = hud.querySelector('#solar-clock-simple');
    const box = hud.querySelector('#solar-answer');
    const atHome = page === 'home';
    home.hidden = !atHome;
    ask.hidden = !atHome;
    clock.hidden = atHome && isLive() && !playTimer;
    clock.textContent = isLive() ? `NOW  ${sun.local || ''}` : `SIMULATED  ${sun.local || ''}`;
    clock.classList.toggle('is-sim', !isLive());
    box.replaceChildren();
    if (atHome) return;
    const eta = eventCountdown(sun, currentInstant());
    if (page === 'place') {
      if (placePending || !place) {
        box.append(
          el('div', { class: 'ans-kicker', text: 'CHECK A PLACE' }),
          el('div', { class: 'ans-hero', text: 'CLICK ANYWHERE ON THE MAP' }),
          el('div', { class: 'ans-note', text: 'Calculated daylight and 2021 Census context where available.' })
        );
        return;
      }
      const pointSun = place.sunState || {};
      box.append(
        el('div', { class: 'ans-kicker', text: 'THIS LOCATION' }),
        el('div', { class: 'ans-hero', text: humanState(pointSun) }),
        el('div', { class: 'ans-value', text: `SUN ${pointSun.azimuthDeg ?? '—'}° ${compass8(pointSun.azimuthDeg)} · ${pointSun.elevationDeg ?? '—'}°` }),
        el('div', { class: 'ans-value', text: `SUNRISE ${clockPart(pointSun.sunriseLocal)} · SUNSET ${clockPart(pointSun.sunsetLocal)}` }),
        place.da?.population2021 != null
          ? el('div', { class: 'ans-block' }, [
              el('div', { class: 'ans-label', text: '2021 RESIDENT POPULATION' }),
              el('div', { class: 'ans-value', text: fmtCount(place.da.population2021) }),
              el('div', { class: 'ans-note', text: 'Census usual residents. Not people present now.' })
            ])
          : null,
        el('div', { class: 'ans-note', text: `Lat ${place.latitude.toFixed(4)} · Lon ${place.longitude.toFixed(4)} · COMPUTED, NOT MEASURED WEATHER` }),
        answerActions([
          { label: 'CHECK ANOTHER PLACE', primary: true, run: () => { place = null; placePending = true; render(); } },
          { label: 'BACK', run: () => { place = null; placePending = false; page = 'home'; render(); } }
        ])
      );
      return;
    }
    if (page === 'people') {
      box.append(
        el('div', { class: 'ans-kicker', text: 'POPULATION & DAYLIGHT' }),
        el('div', { class: 'ans-hero', text: solarSnapshot().area === 'view' ? 'CURRENT VIEW' : 'MONTRÉAL' })
      );
      if (population?.available) {
        for (const [id, key, label, color] of POP_ROWS) {
          box.append(el('button', {
            type: 'button',
            class: `ans-pop pop-${color}`,
            'data-sun-class': id
          }, [
            el('i', { class: `swatch sw-${color}` }),
            el('span', { text: label }),
            el('b', { text: fmtCount(population[key]) })
          ]));
        }
      } else {
        box.append(el('div', { class: 'ans-value', text: population?.message || 'Unavailable.' }));
      }
      box.append(
        el('div', { class: 'ans-note', text: '2021 CENSUS RESIDENT POPULATION · NOT CURRENT PHYSICAL OCCUPANCY' }),
        answerActions([
          { label: 'MONTRÉAL', primary: solarSnapshot().area !== 'view', run: () => setSolarArea('montreal') },
          { label: 'CURRENT VIEW', primary: solarSnapshot().area === 'view', run: () => setSolarArea('view') },
          { label: 'PLAY THROUGH TIME', run: () => startPlay(24) },
          { label: 'BACK', run: () => { page = 'home'; render(); } }
        ])
      );
      return;
    }
    if (page === 'line') {
      const nearest = sun.terminatorNearest;
      box.append(
        el('div', { class: 'ans-kicker', text: 'DAY / NIGHT LINE' }),
        el('div', { class: 'ans-hero', text: 'SOLAR TERMINATOR' }),
        el('div', { class: 'ans-value', text: nearest ? `${fmtCount(nearest.km)} KM ${nearest.compass} OF MAP CENTRE` : 'Computed 0° solar horizon' }),
        el('div', { class: 'ans-note', text: 'Bright edge is where geometric day meets night.' }),
        answerActions([
          { label: 'SHOW IT', primary: true, run: showTerminator },
          { label: 'BACK', run: () => { page = 'home'; render(); } }
        ])
      );
      return;
    }
    if (page === 'play') {
      const pct = Math.max(0, Math.min(100, (localMinutes(currentInstant()) / 1439) * 100));
      box.append(
        el('div', { class: 'ans-kicker', text: playTimer ? 'PLAYING NEXT 24 HOURS' : '24 HOUR PLAY' }),
        el('div', { class: 'ans-hero', text: humanState(sun) }),
        el('div', { class: 'solar-clock-simple', text: `SIMULATED  ${sun.local || ''}` }),
        el('div', { class: 'solar-timeline' }, [el('i', { class: 'solar-timeline-fill', style: `left:${pct}%` })]),
        el('div', { class: 'ans-value', text: population?.available ? `${fmtCount(population.daylightPopulation)} in daylight · ${fmtCount(totalDark(population))} in twilight / night` : '—' }),
        answerActions([
          { label: playTimer ? 'PAUSE' : 'PLAY', primary: true, run: togglePlay },
          { label: 'RETURN TO NOW', run: setLive },
          { label: `SPEED ${playSpeed}×`, run: () => { playSpeed = playSpeed === 1 ? 2 : playSpeed === 2 ? 4 : 1; render(); } },
          { label: 'BACK', run: () => { stopPlay(); page = 'home'; render(); } }
        ])
      );
      return;
    }
    box.append(
      el('div', { class: 'ans-kicker', text: 'MONTRÉAL NOW' }),
      el('div', { class: 'ans-hero', text: humanState(sun) }),
      el('div', { class: 'ans-value', text: `SUN ${sun.azimuthDeg ?? '—'}° ${compass8(sun.azimuthDeg)} · ${sun.elevationDeg ?? '—'}°` }),
      el('div', { class: 'ans-value', text: `SUNSET ${clockPart(sun.sunsetLocal)} · ${eta.text} ${eta.label}` }),
      el('div', { class: 'ans-value', text: population?.available ? `${fmtCount(totalDark(population))} RESIDENTS IN TWILIGHT / NIGHT` : 'POPULATION — UNAVAILABLE' }),
      el('div', { class: 'ans-note', text: 'COMPUTED NOAA SOLAR EQUATIONS · 2021 CENSUS' }),
      answerActions([
        { label: 'SHOW ON MAP', primary: true, run: () => getMapView()?.goTo?.({ center: [MONTREAL.longitude, MONTREAL.latitude], zoom: MONTREAL.zoom }) },
        { label: 'PLAY TO SUNSET', run: () => startPlay(Math.max(1, (Date.parse(sun.sunsetUtc || '') - Date.now()) / 3600000)) },
        { label: 'BACK', run: () => { page = 'home'; render(); } }
      ])
    );
  }

  function renderAdvanced(sun, population) {
    hud.querySelector('#solar-clock').textContent = isLive() ? (sun.local || '') : `SIMULATED  ${sun.local || ''}`;
    hud.querySelector('#solar-compass').innerHTML = compassSvg(sun.azimuthDeg);
    hud.querySelector('#solar-state').textContent = humanState(sun);
    hud.querySelector('#solar-azel').textContent = `${sun.azimuthDeg ?? '—'}° ${compass8(sun.azimuthDeg)} · ${sun.elevationDeg ?? '—'}°`;
    const eta = eventCountdown(sun, currentInstant());
    hud.querySelector('#solar-eta').textContent = `${eta.text} ${eta.label}`;
    hud.querySelector('#solar-scrub').value = String(localMinutes(currentInstant()));
    const nearest = sun.terminatorNearest;
    hud.querySelector('#solar-term').textContent = nearest
      ? `DAY / NIGHT LINE · ${fmtCount(nearest.km)} KM ${nearest.compass}`
      : 'DAY / NIGHT LINE';
    renderPopulation(population);
  }

  function render() {
    const active = isActive();
    hud.hidden = !active;
    if (!active) {
      stopPlay();
      placePending = false;
      return;
    }
    const pack = payload();
    const sun = pack.sunState || {};
    const population = pack.population;
    const live = isLive();
    hud.querySelector('#solar-mode').textContent = live ? 'LIVE / NOW' : 'SIMULATED';
    hud.querySelector('#solar-mode').classList.toggle('is-sim', !live);
    hud.querySelector('#solar-simple').hidden = ui !== 'simple';
    hud.querySelector('#solar-advanced').hidden = ui !== 'advanced';
    hud.querySelector('#solar-ui-simple').classList.toggle('is-primary', ui === 'simple');
    hud.querySelector('#solar-ui-advanced').classList.toggle('is-primary', ui === 'advanced');
    hud.querySelector('#solar-area-mtl').classList.toggle('is-primary', solarSnapshot().area === 'montreal');
    hud.querySelector('#solar-area-view').classList.toggle('is-primary', solarSnapshot().area === 'view');
    hud.querySelector('#solar-area-ca').classList.toggle('is-primary', solarSnapshot().area === 'canada');
    hud.querySelectorAll('[data-sun-class]').forEach((node) => {
      node.classList.toggle('is-on', node.getAttribute('data-sun-class') === solarSnapshot().emphasize);
    });
    renderSimple(sun, population);
    if (ui === 'advanced') renderAdvanced(sun, population);
    const next = hud.querySelector('#solar-next');
    next.replaceChildren(el('div', {
      class: 'next-line',
      text: placePending ? 'CLICK ANYWHERE ON THE MAP' : 'COMPUTED · NOT A LIVE WEATHER FEED · NO BUILDING-SHADOW ANALYSIS'
    }));
  }

  async function onMapClick(event) {
    if (!isActive() || !placePending) return;
    const point = event?.mapPoint;
    const latitude = Number(point?.latitude);
    const longitude = Number(point?.longitude);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return;
    placePending = false;
    const params = new URLSearchParams({ lat: String(latitude), lon: String(longitude) });
    if (!isLive()) params.set('at', currentInstant().toISOString());
    const response = await fetch(`/api/spatial-v2/ops-layers/sun/state?${params}`, { cache: 'no-store' });
    const body = await response.json();
    place = { latitude, longitude, sunState: body.sunState, da: body.da };
    render();
  }

  function attachView(view) {
    if (!view || watchedView === view) return;
    try { clickHandle?.remove?.(); } catch { /* ignore */ }
    try { moveHandle?.remove?.(); } catch { /* ignore */ }
    watchedView = view;
    clickHandle = view.on?.('click', onMapClick) || null;
    moveHandle = view.watch?.('stationary', (stationary) => {
      if (!stationary || !isActive() || !isLive()) return;
      clearTimeout(moveTimer);
      moveTimer = setTimeout(() => { void refreshSolar(); }, 1600);
    }) || null;
  }

  hud.addEventListener('click', (event) => {
    const id = event.target.closest('button')?.id;
    const emphasis = event.target.closest('[data-sun-class]')?.getAttribute('data-sun-class');
    if (emphasis) {
      setSolarEmphasis(solarSnapshot().emphasize === emphasis ? null : emphasis);
      return;
    }
    if (id === 'solar-ui-simple') { ui = 'simple'; render(); }
    else if (id === 'solar-ui-advanced') { ui = 'advanced'; render(); }
    else if (id === 'solar-act-now') { page = 'now'; void setLive(); }
    else if (id === 'solar-act-line' || id === 'solar-show') { page = 'line'; showTerminator(); render(); }
    else if (id === 'solar-act-people') { page = 'people'; void setSolarArea('montreal'); }
    else if (id === 'solar-act-play') { page = 'play'; void startPlay(24); }
    else if (id === 'solar-act-place') { page = 'place'; place = null; placePending = true; render(); }
    else if (id === 'solar-now') void setLive();
    else if (id === 'solar-minus') void shiftHours(-1);
    else if (id === 'solar-plus') void shiftHours(1);
    else if (id === 'solar-play') togglePlay();
    else if (id === 'solar-area-mtl') void setSolarArea('montreal');
    else if (id === 'solar-area-view') void setSolarArea('view');
    else if (id === 'solar-area-ca') void setSolarArea('canada');
  });

  hud.querySelector('#solar-scrub')?.addEventListener('input', (event) => {
    void setSimulated(dateFromLocalMinutes(currentInstant(), Number(event.target.value)));
  });

  const unsubscribeOps = subscribeOpsLayers(render);
  const unsubscribeFoundation = subscribeMapFoundation((state) => {
    if (state.state === 'READY') attachView(getMapView());
  });
  attachView(getMapView());
  render();

  return Object.freeze({
    isActive,
    isPlacePending: () => isActive() && placePending,
    render,
    runAction(name) {
      if (name === 'now') { page = 'now'; return setLive(); }
      if (name === 'line') { page = 'line'; showTerminator(); render(); return null; }
      if (name === 'people') { page = 'people'; return setSolarArea('montreal'); }
      if (name === 'play') { page = 'play'; return startPlay(24); }
      if (name === 'place') { page = 'place'; placePending = true; render(); return null; }
      return null;
    },
    snapshot() {
      return {
        active: isActive(),
        ui,
        page,
        live: isLive(),
        playing: Boolean(playTimer),
        placePending,
        area: solarSnapshot().area,
        emphasize: solarSnapshot().emphasize
      };
    },
    destroy() {
      stopPlay();
      clearTimeout(moveTimer);
      try { clickHandle?.remove?.(); } catch { /* ignore */ }
      try { moveHandle?.remove?.(); } catch { /* ignore */ }
      unsubscribeOps?.();
      unsubscribeFoundation?.();
    }
  });
}
