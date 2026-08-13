import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AOI_CLASS,
  classifyPointAgainstAoi,
  coveringRadiusMeters,
  formatAoiDistanceLabel,
  pointInPolygon,
  polygonCentroid,
  polygonEnvelope,
  queryPlanFromAoi,
  selectConstellationStations,
  stampResultsWithAoi,
  summarizeAoiConstellation
} from '../public/spatial/point-intelligence-aoi-geometry.js';
import {
  buildProofStationRecords,
  formatProofHoverModel
} from '../public/spatial/point-intelligence-station-model.js';
import { buildSafeEvidenceInspectorModel } from '../public/spatial/point-intelligence-inspector-model.js';
import { renderEvidenceInspectorHtml } from '../public/spatial/point-intelligence-inspector-presentation.js';
import { renderAcquisitionSummaryHtml } from '../public/spatial/point-intelligence-presentation.js';
import { CONNECTOR_MEANING } from '../public/spatial/point-intelligence-aoi-geometry.js';

const DOWNTOWN = {
  type: 'Polygon',
  coordinates: [[
    [-73.60, 45.49],
    [-73.54, 45.49],
    [-73.54, 45.53],
    [-73.60, 45.53],
    [-73.60, 45.49]
  ]]
};

const MCTAVISH = { longitude: -73.579185, latitude: 45.504926 };
const LASALLE = { longitude: -73.62316, latitude: 45.41501 };

function hydro(id, lon, lat, clickDistanceMeters = 1200) {
  return {
    resultId: `hydro-${id}`,
    category: 'hydrometric-measurement',
    resultKind: 'DIRECT_MEASUREMENT',
    providerName: 'MSC GeoMet',
    nativeCollectionId: 'hydrometric-realtime',
    nativeRecordId: id,
    clickDistanceMeters,
    geometry: { type: 'Point', coordinates: [lon, lat] },
    observation: { property: 'LEVEL', value: 1.29, unit: 'm', observedAt: '2026-08-13T16:30:00Z' },
    properties: { STATION_NUMBER: id, STATION_NAME: id, LEVEL: 1.29 }
  };
}

function weather(id, lon, lat, clickDistanceMeters = 900) {
  return {
    resultId: `swob-${id}`,
    category: 'weather',
    resultKind: 'DIRECT_MEASUREMENT',
    providerName: 'MSC GeoMet',
    nativeCollectionId: 'swob-realtime',
    nativeRecordId: id,
    clickDistanceMeters,
    geometry: { type: 'Point', coordinates: [lon, lat] },
    observation: { property: 'air_temp', value: 24.8, unit: '°C', observedAt: '2026-08-13T17:28:00Z' },
    properties: { 'tc_id-value': id, 'stn_nam-value': id, 'air_temp-value': 24.8 }
  };
}

test('downtown McTavish is inside AOI and LaSalle hydrometric is outside', () => {
  assert.equal(pointInPolygon(MCTAVISH.longitude, MCTAVISH.latitude, DOWNTOWN), true);
  assert.equal(pointInPolygon(LASALLE.longitude, LASALLE.latitude, DOWNTOWN), false);
  const inside = classifyPointAgainstAoi(MCTAVISH.longitude, MCTAVISH.latitude, DOWNTOWN);
  const outside = classifyPointAgainstAoi(LASALLE.longitude, LASALLE.latitude, DOWNTOWN);
  assert.equal(inside.aoiClassification, AOI_CLASS.INSIDE_AOI);
  assert.equal(inside.aoiBoundaryDistanceMeters, 0);
  assert.equal(outside.aoiClassification, AOI_CLASS.SUPPORTING_EXTERNAL);
  assert.ok(outside.aoiBoundaryDistanceMeters > 5000);
});

test('INSIDE_AOI is a coordinate test, not coverage of the polygon', () => {
  const hit = classifyPointAgainstAoi(MCTAVISH.longitude, MCTAVISH.latitude, DOWNTOWN);
  assert.equal(hit.insideAoi, true);
  assert.notEqual(hit.aoiClassification, 'COVERS_AOI');
  assert.notEqual(hit.aoiClassification, 'MEASURES_AOI');
});

test('query plan uses envelope plus external buffer and does not exceed cap', () => {
  const plan = queryPlanFromAoi(DOWNTOWN);
  assert.ok(plan.centroid);
  assert.ok(plan.radiusMeters > coveringRadiusMeters(DOWNTOWN));
  assert.ok(plan.radiusMeters <= 50000);
  assert.deepEqual(polygonEnvelope(DOWNTOWN), {
    minLon: -73.60,
    minLat: 45.49,
    maxLon: -73.54,
    maxLat: 45.53
  });
  assert.ok(plan.bbox[0] < plan.aoiBbox[0]);
  assert.ok(plan.bbox[2] > plan.aoiBbox[2]);
});

