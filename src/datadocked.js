import { logger } from './logger.js';

export class DataDockedClient {
  constructor(config, onPosition, state) {
    this.config = config;
    this.onPosition = onPosition;
    this.state = state;
    this.timer = null;
    this.stopped = false;
  }

  start() {
    if (!this.config.datadockedApiKey) return;
    this.stopped = false;
    void this.poll({ force: true, reason: 'startup' });
    this.timer = setInterval(() => void this.poll({ reason: 'scheduled' }), this.config.datadockedPollIntervalSeconds * 1000);
  }

  stop() {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
  }

  aisIsFresh() {
    const lastAIS = this.state.lastAISStreamPosition?.lastAIS;
    return Boolean(lastAIS && Date.now() - lastAIS.getTime() <= this.config.datadockedAisStaleSeconds * 1000);
  }

  async poll({ force = false, reason = 'manual' } = {}) {
    if (!this.config.datadockedApiKey || this.stopped) return null;
    if (!force && this.aisIsFresh()) {
      logger.debug('Skipping Data Docked poll because AISStream is fresh', { reason });
      return null;
    }

    this.state.lastDataDockedAttempt = new Date();
    try {
      const position = await fetchDataDockedPosition(this.config);
      if (!position) return null;

      const latestAIS = this.state.lastAISStreamPosition?.lastAIS;
      if (latestAIS && position.lastAIS <= latestAIS) {
        logger.info('Rejected older Data Docked position because AISStream is newer', {
          dataDockedLastAIS: position.lastAIS.toISOString(),
          aisStreamLastAIS: latestAIS.toISOString()
        });
        return null;
      }

      await this.onPosition(position, { source: 'datadocked' });
      this.state.lastDataDockedAccepted = new Date();
      logger.info('Accepted Data Docked position', { lastAIS: position.lastAIS.toISOString(), reason });
      return position;
    } catch (error) {
      logger.warn('Data Docked position fetch failed', { error: error.message });
      return null;
    }
  }
}

export async function fetchDataDockedPosition(config) {
  const baseUrl = config.datadockedBaseUrl.replace(/\/$/, '');
  const url = new URL(`${baseUrl}/get-vessel-location`);
  url.searchParams.set('imo_or_mmsi', String(config.targetMmsi));

  const response = await fetch(url, { headers: { 'x-api-key': config.datadockedApiKey } });
  if (!response.ok) throw new Error(`Data Docked request failed with HTTP ${response.status}`);
  return parseDataDockedPosition(await response.json(), config.targetMmsi);
}

export function parseDataDockedPosition(response, targetMmsi) {
  const vessel = response?.detail && typeof response.detail === 'object' ? response.detail : response;
  if (!vessel || typeof vessel !== 'object') return null;

  const mmsi = Number(vessel.mmsi ?? vessel.MMSI ?? targetMmsi);
  if (mmsi !== Number(targetMmsi)) return null;

  const latitude = numberOrNull(vessel.latitude ?? vessel.lat);
  const longitude = numberOrNull(vessel.longitude ?? vessel.lon ?? vessel.lng);
  if (latitude === null || longitude === null) return null;

  const lastAIS = vessel.positionReceived ? new Date(vessel.positionReceived) : new Date();
  if (Number.isNaN(lastAIS.getTime())) return null;

  return {
    mmsi,
    vesselName: vessel.name || null,
    speedKnots: numberOrNull(vessel.speed),
    course: numberOrNull(vessel.course),
    heading: headingOrNull(vessel.heading),
    latitude,
    longitude,
    lastAIS,
    destination: vessel.destination || null,
    navStatus: vessel.navigationalStatus || null
  };
}

function headingOrNull(value) {
  if (value === '-') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}
