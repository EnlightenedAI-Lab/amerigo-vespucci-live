/**
 * Pure deterministic GIS plan validator — no LLM involvement.
 */

import {
  GIS_CAPABILITY_REGISTRY,
  GIS_PLAN_SCHEMA_VERSION,
  PRODUCT_LIMITS,
  PROHIBITED_PLAN_FIELDS,
  DATASET_REGISTRY,
  FILTER_FIELD_SEMANTICS,
  OPERATION_REGISTRY,
  NON_AI_ADDRESSABLE_OPERATIONS,
  resolveDatasetKey,
  resolveOperationId
} from './a1-gis-capability-registry.js';

/**
 * @typedef {{ code: string, field?: string, message: string }} GisPlanValidationError
 * @typedef {{ valid: true, normalizedPlan: object, diagnostics: string[] }} GisPlanValidResult
 * @typedef {{ valid: false, errors: GisPlanValidationError[] }} GisPlanInvalidResult
 */

function pushError(errors, code, field, message) {
  errors.push({ code, field, message });
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * @param {unknown} value
 * @param {string} path
 * @param {GisPlanValidationError[]} errors
 */
function scanProhibitedFields(value, path, errors) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => scanProhibitedFields(item, `${path}[${index}]`, errors));
    return;
  }
  if (!isPlainObject(value)) return;
  for (const [key, child] of Object.entries(value)) {
    const childPath = path ? `${path}.${key}` : key;
    if (PROHIBITED_PLAN_FIELDS.includes(key)) {
      pushError(errors, 'PROHIBITED_INTERNAL_FIELD', childPath, `Field "${key}" is not permitted in a GIS plan.`);
    }
    scanProhibitedFields(child, childPath, errors);
  }
}

/**
 * @param {unknown} version
 */
function isSupportedSchemaVersion(version) {
  const text = String(version || '').trim();
  if (!text) return false;
  const [major] = text.split('.');
  const [supportedMajor] = GIS_PLAN_SCHEMA_VERSION.split('.');
  return major === supportedMajor && GIS_CAPABILITY_REGISTRY.schemaVersion.startsWith(`${major}.`);
}

/**
 * @param {unknown} radius
 * @param {GisPlanValidationError[]} errors
 * @param {string[]} diagnostics
 */
function normalizeRadius(radius, errors, diagnostics) {
  if (radius == null) return null;

  if (typeof radius === 'string') {
    const match = String(radius).trim().match(/^(\d+(?:\.\d+)?)\s*(km|kilometres?|kilometers?|m|metres?|meters?)$/i);
    if (!match) {
      pushError(errors, 'INVALID_RADIUS', 'radius', 'Radius must be a numeric distance with unit km or m.');
      return null;
    }
    const value = parseFloat(match[1]);
    const unit = /^m/i.test(match[2]) ? 'm' : 'km';
    diagnostics.push(`normalized radius string "${radius}" → { value: ${value}, unit: "${unit}" }`);
    return normalizeRadius({ value, unit }, errors, diagnostics);
  }

  if (!isPlainObject(radius)) {
    pushError(errors, 'INVALID_RADIUS', 'radius', 'Radius must be an object with value and unit.');
    return null;
  }

  const value = Number(radius.value);
  const unit = String(radius.unit || 'km').trim().toLowerCase();
  if (!Number.isFinite(value) || value <= 0) {
    pushError(errors, 'INVALID_RADIUS', 'radius.value', 'Radius value must be a positive finite number.');
    return null;
  }
  if (unit !== 'km' && unit !== 'm') {
    pushError(errors, 'INVALID_RADIUS', 'radius.unit', 'Radius unit must be km or m.');
    return null;
  }

  const radiusMeters = unit === 'km' ? value * 1000 : value;
  const radiusKm = unit === 'km' ? value : value / 1000;

  if (radiusMeters < PRODUCT_LIMITS.minRadiusM) {
    pushError(errors, 'INVALID_RADIUS', 'radius', `Radius must be at least ${PRODUCT_LIMITS.minRadiusM} m.`);
    return null;
  }
  if (radiusKm > PRODUCT_LIMITS.maxRadiusKm) {
    pushError(errors, 'INVALID_RADIUS', 'radius', `Radius exceeds maximum ${PRODUCT_LIMITS.maxRadiusKm} km.`);
    return null;
  }

  return { value: radiusKm, unit: 'km', meters: Math.round(radiusMeters) };
}

