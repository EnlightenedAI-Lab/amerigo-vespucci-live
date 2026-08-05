import express from 'express';

export function createServer(state, config) {
  const app = express();
  app.get('/health', (_req, res) => {
    const last = state.lastPosition?.lastAIS;
    const aisFresh = Boolean(last && Date.now() - last.getTime() <= config.healthStaleAfterSeconds * 1000);
    res.status(200).json({
      ok: true,
      aisConnected: state.aisConnected(),
      aisFresh,
      lastAIS: last?.toISOString() || null,
      lastArcGISUpdate: state.lastArcGISUpdate?.toISOString() || null,
      lastDataDockedAttempt: state.lastDataDockedAttempt?.toISOString() || null,
      lastDataDockedAccepted: state.lastDataDockedAccepted?.toISOString() || null,
      historyEnabled: config.enableHistory,
      lastHistoryWrite: state.lastHistoryWrite?.toISOString() || null,
      historyPointCount: state.historyPointCount,
      lastTravelledRouteUpdate: state.lastTravelledRouteUpdate?.toISOString() || null,
      lastDestinationUpdate: state.lastDestinationUpdate?.toISOString() || null,
      lastEstimatedRouteUpdate: state.lastEstimatedRouteUpdate?.toISOString() || null,
      distanceRemainingNM: state.distanceRemainingNM,
      estimatedETA: state.estimatedETA?.toISOString() || null,
      mmsi: config.targetMmsi
    });
  });
  app.get('/', (_req, res) => res.json({ service: 'amerigo-vespucci-live', health: '/health' }));
  return app;
}
