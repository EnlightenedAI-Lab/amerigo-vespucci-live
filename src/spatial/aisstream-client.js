import {
  AISSTREAM_DEFAULT_URL,
  AISSTREAM_SOURCE_ID,
  AISSTREAM_SOURCE_NAME,
  AISSTREAM_SOURCE_LICENSE,
  AISSTREAM_SOURCE_URL,
  AISSTREAM_SOURCE_NOTE,
  AIS_CLIENT_REFRESH_MS,
  AIS_POSITION_STALE_SECONDS,
  MONTREAL_VESSEL_BOUNDS,
  montrealBoundingBoxes
} from './aisstream-config.js';
import {
  mergeAisStreamMessage,
  normalizeVesselSnapshot,
  getAisStableId
} from './aisstream-normalize.js';
import { LIVE_SOURCE_CLASS, LIVE_OBJECT_FRESHNESS } from './live-object-types.js';
import { buildLiveEngineDiagnostics } from './live-object-engine.js';

/** @type {Map<number, object>} */
const vesselStateByMmsi = new Map();
/** @type {{ payload: object, receivedAtMs: number } | null} */
let lastSuccessfulSnapshot = null;
/** @type {object | null} */
let streamService = null;

function isKeyConfigured(apiKey) {
  const key = String(apiKey || '').trim();
  return key.length > 0 && !/^replace-with/i.test(key);
}

function pruneStaleVessels(nowMs = Date.now()) {
  for (const [mmsi, state] of vesselStateByMmsi) {
    const observedAt = state.positionObservedAt || state.lastPositionReceivedAt;
    if (!observedAt) {
      vesselStateByMmsi.delete(mmsi);
      continue;
    }
    const ageSec = Math.floor((nowMs - new Date(observedAt).getTime()) / 1000);
    if (ageSec > AIS_POSITION_STALE_SECONDS) {
      vesselStateByMmsi.delete(mmsi);
    }
  }
}

function buildSnapshotPayload(meta = {}) {
  const nowMs = meta.nowMs ?? Date.now();
  pruneStaleVessels(nowMs);
  const receivedAt = new Date(nowMs).toISOString();
  const normalized = normalizeVesselSnapshot(vesselStateByMmsi, { receivedAt, nowMs });
  const hasStale = normalized.objects.some((object) => object.freshness === 'STALE');
  const streamStatus = streamService?.getStatus?.() || {};

  return {
    status: hasStale ? LIVE_OBJECT_FRESHNESS.STALE : LIVE_OBJECT_FRESHNESS.CURRENT,
    source: AISSTREAM_SOURCE_NAME,
    sourceLicense: AISSTREAM_SOURCE_LICENSE,
    sourceClass: LIVE_SOURCE_CLASS.OPEN_COMMUNITY_LIVE,
    sourceUrl: AISSTREAM_SOURCE_URL,
    sourceNote: AISSTREAM_SOURCE_NOTE,
    bounds: MONTREAL_VESSEL_BOUNDS,
    feedTimestamp: normalized.feedTimestamp,
    receivedAt: normalized.receivedAt,
    vesselCount: normalized.vesselCount,
    objects: normalized.objects,
    stale: hasStale,
    error: streamStatus.error || null,
    keyConfigured: streamStatus.keyConfigured ?? false,
    streamConnected: Boolean(streamStatus.connected),
    messagesReceived: streamStatus.messagesReceived ?? 0,
    uniqueVesselsTracked: vesselStateByMmsi.size
  };
}

/**
 * @param {object} message
 */
export function ingestAisStreamMessage(message) {
  const meta = message?.MetaData || {};
  const mmsi = Number(meta.MMSI || message?.Message?.PositionReport?.UserID
    || message?.Message?.ShipStaticData?.UserID);
  if (!mmsi) return;

  const existing = vesselStateByMmsi.get(mmsi) || { mmsi };
  const merged = mergeAisStreamMessage(message, existing);
  vesselStateByMmsi.set(mmsi, merged);
  if (streamService) streamService.messagesReceived += 1;
}

class AisSpatialStreamService {
  constructor(config = {}) {
    this.config = config;
    this.ws = null;
    this.connected = false;
    this.stopped = false;
    this.reconnectAttempt = 0;
    this.messagesReceived = 0;
    this.lastError = null;
    this.keyConfigured = isKeyConfigured(config.aisstreamApiKey);
  }

