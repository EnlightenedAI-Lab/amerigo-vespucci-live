import { ArcGISAdapter } from './arcgis-adapter.js';
import { TimeController } from './time-controller-client.js';

const MODE_LABELS = {
  navigation: 'Navigation',
  ocean: 'Ocean',
  weather: 'Weather',
  satellite: 'Satellite',
  intelligence: 'Intelligence'
};

export class IqaiV2App {
  constructor() {
    this.config = null;
    this.catalog = [];
    this.mode = 'navigation';
    this.adapter = null;
    this.activeLayerIds = new Set();
    this.healthAlerts = 0;
    this.validTimeLabel = '—';
    this.mapData = null;
    this.timeController = new TimeController();
    this._modeAbort = null;
    this._pointerHandler = null;
  }

  async init() {
    const [cfgRes, catRes] = await Promise.all([
      fetch('/api/spatial/config'),
      fetch('/api/spatial/catalog')
    ]);
    this.config = await cfgRes.json();
    const cat = await catRes.json();
    this.catalog = cat.layers || [];

    const mapEl = document.getElementById('iqai-arcgis-map');
    this.adapter = new ArcGISAdapter(mapEl);
    const oceanCfg = await (await fetch('/api/ocean-view')).json();
    await this.adapter.init({
      portalUrl: oceanCfg.portalUrl,
      cdnUrl: oceanCfg.cdnUrl,
      preview: this.config.preview === true,
      featureServiceUrl: this.config.featureServiceUrl,
      layerIds: this.config.featureLayerIds
    });

    this.bindUi();
    await this.fetchTrackerData();
    await this.adapter.setTrackerGraphics(this.mapData);
    await this.applyMode('navigation');
    this.renderDrawer();
    this.updateAttribution();
    this.bindMapReadout();
    await this.fitVoyage();
  }

