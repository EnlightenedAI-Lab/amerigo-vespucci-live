/**
 * ViewHost owns adapter lifecycle, hide/show, and continuity handoff.
 * It never constructs MapView or specialist engines.
 * World State remains the sole canonical view-identity authority.
 */

import { MIGRATION_STATE, isCapabilityExecutable } from '../foundation/contracts/capability.js';
import { VIEW_AVAILABILITY } from '../foundation/contracts/view-descriptor.js';
import { VIEW_LIFECYCLE } from '../foundation/contracts/world-state.js';
import { failClosed } from '../foundation/contracts/validate.js';

function isViewAdapterExecutable(descriptor) {
  if (
    descriptor.availability === VIEW_AVAILABILITY.UNMIGRATED
    || descriptor.availability === VIEW_AVAILABILITY.UNAVAILABLE
  ) {
    return false;
  }
  if (
    descriptor.migrationState === MIGRATION_STATE.UNMIGRATED
    || descriptor.migrationState === MIGRATION_STATE.UNAVAILABLE
    || descriptor.migrationState === MIGRATION_STATE.NOT_CONNECTED
  ) {
    return false;
  }
  return isCapabilityExecutable(descriptor.migrationState);
}

export function createViewHost({ viewRegistry }) {
  const lifecycleByView = new Map();

  function project(viewId, world) {
    const canonicalId = world?.views?.activeViewIds?.[0] || viewId;
    const descriptor = viewRegistry.require(canonicalId);
    return Object.freeze({
      viewId: canonicalId,
      lifecycle: descriptor.lifecycle,
      availability: descriptor.availability,
      migrationState: descriptor.migrationState,
      adapterMounted: lifecycleByView.get(canonicalId)?.mounted === true,
      reason: descriptor.unavailableReason,
      canonical: true
    });
  }

  function requireExecutable(viewId) {
    const descriptor = viewRegistry.require(viewId);
    if (!isViewAdapterExecutable(descriptor)) {
      failClosed('VIEW_ADAPTER_NOT_EXECUTABLE', 'UNMIGRATED, UNAVAILABLE, and NOT CONNECTED view adapters cannot mount or execute.', {
        viewId,
        availability: descriptor.availability,
        migrationState: descriptor.migrationState
      });
    }
    return descriptor;
  }

  function invoke(viewId, method) {
    const adapter = viewRegistry.getAdapter(viewId);
    if (!adapter || typeof adapter[method] !== 'function') {
      failClosed('UNKNOWN_ADAPTER', `View adapter does not expose ${method}().`, { viewId, method });
    }
    adapter[method]();
  }

  return Object.freeze({
    project,
    requestView(viewId, world) {
      return project(viewId, world);
    },
    getActiveViewId(world) {
      if (!world?.views?.activeViewIds?.length) {
        failClosed('HOST_HAS_NO_CANONICAL_VIEW', 'ViewHost cannot answer view identity without World State.');
      }
      return world.views.activeViewIds[0];
    },
    mount(viewId) {
      const descriptor = requireExecutable(viewId);
      const state = lifecycleByView.get(viewId) || { mounted: false, shown: false, instance: null };
      if (state.mounted) {
        failClosed('DUPLICATE_LIFECYCLE_TRANSITION', 'View lifecycle mount may occur only once.', {
          viewId,
          lifecycle: descriptor.lifecycle
        });
      }
      const adapter = viewRegistry.getAdapter(viewId);
      if (!adapter || typeof adapter.mount !== 'function') {
        failClosed('UNKNOWN_ADAPTER', 'View adapter does not expose mount().', { viewId });
      }
      const instance = adapter.mount() || Object.freeze({ viewId, retained: true });
      lifecycleByView.set(viewId, { mounted: true, shown: true, instance });
      return Object.freeze({
        viewId,
        lifecycle: descriptor.lifecycle,
        mounted: true,
        instance
      });
    },
    hide(viewId) {
      const descriptor = requireExecutable(viewId);
      const state = lifecycleByView.get(viewId);
      if (!state?.mounted) {
        failClosed('VIEW_NOT_MOUNTED', 'Cannot hide a view that is not mounted.', { viewId });
      }
      const adapter = viewRegistry.getAdapter(viewId);
      if (adapter && typeof adapter.hide === 'function') {
        adapter.hide();
      }
      lifecycleByView.set(viewId, { ...state, shown: false, instance: state.instance });
      return Object.freeze({
        viewId,
        lifecycle: descriptor.lifecycle,
        mounted: true,
        shown: false,
        instance: state.instance
      });
    },
    show(viewId) {
      const descriptor = requireExecutable(viewId);
      const state = lifecycleByView.get(viewId) || { mounted: false, shown: false, instance: null };
      if (descriptor.lifecycle === VIEW_LIFECYCLE.MOUNT_ONCE) {
        if (!state.mounted) {
          failClosed('VIEW_NOT_MOUNTED', 'MOUNT_ONCE views must mount once before show/reactivate.', { viewId });
        }
      } else if (!state.mounted) {
        const adapter = viewRegistry.getAdapter(viewId);
        if (!adapter || typeof adapter.show !== 'function') {
          failClosed('UNKNOWN_ADAPTER', 'View adapter does not expose show().', { viewId });
        }
        adapter.show();
        const instance = state.instance || Object.freeze({ viewId, retained: true });
        lifecycleByView.set(viewId, { mounted: true, shown: true, instance });
        return Object.freeze({ viewId, shown: true, instance });
      }
      invoke(viewId, 'show');
      lifecycleByView.set(viewId, { ...state, mounted: true, shown: true, instance: state.instance });
      return Object.freeze({
        viewId,
        shown: true,
        instance: state.instance
      });
    },
    getMountedInstance(viewId) {
      return lifecycleByView.get(viewId)?.instance || null;
    },
    snapshot(world) {
      return Object.freeze({
        activeViewId: world?.views?.activeViewIds?.[0] || null,
        views: viewRegistry.list().map((view) => ({
          viewId: view.viewId,
          availability: view.availability,
          migrationState: view.migrationState,
          adapterMounted: lifecycleByView.get(view.viewId)?.mounted === true
        }))
      });
    }
  });
}

