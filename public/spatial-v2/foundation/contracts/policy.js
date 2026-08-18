/**
 * Fail-closed identity, rights, and authorization decision contracts.
 * PolicyService remains authority. World State holds snapshots only.
 */

import { SCHEMA_IDS, isCanonicalV1Schema } from './schema-ids.js';
import { EFFECT_CLASS } from './activity-event.js';
import {
  failClosed,
  isoNow,
  optionalString,
  rejectUnknownKeys,
  requireArray,
  requireInteger,
  requirePlainObject,
  requireString
} from './validate.js';

export const POLICY_ACTION = Object.freeze({
  DISPLAY: 'DISPLAY',
  ANALYSIS: 'ANALYSIS',
  AI_USE: 'AI_USE',
  EXPORT: 'EXPORT',
  SHARE: 'SHARE',
  CACHE: 'CACHE',
  EXTERNAL_WRITE: 'EXTERNAL_WRITE',
  PORTAL_PUBLISH: 'PORTAL_PUBLISH',
  DESTRUCTIVE: 'DESTRUCTIVE'
});

export const POLICY_OUTCOME = Object.freeze({
  ALLOW: 'ALLOW',
  DENY: 'DENY',
  REQUIRES_EXPLICIT_AUTHORIZATION: 'REQUIRES_EXPLICIT_AUTHORIZATION'
});

export const RIGHTS_AXIS = Object.freeze({
  DISPLAY: 'display',
  ANALYSIS: 'analysis',
  AI_USE: 'aiUse',
  EXPORT: 'export',
  SHARE: 'share',
  CACHE: 'cache',
  EXTERNAL_WRITE: 'externalWrite',
  PORTAL_PUBLISH: 'portalPublish',
  DESTRUCTIVE: 'destructive'
});

const REQUEST_KEYS = [
  'actorContext',
  'capabilityId',
  'policyAction',
  'resourceRefs',
  'requestedRights',
  'effectClass',
  'dataClassifications',
  'worldId',
  'sessionId',
  'actionId',
  'worldRevision'
];

const ACTOR_KEYS = ['actorRef', 'identityRef', 'source'];

const DECISION_KEYS = [
  'schemaId',
  'schemaVersion',
  'decisionId',
  'outcome',
  'reasonCodes',
  'obligations',
  'policyVersion',
  'capabilityId',
  'policyAction',
  'actorRef',
  'resourceRefs',
  'grantId',
  'integrityToken',
  'decidedAt',
  'expiresAt'
];

const GRANT_KEYS = [
  'schemaId',
  'grantId',
  'actorRef',
  'capabilityId',
  'policyAction',
  'resourceRefs',
  'sessionId',
  'issuedAt',
  'expiresAt',
  'singleUse',
  'operatorConfirmedAt',
  'consumedAt'
];

export function createActorContext(input = {}) {
  requirePlainObject(input, 'actorContext');
  rejectUnknownKeys(input, 'actorContext', ACTOR_KEYS);
  return Object.freeze({
    actorRef: requireString(input.actorRef, 'actorRef'),
    identityRef: optionalString(input.identityRef, 'identityRef'),
    source: optionalString(input.source, 'source')
  });
}

export function createPolicyRequest(input = {}) {
  requirePlainObject(input, 'PolicyRequest');
  rejectUnknownKeys(input, 'PolicyRequest', REQUEST_KEYS);
  const policyAction = requireString(input.policyAction, 'policyAction');
  if (!Object.values(POLICY_ACTION).includes(policyAction)) {
    failClosed('UNKNOWN_POLICY_ACTION', 'Policy action is unknown.', { policyAction });
  }
  const effectClass = requireString(input.effectClass, 'effectClass');
  if (!Object.values(EFFECT_CLASS).includes(effectClass)) {
    failClosed('UNKNOWN_ENUM', 'effectClass is unknown.', { effectClass });
  }
  for (const axis of input.requestedRights || []) {
    if (!Object.values(RIGHTS_AXIS).includes(axis)) {
      failClosed('UNKNOWN_RIGHT', 'Requested right is unknown.', { axis });
    }
  }
  return Object.freeze({
    actorContext: createActorContext(input.actorContext || {}),
    capabilityId: requireString(input.capabilityId, 'capabilityId'),
    policyAction,
    resourceRefs: Object.freeze(requireArray(input.resourceRefs ?? [], 'resourceRefs').map((id, i) => requireString(id, `resourceRefs[${i}]`))),
    requestedRights: Object.freeze(requireArray(input.requestedRights ?? [], 'requestedRights').map((id, i) => requireString(id, `requestedRights[${i}]`))),
    effectClass,
    dataClassifications: Object.freeze(requireArray(input.dataClassifications ?? [], 'dataClassifications').map((id, i) => requireString(id, `dataClassifications[${i}]`))),
    worldId: requireString(input.worldId, 'worldId'),
    sessionId: requireString(input.sessionId, 'sessionId'),
    actionId: optionalString(input.actionId, 'actionId'),
    worldRevision: input.worldRevision == null
      ? null
      : requireInteger(input.worldRevision, 'worldRevision', { min: 0 })
  });
}

