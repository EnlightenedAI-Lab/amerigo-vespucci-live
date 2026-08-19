import { isGreaterMontrealLongitudeLatitude } from '../../spatial/montreal-operational-config.js';
import { importArc } from '../map/arcgis-sdk.js';
import {
  getMapView,
  getRuntimePlane
} from '../map/map-foundation.js';
import {
  ADDRESS_NOT_RESOLVED,
  SPATIAL_FOCUS_ADDRESS_STATE,
  SPATIAL_FOCUS_SOURCE_TYPE,
  formatLatitude,
  formatLongitude,
  getActiveSpatialFocus,
  getSpatialFocusSnapshot,
  reverseGeocodeFocus,
  setActiveSpatialFocus,
  setPointerCoordinates,
  subscribeSpatialFocus
} from '../map/spatial-focus.js';
import { liveCursorReadout, scheduleCursorDwell } from '../map/spatial-cursor.js';
import { setInspectorRegion } from './ContextInspector.js';

const FOCUS_LAYER_ID = 'iqai-v2-spatial-focus';
const CRS_LABEL = 'EPSG:4326';

function pointFromMapEvent(event) {
  const longitude = Number(event?.mapPoint?.longitude);
  const latitude = Number(event?.mapPoint?.latitude);
  if (!isGreaterMontrealLongitudeLatitude(longitude, latitude)) return null;
  return { longitude, latitude };
}

function formatMapScale(scale) {
  const value = Number(scale);
  if (!Number.isFinite(value) || value <= 0) return null;
  return `1 : ${Math.round(value).toLocaleString('en-US')}`;
}

function collapsedLine(formats, elevation) {
  if (!formats?.dd) return '';
  const parts = [formats.dd];
  const meters = elevation || formats.elevation;
  if (meters) parts.push(`EL ${String(meters).replace(/^EL\s+/, '')}`);
  parts.push(CRS_LABEL);
  return parts.join('   |   ');
}