  bindUi() {
    document.querySelectorAll('.iqai-mode-btn').forEach((btn) => {
      btn.addEventListener('click', () => this.applyMode(btn.dataset.mode));
      btn.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          this.applyMode(btn.dataset.mode);
        }
      });
    });
    document.getElementById('iqai-btn-fit')?.addEventListener('click', () => this.fitVoyage());
    document.getElementById('iqai-btn-center')?.addEventListener('click', () => this.centerVessel());
    document.getElementById('iqai-rollback')?.addEventListener('click', () => {
      document.getElementById('iqai-v2-app')?.classList.add('hidden');
      document.getElementById('app')?.classList.remove('hidden');
      localStorage.setItem('iqai-v2-disabled', '1');
    });
    document.getElementById('iqai-time-play')?.addEventListener('click', () => this.togglePlay());
    document.getElementById('iqai-time-step-fwd')?.addEventListener('click', () => this.stepTime(1));
    document.getElementById('iqai-time-step-back')?.addEventListener('click', () => this.stepTime(-1));
  }

  bindMapReadout() {
    if (!this.adapter.view) return;
    const el = document.getElementById('iqai-coords');
    if (!el) return;
    this._pointerHandler = (evt) => {
      const pt = this.adapter.view.toMap({ x: evt.x, y: evt.y });
      if (pt?.longitude != null) {
        el.textContent = `${pt.latitude.toFixed(4)}°N, ${pt.longitude.toFixed(4)}°E`;
      }
    };
    this.adapter.view.on('pointer-move', this._pointerHandler);
  }

  layersForMode(mode) {
    return this.catalog.filter((l) => l.enabled && l.modes.includes(mode) && !l.retired && !l.trackerLayer);
  }

  async applyMode(mode) {
    if (this._modeAbort) this._modeAbort.abort();
    this._modeAbort = new AbortController();

    this.mode = mode;
    document.querySelectorAll('.iqai-mode-btn').forEach((b) => {
      b.classList.toggle('active', b.dataset.mode === mode);
      b.setAttribute('aria-selected', b.dataset.mode === mode ? 'true' : 'false');
    });
    document.getElementById('iqai-active-mode').textContent = MODE_LABELS[mode] || mode;

    const contextual = this.layersForMode(mode);
    const activeIds = new Set();
    const exclusiveGroups = new Map();

    for (const layer of contextual) {
      if (layer.id === 'ipma-radar-azores' && !this.config.radarEnabled) continue;
      if (!layer.exclusiveGroup) {
        activeIds.add(layer.id);
        continue;
      }
      if (!exclusiveGroups.has(layer.exclusiveGroup)) exclusiveGroups.set(layer.exclusiveGroup, []);
      exclusiveGroups.get(layer.exclusiveGroup).push(layer);
    }

    for (const [group, members] of exclusiveGroups) {
      const pick = members.find((m) => m.id === this._defaultExclusive(group)) || members[0];
      activeIds.add(pick.id);
    }

    for (const layer of contextual) {
      if (!activeIds.has(layer.id)) continue;
      try {
        await this.adapter.ensureLayerFromCatalog(layer, this.timeController);
        this.adapter.setVisible(layer.id, true);
        if (layer.timeSupport?.includes('time')) {
          document.getElementById('iqai-valid-time').textContent =
            this.timeController.validTime?.replace('T', ' ').replace(/\.\d+Z$/, ' UTC') || '—';
        }
      } catch (err) {
        this.healthAlerts += 1;
        document.getElementById('iqai-health').textContent = `${this.healthAlerts} provider alert(s)`;
        console.warn(`Layer ${layer.id} failed`, err);
      }
    }

    this.activeLayerIds = activeIds;
    this.adapter.hideContextualLayers(new Set([...activeIds, ...this.adapter.trackerLayerIds]));
    this.renderLayerList(contextual);
    this.updateAttribution();
  }

  _defaultExclusive(group) {
    if (group === 'ocean-analytical') return 'copernicus-current';
    if (group === 'satellite-analytical') return 'gibs-viirs-truecolor';
    if (group === 'intelligence-analytical') return 'ship-density-historical';
    return null;
  }

  togglePlay() {
    if (this.timeController.playing) {
      this.timeController.stop();
      return;
    }
    this.timeController.play(1200, (t) => this.onTimeTick(t));
  }

  async stepTime(delta) {
    const t = this.timeController.step(delta);
    if (t) await this.onTimeTick(t);
  }

  async onTimeTick(validTime) {
    document.getElementById('iqai-valid-time').textContent =
      validTime.replace('T', ' ').replace(/\.\d+Z$/, ' UTC');
    for (const id of this.activeLayerIds) {
      const layer = this.catalog.find((l) => l.id === id);
      if (layer?.timeSupport?.includes('time')) {
        await this.adapter.setTime(id, validTime);
      }
    }
  }

  renderLayerList(layers) {
    const el = document.getElementById('iqai-layer-list');
    if (!el) return;
    el.innerHTML = layers.map((l) => {
      if (l.id === 'ipma-radar-azores' && !this.config.radarEnabled) {
        return '<div class="iqai-layer-row disabled">Radar — Permission review required</div>';
      }
      const active = this.activeLayerIds.has(l.id);
      const badge = l.evidenceClass || '';
      return `<div class="iqai-layer-row${active ? ' active' : ''}">${l.title} <span class="iqai-evidence">[${badge}]</span></div>`;
    }).join('');
  }

  async fetchTrackerData() {
    const res = await fetch('/api/map-data');
    this.mapData = await res.json();
    const v = this.mapData?.vessel;
    const p = v?.properties || {};
    document.getElementById('iqai-vessel-meta').innerHTML =
      `<strong>Amerigo Vespucci</strong> · MMSI ${this.config.mmsi}`;
    document.getElementById('iqai-ais-meta').innerHTML =
      `AIS <strong>${v?.freshness || '—'}</strong> · ${p.LastAIS || '—'} UTC`;
    document.getElementById('iqai-dest-meta').textContent =
      `${this.config.destination?.name || 'Ponta Delgada'}`;
  }

  renderDrawer() {
    const el = document.getElementById('iqai-drawer-body');
    if (!el || !this.mapData) return;
    const v = this.mapData.vessel?.properties || {};
    const dest = this.config.destination;
    const lat = Number(v.Latitude);
    const lon = Number(v.Longitude);
    let metrics = '';
    if (dest && Number.isFinite(lat) && Number.isFinite(lon)) {
      const dist = haversineNm(lat, lon, dest.latitude, dest.longitude);
      metrics = `<dt>Distance remaining</dt><dd>${dist.toFixed(1)} NM <span class="iqai-evidence">[estimated]</span></dd>`;
    }
    el.innerHTML = `
      <h3>Vessel</h3>
      <dl>
        <dt>Position</dt><dd>${v.Latitude ?? '—'}°N, ${v.Longitude ?? '—'}°W</dd>
        <dt>Speed / Course</dt><dd>${v.SpeedKnots ?? '—'} kn / ${v.Course ?? '—'}°</dd>
        ${metrics}
        <dt>Evidence</dt><dd>OBSERVED AIS (hosted feature)</dd>
        <dt>Caveat</dt><dd>${this.config.notForNavigation}</dd>
      </dl>`;
  }

  updateAttribution() {
    const active = this.layersForMode(this.mode).filter((l) => this.activeLayerIds.has(l.id));
    const tracker = this.catalog.filter((l) => l.trackerLayer).map((l) => l.attribution);
    const uniq = [...new Set([...active.map((l) => l.attribution), ...tracker].filter(Boolean))];
    document.getElementById('iqai-attribution').textContent = uniq.join(' · ');
  }

  async fitVoyage() {
    const d = this.config.destination;
    const v = this.mapData?.vessel?.geojson?.features?.[0]?.geometry?.coordinates;
    if (!d || !v) return;
    const [vLon, vLat] = v;
    const padLon = Math.max(2, Math.abs(vLon - d.longitude) * 0.08);
    const padLat = Math.max(2, Math.abs(vLat - d.latitude) * 0.08);
    await this.adapter.fitGeometry({
      xmin: Math.min(vLon, d.longitude) - padLon,
      ymin: Math.min(vLat, d.latitude) - padLat,
      xmax: Math.max(vLon, d.longitude) + padLon,
      ymax: Math.max(vLat, d.latitude) + padLat,
      spatialReference: { wkid: 4326 }
    });
  }

  async centerVessel() {
    const v = this.mapData?.vessel?.geojson?.features?.[0]?.geometry?.coordinates;
    if (!v || !this.adapter.view) return;
    await this.adapter.view.goTo({ center: v, zoom: 7 });
  }
}

function haversineNm(lat1, lon1, lat2, lon2) {
  const R = 3440.065;
  const toRad = (d) => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
