import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { logger, setLogLevel } from './logger.js';
import { createServer } from './server.js';
import { createPreviewConfig, createPreviewState } from './demo-map-api.js';

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
    logger.info('Local demo preview listening', { port, url: `http://localhost:${port}` });
  });
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === __filename;
if (isDirectRun) {
  startPreviewServer(3000);
}
