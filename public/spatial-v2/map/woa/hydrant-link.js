/**
 * Linked hydrant Object V1 — one ObjectRef painted across MAP / imagery / 3D / Street.
 * Does not mint coordinates. Does not construct MapView.
 * MAP click / linked apply must not wait on Google 3D or Street.
 */

import { highlightGovernedHydrant } from '../governed-map-overlay.js';
import {
  setHistoryPainterClickListener,
  setHistoryPainterSelectedId
} from '../../imagery/historical/history-painter.js';
import {
  setGoogleMapsJs3dHydrantClickListener
} from '../google-maps-js-3d.js';
import {
  setGoogleStreetViewHydrantClickListener
} from '../google-street-view.js';
import { getHydrantRecord } from './hydrant-object.js';
import { hydrantTrace } from './hydrant-trace.js';

function schedule(task) {
  if (typeof setTimeout === 'function') {
    setTimeout(task, 0);
    return;
  }
  task();
}

export function bindHydrantLink(options = {}) {
  let current = null;
  let lastStreetAim = null;
  let last3d = null;

  async function selectFromId(sourceId, sourceView) {
    if (!sourceId) return false;
    return options.selection?.selectById?.(sourceId, sourceView);
  }

  setHistoryPainterClickListener((hit) => {
    void selectFromId(hit?.sourceId, 'IMAGERY');
  });
  setGoogleMapsJs3dHydrantClickListener((record) => {
    void selectFromId(record?.idBi || record?.sourceId, '3D VISUAL');
  });
  setGoogleStreetViewHydrantClickListener((record) => {
    void selectFromId(record?.idBi || record?.sourceId, 'STREET 360');
  });

  async function followGoogle3d(record, fly3d) {
    hydrantTrace('apply.google3d.start', { idBi: record?.idBi || null });
    last3d = await options.google3d?.lookAtHydrant?.(record, { fly: fly3d }).catch((error) => {
      hydrantTrace('apply.google3d.error', { message: String(error?.message || error) });
      return { available: false, message: String(error?.message || error) };
    });
    hydrantTrace('apply.google3d.end', { available: last3d != null && last3d.available !== false });
    return last3d;
  }

  async function followStreet(record) {
    hydrantTrace('apply.street.start', { idBi: record?.idBi || null });
    lastStreetAim = await options.street360?.lookAtHydrant?.(record).catch((error) => {
      hydrantTrace('apply.street.error', { message: String(error?.message || error) });
      return {
        available: false,
        message: String(error?.message || error),
        physicalVisibility: 'NOT CONFIRMED'
      };
    });
    hydrantTrace('apply.street.end', { available: lastStreetAim?.available === true });
    return lastStreetAim;
  }

  async function followSpecialistPanes(record, { views, fly3d } = {}) {
    const streetOpen = options.street360?.snapshot?.()?.open === true;
    if (views !== 'street') {
      await followGoogle3d(record, fly3d !== false);
    }
    if (streetOpen || views === 'street' || views === 'all') {
      await followStreet(record);
    }
  }

  async function apply(record, { views = 'linked', fly3d = true } = {}) {
    hydrantTrace('apply.start', { views, idBi: record?.idBi || null });
    await Promise.resolve();
    current = record || null;
    const idBi = record?.idBi || null;
    try {
      hydrantTrace('apply.highlight.start', { idBi });
      highlightGovernedHydrant(idBi);
      hydrantTrace('apply.highlight.end');
    } catch (error) {
      hydrantTrace('apply.highlight.error', { message: String(error?.message || error) });
    }
    try {
      hydrantTrace('apply.imagery.start', { idBi });
      setHistoryPainterSelectedId(idBi);
      options.imageryCommand?.overlayHydrantMarks?.();
      hydrantTrace('apply.imagery.end');
    } catch (error) {
      hydrantTrace('apply.imagery.error', { message: String(error?.message || error) });
    }
    if (!record) {
      lastStreetAim = null;
      last3d = null;
      if (views === 'linked') {
        schedule(() => {
          void followGoogle3d(null, false).catch((error) => {
            hydrantTrace('apply.google3d.error', { message: String(error?.message || error) });
          });
        });
      } else if (views !== 'street') {
        await followGoogle3d(null, false);
      }
      hydrantTrace('apply.end', { cleared: true });
      return { record: null, street: null, visual3d: null };
    }
    if (views === 'linked') {
      schedule(() => {
        void followSpecialistPanes(record, { views, fly3d }).catch((error) => {
          hydrantTrace('apply.panes.error', { message: String(error?.message || error) });
        });
      });
      hydrantTrace('apply.end', { deferredPanes: true, idBi });
      return {
        record,
        objectRef: record.objectRef,
        street: lastStreetAim,
        visual3d: last3d,
        deferredPanes: true
      };
    }
    await followSpecialistPanes(record, { views, fly3d });
    hydrantTrace('apply.end', { deferredPanes: false, idBi });
    return {
      record,
      objectRef: record.objectRef,
      street: lastStreetAim,
      visual3d: last3d,
      deferredPanes: false
    };
  }

  async function showInStreet(record) {
    if (options.worldViewFrame?.snapshot?.()?.layout === 1) {
      await options.worldViewFrame?.openSupporting?.('STREET 360');
    }
    return apply(record, { views: 'street', fly3d: false });
  }

  async function showInAllViews(record) {
    await options.worldViewFrame?.setLayout?.(4);
    await options.imageryCommand?.openWorldviewImagery?.({ library: false }).catch(() => {});
    return apply(record, { views: 'all', fly3d: true });
  }

  return Object.freeze({
    apply,
    showInStreet,
    showInAllViews,
    current: () => current || options.selection?.snapshot?.()?.selectedRecord || getHydrantRecord(current?.idBi),
    streetAim: () => lastStreetAim,
    visual3d: () => last3d,
    snapshot() {
      return {
        selectedId: current?.idBi || null,
        objectRef: current?.objectRef || null,
        street: lastStreetAim,
        visual3d: last3d
      };
    }
  });
}
