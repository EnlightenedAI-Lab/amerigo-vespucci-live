/**
 * Canonical operational-feature selection.
 *
 * SVG remains the proven paint surface. Transparent graphics in the existing
 * one-MapView operational GraphicsLayer provide real MapView.hitTest targets.
 * Selection commits through the chassis selection.set capability.
 */
import {
  createObjectRef,
  objectRefKey
} from '../foundation/contracts/index.js';
import {
  getMapView,
  getOpsGraphicsLayer,
  subscribeMapFoundation
} from '../map/map-foundation.js';
import {
  OPS_FEATURE_ATTRIBUTE,
  OPS_HIT_ATTRIBUTE,
  OPS_LAYER_ATTRIBUTE,
  clearSelectedOpsFeature,
  getOpsClusterAt,
  getOpsFeatureRecord,
  setSelectedOpsFeature
} from './overlay.js';

export const OPS_SELECT_ACTION = 'SELECT_OPERATIONAL_FEATURE';
export const OPS_CLEAR_ACTION = 'CLEAR_OPERATIONAL_FEATURE';

function text(value) {
  const valueText = String(value ?? '').trim();
  return valueText || null;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function namespaceOf(record) {
  if (record.layerId === 'recent-crime') return 'spvm';
  return String(record.meta?.provider || record.feature?.properties?.source || 'iqai-ops')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 64) || 'iqai-ops';
}

function datasetVersionOf(record) {
  const properties = record.feature?.properties || {};
  return text(
    properties.datasetVersion
    || record.payload?.datasetVersion
    || record.payload?.asOfDate
    || record.payload?.windowEnd
    || record.payload?.latestSourceTimestamp
    || properties.sourceTimestamp
    || properties.date
    || record.payload?.retrievedAt?.slice?.(0, 10)
  ) || 'session-1';
}

function labelOf(record) {
  const properties = record.feature?.properties || {};
  const category = text(properties.categoryEnglish || properties.category || properties.name);
  const date = text(properties.date || properties.sourceTimestamp);
  return [category, date].filter(Boolean).join(' · ') || `${record.meta?.title || record.layerId} ${record.featureId}`;
}

export function createOpsObjectRef(record) {
  if (!record?.layerId || !record?.featureId) {
    throw new Error('Operational feature identity is incomplete.');
  }
  const crime = record.layerId === 'recent-crime';
  return createObjectRef({
    namespace: namespaceOf(record),
    kind: crime ? 'crime-report' : record.layerId,
    id: record.featureId,
    datasetRef: crime
      ? 'montreal-open-data:spvm:actes-criminels'
      : `iqai-spatial-v2:ops:${record.layerId}`,
    datasetVersion: datasetVersionOf(record),
    sourceRef: crime
      ? 'spvm:actes-criminels'
      : text(record.feature?.properties?.source || record.meta?.provider) || `ops:${record.layerId}`,
    label: labelOf(record),
    geometryRef: `geojson:${record.layerId}:${record.featureId}`
  });
}

export function buildOpsInspectorModel(record) {
  const properties = record.feature?.properties || {};
  const category = text(properties.categoryEnglish || properties.category || properties.name)
    || text(record.meta?.title)
    || 'Operational feature';
  const date = text(properties.date || properties.sourceTimestamp);
  const shift = text(properties.time || properties.shift);
  const pdq = text(properties.pdq);
  const location = text(
    properties.address
    || properties.location
    || properties.place
    || properties.siteAddress
  );
  const status = text(record.payload?.status || record.meta?.status);
  const rows = [
    ['DATE', date],
    ['TIME / SHIFT', shift],
    ['LOCATION / ADDRESS', location],
    ['POLICE DISTRICT', pdq ? `PDQ ${pdq}` : null],
    ['ROUTE', properties.routeId || properties.route],
    ['DESTINATION', properties.destination],
    ['VEHICLE UPDATED', properties.vehicleTimestamp || properties.observedAt],
    ['CUSTOMERS AFFECTED', properties.customersAffected],
    ['OUTAGE START', properties.outageStart],
    ['ESTIMATED RESTORATION', properties.estimatedRestoration],
    ['CREW STATUS', properties.crewStatusLabel],
    ['CAUSE', properties.causeCategory],
    ['MUNICIPALITY ID', properties.municipalityId],
    ['PUBLISHED AREA', properties.hasPublishedArea === true ? 'YES' : null],
    ['AVAILABLE BIKES', properties.availableBikes],
    ['AVAILABLE DOCKS', properties.availableDocks],
    ['AIR QUALITY INDEX', properties.iqa],
    ['OBSERVED AT', properties.observedAt || properties.feedTimestamp],
    ['LOCATION PRECISION', properties.spatialPrecision],
    ['TEMPORAL PRECISION', properties.temporalPrecision],
    ['LOCATION NOTE', properties.locationNote],
    ['SOURCE', properties.source || record.meta?.provider],
    ['LICENCE', properties.licence],
    ['DATA WINDOW', properties.windowLabel || record.payload?.windowLabel],
    ['AS OF', properties.asOfDate || record.payload?.asOfDate || record.payload?.latestSourceTimestamp],
    ['STABLE RECORD ID', record.featureId]
  ].filter(([, value]) => text(value));
  const limitations = [
    record.payload?.limitation,
    properties.note,
    properties.fingerprintNote,
    properties.rightsNote
  ].map(text).filter((value, index, all) => value && all.indexOf(value) === index);
  return {
    objectType: record.layerId === 'recent-crime'
      ? 'RECENT CRIME'
      : text(record.meta?.title || record.layerId)?.toUpperCase(),
    category,
    status,
    summary: [
      date ? `DATE ${date}` : null,
      shift ? `SHIFT ${shift}` : null,
      pdq ? `PDQ ${pdq}` : null
    ].filter(Boolean).join(' · '),
    rows,
    limitations
  };
}

