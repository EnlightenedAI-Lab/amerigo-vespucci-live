/**
 * Intelligence Lab — isolated ArcGIS MapView (NOT Montreal 1 WebMap).
 */

import { COMPOSITION_COLORS } from './lab-labels.js';
import { applySpvmPresentation } from './lab-spvm-render.js';
import { buildGridFromPoints } from './lab-gis-grid.js';
import { LabHoverCard, escapeHtml } from './lab-hover.js';
import { englishLabelForCategory } from '../spvm-crime-taxonomy.js';

const ARCGIS_CDN_URL = 'https://js.arcgis.com/5.1/';

export async function loadArcgisCdn() {
  if (window.$arcgis) return;
  await new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.type = 'module';
    script.src = ARCGIS_CDN_URL;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Failed to load ArcGIS Maps SDK 5.1'));
    document.head.appendChild(script);
  });
}

async function importArc(path) {
  const mod = await $arcgis.import(path);
  return mod?.default || mod;
}

export function shortPdqLabel(displayName) {
  return String(displayName || '').replace(/^PDQ\s+/i, '').replace(/-/g, '/');
}

const FIELD_SCHEMA = [
  { name: 'OBJECTID', type: 'oid' },
  { name: 'harmonized_pdq_id', type: 'string' },
  { name: 'display_name', type: 'string' },
  { name: 'label_short', type: 'string' },
  { name: 'mapValue', type: 'double', nullable: true },
  { name: 'observed', type: 'double', nullable: true },
  { name: 'baseline', type: 'double', nullable: true },
  { name: 'deviation', type: 'double', nullable: true },
  { name: 'relDev', type: 'double', nullable: true },
  { name: 'change', type: 'double', nullable: true },
  { name: 'persistence', type: 'integer', nullable: true },
  { name: 'label', type: 'string' },
  { name: 'comp_total', type: 'integer', nullable: true },
  ...Array.from({ length: 5 }, (_, i) => ({ name: `cat_${i}`, type: 'integer', nullable: true }))
];

export class LabArcgisRuntime {
  constructor(hostEl, legendHost) {
    this.hostEl = hostEl;
    this.legendHost = legendHost;
    this.view = null;
    this.layer = null;
    this.arrondLayer = null;
    this.spvmLayer = null;
    this.gridLayer = null;
    this.spvmBlobUrl = null;
    this.legend = null;
    this.highlightHandles = [];
    this.spvmHighlight = null;
    this.timeSlider = null;
    this.timeSliderHostEl = null;
    this.onWeekChange = null;
    this.onSelect = null;
    this.onRecordSelect = null;
    this.onArrondSelect = null;
    this.onGridSelect = null;
    this.onCaseRecordSelect = null;
    this.onCaseSelect = null;
    this.getHoverContext = null;
    this.featureTemplates = [];
    this.selectedIds = [];
    this.allWeeks = [];
    this._attrHash = {};
    this._lastGisMode = '';
    this._filteredFeatures = [];
    this._gridCells = [];
    this._arrondGeometries = [];
    this._pdqGeometries = [];
    this._caseRelatedByKey = {};
    this.hoverCard = new LabHoverCard();
    this._pointerMoveTimer = null;
    this._hoverToken = 0;
    this._mapClickHandle = null;
    this._pointerMoveHandle = null;
    this._pointerLeaveHandle = null;
    this._rendererSpec = null;
    this._visualMode = 'deviation';
    this._activeGisMode = 'pdqAnalytics';
    this._gridHoverEnabled = false;
    this.caseLayer = null;
    this._caseBufferLayer = null;
    this._caseRelatedLayer = null;
    this.layerVisibility = {
      pdqShading: true,
      pdqBoundaries: true,
      pdqLabels: true,
      arrondBoundaries: false,
      arrondLabels: false,
      recentReports: true
    };
  }

