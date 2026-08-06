/**
 * Vessel symbol graphics for IQAI Spatial V2.
 */
import { normalizeToWgs84Pair } from '../ocean-view-helpers.js';
const GLYPH_URL = '/assets/vessel/vespucci-glyph.svg';
const DETAIL_URL = '/assets/vessel/vespucci-detail.svg';
const DETAIL_ZOOM = 9;

const FRESHNESS_COLORS = {
  LIVE: [46, 204, 113, 0.9],
  DELAYED: [241, 196, 15, 0.9],
  STALE: [231, 76, 60, 0.9],
  LAST_KNOWN: [149, 165, 166, 0.9],
  UNVERIFIED: [127, 140, 141, 0.7]
};

export function prefersReducedMotion() {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
}

export async function createVesselGraphics(modules, mapData, config, lastHeading) {
  const {
    Graphic, Point, Polyline, SimpleMarkerSymbol, SimpleLineSymbol, PictureMarkerSymbol
  } = modules;
  const v = mapData?.vessel;
  const rawCoords = v?.geojson?.features?.[0]?.geometry?.coordinates;
  const props = v?.properties || {};
  const pair = rawCoords ? normalizeToWgs84Pair(rawCoords[0], rawCoords[1], props) : null;
  if (!pair) return { graphics: [], heading: lastHeading };

  const [lon, lat] = pair;
  const heading = resolveDisplayHeading(props, lastHeading);
  const freshness = v.freshness || 'UNVERIFIED';
  const zoom = 7;
  const useDetail = zoom >= DETAIL_ZOOM;
  const size = useDetail ? '64px' : '32px';
  const url = useDetail ? DETAIL_URL : GLYPH_URL;

  const vesselGraphic = new Graphic({
    id: 'vespucci-vessel',
    geometry: new Point({ longitude: lon, latitude: lat }),
    symbol: new PictureMarkerSymbol({
      url,
      width: size,
      height: size,
      angle: heading.heading,
      angleAlignment: 'map'
    }),
    attributes: {
      type: 'vessel',
      freshness,
      headingUnknown: heading.unknown
    }
  });

  const graphics = [vesselGraphic];
  const ringColor = FRESHNESS_COLORS[freshness] || FRESHNESS_COLORS.UNVERIFIED;
  graphics.push(new Graphic({
    id: 'vespucci-freshness-ring',
    geometry: new Point({ longitude: lon, latitude: lat }),
    symbol: new SimpleMarkerSymbol({
      style: 'circle',
      color: [0, 0, 0, 0],
      size: useDetail ? 22 : 14,
      outline: { color: ringColor, width: 2 }
    })
  }));

  const course = Number(props.Course ?? props.course);
  const speed = Number(props.SpeedKnots ?? props.speedKnots);
  if (Number.isFinite(course) && Number.isFinite(speed) && speed > 0) {
    const end = projectCog(lon, lat, course, speed, 15);
    if (end) {
      graphics.push(new Graphic({
        id: 'vespucci-cog-vector',
        geometry: new Polyline({
          paths: [[[lon, lat], [end.longitude, end.latitude]]]
        }),
        symbol: new SimpleLineSymbol({ color: [255, 215, 0, 0.85], width: 2, style: 'dash' })
      }));
    }
  }

  const destFeature = mapData.destination?.geojson?.features?.[0];
  const dest = destFeature
    ? normalizeToWgs84Pair(
      destFeature.geometry.coordinates[0],
      destFeature.geometry.coordinates[1],
      destFeature.properties || {}
    )
    : null;
  if (dest) {
    graphics.push(new Graphic({
      id: 'vespucci-destination',
      geometry: new Point({ longitude: dest[0], latitude: dest[1] }),
      symbol: new SimpleMarkerSymbol({
        style: 'diamond',
        color: [255, 215, 0, 0.95],
        size: 12,
        outline: { color: [20, 30, 48, 1], width: 1.5 }
      })
    }));
  }

  const travelledFeature = mapData.travelledRoute?.geojson?.features?.[0];
  const travelled = travelledFeature?.geometry?.coordinates?.map((vertex) => {
    if (Array.isArray(vertex)) {
      return normalizeToWgs84Pair(vertex[0], vertex[1], travelledFeature.properties || {});
    }
    if (typeof vertex === 'string') {
      const parts = vertex.trim().split(/\s+/);
      return normalizeToWgs84Pair(Number(parts[0]), Number(parts[1]), travelledFeature.properties || {});
    }
    return null;
  }).filter(Boolean);
  if (travelled?.length) {
    graphics.push(new Graphic({
      id: 'vespucci-trail',
      geometry: new Polyline({ paths: [travelled] }),
      symbol: new SimpleLineSymbol({ color: [120, 200, 255, 0.9], width: 3 })
    }));
  }

  const estimatedFeature = mapData.estimatedRoute?.geojson?.features?.[0];
  const estimated = estimatedFeature?.geometry?.coordinates?.map((vertex) => {
    if (Array.isArray(vertex)) {
      return normalizeToWgs84Pair(vertex[0], vertex[1], estimatedFeature.properties || {});
    }
    if (typeof vertex === 'string') {
      const parts = vertex.trim().split(/\s+/);
      return normalizeToWgs84Pair(Number(parts[0]), Number(parts[1]), estimatedFeature.properties || {});
    }
    return null;
  }).filter(Boolean);
  if (estimated?.length) {
    graphics.push(new Graphic({
      id: 'vespucci-route-estimated',
      geometry: new Polyline({ paths: [estimated] }),
      symbol: new SimpleLineSymbol({ color: [255, 215, 0, 0.75], width: 2, style: 'dash' })
    }));
  }

  return { graphics, heading: heading.heading };
}

function resolveDisplayHeading(props, lastHeading) {
  const heading = Number(props.Heading ?? props.heading);
  const course = Number(props.Course ?? props.course);
  if (Number.isFinite(heading) && heading !== 511 && heading >= 0 && heading <= 360) {
    return { heading, unknown: false };
  }
  if (Number.isFinite(course) && course >= 0 && course <= 360) {
    return { heading: course, unknown: false };
  }
  if (Number.isFinite(lastHeading)) return { heading: lastHeading, unknown: true };
  return { heading: 0, unknown: true };
}

function projectCog(lon, lat, courseDeg, speedKnots, minutes) {
  const distanceNM = speedKnots * (minutes / 60);
  const R = 3440.065;
  const br = courseDeg * Math.PI / 180;
  const lat1 = lat * Math.PI / 180;
  const lon1 = lon * Math.PI / 180;
  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(distanceNM / R)
    + Math.cos(lat1) * Math.sin(distanceNM / R) * Math.cos(br));
  const lon2 = lon1 + Math.atan2(
    Math.sin(br) * Math.sin(distanceNM / R) * Math.cos(lat1),
    Math.cos(distanceNM / R) - Math.sin(lat1) * Math.sin(lat2)
  );
  return { latitude: lat2 * 180 / Math.PI, longitude: lon2 * 180 / Math.PI };
}
