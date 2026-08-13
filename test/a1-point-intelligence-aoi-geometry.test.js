import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AOI_CLASS,
  CONNECTOR_MEANING,
  EVIDENCE_ROLE,
  FOOTPRINT_MEANING,
  buildEvidenceAcquisitionFootprint,
  classifyPointAgainstAoi,
  coveringRadiusMeters,
  formatAoiDistanceLabel,
  pointInPolygon,
  polygonCentroid,
  polygonEnvelope,
  queryPlanFromAoi,
  selectConstellationStations,
  selectEvidenceUsedStations,
  stampResultsWithAoi,
  stampResultsWithEvidence,
  summarizeAoiConstellation,
  summarizeEvidenceAcquisition
} from '../public/spatial/point-intelligence-aoi-geometry.js';
import {
  buildProofStationRecords,
  formatProofHoverModel
} from '../public/spatial/point-intelligence-station-model.js';
import { buildSafeEvidenceInspectorModel } from '../public/spatial/point-intelligence-inspector-model.js';
import { renderEvidenceInspectorHtml } from '../public/spatial/point-intelligence-inspector-presentation.js';
import { renderAcquisitionSummaryHtml } from '../public/spatial/point-intelligence-presentation.js';

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

const ORIGIN = { longitude: -73.5673, latitude: 45.5017 };
const EAST_4KM = { longitude: -73.516, latitude: 45.5017 };
const SOUTH_26 = { longitude: -73.5673, latitude: 45.4783 };
const WEST_12 = { longitude: -73.5827, latitude: 45.5017 };

test('one evidence location builds a buffered corridor that includes origin and station', () => {
  const footprint = buildEvidenceAcquisitionFootprint({
    origin: ORIGIN,
    evidence: [EAST_4KM]
  });
  assert.equal(footprint.method, 'BUFFERED_GEODESIC_CORRIDOR');
  assert.equal(footprint.meaning, FOOTPRINT_MEANING);
  assert.equal(pointInPolygon(ORIGIN.longitude, ORIGIN.latitude, footprint.polygon), true);
  assert.equal(pointInPolygon(EAST_4KM.longitude, EAST_4KM.latitude, footprint.polygon), true);
  const env = polygonEnvelope(footprint.polygon);
  assert.ok(env.maxLon - ORIGIN.longitude > ORIGIN.longitude - env.minLon);
});

test('farthest evidence expands the acquisition footprint', () => {
  const nearOnly = buildEvidenceAcquisitionFootprint({
    origin: ORIGIN,
    evidence: [WEST_12]
  });
  const withFar = buildEvidenceAcquisitionFootprint({
    origin: ORIGIN,
    evidence: [WEST_12, EAST_4KM, SOUTH_26]
  });
  const nearEnv = polygonEnvelope(nearOnly.polygon);
  const farEnv = polygonEnvelope(withFar.polygon);
  assert.ok(farEnv.maxLon > nearEnv.maxLon + 0.01);
  assert.equal(pointInPolygon(EAST_4KM.longitude, EAST_4KM.latitude, withFar.polygon), true);
  assert.notEqual(withFar.method, 'PROVIDER_SEARCH_RADIUS');
});

test('evidence-driven footprint is cartographic geography, not coverage or search radius', () => {
  const footprint = buildEvidenceAcquisitionFootprint({
    origin: ORIGIN,
    evidence: [WEST_12, EAST_4KM, SOUTH_26]
  });
  assert.equal(footprint.meaning, FOOTPRINT_MEANING);
  assert.notEqual(footprint.meaning, 'coverage');
  assert.notEqual(footprint.meaning, 'influence');
  assert.notEqual(footprint.meaning, 'interpolation');
  assert.notEqual(footprint.meaning, 'impact');
  assert.notEqual(footprint.method, 'PROVIDER_SEARCH_RADIUS');
});

test('AUTO evidence prefers live observations over nearer registry stations', () => {
  const registry = {
    resultId: 'hydro-02OA046',
    category: 'hydrometric',
    resultKind: 'STATION_REGISTRY',
    providerName: 'MSC GeoMet',
    nativeCollectionId: 'hydrometric-stations',
    nativeRecordId: '02OA046',
    clickDistanceMeters: 1284,
    geometry: { type: 'Point', coordinates: [-73.55139, 45.50472] },
    properties: { STATION_NUMBER: '02OA046', STATION_NAME: '02OA046' }
  };
  const records = selectEvidenceUsedStations(buildProofStationRecords([
    registry,
    hydro('02OA016', -73.62316, 45.41501, 10578),
    weather('WTA', -73.579185, 45.504926, 993)
  ]));
  const hydroRows = records.filter((row) => row.family === 'hydrometric');
  assert.equal(hydroRows.some((row) => row.stationId === '02OA016'), true);
  assert.equal(hydroRows.some((row) => row.stationId === '02OA046'), false);
});