  getStatus() {
    return {
      connected: this.connected,
      keyConfigured: this.keyConfigured,
      messagesReceived: this.messagesReceived,
      error: this.lastError,
      uniqueVesselsTracked: vesselStateByMmsi.size
    };
  }

  start() {
    if (!this.keyConfigured) {
      this.lastError = 'AISSTREAM_API_KEY not configured';
      return;
    }
    this.stopped = false;
    void this.connect();
  }

  stop() {
    this.stopped = true;
    this.ws?.close();
    this.connected = false;
  }

  async connect() {
    if (this.stopped || !this.keyConfigured) return;
    try {
      const { default: WebSocket } = await import('ws');
      const url = this.config.aisstreamUrl || AISSTREAM_DEFAULT_URL;
      this.ws = new WebSocket(url);
      this.ws.on('open', () => this.subscribe());
      this.ws.on('message', (data) => this.handleMessage(data));
      this.ws.on('close', (code, reason) => this.scheduleReconnect(`closed ${code} ${String(reason || '')}`));
      this.ws.on('error', (error) => {
        const message = error?.message || 'WebSocket error';
        this.lastError = message;
        if (/429/.test(message)) {
          this.reconnectAttempt = Math.max(this.reconnectAttempt, 5);
        }
      });
    } catch (error) {
      this.lastError = error?.message || 'WebSocket connect failed';
      this.scheduleReconnect('connect failed');
    }
  }

  subscribe() {
    if (!this.ws || this.ws.readyState !== 1) return;
    this.connected = true;
    this.reconnectAttempt = 0;
    this.lastError = null;
    const subscription = {
      APIKey: this.config.aisstreamApiKey,
      BoundingBoxes: montrealBoundingBoxes()
    };
    this.ws.send(JSON.stringify(subscription));
  }

  scheduleReconnect(reason) {
    this.connected = false;
    if (this.stopped) return;
    this.reconnectAttempt += 1;
    const isRateLimited = /429/.test(String(this.lastError || reason || ''));
    const delay = isRateLimited
      ? Math.min(600000, 120000 * Math.min(this.reconnectAttempt, 5))
      : Math.min(60000, 2000 * Math.min(this.reconnectAttempt, 6));
    if (!isRateLimited) {
      this.lastError = this.lastError || reason;
    }
    setTimeout(() => this.connect(), delay);
  }

  handleMessage(data) {
    try {
      const message = JSON.parse(data.toString());
      if (message?.error || message?.Error) {
        this.lastError = String(message.error || message.Error);
        return;
      }
      ingestAisStreamMessage(message);
    } catch (error) {
      this.lastError = error?.message || 'AIS message parse failed';
    }
  }
}

/**
 * @param {object} [config]
 */
export function startAisSpatialStream(config = {}) {
  const mergedConfig = {
    aisstreamApiKey: config.aisstreamApiKey || process.env.AISSTREAM_API_KEY,
    aisstreamUrl: config.aisstreamUrl || process.env.AISSTREAM_URL
  };
  if (streamService) {
    streamService.config = { ...streamService.config, ...mergedConfig };
    streamService.keyConfigured = isKeyConfigured(mergedConfig.aisstreamApiKey);
    if (streamService.keyConfigured && !streamService.connected && !streamService.stopped) {
      streamService.start();
    }
    return streamService;
  }
  streamService = new AisSpatialStreamService(mergedConfig);
  streamService.start();
  return streamService;
}

export function getAisSpatialStreamService() {
  return streamService;
}

/**
 * @param {{ force?: boolean, fetchFn?: typeof fetch }} [options]
 */
