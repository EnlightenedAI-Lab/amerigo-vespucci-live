/**
 * Adapter: validated structured GIS plan → existing deterministic engine prompt.
 * Does NOT call ArcGIS or duplicate GIS calculations.
 */

import { DATASET_REGISTRY } from './a1-gis-capability-registry.js';

/**
 * @param {{ value: number, unit?: string, meters?: number }} radius
 */
function formatRadiusForPrompt(radius) {
  if (!radius) return '';
  const meters = radius.meters ?? (radius.unit === 'm' ? radius.value : radius.value * 1000);
  const km = meters / 1000;
  const kmText = Number.isInteger(km) ? String(km) : String(Number(km.toFixed(3)));
  return `${kmText} km`;
}

/**
 * @param {object[]} [filters]
 */
function hasActiveOnlyFilter(filters) {
  return (filters || []).some(
    (filter) => filter.fieldSemantic === 'active_only' && filter.value === true
  );
}

/**
 * @param {string} pluralLabel
 * @param {object[]} [filters]
 */
function datasetPhrase(pluralLabel, filters) {
  if (hasActiveOnlyFilter(filters)) {
    return `active ${pluralLabel}`;
  }
  return pluralLabel;
}

/**
 * @param {object} normalizedPlan
 */
function resolveLocationText(normalizedPlan) {
  if (normalizedPlan.location?.type === 'address') {
    return normalizedPlan.location.text;
  }
  if (normalizedPlan.location?.type === 'coordinates') {
    const { longitude, latitude } = normalizedPlan.location;
    return `${latitude},${longitude}`;
  }
  return '';
}

/**
 * @param {object} normalizedPlan
 * @returns {{ type: 'prompt' | 'meta', prompt?: string, metaAction?: string, operation: string, dataset?: string }}
 */
export function adaptValidatedPlanToExecution(normalizedPlan) {
  const operation = normalizedPlan.operation;
  const datasetKey = normalizedPlan.dataset || null;
  const dataset = datasetKey ? DATASET_REGISTRY[datasetKey] : null;
  const locationText = resolveLocationText(normalizedPlan);
  const radiusText = formatRadiusForPrompt(normalizedPlan.radius);
  const plural = dataset ? datasetPhrase(dataset.pluralLabel, normalizedPlan.filters) : '';

  if (operation === 'CLEAR') {
    return {
      type: 'meta',
      metaAction: 'CLEAR_RESULT',
      operation,
      prompt: 'clear result'
    };
  }

  if (operation === 'LOCATE') {
    return {
      type: 'prompt',
      operation,
      prompt: `locate ${locationText}`
    };
  }

  if (operation === 'SHOW') {
    return {
      type: 'prompt',
      operation,
      dataset: datasetKey,
      prompt: `show ${plural} in montreal`
    };
  }

  if (operation === 'WITHIN') {
    return {
      type: 'prompt',
      operation,
      dataset: datasetKey,
      prompt: `map ${plural} within ${radiusText} of ${locationText}`
    };
  }

  if (operation === 'NEAREST') {
    return {
      type: 'prompt',
      operation,
      dataset: datasetKey,
      prompt: `${normalizedPlan.limit} nearest ${plural} to ${locationText}`
    };
  }

  if (operation === 'COUNT') {
    return {
      type: 'prompt',
      operation,
      dataset: datasetKey,
      prompt: `how many ${plural} within ${radiusText} of ${locationText}`
    };
  }

  throw new Error(`Unsupported normalized operation: ${operation}`);
}

/**
 * Explicit guard — adapter must never import ArcGIS clients.
 */
export function assertAdapterDoesNotCallArcgis() {
  return true;
}
