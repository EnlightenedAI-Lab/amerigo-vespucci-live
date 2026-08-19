function formatPosition(position) {
  if (!position || position.latitude === null || position.longitude === null) return null;
  return `${position.latitude.toFixed(5)}, ${position.longitude.toFixed(5)}`;
}

function serializeAttributes(attributes) {
  if (!attributes) return null;
  const entries = Object.entries(attributes);
  if (entries.length === 0) return null;
  return entries.map(([key, value]) => `${key}=${JSON.stringify(value)}`).join(', ');
}

function intentOf(question) {
  const normalized = String(question ?? '').trim().toLowerCase();
  if (/how far|distance|travelled|traveled/.test(normalized)) return 'TRAVERSAL';
  if (/what date|what time|actually looking|observation time|target time/.test(normalized)) return 'TIME';
  if (/capabilit|what can/.test(normalized)) return 'CAPABILITIES';
  if (/authoritative|authority|inferred/.test(normalized)) return 'AUTHORITY';
  if (/what do we know about.*object|what object|acquired object/.test(normalized)) return 'OBJECT';
  if (/what is unknown|what.*unknown|missing/.test(normalized)) return 'UNKNOWN';
  if (/inspect next|what should|next action|do next/.test(normalized)) return 'ACTIONS';
  if (/what am i looking at|where am i|current view/.test(normalized)) return 'VIEW';
  return 'GENERAL';
}

function viewFacts(snapshot) {
  const known = [];
  const unknown = [];
  if (snapshot.worldview.activeView) {
    known.push(`The active view is ${snapshot.worldview.activeView}.`);
  } else {
    unknown.push('The active view is unknown.');
  }
  const position = formatPosition(snapshot.worldview.position);
  if (position) {
    known.push(`The WorldView position is ${position}.`);
  } else {
    unknown.push('The WorldView position is unknown.');
  }
  if (snapshot.worldview.distanceMeters !== null) {
    known.push(`The WorldView distance/scale value is ${snapshot.worldview.distanceMeters} meters.`);
  }
  if (snapshot.worldview.headingDegrees !== null) {
    known.push(`The WorldView heading is ${snapshot.worldview.headingDegrees} degrees.`);
  }
  if (snapshot.worldview.activeView === 'STREET_360') {
    if (snapshot.street360?.panoId) known.push(`The active panorama ID is ${snapshot.street360.panoId}.`);
    if (snapshot.street360?.provider) known.push(`The panorama provider is ${snapshot.street360.provider}.`);
    const panoPosition = formatPosition(snapshot.street360?.position);
    if (panoPosition) known.push(`The panorama position is ${panoPosition}.`);
  }
  return { known, unknown };
}

function objectFacts(snapshot) {
  const known = [];
  const unknown = [];
  if (snapshot.object === null) {
    known.push('The snapshot contains no acquired object.');
    unknown.push('Object identity is unknown because no object is acquired.');
    return { known, unknown };
  }

  const object = snapshot.object;
  if (object.summary) known.push(`Object summary: ${object.summary}.`);
  if (object.objectClass) known.push(`The object class is ${object.objectClass}.`);
  if (object.sourceId) known.push(`The source ID is ${object.sourceId}.`);
  if (object.authority) {
    known.push(`The stated object authority is ${object.authority}.`);
  } else {
    unknown.push('The object authority is unknown.');
  }
  const attributes = serializeAttributes(object.attributes);
  if (attributes) known.push(`Source attributes: ${attributes}.`);
  if (object.provenance) {
    known.push(`Object provenance: ${serializeAttributes(object.provenance)}.`);
  } else {
    unknown.push('The object provenance is unknown.');
  }
  if (!object.summary && !object.objectClass && !object.sourceId) {
    known.push('An object state is present, but its identity fields are unresolved.');
    unknown.push('The object identity, class, and source ID are unknown.');
  }
  return { known, unknown };
}

