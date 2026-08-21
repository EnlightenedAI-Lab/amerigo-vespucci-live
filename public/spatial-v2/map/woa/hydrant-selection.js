/**
 * MAP hydrant hitTest → chassis selection.set.
 * Does not construct MapView. Identity comes from municipal ID_BI.
 * Record resolution uses authoritative WOA/index truth, not an incidental warm cache.
 * Presentation adapters are scheduled after SelectionSet commits.
 */

import { getActiveSpatialFocus } from '../spatial-focus.js';
import { getMapView, subscribeMapFoundation } from '../map-foundation.js';
import { hitTestGovernedHydrant, highlightGovernedHydrant } from '../governed-map-overlay.js';
import {
  HYDRANT_CLEAR_ACTION,
  HYDRANT_SELECT_ACTION,
  getHydrantRecord,
  hydrantInspectorBody,
  hydrantUnresolvedInspector,
  rememberHydrantHits,
  renderHydrantInspector,
  resolveHydrantRecord
} from './hydrant-object.js';
import { hydrantTrace } from './hydrant-trace.js';

function schedulePresentation(run) {
  if (typeof setTimeout === 'function') {
    setTimeout(run, 0);
    return;
  }
  run();
}

export function bindHydrantSelection(options = {}) {
  let watchedView = null;
  let clickHandle = null;
  let lastHit = null;
  let clickRevision = 0;
  let selectedId = null;

  const hitTest = options.hitTest || hitTestGovernedHydrant;

  function resolveOptions() {
    return {
      collection: options.collection,
      fetchImpl: options.fetchImpl
    };
  }

  function surfaceUnresolved(hit, error) {
    if (error?.code !== 'HYDRANT_RECORD_NOT_RESOLVED') throw error;
    const idBi = hit?.sourceId || hit?.idBi || null;
    lastHit = { ...(hit || {}), sourceId: idBi, error: error.code };
    hydrantTrace('HYDRANT_RECORD_NOT_RESOLVED', { idBi });
    const inspect = hydrantUnresolvedInspector(idBi, error);
    options.chassis?.setAcquiredInspect?.({
      id: idBi,
      body: inspect.body,
      html: inspect.html,
      rawCollapsed: true
    });
    options.onUnresolved?.(error, lastHit);
    return false;
  }

  function presentRecord(record) {
    hydrantTrace('presentation.start', { idBi: record?.idBi || null });
    try {
      hydrantTrace('highlight.start', { idBi: record?.idBi || null });
      highlightGovernedHydrant(record?.idBi || null);
      hydrantTrace('highlight.end', { idBi: record?.idBi || null });
    } catch (error) {
      hydrantTrace('highlight.error', { message: String(error?.message || error) });
    }
    try {
      options.onSelection?.(record);
    } catch (error) {
      hydrantTrace('onSelection.error', { message: String(error?.message || error) });
    }
    hydrantTrace('presentation.end', { idBi: record?.idBi || null });
  }

  async function commitSelection(record, sourceView = 'MAP') {
    if (!record) {
      selectedId = null;
      options.chassis?.setAcquiredInspect?.(null);
      await options.chassis?.executeChassis?.('selection.set', {
        objectRefs: [],
        sourceView,
        sourceAction: HYDRANT_CLEAR_ACTION
      });
      schedulePresentation(() => presentRecord(null));
      return false;
    }
    hydrantTrace('commit.start', { idBi: record.idBi, sourceView });
    selectedId = record.idBi;
    const focus = getActiveSpatialFocus();
    hydrantTrace('inspector.set', { idBi: record.idBi });
    options.chassis?.setAcquiredInspect?.({
      id: record.idBi,
      key: record.objectRefKey,
      body: hydrantInspectorBody(record, focus),
      html: renderHydrantInspector(record, focus),
      rawCollapsed: true
    });
    hydrantTrace('selection.set.start', { idBi: record.idBi });
    await options.chassis?.executeChassis?.('selection.set', {
      objectRefs: [record.objectRef],
      primaryObjectRefId: record.objectRefKey,
      sourceView,
      sourceAction: HYDRANT_SELECT_ACTION
    });
    hydrantTrace('selection.set.done', { idBi: record.idBi });
    schedulePresentation(() => presentRecord(record));
    return true;
  }

  async function handleHit(hit, sourceView = 'MAP') {
    hydrantTrace('handleHit.start', { sourceId: hit?.sourceId || hit?.idBi || null, sourceView });
    lastHit = hit || null;
    if (!hit?.sourceId && !hit?.idBi) {
      hydrantTrace('handleHit.empty');
      return false;
    }
    try {
      const record = await resolveHydrantRecord(hit.sourceId || hit.idBi, resolveOptions());
      hydrantTrace('record.resolved', {
        idBi: record.idBi,
        address: record.address || null,
        objectRefKey: record.objectRefKey
      });
      const committed = await commitSelection(record, sourceView);
      hydrantTrace('handleHit.end', { committed, idBi: record.idBi });
      return committed;
    } catch (error) {
      hydrantTrace('handleHit.error', { code: error?.code || null, message: String(error?.message || error) });
      return surfaceUnresolved(hit, error);
    }
  }

  async function selectById(idBi, sourceView = 'MAP') {
    return handleHit({ sourceId: idBi, idBi }, sourceView);
  }

  async function onMapClick(event) {
    if (options.isInteractionReserved?.() === true) return;
    const revision = ++clickRevision;
    const view = watchedView;
    if (!view) return;
    hydrantTrace('map.click');
    const hit = await hitTest(view, event);
    if (revision !== clickRevision) return;
    lastHit = hit;
    if (!hit) {
      hydrantTrace('map.click.miss');
      return;
    }
    hydrantTrace('map.hittest', { sourceId: hit.sourceId || null });
    await handleHit(hit, 'MAP');
  }

  function attachView(view) {
    if (!view) return false;
    if (watchedView === view && clickHandle) return true;
    try { clickHandle?.remove?.(); } catch { /* ignore */ }
    watchedView = view;
    clickHandle = typeof view.on === 'function' ? view.on('click', onMapClick) : null;
    hydrantTrace('attachView', { attached: Boolean(clickHandle) });
    return Boolean(clickHandle);
  }

  const unsubscribe = subscribeMapFoundation((snapshot) => {
    if (snapshot.state === 'READY') attachView(getMapView());
  });
  attachView(getMapView());

  return Object.freeze({
    attachView,
    rememberHits: rememberHydrantHits,
    handleHit,
    selectById,
    clear: () => commitSelection(null),
    snapshot() {
      return {
        attached: Boolean(clickHandle),
        selectedId,
        lastHit,
        viewPresent: Boolean(watchedView),
        viewOn: typeof watchedView?.on,
        selectedRecord: selectedId ? getHydrantRecord(selectedId) : null
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