  async init() {
    await loadArcgisCdn();
    const [Map, MapView, FeatureLayer, Graphic, Polygon, TimeSlider, Legend] = await Promise.all([
      importArc('@arcgis/core/Map.js'),
      importArc('@arcgis/core/views/MapView.js'),
      importArc('@arcgis/core/layers/FeatureLayer.js'),
      importArc('@arcgis/core/Graphic.js'),
      importArc('@arcgis/core/geometry/Polygon.js'),
      importArc('@arcgis/core/widgets/TimeSlider.js'),
      importArc('@arcgis/core/widgets/Legend.js')
    ]);

    this.Graphic = Graphic;
    this.Polygon = Polygon;

    const geo = await fetch('/api/spatial/intelligence-lab/geography').then((r) => r.json());
    const source = geo.features.map((f, idx) => {
      const rings = f.geometry.type === 'Polygon'
        ? f.geometry.coordinates
        : f.geometry.coordinates.flatMap((poly) => poly);
      const display = f.properties.display_name;
      return new Graphic({
        geometry: new Polygon({ rings, spatialReference: { wkid: 4326 } }),
        attributes: {
          OBJECTID: idx + 1,
          harmonized_pdq_id: f.properties.harmonized_pdq_id,
          display_name: display,
          label_short: shortPdqLabel(display),
          mapValue: 0,
          observed: 0,
          label: 'init',
          comp_total: 0,
          cat_0: 0, cat_1: 0, cat_2: 0, cat_3: 0, cat_4: 0
        }
      });
    });

    this.featureTemplates = source;
    this.geoFeatures = geo.features;
    this._pdqGeometries = geo.features.map((f) => ({
      id: f.properties.harmonized_pdq_id,
      displayName: f.properties.display_name,
      rings: f.geometry.type === 'Polygon' ? f.geometry.coordinates : f.geometry.coordinates.flatMap((p) => p)
    }));

    const layer = new FeatureLayer({
      source,
      title: 'Police sectors',
      id: 'lab-pdq',
      objectIdField: 'OBJECTID',
      geometryType: 'polygon',
      spatialReference: { wkid: 4326 },
      fields: FIELD_SCHEMA,
      popupEnabled: false,
      editingEnabled: true,
      labelingInfo: [{
        symbol: {
          type: 'text',
          color: '#0f172a',
          haloColor: '#ffffff',
          haloSize: 1.5,
          font: { size: 11, weight: 'bold', family: 'Segoe UI' }
        },
        labelExpressionInfo: { expression: '$feature.label_short' },
        deconflictionStrategy: 'static',
        repeatLabel: false
      }]
    });

    const map = new Map({ basemap: 'streets-vector', layers: [layer] });

    const view = new MapView({
      container: this.hostEl,
      map,
      center: [-73.57, 45.52],
      zoom: 10.3,
      constraints: { snapToZoom: false }
    });

    await view.when();
    await layer.when();

    if (this.legendHost) {
      this.legend = new Legend({ view, container: this.legendHost });
    }

    this._mapClickHandle = view.on('click', (event) => this._onMapClick(event));
    this._pointerMoveHandle = view.on('pointer-move', (event) => {
      clearTimeout(this._pointerMoveTimer);
      this._pointerMoveTimer = setTimeout(() => this._onPointerMove(event), 40);
    });
    this._pointerLeaveHandle = view.on('pointer-leave', () => this._cancelMapHover());

    this.view = view;
    this.layer = layer;
    this.TimeSlider = TimeSlider;
    this.FeatureLayer = FeatureLayer;

    await this._loadArrondissements();

    return { view, layer, geoFeatures: geo.features };
  }

  async _loadArrondissements() {
    try {
      const geo = await fetch('/api/spatial/intelligence-lab/arrondissements').then((r) => r.json());
      const graphics = geo.features.map((f, idx) => {
        const rings = f.geometry.type === 'Polygon'
          ? f.geometry.coordinates
          : f.geometry.coordinates.flatMap((poly) => poly);
        return new this.Graphic({
          geometry: new this.Polygon({ rings, spatialReference: { wkid: 4326 } }),
          attributes: {
            OBJECTID: idx + 1,
            arrondissement_id: f.properties.arrondissement_id,
            name: f.properties.name
          }
        });
      });

      this._arrondGeometries = geo.features.map((f) => ({
        id: f.properties.arrondissement_id,
        name: f.properties.name,
        rings: f.geometry.type === 'Polygon' ? f.geometry.coordinates : f.geometry.coordinates[0]
      }));

      this.arrondLayer = new this.FeatureLayer({
        source: graphics,
        title: 'Arrondissements',
        id: 'lab-arrond',
        objectIdField: 'OBJECTID',
        geometryType: 'polygon',
        spatialReference: { wkid: 4326 },
        fields: [
          { name: 'OBJECTID', type: 'oid' },
          { name: 'arrondissement_id', type: 'string' },
          { name: 'name', type: 'string' }
        ],
        renderer: {
          type: 'simple',
          symbol: {
            type: 'simple-fill',
            color: [0, 0, 0, 0],
            outline: { color: [100, 116, 139, 0.85], width: 1.25, style: 'dash' }
          }
        },
        labelingInfo: [{
          symbol: {
            type: 'text',
            color: '#475569',
            haloColor: '#ffffff',
            haloSize: 1.25,
            font: { size: 9, weight: 'normal', family: 'Segoe UI' }
          },
          labelExpressionInfo: { expression: '$feature.name' }
        }],
        visible: false,
        popupEnabled: false
      });

      this.view.map.add(this.arrondLayer);
    } catch (err) {
      console.warn('[lab] arrondissements unavailable', err);
    }
  }

