import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AUTH_NATIVE_SHORT_CODES,
  compareSourceIdentity,
  beginAuthNativeDiagnostic,
  failAuthNativeDiagnostic,
  getAuthNativeDiagnostic
} from '../public/spatial/spatial-auth-native-diagnostic.js';
import {
  matchesAuthoritativeAmenitiesSource,
  isAuthoritativeAmenitiesMapResult,
  getOsmNaAmenitiesSourceDef
} from '../public/spatial/source-presentation.js';

test('matchesAuthoritativeAmenitiesSource accepts CURRENT_WEBMAP Amenities layer URL', () => {
  const sourceDef = getOsmNaAmenitiesSourceDef();
  const result = {
    sourceId: 'montreal-amenities-catalog-id',
    sourceType: 'CURRENT_WEBMAP',
    displayName: 'Amenities',
    dataUrl: `${sourceDef.serviceUrl}/0`,
    catalogueUrl: `${sourceDef.serviceUrl}/0`,
    webmapLayer: {
      title: 'Amenities',
      url: `${sourceDef.serviceUrl}/0`
    }
  };
  assert.equal(matchesAuthoritativeAmenitiesSource(result, sourceDef), true);
  assert.equal(isAuthoritativeAmenitiesMapResult({ datasetResults: [result] }, sourceDef), true);
});

test('matchesAuthoritativeAmenitiesSource rejects unrelated webmap layer', () => {
  const sourceDef = getOsmNaAmenitiesSourceDef();
  const result = {
    sourceId: 'spvm-crime',
    sourceType: 'CURRENT_WEBMAP',
    dataUrl: 'https://example.com/other/FeatureServer/0'
  };
  assert.equal(matchesAuthoritativeAmenitiesSource(result, sourceDef), false);
});

test('compareSourceIdentity matches FeatureServer root and layer index', () => {
  const sourceDef = {
    serviceUrl: 'https://services6.arcgis.com/x/arcgis/rest/services/OSM_NA_Amenities/FeatureServer',
    layerId: 0
  };
  const layer = {
    url: 'https://services6.arcgis.com/x/arcgis/rest/services/OSM_NA_Amenities/FeatureServer/0',
    layerId: 0
  };
  const result = compareSourceIdentity(sourceDef, layer);
  assert.equal(result.identityMatch, true);
});

test('failAuthNativeDiagnostic records short code and failure stage', () => {
  beginAuthNativeDiagnostic();
  failAuthNativeDiagnostic('authoritative_webmap_layer_not_found', {
    failureStage: 'find_webmap_layer',
    webMapLayerCandidates: []
  });
  const diag = getAuthNativeDiagnostic();
  assert.equal(diag.shortCode, AUTH_NATIVE_SHORT_CODES.authoritative_webmap_layer_not_found);
  assert.equal(diag.failureReason, 'authoritative_webmap_layer_not_found');
  assert.equal(diag.fallbackInvoked, true);
});
