import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ACTION_SOURCE,
  EFFECT_CLASS,
  POLICY_ACTION,
  POLICY_OUTCOME
} from '../../public/spatial-v2/foundation/contracts/index.js';
import { ContractError } from '../../public/spatial-v2/foundation/contracts/validate.js';
import { createPolicyService } from '../../public/spatial-v2/policy/index.js';

function clock() {
  let n = 0;
  return () => new Date(Date.parse('2026-08-18T16:00:00.000Z') + n++ * 1000).toISOString();
}

function ids(prefix) {
  let n = 0;
  return () => `${prefix}-${++n}`;
}

function request(overrides = {}) {
  return {
    actorContext: { actorRef: 'operator:session', identityRef: 'operator:session', source: ACTION_SOURCE.OPERATOR },
    capabilityId: 'chassis.inspect-world',
    policyAction: POLICY_ACTION.DISPLAY,
    resourceRefs: [],
    requestedRights: ['display'],
    effectClass: EFFECT_CLASS.READ_ONLY,
    dataClassifications: [],
    worldId: 'world-1',
    sessionId: 'session-1',
    ...overrides
  };
}

test('unknown identity, right, and policy action deny', () => {
  const policy = createPolicyService({ now: clock(), idFactory: ids('p') });
  const unknownIdentity = policy.authorize(request({
    actorContext: { actorRef: 'stranger', identityRef: 'stranger', source: ACTION_SOURCE.OPERATOR }
  }));
  assert.equal(unknownIdentity.outcome, POLICY_OUTCOME.DENY);
  assert.equal(unknownIdentity.reasonCodes[0], 'UNKNOWN_IDENTITY');

  const unknownRight = policy.authorize(request({ requestedRights: ['teleport'] }));
  assert.equal(unknownRight.outcome, POLICY_OUTCOME.DENY);
  assert.equal(unknownRight.reasonCodes[0], 'UNKNOWN_RIGHT');

  const unknownAction = policy.authorize(request({ policyAction: 'SUMMON' }));
  assert.equal(unknownAction.outcome, POLICY_OUTCOME.DENY);
  assert.equal(unknownAction.reasonCodes[0], 'UNKNOWN_POLICY_ACTION');
});

test('Portal publish and destructive actions remain denied', () => {
  const policy = createPolicyService({ now: clock(), idFactory: ids('p2') });
  const portal = policy.authorize(request({
    capabilityId: 'capture.share',
    policyAction: POLICY_ACTION.PORTAL_PUBLISH,
    effectClass: EFFECT_CLASS.EXTERNAL_WRITE
  }));
  assert.equal(portal.outcome, POLICY_OUTCOME.DENY);
  assert.equal(portal.reasonCodes[0], 'PORTAL_PUBLISH_UNAVAILABLE');

  const destructive = policy.authorize(request({
    policyAction: POLICY_ACTION.DESTRUCTIVE,
    effectClass: EFFECT_CLASS.DESTRUCTIVE
  }));
  assert.equal(destructive.outcome, POLICY_OUTCOME.DENY);
});

function confirmationScope(overrides = {}) {
  return {
    actorRef: 'operator:session',
    identityRef: 'operator:session',
    capabilityId: 'chassis.external-write',
    policyAction: POLICY_ACTION.EXTERNAL_WRITE,
    resourceRefs: ['layer:session'],
    sessionId: 'session-1',
    expiresAt: '2026-08-19T00:00:00.000Z',
    ...overrides
  };
}

function issueTrustedConfirmation(policy, overrides = {}) {
  const fields = confirmationScope(overrides);
  const boundary = policy.takeOperatorConfirmationBoundary();
  const evidence = boundary.recordConfirmationEvent(fields);
  return policy.issueOperatorConfirmation({ evidence });
}

test('external writes require a scoped operator grant and models cannot mint one', () => {
  const policy = createPolicyService({ now: clock(), idFactory: ids('p3') });
  const blocked = policy.authorize(request({
    capabilityId: 'chassis.external-write',
    policyAction: POLICY_ACTION.EXTERNAL_WRITE,
    effectClass: EFFECT_CLASS.EXTERNAL_WRITE,
    resourceRefs: ['layer:session']
  }));
  assert.equal(blocked.outcome, POLICY_OUTCOME.REQUIRES_EXPLICIT_AUTHORIZATION);

  assert.throws(
    () => policy.issueGrant({
      actorRef: 'operator:session',
      capabilityId: 'chassis.external-write',
      policyAction: POLICY_ACTION.EXTERNAL_WRITE,
      resourceRefs: ['layer:session'],
      sessionId: 'session-1',
      expiresAt: '2026-08-19T00:00:00.000Z',
      operatorConfirmedAt: '2026-08-18T16:00:00.000Z'
    }, { source: ACTION_SOURCE.BRAIN }),
    (error) => error instanceof ContractError && error.code === 'MODEL_CANNOT_MINT_GRANT'
  );

  const grant = policy.issueGrant({
    actorRef: 'operator:session',
    capabilityId: 'chassis.external-write',
    policyAction: POLICY_ACTION.EXTERNAL_WRITE,
    resourceRefs: ['layer:session'],
    sessionId: 'session-1',
    expiresAt: '2026-08-19T00:00:00.000Z'
  }, {
    confirmation: issueTrustedConfirmation(policy)
  });

  const allowed = policy.authorize(request({
    capabilityId: 'chassis.external-write',
    policyAction: POLICY_ACTION.EXTERNAL_WRITE,
    effectClass: EFFECT_CLASS.EXTERNAL_WRITE,
    resourceRefs: ['layer:session']
  }));
  assert.equal(allowed.outcome, POLICY_OUTCOME.ALLOW);
  assert.equal(allowed.grantId, grant.grantId);

  const reused = policy.authorize(request({
    capabilityId: 'chassis.external-write',
    policyAction: POLICY_ACTION.EXTERNAL_WRITE,
    effectClass: EFFECT_CLASS.EXTERNAL_WRITE,
    resourceRefs: ['layer:session']
  }));
  assert.equal(reused.outcome, POLICY_OUTCOME.REQUIRES_EXPLICIT_AUTHORIZATION);
});

test('grant creation without an authoritative source is rejected', () => {
  const policy = createPolicyService({ now: clock(), idFactory: ids('p4') });
  const grantBody = {
    actorRef: 'operator:session',
    capabilityId: 'chassis.external-write',
    policyAction: POLICY_ACTION.EXTERNAL_WRITE,
    resourceRefs: ['layer:session'],
    sessionId: 'session-1',
    expiresAt: '2026-08-19T00:00:00.000Z',
    operatorConfirmedAt: '2026-08-18T16:00:00.000Z'
  };
  assert.throws(
    () => policy.issueGrant(grantBody),
    (error) => error instanceof ContractError && error.code === 'GRANT_SOURCE_REQUIRED'
  );
  assert.throws(
    () => policy.issueGrant(grantBody, { source: ACTION_SOURCE.OPERATOR }),
    (error) => error instanceof ContractError && error.code === 'OPERATOR_CONFIRMATION_REQUIRED'
  );
  assert.equal(policy.getGrant('missing'), null);
});
