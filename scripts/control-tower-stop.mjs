#!/usr/bin/env node
/**
 * Stop the Control Tower bridge daemon.
 */
import { loadBridgeConfig } from './lib/control-tower/config.js';
import { readBridgePid, clearBridgePid } from './lib/control-tower/state.js';

function stopPid(pid) {
  try {
    process.kill(pid, 'SIGTERM');
    return true;
  } catch {
    return false;
  }
}

async function main() {
  const config = loadBridgeConfig();
  const pid = readBridgePid(config.stateDir);
  if (!pid) {
    console.log(JSON.stringify({ stopped: false, reason: 'NO_PID' }));
    return;
  }
  const stopped = stopPid(pid);
  clearBridgePid(config.stateDir);
  console.log(JSON.stringify({ stopped, pid }));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