export function renderOpsFeatureInspector(record) {
  const model = buildOpsInspectorModel(record);
  const rows = model.rows.map(([label, value]) => (
    `<div class="iqai-v2-ops-object__row"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`
  )).join('');
  const limitations = model.limitations.length
    ? `
      <section class="iqai-v2-ops-object__limitations">
        <h4>Important source limitations</h4>
        ${model.limitations.map((limitation) => `<p>${escapeHtml(limitation)}</p>`).join('')}
      </section>
    `
    : '';
  return `
    <article class="iqai-v2-ops-object" data-iqai-ops-inspector="true">
      <header class="iqai-v2-ops-object__header">
        <p class="iqai-v2-ops-object__type">${escapeHtml(model.objectType)}</p>
        <h3>${escapeHtml(model.category)}</h3>
        <div class="iqai-v2-ops-object__summary">
          ${model.status ? `<span class="iqai-v2-ops-object__status">${escapeHtml(model.status)}</span>` : ''}
          ${model.summary ? `<span>${escapeHtml(model.summary)}</span>` : ''}
        </div>
      </header>
      <section class="iqai-v2-ops-object__details">
        <h4>Source information</h4>
        ${rows}
      </section>
      ${limitations}
    </article>
  `;
}

function hitRecord(result) {
  const attributes = result?.graphic?.attributes || {};
  if (attributes[OPS_HIT_ATTRIBUTE] !== true) return null;
  const layerId = text(attributes[OPS_LAYER_ATTRIBUTE]);
  const featureId = text(attributes[OPS_FEATURE_ATTRIBUTE]);
  if (!layerId || !featureId) return null;
  return {
    layerId,
    featureId,
    sourceLayerId: result?.graphic?.layer?.id || result?.layer?.id || null,
    attributes
  };
}

export function bindOpsSelection(root, options = {}) {
  let watchedView = null;
  let clickHandle = null;
  let selected = null;
  let lastHit = null;
  let clickRevision = 0;

  async function clearSelection() {
    if (!selected) return false;
    selected = null;
    clearSelectedOpsFeature();
    options.chassis?.setAcquiredInspect?.(null);
    await options.chassis?.executeChassis?.('selection.set', {
      objectRefs: [],
      sourceView: 'MAP',
      sourceAction: OPS_CLEAR_ACTION
    });
    return true;
  }

  async function selectHit(hit) {
    const record = getOpsFeatureRecord(hit.layerId, hit.featureId);
    if (!record) return false;
    const objectRef = createOpsObjectRef(record);
    const key = objectRefKey(objectRef);
    const inspector = buildOpsInspectorModel(record);
    setSelectedOpsFeature(record.layerId, record.featureId);
    selected = { record, objectRef, key };
    options.chassis?.setAcquiredInspect?.({
      id: objectRef.id,
      key,
      body: [
        inspector.objectType,
        inspector.category,
        inspector.status ? `STATUS: ${inspector.status}` : null,
        inspector.summary || null,
        ...inspector.rows.map(([label, value]) => `${label}: ${value}`),
        ...inspector.limitations.map((limitation) => `LIMITATION: ${limitation}`)
      ].filter(Boolean).join('\n'),
      html: renderOpsFeatureInspector(record),
      rawCollapsed: true
    });
    await options.chassis?.executeChassis?.('selection.set', {
      objectRefs: [objectRef],
      primaryObjectRefId: key,
      sourceView: 'MAP',
      sourceAction: OPS_SELECT_ACTION
    });
    return true;
  }

  async function onMapClick(event) {
    if (options.isInteractionReserved?.() === true) return;
    const revision = ++clickRevision;
    const view = watchedView;
    const hitLayer = getOpsGraphicsLayer();
    if (!view || !hitLayer || typeof view.hitTest !== 'function') return;
    const cluster = getOpsClusterAt(event);
    if (cluster) {
      await view.goTo({
        center: event.mapPoint,
        zoom: Math.max(Number(view.zoom) + 1, Number(cluster.disableAt) || Number(view.zoom) + 1)
      }, { duration: 650 });
      return;
    }
    let response;
    try {
      response = await view.hitTest(event, { include: [hitLayer] });
    } catch {
      return;
    }
    if (revision !== clickRevision) return;
    const hit = (response?.results || []).map(hitRecord).find(Boolean) || null;
    lastHit = {
      resultCount: response?.results?.length || 0,
      matched: Boolean(hit),
      layerId: hit?.layerId || null,
      featureId: hit?.featureId || null,
      sourceLayerId: hit?.sourceLayerId || null,
      attributes: hit?.attributes || null
    };
    if (hit) await selectHit(hit);
    else await clearSelection();
  }

  function attachView(view) {
    if (!view || watchedView === view) return Boolean(view);
    try { clickHandle?.remove?.(); } catch { /* ignore */ }
    watchedView = view;
    clickHandle = typeof view.on === 'function' ? view.on('click', onMapClick) : null;
    return Boolean(clickHandle);
  }

  const unsubscribe = subscribeMapFoundation((snapshot) => {
    if (snapshot.state === 'READY') attachView(getMapView());
  });
  attachView(getMapView());

  return Object.freeze({
    attachView,
    clear: clearSelection,
    snapshot() {
      return {
        attached: Boolean(clickHandle),
        selectedLayerId: selected?.record?.layerId || null,
        selectedFeatureId: selected?.record?.featureId || null,
        selectedObjectRef: selected?.objectRef || null,
        lastHit
      };
    },
    destroy() {
      try { clickHandle?.remove?.(); } catch { /* ignore */ }
      unsubscribe?.();
      clickHandle = null;
      watchedView = null;
    }
  });
}