  pointInArrondissement(arrondId, lng, lat) {
    const entry = this._arrondGeometries.find((a) => a.id === arrondId);
    if (!entry) return false;
    return pointInRing(lng, lat, entry.rings[0] || entry.rings);
  }

  findPdqAtPoint(lng, lat) {
    for (const entry of this._pdqGeometries) {
      for (const ring of entry.rings) {
        const loop = Array.isArray(ring[0]?.[0]) ? ring[0] : ring;
        if (pointInRing(lng, lat, loop)) return entry.id;
      }
    }
    return null;
  }

  setLayerVisibility(vis) {
    this.layerVisibility = { ...this.layerVisibility, ...vis };
    this._syncLayerPresentation();
  }

  /**
   * Single presentation sync — checkbox state is authoritative.
   */
  _syncLayerPresentation() {
    this._syncPdqPresentation();
    this._syncArrondPresentation();
    if (this.spvmLayer) {
      this.spvmLayer.visible = this.layerVisibility.recentReports !== false;
    }
  }

  _pdqOutline(width = 1.25) {
    return { color: [71, 85, 105, 0.88], width };
  }

  _outlineOnlyPdqRenderer() {
    const w = this.layerVisibility.pdqBoundaries ? 1.25 : 0;
    return {
      type: 'simple',
      symbol: {
        type: 'simple-fill',
        color: [0, 0, 0, 0],
        outline: this._pdqOutline(w)
      }
    };
  }

  _applyFillPresentation(rendererSpec, shading, boundaries) {
    const outlineW = boundaries ? 1.25 : 0;
    const outline = this._pdqOutline(outlineW);
    const transparent = [0, 0, 0, 0];

    const touchSymbol = (sym) => {
      if (!sym) return;
      if (!shading) {
        if (Array.isArray(sym.color)) sym.color = [...transparent];
        else sym.color = 'rgba(0,0,0,0)';
      }
      sym.outline = { ...outline };
    };

    const spec = JSON.parse(JSON.stringify(rendererSpec));
    if (spec.type === 'class-breaks') {
      spec.classBreakInfos?.forEach((info) => touchSymbol(info.symbol));
      touchSymbol(spec.defaultSymbol);
      return spec;
    }
    if (spec.type === 'simple') {
      touchSymbol(spec.symbol);
      if (!shading && spec.visualVariables?.length) {
        spec.visualVariables = [];
      }
      return spec;
    }
    return spec;
  }

  _pdqLabelClasses(visualMode) {
    const pdqNumber = {
      symbol: {
        type: 'text',
        color: '#0f172a',
        haloColor: '#ffffff',
        haloSize: 1.5,
        font: { size: 11, weight: 'bold', family: 'Segoe UI' }
      },
      labelExpressionInfo: { expression: '$feature.label_short' },
      deconflictionStrategy: 'static',
      repeatLabel: false
    };
    if (visualMode !== 'composition' || !this.layerVisibility.pdqShading) {
      return [pdqNumber];
    }
    return [
      pdqNumber,
      {
        symbol: {
          type: 'text',
          color: '#0f172a',
          haloColor: '#ffffff',
          haloSize: 1.5,
          font: { size: 10, weight: 'bold', family: 'Segoe UI' }
        },
        labelExpressionInfo: {
          expression: "if ($feature.comp_total > 0) { return Text($feature.comp_total, '#,###'); } return '';"
        },
        deconflictionStrategy: 'static',
        repeatLabel: false
      }
    ];
  }

  async _syncPdqPresentation() {
    if (!this.layer) return;
    const v = this.layerVisibility;
    const spec = this._rendererSpec;
    const mode = this._visualMode;

    const pdqNeeded = v.pdqShading || v.pdqBoundaries || v.pdqLabels;
    this.layer.visible = pdqNeeded;
    this.layer.labelsVisible = pdqNeeded && v.pdqLabels !== false;
    this.layer.labelingInfo = this._pdqLabelClasses(mode);

    if (!pdqNeeded || !spec) return;

    if (mode === 'composition' && v.pdqShading) {
      const PieChartRenderer = await importArc('@arcgis/core/renderers/PieChartRenderer.js');
      const attributes = (spec._pieFields || []).map((f, i) => ({
        field: f.field,
        label: f.label,
        color: COMPOSITION_COLORS[i]?.color || '#64748b'
      }));
      const outlineW = v.pdqBoundaries ? 0.75 : 0;
      this.layer.renderer = new PieChartRenderer({
        attributes,
        outline: { width: outlineW, color: '#475569' },
        size: 22,
        othersCategory: { threshold: 0.02 },
        backgroundFillSymbol: {
          type: 'simple-fill',
          color: [248, 250, 252, 0.6],
          outline: { color: '#cbd5e1', width: outlineW }
        }
      });
      return;
    }

    if (!v.pdqShading) {
      this.layer.renderer = this._outlineOnlyPdqRenderer();
      return;
    }

    this.layer.renderer = this._applyFillPresentation(spec, true, v.pdqBoundaries);
  }

