const CAPABILITIES = new Set([
  'MAP',
  'STREET_360',
  'SCENE_3D',
  'MEASURE',
  'QUERY_GIS',
  'TIME',
  'PLACE_CAMERA'
]);

const ACTIVE_VIEWS = new Set(['MAP', 'STREET_360', 'SCENE_3D']);
const ACTION_TYPES = new Set([
  'INSPECT_MAP',
  'OPEN_STREET_360',
  'OPEN_SCENE_3D',
  'MEASURE',
  'QUERY_GIS',
  'COMPARE_TIME',
  'PLACE_CAMERA'
]);

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function assert(condition, message) {
  if (!condition) throw new TypeError(message);
}

function assertNullableString(value, path) {
  assert(value === null || typeof value === 'string', `${path} must be a string or null`);
}

function assertNullableFinite(value, path) {
  assert(value === null || Number.isFinite(value), `${path} must be a finite number or null`);
}

function assertPosition(value, path) {
  assert(value === null || isRecord(value), `${path} must be an object or null`);
  if (value === null) return;
  assertNullableFinite(value.latitude, `${path}.latitude`);
  assertNullableFinite(value.longitude, `${path}.longitude`);
  assert(
    (value.latitude === null) === (value.longitude === null),
    `${path} latitude and longitude must both be known or both be null`
  );
}

function assertExactKeys(value, expected, path) {
  const keys = Object.keys(value).sort();
  const wanted = [...expected].sort();
  assert(
    keys.length === wanted.length && keys.every((key, index) => key === wanted[index]),
    `${path} must contain exactly: ${wanted.join(', ')}`
  );
}

export function validateWorldStateSnapshot(snapshot) {
  assert(isRecord(snapshot), 'WorldStateSnapshot must be an object');
  assertExactKeys(snapshot, [
    'snapshotId',
    'capturedAt',
    'worldview',
    'street360',
    'traversal',
    'focus',
    'object',
    'time',
    'sensorPose',
    'collection',
    'availableCapabilities'
  ], 'WorldStateSnapshot');

  assert(typeof snapshot.snapshotId === 'string' && snapshot.snapshotId.length > 0, 'snapshotId is required');
  assert(
    typeof snapshot.capturedAt === 'string' && Number.isFinite(Date.parse(snapshot.capturedAt)),
    'capturedAt must be an ISO-compatible date string'
  );

  assert(isRecord(snapshot.worldview), 'worldview must be an object');
  assertExactKeys(snapshot.worldview, ['position', 'distanceMeters', 'headingDegrees', 'activeView'], 'worldview');
  assertPosition(snapshot.worldview.position, 'worldview.position');
  assertNullableFinite(snapshot.worldview.distanceMeters, 'worldview.distanceMeters');
  assertNullableFinite(snapshot.worldview.headingDegrees, 'worldview.headingDegrees');
  assert(
    snapshot.worldview.activeView === null || ACTIVE_VIEWS.has(snapshot.worldview.activeView),
    'worldview.activeView must be MAP, STREET_360, SCENE_3D, or null'
  );

  assert(snapshot.street360 === null || isRecord(snapshot.street360), 'street360 must be an object or null');
  if (snapshot.street360 !== null) {
    assertExactKeys(
      snapshot.street360,
      ['provider', 'panoId', 'position', 'headingDegrees', 'pitchDegrees', 'zoom', 'captureDate'],
      'street360'
    );
    assertNullableString(snapshot.street360.provider, 'street360.provider');
    assertNullableString(snapshot.street360.panoId, 'street360.panoId');
    assertPosition(snapshot.street360.position, 'street360.position');
    assertNullableFinite(snapshot.street360.headingDegrees, 'street360.headingDegrees');
    assertNullableFinite(snapshot.street360.pitchDegrees, 'street360.pitchDegrees');
    assertNullableFinite(snapshot.street360.zoom, 'street360.zoom');
    assertNullableString(snapshot.street360.captureDate, 'street360.captureDate');
  }

  assert(snapshot.traversal === null || isRecord(snapshot.traversal), 'traversal must be an object or null');
  if (snapshot.traversal !== null) {
    assertExactKeys(snapshot.traversal, ['pointCount', 'distanceMeters'], 'traversal');
    assert(Number.isInteger(snapshot.traversal.pointCount) && snapshot.traversal.pointCount >= 0, 'traversal.pointCount must be a non-negative integer');
    assert(Number.isFinite(snapshot.traversal.distanceMeters) && snapshot.traversal.distanceMeters >= 0, 'traversal.distanceMeters must be non-negative');
  }

  assert(snapshot.focus === null || isRecord(snapshot.focus), 'focus must be an object or null');
  if (snapshot.focus !== null) {
    assertExactKeys(snapshot.focus, ['targetType', 'label', 'geometrySummary'], 'focus');
    assertNullableString(snapshot.focus.targetType, 'focus.targetType');
    assertNullableString(snapshot.focus.label, 'focus.label');
    assertNullableString(snapshot.focus.geometrySummary, 'focus.geometrySummary');
  }

  assert(snapshot.object === null || isRecord(snapshot.object), 'object must be an object or null');
  if (snapshot.object !== null) {
    assertExactKeys(
      snapshot.object,
      ['summary', 'authority', 'sourceId', 'objectClass', 'attributes', 'provenance'],
      'object'
    );
    assertNullableString(snapshot.object.summary, 'object.summary');
    assertNullableString(snapshot.object.authority, 'object.authority');
    assertNullableString(snapshot.object.sourceId, 'object.sourceId');
    assertNullableString(snapshot.object.objectClass, 'object.objectClass');
    assert(
      snapshot.object.attributes === null || isRecord(snapshot.object.attributes),
      'object.attributes must be an object or null'
    );
    assert(
      snapshot.object.provenance === null || isRecord(snapshot.object.provenance),
      'object.provenance must be an object or null'
    );
  }

  assert(isRecord(snapshot.time), 'time must be an object');
  assertExactKeys(snapshot.time, ['targetTime', 'displayedObservation', 'provider'], 'time');
  assertNullableString(snapshot.time.targetTime, 'time.targetTime');
  assertNullableString(snapshot.time.displayedObservation, 'time.displayedObservation');
  assertNullableString(snapshot.time.provider, 'time.provider');

  assert(snapshot.sensorPose === null || isRecord(snapshot.sensorPose), 'sensorPose must be an object or null');
  assert(snapshot.collection === null || Array.isArray(snapshot.collection), 'collection must be an array or null');
  if (Array.isArray(snapshot.collection)) {
    snapshot.collection.forEach((item, index) => {
      assert(isRecord(item), `collection[${index}] must be an object`);
      assertExactKeys(item, ['sourceId', 'objectClass', 'summary'], `collection[${index}]`);
      assertNullableString(item.sourceId, `collection[${index}].sourceId`);
      assertNullableString(item.objectClass, `collection[${index}].objectClass`);
      assertNullableString(item.summary, `collection[${index}].summary`);
    });
  }

  assert(Array.isArray(snapshot.availableCapabilities), 'availableCapabilities must be an array');
  assert(
    snapshot.availableCapabilities.every((capability) => CAPABILITIES.has(capability)),
    'availableCapabilities contains an unsupported capability'
  );
  assert(
    new Set(snapshot.availableCapabilities).size === snapshot.availableCapabilities.length,
    'availableCapabilities must not contain duplicates'
  );
  return snapshot;
}

