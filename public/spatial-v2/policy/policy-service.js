/**
 * PolicyService is the sole authorization authority.
 * Unknown identity, right, resource, or policy state is DENY.
 * Brain and models cannot mint grants. UI hiding is not enforcement.
 * Caller-claimed OPERATOR is not verified operator confirmation.
 */

import { ACTION_SOURCE } from '../foundation/contracts/action.js';
import {
  POLICY_ACTION,
  POLICY_OUTCOME,
  RIGHTS_AXIS,
  createAuthorizationGrant,
  createOperatorConfirmation,
  createOperatorConfirmationEvent,
  createOperatorConfirmationEvidence,
  createPolicyDecision,
  createPolicyRequest,
  verifyPolicyDecision
} from '../foundation/contracts/policy.js';
import {
  createId,
  failClosed,
  frozenClone,
  isoNow
} from '../foundation/contracts/validate.js';

const POLICY_VERSION = '1.0.0';
const DECISION_TTL_MS = 5 * 60 * 1000;

function sameResources(left, right) {
  const a = Array.isArray(left) ? left : [];
  const b = Array.isArray(right) ? right : [];
  if (a.length !== b.length) return false;
  return a.every((item, index) => item === b[index]);
}

function plusMs(iso, ms) {
  return new Date(Date.parse(iso) + ms).toISOString();
}

function grantMatches(grant, request, nowIso) {
  if (grant.consumedAt) return false;
  if (grant.actorRef !== request.actorContext.actorRef) return false;
  if (grant.capabilityId !== request.capabilityId) return false;
  if (grant.policyAction !== request.policyAction) return false;
  if (grant.sessionId !== request.sessionId) return false;
  if (!sameResources(grant.resourceRefs, request.resourceRefs)) return false;
  if (grant.expiresAt <= nowIso) return false;
  return true;
}