  _syncArrondPresentation() {
    if (!this.arrondLayer) return;
    const v = this.layerVisibility;
    const needed = v.arrondBoundaries || v.arrondLabels;
    this.arrondLayer.visible = needed;
    this.arrondLayer.labelsVisible = needed && v.arrondLabels !== false;
    const outlineW = v.arrondBoundaries ? 1.25 : 0;
    this.arrondLayer.renderer = {
      type: 'simple',
      symbol: {
        type: 'simple-fill',
        color: [0, 0, 0, 0],
        outline: {
          color: v.arrondBoundaries ? [100, 116, 139, 0.88] : [0, 0, 0, 0],
          width: outlineW,
          style: 'dash'
        }
      }
    };
  }

  hasTimeSlider() {
    return Boolean(this.timeSlider);
  }

  async ensureTimeSlider(weeks, currentWeek, onWeekChange, hostEl) {
    this.allWeeks = weeks;
    this.onWeekChange = onWeekChange;
    this.timeSliderHostEl = hostEl;

    if (this.timeSlider) {
      this.setTimeSliderWeek(currentWeek);
      return;
    }

    const start = new Date(`${weeks[0]}T12:00:00Z`);
    const end = new Date(`${weeks[weeks.length - 1]}T12:00:00Z`);
    const stops = weeks.map((w) => new Date(`${w}T12:00:00Z`));

    this.timeSlider = new this.TimeSlider({
      view: this.view,
      mode: 'instant',
      fullTimeExtent: { start, end },
      timeExtent: {
        start: new Date(`${currentWeek}T12:00:00Z`),
        end: new Date(`${currentWeek}T12:00:00Z`)
      },
      stops: { dates: stops },
      container: hostEl
    });

    this._timeWatch = this.timeSlider.watch('timeExtent', (extent) => {
      if (!extent?.start || !this.onWeekChange) return;
      const week = extent.start.toISOString().slice(0, 10);
      this.onWeekChange(week);
    });
  }

  setTimeSliderWeek(currentWeek) {
    if (!this.timeSlider) return;
    const d = new Date(`${currentWeek}T12:00:00Z`);
    this.timeSlider.timeExtent = { start: d, end: d };
  }

  destroyTimeSlider() {
    if (this._timeWatch) {
      this._timeWatch.remove();
      this._timeWatch = null;
    }
    if (this.timeSlider) {
      this.timeSlider.destroy();
      this.timeSlider = null;
    }
  }

  async applyAttributes(geoAttributesByPdq) {
    if (!this.layer) return;
    const updates = [];
    for (const graphic of this.featureTemplates) {
      const id = graphic.attributes.harmonized_pdq_id;
      const attrs = geoAttributesByPdq[id] || {};
      const comp = attrs.composition || [];
      const compAttrs = {};
      comp.forEach((c, i) => { compAttrs[`cat_${i}`] = c.count; });
      const compTotal = comp.reduce((s, c) => s + (c.count || 0), 0);
      const merged = {
        ...graphic.attributes,
        ...attrs,
        ...compAttrs,
        comp_total: compTotal
      };
      const hash = JSON.stringify({
        mapValue: merged.mapValue,
        observed: merged.observed,
        baseline: merged.baseline,
        deviation: merged.deviation,
        label: merged.label,
        comp_total: compTotal,
        cats: comp.map((c) => c.count)
      });
      if (this._attrHash[id] === hash) continue;
      this._attrHash[id] = hash;
      graphic.attributes = merged;
      updates.push(graphic);
    }
    if (!updates.length) return;
    await this.layer.applyEdits({ updateFeatures: updates });
    this._applyFeatureEffect();
  }

  async applyRenderer(rendererSpec, visualMode) {
    if (!this.layer) return;
    this._rendererSpec = rendererSpec;
    this._visualMode = visualMode;
    this.clearMapHover();
    await this._syncPdqPresentation();
  }

