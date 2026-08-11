import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildMissionTitle } from './protocol.js';
import { sanitizeForIssueComment, splitForComments } from './protocol.js';

/**
 * Run gh with argument array — never shell-interpolate user content.
 * @param {string[]} args
 * @param {object} [options]
 */
export function runGh(args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn('gh', args, {
      cwd: options.cwd,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr, code });
      } else {
        const err = new Error(stderr.trim() || `gh exited with code ${code}`);
        err.code = code;
        err.stdout = stdout;
        err.stderr = stderr;
        reject(err);
      }
    });
  });
}

/**
 * @param {string} repository
 */
export async function getGhAuthStatus() {
  try {
    const { stdout } = await runGh(['auth', 'status']);
    const usernameMatch = stdout.match(/account\s+(\S+)/i);
    return {
      connected: true,
      username: usernameMatch?.[1] || null,
      detail: stdout.trim()
    };
  } catch (error) {
    return { connected: false, username: null, detail: error.message };
  }
}

/**
 * @param {string} repository
 */
export async function listOpenAgentIssues(repository) {
  const { stdout } = await runGh([
    'issue', 'list',
    '--repo', repository,
    '--state', 'open',
    '--limit', '100',
    '--json', 'number,title,body,author,state,createdAt,updatedAt'
  ]);
  const issues = JSON.parse(stdout || '[]');
  return issues.filter((issue) => /^\[IQAI-CT\]\[AGENT1\]/i.test(issue.title || ''));
}

/**
 * @param {object} params
 */
export async function updateIssueTitle({ repository, issueNumber, state, missionTitle }) {
  const title = buildMissionTitle(state, missionTitle);
  await runGh([
    'issue', 'edit', String(issueNumber),
    '--repo', repository,
    '--title', title
  ]);
  return title;
}

/**
 * @param {object} params
 */
export async function postIssueComments({ repository, issueNumber, body, chunkSize = 55000 }) {
  const chunks = splitForComments(sanitizeForIssueComment(body), chunkSize);
  const ids = [];
  for (const chunk of chunks) {
    const file = join(tmpdir(), `iqai-ct-comment-${issueNumber}-${ids.length}.md`);
    writeFileSync(file, chunk, 'utf8');
    const { stdout } = await runGh([
      'issue', 'comment', String(issueNumber),
      '--repo', repository,
      '--body-file', file
    ]);
    ids.push(stdout.trim());
  }
  return ids;
}

/**
 * @param {object} params
 */
export async function createIssue({ repository, title, body }) {
  const file = join(tmpdir(), `iqai-ct-new-issue.md`);
  writeFileSync(file, body, 'utf8');
  const { stdout } = await runGh([
    'issue', 'create',
    '--repo', repository,
    '--title', title,
    '--body-file', file
  ]);
  const url = stdout.trim();
  const numberMatch = url.match(/\/issues\/(\d+)\s*$/);
  return { url, number: numberMatch ? Number(numberMatch[1]) : null };
}

/**
 * @param {object} params
 */
export async function closeIssue({ repository, issueNumber }) {
  await runGh([
    'issue', 'close', String(issueNumber),
    '--repo', repository
  ]);
}