function timeFacts(snapshot) {
  const known = [];
  const unknown = [];
  const { targetTime, displayedObservation, provider } = snapshot.time;
  if (displayedObservation) {
    known.push(`The displayed observation time is ${displayedObservation}.`);
  } else {
    unknown.push('The displayed observation time is unknown.');
  }
  if (targetTime) {
    known.push(`The requested target time is ${targetTime}.`);
  } else {
    unknown.push('No target time is supplied.');
  }
  if (provider) known.push(`The displayed observation time provider is ${provider}.`);
  if (snapshot.street360?.captureDate) {
    known.push(`The Street 360 capture date is ${snapshot.street360.captureDate}.`);
  }
  if (targetTime && displayedObservation) {
    if (targetTime === displayedObservation) {
      known.push('The target time and displayed observation time are equal.');
    } else {
      known.push(`The target time (${targetTime}) differs from the displayed observation time (${displayedObservation}).`);
    }
  }
  return { known, unknown };
}

function traversalFacts(snapshot) {
  if (!snapshot.traversal) {
    return {
      known: [],
      unknown: ['Travel distance is unknown because no traversal state is supplied.']
    };
  }
  return {
    known: [
      `The traversal contains ${snapshot.traversal.pointCount} points.`,
      `The supplied travelled distance is ${snapshot.traversal.distanceMeters} meters.`
    ],
    unknown: []
  };
}

function capabilityFacts(snapshot) {
  if (snapshot.availableCapabilities.length === 0) {
    return { known: ['The snapshot reports no available capabilities.'], unknown: [] };
  }
  return {
    known: [`Available capabilities: ${snapshot.availableCapabilities.join(', ')}.`],
    unknown: []
  };
}

function comprehensiveUnknowns(snapshot) {
  const unknown = [];
  if (snapshot.worldview.position === null) unknown.push('The WorldView position is unknown.');
  if (snapshot.worldview.activeView === null) unknown.push('The active view is unknown.');
  if (snapshot.street360 === null) unknown.push('No Street 360 state is supplied.');
  if (snapshot.traversal === null) unknown.push('No traversal state is supplied.');
  if (snapshot.focus === null) unknown.push('No geographic target or AOI is supplied.');
  if (snapshot.object === null) {
    unknown.push('No acquired object is supplied.');
  } else {
    if (!snapshot.object.sourceId) unknown.push('The object source ID is unknown.');
    if (!snapshot.object.objectClass) unknown.push('The object class is unknown.');
    if (!snapshot.object.authority) unknown.push('The object authority is unknown.');
    if (!snapshot.object.provenance) unknown.push('The object provenance is unknown.');
  }
  if (!snapshot.time.targetTime) unknown.push('No target time is supplied.');
  if (!snapshot.time.displayedObservation) unknown.push('The displayed observation time is unknown.');
  if (snapshot.sensorPose === null) unknown.push('SensorPose is not supplied.');
  if (snapshot.collection === null) unknown.push('No collection state is supplied.');
  return unknown;
}

export function factsForQuestion(snapshot, question) {
  const intent = intentOf(question);
  if (intent === 'VIEW') return { intent, ...viewFacts(snapshot) };
  if (intent === 'OBJECT' || intent === 'AUTHORITY') return { intent, ...objectFacts(snapshot) };
  if (intent === 'TIME') return { intent, ...timeFacts(snapshot) };
  if (intent === 'TRAVERSAL') return { intent, ...traversalFacts(snapshot) };
  if (intent === 'CAPABILITIES') return { intent, ...capabilityFacts(snapshot) };
  if (intent === 'UNKNOWN') {
    return {
      intent,
      known: [],
      unknown: comprehensiveUnknowns(snapshot)
    };
  }
  if (intent === 'ACTIONS') {
    return {
      intent,
      known: capabilityFacts(snapshot).known,
      unknown: []
    };
  }

  const sections = [viewFacts(snapshot), objectFacts(snapshot), timeFacts(snapshot), traversalFacts(snapshot)];
  return {
    intent,
    known: sections.flatMap((section) => section.known),
    unknown: sections.flatMap((section) => section.unknown)
  };
}