  async setSpvmFeatures(features, gisMode, gridResolution = 500, showGrid = false) {
    this._filteredFeatures = features || [];
    this._activeGisMode = gisMode || 'pdqAnalytics';
    this._gridHoverEnabled = showGrid === true && gisMode === 'grid';
    this._cancelMapHover();
    const GeoJSONLayer = await importArc('@arcgis/core/layers/GeoJSONLayer.js');

    if (this.spvmBlobUrl) {
      URL.revokeObjectURL(this.spvmBlobUrl);
      this.spvmBlobUrl = null;
    }
    if (this.spvmLayer) {
      this.view.map.remove(this.spvmLayer);
      this.spvmLayer = null;
    }
    if (this.gridLayer) {
      this.view.map.remove(this.gridLayer);
      this.gridLayer = null;
    }
    this._gridCells = [];

    const showSpvm = gisMode !== 'pdqAnalytics' && features?.length;
    if (!showSpvm && !showGrid) return;

    if (showSpvm) {
      const fc = { type: 'FeatureCollection', features };
      this.spvmBlobUrl = URL.createObjectURL(new Blob([JSON.stringify(fc)], { type: 'application/json' }));

      this.spvmLayer = new GeoJSONLayer({
        url: this.spvmBlobUrl,
        title: 'SPVM published reports',
        id: 'lab-spvm-recent',
        popupEnabled: false
      });

      await this.spvmLayer.load();
      applySpvmPresentation(this.spvmLayer, gisMode);
      this.view.map.add(this.spvmLayer);
      this._lastGisMode = gisMode;
      this.spvmLayer.visible = this.layerVisibility.recentReports !== false;
    }

    if ((gisMode === 'grid' && showGrid) && features?.length) {
      await this._buildGridLayer(features, gridResolution);
    }
  }

  /** Hide hover tooltip and disable grid hit-testing outside grid mode. */
  clearMapHover() {
    this._cancelMapHover();
    this._gridHoverEnabled = false;
  }

  _cancelMapHover() {
    clearTimeout(this._pointerMoveTimer);
    this._pointerMoveTimer = null;
    this._hoverToken += 1;
    this.hoverCard.hide();
  }

  destroyMapInteraction() {
    this._cancelMapHover();
    this._mapClickHandle?.remove();
    this._mapClickHandle = null;
    this._pointerMoveHandle?.remove();
    this._pointerMoveHandle = null;
    this._pointerLeaveHandle?.remove();
    this._pointerLeaveHandle = null;
    this.hoverCard.destroy();
    this.hoverCard = new LabHoverCard();
  }

  _sameLayer(layer, ref) {
    if (!layer || !ref) return false;
    return layer === ref || (layer.id && ref.id && layer.id === ref.id);
  }

  _findGraphic(results, layerRef, predicate) {
    if (!layerRef || !results?.length) return null;
    for (const result of results) {
      const graphic = result.graphic;
      if (!graphic || !this._sameLayer(graphic.layer, layerRef)) continue;
      if (!predicate || predicate(graphic)) return graphic;
    }
    return null;
  }

  _findPdqGraphic(results) {
    return this._findGraphic(results, this.layer, (g) => Boolean(g.attributes?.harmonized_pdq_id));
  }

  async _mapHitTest(event) {
    const options = {};
    if (this._caseBufferLayer) options.exclude = [this._caseBufferLayer];
    return this.view.hitTest(event, options);
  }

  _resolveGridCellAttributes(graphic) {
    if (!graphic?.attributes) return null;
    const attrs = graphic.attributes;
    const gridId = attrs.gridId;
    const fromCache = gridId
      ? this._gridCells.find((c) => c.id === gridId || c.attrs?.gridId === gridId)
      : null;
    const count = Number.isFinite(Number(attrs.count))
      ? Number(attrs.count)
      : (fromCache?.count ?? fromCache?.attrs?.count);
    const dominantCategory = attrs.dominantCategory ?? fromCache?.dom ?? fromCache?.attrs?.dominantCategory ?? '';
    if (!Number.isFinite(count) || count < 1) return null;
    return { count, dominantCategory };
  }

  _gridHoverLabel(dominantCategory) {
    const label = englishLabelForCategory(dominantCategory);
    if (!dominantCategory || label === '—') return 'No dominant category';
    return label;
  }

  _circleRing(lng, lat, radiusKm, points = 64) {
    const ring = [];
    const latRad = (lat * Math.PI) / 180;
    const mPerDegLat = 111320;
    const mPerDegLng = mPerDegLat * Math.cos(latRad);
    for (let i = 0; i <= points; i += 1) {
      const angle = (i / points) * 2 * Math.PI;
      const dx = (radiusKm * 1000 * Math.cos(angle)) / mPerDegLng;
      const dy = (radiusKm * 1000 * Math.sin(angle)) / mPerDegLat;
      ring.push([lng + dx, lat + dy]);
    }
    return ring;
  }

  async clearCaseInvestigation() {
    if (this._caseBufferLayer) this._caseBufferLayer.removeAll();
    if (this.caseLayer) this.caseLayer.removeAll();
    if (this._caseRelatedLayer) this._caseRelatedLayer.removeAll();
    this._caseRelatedByKey = {};
    this.clearMapHover();
  }

