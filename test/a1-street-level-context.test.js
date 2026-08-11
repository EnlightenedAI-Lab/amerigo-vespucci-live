import test from 'node:test';
import assert from 'node:assert/strict';
import { computeCoordinateOffsetMeters } from '../public/spatial/street-level-context-geometry.js';
import { createStreetLevelContextProvider } from '../public/spatial/street-level-context-provider.js';
import { createGoogleStreetViewProvider } from '../public/spatial/google-street-view-provider.js';
import {
  applyStreetLevelContextConfig,
  closeStreetLevelContext,
  getStreetLevelContextState,
  getStreetLevelGoogleRequestCount,
  openStreetLevelContext,
  resetStreetLevelContextState,
  resetStreetLevelGoogleRequestCount,
  setStreetLevelContextProviderForTests,
  setStreetLevelContextSelectedLocation
} from '../public/spatial/street-level-context-service.js';
import {
  renderStreetLevelContextActionHtml,
  renderStreetLevelContextPanelHtml,
  resolveStreetLevelActionState
} from '../public/spatial/street-level-context-presentation.js';
import { buildPointIntelligenceSummaryHtml } from '../public/spatial/point-intelligence-presentation.js';
import { adaptBundleResponse } from '../public/spatial/point-intelligence-bundle.js';
import {
  getPointIntelligenceRequestCount,
  resetPointIntelligenceRequestCount
} from '../public/spatial/point-intelligence-service.js';
import {
  getOpenWorldIntelligenceRequestCount,
  resetOpenWorldIntelligenceRequestCount
} from '../public/spatial/open-world-intelligence-service.js';
import { getSpatialPublicConfig } from '../src/spatial/spatial-api.js';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MONTREAL = { longitude: -73.5673, latitude: 45.5017 };
const OFFSET_PANO = { longitude: -73.5678, latitude: 45.5020 };

function mockProvider({ available = true, panorama = OFFSET_PANO, status = 'OK' } = {}) {
  let openCalls = 0;
  let checkCalls = 0;
  return {
    id: 'google-street-view',
    isConfigured: () => true,
    async checkAvailability(requested) {
      checkCalls += 1;
      if (!available) {
        return {
          available: false,
          requested: { ...requested },
          panorama: null,
          status: 'ZERO_RESULTS',
          offsetMeters: null,
          message: 'Street View unavailable near this location'
        };
      }
      const offsetMeters = computeCoordinateOffsetMeters(requested, panorama);
      return {
        available: true,
        requested: { ...requested },
        panorama: { ...panorama },
        panoId: 'mock-pano',
        status,
        offsetMeters,
        message: null
      };
    },
    async openPanorama(container, input) {
      openCalls += 1;
      container.dataset.mounted = '1';
      return { ...input.availability, panoramaInstance: { setVisible() {} } };
    },
    closePanorama() {},
    stats: () => ({ openCalls, checkCalls })
  };
}

test.beforeEach(() => {
  resetStreetLevelContextState();
  resetStreetLevelGoogleRequestCount();
  resetPointIntelligenceRequestCount();
  resetOpenWorldIntelligenceRequestCount();
});

test('1. selected coordinate is passed correctly to Street View open', async () => {
  const provider = mockProvider();
  setStreetLevelContextProviderForTests(provider, { configured: true });
  const iqaiPoint = { ...MONTREAL };
  setStreetLevelContextSelectedLocation(iqaiPoint);

  await openStreetLevelContext(null);

  const state = getStreetLevelContextState();
  assert.equal(state.requestedLocation.latitude, MONTREAL.latitude);
  assert.equal(state.requestedLocation.longitude, MONTREAL.longitude);
  assert.equal(provider.stats().checkCalls, 1);
});

test('2. no selected coordinate → NO_LOCATION / disabled action', async () => {
  setStreetLevelContextProviderForTests(mockProvider(), { configured: true });
  const state = await openStreetLevelContext(null);
  assert.equal(state.panelState, 'NO_LOCATION');
  assert.equal(getStreetLevelGoogleRequestCount(), 0);

  const action = resolveStreetLevelActionState({
    hasLocation: false,
    configured: true,
    panelState: 'CLOSED'
  });
  assert.equal(action.canOpen, false);
  const html = renderStreetLevelContextActionHtml(action);
  assert.match(html, /disabled/);
});