export function createPolicyDecision(input = {}, options = {}) {
  requirePlainObject(input, 'PolicyDecision');
  rejectUnknownKeys(input, 'PolicyDecision', DECISION_KEYS);
  if (input.schemaId != null && !isCanonicalV1Schema(input.schemaId, input.schemaVersion, SCHEMA_IDS.POLICY)) {
    failClosed('UNSUPPORTED_SCHEMA', 'Policy decision schema is unsupported.', {
      schemaId: input.schemaId
    });
  }
  const outcome = requireString(input.outcome, 'outcome');
  if (!Object.values(POLICY_OUTCOME).includes(outcome)) {
    failClosed('UNKNOWN_ENUM', 'Policy outcome is unknown.', { outcome });
  }
  const decisionId = requireString(input.decisionId, 'decisionId');
  const actorRef = requireString(input.actorRef, 'actorRef');
  const capabilityId = requireString(input.capabilityId, 'capabilityId');
  const policyAction = requireString(input.policyAction, 'policyAction');
  const integrityToken = requireString(input.integrityToken, 'integrityToken');
  return Object.freeze({
    schemaId: SCHEMA_IDS.POLICY,
    schemaVersion: '1.0.0',
    decisionId,
    outcome,
    reasonCodes: Object.freeze(requireArray(input.reasonCodes ?? [], 'reasonCodes').map((id, i) => requireString(id, `reasonCodes[${i}]`))),
    obligations: Object.freeze(requireArray(input.obligations ?? [], 'obligations').map((id, i) => requireString(id, `obligations[${i}]`))),
    policyVersion: requireString(input.policyVersion || '1.0.0', 'policyVersion'),
    capabilityId,
    policyAction,
    actorRef,
    resourceRefs: Object.freeze(requireArray(input.resourceRefs ?? [], 'resourceRefs').map((id, i) => requireString(id, `resourceRefs[${i}]`))),
    grantId: optionalString(input.grantId, 'grantId'),
    integrityToken,
    decidedAt: requireString(input.decidedAt || isoNow(options.now), 'decidedAt'),
    expiresAt: optionalString(input.expiresAt, 'expiresAt')
  });
}

export function verifyPolicyDecision(decision) {
  const next = createPolicyDecision(decision);
  if (next.integrityToken !== decision.integrityToken) {
    failClosed('POLICY_INTEGRITY', 'Policy decision failed adapter re-check.');
  }
  return next;
}

export function createAuthorizationGrant(input = {}, options = {}) {
  requirePlainObject(input, 'AuthorizationGrant');
  rejectUnknownKeys(input, 'AuthorizationGrant', GRANT_KEYS);
  const policyAction = requireString(input.policyAction, 'policyAction');
  if (!Object.values(POLICY_ACTION).includes(policyAction)) {
    failClosed('UNKNOWN_POLICY_ACTION', 'Grant policy action is unknown.', { policyAction });
  }
  return Object.freeze({
    schemaId: SCHEMA_IDS.POLICY,
    grantId: requireString(input.grantId, 'grantId'),
    actorRef: requireString(input.actorRef, 'actorRef'),
    capabilityId: requireString(input.capabilityId, 'capabilityId'),
    policyAction,
    resourceRefs: Object.freeze(requireArray(input.resourceRefs ?? [], 'resourceRefs').map((id, i) => requireString(id, `resourceRefs[${i}]`))),
    sessionId: requireString(input.sessionId, 'sessionId'),
    issuedAt: requireString(input.issuedAt || isoNow(options.now), 'issuedAt'),
    expiresAt: requireString(input.expiresAt, 'expiresAt'),
    singleUse: input.singleUse !== false,
    operatorConfirmedAt: requireString(input.operatorConfirmedAt, 'operatorConfirmedAt'),
    consumedAt: optionalString(input.consumedAt, 'consumedAt')
  });
}

