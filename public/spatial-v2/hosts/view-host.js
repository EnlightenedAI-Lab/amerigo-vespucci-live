/**
 * ViewHost owns adapter lifecycle, hide/show, and continuity handoff.
 * It never constructs MapView or specialist engines.
 * World State remains the sole canonical view-identity authority.
 * STREET 360 and 3D VISUAL are migrated specialist stages. 3D ANALYZE remains UNAVAILABLE.
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
      <div class="iqai-v2-stage__well" data-iqai-reserve="map" data-iqai-map-state="INITIALIZING" data-iqai-view-host>
        <div class="iqai-v2-worldview-frame" data-iqai-worldview-frame>
          <section class="iqai-v2-pane is-primary" data-iqai-pane="MAP">
            <header class="iqai-v2-pane__chrome">
              <span class="iqai-v2-pane__type">MAP</span>
              <span class="iqai-v2-pane__truth" data-iqai-pane-truth="MAP"></span>
              <span class="iqai-v2-pane__sync" data-iqai-pane-sync="MAP">FOCUS</span>
              <button type="button" data-iqai-pane-maximize="MAP">MAX</button>
              <button type="button" data-iqai-pane-restore="MAP" hidden>RESTORE</button>
            </header>
            <div class="iqai-v2-pane__body">
              <div class="iqai-v2-map-host" data-iqai-map-host data-iqai-view-anchor="MAP"></div>
            </div>
          </section>
          <section class="iqai-v2-pane" data-iqai-pane="3D VISUAL" hidden>
            <header class="iqai-v2-pane__chrome">
              <span class="iqai-v2-pane__type">3D</span>
              <span class="iqai-v2-pane__truth" data-iqai-pane-truth="3D VISUAL"></span>
              <span class="iqai-v2-pane__sync" data-iqai-pane-sync="3D VISUAL">FOCUS</span>
              <button type="button" data-iqai-pane-maximize="3D VISUAL">MAX</button>
              <button type="button" data-iqai-pane-restore="3D VISUAL" hidden>RESTORE</button>
              <button type="button" data-iqai-pane-change="3D VISUAL">CHANGE</button>
              <button type="button" data-iqai-pane-close="3D VISUAL">CLOSE</button>
            </header>
            <div class="iqai-v2-pane__body">
              <div class="iqai-v2-google-3d-stage" data-iqai-google-3d-stage data-iqai-view-anchor="3D VISUAL" hidden></div>
              <div class="iqai-v2-google-3d-controls" data-iqai-google-3d-controls hidden>
                <div class="iqai-v2-google-3d-nav" data-iqai-google-3d-nav hidden>
                  <button type="button" data-iqai-google-3d-nav-action="tilt-minus">TILT −</button>
                  <button type="button" data-iqai-google-3d-nav-action="tilt-plus">TILT +</button>
                  <button type="button" data-iqai-google-3d-nav-action="rotate-left">ROTATE L</button>
                  <button type="button" data-iqai-google-3d-nav-action="rotate-right">ROTATE R</button>
                  <button type="button" data-iqai-google-3d-nav-action="top">TOP</button>
                  <button type="button" data-iqai-google-3d-nav-action="oblique">OBLIQUE</button>
                  <button type="button" data-iqai-google-3d-nav-action="reset">RESET</button>
                </div>
              </div>
            </div>
          </section>
          <section class="iqai-v2-pane" data-iqai-pane="STREET 360" hidden>
            <header class="iqai-v2-pane__chrome">
              <span class="iqai-v2-pane__type">STREET 360</span>
              <span class="iqai-v2-pane__truth" data-iqai-pane-truth="STREET 360"></span>
              <span class="iqai-v2-pane__sync" data-iqai-pane-sync="STREET 360">FOCUS</span>
              <button type="button" data-iqai-pane-maximize="STREET 360">MAX</button>
              <button type="button" data-iqai-pane-restore="STREET 360" hidden>RESTORE</button>
              <button type="button" data-iqai-pane-change="STREET 360">CHANGE</button>
              <button type="button" data-iqai-pane-close="STREET 360">CLOSE</button>
            </header>
            <div class="iqai-v2-pane__body">
              <div class="iqai-v2-street-360-stage" data-iqai-street-360-stage data-iqai-view-anchor="STREET 360" hidden></div>
            </div>
          </section>
          <section class="iqai-v2-pane" data-iqai-pane="IMAGERY" hidden>
            <header class="iqai-v2-pane__chrome">
              <span class="iqai-v2-pane__type">IMAGERY</span>
              <span class="iqai-v2-pane__truth" data-iqai-pane-truth="IMAGERY">NOT CONNECTED</span>
              <span class="iqai-v2-pane__sync" data-iqai-pane-sync="IMAGERY">TIME OFF</span>
              <button type="button" data-iqai-pane-maximize="IMAGERY">MAX</button>
              <button type="button" data-iqai-pane-restore="IMAGERY" hidden>RESTORE</button>
              <button type="button" data-iqai-pane-close="IMAGERY">CLOSE</button>
            </header>
            <div class="iqai-v2-pane__body">
              <div class="iqai-v2-pane__unavailable" data-iqai-imagery-seam>
                <p>IMAGERY</p>
                <p>NOT CONNECTED / NOT MIGRATED</p>
                <p>Wayback, Nearmap, and local imagery are registered seams only. No dates are invented.</p>
              </div>
            </div>
          </section>
        </div>
        <div class="iqai-v2-analyze-3d-stage" data-iqai-view-anchor="3D ANALYZE" hidden></div>
        <div class="iqai-v2-second-view" data-iqai-second-view hidden></div>
        <div class="iqai-v2-stage__placeholder" data-iqai-map-placeholder>
          <p class="iqai-v2-stage__kicker">MAP</p>
          <h1 class="iqai-v2-stage__title" data-iqai-stage-title>Loading map</h1>
          <p class="iqai-v2-stage__state" data-iqai-stage-state>INITIALIZING</p>
          <p class="iqai-v2-stage__note" data-iqai-stage-note>Loading the authored operational WebMap. The shell stays available if the map cannot load.</p>
        </div>
        <div class="iqai-v2-stage__error" data-iqai-map-error hidden>
          <p class="iqai-v2-stage__kicker">MAP</p>
          <h1 class="iqai-v2-stage__title">Map failed</h1>
          <p class="iqai-v2-stage__state">ERROR</p>
          <p class="iqai-v2-stage__note" data-iqai-map-error-message></p>
        </div>
        <div class="iqai-v2-map-tools" data-iqai-map-tools hidden>
          <div class="iqai-v2-map-nav" data-iqai-map-nav></div>
          <button type="button" class="iqai-v2-focus-tool" data-iqai-drop-pin aria-pressed="false" title="Arm Focus">FOCUS</button>
          <button type="button" class="iqai-v2-trace-tool" data-iqai-add-set title="Add acquired object to collected set">ADD TO SET</button>
          <button type="button" class="iqai-v2-trace-tool" data-iqai-export-csv title="Export collected set CSV">EXPORT CSV</button>
          <button type="button" class="iqai-v2-trace-tool" data-iqai-clear-trace title="Clear Street 360 drive trace">CLEAR TRACE</button>
        </div>
        <div class="iqai-v2-view-switcher" data-iqai-view-switcher>
          <button type="button" data-iqai-view="MAP" aria-pressed="true">MAP</button>
          <button type="button" data-iqai-view="3D VISUAL" aria-pressed="false">3D</button>
          <button type="button" data-iqai-view="STREET 360" aria-pressed="false">STREET 360</button>
        </div>
        <div class="iqai-v2-layout-switcher" data-iqai-layout-switcher aria-label="WorldView layout">
          <button type="button" data-iqai-layout="1" aria-pressed="true">1</button>
          <button type="button" data-iqai-layout="2" aria-pressed="false">2</button>
          <button type="button" data-iqai-layout="3" aria-pressed="false">3</button>
          <button type="button" data-iqai-layout="4" aria-pressed="false">4</button>
        </div>
        <p class="iqai-v2-visually-hidden">DROP PIN SECOND VIEW STREET 360 3D VISUAL 3D ANALYZE UNMIGRATED NOT MIGRATED DUAL MAP</p>
        <span data-iqai-street-360-date hidden></span>
        <aside class="iqai-v2-precision-cursor" data-iqai-precision-cursor hidden data-iqai-precision-expanded="false">
          <p class="iqai-v2-precision-cursor__scale" data-iqai-map-scale hidden></p>
          <button type="button" class="iqai-v2-precision-cursor__live" data-iqai-precision-toggle aria-expanded="false" title="Expand coordinate formats">
            <span data-iqai-cursor-live></span>
          </button>
          <div class="iqai-v2-precision-cursor__detail" data-iqai-precision-detail hidden>
            <p data-iqai-cursor-dd></p>
            <p data-iqai-cursor-dms></p>
            <p data-iqai-cursor-utm></p>
            <p data-iqai-cursor-mgrs></p>
            <p data-iqai-cursor-elev hidden></p>
            <p data-iqai-cursor-crs>EPSG:4326</p>
          </div>
          <p class="iqai-v2-place-chip" data-iqai-cursor-place hidden></p>
        </aside>
        <p class="iqai-v2-pointer-coords" data-iqai-pointer-coords hidden></p>
        <div class="iqai-v2-spatial-focus-receipt" data-iqai-spatial-focus-receipt hidden></div>
        <p class="iqai-v2-view-notice" data-iqai-view-notice hidden></p>
      </div>
    </main>
  `;
}

export function paintMapStageHost(root, { activeViewId, view, mapState } = {}) {
  const well = root.querySelector('[data-iqai-view-host]');
  const placeholder = root.querySelector('[data-iqai-map-placeholder]');
  const errorPanel = root.querySelector('[data-iqai-map-error]');
  const nav = root.querySelector('[data-iqai-map-nav]');
  const tools = root.querySelector('[data-iqai-map-tools]');
  const resolvedMapState = mapState || (view?.migrationState === 'MIGRATED' ? 'INITIALIZING' : view?.migrationState);
  if (well) {
    well.dataset.iqaiActiveView = activeViewId;
    well.dataset.iqaiMapState = resolvedMapState || 'INITIALIZING';
    well.classList.toggle('is-map-ready', resolvedMapState === 'READY');
    well.classList.toggle('is-map-error', resolvedMapState === 'ERROR');
  }
  if (placeholder) placeholder.hidden = resolvedMapState !== 'INITIALIZING';
  if (errorPanel) errorPanel.hidden = resolvedMapState !== 'ERROR';
  if (nav) nav.hidden = resolvedMapState !== 'READY';
  if (tools) tools.hidden = resolvedMapState !== 'READY';
}