export function inferenceCandidates(snapshot) {
  const candidates = [];
  if (
    snapshot.time.targetTime &&
    snapshot.time.displayedObservation &&
    snapshot.time.targetTime !== snapshot.time.displayedObservation
  ) {
    candidates.push({
      id: 'temporal-context-mismatch',
      statement: 'Time-specific interpretation requires a comparison because the requested target and displayed observation represent different times.'
    });
  }
  if (snapshot.worldview.activeView === 'STREET_360') {
    candidates.push({
      id: 'street-view-context-only',
      statement: 'Street 360 can provide visual context, but imagery alone does not establish authoritative spatial identity.'
    });
  }
  if (snapshot.object?.authority && snapshot.object?.sourceId) {
    candidates.push({
      id: 'source-governed-object',
      statement: 'The acquired object can support source-governed inspection, while its stated provenance remains controlling.'
    });
  }
  return candidates;
}

export function actionCandidates(snapshot) {
  const available = new Set(snapshot.availableCapabilities);
  const actions = [];
  const add = (id, action) => {
    if (available.has(action.requiredCapability)) actions.push({ id, ...action });
  };

  add('inspect-map', {
    actionType: 'INSPECT_MAP',
    label: 'Inspect current map context',
    reason: 'MAP is available from this snapshot.',
    requiredCapability: 'MAP',
    riskTruthNotes: 'Proposal only; it does not move or modify a live map.'
  });
  add('open-street-360', {
    actionType: 'OPEN_STREET_360',
    label: snapshot.object?.sourceId ? 'Inspect the acquired object in Street 360' : 'Inspect the current location in Street 360',
    reason: snapshot.object?.sourceId
      ? 'An acquired object and STREET_360 capability are present.'
      : 'STREET_360 capability is present for visual context.',
    requiredCapability: 'STREET_360',
    riskTruthNotes: 'Imagery is contextual and must not override authoritative identity or geometry.'
  });
  if (snapshot.object?.sourceId) {
    add('open-scene-3d', {
      actionType: 'OPEN_SCENE_3D',
      label: 'Open the acquired object in 3D',
      reason: 'An acquired object and SCENE_3D capability are present.',
      requiredCapability: 'SCENE_3D',
      riskTruthNotes: 'Proposal only; no camera or scene is changed.'
    });
  }
  if (snapshot.object !== null || snapshot.focus !== null) {
    add('measure', {
      actionType: 'MEASURE',
      label: 'Measure the selected context',
      reason: 'A focus or object is present and MEASURE capability is available.',
      requiredCapability: 'MEASURE',
      riskTruthNotes: 'Measurement method and source must be preserved; no measurement is claimed yet.'
    });
  }
  add('query-authority', {
    actionType: 'QUERY_GIS',
    label: snapshot.object?.sourceId ? 'Query related authoritative assets' : 'Query authoritative GIS for identity',
    reason: snapshot.object?.sourceId
      ? 'QUERY_GIS is available for source-backed context.'
      : 'Object identity is unresolved and QUERY_GIS is available.',
    requiredCapability: 'QUERY_GIS',
    riskTruthNotes: 'Proposal only; no GIS query or network write has been executed.'
  });
  if (snapshot.time.targetTime || snapshot.time.displayedObservation) {
    add('compare-time', {
      actionType: 'COMPARE_TIME',
      label: 'Compare target and displayed observation times',
      reason: 'Temporal state is present and TIME capability is available.',
      requiredCapability: 'TIME',
      riskTruthNotes: 'The target time and observation time remain distinct unless the supplied values match.'
    });
  }
  if (snapshot.object?.authority && snapshot.object?.sourceId) {
    add('place-camera', {
      actionType: 'PLACE_CAMERA',
      label: 'Place a virtual camera near the acquired object',
      reason: 'The object has stated authority/source identity and PLACE_CAMERA is available.',
      requiredCapability: 'PLACE_CAMERA',
      riskTruthNotes: 'Proposal only; no camera has been placed or moved.'
    });
  }
  return actions;
}

export function groundingEnvelope(snapshot, question) {
  const facts = factsForQuestion(snapshot, question);
  return Object.freeze({
    snapshotId: snapshot.snapshotId,
    question: String(question ?? '').trim(),
    intent: facts.intent,
    known: Object.freeze([...new Set(facts.known)]),
    unknown: Object.freeze([...new Set(facts.unknown)]),
    inferenceCandidates: Object.freeze(inferenceCandidates(snapshot)),
    actionCandidates: Object.freeze(actionCandidates(snapshot))
  });
}