const CONFIRMATION_KEYS = [
  'confirmationId',
  'integrityToken',
  'actorRef',
  'identityRef',
  'capabilityId',
  'policyAction',
  'resourceRefs',
  'sessionId',
  'worldId',
  'issuedAt',
  'expiresAt'
];

export function createOperatorConfirmation(input = {}, options = {}) {
  requirePlainObject(input, 'OperatorConfirmation');
  rejectUnknownKeys(input, 'OperatorConfirmation', CONFIRMATION_KEYS);
  const policyAction = requireString(input.policyAction, 'policyAction');
  if (!Object.values(POLICY_ACTION).includes(policyAction)) {
    failClosed('UNKNOWN_POLICY_ACTION', 'Confirmation policy action is unknown.', { policyAction });
  }
  return Object.freeze({
    confirmationId: requireString(input.confirmationId, 'confirmationId'),
    integrityToken: requireString(input.integrityToken, 'integrityToken'),
    actorRef: requireString(input.actorRef, 'actorRef'),
    identityRef: optionalString(input.identityRef, 'identityRef'),
    capabilityId: requireString(input.capabilityId, 'capabilityId'),
    policyAction,
    resourceRefs: Object.freeze(requireArray(input.resourceRefs ?? [], 'resourceRefs').map((id, i) => requireString(id, `resourceRefs[${i}]`))),
    sessionId: requireString(input.sessionId, 'sessionId'),
    worldId: optionalString(input.worldId, 'worldId'),
    issuedAt: requireString(input.issuedAt || isoNow(options.now), 'issuedAt'),
    expiresAt: requireString(input.expiresAt, 'expiresAt')
  });
}

const EVIDENCE_KEYS = ['eventId', 'integrityToken'];

export function createOperatorConfirmationEvidence(input = {}) {
  requirePlainObject(input, 'OperatorConfirmationEvidence');
  rejectUnknownKeys(input, 'OperatorConfirmationEvidence', EVIDENCE_KEYS);
  return Object.freeze({
    eventId: requireString(input.eventId, 'eventId'),
    integrityToken: requireString(input.integrityToken, 'integrityToken')
  });
}

const EVENT_KEYS = [
  'eventId',
  'integrityToken',
  'actorRef',
  'identityRef',
  'capabilityId',
  'policyAction',
  'resourceRefs',
  'sessionId',
  'worldId',
  'issuedAt',
  'expiresAt'
];

export function createOperatorConfirmationEvent(input = {}, options = {}) {
  requirePlainObject(input, 'OperatorConfirmationEvent');
  rejectUnknownKeys(input, 'OperatorConfirmationEvent', EVENT_KEYS);
  const policyAction = requireString(input.policyAction, 'policyAction');
  if (!Object.values(POLICY_ACTION).includes(policyAction)) {
    failClosed('UNKNOWN_POLICY_ACTION', 'Confirmation event policy action is unknown.', { policyAction });
  }
  return Object.freeze({
    eventId: requireString(input.eventId, 'eventId'),
    integrityToken: requireString(input.integrityToken, 'integrityToken'),
    actorRef: requireString(input.actorRef, 'actorRef'),
    identityRef: optionalString(input.identityRef, 'identityRef'),
    capabilityId: requireString(input.capabilityId, 'capabilityId'),
    policyAction,
    resourceRefs: Object.freeze(requireArray(input.resourceRefs ?? [], 'resourceRefs').map((id, i) => requireString(id, `resourceRefs[${i}]`))),
    sessionId: requireString(input.sessionId, 'sessionId'),
    worldId: optionalString(input.worldId, 'worldId'),
    issuedAt: requireString(input.issuedAt || isoNow(options.now), 'issuedAt'),
    expiresAt: requireString(input.expiresAt, 'expiresAt')
  });
}
