/**
 * Governed MAP result overlay on the existing MapView.
 * Does not construct MapView. GraphicsLayer counts are not pixels.
 */

import { importArc } from './arcgis-sdk.js';
import { getMapView, getRuntimePlane } from './map-foundation.js';

export const GOVERNED_MAP_LAYER_ID = 'iqai-v2-governed-map-action';
export const GOVERNED_MAP_READOUT_ID = 'iqai-v2-governed-map-readout';

const SCOPE_FILL = [0, 168, 201, 0.08];
const SCOPE_LINE = [0, 168, 201, 0.95];
const HYDRANT_FILL = [196, 42, 28, 0.95];
const HYDRANT_OUTLINE = [244, 240, 234, 0.95];

function destination(lat, lon, distanceM, bearingDeg) {
  const δ = Number(distanceM) / 6378137;
  const θ = (Number(bearingDeg) * Math.PI) / 180;
  const φ1 = (Number(lat) * Math.PI) / 180;
  const λ1 = (Number(lon) * Math.PI) / 180;
  const φ2 = Math.asin(Math.sin(φ1) * Math.cos(δ) + Math.cos(φ1) * Math.sin(δ) * Math.cos(θ));
  const λ2 = λ1 + Math.atan2(
    Math.sin(θ) * Math.sin(δ) * Math.cos(φ1),
    Math.cos(δ) - Math.sin(φ1) * Math.sin(φ2)
  );
  return [ (λ2 * 180) / Math.PI, (φ2 * 180) / Math.PI ];
}

function scopeRing(latitude, longitude, radiusMeters, steps = 72) {
  const ring = [];
  for (let i = 0; i <= steps; i += 1) {
    ring.push(destination(latitude, longitude, radiusMeters, (360 * i) / steps));
  }
  return ring;
}

function ensureReadout(view, text) {
  const host = view?.container;
  if (!host || typeof document === 'undefined') return null;
  let node = host.querySelector(`#${GOVERNED_MAP_READOUT_ID}`);
  if (!node) {
    node = document.createElement('div');
    node.id = GOVERNED_MAP_READOUT_ID;
    node.setAttribute('data-iqai-governed-map-readout', 'true');
    host.appendChild(node);
  }
  node.hidden = !text;
  node.textContent = text || '';
  return node;
}

async function ensureLayer() {
  const view = getMapView();
  const plane = getRuntimePlane();
  if (!view || !plane) return null;
  const [GraphicsLayer, Graphic, Point, Polygon] = await Promise.all([
    importArc('@arcgis/core/layers/GraphicsLayer.js'),
    importArc('@arcgis/core/Graphic.js'),
    importArc('@arcgis/core/geometry/Point.js'),
    importArc('@arcgis/core/geometry/Polygon.js')
  ]);
  let layer = plane.layers?.find?.((item) => item.id === GOVERNED_MAP_LAYER_ID)
    || plane.layers?.toArray?.()?.find((item) => item.id === GOVERNED_MAP_LAYER_ID)
    || null;
  if (!layer) {
    layer = new GraphicsLayer({
      id: GOVERNED_MAP_LAYER_ID,
      title: 'Governed map action',
      listMode: 'hide'
    });
    plane.add(layer);
  }
  layer.__iqaiGraphic = Graphic;
  layer.__iqaiPoint = Point;
  layer.__iqaiPolygon = Polygon;
  plane.visible = true;
  return layer;
}

function formatDistanceMeters(value) {
  const meters = Number(value);
  if (!Number.isFinite(meters)) return 'UNKNOWN';
  return `${meters.toFixed(1)} M`;
}