export function renderMapStageHost() {
  return `
    <main id="iqai-v2-map-stage" class="iqai-v2-stage" data-iqai-slot="map-stage" aria-label="Spatial stage">
      <div class="iqai-v2-stage__well" data-iqai-reserve="map" data-iqai-map-state="UNMIGRATED" data-iqai-view-host>
        <div class="iqai-v2-map-host" data-iqai-map-host data-iqai-view-anchor="MAP"></div>
        <div class="iqai-v2-street-360-stage" data-iqai-view-anchor="STREET 360" hidden></div>
        <div class="iqai-v2-google-3d-stage" data-iqai-view-anchor="3D VISUAL" hidden></div>
        <div class="iqai-v2-analyze-3d-stage" data-iqai-view-anchor="3D ANALYZE" hidden></div>
        <div class="iqai-v2-stage__placeholder" data-iqai-map-placeholder>
          <p class="iqai-v2-stage__kicker">IQAI SPATIAL V2 · PLATFORM CHASSIS</p>
          <h1 class="iqai-v2-stage__title" data-iqai-stage-title>MAP</h1>
          <p class="iqai-v2-stage__state" data-iqai-stage-state>UNMIGRATED</p>
          <p class="iqai-v2-stage__note" data-iqai-stage-note>
            The persistent MapView remains at the proven baseline. This wave does not create a MapView.
            ViewHost is registered. Specialist adapters are not mounted.
          </p>
        </div>
        <div class="iqai-v2-view-switcher" data-iqai-view-switcher data-iqai-tool-host="views">
          <span>VIEW</span>
          <button type="button" data-iqai-view="MAP" data-iqai-capability-dispatch="view.select" aria-pressed="true">MAP</button>
          <button type="button" data-iqai-view="STREET 360" data-iqai-capability-dispatch="view.select" aria-pressed="false">STREET 360</button>
          <button type="button" data-iqai-view="3D VISUAL" data-iqai-capability-dispatch="view.select" aria-pressed="false">3D VISUAL</button>
          <button type="button" data-iqai-view="3D ANALYZE" data-iqai-capability-dispatch="view.select" aria-pressed="false">3D ANALYZE</button>
        </div>
        <p class="iqai-v2-view-notice" data-iqai-view-notice>MAP · REGISTERED · UNMIGRATED · NO MAPVIEW THIS WAVE</p>
      </div>
    </main>
  `;
}

export function paintMapStageHost(root, { activeViewId, view }) {
  const well = root.querySelector('[data-iqai-view-host]');
  const title = root.querySelector('[data-iqai-stage-title]');
  const state = root.querySelector('[data-iqai-stage-state]');
  const note = root.querySelector('[data-iqai-stage-note]');
  const notice = root.querySelector('[data-iqai-view-notice]');
  if (well) {
    well.dataset.iqaiActiveView = activeViewId;
    well.dataset.iqaiMapState = view?.migrationState || 'UNMIGRATED';
  }
  if (title) title.textContent = activeViewId;
  if (state) state.textContent = view?.migrationState || 'UNMIGRATED';
  if (note && view?.reason) note.textContent = view.reason;
  if (notice) {
    notice.hidden = false;
    notice.textContent = `${activeViewId} · ${view?.availability || 'REGISTERED'} · ${view?.migrationState || 'UNMIGRATED'} · ADAPTER NOT MOUNTED`;
  }
  root.querySelectorAll('[data-iqai-view]').forEach((button) => {
    const selected = button.getAttribute('data-iqai-view') === activeViewId;
    button.setAttribute('aria-pressed', selected ? 'true' : 'false');
  });
  root.querySelectorAll('[data-iqai-view-anchor]').forEach((anchor) => {
    anchor.hidden = anchor.getAttribute('data-iqai-view-anchor') !== activeViewId;
  });
}
