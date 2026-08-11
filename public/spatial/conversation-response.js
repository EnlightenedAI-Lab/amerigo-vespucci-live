/**
 * Deterministic one-line MAP responses — generated from execution results, not LLM.
 */

function joinTitles(layers = []) {
  const titles = layers.map((layer) => layer.title).filter(Boolean);
  if (!titles.length) return 'layers';
  if (titles.length === 1) return titles[0];
  if (titles.length === 2) return `${titles[0]} and ${titles[1]}`;
  return `${titles.slice(0, -1).join(', ')} and ${titles[titles.length - 1]}`;
}

function operationVerb(operation) {
  switch (operation) {
    case 'SHOW_LAYER':
    case 'SHOW_LAYERS':
      return 'turned on';
    case 'HIDE_LAYER':
    case 'HIDE_LAYERS':
      return 'hidden';
    case 'TOGGLE_LAYER':
    case 'TOGGLE_LAYERS':
      return 'toggled';
    case 'ZOOM_TO_LAYER':
    case 'ZOOM_TO_LAYERS':
      return 'zoomed to';
    default:
      return operation?.replace(/_/g, ' ').toLowerCase() || 'updated';
  }
}

export function responseForListLayers(count) {
  return `${count} operational layer${count === 1 ? '' : 's'} available.`;
}

export function responseForMixedLayerControls(operations = []) {
  const parts = operations.map(({ operation, layers }) => {
    const titles = joinTitles(layers);
    if (operation === 'SHOW_LAYER' || operation === 'SHOW_LAYERS') {
      return `${titles} turned on`;
    }
    if (operation === 'HIDE_LAYER' || operation === 'HIDE_LAYERS') {
      return `${titles} hidden`;
    }
    return `${titles} ${operationVerb(operation)}`;
  });
  if (!parts.length) return 'Layers updated.';
  return `${parts.join('; ')}.`;
}

export function responseForLayerControls(operation, layers) {
  const titles = joinTitles(layers);
  const verb = operationVerb(operation);
  if (operation === 'ZOOM_TO_LAYER' || operation === 'ZOOM_TO_LAYERS') {
    return `Zoomed to ${titles}.`;
  }
  if (operation === 'SHOW_LAYER' || operation === 'SHOW_LAYERS') {
    return `${titles} turned on.`;
  }
  if (operation === 'HIDE_LAYER' || operation === 'HIDE_LAYERS') {
    return `${titles} hidden.`;
  }
  return `${titles} ${verb}.`;
}

export function responseForHideAll(sourceCount, scopedCount = 0) {
  if (scopedCount > 0) {
    return `${sourceCount} source layer${sourceCount === 1 ? '' : 's'} and ${scopedCount} result layer${scopedCount === 1 ? '' : 's'} hidden.`;
  }
  return `${sourceCount} operational layer${sourceCount === 1 ? '' : 's'} hidden.`;
}

export function responseForHideAllSource(count) {
  return `${count} source layer${count === 1 ? '' : 's'} hidden.`;
}

export function responseForShowAll(count) {
  return `${count} operational layer${count === 1 ? '' : 's'} turned on.`;
}

export function responseForShowOnly(layers) {
  return `Showing only ${joinTitles(layers)}.`;
}

export function responseForReset() {
  return 'Original Montreal 1 map restored.';
}

export function responseForLocationReuse(address) {
  return `Using previous location: ${address}.`;
}

export function responseForCategoryCounts(mapResult) {
  const xray = mapResult.xrayResult || {};
  const km = xray.radiusKm ?? (mapResult.summary?.radiusMeters ? mapResult.summary.radiusMeters / 1000 : null);
  const totalCategories = xray.totalCategories ?? mapResult.summary?.totalCategories ?? 0;
  const totalFeatures = xray.totalFeaturesRepresented ?? mapResult.summary?.totalFeaturesRepresented ?? 0;
  const kmLabel = Number.isFinite(km) ? `${km} km` : 'AOI';
  return `${totalCategories} amenity categories (${totalFeatures} features) within ${kmLabel}.`;
}

export function formatCategoryCountsReadout(mapResult, maxRows = 25) {
  const xray = mapResult.xrayResult || {};
  const km = xray.radiusKm ?? (mapResult.summary?.radiusMeters ? mapResult.summary.radiusMeters / 1000 : null);
  const categories = xray.categories || mapResult.categoryCounts || [];
  const lines = [`AMENITIES WITHIN ${km ?? '—'} KM`, ''];
  const visible = categories.slice(0, maxRows);
  for (const entry of visible) {
    lines.push(`${String(entry.value).padEnd(24)} ${entry.count}`);
  }
  if (categories.length > maxRows) {
    lines.push('');
    lines.push(`… and ${categories.length - maxRows} more categories`);
  }
  return lines.join('\n');
}

export function responseForMapResult(mapResult, expansion) {
  if (!mapResult) return responseForResultCleared();
  if (mapResult.action === 'CATEGORY_COUNTS_WITHIN' || mapResult.summary?.displayMode === 'category_counts') {
    return responseForCategoryCounts(mapResult);
  }
  if (expansion === 'location_reuse' && mapResult.origin?.matchedAddress) {
    return responseForLocationReuse(mapResult.origin.matchedAddress);
  }
  const count = mapResult.summary?.matchedFeatures ?? mapResult.features?.length ?? 0;
  const dataset = mapResult.summary?.dataset || mapResult.datasetResults?.[0]?.displayName || 'results';
  const datasetLabel = String(dataset).toLowerCase();
  if (count === 0) {
    return `No matching ${datasetLabel} found.`;
  }
  if (mapResult.summary?.resultTruncated) {
    return `Results may be incomplete — source service limit encountered.`;
  }
  if (mapResult.summary?.action === 'COUNT' || mapResult.request?.action === 'COUNT') {
    return `${count.toLocaleString()} ${datasetLabel} within search area.`;
  }
  const radiusMeters = mapResult.summary?.radiusMeters;
  if (radiusMeters) {
    const km = radiusMeters / 1000;
    const kmLabel = Number.isInteger(km) ? String(km) : km.toFixed(1);
    return `${count.toLocaleString()} ${datasetLabel} found within ${kmLabel} km.`;
  }
  return `${count.toLocaleString()} ${datasetLabel} found.`;
}

export function responseForCategoryFilter(categoryLabel, count) {
  if (!categoryLabel || categoryLabel.toLowerCase().includes('all')) {
    return 'All categories shown.';
  }
  const label = categoryLabel.toLowerCase();
  const countLabel = count != null ? Number(count).toLocaleString() : '';
  return countLabel ? `${countLabel} ${label} shown.` : `${label} shown.`;
}

export function responseForResultCleared() {
  return 'Result cleared.';
}

export function responseForScopedVisibility(action) {
  if (action === 'HIDE_SCOPED_RESULTS') return 'Scoped query results hidden.';
  if (action === 'SHOW_SCOPED_RESULTS') return 'Scoped query results shown.';
  if (action === 'ZOOM_SCOPED_RESULTS') return 'Zoomed to scoped query results.';
  return 'Scoped results updated.';
}

export function responseForQueryVisibility(action) {
  return responseForScopedVisibility(action);
}

export function responseForClarification(message) {
  return message?.startsWith('Ambiguous') ? message : `Ambiguous request: ${message}`;
}

export function responseForError(message) {
  return message || 'Command could not be completed.';
}
