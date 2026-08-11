import {
  hasRequiredMarkers,
  parseMissionTitle,
  MISSION_STATES
} from './protocol.js';
import { isIssueProcessed } from './state.js';

/**
 * @param {object} issue
 * @param {object} config
 * @param {object} bridgeState
 */
export function validateMission(issue, config, bridgeState) {
  const reasons = [];
  const number = Number(issue.number);
  const author = issue.author?.login || issue.user?.login || '';
  const title = issue.title || '';
  const body = issue.body || '';
  const parsed = parseMissionTitle(title);

  if (!config.enabled) reasons.push('BRIDGE_DISABLED');
  if (!config.repository) reasons.push('REPOSITORY_NOT_CONFIGURED');
  if (!parsed) reasons.push('INVALID_TITLE_FORMAT');
  if (parsed && parsed.state !== MISSION_STATES.QUEUED) reasons.push(`NOT_QUEUED:${parsed.state}`);
  if (!hasRequiredMarkers(body)) reasons.push('MISSING_MARKER_OR_TARGET');
  if (config.authorAllowlist.length && !config.authorAllowlist.includes(author)) {
    reasons.push(`UNAUTHORIZED_AUTHOR:${author || 'unknown'}`);
  }
  if (bridgeState.runningIssue && bridgeState.runningIssue !== number) {
    reasons.push(`AGENT_BUSY:${bridgeState.runningIssue}`);
  }
  if (bridgeState.runningIssue === number) {
    reasons.push('ALREADY_RUNNING');
  }
  if (isIssueProcessed(bridgeState, number) && parsed?.state === MISSION_STATES.QUEUED) {
    reasons.push('ALREADY_PROCESSED');
  }

  return {
    ok: reasons.length === 0,
    reasons,
    parsed,
    author,
    number
  };
}

/**
 * Security-oriented rejection test helper.
 * @param {object} issue
 * @param {object} config
 */
export function classifyRejection(issue, config) {
  const body = issue.body || '';
  const author = issue.author?.login || issue.user?.login || '';
  const parsed = parseMissionTitle(issue.title || '');
  if (!parsed) return 'INVALID_TITLE';
  if (!body.includes(config.marker)) return 'WRONG_MARKER';
  if (!body.includes(config.target)) return 'WRONG_TARGET';
  if (config.authorAllowlist.length && !config.authorAllowlist.includes(author)) return 'UNAUTHORIZED_AUTHOR';
  return null;
}