test('constellation keeps every inside station and only the nearest external per empty family', () => {
  const downtownHydro = hydro('02OA999', -73.57, 45.51, 400);
  const extraHydroOutside = hydro('02OA017', -73.70, 45.40, 18000);
  const lasalle = hydro('02OA016', LASALLE.longitude, LASALLE.latitude, 11000);
  const mctavish = weather('WTA', MCTAVISH.longitude, MCTAVISH.latitude, 800);
  const extraWeatherOutside = weather('YUL', -73.74, 45.47, 14000);

  const withInsideHydro = selectConstellationStations(
    buildProofStationRecords([downtownHydro, extraHydroOutside, lasalle, mctavish, extraWeatherOutside]),
    DOWNTOWN
  );
  assert.equal(withInsideHydro.filter((row) => row.family === 'hydrometric').length, 1);
  assert.equal(withInsideHydro.find((row) => row.stationId === '02OA999').aoiClassification, AOI_CLASS.INSIDE_AOI);
  assert.equal(withInsideHydro.some((row) => row.stationId === '02OA016'), false);
  assert.equal(withInsideHydro.find((row) => row.stationId === 'WTA').aoiClassification, AOI_CLASS.INSIDE_AOI);

  const noInsideHydro = selectConstellationStations(
    buildProofStationRecords([extraHydroOutside, lasalle, mctavish, extraWeatherOutside]),
    DOWNTOWN
  );
  const hydroRows = noInsideHydro.filter((row) => row.family === 'hydrometric');
  assert.equal(hydroRows.length, 1);
  assert.equal(hydroRows[0].stationId, '02OA016');
  assert.equal(hydroRows[0].aoiClassification, AOI_CLASS.SUPPORTING_EXTERNAL);
  assert.notEqual(hydroRows[0].aoiClassification, 'LOCAL');
  assert.ok(hydroRows[0].aoiBoundaryDistanceMeters > 0);
});

test('SUPPORTING_EXTERNAL is not a local observation and nearest station is not a measurement at the AOI', () => {
  const records = selectConstellationStations(
    buildProofStationRecords([
      hydro('02OA016', LASALLE.longitude, LASALLE.latitude, 11000),
      weather('WTA', MCTAVISH.longitude, MCTAVISH.latitude, 800)
    ]),
    DOWNTOWN
  );
  const external = records.find((row) => row.aoiClassification === AOI_CLASS.SUPPORTING_EXTERNAL);
  assert.ok(external);
  assert.notEqual(external.aoiClassification, 'LOCAL_OBSERVATION');
  assert.notEqual(external.longitude, polygonCentroid(DOWNTOWN).longitude);
  assert.equal(external.longitude, LASALLE.longitude);
  assert.equal(external.latitude, LASALLE.latitude);
});

test('AOI boundary distance is explicit and does not overwrite clickDistanceMeters', () => {
  const raw = hydro('02OA016', LASALLE.longitude, LASALLE.latitude, 12345);
  const [station] = selectConstellationStations(buildProofStationRecords([raw]), DOWNTOWN);
  const [stamped] = stampResultsWithAoi([raw], [station]);
  assert.equal(stamped.clickDistanceMeters, 12345);
  assert.notEqual(stamped.aoiBoundaryDistanceMeters, stamped.clickDistanceMeters);
  assert.ok(stamped.aoiBoundaryDistanceMeters > 0);
  assert.notEqual(station.distanceMeters, station.aoiBoundaryDistanceMeters);
});

test('one station remains one object after AOI classification', () => {
  const stacked = [
    hydro('02OA016', LASALLE.longitude, LASALLE.latitude, 11000),
    {
      ...hydro('02OA016', LASALLE.longitude, LASALLE.latitude, 11000),
      resultId: 'hydro-02OA016-b',
      observation: { property: 'LEVEL', value: 1.31, unit: 'm', observedAt: '2026-08-13T16:00:00Z' }
    }
  ];
  const records = selectConstellationStations(buildProofStationRecords(stacked), DOWNTOWN);
  assert.equal(records.filter((row) => row.stationId === '02OA016').length, 1);
});

test('hover copy distinguishes inside acquisition from supporting observation', () => {
  const records = selectConstellationStations(
    buildProofStationRecords([
      hydro('02OA016', LASALLE.longitude, LASALLE.latitude, 11000),
      weather('WTA', MCTAVISH.longitude, MCTAVISH.latitude, 800)
    ]),
    DOWNTOWN
  );
  const inside = formatProofHoverModel(records.find((row) => row.stationId === 'WTA'));
  const external = formatProofHoverModel(records.find((row) => row.stationId === '02OA016'));
  assert.equal(inside.familyLabel, 'WEATHER');
  assert.match(inside.lines.join('\n'), /INSIDE ACQUISITION AREA/);
  assert.doesNotMatch(inside.lines.join('\n'), /SUPPORTING/);
  assert.equal(external.familyLabel, 'HYDROMETRIC');
  assert.match(external.lines.join('\n'), /OUTSIDE AOI/);
  assert.match(external.lines.join('\n'), /SUPPORTING OBSERVATION/);
  assert.doesNotMatch(external.lines.join('\n'), /local observation/i);
});