test('AUTO evidence keeps true coordinates and does not use SUPPORTING_EXTERNAL', () => {
  const records = selectEvidenceUsedStations(buildProofStationRecords([
    hydro('02OA016', EAST_4KM.longitude, EAST_4KM.latitude, 4000),
    weather('WTA', WEST_12.longitude, WEST_12.latitude, 1200)
  ]));
  const hydroRow = records.find((row) => row.stationId === '02OA016');
  assert.equal(hydroRow.longitude, EAST_4KM.longitude);
  assert.equal(hydroRow.latitude, EAST_4KM.latitude);
  assert.equal(hydroRow.acquisitionRole, EVIDENCE_ROLE);
  assert.equal(hydroRow.aoiClassification, null);
  assert.equal(hydroRow.queryOriginDistanceMeters, 4000);
  assert.notEqual(hydroRow.acquisitionRole, 'LOCAL');
  assert.notEqual(hydroRow.acquisitionRole, AOI_CLASS.SUPPORTING_EXTERNAL);
});

test('evidence hover shows query-origin distance, not outside-AOI language', () => {
  const [station] = selectEvidenceUsedStations(buildProofStationRecords([
    weather('WTA', WEST_12.longitude, WEST_12.latitude, 4000)
  ]));
  const hover = formatProofHoverModel(station);
  assert.equal(hover.familyLabel, 'WEATHER OBSERVATION');
  assert.match(hover.lines.join('\n'), /4\.0 km FROM QUERY ORIGIN/);
  assert.match(hover.lines.join('\n'), /SUPPORTING OBSERVATION/);
  assert.match(hover.lines.join('\n'), /SOURCE · MSC/);
  assert.doesNotMatch(hover.lines.join('\n'), /OUTSIDE AOI/);
  assert.doesNotMatch(hover.lines.join('\n'), /INSIDE ACQUISITION AREA/);
});

test('evidence inspector uses query origin distance instead of supporting external', () => {
  const raw = weather('WTA', WEST_12.longitude, WEST_12.latitude, 4000);
  const [station] = selectEvidenceUsedStations(buildProofStationRecords([raw]));
  const [stamped] = stampResultsWithEvidence([raw], [station]);
  const model = buildSafeEvidenceInspectorModel({ results: [stamped] }, 'swob-WTA');
  assert.equal(model.aoiRelationship.classification, EVIDENCE_ROLE);
  assert.match(model.aoiRelationship.label, /SUPPORTING OBSERVATION/);
  assert.match(model.aoiRelationship.distanceLabel, /from query origin/);
  assert.doesNotMatch(model.aoiRelationship.label, /EXTERNAL/);
  const html = renderEvidenceInspectorHtml(model);
  assert.match(html, /Acquisition relationship/);
  assert.match(html, /Query origin distance/);
  assert.doesNotMatch(html, /SUPPORTING EXTERNAL/);
});

test('evidence acquisition summary stays compact and does not fabricate values', () => {
  const stations = selectEvidenceUsedStations(buildProofStationRecords([
    hydro('02OA016', EAST_4KM.longitude, EAST_4KM.latitude, 4000),
    weather('WTA', WEST_12.longitude, WEST_12.latitude, 1200)
  ]));
  const footprint = buildEvidenceAcquisitionFootprint({
    origin: ORIGIN,
    evidence: stations
  });
  const summary = summarizeEvidenceAcquisition({
    origin: ORIGIN,
    stations,
    polygon: footprint.polygon
  });
  const html = renderAcquisitionSummaryHtml(summary);
  assert.match(html, /EVIDENCE ACQUISITION/);
  assert.match(html, /ORIGIN/);
  assert.match(html, /FOOTPRINT/);
  assert.match(html, /FARTHEST EVIDENCE/);
  assert.match(html, /4\.0 km/);
  assert.doesNotMatch(html, /Downtown Montréal/);
  assert.doesNotMatch(html, /dashboard/i);
  assert.equal(summary.stationCount, 2);
  assert.ok(summary.footprintKm2 > 0);
});