async function paintNearest(view, layer, result) {
  const Graphic = layer.__iqaiGraphic;
  const Point = layer.__iqaiPoint;
  const Polyline = await importArc('@arcgis/core/geometry/Polyline.js');
  const here = result?.here;
  const nearest = result?.nearest || null;
  const hit = result?.hits?.[0];
  const coords = hit?.feature?.geometry?.coordinates;
  const hydrantLon = Number.isFinite(Number(nearest?.longitude))
    ? Number(nearest.longitude)
    : (Array.isArray(coords) ? Number(coords[0]) : NaN);
  const hydrantLat = Number.isFinite(Number(nearest?.latitude))
    ? Number(nearest.latitude)
    : (Array.isArray(coords) ? Number(coords[1]) : NaN);
  if (here && Number.isFinite(Number(here.longitude)) && Number.isFinite(Number(here.latitude))) {
    layer.add(new Graphic({
      geometry: new Point({
        longitude: here.longitude,
        latitude: here.latitude,
        spatialReference: { wkid: 4326 }
      }),
      attributes: { kind: 'here' },
      symbol: {
        type: 'simple-marker',
        style: 'cross',
        color: SCOPE_LINE,
        size: 12,
        outline: { color: [20, 18, 16, 0.9], width: 1 }
      }
    }));
  }
  if (
    here
    && Number.isFinite(Number(here.longitude))
    && Number.isFinite(Number(here.latitude))
    && Number.isFinite(hydrantLon)
    && Number.isFinite(hydrantLat)
  ) {
    layer.add(new Graphic({
      geometry: new Polyline({
        paths: [[[here.longitude, here.latitude], [hydrantLon, hydrantLat]]],
        spatialReference: { wkid: 4326 }
      }),
      attributes: { kind: 'connector', distanceMeters: nearest?.distanceMeters ?? hit?.distanceMeters },
      symbol: {
        type: 'simple-line',
        color: SCOPE_LINE,
        width: 2
      }
    }));
    const midLon = (Number(here.longitude) + hydrantLon) / 2;
    const midLat = (Number(here.latitude) + hydrantLat) / 2;
    layer.add(new Graphic({
      geometry: new Point({
        longitude: midLon,
        latitude: midLat,
        spatialReference: { wkid: 4326 }
      }),
      attributes: { kind: 'distance-label' },
      symbol: {
        type: 'text',
        color: SCOPE_LINE,
        haloColor: [20, 18, 16, 0.92],
        haloSize: 1.2,
        text: formatDistanceMeters(nearest?.distanceMeters ?? hit?.distanceMeters),
        font: { size: 10, weight: 'bold', family: 'Avenir Next, sans-serif' }
      }
    }));
  }
  if (Number.isFinite(hydrantLon) && Number.isFinite(hydrantLat)) {
    layer.add(new Graphic({
      geometry: new Point({
        longitude: hydrantLon,
        latitude: hydrantLat,
        spatialReference: { wkid: 4326 }
      }),
      attributes: {
        kind: 'hydrant',
        sourceId: nearest?.sourceId || hit?.sourceId,
        assetId: nearest?.assetId || null,
        distanceMeters: nearest?.distanceMeters ?? hit?.distanceMeters
      },
      symbol: {
        type: 'simple-marker',
        style: 'circle',
        color: HYDRANT_FILL,
        size: 14,
        outline: { color: HYDRANT_OUTLINE, width: 1.6 }
      }
    }));
  }
  const identity = nearest?.assetId || nearest?.sourceId || hit?.sourceId || 'UNKNOWN';
  const readout = [
    result?.confirmationTitle || 'SHOW NEAREST HYDRANT',
    `ID_BI ${identity}`,
    nearest?.address ? String(nearest.address) : null,
    `${formatDistanceMeters(nearest?.distanceMeters ?? hit?.distanceMeters)} FROM HERE`,
    result?.source?.provider && result?.source?.dataset
      ? `${result.source.provider} · ${result.source.dataset}`
      : null
  ].filter(Boolean).join('\n');
  ensureReadout(view, readout);
  if (view && here && Number.isFinite(hydrantLon) && Number.isFinite(hydrantLat) && typeof view.goTo === 'function') {
    const distanceMeters = Number(nearest?.distanceMeters ?? hit?.distanceMeters) || 80;
    await Promise.race([
      view.goTo({
        center: [
          (Number(here.longitude) + hydrantLon) / 2,
          (Number(here.latitude) + hydrantLat) / 2
        ],
        scale: Math.max(900, distanceMeters * 28)
      }, { animate: false }),
      new Promise((resolve) => setTimeout(resolve, 1200))
    ]).catch(() => {});
  }
  return {
    painted: true,
    layerId: GOVERNED_MAP_LAYER_ID,
    graphicCount: layer.graphics?.length ?? null
  };
}

