/**
 * Control Tower issue title / body protocol helpers.
 */

export const MARKER = 'IQAI_CONTROL_TOWER_V1';
export const TARGET = 'AGENT_1';
export const TITLE_PREFIX = '[IQAI-CT][AGENT1]';

export const MISSION_STATES = Object.freeze({
  QUEUED: 'QUEUED',
  RUNNING: 'RUNNING',
  COMPLETE: 'COMPLETE',
  NEEDS_CONTROL_TOWER: 'NEEDS_CONTROL_TOWER',
  FAILED: 'FAILED'
});

const STATE_PATTERN = /^\[IQAI-CT\]\[AGENT1\]\[([A-Z_]+)\]\s*(.*)$/;

/**
 * @param {string} title
 */
export function parseMissionTitle(title = '') {
  const match = String(title).trim().match(STATE_PATTERN);
  if (!match) return null;
  return {
    state: match[1],
    missionTitle: match[2].trim()
  };
}

/**
 * @param {string} state
 * @param {string} missionTitle
 */
export function buildMissionTitle(state, missionTitle) {
  return `${TITLE_PREFIX}[${state}] ${missionTitle}`.trim();
}

/**
 * @param {string} body
 */
export function extractMissionPrompt(body = '') {
  const text = String(body).replace(/\r\n/g, '\n');
  const lines = text.split('\n');
  const markerIdx = lines.findIndex((line) => line.trim() === MARKER);
  const targetIdx = lines.findIndex((line) => line.trim() === TARGET);
  if (markerIdx < 0 || targetIdx < 0) return null;
  const start = Math.max(markerIdx, targetIdx) + 1;
  const prompt = lines.slice(start).join('\n').trim();
  return prompt || null;
}

/**
 * @param {string} body
 */
export function hasRequiredMarkers(body = '') {
  const text = String(body);
  return text.includes(MARKER) && text.includes(TARGET);
}

/**
 * @param {string} output
 */
export function detectResultStatus(output = '') {
  const text = String(output);
  if (/\bNEEDS_CONTROL_TOWER\b/i.test(text)) return MISSION_STATES.NEEDS_CONTROL_TOWER;
  if (/\bFAIL(?:ED|URE)?\b/i.test(text) && !/\bPASS\b/i.test(text)) {
    return MISSION_STATES.FAILED;
  }
  return MISSION_STATES.COMPLETE;
}

/**
 * @param {string} text
 * @param {number} maxLen
 */
export function sanitizeForIssueComment(text = '', maxLen = 60000) {
  let cleaned = String(text)
    .replace(/gho_[A-Za-z0-9_]+/g, '[REDACTED_TOKEN]')
    .replace(/CURSOR_API_KEY\s*=\s*\S+/gi, 'CURSOR_API_KEY=[REDACTED]')
    .replace(/ARCGIS_PASSWORD\s*=\s*\S+/gi, 'ARCGIS_PASSWORD=[REDACTED]')
    .replace(/"token"\s*:\s*"[^"]+"/gi, '"token":"[REDACTED]"');
  if (cleaned.length > maxLen) {
    cleaned = `${cleaned.slice(0, maxLen)}\n\n… [truncated for GitHub comment size]`;
  }
  return cleaned;
}

/**
 * @param {string} text
 * @param {number} chunkSize
 */
export function splitForComments(text = '', chunkSize = 55000) {
  const body = String(text);
  if (body.length <= chunkSize) return [body];
  const chunks = [];
  for (let i = 0; i < body.length; i += chunkSize) {
    chunks.push(body.slice(i, i + chunkSize));
  }
  return chunks.map((chunk, index) => `[${index + 1}/${chunks.length}]\n${chunk}`);
}
