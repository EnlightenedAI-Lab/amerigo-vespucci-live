import 'dotenv/config';
import { loadSharedProviderEnv } from './spatial/intelligence-layer-shared-env.js';

loadSharedProviderEnv();

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { logger, setLogLevel } from './logger.js';
import { createServer } from './server.js';
import { createPreviewConfig, createPreviewState } from './demo-map-api.js';
import { getSpatialRuntimeSnapshot } from './spatial/spatial-runtime-info.js';
import { POINT_INTELLIGENCE_QUERY_PATH } from './spatial/agent1-spatial-routes.js';

const __filename = fileURLToPath(import.meta.url);

/**
 * Start the local demo preview server.
 * No .env, no credentials, no external API calls.
 * @param {number} [port]
 * @returns {import('node:http').Server}
 */
export function startPreviewServer(port = 3000) {
  setLogLevel('info');
  const config = createPreviewConfig(port);
  const state = createPreviewState();
  const server = createServer(state, config, null, { preview: true });
  return server.listen(port, () => {
    const runtime = getSpatialRuntimeSnapshot();
    logger.info('Local demo preview listening', {
      port,
      url: `http://localhost:${port}`,
      agent1SpatialRoutes: [POINT_INTELLIGENCE_QUERY_PATH],
      spatialRuntime: {
        agent: runtime.agent,
        gitHead: runtime.gitHead,
        gitBranch: runtime.gitBranch,
        gitDirty: runtime.gitDirty,
        runtimeBuildId: runtime.runtimeBuildId,
        spatialSourceFingerprint: runtime.spatialSourceFingerprint,
        repoPath: runtime.repoPath,
        processCwdAtStart: runtime.processCwdAtStart,
        serverPid: runtime.serverPid
      }
    });
  });
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === __filename;
if (isDirectRun) {
  const port = Number(process.env.PORT || 3000);
  startPreviewServer(port);
}
