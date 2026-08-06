import test from 'node:test';
import assert from 'node:assert/strict';
import { bootstrapHistoryFromVerifiedSources } from '../src/history-bootstrap.js';

const config = {
  targetMmsi: 247999000,
  currentLayerId: 0,
  historyLayerId: 1
};

test('bootstrapHistoryFromVerifiedSources seeds Layer 0 into empty history once', async () => {
  let historyCount = 0;
  const client = {
    async countHistoryFeatures() { return historyCount; },
    async queryCurrentFeature() {
      return {
        attributes: {
          MMSI: 247999000,
          VesselName: 'AMERIGO VESPUCCI',
          SpeedKnots: 8.1,
          Course: 97,
          Heading: null,
          Latitude: 49.384148,
          Longitude: -65.806084,
          LastAIS: 1785960720000,
          Source: 'aisstream'
        }
      };
    },
    async addHistoryPosition(position, source) {
      historyCount = 1;
      return { inserted: true, positionKey: 'seed-key', position, source };
    }
  };

  const first = await bootstrapHistoryFromVerifiedSources(client, config);
  assert.equal(first.seeded, true);
  assert.equal(first.historyPointCount, 1);
  assert.equal(first.recovered.length, 1);
  assert.equal(first.recovered[0].source, 'aisstream');

  const second = await bootstrapHistoryFromVerifiedSources(client, config);
  assert.equal(second.seeded, false);
  assert.match(second.reason, /already contains/);
});

test('bootstrapHistoryFromVerifiedSources does nothing without Layer 0 data', async () => {
  const client = {
    countHistoryFeatures: async () => 0,
    queryCurrentFeature: async () => null,
    addHistoryPosition: async () => { throw new Error('should not write'); }
  };
  const result = await bootstrapHistoryFromVerifiedSources(client, config);
  assert.equal(result.seeded, false);
  assert.equal(result.historyPointCount, 0);
});
