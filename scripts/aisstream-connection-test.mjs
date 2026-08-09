/**
 * Server-side AISStream connection diagnostic (does not print API key).
 */
import 'dotenv/config';
import { ingestAisStreamMessage } from '../src/spatial/aisstream-client.js';
import { montrealBoundingBoxes } from '../src/spatial/aisstream-config.js';

const URL = process.env.AISSTREAM_URL || 'wss://stream.aisstream.io/v0/stream';
const API_KEY = process.env.AISSTREAM_API_KEY || '';
const LISTEN_MS = Number(process.env.AISSTREAM_TEST_MS || 90000);

function isPositionMessage(message) {
  const ais = message?.Message || {};
  return Boolean(
    ais.PositionReport
    || ais.StandardClassBPositionReport
    || ais.ExtendedClassBPositionReport
  );
}

function isStaticMessage(message) {
  const ais = message?.Message || {};
  return Boolean(ais.ShipStaticData || ais.StaticDataReport);
}

async function runTest(options = {}) {
  const { default: WebSocket } = await import('ws');
  const listenMs = options.listenMs ?? LISTEN_MS;
  const boundingBoxes = options.boundingBoxes ?? montrealBoundingBoxes();
  const filterMessageTypes = options.filterMessageTypes ?? null;

  const stats = {
    socketConnected: false,
    subscriptionSent: false,
    errorResponse: null,
    messagesReceived: 0,
    positionMessages: 0,
    staticMessages: 0,
    uniqueMmsi: new Set(),
    messageTypes: new Set()
  };

  return new Promise((resolve) => {
    const ws = new WebSocket(URL);
    let finished = false;

    const finish = () => {
      if (finished) return;
      finished = true;
      try { ws.close(); } catch { /* ignore */ }
      resolve(stats);
    };

    const timer = setTimeout(finish, listenMs);

    ws.on('open', () => {
      stats.socketConnected = true;
      const subscription = {
        APIKey: API_KEY,
        BoundingBoxes: boundingBoxes
      };
      if (filterMessageTypes?.length) {
        subscription.FilterMessageTypes = filterMessageTypes;
      }
      ws.send(JSON.stringify(subscription));
      stats.subscriptionSent = true;
    });

    ws.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString());
        if (message?.error || message?.Error) {
          stats.errorResponse = String(message.error || message.Error);
          return;
        }
        stats.messagesReceived += 1;
        const type = message.MessageType || Object.keys(message.Message || {})[0] || 'unknown';
        stats.messageTypes.add(type);
        const mmsi = Number(message?.MetaData?.MMSI);
        if (mmsi) stats.uniqueMmsi.add(mmsi);
        if (isPositionMessage(message)) stats.positionMessages += 1;
        if (isStaticMessage(message)) stats.staticMessages += 1;
        ingestAisStreamMessage(message);
      } catch {
        // skip malformed
      }
    });

    ws.on('error', (error) => {
      stats.errorResponse = stats.errorResponse || error?.message || 'WebSocket error';
    });

    ws.on('close', () => {
      clearTimeout(timer);
      finish();
    });
  });
}

async function main() {
  if (!API_KEY.trim() || /^replace-with/i.test(API_KEY)) {
    console.log(JSON.stringify({ configured: false }));
    process.exit(1);
  }

  const filteredTypes = [
    'PositionReport',
    'StandardClassBPositionReport',
    'ExtendedClassBPositionReport',
    'ShipStaticData',
    'StaticDataReport'
  ];

  const first = await runTest({ filterMessageTypes: filteredTypes });
  let retry = null;
  if (first.messagesReceived === 0 && first.socketConnected) {
    retry = await runTest({ filterMessageTypes: null });
  }

  console.log(JSON.stringify({
    configured: true,
    url: URL,
    listenSeconds: LISTEN_MS / 1000,
    first: {
      socketConnected: first.socketConnected,
      subscriptionSent: first.subscriptionSent,
      errorResponse: first.errorResponse || 'NONE',
      messagesReceived: first.messagesReceived,
      positionMessages: first.positionMessages,
      staticMessages: first.staticMessages,
      uniqueMmsi: first.uniqueMmsi.size,
      messageTypes: [...first.messageTypes]
    },
    retryNeeded: first.messagesReceived === 0 && first.socketConnected,
    retry: retry ? {
      messagesReceived: retry.messagesReceived,
      positionMessages: retry.positionMessages,
      staticMessages: retry.staticMessages,
      uniqueMmsi: retry.uniqueMmsi.size,
      messageTypes: [...retry.messageTypes]
    } : null
  }));
}

main().catch((error) => {
  console.error(error?.message || error);
  process.exit(1);
});
