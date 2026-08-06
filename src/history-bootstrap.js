import { createPositionKey } from './navigation.js';
import { layer0AttributesToPosition } from './arcgis-diagnostics.js';
import { logger } from './logger.js';

/**
 * Recover genuine history observations from verified persisted sources only.
 * Currently: Layer 0 current position (if Layer 1 is empty).
 * @param {import('./arcgis.js').ArcGISClient} client
 * @param {object} config
 */
export async function bootstrapHistoryFromVerifiedSources(client, config) {
  const existingCount = await client.countHistoryFeatures();
  const recovered = [];

  if (existingCount > 0) {
    return {
      historyPointCount: existingCount,
      recovered,
      seeded: false,
      reason: 'history layer already contains observations'
    };
  }

  const current = await client.queryCurrentFeature();
  if (!current?.attributes) {
    return {
      historyPointCount: 0,
      recovered,
      seeded: false,
      reason: 'no verified current position in Layer 0'
    };
  }

  const position = layer0AttributesToPosition(current.attributes, config);
  if (!position) {
    return {
      historyPointCount: 0,
      recovered,
      seeded: false,
      reason: 'Layer 0 attributes could not be parsed into a position'
    };
  }

  const source = current.attributes.Source || 'verified-current-position';
  const positionKey = createPositionKey(position, source);
  const result = await client.addHistoryPosition(position, source);

  if (result.inserted) {
    recovered.push({
      source,
      positionKey,
      lastAIS: position.lastAIS.toISOString(),
      latitude: position.latitude,
      longitude: position.longitude
    });
    logger.info('Seeded first history observation from verified Layer 0 position', {
      positionKey,
      lastAIS: position.lastAIS.toISOString()
    });
  } else {
    logger.info('Layer 0 history seed skipped', { reason: result.reason, positionKey });
  }

  const historyPointCount = await client.countHistoryFeatures();
  return {
    historyPointCount,
    recovered,
    seeded: Boolean(result.inserted),
    skippedReason: result.inserted ? null : result.reason
  };
}
