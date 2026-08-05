import { loadConfig } from './config.js';
import { setLogLevel, logger } from './logger.js';
import { ArcGISClient } from './arcgis.js';
import { AISStreamClient } from './aisstream.js';
import { createServer } from './server.js';
import { DataDockedClient } from './datadocked.js';
import { OpenMeteoClient } from './openmeteo.js';

const config = loadConfig();
setLogLevel(config.logLevel);
const state = {
  lastPosition: null,
  lastAISStreamPosition: null,
  lastArcGISUpdate: null,
  lastHistoryWrite: null,
  historyPointCount: null,
  lastTravelledRouteUpdate: null,
  lastDestinationUpdate: null,
  lastEstimatedRouteUpdate: null,
  distanceRemainingNM: null,
  estimatedETA: null,
  lastDataDockedAttempt: null,
  lastDataDockedAccepted: null,
  aisClient: null,
  dataDockedClient: null,
  openMeteoClient: null,
  aisConnected: () => state.aisClient?.connected || false
};
const arcgis = new ArcGISClient(config);

await arcgis.initialize();

async function handlePosition(position, options = {}) {
  if (options.source === 'aisstream') state.lastAISStreamPosition = position;
  state.lastPosition = position;
  await arcgis.upsertCurrentPosition(position);
  state.lastArcGISUpdate = new Date();
  try {
    const estimate = await arcgis.upsertEstimatedRoute(position);
    state.lastEstimatedRouteUpdate = new Date();
    state.distanceRemainingNM = estimate.distanceNM;
    state.estimatedETA = estimate.estimatedETA;
  } catch (error) {
    logger.warn('Optional estimated route update failed', { error: error.message });
  }
  try {
    await arcgis.upsertDestination();
    state.lastDestinationUpdate = new Date();
  } catch (error) {
    logger.warn('Optional destination update failed', { error: error.message });
  }
  state.openMeteoClient?.onPosition();
  if (config.enableHistory) {
    const enoughTime = !state.lastHistoryWrite || position.lastAIS.getTime() - state.lastHistoryWrite.getTime() >= config.historyMinIntervalSeconds * 1000;
    if (enoughTime) {
      try {
        const history = await arcgis.addHistoryPosition(position, options.source || 'unknown');
        if (history.inserted) {
          state.lastHistoryWrite = position.lastAIS;
          const route = await arcgis.upsertTravelledRoute();
          state.historyPointCount = route.pointCount;
          if (route.updated) state.lastTravelledRouteUpdate = new Date();
        }
      } catch (error) {
        logger.warn('Optional history or travelled route update failed', { error: error.message });
      }
    }
  }
}

state.aisClient = new AISStreamClient(config, (position) => handlePosition(position, { source: 'aisstream' }));
state.aisClient.start();

state.openMeteoClient = new OpenMeteoClient(config, arcgis, state);
state.openMeteoClient.start();

state.dataDockedClient = new DataDockedClient(config, handlePosition, state);
state.dataDockedClient.start();

createServer(state, config).listen(config.port, () => logger.info('Health server listening', { port: config.port }));

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

function shutdown(signal) {
  logger.info('Shutting down', { signal });
  state.aisClient?.stop();
  state.dataDockedClient?.stop();
  state.openMeteoClient?.stop();
  process.exit(0);
}
