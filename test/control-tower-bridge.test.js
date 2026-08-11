import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseMissionTitle,
  buildMissionTitle,
  extractMissionPrompt,
  hasRequiredMarkers,
  detectResultStatus,
  sanitizeForIssueComment,
  splitForComments,
  MISSION_STATES
} from '../scripts/lib/control-tower/protocol.js';
import { validateMission, classifyRejection } from '../scripts/lib/control-tower/validator.js';
import {
  recoverStaleRunningMission,
  isIssueProcessed,
  markIssueProcessed
} from '../scripts/lib/control-tower/state.js';

const baseConfig = {
  enabled: true,
  repository: 'EnlightenedAI-Lab/amerigo-vespucci-live',
  authorAllowlist: ['EnlightenedAI-Lab'],
  marker: 'IQAI_CONTROL_TOWER_V1',
  target: 'AGENT_1'
};

describe('control tower protocol', () => {
  it('parses and builds mission titles', () => {
    const title = buildMissionTitle(MISSION_STATES.QUEUED, 'Inspect baseline');
    assert.equal(title, '[IQAI-CT][AGENT1][QUEUED] Inspect baseline');
    const parsed = parseMissionTitle(title);
    assert.equal(parsed.state, MISSION_STATES.QUEUED);
    assert.equal(parsed.missionTitle, 'Inspect baseline');
  });

  it('extracts mission prompt after markers', () => {
    const body = `IQAI_CONTROL_TOWER_V1\nAGENT_1\n\nDo the thing.`;
    assert.equal(extractMissionPrompt(body), 'Do the thing.');
    assert.equal(hasRequiredMarkers(body), true);
  });

  it('detects NEEDS_CONTROL_TOWER in agent output', () => {
    assert.equal(detectResultStatus('All good\nCOMPLETE'), MISSION_STATES.COMPLETE);
    assert.equal(detectResultStatus('Return NEEDS_CONTROL_TOWER without modifying code.'), MISSION_STATES.NEEDS_CONTROL_TOWER);
  });

  it('redacts tokens from issue comments', () => {
    const cleaned = sanitizeForIssueComment('token gho_abc123 and CURSOR_API_KEY=secret');
    assert.match(cleaned, /\[REDACTED_TOKEN\]/);
    assert.doesNotMatch(cleaned, /gho_abc123/);
  });

  it('splits long comments', () => {
    const chunks = splitForComments('a'.repeat(60000), 55000);
    assert.equal(chunks.length, 2);
    assert.match(chunks[0], /^\[1\/2\]/);
  });
});

describe('control tower validator', () => {
  const bridgeState = { processedIssueNumbers: [], runningIssue: null };

  it('accepts valid queued mission', () => {
    const issue = {
      number: 101,
      title: '[IQAI-CT][AGENT1][QUEUED] Test mission',
      body: 'IQAI_CONTROL_TOWER_V1\nAGENT_1\n\nHello',
      author: { login: 'EnlightenedAI-Lab' }
    };
    const result = validateMission(issue, baseConfig, bridgeState);
    assert.equal(result.ok, true);
  });

  it('rejects wrong marker', () => {
    const issue = {
      number: 102,
      title: '[IQAI-CT][AGENT1][QUEUED] Bad marker',
      body: 'WRONG\nAGENT_1\n\nHello',
      author: { login: 'EnlightenedAI-Lab' }
    };
    assert.equal(validateMission(issue, baseConfig, bridgeState).ok, false);
    assert.equal(classifyRejection(issue, baseConfig), 'WRONG_MARKER');
  });

  it('rejects unauthorized author', () => {
    const issue = {
      number: 103,
      title: '[IQAI-CT][AGENT1][QUEUED] Bad author',
      body: 'IQAI_CONTROL_TOWER_V1\nAGENT_1\n\nHello',
      author: { login: 'evil-user' }
    };
    assert.equal(validateMission(issue, baseConfig, bridgeState).ok, false);
    assert.equal(classifyRejection(issue, baseConfig), 'UNAUTHORIZED_AUTHOR');
  });

  it('rejects already processed issue', () => {
    const state = { processedIssueNumbers: [104], runningIssue: null };
    const issue = {
      number: 104,
      title: '[IQAI-CT][AGENT1][QUEUED] Again',
      body: 'IQAI_CONTROL_TOWER_V1\nAGENT_1\n\nHello',
      author: { login: 'EnlightenedAI-Lab' }
    };
    assert.equal(validateMission(issue, baseConfig, state).ok, false);
  });

  it('serializes when another mission is running', () => {
    const state = { processedIssueNumbers: [], runningIssue: 200 };
    const issue = {
      number: 201,
      title: '[IQAI-CT][AGENT1][QUEUED] Wait',
      body: 'IQAI_CONTROL_TOWER_V1\nAGENT_1\n\nHello',
      author: { login: 'EnlightenedAI-Lab' }
    };
    const result = validateMission(issue, baseConfig, state);
    assert.equal(result.ok, false);
    assert.match(result.reasons.join(','), /AGENT_BUSY/);
  });
});

describe('control tower state', () => {
  it('recovers stale running mission after restart', () => {
    const state = recoverStaleRunningMission({
      processedIssueNumbers: [],
      runningIssue: 55,
      runningStartedAt: '2026-01-01T00:00:00.000Z',
      recoveredIssues: []
    });
    assert.equal(state.runningIssue, null);
    assert.equal(state.lastResult.status, MISSION_STATES.NEEDS_CONTROL_TOWER);
    assert.equal(state.recoveredIssues.length, 1);
  });

  it('tracks processed issues', () => {
    const state = { processedIssueNumbers: [] };
    markIssueProcessed(state, 9);
    assert.equal(isIssueProcessed(state, 9), true);
  });
});