export async function fetchLiveVessels(options = {}) {
  const now = Date.now();
  const keyConfigured = isKeyConfigured(
    options.apiKey
    || process.env.AISSTREAM_API_KEY
  );

  if (
    !options.force
    && lastSuccessfulSnapshot
    && now - lastSuccessfulSnapshot.receivedAtMs < AIS_CLIENT_REFRESH_MS
  ) {
    return {
      ok: true,
      fromCache: true,
      ...lastSuccessfulSnapshot.payload
    };
  }

  if (!keyConfigured) {
    return {
      ok: false,
      status: LIVE_OBJECT_FRESHNESS.ERROR,
      source: AISSTREAM_SOURCE_NAME,
      sourceLicense: AISSTREAM_SOURCE_LICENSE,
      sourceClass: LIVE_SOURCE_CLASS.OPEN_COMMUNITY_LIVE,
      sourceUrl: AISSTREAM_SOURCE_URL,
      sourceNote: AISSTREAM_SOURCE_NOTE,
      bounds: MONTREAL_VESSEL_BOUNDS,
      feedTimestamp: lastSuccessfulSnapshot?.payload?.feedTimestamp || null,
      receivedAt: new Date(now).toISOString(),
      vesselCount: lastSuccessfulSnapshot?.payload?.vesselCount ?? 0,
      objects: lastSuccessfulSnapshot?.payload?.objects ?? [],
      stale: true,
      error: 'AISSTREAM_API_KEY not configured',
      keyConfigured: false,
      streamConnected: false,
      keyRequired: true
    };
  }

  if (!streamService && keyConfigured && !options.skipStreamStart) {
    startAisSpatialStream({
      aisstreamApiKey: process.env.AISSTREAM_API_KEY,
      aisstreamUrl: process.env.AISSTREAM_URL
    });
  }

  const payload = buildSnapshotPayload({ nowMs: now });
  const streamStatus = streamService?.getStatus?.() || {};

  if (!payload.objects.length && !streamStatus.connected && !lastSuccessfulSnapshot) {
    return {
      ok: false,
      status: LIVE_OBJECT_FRESHNESS.ERROR,
      ...payload,
      error: streamStatus.error || 'AISStream WebSocket not connected',
      keyConfigured: true,
      streamConnected: false
    };
  }

  if (!streamStatus.connected && !payload.objects.length && lastSuccessfulSnapshot) {
    return {
      ok: true,
      ...lastSuccessfulSnapshot.payload,
      status: LIVE_OBJECT_FRESHNESS.STALE,
      stale: true,
      error: streamStatus.error || 'AISStream disconnected',
      streamConnected: false,
      fromCache: true
    };
  }

  const result = {
    ok: true,
    ...payload,
    keyConfigured: true,
    streamConnected: Boolean(streamStatus.connected),
    error: payload.error || null
  };

  lastSuccessfulSnapshot = {
    payload: result,
    receivedAtMs: now
  };

  return result;
}

export const aisStreamAdapter = {
  sourceId: AISSTREAM_SOURCE_ID,
  sourceName: AISSTREAM_SOURCE_NAME,
  sourceClass: LIVE_SOURCE_CLASS.OPEN_COMMUNITY_LIVE,
  sourceUrl: AISSTREAM_SOURCE_URL,
  sourceLicense: AISSTREAM_SOURCE_LICENSE,
  sourceNote: AISSTREAM_SOURCE_NOTE,
  refreshMs: AIS_CLIENT_REFRESH_MS,
  getStableId: getAisStableId
};

export function getAisAdapterInterface() {
  return {
    sourceId: aisStreamAdapter.sourceId,
    sourceName: aisStreamAdapter.sourceName,
    sourceClass: aisStreamAdapter.sourceClass,
    sourceUrl: aisStreamAdapter.sourceUrl,
    sourceLicense: aisStreamAdapter.sourceLicense,
    refreshMs: aisStreamAdapter.refreshMs,
    fetchSnapshot: 'fetchLiveVessels()',
    normalize: 'normalizeVesselSnapshot(stateMap, meta)',
    getStableId: 'getAisStableId(object) -> liveObjectId'
  };
}

export function getLiveVesselsDiagnostics(snapshot = lastSuccessfulSnapshot?.payload) {
  return buildLiveEngineDiagnostics({
    status: snapshot?.status,
    objectCount: snapshot?.vesselCount,
    feedTimestamp: snapshot?.feedTimestamp,
    receivedAt: snapshot?.receivedAt,
    refreshMs: AIS_CLIENT_REFRESH_MS,
    error: snapshot?.error,
    stale: snapshot?.stale
  });
}

export function __resetAisVesselCacheForTests() {
  vesselStateByMmsi.clear();
  lastSuccessfulSnapshot = null;
  if (streamService) {
    streamService.stopped = true;
    streamService.ws?.close();
    streamService = null;
  }
}

export function __ingestAisMessagesForTests(messages = [], nowMs = Date.now()) {
  const observedAt = new Date(nowMs).toISOString();
  for (const message of messages) {
    const patched = JSON.parse(JSON.stringify(message));
    if (patched.MetaData) patched.MetaData.time_utc = observedAt;
    ingestAisStreamMessage(patched);
  }
}