export function validateCognitiveResponse(response) {
  assert(isRecord(response), 'CognitiveResponse must be an object');
  assert(typeof response.summary === 'string', 'summary must be a string');
  for (const key of ['known', 'inferred', 'unknown', 'warnings']) {
    assert(Array.isArray(response[key]), `${key} must be an array`);
    assert(response[key].every((entry) => typeof entry === 'string'), `${key} entries must be strings`);
  }
  const known = new Set(response.known);
  assert(response.inferred.every((entry) => !known.has(entry)), 'KNOWN and INFERRED must not overlap');

  assert(Array.isArray(response.proposedActions), 'proposedActions must be an array');
  response.proposedActions.forEach((action, index) => {
    assert(isRecord(action), `proposedActions[${index}] must be an object`);
    assertExactKeys(
      action,
      ['actionType', 'label', 'reason', 'requiredCapability', 'riskTruthNotes'],
      `proposedActions[${index}]`
    );
    assert(ACTION_TYPES.has(action.actionType), `proposedActions[${index}].actionType is unsupported`);
    assert(typeof action.label === 'string' && action.label.length > 0, `proposedActions[${index}].label is required`);
    assert(typeof action.reason === 'string' && action.reason.length > 0, `proposedActions[${index}].reason is required`);
    assert(CAPABILITIES.has(action.requiredCapability), `proposedActions[${index}].requiredCapability is unsupported`);
    assert(typeof action.riskTruthNotes === 'string' && action.riskTruthNotes.length > 0, `proposedActions[${index}].riskTruthNotes is required`);
  });

  assert(isRecord(response.modelMetadata), 'modelMetadata must be an object');
  for (const key of ['provider', 'model', 'runtime']) {
    assert(typeof response.modelMetadata[key] === 'string', `modelMetadata.${key} must be a string`);
  }
  return response;
}

export function cloneReadonlySnapshot(snapshot) {
  validateWorldStateSnapshot(snapshot);
  return deepFreeze(structuredClone(snapshot));
}

export function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    Object.values(value).forEach(deepFreeze);
  }
  return value;
}

export const contractEnums = Object.freeze({
  capabilities: Object.freeze([...CAPABILITIES]),
  activeViews: Object.freeze([...ACTIVE_VIEWS]),
  actionTypes: Object.freeze([...ACTION_TYPES])
});
