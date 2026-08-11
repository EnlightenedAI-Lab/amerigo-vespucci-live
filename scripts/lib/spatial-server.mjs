/**
 * Spatial preview server lifecycle helpers for autonomous Agent 1 acceptance.
 * Always uses the real product entrypoint: node src/preview.js (npm run spatial).
 * Kills any existing listener on the target port first to avoid stale-route 404s.
 */
import { spawn, execSync } from 'node:child_process';
import net from 'node:net';

/**
 * @param {number} port
 * @param {string} [host]
 */
export function isPortOpen(port, host = '127.0.0.1') {
  return new Promise((resolve) => {
    const socket = net.createConnection({ port, host });
    socket.once('connect', () => {
      socket.end();
      resolve(true);
    });
    socket.once('error', () => resolve(false));
    socket.setTimeout(1500, () => {
      socket.destroy();
      resolve(false);
    });
  });
}

/**
 * @param {number} port
 */
export function killProcessOnPort(port) {
  if (process.platform === 'win32') {
    try {
      const output = execSync(`netstat -ano | findstr :${port}`, { encoding: 'utf8' });
      const pids = new Set();
      for (const line of output.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed.includes('LISTENING')) continue;
        const parts = trimmed.split(/\s+/);
        const pid = Number(parts[parts.length - 1]);
        if (Number.isFinite(pid) && pid > 0) pids.add(pid);
      }
      for (const pid of pids) {
        try {
          execSync(`taskkill /PID ${pid} /F`, { stdio: 'ignore' });
        } catch {
          // process may already be gone
        }
      }
      return pids.size;
    } catch {
      return 0;
    }
  }
  try {
    execSync(`lsof -ti:${port} | xargs kill -9`, { stdio: 'ignore', shell: true });
    return 1;
  } catch {
    return 0;
  }
}

/**
 * @param {string} repoRoot
 * @param {{ env?: Record<string, string> }} [options]
 */
export function startSpatialServer(repoRoot, options = {}) {
  const child = spawn(process.execPath, ['src/preview.js'], {
    cwd: repoRoot,
    env: { ...process.env, ...options.env },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  return child;
}

/**
 * @param {string} url
 * @param {number} [timeoutMs]
 */
export async function waitForHttp(url, timeoutMs = 60000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const res = await fetch(url, { cache: 'no-store' });
      if (res.ok) return true;
    } catch {
      // retry
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return false;
}

/**
 * @param {import('node:child_process').ChildProcess} child
 * @param {number} [graceMs]
 */
export function stopSpatialServer(child, graceMs = 3000) {
  if (!child || child.killed) return;
  child.kill('SIGTERM');
  setTimeout(() => {
    if (!child.killed) child.kill('SIGKILL');
  }, graceMs);
}
