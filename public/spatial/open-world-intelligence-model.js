/**
 * Normalize Agent 2 responses into Agent 1 open-world presentation model.
 */
import { AGENT2_ENTITY_KIND } from './open-world-intelligence-config.js';

function haversineMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function pointFromGeometry(geometry) {
  if (!geometry) return null;
  if (geometry.type === 'Point' && Array.isArray(geometry.coordinates)) {
    const [lon, lat] = geometry.coordinates;
    if (Number.isFinite(lon) && Number.isFinite(lat)) return { lon, lat };
  }
  return null;
}

function centroidFromGeometry(geometry) {
  const point = pointFromGeometry(geometry);
  if (point) return point;
  const ring = geometry?.type === 'Polygon'
    ? geometry.coordinates?.[0]
    : geometry?.type === 'MultiPolygon'
      ? geometry.coordinates?.[0]?.[0]
      : null;
  if (!Array.isArray(ring) || !ring.length) return null;
  let lon = 0;
  let lat = 0;
  let count = 0;
  for (const coord of ring) {
    if (!Array.isArray(coord) || coord.length < 2) continue;
    lon += coord[0];
    lat += coord[1];
    count += 1;
  }
  if (!count) return null;
  return { lon: lon / count, lat: lat / count };
}

function pointInRing(lon, lat, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];
    const intersect = ((yi > lat) !== (yj > lat))
      && (lon < ((xj - xi) * (lat - yi)) / ((yj - yi) || 1e-12) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

function pointInGeometry(lon, lat, geometry) {
  if (!geometry) return false;
  if (geometry.type === 'Point') {
    const pt = pointFromGeometry(geometry);
    return pt ? pt.lon === lon && pt.lat === lat : false;
  }
  if (geometry.type === 'Polygon') {
    return pointInRing(lon, lat, geometry.coordinates?.[0] || []);
  }
  if (geometry.type === 'MultiPolygon') {
    return (geometry.coordinates || []).some((poly) => pointInRing(lon, lat, poly?.[0] || []));
  }
  return false;
}

function withinRadius(geometry, anchor, radiusMeters) {
  if (!anchor || !Number.isFinite(radiusMeters)) return true;
  if (pointInGeometry(anchor.longitude, anchor.latitude, geometry)) return true;
  const pt = centroidFromGeometry(geometry);
  if (!pt) return false;
  return haversineMeters(anchor.latitude, anchor.longitude, pt.lat, pt.lon) <= radiusMeters;
}

function dedupeIncidentsById(incidents) {
  const byId = new Map();
  for (const incident of incidents) {
    const id = incident.operationalIncidentId;
    if (!id) continue;
    if (!byId.has(id)) byId.set(id, incident);
  }
  return [...byId.values()];
}

function pickIncidentTitle(props = {}) {
  return props.headline
    || props.title
    || props.canonicalEventType
    || props.sourceNativeEventType
    || props.eventType
    || null;
}

function normalizeIncidentFeature(feature, anchor, radiusMeters) {
  const props = feature?.properties || {};
  const geometry = feature?.geometry || null;
  const spatial = Boolean(geometry);
  const inRadius = spatial ? withinRadius(geometry, anchor, radiusMeters) : false;
  const title = pickIncidentTitle(props) || 'Operational incident';
  return {
    kind: AGENT2_ENTITY_KIND.OPERATIONAL_INCIDENT,
    id: props.operationalIncidentId || feature.id,
    operationalIncidentId: props.operationalIncidentId || feature.id,
    eventCandidateId: props.eventCandidateId || null,
    title,
    headline: props.headline || null,
    eventType: props.canonicalEventType || props.eventType || props.sourceNativeEventType || null,
    locationLabel: props.locationLabel || null,
    primarySource: props.primarySource || null,
    sourceId: props.sourceId || null,
    platform: props.platform || props.sourceFamily || null,
    sourceFamily: props.sourceFamily || null,
    geometry,
    geometryType: geometry?.type || props.geometryType || null,
    spatialPrecision: props.spatialPrecision || props.sourceSpatialPrecisionLabel || null,
    spatial,
    inRadius,
    memberCount: props.memberEventCandidateCount || props.memberCount || null,
    activeMemberCount: props.activeMemberEventCandidateCount || null,
    corroboration: props.corroborationSummary || props.corroboration || null,
    publicationTime: props.publishedAt || props.publicationTime || props.sentAt || null,
    occurrenceTime: props.occurredStart || props.startTime || null,
    knowledgeTime: props.revisionRecordedAt || null,
    lifecycleState: props.lifecycleState || props.operationalLifecycleState || props.eventState || null,
    revisionState: props.revisionState || null,
    summary: props.whyOnMapSummary || props.authoritySummary || null,
    canonicalUrl: props.sourceUrl || props.canonicalUrl || null,
    raw: props
  };
}

function normalizeArchiveObservation(item, anchor, radiusMeters) {
  const event = item.derivedEvents?.[0] || null;
  const geometry = event?.geometry || null;
  const spatial = Boolean(geometry);
  const inRadius = spatial ? withinRadius(geometry, anchor, radiusMeters) : false;
  const title = item.sourceTitle
    || event?.headline
    || item.sourceExcerptPermitted?.slice(0, 120)
    || 'Observation';
  return {
    kind: event ? AGENT2_ENTITY_KIND.EVENT_CANDIDATE : AGENT2_ENTITY_KIND.OBSERVATION,
    id: event?.eventCandidateId || item.observationId,
    observationId: item.observationId,
    eventCandidateId: event?.eventCandidateId || null,
    title,
    headline: event?.headline || item.sourceTitle || null,
    eventType: event?.eventType || null,
    locationLabel: item.locationLabel || null,
    primarySource: item.publisher || item.sourceId || null,
    sourceId: item.sourceId || null,
    platform: item.platform || item.sourceFamily || null,
    publisher: item.publisher || null,
    sourceFamily: item.sourceFamily || null,
    geometry,
    geometryType: geometry?.type || null,
    spatial,
    inRadius,
    nonSpatial: !spatial,
    publicationTime: item.publishedAt || item.timeRoles?.SOURCE_PUBLICATION_TIME || null,
    occurrenceTime: event?.timeRoles?.OCCURRENCE_START_TIME || null,
    knowledgeTime: item.timeRoles?.FIRST_OBSERVED_BY_IQAI || item.retrievedAt || null,
    excerpt: item.sourceExcerptPermitted || null,
    canonicalUrl: item.canonicalUrl || null,
    lineage: {
      eventCandidateCount: item.eventCandidateCount || 0,
      eventCandidateIds: item.eventCandidateIds || []
    },
    raw: item
  };
}

/**
 * @param {object} agent2Payload
 * @param {{ latitude: number, longitude: number, radiusMeters?: number }} [anchor]
 */
export function normalizeOpenWorldSearchResponse(agent2Payload, anchor = null) {
  const radiusMeters = anchor?.radiusMeters;
  const anchorPoint = anchor
    ? { latitude: Number(anchor.latitude), longitude: Number(anchor.longitude) }
    : null;

  const incidentFeatures = agent2Payload?.incidentsGeoJson?.features || [];
  const incidentsRaw = incidentFeatures.map((f) => normalizeIncidentFeature(f, anchorPoint, radiusMeters));
  const incidents = dedupeIncidentsById(incidentsRaw);

  const archiveItems = agent2Payload?.archive?.observations || [];
  const archiveNormalized = archiveItems.map((item) =>
    normalizeArchiveObservation(item, anchorPoint, radiusMeters));

  const seenIncidentIds = new Set(incidents.map((i) => i.operationalIncidentId));
  const spatialIncidents = incidents.filter((i) => i.spatial && (!anchorPoint || i.inRadius));
  const spatialEvents = archiveNormalized.filter((i) => i.spatial && i.kind !== AGENT2_ENTITY_KIND.OBSERVATION && (!anchorPoint || i.inRadius));
  const spatialObservations = archiveNormalized.filter((i) => i.spatial && i.kind === AGENT2_ENTITY_KIND.OBSERVATION && (!anchorPoint || i.inRadius));
  const nonSpatial = archiveNormalized.filter((i) => i.nonSpatial);

  const allResults = [
    ...spatialIncidents,
    ...spatialEvents,
    ...archiveNormalized.filter((i) => !seenIncidentIds.has(i.id))
  ];

  const sourceFamilies = [...new Set(allResults.map((r) => r.sourceFamily).filter(Boolean))];
  const spatialAll = [...spatialIncidents, ...spatialEvents, ...spatialObservations];
  const incidentsOutOfRadius = incidentsRaw.filter((i) => i.spatial && anchorPoint && !i.inRadius).length;

  return {
    queryPlan: agent2Payload?.queryPlan || null,
    agent2Authority: true,
    summary: {
      totalMatches: allResults.length + nonSpatial.length,
      operationalIncidents: spatialIncidents.length,
      eventCandidates: spatialEvents.length + archiveNormalized.filter((i) => i.eventCandidateId).length,
      observations: archiveNormalized.filter((i) => i.kind === AGENT2_ENTITY_KIND.OBSERVATION).length,
      spatialResults: spatialIncidents.length + spatialEvents.length + spatialObservations.length,
      nonSpatialResults: nonSpatial.length,
      sourceFamilies: sourceFamilies.length,
      mapIncidentMarkers: spatialIncidents.length
    },
    operationalIncidents: spatialIncidents,
    results: allResults,
    nonSpatial,
    spatial: spatialAll,
    accounting: {
      agent2IncidentsReturned: incidentFeatures.length,
      agent2IncidentsDeduped: incidents.length,
      agent2IncidentsDedupRemoved: Math.max(0, incidentFeatures.length - incidents.length),
      agent2ArchiveReturned: archiveItems.length,
      incidentsOutOfRadius,
      mapMarkersRendered: spatialAll.length,
      mapMarkersSkippedNoGeometry: incidentsRaw.filter((i) => !i.spatial).length,
      renderedMapIncidents: spatialIncidents.length,
      nonSpatialRetained: nonSpatial.length
    }
  };
}

export { pickIncidentTitle };
