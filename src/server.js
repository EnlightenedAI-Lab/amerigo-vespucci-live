import express from 'express';

export function createServer(state, config) {
  const app = express();
  app.get('/health', (_req, res) => {
    const last = state.lastPosition?.lastAIS;
    const stale = !last || Date.now() - last.getTime() > config.healthStaleAfterSeconds * 1000;
    res.status(stale ? 503 : 200).json({
      ok: !stale,
      aisConnected: state.aisConnected(),
      lastAIS: last?.toISOString() || null,
      lastArcGISUpdate: state.lastArcGISUpdate?.toISOString() || null,
      mmsi: config.targetMmsi
    });
  });
  app.get('/', (_req, res) => res.json({ service: 'amerigo-vespucci-live', health: '/health' }));
  return app;
}