export async function paintGovernedMapAction(result) {
  const view = getMapView();
  const layer = await ensureLayer();
  if (!layer) return { painted: false, reason: 'MAP_VIEW_NOT_READY' };
  layer.removeAll?.();
  if (result?.operation === 'NEAREST') {
    return paintNearest(view, layer, result);
  }
  const Graphic = layer.__iqaiGraphic;
  const Point = layer.__iqaiPoint;
  const Polygon = layer.__iqaiPolygon;
  const here = result?.here;
  const radiusMeters = Number(result?.radiusMeters);
  if (here && Number.isFinite(Number(here.longitude)) && Number.isFinite(Number(here.latitude)) && Number.isFinite(radiusMeters)) {
    const polygon = new Polygon({
      rings: [scopeRing(here.latitude, here.longitude, radiusMeters)],
      spatialReference: { wkid: 4326 }
    });
    layer.add(new Graphic({
      geometry: polygon,
      attributes: { kind: 'scope', radiusMeters },
      symbol: {
        type: 'simple-fill',
        color: SCOPE_FILL,
        outline: { color: SCOPE_LINE, width: 2 }
      }
    }));
    layer.add(new Graphic({
      geometry: new Point({
        longitude: here.longitude,
        latitude: here.latitude,
        spatialReference: { wkid: 4326 }
      }),
      attributes: { kind: 'here' },
      symbol: {
        type: 'simple-marker',
        style: 'cross',
        color: SCOPE_LINE,
        size: 10,
        outline: { color: [20, 18, 16, 0.9], width: 1 }
      }
    }));
    const labelAt = destination(here.latitude, here.longitude, radiusMeters, 0);
    layer.add(new Graphic({
      geometry: new Point({
        longitude: labelAt[0],
        latitude: labelAt[1],
        spatialReference: { wkid: 4326 }
      }),
      symbol: {
        type: 'text',
        color: SCOPE_LINE,
        haloColor: [20, 18, 16, 0.92],
        haloSize: 1.2,
        text: `${Math.round(radiusMeters)} M`,
        font: { size: 10, weight: 'bold', family: 'Avenir Next, sans-serif' }
      }
    }));
  }
  for (const hit of result?.hits || []) {
    const coords = hit?.feature?.geometry?.coordinates;
    if (!Array.isArray(coords) || coords.length < 2) continue;
    layer.add(new Graphic({
      geometry: new Point({
        longitude: Number(coords[0]),
        latitude: Number(coords[1]),
        spatialReference: { wkid: 4326 }
      }),
      attributes: {
        kind: 'hydrant',
        sourceId: hit.sourceId,
        distanceMeters: hit.distanceMeters
      },
      symbol: {
        type: 'simple-marker',
        style: 'circle',
        color: HYDRANT_FILL,
        size: 9,
        outline: { color: HYDRANT_OUTLINE, width: 1.2 }
      }
    }));
  }
  const readout = [
    result?.confirmationTitle || 'SHOW HYDRANTS WITHIN 500 M',
    `${Number(result?.count) || 0} HYDRANTS`,
    result?.source?.provider && result?.source?.dataset
      ? `${result.source.provider} · ${result.source.dataset}`
      : null
  ].filter(Boolean).join('\n');
  ensureReadout(view, readout);
  if (view && here && typeof view.goTo === 'function') {
    await Promise.race([
      view.goTo({
        center: [here.longitude, here.latitude],
        scale: Math.max(3000, radiusMeters * 12)
      }, { animate: false }),
      new Promise((resolve) => setTimeout(resolve, 1200))
    ]).catch(() => {});
  }
  return {
    painted: true,
    layerId: GOVERNED_MAP_LAYER_ID,
    graphicCount: layer.graphics?.length ?? null
  };
}

export function snapshotGovernedMapOverlay() {
  const view = getMapView();
  const plane = getRuntimePlane();
  const layer = plane?.layers?.find?.((item) => item.id === GOVERNED_MAP_LAYER_ID)
    || plane?.layers?.toArray?.()?.find((item) => item.id === GOVERNED_MAP_LAYER_ID)
    || null;
  const graphics = layer?.graphics?.toArray?.() || [];
  const readout = view?.container?.querySelector?.(`#${GOVERNED_MAP_READOUT_ID}`);
  return {
    layerId: layer?.id || null,
    graphicCount: graphics.length,
    scopePresent: graphics.some((item) => item.attributes?.kind === 'scope' || item.attributes?.radiusMeters),
    hydrantCount: graphics.filter((item) => item.attributes?.kind === 'hydrant').length,
    connectorPresent: graphics.some((item) => item.attributes?.kind === 'connector'),
    readout: readout?.textContent || null
  };
}

export function clearGovernedMapOverlay() {
  const plane = getRuntimePlane();
  const layer = plane?.layers?.find?.((item) => item.id === GOVERNED_MAP_LAYER_ID)
    || plane?.layers?.toArray?.()?.find((item) => item.id === GOVERNED_MAP_LAYER_ID)
    || null;
  layer?.removeAll?.();
  getMapView()?.container?.querySelector?.(`#${GOVERNED_MAP_READOUT_ID}`)?.remove?.();
}