function resolveConversationLocationRef(ref) {
  const normalized = String(ref || '').trim().toLowerCase().replace(/[\s_-]+/g, '');
  if (['lastlocation', 'previouslocation', 'thisaddress', 'thislocation'].includes(normalized)) {
    return 'last_location';
  }
  return String(ref || '').trim().toLowerCase();
}

/**
 * @param {unknown} location
 * @param {unknown} locationRef
 * @param {object} context
 * @param {GisPlanValidationError[]} errors
 * @param {string[]} diagnostics
 */
function normalizeLocation(location, locationRef, context, errors, diagnostics) {
  if (location != null) {
    if (typeof location === 'string') {
      const text = location.trim();
      if (!text) {
        pushError(errors, 'MISSING_LOCATION', 'location', 'Location text cannot be empty.');
      } else {
        diagnostics.push('normalized location string to address object');
        return { type: 'address', text, source: 'explicit' };
      }
    } else if (isPlainObject(location)) {
      const type = String(location.type || '').trim().toLowerCase();
      if (type === 'address') {
        const text = String(location.text || '').trim();
        if (!text) {
          pushError(errors, 'MISSING_LOCATION', 'location.text', 'Address text is required.');
        } else if (text.length > PRODUCT_LIMITS.maxLocationTextLength) {
          pushError(errors, 'INVALID_LOCATION', 'location.text', 'Address text is too long.');
        } else {
          if (locationRef != null) diagnostics.push('ignored locationRef because explicit location was provided');
          return { type: 'address', text, source: 'explicit' };
        }
      } else if (type === 'coordinates') {
        const lon = Number(location.longitude);
        const lat = Number(location.latitude);
        const crs = String(location.crs || location.spatialReference || '').trim().toUpperCase();
        if (!Number.isFinite(lon) || !Number.isFinite(lat)) {
          pushError(errors, 'INVALID_LOCATION', 'location', 'Coordinates must include finite longitude and latitude.');
        } else if (lon < -180 || lon > 180 || lat < -90 || lat > 90) {
          pushError(errors, 'INVALID_LOCATION', 'location', 'Coordinates are out of bounds.');
        } else if (crs && crs !== PRODUCT_LIMITS.coordinateCrs) {
          pushError(errors, 'INVALID_LOCATION', 'location.crs', `Unsupported coordinate reference system "${crs}".`);
        } else {
          return {
            type: 'coordinates',
            longitude: lon,
            latitude: lat,
            crs: PRODUCT_LIMITS.coordinateCrs,
            source: 'explicit'
          };
        }
      } else {
        pushError(errors, 'INVALID_LOCATION', 'location.type', 'Location type must be address or coordinates.');
      }
    } else {
      pushError(errors, 'INVALID_LOCATION', 'location', 'Location must be an address object or locationRef.');
    }
  }

  if (locationRef != null) {
    if (!isPlainObject(locationRef)) {
      pushError(errors, 'INVALID_LOCATION', 'locationRef', 'locationRef must be an object.');
      return null;
    }
    const refType = String(locationRef.type || '').trim().toLowerCase();
    const ref = resolveConversationLocationRef(locationRef.ref);
    if (refType !== 'conversation' || ref !== 'last_location') {
      pushError(errors, 'CONTEXT_REFERENCE_UNAVAILABLE', 'locationRef', 'Unsupported location reference.');
      return null;
    }
    const resolved = String(
      context?.previousLocationText
      || context?.conversationState?.lastLocationText
      || ''
    ).trim();
    if (!resolved) {
      pushError(errors, 'CONTEXT_REFERENCE_UNAVAILABLE', 'locationRef', 'No prior location is available in conversation context.');
      return null;
    }
    diagnostics.push('resolved locationRef from conversation context');
    return { type: 'address', text: resolved, source: 'conversation_ref' };
  }

  return null;
}

/**
 * @param {unknown} filters
 * @param {string | null} datasetKey
 * @param {GisPlanValidationError[]} errors
 */
