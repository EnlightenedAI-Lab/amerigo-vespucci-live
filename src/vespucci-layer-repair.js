import { parseDestinationConfig } from './navigation.js';
import { layer0AttributesToPosition } from './arcgis-diagnostics.js';

const COORD_TOLERANCE = 0.05;

/**
 * Build a position object from Layer 0 diagnostics without modifying Layer 0.
 * @param {object|null} layer0Diag
 * @param {object} config
 */
export function layerDiagToPosition(layer0Diag, config) {
  if (!layer0Diag) return null;
  const attrs = { ...(layer0Diag.displayAttributes || {}) };
  if (layer0Diag.latestTimestamp && !attrs.LastAIS) attrs.LastAIS = layer0Diag.latestTimestamp;
  return layer0AttributesToPosition(attrs, config);
}

export function destinationNeedsRepair(destDiag, config) {
  const expected = parseDestinationConfig(config);
  if (!destDiag?.destinationExists) return true;
  const coords = destDiag.destinationCoordinates;
  if (!coords) return true;
  return Math.abs(coords.latitude - expected.latitude) > COORD_TOLERANCE
    || Math.abs(coords.longitude - expected.longitude) > COORD_TOLERANCE;
}

export function estimatedRouteNeedsRepair(estDiag, layer0Diag) {
  if (!estDiag?.estimatedRouteExists) return true;
  const start = estDiag.routeStart;
  const vesselLat = Number(layer0Diag?.displayAttributes?.Latitude);
  const vesselLon = Number(layer0Diag?.displayAttributes?.Longitude);
  if (!start || !Number.isFinite(vesselLat) || !Number.isFinite(vesselLon)) return true;
  return Math.abs(start.latitude - vesselLat) > COORD_TOLERANCE
    || Math.abs(start.longitude - vesselLon) > COORD_TOLERANCE;
}

export function travelledRouteNeedsRepair(routeDiag, historyPointCount) {
  if (historyPointCount < 2) return false;
  return !routeDiag?.travelledRouteExists;
}

/**
 * Repair Vespucci operational feature layers using stored ArcGIS data only.
 * Never modifies Layer 0 geometry. Never calls Data Docked.
 * @param {import('./arcgis.js').ArcGISClient} client
 * @param {object} config
 * @param {object} diagnostics
 * @param {object} options
 */
export async function repairVespucciOperationalLayers(client, config, diagnostics, options = {}) {
  const dryRun = options.dryRun !== false;
  const layerById = Object.fromEntries((diagnostics.layers || []).map((l) => [l.layerId, l]));
  const layer0 = layerById[config.currentLayerId];
  const historyDiag = layerById[config.historyLayerId];
  const travelledDiag = layerById[config.travelledRouteLayerId];
  const destinationDiag = layerById[config.destinationLayerId];
  const estimatedDiag = layerById[config.estimatedRouteLayerId];
  const historyPointCount = historyDiag?.historyPointCount ?? 0;
  const position = layerDiagToPosition(layer0, config);
  const results = [];

  if (!position) {
    return {
      dryRun,
      vesselGeometryUntouched: true,
      historyPointCount,
      travelledRouteNote: historyPointCount < 2
        ? `Observed history currently contains ${historyPointCount} unique verified observations.`
        : null,
      results: [{ layer: 0, action: 'skipped', reason: 'Layer 0 position could not be read' }]
    };
  }

  if (destinationNeedsRepair(destinationDiag, config)) {
    if (!dryRun) await client.upsertDestination();
    results.push({ layer: 3, action: dryRun ? 'would upsert destination (Ponta Delgada)' : 'upserted destination (Ponta Delgada)' });
  } else {
    results.push({ layer: 3, action: 'unchanged', reason: 'destination already present' });
  }

  if (estimatedRouteNeedsRepair(estimatedDiag, layer0)) {
    if (!dryRun) await client.upsertEstimatedRoute(position);
    results.push({ layer: 4, action: dryRun ? 'would rebuild estimated route from Layer 0' : 'rebuilt estimated route from Layer 0' });
  } else {
    results.push({ layer: 4, action: 'unchanged', reason: 'estimated route already valid' });
  }

  if (historyPointCount < 2) {
    results.push({
      layer: 2,
      action: 'skipped',
      reason: 'Travelled route unavailable until at least two verified observations exist.',
      historyPointCount
    });
  } else if (travelledRouteNeedsRepair(travelledDiag, historyPointCount)) {
    if (!dryRun) {
      const routeResult = await client.upsertTravelledRoute();
      results.push({ layer: 2, action: 'rebuilt travelled route from stored history', pointCount: routeResult.pointCount });
    } else {
      results.push({ layer: 2, action: 'would rebuild travelled route from stored history', historyPointCount });
    }
  } else {
    results.push({ layer: 2, action: 'unchanged', reason: 'travelled route already present' });
  }

  return {
    dryRun,
    vesselGeometryUntouched: true,
    historyPointCount,
    travelledRouteNote: historyPointCount < 2
      ? `Observed history currently contains ${historyPointCount} unique verified observations.`
      : null,
    results
  };
}