  _caseRelatedReport(recordKey) {
    return this._caseRelatedByKey[recordKey] || null;
  }

  _spvmHoverHtml(props) {
    if (!props?.category) return '';
    const pdqLine = props.pdq ? ` · PDQ ${escapeHtml(props.pdq)}` : '';
    return `<strong>${escapeHtml(englishLabelForCategory(props.category))}</strong><br/>${escapeHtml(props.date || '—')}${pdqLine}`;
  }

  async setCaseInvestigation(caseData, relatedReports = [], { selectedRecordKey = null, pinnedRecordKeys = [] } = {}) {
    if (!this.view || !caseData?.latitude) return;
    const GraphicsLayer = await importArc('@arcgis/core/layers/GraphicsLayer.js');
    const Point = await importArc('@arcgis/core/geometry/Point.js');

    if (!this._caseBufferLayer) {
      this._caseBufferLayer = new GraphicsLayer({
        title: 'Demo case buffer',
        listMode: 'hide',
        interactive: false
      });
      this.view.map.add(this._caseBufferLayer);
    }
    if (!this.caseLayer) {
      this.caseLayer = new GraphicsLayer({ title: 'Demo case (synthetic)', listMode: 'hide' });
      this.view.map.add(this.caseLayer);
    }
    if (!this._caseRelatedLayer) {
      this._caseRelatedLayer = new GraphicsLayer({ title: 'Case-related SPVM reports', listMode: 'hide' });
      this.view.map.add(this._caseRelatedLayer);
    }
    this._caseBufferLayer.removeAll();
    this.caseLayer.removeAll();
    this._caseRelatedLayer.removeAll();
    this._caseRelatedByKey = {};

    const lng = caseData.longitude;
    const lat = caseData.latitude;
    const radiusKm = caseData.searchRadiusKm || 1.5;

    this._caseBufferLayer.add(new this.Graphic({
      geometry: new this.Polygon({
        rings: [this._circleRing(lng, lat, radiusKm)],
        spatialReference: { wkid: 4326 }
      }),
      symbol: {
        type: 'simple-fill',
        color: [245, 158, 11, 0.12],
        outline: { color: [217, 119, 6, 0.85], width: 1.5, style: 'dash' }
      },
      attributes: { type: 'case-buffer', synthetic: true }
    }));

    this.caseLayer.add(new this.Graphic({
      geometry: new Point({ longitude: lng, latitude: lat, spatialReference: { wkid: 4326 } }),
      symbol: {
        type: 'simple-marker',
        style: 'diamond',
        color: [126, 34, 206, 0.95],
        size: 16,
        outline: { color: '#ffffff', width: 2.5 }
      },
      attributes: {
        type: 'case-location',
        synthetic: true,
        caseId: caseData.caseId || '',
        title: caseData.title || 'SYNTHETIC DEMO CASE'
      }
    }));

    for (const r of relatedReports) {
      const coords = r.feature?.geometry?.coordinates;
      if (!coords) continue;
      this._caseRelatedByKey[r.recordKey] = r;
      const isSel = r.recordKey === selectedRecordKey;
      const isPinned = pinnedRecordKeys.includes(r.recordKey);
      this._caseRelatedLayer.add(new this.Graphic({
        geometry: new Point({ longitude: coords[0], latitude: coords[1], spatialReference: { wkid: 4326 } }),
        symbol: {
          type: 'simple-marker',
          color: isSel ? [37, 99, 235, 0.95] : isPinned ? [5, 150, 105, 0.9] : [100, 116, 139, 0.85],
          size: isSel ? 10 : 7,
          outline: { color: '#fff', width: 1 }
        },
        attributes: { type: 'case-related', synthetic: true, recordKey: r.recordKey }
      }));
    }

    await this.view.goTo({ center: [lng, lat], zoom: 13 });
  }

  async _buildGridLayer(features, resolutionM) {
    const { features: gridFeatures, cells } = buildGridFromPoints(features, resolutionM);
    this._gridCells = cells;

    const graphics = gridFeatures.map((f, idx) => {
      const rings = f.geometry.coordinates;
      return new this.Graphic({
        geometry: new this.Polygon({ rings, spatialReference: { wkid: 4326 } }),
        attributes: {
          OBJECTID: idx + 1,
          ...f.properties
        }
      });
    });

    this.gridLayer = new this.FeatureLayer({
      source: graphics,
      title: 'Density grid',
      id: 'lab-grid',
      objectIdField: 'OBJECTID',
      geometryType: 'polygon',
      spatialReference: { wkid: 4326 },
      fields: [
        { name: 'OBJECTID', type: 'oid' },
        { name: 'gridId', type: 'string' },
        { name: 'count', type: 'integer' },
        { name: 'dominantCategory', type: 'string' }
      ],
      renderer: {
        type: 'class-breaks',
        field: 'count',
        defaultSymbol: {
          type: 'simple-fill',
          color: [226, 232, 240, 0.35],
          outline: { color: [100, 116, 139, 0.5], width: 0.5 }
        },
        classBreakInfos: [
          { minValue: 1, maxValue: 2, symbol: { type: 'simple-fill', color: [191, 219, 254, 0.55], outline: { color: '#64748b', width: 0.5 } } },
          { minValue: 3, maxValue: 5, symbol: { type: 'simple-fill', color: [96, 165, 250, 0.65], outline: { color: '#475569', width: 0.5 } } },
          { minValue: 6, maxValue: 999, symbol: { type: 'simple-fill', color: [37, 99, 235, 0.75], outline: { color: '#1e3a8a', width: 0.75 } } }
        ]
      },
      popupEnabled: false
    });

    this.view.map.add(this.gridLayer);
  }