function normalizeFilters(filters, datasetKey, errors) {
  if (filters == null) return [];
  if (!Array.isArray(filters)) {
    pushError(errors, 'INVALID_FILTER', 'filters', 'Filters must be an array.');
    return [];
  }

  /** @type {object[]} */
  const normalized = [];
  for (let i = 0; i < filters.length; i += 1) {
    const raw = filters[i];
    const fieldPath = `filters[${i}]`;
    if (!isPlainObject(raw)) {
      pushError(errors, 'INVALID_FILTER', fieldPath, 'Each filter must be an object.');
      continue;
    }
    const fieldSemantic = String(raw.fieldSemantic || raw.field || '').trim().toLowerCase();
    const operator = String(raw.operator || 'equals').trim().toLowerCase();
    const spec = FILTER_FIELD_SEMANTICS[fieldSemantic];
    if (!spec) {
      pushError(errors, 'INVALID_FILTER', `${fieldPath}.fieldSemantic`, `Unsupported filter field "${fieldSemantic}".`);
      continue;
    }
    if (!spec.operators.includes(operator)) {
      pushError(errors, 'INVALID_FILTER', `${fieldPath}.operator`, `Unsupported operator "${operator}".`);
      continue;
    }
    if (datasetKey && !spec.permittedDatasets.includes(datasetKey)) {
      pushError(errors, 'INVALID_FILTER', fieldPath, `Filter "${fieldSemantic}" is not supported for this dataset.`);
      continue;
    }
    if (typeof raw.value === 'string' && /(?:\bselect\b|\bfrom\b|\bwhere\b|;|--)/i.test(raw.value)) {
      pushError(errors, 'INVALID_FILTER', `${fieldPath}.value`, 'Raw SQL is not permitted in filter values.');
      continue;
    }
    const value = raw.value === true || raw.value === 'true' || raw.value === 'active';
    if (spec.valueType === 'boolean' && typeof raw.value !== 'boolean' && raw.value !== 'true' && raw.value !== 'false' && raw.value !== 'active') {
      pushError(errors, 'INVALID_FILTER', `${fieldPath}.value`, 'Filter value must be boolean.');
      continue;
    }
    normalized.push({
      fieldSemantic,
      operator,
      value: spec.valueType === 'boolean' ? value : raw.value
    });
  }
  return normalized;
}

/**
 * @param {unknown} candidatePlan
 * @param {object} [registry]
 * @param {object} [context]
 * @returns {GisPlanValidResult | GisPlanInvalidResult}
 */
