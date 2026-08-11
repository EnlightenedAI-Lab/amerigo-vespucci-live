/**
 * Agent 2 open-world temporary map layer — visually distinct from Agent 5 PI.
 */
import { focusOpenWorldResult, setOpenWorldMapPresentation } from './open-world-intelligence-map-state.js';
import {
  clearOpenWorldIntelligenceLayer,
  renderOpenWorldIntelligenceMap,
  emphasizeOpenWorldMapResult
} from './open-world-intelligence-layer.js';
import { getMapView } from './spatial-arcgis-runtime.js';

let currentGeneration = 0;
/** @type {Map<string, object>} */
let featureById = new Map();

export async function clearOpenWorldMapLayers() {
  featureById = new Map();
  await clearOpenWorldIntelligenceLayer();
  document.querySelector('#spatial-map-tools')?.querySelector('[data-owi-map-echo]')?.remove();
}

export async function resetOpenWorldMapPresentation(normalized, generation) {
  currentGeneration = generation;
  await clearOpenWorldMapLayers();
  featureById = new Map();
  const spatial = normalized?.spatial || [];
  for (const item of spatial) {
    if (!item.id) continue;
    featureById.set(item.id, item);
  }

  const mapStats = await renderOpenWorldIntelligenceMap(spatial, null);
  await fitMapToOpenWorldResults(spatial);

  setOpenWorldMapPresentation({
    generation,
    renderedFeatures: mapStats.rendered,
    skippedFeatures: mapStats.skipped,
    incidentMarkers: normalized?.summary?.mapIncidentMarkers || 0,
    spatialItems: spatial,
    accounting: normalized?.accounting || null
  }, generation);
  renderMapEcho(spatial, mapStats);
}

async function fitMapToOpenWorldResults(spatial) {
  const view = getMapView();
  if (!view || !spatial.length) return;
  try {
    const layer = view.map?.findLayerById('iqai-open-world-intel');
    if (layer?.graphics?.length) {
      await view.goTo(layer.graphics, { padding: 56, duration: 500 });
    }
  } catch {
    // extent fit is best-effort
  }
}

function renderMapEcho(spatial, mapStats = {}) {
  const host = document.querySelector('#spatial-map-tools');
  if (!host) return;
  let echo = host.querySelector('[data-owi-map-echo]');
  if (!echo) {
    echo = document.createElement('div');
    echo.dataset.owiMapEcho = '1';
    echo.className = 'owi-map-echo';
    host.appendChild(echo);
  }
  const rendered = mapStats.rendered ?? spatial.length;
  const skipped = mapStats.skipped || 0;
  echo.textContent = rendered
    ? `Open-world · ${rendered} on map${skipped ? ` · ${skipped} skipped` : ''}`
    : 'Open-world · no spatial matches on map';
}

export function getOpenWorldFeatureById(id) {
  return featureById.get(id) || null;
}

export function focusOpenWorldMapFeature(resultId) {
  const focused = focusOpenWorldResult(resultId, currentGeneration);
  if (focused) {
    void emphasizeOpenWorldMapResult(resultId);
  }
  return focused;
}