export function bindDropPinControl(root, options = {}) {
  const well = root?.querySelector('.iqai-v2-stage__well');
  const mapHost = root?.querySelector('[data-iqai-map-host]');
  const dropButton = root?.querySelector('[data-iqai-drop-pin]');
  const pointerNode = root?.querySelector('[data-iqai-pointer-coords]');
  const receiptNode = root?.querySelector('[data-iqai-spatial-focus-receipt]');
  const cursorNode = root?.querySelector('[data-iqai-precision-cursor]');
  const toggleNode = cursorNode?.querySelector('[data-iqai-precision-toggle]');
  const detailNode = cursorNode?.querySelector('[data-iqai-precision-detail]');
  const liveNode = cursorNode?.querySelector('[data-iqai-cursor-live]');
  const scaleNode = cursorNode?.querySelector('[data-iqai-map-scale]');
  const placeNode = cursorNode?.querySelector('[data-iqai-cursor-place]');

  let armed = false;
  let mapReady = false;
  let mapViewIdentity = null;
  let clickHandle = null;
  let moveHandle = null;
  let scaleHandle = null;
  let focusLayer = null;
  let placementGeneration = 0;
  let lastLiveFormats = null;
  let lastElevation = null;
  let dwellPlace = null;
  let expanded = false;
  let pulseTimer = null;

  function setExpanded(next) {
    expanded = next === true;
    if (cursorNode) {
      cursorNode.dataset.iqaiPrecisionExpanded = expanded ? 'true' : 'false';
      cursorNode.classList.toggle('is-expanded', expanded);
    }
    if (toggleNode) toggleNode.setAttribute('aria-expanded', expanded ? 'true' : 'false');
    if (detailNode) detailNode.hidden = !expanded;
  }

  function paintScale(view) {
    if (!scaleNode) return;
    const label = formatMapScale(view?.scale);
    if (!label) {
      scaleNode.hidden = true;
      scaleNode.textContent = '';
      return;
    }
    scaleNode.hidden = false;
    scaleNode.textContent = label;
  }

  function paintCursorHud(formats, { showPlace = false } = {}) {
    if (!cursorNode) return;
    if (!formats && !scaleNode?.textContent) {
      cursorNode.hidden = true;
      return;
    }
    if (formats) lastLiveFormats = formats;
    if (formats?.elevation) lastElevation = formats.elevation;
    cursorNode.hidden = false;
    const live = lastLiveFormats;
    if (liveNode) liveNode.textContent = collapsedLine(live, lastElevation);
    const set = (name, value) => {
      const node = cursorNode.querySelector(`[data-iqai-cursor-${name}]`);
      if (!node) return;
      if (!value) {
        node.hidden = true;
        node.textContent = '';
        return;
      }
      node.hidden = false;
      node.textContent = value;
    };
    set('dd', live?.dd ? `DD  ${live.dd}` : '');
    set('dms', live?.dms ? `DMS  ${live.dms}` : '');
    set('utm', live?.utm ? `UTM  ${live.utm}` : '');
    set('mgrs', live?.mgrs ? `MGRS  ${live.mgrs}` : '');
    set('elev', lastElevation ? `EL  ${String(lastElevation).replace(/^EL\s+/, '')}` : '');
    const crs = cursorNode.querySelector('[data-iqai-cursor-crs]');
    if (crs) crs.textContent = CRS_LABEL;
    if (placeNode) {
      const place = showPlace ? (formats?.place || dwellPlace) : null;
      if (place) {
        placeNode.hidden = false;
        placeNode.textContent = place;
      } else {
        placeNode.hidden = true;
        placeNode.textContent = '';
      }
    }
    if (detailNode) detailNode.hidden = !expanded;
  }

  function paintChrome() {
    const snapshot = getSpatialFocusSnapshot();
    if (well) well.classList.toggle('is-drop-pin', armed);
    if (mapHost) mapHost.classList.toggle('is-drop-pin', armed);
    if (dropButton) {
      dropButton.setAttribute('aria-pressed', armed ? 'true' : 'false');
      dropButton.classList.toggle('is-active', armed);
    }
    paintCursorHud(lastLiveFormats || snapshot.pointerFormats, { showPlace: Boolean(dwellPlace) });
    paintScale(getMapView());
    if (pointerNode) {
      pointerNode.hidden = true;
      pointerNode.textContent = snapshot.pointerText || '';
    }
    if (receiptNode) {
      if (snapshot.focus) {
        receiptNode.hidden = false;
        receiptNode.innerHTML = `<p data-iqai-focus-address>${snapshot.focus.resolvedAddress || ADDRESS_NOT_RESOLVED}</p>`;
      } else {
        receiptNode.hidden = true;
        receiptNode.textContent = '';
      }
    }
    const focus = snapshot.focus;
    if (!options.hasAcquiredObject?.()) {
      setInspectorRegion(root, 'selected-object-slot', {
        stateLabel: focus ? 'ACTIVE SPATIAL FOCUS' : 'RESERVED',
        body: focus
          ? [
              'ACTIVE SPATIAL FOCUS',
              `ADDRESS / PLACE: ${focus.resolvedAddress || ADDRESS_NOT_RESOLVED}`,
              `LATITUDE: ${formatLatitude(focus.latitude)}`,
              `LONGITUDE: ${formatLongitude(focus.longitude)}`,
              `sourceType: ${focus.sourceType}`,
              `sourceView: ${focus.sourceView}`,
              `updatedAt: ${focus.updatedAt}`
            ].join('\n')
          : 'No operator spatial focus. Use DROP PIN to choose a place.'
      });
    }
  }

  async function ensureFocusLayer() {
    const view = getMapView();
    const plane = getRuntimePlane();
    if (!view || !plane || focusLayer) return focusLayer;
    const [GraphicsLayer, Graphic, Point] = await Promise.all([
      importArc('@arcgis/core/layers/GraphicsLayer.js'),
      importArc('@arcgis/core/Graphic.js'),
      importArc('@arcgis/core/geometry/Point.js')
    ]);
    focusLayer = plane.layers.find?.((layer) => layer.id === FOCUS_LAYER_ID)
      || plane.layers?.toArray?.()?.find((layer) => layer.id === FOCUS_LAYER_ID)
      || null;
    if (!focusLayer) {
      focusLayer = new GraphicsLayer({
        id: FOCUS_LAYER_ID,
        title: 'Spatial focus',
        listMode: 'hide'
      });
      focusLayer.__iqaiGraphic = Graphic;
      focusLayer.__iqaiPoint = Point;
      plane.add(focusLayer);
    } else {
      focusLayer.__iqaiGraphic = focusLayer.__iqaiGraphic || Graphic;
      focusLayer.__iqaiPoint = focusLayer.__iqaiPoint || Point;
    }
    plane.visible = true;
    return focusLayer;
  }

  async function paintMarker(focus, { pulse = false } = {}) {
    const layer = await ensureFocusLayer();
    if (!layer) return;
    layer.removeAll?.();
    if (!focus) return;
    const Graphic = layer.__iqaiGraphic;
    const Point = layer.__iqaiPoint;
    const geometry = new Point({
      longitude: focus.longitude,
      latitude: focus.latitude,
      spatialReference: { wkid: 4326 }
    });
    const rings = [
      { size: 26, width: 0.9, color: [244, 240, 234, 0.28] },
      { size: 14, width: 1.15, color: [244, 240, 234, 0.92] }
    ];
    for (const ring of rings) {
      layer.add(new Graphic({
        geometry,
        symbol: {
          type: 'simple-marker',
          style: 'circle',
          color: [0, 0, 0, 0],
          size: ring.size,
          outline: { color: ring.color, width: ring.width }
        }
      }));
    }
    layer.add(new Graphic({
      geometry,
      symbol: {
        type: 'simple-marker',
        style: 'cross',
        color: [244, 240, 234, 1],
        size: 11,
        outline: { color: [20, 18, 15, 1], width: 1 }
      }
    }));
    layer.add(new Graphic({
      geometry,
      symbol: {
        type: 'simple-marker',
        style: 'circle',
        color: [244, 240, 234, 1],
        size: 3,
        outline: { color: [20, 18, 15, 1], width: 1 }
      }
    }));
    if (pulse) {
      const pulseGraphic = new Graphic({
        geometry,
        symbol: {
          type: 'simple-marker',
          style: 'circle',
          color: [0, 0, 0, 0],
          size: 40,
          outline: { color: [244, 240, 234, 0.55], width: 1 }
        }
      });
      layer.add(pulseGraphic);
      if (pulseTimer) clearTimeout(pulseTimer);
      pulseTimer = setTimeout(() => {
        try { layer.remove?.(pulseGraphic); } catch { /* graphic may already be gone */ }
      }, 420);
    }
  }

  async function placeFocus(longitude, latitude, sourceView = 'map') {
    const next = setActiveSpatialFocus({
      longitude,
      latitude,
      sourceView,
      sourceType: SPATIAL_FOCUS_SOURCE_TYPE.DROP_PIN,
      source: 'drop-pin',
      updatedAt: new Date().toISOString(),
      resolvedAddress: null,
      addressState: SPATIAL_FOCUS_ADDRESS_STATE.PENDING
    });
    armed = false;
    dwellPlace = null;
    paintChrome();
    void paintMarker(next, { pulse: true });
    options.onPlaced?.(next);
    const token = ++placementGeneration;
    const geocode = await reverseGeocodeFocus(longitude, latitude);
    if (token !== placementGeneration) return getActiveSpatialFocus();
    const current = getActiveSpatialFocus();
    if (!current
      || current.longitude !== next.longitude
      || current.latitude !== next.latitude) {
      return current;
    }
    const resolved = setActiveSpatialFocus({
      ...current,
      resolvedAddress: geocode.ok ? geocode.resolvedAddress : null,
      addressState: geocode.ok
        ? SPATIAL_FOCUS_ADDRESS_STATE.RESOLVED
        : SPATIAL_FOCUS_ADDRESS_STATE.NOT_RESOLVED
    });
    paintChrome();
    options.onPlaced?.(resolved);
    return resolved;
  }

  function attachMapView(view) {
    if (!view) return false;
    if (!mapViewIdentity) mapViewIdentity = view;
    mapReady = true;
    paintScale(view);
    if (!scaleHandle && typeof view.watch === 'function') {
      scaleHandle = view.watch('scale', () => paintScale(view));
    }
    if (!moveHandle && typeof view.on === 'function') {
      moveHandle = view.on('pointer-move', (event) => {
        const mapPoint = view.toMap?.({ x: event.x, y: event.y });
        paintScale(view);
        if (!mapPoint || !Number.isFinite(mapPoint.longitude) || !Number.isFinite(mapPoint.latitude)) {
          setPointerCoordinates(null, null);
          dwellPlace = null;
          paintCursorHud(lastLiveFormats);
          return;
        }
        setPointerCoordinates(mapPoint.longitude, mapPoint.latitude);
        dwellPlace = null;
        const live = liveCursorReadout(mapPoint.latitude, mapPoint.longitude);
        paintCursorHud(live, { showPlace: false });
        scheduleCursorDwell(mapPoint.longitude, mapPoint.latitude, (resolved) => {
          if (!resolved) return;
          if (resolved.elevation) lastElevation = resolved.elevation;
          dwellPlace = resolved.place || null;
          paintCursorHud({
            ...resolved,
            elevation: resolved.elevation || lastElevation
          }, { showPlace: Boolean(dwellPlace) && !getActiveSpatialFocus() });
        });
      });
    }
    if (!clickHandle && typeof view.on === 'function') {
      clickHandle = view.on('click', (event) => {
        if (armed) {
          const point = pointFromMapEvent(event);
          if (!point) return;
          void placeFocus(point.longitude, point.latitude, options.getActiveView?.() || 'map');
          return;
        }
        const longitude = Number(event?.mapPoint?.longitude);
        const latitude = Number(event?.mapPoint?.latitude);
        if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) return;
        scheduleCursorDwell(longitude, latitude, (resolved) => {
          if (!resolved) return;
          if (resolved.elevation) lastElevation = resolved.elevation;
          dwellPlace = resolved.place || null;
          paintCursorHud(resolved, { showPlace: Boolean(dwellPlace) && !getActiveSpatialFocus() });
        });
      });
    }
    paintChrome();
    return true;
  }

  async function arm() {
    if (options.getActiveView?.() && options.getActiveView() !== 'map') {
      await options.returnToMap?.();
    }
    armed = true;
    paintChrome();
    return snapshot();
  }

  function disarm() {
    armed = false;
    paintChrome();
    return snapshot();
  }

  async function toggle() {
    if (armed) return disarm();
    return arm();
  }

  function snapshot() {
    const current = getSpatialFocusSnapshot();
    return {
      ...current,
      armed,
      mapReady
    };
  }

  dropButton?.addEventListener('click', (event) => {
    event.preventDefault();
    void toggle();
  });
  toggleNode?.addEventListener('click', (event) => {
    event.preventDefault();
    setExpanded(!expanded);
  });
  cursorNode?.addEventListener('mouseenter', () => {
    if (detailNode && !expanded) detailNode.hidden = false;
  });
  cursorNode?.addEventListener('mouseleave', () => {
    if (detailNode && !expanded) detailNode.hidden = true;
  });
  subscribeSpatialFocus(() => paintChrome());
  paintChrome();

  return Object.freeze({
    arm,
    disarm,
    toggle,
    setMapReady(ready) {
      mapReady = Boolean(ready);
      if (mapReady) attachMapView(getMapView());
      paintChrome();
      return snapshot();
    },
    placeFocus,
    snapshot,
    paint: paintChrome
  });
}
