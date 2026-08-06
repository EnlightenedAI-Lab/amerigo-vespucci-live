import { classifyFreshness, positionAgeSeconds } from '../../src/freshness.js';
import { CONDITIONS_ATTRIBUTION, CONDITIONS_BASIS } from '../../src/openmeteo.js';
import { ESTIMATED_ROUTE_BASIS } from '../../src/navigation.js';

/** Demo MMSI for Amerigo Vespucci — fixture only, not a live credential. */
export const DEMO_MMSI = 247999000;

/** Ponta Delgada destination (PTPDL). */
const DESTINATION = {
  name: 'Ponta Delgada, Portugal',
  portCode: 'PTPDL',
  latitude: 37.734722,
  longitude: -25.664444
};

/** Mid-Atlantic demo position — west of the Azores, heading east. */
const VESSEL = {
  latitude: 38.42,
  longitude: -30.18,
  speedKnots: 9.5,
  course: 92,
  heading: 94,
  navStatus: 'Under way using engine',
  destination: 'PTPDL'
};

/** Historical track points (west → east breadcrumb trail). */
const HISTORY_COORDS = [
  [-32.50, 38.10],
  [-32.10, 38.15],
  [-31.70, 38.20],
  [-31.30, 38.25],
  [-30.90, 38.30],
  [-30.50, 38.35],
  [-30.18, 38.42]
];

function isoOffset(now, secondsAgo) {
  return new Date(now - secondsAgo * 1000).toISOString();
}

function pointFeature(lon, lat, properties) {
  return {
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [lon, lat] },
    properties
  };
}

function lineFeature(coordinates, properties) {
  return {
    type: 'Feature',
    geometry: { type: 'LineString', coordinates },
    properties
  };
}

/**
 * Build realistic demo map data with timestamps relative to `now`.
 * @param {number} [now] Epoch ms (default Date.now()).
 */
