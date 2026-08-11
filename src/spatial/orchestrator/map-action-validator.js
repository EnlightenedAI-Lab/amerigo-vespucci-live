/**
 * Deterministic MapActionPlan validator — zero mutations on reject.
 */
import {
  MAP_ACTION_TYPES,
  MAP_PLAN_VALIDATION,
  ORCHESTRATOR_SCHEMA_VERSION
} from './contracts.js';

const ALLOWED_ACTION_TYPES = new Set(Object.values(MAP_ACTION_TYPES));
const PROHIBITED_KEYS = ['javascript', 'sql', 'whereClause', 'layerUrl', 'serviceUrl', 'executeJavaScript'];

/**
 * @param {object} plan
 * @param {object} context
 */
export function validateMapActionPlan(plan = {}, context = {}) {
  const issues = [];
  if (!plan || plan.schemaVersion !== ORCHESTRATOR_SCHEMA_VERSION) {
    issues.push('INVALID_SCHEMA_VERSION');
  }
  if (!plan?.taskResultId) issues.push('MISSING_TASK_RESULT_REF');
  if (!plan?.mapResultRef?.resultId) issues.push('MISSING_MAP_RESULT_REF');
  if (context.expectedResultVersion != null
    && plan.taskResultVersion !== context.expectedResultVersion) {
    issues.push('STALE_RESULT_VERSION');
  }
  if (context.sessionScope && plan.sessionScope !== context.sessionScope) {
    issues.push('SESSION_SCOPE_MISMATCH');
  }

  for (const action of plan.actions || []) {
    if (!ALLOWED_ACTION_TYPES.has(action.type)) {
      issues.push(`UNAUTHORIZED_ACTION:${action.type}`);
    }
    for (const key of PROHIBITED_KEYS) {
      if (action[key] != null) issues.push(`PROHIBITED_FIELD:${key}`);
    }
  }

  const payload = plan.mapResultPayload || context.mapResultPayload;
  if (payload) {
    const serialized = JSON.stringify(payload);
    for (const key of PROHIBITED_KEYS) {
      if (serialized.includes(`"${key}"`)) issues.push(`PROHIBITED_PAYLOAD_FIELD:${key}`);
    }
  }

  if ((plan.actions || []).length > 50) issues.push('ACTION_QUOTA_EXCEEDED');

  if (issues.some((issue) => issue.startsWith('STALE'))) {
    return { status: MAP_PLAN_VALIDATION.STALE, issues, approved: false };
  }
  if (issues.length) {
    return { status: MAP_PLAN_VALIDATION.REJECTED, issues, approved: false };
  }
  return { status: MAP_PLAN_VALIDATION.APPROVED, issues: [], approved: true };
}