export function createPolicyService(options = {}) {
  const now = options.now;
  const idFactory = options.idFactory;
  const knownIdentities = new Set(options.knownIdentities || ['operator:session']);
  const grants = new Map();
  const issuedDecisions = new Map();
  const confirmations = new Map();
  const confirmationEvents = new Map();
  let operatorBoundaryTaken = false;

  function decide(requestInput, { outcome, reasonCodes, grantId = null, obligations = [] }) {
    const request = createPolicyRequest(requestInput);
    const decidedAt = isoNow(now);
    const decision = createPolicyDecision({
      decisionId: createId('policy', idFactory),
      outcome,
      reasonCodes,
      obligations,
      policyVersion: POLICY_VERSION,
      capabilityId: request.capabilityId,
      policyAction: request.policyAction,
      actorRef: request.actorContext.actorRef,
      resourceRefs: request.resourceRefs,
      grantId,
      integrityToken: createId('polauth', idFactory),
      decidedAt,
      expiresAt: plusMs(decidedAt, DECISION_TTL_MS)
    }, { now });
    issuedDecisions.set(decision.decisionId, {
      decision: frozenClone(decision),
      binding: Object.freeze({
        actionId: request.actionId,
        actorRef: request.actorContext.actorRef,
        identityRef: request.actorContext.identityRef || request.actorContext.actorRef,
        capabilityId: request.capabilityId,
        policyAction: request.policyAction,
        effectClass: request.effectClass,
        resourceRefs: Object.freeze([...request.resourceRefs]),
        worldId: request.worldId,
        sessionId: request.sessionId,
        worldRevision: request.worldRevision
      }),
      consumedAt: null
    });
    return decision;
  }

  function acceptIssuedDecision(candidate) {
    const shaped = verifyPolicyDecision(candidate);
    const issued = issuedDecisions.get(shaped.decisionId);
    if (!issued) {
      failClosed('FORGED_POLICY_DECISION', 'Policy decision was not issued by PolicyService.', {
        decisionId: shaped.decisionId
      });
    }
    if (
      issued.decision.integrityToken !== shaped.integrityToken
      || issued.decision.outcome !== shaped.outcome
      || issued.decision.capabilityId !== shaped.capabilityId
      || issued.decision.policyAction !== shaped.policyAction
      || issued.decision.actorRef !== shaped.actorRef
      || issued.decision.grantId !== shaped.grantId
    ) {
      failClosed('FORGED_POLICY_DECISION', 'Policy decision does not match the PolicyService-issued authority record.', {
        decisionId: shaped.decisionId
      });
    }
    const nowIso = isoNow(now);
    if (issued.decision.expiresAt && issued.decision.expiresAt <= nowIso) {
      failClosed('POLICY_DECISION_EXPIRED', 'Policy decision has expired.', {
        decisionId: shaped.decisionId
      });
    }
    if (issued.consumedAt) {
      failClosed('POLICY_DECISION_REPLAY', 'Policy decision was already consumed.', {
        decisionId: shaped.decisionId
      });
    }
    return frozenClone(issued.decision);
  }

  function consumeIssuedDecision(candidate, context = {}) {
    const decision = acceptIssuedDecision(candidate);
    const issued = issuedDecisions.get(decision.decisionId);
    const binding = issued.binding;
    if (!binding.actionId) {
      failClosed('POLICY_DECISION_SCOPE', 'Policy decision is not bound to an ActionEnvelope.', {
        decisionId: decision.decisionId
      });
    }
    const mismatches = [];
    if (context.actionId !== binding.actionId) mismatches.push('actionId');
    if ((context.actorRef || null) !== binding.actorRef) mismatches.push('actorRef');
    if ((context.identityRef || context.actorRef || null) !== binding.identityRef) mismatches.push('identityRef');
    if ((context.capabilityId || null) !== binding.capabilityId) mismatches.push('capabilityId');
    if ((context.policyAction || null) !== binding.policyAction) mismatches.push('policyAction');
    if ((context.effectClass || null) !== binding.effectClass) mismatches.push('effectClass');
    if ((context.worldId || null) !== binding.worldId) mismatches.push('worldId');
    if ((context.sessionId || null) !== binding.sessionId) mismatches.push('sessionId');
    if (context.worldRevision !== binding.worldRevision) mismatches.push('worldRevision');
    if (!sameResources(context.resourceRefs, binding.resourceRefs)) mismatches.push('resourceRefs');
    if (mismatches.length) {
      failClosed('POLICY_DECISION_SCOPE', 'Policy decision is not valid for this authorization context.', {
        decisionId: decision.decisionId,
        mismatches
      });
    }
    issued.consumedAt = isoNow(now);
    return decision;
  }

  function consumeOperatorConfirmation(rawConfirmation, grant) {
    if (!rawConfirmation || typeof rawConfirmation !== 'object') {
      failClosed('OPERATOR_CONFIRMATION_REQUIRED', 'Grant creation requires a PolicyService-issued operator confirmation.');
    }
    let shaped;
    try {
      shaped = createOperatorConfirmation(rawConfirmation, { now });
    } catch (error) {
      failClosed('FORGED_OPERATOR_CONFIRMATION', 'Operator confirmation is not a PolicyService-issued receipt.', {
        cause: error.code || null
      });
    }
    const issued = confirmations.get(shaped.confirmationId);
    if (!issued || issued.confirmation.integrityToken !== shaped.integrityToken) {
      failClosed('FORGED_OPERATOR_CONFIRMATION', 'Operator confirmation was not issued by PolicyService.', {
        confirmationId: shaped.confirmationId
      });
    }
    const nowIso = isoNow(now);
    if (issued.confirmation.expiresAt <= nowIso) {
      failClosed('OPERATOR_CONFIRMATION_EXPIRED', 'Operator confirmation has expired.', {
        confirmationId: shaped.confirmationId
      });
    }
    if (issued.consumedAt) {
      failClosed('OPERATOR_CONFIRMATION_REPLAY', 'Operator confirmation was already consumed.', {
        confirmationId: shaped.confirmationId
      });
    }
    const bound = issued.confirmation;
    if (
      bound.actorRef !== grant.actorRef
      || bound.capabilityId !== grant.capabilityId
      || bound.policyAction !== grant.policyAction
      || bound.sessionId !== grant.sessionId
      || !sameResources(bound.resourceRefs, grant.resourceRefs)
      || (bound.worldId && bound.worldId !== grant.worldId)
    ) {
      failClosed('OPERATOR_CONFIRMATION_MISMATCH', 'Operator confirmation does not match the requested grant.', {
        confirmationId: shaped.confirmationId
      });
    }
    issued.consumedAt = nowIso;
    return frozenClone(bound);
  }

  function recordConfirmationEvent(raw = {}) {
    const identity = raw?.identityRef || raw?.actorRef;
    if (!identity || !knownIdentities.has(identity)) {
      failClosed('UNKNOWN_IDENTITY', 'Cannot record operator confirmation for an unknown identity.', { identity });
    }
    const issuedAt = isoNow(now);
    const event = createOperatorConfirmationEvent({
      eventId: createId('opevent', idFactory),
      integrityToken: createId('opevauth', idFactory),
      actorRef: raw.actorRef,
      identityRef: raw.identityRef || raw.actorRef,
      capabilityId: raw.capabilityId,
      policyAction: raw.policyAction,
      resourceRefs: raw.resourceRefs,
      sessionId: raw.sessionId,
      worldId: raw.worldId,
      issuedAt,
      expiresAt: raw.expiresAt
    }, { now });
    confirmationEvents.set(event.eventId, {
      event: frozenClone(event),
      consumedAt: null
    });
    return createOperatorConfirmationEvidence({
      eventId: event.eventId,
      integrityToken: event.integrityToken
    });
  }

  function takeOperatorConfirmationBoundary() {
    if (operatorBoundaryTaken) {
      failClosed(
        'OPERATOR_BOUNDARY_ALREADY_TAKEN',
        'The trusted operator-confirmation boundary is already held by the host.'
      );
    }
    operatorBoundaryTaken = true;
    return Object.freeze({
      recordConfirmationEvent
    });
  }

  return Object.freeze({
    policyVersion: POLICY_VERSION,
    authorize(rawRequest) {
      const safeRequest = {
        actorContext: rawRequest?.actorContext?.actorRef
          ? rawRequest.actorContext
          : { actorRef: 'unknown', identityRef: null, source: null },
        capabilityId: rawRequest?.capabilityId || 'unknown',
        policyAction: Object.values(POLICY_ACTION).includes(rawRequest?.policyAction)
          ? rawRequest.policyAction
          : POLICY_ACTION.DISPLAY,
        resourceRefs: Array.isArray(rawRequest?.resourceRefs) ? rawRequest.resourceRefs : [],
        requestedRights: Array.isArray(rawRequest?.requestedRights)
          ? rawRequest.requestedRights.filter((axis) => Object.values(RIGHTS_AXIS).includes(axis))
          : [],
        effectClass: rawRequest?.effectClass || 'READ_ONLY',
        dataClassifications: Array.isArray(rawRequest?.dataClassifications) ? rawRequest.dataClassifications : [],
        worldId: rawRequest?.worldId || 'unknown',
        sessionId: rawRequest?.sessionId || 'unknown',
        actionId: rawRequest?.actionId || null,
        worldRevision: rawRequest?.worldRevision ?? null
      };
      if (!Object.values(POLICY_ACTION).includes(rawRequest?.policyAction)) {
        return decide(safeRequest, {
          outcome: POLICY_OUTCOME.DENY,
          reasonCodes: ['UNKNOWN_POLICY_ACTION']
        });
      }
      if ((rawRequest?.requestedRights || []).some((axis) => !Object.values(RIGHTS_AXIS).includes(axis))) {
        return decide(safeRequest, {
          outcome: POLICY_OUTCOME.DENY,
          reasonCodes: ['UNKNOWN_RIGHT']
        });
      }
      const request = createPolicyRequest(safeRequest);

      const identity = request.actorContext.identityRef || request.actorContext.actorRef;
      if (!identity || !knownIdentities.has(identity)) {
        return decide(request, {
          outcome: POLICY_OUTCOME.DENY,
          reasonCodes: ['UNKNOWN_IDENTITY']
        });
      }
      if (request.policyAction === POLICY_ACTION.PORTAL_PUBLISH) {
        return decide(request, {
          outcome: POLICY_OUTCOME.DENY,
          reasonCodes: ['PORTAL_PUBLISH_UNAVAILABLE']
        });
      }
      if (request.policyAction === POLICY_ACTION.DESTRUCTIVE) {
        return decide(request, {
          outcome: POLICY_OUTCOME.DENY,
          reasonCodes: ['DESTRUCTIVE_UNAVAILABLE']
        });
      }
      if (
        request.policyAction === POLICY_ACTION.EXTERNAL_WRITE
        || request.effectClass === 'EXTERNAL_WRITE'
      ) {
        const nowIso = isoNow(now);
        const match = [...grants.values()].find((grant) => grantMatches(grant, request, nowIso));
        if (!match) {
          return decide(request, {
            outcome: POLICY_OUTCOME.REQUIRES_EXPLICIT_AUTHORIZATION,
            reasonCodes: ['EXTERNAL_WRITE_REQUIRES_GRANT']
          });
        }
        if (match.singleUse) {
          grants.set(match.grantId, createAuthorizationGrant({
            ...match,
            consumedAt: nowIso
          }, { now }));
        }
        return decide(request, {
          outcome: POLICY_OUTCOME.ALLOW,
          reasonCodes: ['GRANT_SATISFIED'],
          grantId: match.grantId,
          obligations: ['ADAPTER_MUST_RECHECK_DECISION']
        });
      }
      if (request.policyAction === POLICY_ACTION.EXPORT || request.policyAction === POLICY_ACTION.SHARE) {
        return decide(request, {
          outcome: POLICY_OUTCOME.DENY,
          reasonCodes: ['EXPORT_SHARE_UNAVAILABLE']
        });
      }
      return decide(request, {
        outcome: POLICY_OUTCOME.ALLOW,
        reasonCodes: ['SESSION_POLICY_ALLOW'],
        obligations: ['ADAPTER_MUST_RECHECK_DECISION']
      });
    },
    takeOperatorConfirmationBoundary,
    issueOperatorConfirmation(raw = {}) {
      if (!raw || typeof raw !== 'object' || raw.evidence == null) {
        failClosed(
          'TRUSTED_OPERATOR_EVIDENCE_REQUIRED',
          'Operator confirmation requires PolicyService-issued trusted-boundary evidence.'
        );
      }
      let evidence;
      try {
        evidence = createOperatorConfirmationEvidence(raw.evidence);
      } catch (error) {
        failClosed(
          'FORGED_OPERATOR_EVIDENCE',
          'Operator confirmation evidence is not PolicyService-issued trusted-boundary evidence.',
          { cause: error.code || null }
        );
      }
      const issued = confirmationEvents.get(evidence.eventId);
      if (!issued || issued.event.integrityToken !== evidence.integrityToken) {
        failClosed('FORGED_OPERATOR_EVIDENCE', 'Operator confirmation evidence was not issued by the trusted boundary.', {
          eventId: evidence.eventId
        });
      }
      const nowIso = isoNow(now);
      if (issued.event.expiresAt <= nowIso) {
        failClosed('OPERATOR_EVIDENCE_EXPIRED', 'Trusted operator-confirmation evidence has expired.', {
          eventId: evidence.eventId
        });
      }
      if (issued.consumedAt) {
        failClosed('OPERATOR_EVIDENCE_REPLAY', 'Trusted operator-confirmation evidence was already consumed.', {
          eventId: evidence.eventId
        });
      }
      const event = issued.event;
      const mismatches = [];
      if (raw.actorRef && raw.actorRef !== event.actorRef) mismatches.push('actorRef');
      if (raw.identityRef && raw.identityRef !== event.identityRef) mismatches.push('identityRef');
      if (raw.capabilityId && raw.capabilityId !== event.capabilityId) mismatches.push('capabilityId');
      if (raw.policyAction && raw.policyAction !== event.policyAction) mismatches.push('policyAction');
      if (raw.sessionId && raw.sessionId !== event.sessionId) mismatches.push('sessionId');
      if (raw.worldId != null && (event.worldId || null) !== raw.worldId) mismatches.push('worldId');
      if (Array.isArray(raw.resourceRefs) && !sameResources(raw.resourceRefs, event.resourceRefs)) {
        mismatches.push('resourceRefs');
      }
      if (mismatches.length) {
        failClosed(
          'OPERATOR_EVIDENCE_MISMATCH',
          'Trusted operator-confirmation evidence does not match the requested confirmation.',
          { eventId: event.eventId, mismatches }
        );
      }
      issued.consumedAt = nowIso;
      const confirmation = createOperatorConfirmation({
        confirmationId: createId('opconfirm', idFactory),
        integrityToken: createId('opauth', idFactory),
        actorRef: event.actorRef,
        identityRef: event.identityRef,
        capabilityId: event.capabilityId,
        policyAction: event.policyAction,
        resourceRefs: event.resourceRefs,
        sessionId: event.sessionId,
        worldId: event.worldId,
        issuedAt: nowIso,
        expiresAt: event.expiresAt
      }, { now });
      confirmations.set(confirmation.confirmationId, {
        confirmation: frozenClone(confirmation),
        consumedAt: null
      });
      return frozenClone(confirmation);
    },
    issueGrant(raw, { source, confirmation } = {}) {
      if (source && source !== ACTION_SOURCE.OPERATOR) {
        failClosed('MODEL_CANNOT_MINT_GRANT', 'Only an operator-confirmed grant may be issued.', { source });
      }
      if (!confirmation) {
        if (source === ACTION_SOURCE.OPERATOR) {
          failClosed('OPERATOR_CONFIRMATION_REQUIRED', 'Caller-claimed OPERATOR is not PolicyService-verified confirmation.');
        }
        if (!source) {
          failClosed('GRANT_SOURCE_REQUIRED', 'Authorization grants require a valid authoritative source.');
        }
        failClosed('OPERATOR_CONFIRMATION_REQUIRED', 'Grant creation requires a PolicyService-issued operator confirmation.');
      }
      const proof = consumeOperatorConfirmation(confirmation, raw);
      const grant = createAuthorizationGrant({
        ...raw,
        grantId: raw.grantId || createId('grant', idFactory),
        operatorConfirmedAt: proof.issuedAt
      }, { now });
      const identity = grant.actorRef;
      if (!knownIdentities.has(identity)) {
        failClosed('UNKNOWN_IDENTITY', 'Cannot issue a grant for an unknown identity.', { identity });
      }
      grants.set(grant.grantId, grant);
      return frozenClone(grant);
    },
    recheck(decision) {
      return acceptIssuedDecision(decision);
    },
    acceptIssuedDecision,
    consumeIssuedDecision,
    getGrant(grantId) {
      const grant = grants.get(grantId);
      return grant ? frozenClone(grant) : null;
    }
  });
}

export function createPolicyGuard(policyService) {
  return Object.freeze({
    authorize(request) {
      const decision = policyService.authorize(request);
      policyService.recheck(decision);
      return decision;
    }
  });
}