  setSelection(selectedIds) {
    this.selectedIds = selectedIds || [];
    if (!this.view || !this.layer) return;
    for (const h of this.highlightHandles) h.remove();
    this.highlightHandles = [];

    this.view.whenLayerView(this.layer).then((lv) => {
      for (const id of this.selectedIds) {
        this.layer.queryFeatures({
          where: `harmonized_pdq_id = '${id.replace(/'/g, "''")}'`,
          returnGeometry: true,
          outFields: ['harmonized_pdq_id']
        }).then((res) => {
          if (res.features[0]) {
            this.highlightHandles.push(lv.highlight(res.features[0], {
              color: [37, 99, 235, 0.35],
              haloColor: [37, 99, 235, 0.9],
              haloOpacity: 0.9,
              fillOpacity: 0.25
            }));
          }
        });
      }
    });
    this._applyFeatureEffect();
  }

  async highlightRecord(record) {
    if (!record?.geometry?.coordinates || !this.spvmLayer) return;
    const [lng, lat] = record.geometry.coordinates;
    if (this.spvmHighlight) this.spvmHighlight.remove();
    const lv = await this.view.whenLayerView(this.spvmLayer);
    const Graphic = await importArc('@arcgis/core/Graphic.js');
    const Point = await importArc('@arcgis/core/geometry/Point.js');
    const g = new Graphic({
      geometry: new Point({ longitude: lng, latitude: lat }),
      attributes: record.properties
    });
    this.spvmHighlight = lv.highlight(g);
    await this.view.goTo({ center: [lng, lat], zoom: Math.max(this.view.zoom, 14) }, { duration: 400 });
  }

  clearRecordHighlight() {
    if (this.spvmHighlight) {
      this.spvmHighlight.remove();
      this.spvmHighlight = null;
    }
  }

  _applyFeatureEffect() {
    if (!this.layer) return;
    if (!this.selectedIds.length) {
      this.layer.featureEffect = null;
      return;
    }
    const quoted = this.selectedIds.map((id) => `'${id.replace(/'/g, "''")}'`).join(',');
    this.layer.featureEffect = {
      filter: { where: `harmonized_pdq_id IN (${quoted})` },
      includedEffect: 'drop-shadow(0 0 6px rgba(37,99,235,0.55))',
      excludedEffect: 'opacity(45%) saturate(60%)'
    };
  }

  async _onMapClick(event) {
    const hit = await this._mapHitTest(event);
    const results = hit.results || [];

    const caseLoc = this._findGraphic(results, this.caseLayer, (g) => g.attributes?.type === 'case-location');
    if (caseLoc && this.onCaseSelect) {
      this.onCaseSelect(caseLoc.attributes);
      return;
    }

    const caseG = this._findGraphic(results, this._caseRelatedLayer, (g) => Boolean(g.attributes?.recordKey));
    if (caseG?.attributes?.recordKey && this.onCaseRecordSelect) {
      this.onCaseRecordSelect(caseG.attributes.recordKey);
      return;
    }

    const gridG = this._findGraphic(results, this.gridLayer);
    if (gridG && this.onGridSelect) {
      const cell = this._gridCells.find((c) => c.id === gridG.attributes.gridId);
      this.onGridSelect(cell, gridG);
      return;
    }

    const spvmG = this._findGraphic(results, this.spvmLayer);
    if (spvmG?.attributes?.recordKey && this.onRecordSelect) {
      const rec = this._filteredFeatures.find((f) => f.properties.recordKey === spvmG.attributes.recordKey);
      if (rec) this.onRecordSelect(rec);
      return;
    }

    if (spvmG?.attributes?.cluster_count && this.spvmLayer) {
      const lv = await this.view.whenLayerView(this.spvmLayer);
      if (lv?.fetchClusterExpansionZoom) {
        const zoom = await lv.fetchClusterExpansionZoom(spvmG);
        await this.view.goTo({ target: spvmG, zoom });
      }
      return;
    }

    const arrondG = this._findGraphic(results, this.arrondLayer, (g) => Boolean(g.attributes?.arrondissement_id));
    if (arrondG && this.onArrondSelect) {
      this.onArrondSelect(arrondG.attributes.arrondissement_id, arrondG.attributes.name);
      return;
    }

    const poly = this._findPdqGraphic(results);
    if (poly?.attributes?.harmonized_pdq_id && this.onSelect) {
      this.onSelect(poly.attributes.harmonized_pdq_id, event.native?.shiftKey);
      return;
    }

    this.hoverCard.hide();
  }