test('distance connector meaning is spatial distance, not dependency or flow', () => {
  assert.equal(CONNECTOR_MEANING, 'SPATIAL_DISTANCE_TO_ACQUISITION_AREA');
  assert.notEqual(CONNECTOR_MEANING, 'dependency');
  assert.notEqual(CONNECTOR_MEANING, 'flow');
  assert.notEqual(CONNECTOR_MEANING, 'coverage');
  assert.notEqual(CONNECTOR_MEANING, 'network connection');
});

test('hydrometric inside AOI does not mean water level everywhere in the polygon', () => {
  const [station] = selectConstellationStations(
    buildProofStationRecords([hydro('02OA999', -73.57, 45.51, 400)]),
    DOWNTOWN
  );
  assert.equal(station.aoiClassification, AOI_CLASS.INSIDE_AOI);
  assert.equal(station.primaryLabel, 'WATER LEVEL');
  assert.notEqual(station.aoiClassification, 'AOI_WATER_LEVEL');
});

test('weather inside AOI does not mean weather everywhere in the polygon', () => {
  const [station] = selectConstellationStations(
    buildProofStationRecords([weather('WTA', MCTAVISH.longitude, MCTAVISH.latitude, 800)]),
    DOWNTOWN
  );
  assert.equal(station.aoiClassification, AOI_CLASS.INSIDE_AOI);
  assert.notEqual(station.aoiClassification, 'AOI_WEATHER_SURFACE');
});

test('inspector exposes AOI relationship without mixing click distance', () => {
  const raw = weather('WTA', MCTAVISH.longitude, MCTAVISH.latitude, 993);
  const [station] = selectConstellationStations(buildProofStationRecords([raw]), DOWNTOWN);
  const [stamped] = stampResultsWithAoi([raw], [station]);
  const response = {
    families: { weather: { results: [stamped] } },
    results: [stamped]
  };
  const model = buildSafeEvidenceInspectorModel(response, 'swob-WTA');
  assert.equal(model.aoiRelationship.classification, AOI_CLASS.INSIDE_AOI);
  assert.match(model.aoiRelationship.label, /INSIDE ACQUISITION AREA/);
  assert.equal(model.spatial.distanceFromAnchor, '993 m');
  const html = renderEvidenceInspectorHtml(model);
  assert.match(html, /AOI relationship/i);
  assert.match(html, /INSIDE ACQUISITION AREA/);
});

test('external inspector uses boundary distance and supporting language', () => {
  const raw = hydro('02OA016', LASALLE.longitude, LASALLE.latitude, 12345);
  const [station] = selectConstellationStations(buildProofStationRecords([raw]), DOWNTOWN);
  const [stamped] = stampResultsWithAoi([raw], [station]);
  const model = buildSafeEvidenceInspectorModel({ results: [stamped] }, 'hydro-02OA016');
  assert.equal(model.aoiRelationship.classification, AOI_CLASS.SUPPORTING_EXTERNAL);
  assert.match(model.aoiRelationship.label, /SUPPORTING EXTERNAL/);
  assert.match(model.aoiRelationship.distanceLabel, /from AOI boundary/);
  assert.equal(model.spatial.distanceFromAnchor, '12.35 km');
  const html = renderEvidenceInspectorHtml(model);
  assert.match(html, /SUPPORTING EXTERNAL OBSERVATION/);
  assert.doesNotMatch(html, /dependency|flow|coverage polygon/i);
});

test('acquisition summary stays compact', () => {
  const records = selectConstellationStations(
    buildProofStationRecords([
      hydro('02OA016', LASALLE.longitude, LASALLE.latitude, 11000),
      weather('WTA', MCTAVISH.longitude, MCTAVISH.latitude, 800)
    ]),
    DOWNTOWN
  );
  const summary = summarizeAoiConstellation(records);
  const html = renderAcquisitionSummaryHtml(summary);
  assert.match(html, /SENSOR ACQUISITION/);
  assert.match(html, /sensor families/);
  assert.match(html, /INSIDE/);
  assert.match(html, /SUPPORTING/);
  assert.doesNotMatch(html, /dashboard/i);
  assert.equal(summary.insideCount, 1);
  assert.equal(summary.supportingCount, 1);
});

test('formatAoiDistanceLabel prefers kilometres outside the AOI', () => {
  assert.equal(formatAoiDistanceLabel(8700), '8.7 km');
  assert.equal(formatAoiDistanceLabel(0), null);
});