test('3. no credential/config → CONFIG_DISABLED without Google call', async () => {
  applyStreetLevelContextConfig({ configured: false, googleMapsBrowserApiKey: '' });
  setStreetLevelContextSelectedLocation(MONTREAL);
  const state = await openStreetLevelContext(null);
  assert.equal(state.panelState, 'CONFIG_DISABLED');
  assert.equal(getStreetLevelGoogleRequestCount(), 0);
  const html = renderStreetLevelContextActionHtml({
    hasLocation: true,
    configured: false,
    open: false
  });
  assert.match(html, /not configured/i);
  assert.match(html, /disabled/);
});

test('4. explicit user action required — selecting location does not open Street View', () => {
  setStreetLevelContextProviderForTests(mockProvider(), { configured: true });
  setStreetLevelContextSelectedLocation(MONTREAL);
  const state = getStreetLevelContextState();
  assert.equal(state.panelState, 'CLOSED');
  assert.equal(getStreetLevelGoogleRequestCount(), 0);
});

test('5. available panorama resolves with panorama location', async () => {
  setStreetLevelContextProviderForTests(mockProvider({ available: true }), { configured: true });
  setStreetLevelContextSelectedLocation(MONTREAL);
  const container = { dataset: {} };
  const state = await openStreetLevelContext(container);
  assert.equal(state.panelState, 'AVAILABLE');
  assert.equal(state.panoramaLocation.latitude, OFFSET_PANO.latitude);
  assert.equal(state.panoramaLocation.longitude, OFFSET_PANO.longitude);
  assert.ok(Number(state.offsetMeters) > 0);
});

test('6. unavailable panorama surfaces truthful message', async () => {
  setStreetLevelContextProviderForTests(mockProvider({ available: false }), { configured: true });
  setStreetLevelContextSelectedLocation(MONTREAL);
  const state = await openStreetLevelContext(null);
  assert.equal(state.panelState, 'UNAVAILABLE');
  assert.match(state.message, /Street View unavailable near this location/);
  const panel = renderStreetLevelContextPanelHtml(state);
  assert.match(panel, /Street View unavailable near this location/);
});

test('7. panorama offset does not mutate selected IQAI coordinate', async () => {
  const iqaiPoint = { ...MONTREAL };
  setStreetLevelContextProviderForTests(mockProvider({ available: true }), { configured: true });
  setStreetLevelContextSelectedLocation(iqaiPoint);
  await openStreetLevelContext(null);

  assert.equal(iqaiPoint.latitude, MONTREAL.latitude);
  assert.equal(iqaiPoint.longitude, MONTREAL.longitude);

  const state = getStreetLevelContextState();
  assert.equal(state.requestedLocation.latitude, MONTREAL.latitude);
  assert.equal(state.requestedLocation.longitude, MONTREAL.longitude);
  assert.notEqual(state.panoramaLocation.latitude, state.requestedLocation.latitude);
});

test('8. Street View open request deltas = 0 for IQAI intelligence counters', async () => {
  setStreetLevelContextProviderForTests(mockProvider({ available: true }), { configured: true });
  setStreetLevelContextSelectedLocation(MONTREAL);

  const beforePi = getPointIntelligenceRequestCount();
  const beforeOw = getOpenWorldIntelligenceRequestCount();
  const beforeGoogle = getStreetLevelGoogleRequestCount();

  await openStreetLevelContext(null);

  assert.equal(getPointIntelligenceRequestCount() - beforePi, 0);
  assert.equal(getOpenWorldIntelligenceRequestCount() - beforeOw, 0);
  assert.equal(getStreetLevelGoogleRequestCount() - beforeGoogle, 1);
});

test('9. Street View close request deltas = 0', async () => {
  setStreetLevelContextProviderForTests(mockProvider({ available: true }), { configured: true });
  setStreetLevelContextSelectedLocation(MONTREAL);
  await openStreetLevelContext(null);

  const beforePi = getPointIntelligenceRequestCount();
  const beforeOw = getOpenWorldIntelligenceRequestCount();
  const beforeGoogle = getStreetLevelGoogleRequestCount();

  closeStreetLevelContext();

  assert.equal(getStreetLevelContextState().panelState, 'CLOSED');
  assert.equal(getPointIntelligenceRequestCount() - beforePi, 0);
  assert.equal(getOpenWorldIntelligenceRequestCount() - beforeOw, 0);
  assert.equal(getStreetLevelGoogleRequestCount() - beforeGoogle, 0);
});

