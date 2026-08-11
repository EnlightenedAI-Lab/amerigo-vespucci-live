/**
 * ObjectiveSpec normalization — reuses existing deterministic parser/planner.
 */
import { randomUUID } from 'node:crypto';
import { parseSpatialIntent } from '../mapper-intent.js';
import { planCompoundPrompt } from '../spatial-compound-planner.js';
import { createObjectiveSpec } from './contracts.js';

/**
 * @param {string} prompt
 * @param {object} [context]
 */
export function buildObjectiveSpecFromPrompt(prompt, context = {}) {
  const parsed = parseSpatialIntent(prompt);
  const compound = planCompoundPrompt(prompt);
  const command = compound?.commands?.[0] || parsed.request || {};
  return createObjectiveSpec({
    objectiveId: context.objectiveId || randomUUID(),
    originalText: prompt,
    intent: command.action || parsed.request?.action || null,
    geography: context.geography || 'Greater Montréal',
    locationText: compound?.sharedLocation || parsed.request?.locationText || null,
    operation: command.action || parsed.request?.action || null,
    datasetId: command.datasetIds?.[0] || parsed.request?.datasetIds?.[0] || null,
    distanceMeters: command.radiusMeters ?? parsed.request?.radiusMeters ?? null,
    units: 'meters',
    mapSessionId: context.mapSessionId || null,
    actorId: context.actorId || null,
    parserRef: {
      supported: parsed.supported,
      compoundCommandCount: compound?.commands?.length || 0
    }
  });
}

/**
 * @param {object} objectiveSpec
 */
export function objectiveSpecToPrompt(objectiveSpec = {}) {
  if (objectiveSpec.originalText) return objectiveSpec.originalText;
  const location = objectiveSpec.locationText || '';
  const distanceKm = objectiveSpec.distanceMeters ? objectiveSpec.distanceMeters / 1000 : null;
  if (objectiveSpec.operation === 'WITHIN' && distanceKm) {
    return `Map fire stations within ${distanceKm} km of ${location}`;
  }
  return String(location || '');
}
