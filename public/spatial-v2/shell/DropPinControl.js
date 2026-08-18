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
import { setInspectorRegion } from './ContextInspector.js';

const FOCUS_LAYER_ID = 'iqai-v2-spatial-focus';

function pointFromMapEvent(event) {
  const longitude = Number(event?.mapPoint?.longitude);
  const latitude = Number(event?.mapPoint?.latitude);
  if (!isGreaterMontrealLongitudeLatitude(longitude, latitude)) return null;
  return { longitude, latitude };
}

export function bindDropPinControl(root, options = {}) {
  const well = root?.querySelector('.iqai-v2-stage__well');
  const mapHost = root?.querySelector('[data-iqai-map-host]');
  const dropButton = root?.querySelector('[data-iqai-drop-pin]');
  const pointerNode = root?.querySelector('[data-iqai-pointer-coords]');
  const receiptNode = root?.querySelector('[data-iqai-spatial-focus-receipt]');

  let armed = false;
  let mapReady = false;
  let mapViewIdentity = null;
  let clickHandle = null;
  let moveHandle = null;
  let focusLayer = null;
  let placementGeneration = 0;

  function paintChrome() {
    const snapshot = getSpatialFocusSnapshot();
    if (well) well.classList.toggle('is-drop-pin', armed);
    if (mapHost) mapHost.classList.toggle('is-drop-pin', armed);
    if (dropButton) {
      dropButton.setAttribute('aria-pressed', armed ? 'true' : 'false');
      dropButton.classList.toggle('is-active', armed);
    }
    if (pointerNode) {
      if (snapshot.pointerText) {
        pointerNode.hidden = false;
        pointerNode.textContent = snapshot.pointerText;
      } else {
        pointerNode.hidden = true;
        pointerNode.textContent = '';
      }
    }
    if (receiptNode) {
      if (snapshot.focus) {
        receiptNode.hidden = false;
        receiptNode.innerHTML = `
          <p data-iqai-focus-address>${snapshot.focus.resolvedAddress || ADDRESS_NOT_RESOLVED}</p>
          <p data-iqai-focus-latitude>${formatLatitude(snapshot.focus.latitude) || ''}</p>
          <p data-iqai-focus-longitude>${formatLongitude(snapshot.focus.longitude) || ''}</p>
        `;
      } else {
        receiptNode.hidden = true;
        receiptNode.textContent = '';
      }
    }
    const focus = snapshot.focus;
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

  async function paintMarker(focus) {
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
    layer.add(new Graphic({
      geometry,
      symbol: {
        type: 'simple-marker',
        style: 'circle',
        color: [0, 0, 0, 0],
        size: 14,
        outline: { color: [244, 240, 234, 1], width: 2 }
      }
    }));
    layer.add(new Graphic({
      geometry,
      symbol: {
        type: 'simple-marker',
        style: 'circle',
        color: [20, 18, 15, 1],
        size: 4,
        outline: { color: [244, 240, 234, 1], width: 1 }
      }
    }));
    layer.add(new Graphic({
      geometry,
      symbol: {
        type: 'simple-marker',
        style: 'cross',
        color: [20, 18, 15, 1],
        size: 10,
        outline: { color: [20, 18, 15, 1], width: 1 }
      }
    }));
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
    paintChrome();
    void paintMarker(next);
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
    return resolved;
  }

  function attachMapView(view) {
    if (!view) return false;
    if (!mapViewIdentity) mapViewIdentity = view;
    mapReady = true;
    if (!moveHandle && typeof view.on === 'function') {
      moveHandle = view.on('pointer-move', (event) => {
        const mapPoint = view.toMap?.({ x: event.x, y: event.y });
        if (!mapPoint || !Number.isFinite(mapPoint.longitude) || !Number.isFinite(mapPoint.latitude)) {
          setPointerCoordinates(null, null);
        } else {
          setPointerCoordinates(mapPoint.longitude, mapPoint.latitude);
        }
        const text = getSpatialFocusSnapshot().pointerText;
        if (pointerNode) {
          if (text) {
            pointerNode.hidden = false;
            pointerNode.textContent = text;
          } else {
            pointerNode.hidden = true;
            pointerNode.textContent = '';
          }
        }
      });
    }
    if (!clickHandle && typeof view.on === 'function') {
      clickHandle = view.on('click', (event) => {
        if (!armed) return;
        const point = pointFromMapEvent(event);
        if (!point) return;
        void placeFocus(point.longitude, point.latitude, options.getActiveView?.() || 'map');
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