export function validateGISPlan(candidatePlan, registry = GIS_CAPABILITY_REGISTRY, context = {}) {
  /** @type {GisPlanValidationError[]} */
  const errors = [];
  /** @type {string[]} */
  const diagnostics = [];

  if (!isPlainObject(candidatePlan)) {
    return {
      valid: false,
      errors: [{ code: 'MALFORMED_PLAN', message: 'GIS plan must be a JSON object.' }]
    };
  }

  scanProhibitedFields(candidatePlan, '', errors);

  if (Array.isArray(candidatePlan.operations) || candidatePlan.commands) {
    pushError(errors, 'MALFORMED_PLAN', 'operations', 'Multiple operations are not supported in a single GIS plan.');
  }

  const schemaVersion = candidatePlan.schemaVersion ?? candidatePlan.version;
  if (!isSupportedSchemaVersion(schemaVersion)) {
    pushError(errors, 'SCHEMA_VERSION_UNSUPPORTED', 'schemaVersion', `Unsupported schema version "${schemaVersion}".`);
  }

  const rawOperation = candidatePlan.operation ?? candidatePlan.action;
  const operationId = resolveOperationId(rawOperation);
  if (!operationId) {
    const blocked = NON_AI_ADDRESSABLE_OPERATIONS.includes(String(rawOperation || '').trim().toUpperCase());
    pushError(
      errors,
      blocked ? 'UNSUPPORTED_OPERATION' : 'UNSUPPORTED_OPERATION',
      'operation',
      blocked
        ? `Operation "${rawOperation}" is not AI-addressable.`
        : `Unknown operation "${rawOperation}".`
    );
  }

  const operation = operationId ? OPERATION_REGISTRY[operationId] : null;

  let datasetKey = null;
  if (candidatePlan.dataset != null) {
    datasetKey = resolveDatasetKey(candidatePlan.dataset);
    if (!datasetKey) {
      pushError(errors, 'UNSUPPORTED_DATASET', 'dataset', `Unknown dataset "${candidatePlan.dataset}".`);
    }
  }

  if (operation) {
    if (operation.requiresDataset && !datasetKey) {
      pushError(errors, 'UNSUPPORTED_DATASET', 'dataset', 'A dataset is required for this operation.');
    }
    if (!operation.requiresDataset && datasetKey) {
      pushError(errors, 'UNSUPPORTED_DATASET_OPERATION', 'dataset', 'Dataset must not be supplied for this operation.');
    }
    if (datasetKey && !operation.permittedDatasets.includes(datasetKey)) {
      pushError(errors, 'UNSUPPORTED_DATASET_OPERATION', 'dataset', `Dataset "${datasetKey}" is not permitted for ${operationId}.`);
    }
    if (!operation.permitsFilters && candidatePlan.filters != null) {
      pushError(errors, 'INVALID_FILTER', 'filters', 'Filters are not permitted for this operation.');
    }
  }

  const normalizedLocation = normalizeLocation(
    candidatePlan.location,
    candidatePlan.locationRef,
    context,
    errors,
    diagnostics
  );

  const normalizedRadius = operation?.requiresRadius
    ? normalizeRadius(candidatePlan.radius, errors, diagnostics)
    : (candidatePlan.radius != null ? normalizeRadius(candidatePlan.radius, errors, diagnostics) : null);

  let normalizedLimit = null;
  if (candidatePlan.limit != null) {
    const limit = Number(candidatePlan.limit);
    if (!Number.isInteger(limit)) {
      pushError(errors, 'INVALID_LIMIT', 'limit', 'Limit must be an integer.');
    } else if (limit < PRODUCT_LIMITS.minNearestLimit || limit > PRODUCT_LIMITS.maxNearestLimit) {
      pushError(
        errors,
        'INVALID_LIMIT',
        'limit',
        `Limit must be between ${PRODUCT_LIMITS.minNearestLimit} and ${PRODUCT_LIMITS.maxNearestLimit}.`
      );
    } else {
      normalizedLimit = limit;
    }
  }

  if (operation?.requiresLocation && !normalizedLocation) {
    if (!errors.some((e) => e.code === 'MISSING_LOCATION' || e.code === 'CONTEXT_REFERENCE_UNAVAILABLE')) {
      pushError(errors, 'MISSING_LOCATION', 'location', 'A location or locationRef is required.');
    }
  }
  if (operation?.requiresRadius && !normalizedRadius) {
    if (!errors.some((e) => e.code === 'INVALID_RADIUS')) {
      pushError(errors, 'INVALID_RADIUS', 'radius', 'A valid radius is required.');
    }
  }
  if (operation?.requiresLimit && normalizedLimit == null) {
    if (!errors.some((e) => e.code === 'INVALID_LIMIT')) {
      pushError(errors, 'INVALID_LIMIT', 'limit', 'A valid limit is required.');
    }
  }

  const normalizedFilters = operation?.permitsFilters
    ? normalizeFilters(candidatePlan.filters, datasetKey, errors)
    : [];

  if (errors.length) {
    return { valid: false, errors };
  }

  /** @type {Record<string, unknown>} */
  const normalizedPlan = {
    schemaId: registry.schemaId,
    schemaVersion: GIS_PLAN_SCHEMA_VERSION,
    operation: operationId
  };

  if (datasetKey) {
    normalizedPlan.dataset = datasetKey;
    normalizedPlan.datasetDisplayName = DATASET_REGISTRY[datasetKey].displayName;
  }
  if (normalizedLocation) normalizedPlan.location = normalizedLocation;
  if (normalizedRadius) normalizedPlan.radius = normalizedRadius;
  if (normalizedLimit != null) normalizedPlan.limit = normalizedLimit;
  if (normalizedFilters.length) normalizedPlan.filters = normalizedFilters;
  if (candidatePlan.requestedOutput != null) {
    normalizedPlan.requestedOutput = String(candidatePlan.requestedOutput).trim().toLowerCase();
  }

  return {
    valid: true,
    normalizedPlan,
    diagnostics
  };
}