export function buildDemoMapData(now = Date.now()) {
  const lastAIS = isoOffset(now, 180);
  const freshness = classifyFreshness(lastAIS, now);
  const ageSeconds = positionAgeSeconds(lastAIS, now);

  const vesselFeature = pointFeature(VESSEL.longitude, VESSEL.latitude, {
    MMSI: DEMO_MMSI,
    VesselName: 'AMERIGO VESPUCCI',
    SpeedKnots: VESSEL.speedKnots,
    Course: VESSEL.course,
    Heading: VESSEL.heading,
    Latitude: VESSEL.latitude,
    Longitude: VESSEL.longitude,
    LastAIS: lastAIS,
    Destination: VESSEL.destination,
    NavStatus: VESSEL.navStatus
  });

  const historyFeatures = HISTORY_COORDS.map(([lon, lat], i) => {
    const age = 3600 + (HISTORY_COORDS.length - 1 - i) * 900;
    return pointFeature(lon, lat, {
      MMSI: DEMO_MMSI,
      VesselName: 'AMERIGO VESPUCCI',
      Latitude: lat,
      Longitude: lon,
      LastAIS: isoOffset(now, age),
      Source: 'demo',
      PositionKey: `${DEMO_MMSI}:demo:${isoOffset(now, age)}`
    });
  });

  const travelledCoords = HISTORY_COORDS.map(([lon, lat]) => [lon, lat]);
  const estimatedCoords = [
    [VESSEL.longitude, VESSEL.latitude],
    [DESTINATION.longitude, DESTINATION.latitude]
  ];

  const distanceNM = 285.4;
  const estimatedETA = new Date(now + (distanceNM / VESSEL.speedKnots) * 3_600_000).toISOString();

  return {
    vessel: {
      geojson: { type: 'FeatureCollection', features: [vesselFeature] },
      properties: vesselFeature.properties,
      freshness,
      ageSeconds,
      lastAIS,
      source: 'demo-fixture',
      empty: false
    },
    history: {
      geojson: { type: 'FeatureCollection', features: historyFeatures },
      count: historyFeatures.length,
      label: 'Observed AIS track',
      empty: false
    },
    travelledRoute: {
      geojson: {
        type: 'FeatureCollection',
        features: [lineFeature(travelledCoords, {
          MMSI: DEMO_MMSI,
          VesselName: 'AMERIGO VESPUCCI',
          RouteType: 'Observed AIS track',
          PointCount: historyFeatures.length,
          StartAIS: historyFeatures[0].properties.LastAIS,
          EndAIS: lastAIS,
          LastUpdated: isoOffset(now, 60)
        })]
      },
      label: 'Observed AIS track',
      pointCount: historyFeatures.length,
      empty: false
    },
    destination: {
      geojson: {
        type: 'FeatureCollection',
        features: [pointFeature(DESTINATION.longitude, DESTINATION.latitude, {
          DestinationName: DESTINATION.name,
          PortCode: DESTINATION.portCode,
          Latitude: DESTINATION.latitude,
          Longitude: DESTINATION.longitude,
          UpdatedAt: isoOffset(now, 86_400)
        })]
      },
      properties: {
        DestinationName: DESTINATION.name,
        PortCode: DESTINATION.portCode,
        Latitude: DESTINATION.latitude,
        Longitude: DESTINATION.longitude,
        UpdatedAt: isoOffset(now, 86_400)
      },
      empty: false
    },
    estimatedRoute: {
      geojson: {
        type: 'FeatureCollection',
        features: [lineFeature(estimatedCoords, {
          MMSI: DEMO_MMSI,
          VesselName: 'AMERIGO VESPUCCI',
          DestinationName: DESTINATION.name,
          RouteType: 'Straight-line estimate',
          DistanceNM: distanceNM,
          SpeedKnots: VESSEL.speedKnots,
          EstimatedETA: estimatedETA,
          CalculatedAt: isoOffset(now, 120),
          Basis: ESTIMATED_ROUTE_BASIS
        })]
      },
      label: 'Straight-line estimate',
      basis: ESTIMATED_ROUTE_BASIS,
      disclaimer: 'Straight-line estimate — not an official navigational route',
      distanceNM,
      estimatedETA,
      empty: false
    },
    conditions: {
      geojson: {
        type: 'FeatureCollection',
        features: [pointFeature(VESSEL.longitude, VESSEL.latitude, {
          MMSI: DEMO_MMSI,
          VesselName: 'AMERIGO VESPUCCI',
          Latitude: VESSEL.latitude,
          Longitude: VESSEL.longitude,
          VesselAIS: lastAIS,
          ConditionsAt: isoOffset(now, 900),
          WeatherAt: isoOffset(now, 900),
          MarineAt: isoOffset(now, 900),
          UpdatedAt: isoOffset(now, 900),
          WeatherStatus: 'ok',
          MarineStatus: 'ok',
          Attribution: CONDITIONS_ATTRIBUTION,
          Basis: CONDITIONS_BASIS,
          AirTempC: 21.4,
          FeelsLikeC: 20.1,
          HumidityPct: 78,
          PrecipMM: 0.0,
          WeatherCode: 2,
          WeatherText: 'Partly cloudy',
          CloudPct: 45,
          PressureHPA: 1018.2,
          VisibilityKM: 24.0,
          WindKnots: 14.2,
          WindFromDeg: 315,
          GustKnots: 19.8,
          WaveHeightM: 1.8,
          WaveFromDeg: 300,
          WavePeriodS: 7.2,
          WindWaveM: 1.2,
          WindWaveFrom: 310,
          WindWaveSec: 5.1,
          SwellHeightM: 1.4,
          SwellFromDeg: 290,
          SwellPeriodS: 9.5,
          SeaTempC: 22.6,
          CurrentKnots: 0.4,
          CurrentToDeg: 85,
          SeaLevelM: 0.12,
          MaxWind24Kn: 22.5,
          MaxGust24Kn: 28.0,
          MinVis24KM: 18.0,
          Precip24MM: 0.5,
          MaxWave24M: 2.4,
          MaxSwell24M: 1.9,
          MaxCurrent24Kn: 0.6,
          ForecastStart: isoOffset(now, 0),
          ForecastEnd: isoOffset(now, -86_400)
        })]
      },
      properties: null,
      warning: CONDITIONS_BASIS,
      attribution: CONDITIONS_ATTRIBUTION,
      weatherStatus: 'ok',
      marineStatus: 'ok',
      conditionsAt: isoOffset(now, 900),
      empty: false
    },
    meta: {
      fetchedAt: new Date(now).toISOString(),
      mmsi: DEMO_MMSI,
      source: 'local-demo-fixture',
      preview: true,
      freshness: { vessel: freshness, vesselAgeSeconds: ageSeconds, vesselLastAIS: lastAIS },
      timestamps: {
        lastArcGISUpdate: isoOffset(now, 120),
        lastHistoryWrite: isoOffset(now, 900),
        lastTravelledRouteUpdate: isoOffset(now, 900),
        lastDestinationUpdate: isoOffset(now, 86_400),
        lastEstimatedRouteUpdate: isoOffset(now, 120),
        lastConditionsUpdate: isoOffset(now, 900)
      }
    }
  };
}

/** Attach conditions.properties from geojson feature. */
export function finalizeDemoMapData(data) {
  data.conditions.properties = data.conditions.geojson.features[0]?.properties || null;
  data.conditions.conditionsAt = data.conditions.properties?.ConditionsAt || null;
  return data;
}
