import { logger } from './logger.js';

export class AISStreamClient {
  constructor(config, onPosition) {
    this.config = config;
    this.onPosition = onPosition;
    this.ws = null;
    this.connected = false;
    this.stopped = false;
    this.reconnectAttempt = 0;
  }

  start() {
    this.stopped = false;
    this.connect();
  }

  stop() {
    this.stopped = true;
    this.ws?.close();
  }

  async connect() {
    logger.info('Connecting to AISStream', { url: this.config.aisstreamUrl, mmsi: this.config.targetMmsi });
    const { default: WebSocket } = await import('ws');
    this.ws = new WebSocket(this.config.aisstreamUrl);
    this.ws.on('open', () => this.subscribe());
    this.ws.on('message', (data) => this.handleMessage(data));
    this.ws.on('close', (code, reason) => this.scheduleReconnect(`closed ${code} ${reason}`));
    this.ws.on('error', (error) => logger.error('AISStream WebSocket error', { error: error.message }));
  }

  subscribe() {
    this.connected = true;
    this.reconnectAttempt = 0;
    const subscription = { APIKey: this.config.aisstreamApiKey, BoundingBoxes: [[[-90, -180], [90, 180]]], FiltersShipMMSI: [String(this.config.targetMmsi)] };
    this.ws.send(JSON.stringify(subscription));
    logger.info('Subscribed to AISStream MMSI filter', { mmsi: this.config.targetMmsi });
  }

  scheduleReconnect(reason) {
    this.connected = false;
    if (this.stopped) return;
    this.reconnectAttempt += 1;
    const delay = Math.min(30000, 1000 * 2 ** Math.min(this.reconnectAttempt, 5));
    logger.warn('AISStream disconnected; reconnecting', { reason, delayMs: delay, attempt: this.reconnectAttempt });
    setTimeout(() => this.connect(), delay);
  }

  async handleMessage(data) {
    try {
      const message = JSON.parse(data.toString());
      const position = parseAISPosition(message, this.config.targetMmsi);
      if (!position) return;
      await this.onPosition(position);
    } catch (error) {
      logger.error('Failed to process AISStream message', { error: error.message });
    }
  }
}

export function parseAISPosition(message, targetMmsi) {
  const meta = message.MetaData || {};
  const ais = message.Message || {};
  const report = ais.PositionReport || ais.ExtendedClassBPositionReport || ais.StandardClassBPositionReport;
  const staticData = ais.ShipStaticData || ais.StaticDataReport;
  const mmsi = Number(meta.MMSI || report?.UserID || staticData?.UserID);
  if (mmsi !== Number(targetMmsi)) return null;

  const latitude = Number(meta.latitude ?? report?.Latitude);
  const longitude = Number(meta.longitude ?? report?.Longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;

  return {
    mmsi,
    vesselName: meta.ShipName || staticData?.Name || staticData?.ReportA?.Name || 'Amerigo Vespucci',
    speedKnots: numberOrNull(report?.Sog ?? report?.SpeedOverGround),
    course: numberOrNull(report?.Cog ?? report?.CourseOverGround),
    heading: numberOrNull(report?.TrueHeading),
    latitude,
    longitude,
    lastAIS: meta.time_utc ? new Date(meta.time_utc) : new Date(),
    destination: staticData?.Destination || null,
    navStatus: report?.NavigationalStatusName || report?.NavigationalStatus || null
  };
}

function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) && number !== 511 && number !== 360 ? number : null;
}