  async _onPointerMove(event) {
    const token = this._hoverToken;
    const hit = await this._mapHitTest(event);
    if (token !== this._hoverToken) return;

    const ctx = this.getHoverContext?.() || {};
    const results = hit.results || [];

    const caseLoc = this._findGraphic(results, this.caseLayer, (g) => g.attributes?.type === 'case-location');
    if (caseLoc) {
      this.hoverCard.hide();
      return;
    }

    const caseRel = this._findGraphic(results, this._caseRelatedLayer, (g) => Boolean(g.attributes?.recordKey));
    if (caseRel) {
      const related = this._caseRelatedReport(caseRel.attributes.recordKey);
      const html = this._spvmHoverHtml(related?.feature?.properties);
      if (html) {
        this.hoverCard.show(html, event.x, event.y);
        return;
      }
    }

    if (this._gridHoverEnabled && this.gridLayer?.visible) {
      const gridG = this._findGraphic(results, this.gridLayer);
      if (gridG) {
        const resolved = this._resolveGridCellAttributes(gridG);
        if (resolved) {
          const domLabel = this._gridHoverLabel(resolved.dominantCategory);
          this.hoverCard.show(
            `<strong>Grid cell</strong><br/>${resolved.count} report${resolved.count === 1 ? '' : 's'}<br/>Dominant: ${escapeHtml(domLabel)}`,
            event.x,
            event.y
          );
          return;
        }
      }
    }

    const spvmG = this._findGraphic(results, this.spvmLayer, (g) => Boolean(g.attributes?.category));
    if (spvmG) {
      if (spvmG.attributes.cluster_count) {
        this.hoverCard.show(`<strong>Cluster</strong><br/>${spvmG.attributes.cluster_count} reports`, event.x, event.y);
        return;
      }
      const html = this._spvmHoverHtml(spvmG.attributes);
      if (html) {
        this.hoverCard.show(html, event.x, event.y);
        return;
      }
    }

    const arrondG = this._findGraphic(results, this.arrondLayer, (g) => Boolean(g.attributes?.name));
    if (arrondG) {
      const count = ctx.arrondCounts?.[arrondG.attributes.arrondissement_id];
      const extra = count != null ? `<br/>${count} filtered reports` : '';
      this.hoverCard.show(`<strong>${escapeHtml(arrondG.attributes.name)}</strong>${extra}`, event.x, event.y);
      return;
    }

    const poly = this._findPdqGraphic(results);
    if (poly) {
      const a = poly.attributes;
      const mode = ctx.mapMode || 'observed';
      let line2 = '';
      if (mode === 'composition' && ctx.categories) {
        const total = a.comp_total || 0;
        const rows = ctx.categories.map((cat, i) => {
          const c = a[`cat_${i}`] || 0;
          const pct = total ? Math.round((c / total) * 100) : 0;
          return `${escapeHtml(cat.label)}: ${c} (${pct}%)`;
        }).join('<br/>');
        this.hoverCard.show(`<strong>${escapeHtml(a.label_short)}</strong><br/>Total: ${total}<br/>${rows}`, event.x, event.y);
        return;
      }
      if (a.baseline != null) {
        line2 = `<br/>Recent expectation: ${Number(a.baseline).toFixed(1)}`;
      }
      const valLabel = mode === 'deviation' ? `Difference: ${Number(a.deviation || 0).toFixed(1)}` : `Reported: ${a.observed ?? 0}`;
      this.hoverCard.show(`<strong>PDQ ${escapeHtml(a.label_short)}</strong><br/>${valLabel}${line2}`, event.x, event.y);
      return;
    }

    if (token !== this._hoverToken) return;
    this.hoverCard.hide();
  }

  /** Programmatic map click for verification (same path as user click). */
  async simulateMapClick(x, y, native = {}) {
    await this._onMapClick({ x, y, native });
  }
}

function pointInRing(x, y, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];
    const intersect = ((yi > y) !== (yj > y)) && (x < ((xj - xi) * (y - yi)) / (yj - yi + 1e-12) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}
