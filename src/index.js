import { loadConfig } from './config.js';
import { setLogLevel, logger } from './logger.js';
import { ArcGISClient } from './arcgis.js';
import { AISStreamClient } from './aisstream.js';
import { createServer } from './server.js';

const config = loadConfig();
setLogLevel(config.logLevel);
const state = { lastPosition: null, lastArcGISUpdate: null, lastHistoryWrite: null, aisClient: null, aisConnected: () => state.aisClient?.connected || false };
const arcgis = new ArcGISClient(config);

await arcgis.initialize();

async function handlePosition(position) {
  state.lastPosition = position;
  await arcgis.upsertCurrentPosition(position);
  state.lastArcGISUpdate = new Date();
  if (config.enableHistory) {
    const enoughTime = !state.lastHistoryWrite || Date.now() - state.lastHistoryWrite.getTime() >= config.historyMinIntervalSeconds * 1000;
    if (enoughTime) {
      await arcgis.addHistoryPosition(position);
      state.lastHistoryWrite = new Date();
    }
  }
}

state.aisClient = new AISStreamClient(config, handlePosition);
state.aisClient.start();

createServer(state, config).listen(config.port, () => logger.info('Health server listening', { port: config.port }));

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

function shutdown(signal) {
  logger.info('Shutting down', { signal });
  state.aisClient?.stop();
  process.exit(0);
}