test('10. existing map click path unchanged — Street View modules are not wired into PI query', async () => {
  const mapCommand = readFileSync(
    resolve(__dirname, '../public/spatial/spatial-map-command.js'),
    'utf8'
  );
  const service = readFileSync(
    resolve(__dirname, '../public/spatial/point-intelligence-service.js'),
    'utf8'
  );
  assert.equal(mapCommand.includes('street-level-context'), false);
  assert.equal(service.includes('street-level-context'), false);
  assert.equal(service.includes('Street View'), false);
  assert.match(mapCommand, /setPointIntelligenceClickMode/);
});

test('public config exposes Street View gate without requiring key at startup', () => {
  const base = {
    iqaiV2Enabled: false,
    spatialLayersEnabled: true,
    legacyUiEnabled: true,
    radarEnabled: false,
    targetMmsi: 1,
    oceanViewWebmapId: 'x',
    arcgisFeatureServiceUrl: 'https://example.test',
    currentLayerId: 0,
    historyLayerId: 1,
    travelledRouteLayerId: 2,
    destinationLayerId: 3,
    estimatedRouteLayerId: 4,
    conditionsLayerId: 5,
    destinationName: 'Test',
    destinationPortCode: 'TST',
    destinationLatitude: '45.5',
    destinationLongitude: '-73.5',
    googleMapsBrowserApiKey: ''
  };
  const disabled = getSpatialPublicConfig(base);
  assert.equal(disabled.streetLevelContext.configured, false);
  assert.equal(disabled.streetLevelContext.provider, 'google-street-view');

  const enabled = getSpatialPublicConfig({
    ...base,
    googleMapsBrowserApiKey: 'browser-key-test'
  });
  assert.equal(enabled.streetLevelContext.configured, true);
  assert.equal(enabled.streetLevelContext.googleMapsBrowserApiKey, 'browser-key-test');
});

test('LIF summary HTML includes Street View action host (integration seam)', () => {
  const adapted = adaptBundleResponse({
    bundleId: 'iqai.pi.bundle.slc-test',
    bundleState: 'SUCCESS',
    families: [{
      informationFamily: 'weather',
      status: 'SUCCESS',
      queryReceiptId: 'receipt-weather',
      resultCount: 1,
      results: [{ temporalClassification: 'NEAR_REAL_TIME' }]
    }],
    spatialSummary: {
      requestedGeometry: { type: 'Point', coordinates: [MONTREAL.longitude, MONTREAL.latitude] },
      radiusMeters: 3000,
      families: []
    },
    plannerDecision: { selectionMode: 'AUTO', temporalIntent: { mode: 'LATEST' }, eligible: [] }
  }, MONTREAL, 1);

  const html = buildPointIntelligenceSummaryHtml({
    point: MONTREAL,
    response: adapted
  });
  assert.match(html, /Point Intelligence/);
  assert.match(html, /data-slc-action-host/);
  assert.match(html, /id="slc-panel-host"/);
});

test('Google provider metadata mock honors availability and offset honesty', async () => {
  const provider = createGoogleStreetViewProvider({
    apiKey: 'test',
    getPanoramaMetadata: async () => ({
      status: 'OK',
      result: {
        location: {
          latLng: { lat: () => OFFSET_PANO.latitude, lng: () => OFFSET_PANO.longitude },
          pano: 'p1'
        }
      }
    }),
    createPanorama: (container) => {
      container.dataset.ok = '1';
      return { setVisible() {} };
    }
  });
  const availability = await provider.checkAvailability(MONTREAL);
  assert.equal(availability.available, true);
  assert.ok(availability.offsetMeters > 0);
  assert.equal(availability.requested.latitude, MONTREAL.latitude);
});

test('factory rejects unknown providers (boundary intact)', () => {
  assert.throws(() => createStreetLevelContextProvider('mapillary'), /Unsupported/);
});
