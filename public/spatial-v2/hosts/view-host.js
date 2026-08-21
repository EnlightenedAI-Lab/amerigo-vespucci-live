/**
 * ViewHost owns adapter lifecycle, hide/show, and continuity handoff.
 * It never constructs MapView or specialist engines.
 * World State remains the sole canonical view-identity authority.
 * STREET 360, 3D VISUAL, and 3D ANALYZE are migrated specialist stages. Dual Map remains unavailable.
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
              <div class="iqai-v2-history-stage" data-iqai-history-stage hidden aria-label="Historical overhead">
                <div class="iqai-v2-history-bar" data-iqai-history-bar hidden>
                  <p data-iqai-history-now>HISTORY</p>
                  <p data-iqai-history-date hidden>DATE UNKNOWN</p>
                  <button type="button" data-iqai-history-source hidden></button>
                  <p data-iqai-history-resolution hidden></p>
                  <button type="button" data-iqai-history-step="-1">PREV</button>
                  <button type="button" data-iqai-history-step="1">NEXT</button>
                  <button type="button" data-iqai-history-compare aria-pressed="false">COMPARE</button>
                  <button type="button" data-iqai-library-toggle aria-pressed="false">LIBRARY</button>
                  <button type="button" data-iqai-history-remove>REMOVE FROM VIEW</button>
                  <label class="iqai-v2-history-swipe" data-iqai-history-swipe hidden>
                    <input type="range" min="0" max="100" value="50" data-iqai-history-swipe-input>
                  </label>
                  <p data-iqai-history-status hidden></p>
                </div>
                <div class="iqai-v2-history-canvas" data-iqai-history-canvas-host></div>
                <div class="iqai-v2-history-caption" data-iqai-history-caption="a" hidden>
                  <p data-iqai-history-caption-date></p>
                  <p data-iqai-history-caption-source></p>
                  <p data-iqai-history-caption-place></p>
                </div>
                <div class="iqai-v2-history-caption iqai-v2-history-caption--b" data-iqai-history-caption="b" hidden>
                  <p data-iqai-history-caption-date></p>
                  <p data-iqai-history-caption-source></p>
                  <p data-iqai-history-caption-place></p>
                </div>
              </div>
              <aside class="iqai-v2-history-library" data-iqai-history-library hidden>
                <header class="iqai-v2-history-library__chrome">
                  <p>IMAGERY FOR THIS VIEW</p>
                  <button type="button" data-iqai-history-remove hidden>REMOVE FROM VIEW</button>
                  <button type="button" data-iqai-history-library-close>CLOSE</button>
                </header>
                <p class="iqai-v2-history-library__place" data-iqai-history-library-place></p>
                <div class="iqai-v2-history-library__list" data-iqai-history-library-list></div>
                <a class="iqai-v2-history-library__research" data-iqai-history-catalogue href="/temporal-catalog/" target="_blank" rel="noopener">RESEARCH CATALOGUE — LEAVES SPATIAL</a>
              </aside>
            </div>
          </section>
          <div class="iqai-v2-linked-view" data-iqai-linked-view>
            <p class="iqai-v2-linked-view__idle" data-iqai-linked-idle>LINKED VIEW · 3D / STREET 360</p>
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
              <span class="iqai-v2-pane__truth" data-iqai-pane-truth="IMAGERY">NEARMAP / LIBRARY</span>
              <span class="iqai-v2-pane__sync" data-iqai-pane-sync="IMAGERY">FOCUS</span>
              <button type="button" data-iqai-pane-maximize="IMAGERY">MAX</button>
              <button type="button" data-iqai-pane-restore="IMAGERY" hidden>RESTORE</button>
              <button type="button" data-iqai-pane-close="IMAGERY">CLOSE</button>
            </header>
            <div class="iqai-v2-pane__body">
              <div class="iqai-v2-imagery-pane" data-iqai-imagery-pane>
                <div class="iqai-v2-imagery-pane__modes">
                  <button type="button" data-iqai-imagery-pane-source="NEARMAP">NEARMAP</button>
                  <button type="button" data-iqai-imagery-pane-source="LIBRARY">LIBRARY</button>
                </div>
                <div class="iqai-v2-imagery-pane__stage" data-iqai-imagery-pane-stage></div>
              </div>
              <div class="iqai-v2-pane__unavailable" data-iqai-imagery-seam hidden>
                <p>IMAGERY</p>
                <p>NOT CONNECTED / NOT MIGRATED</p>
                <p>Wayback, Nearmap, and local imagery are registered seams only. No dates are invented.</p>
              </div>
            </div>
          </section>
          </div>
        </div>
        <div class="iqai-v2-splitters" data-iqai-splitters hidden>
          <button type="button" class="iqai-v2-split iqai-v2-split--row" data-iqai-split="row" aria-label="Resize map height"></button>
          <button type="button" class="iqai-v2-split iqai-v2-split--col" data-iqai-split="col" aria-label="Resize 3D and Street width"></button>
        </div>
        <div class="iqai-v2-analyze-3d-stage" data-iqai-analyze-3d-stage data-iqai-view-anchor="3D ANALYZE" hidden>
          <div class="iqai-v2-analyze-3d-canvas" data-iqai-analyze-3d-canvas></div>
          <div class="iqai-v2-analyze-3d-readout" data-iqai-analyze-3d-readout>
            <p class="iqai-v2-analyze-3d-status" data-iqai-analyze-3d-status></p>
            <p class="iqai-v2-analyze-3d-hit" data-iqai-analyze-3d-hit></p>
            <p class="iqai-v2-analyze-3d-measure" data-iqai-analyze-3d-measure></p>
            <p class="iqai-v2-analyze-3d-attrib" data-iqai-analyze-3d-attrib>City of Montréal / Esri Canada / Esri · Downtown Montréal only</p>
          </div>
        </div>
        <div class="iqai-v2-second-view" data-iqai-second-view hidden></div>
        <div class="iqai-v2-stage__placeholder" data-iqai-map-placeholder>
          <p class="iqai-v2-stage__kicker">MAP</p>
          <h1 class="iqai-v2-stage__title" data-iqai-stage-title>Loading map</h1>
          <p class="iqai-v2-stage__state" data-iqai-stage-state>INITIALIZING</p>
          <p class="iqai-v2-stage__note" data-iqai-stage-note>Loading the IQAI map. The shell stays available if the map cannot load.</p>
        </div>
        <div class="iqai-v2-stage__error" data-iqai-map-error hidden>
          <p class="iqai-v2-stage__kicker">MAP</p>
          <h1 class="iqai-v2-stage__title">Map failed</h1>
          <p class="iqai-v2-stage__state">ERROR</p>
          <p class="iqai-v2-stage__note" data-iqai-map-error-message></p>
        </div>
        <button type="button" class="iqai-v2-fold iqai-v2-fold--layers" data-iqai-layers-collapse aria-label="Fold layers">LAYERS</button>
        <button type="button" class="iqai-v2-fold iqai-v2-fold--inspector" data-iqai-inspector-collapse aria-label="Fold inspector">INSPECTOR</button>
        <div class="iqai-v2-map-tools" data-iqai-map-tools hidden>
          <div class="iqai-v2-map-nav" data-iqai-map-nav></div>
          <div class="iqai-v2-map-observe">
            <button type="button" class="iqai-v2-focus-tool" data-iqai-drop-pin aria-pressed="false" title="Arm Focus">FOCUS</button>
            <button type="button" class="iqai-v2-observe-tool" data-iqai-place-camera aria-pressed="false" title="Place an authored camera pose">CAMERA</button>
            <button type="button" class="iqai-v2-observe-tool" data-iqai-view-camera aria-pressed="false" hidden title="View camera">VIEW</button>
            <button type="button" class="iqai-v2-trace-tool" data-iqai-clear-trace title="Clear Street 360 drive trace">TRACE</button>
            <div class="iqai-v2-basemap-picker" data-iqai-basemap-picker>
              <button type="button" class="iqai-v2-observe-tool" data-iqai-basemap-toggle aria-expanded="false" title="Esri basemap for the main map">BASEMAP</button>
              <div class="iqai-v2-basemap-picker__menu" data-iqai-basemap-menu hidden></div>
            </div>
          </div>
        </div>
        <aside id="solar-hud" class="solar-hud" data-iqai-solar-hud hidden aria-label="Solar Intelligence"></aside>
        <aside class="iqai-v2-place-camera-editor" data-iqai-place-camera-editor hidden>
          <p class="iqai-v2-place-camera-editor__kicker">PLACE CAMERA</p>
          <p data-iqai-place-camera-id></p>
          <p data-iqai-place-camera-ll></p>
          <p data-iqai-place-camera-plan>PLANNED · NOT INSTALLED</p>
          <p data-iqai-place-camera-z>Z UNKNOWN</p>
          <label>HEADING
            <input data-iqai-place-camera-heading type="number" min="0" max="359" step="1" aria-label="Camera heading">
          </label>
          <label>PITCH
            <input data-iqai-place-camera-pitch type="number" min="-90" max="90" step="1" aria-label="Camera pitch">
          </label>
          <label>HEIGHT AGL
            <input data-iqai-place-camera-height type="number" min="0.5" max="200" step="0.5" aria-label="Height above ground">
          </label>
          <label>HFOV
            <input data-iqai-place-camera-fov type="number" min="10" max="120" step="1" aria-label="Horizontal field of view">
          </label>
          <button type="button" data-iqai-place-camera-delete>DELETE CAMERA</button>
          <div class="iqai-v2-view-camera-panel" data-iqai-view-camera-panel hidden>
            <div class="iqai-v2-view-camera-modes">
              <button type="button" data-iqai-view-camera-mode="geometric" aria-pressed="true">GEOMETRIC</button>
              <button type="button" data-iqai-view-camera-mode="street360" aria-pressed="false">STREET360</button>
            </div>
            <canvas class="iqai-v2-view-camera-geometric" data-iqai-view-camera-geometric width="240" height="140" aria-label="Geometric camera view"></canvas>
            <div class="iqai-v2-view-camera-truth" data-iqai-view-camera-truth hidden>
              <p data-iqai-view-camera-status>UNAVAILABLE</p>
              <p>CAMERA LOCATION</p>
              <p data-iqai-view-camera-authored>—</p>
              <p>STREET360 CAPTURE LOCATION</p>
              <p data-iqai-view-camera-capture>—</p>
              <p>CAPTURE OFFSET</p>
              <p data-iqai-view-camera-offset>—</p>
              <p>CAMERA HFOV: <span data-iqai-view-camera-hfov>—</span></p>
              <p>HDG <span data-iqai-view-camera-heading>—</span>  PITCH <span data-iqai-view-camera-pitch>—</span></p>
              <p>STREET360 PROVIDER POV</p>
              <p>NOT OPTICALLY MATCHED</p>
              <p>STREET360 CAPTURE HEIGHT IS PROVIDER-DEFINED</p>
            </div>
          </div>
          <p class="iqai-v2-place-camera-editor__note">Planned local persistence. Not installed. Orientation / FOV direction. Not LOS. Not WorldState.cameras.</p>
        </aside>
        <div class="iqai-v2-imagery-command" data-iqai-imagery-command>
          <div class="iqai-v2-imagery-command__modes iqai-v2-imagery-command__modes--stage" role="radiogroup" aria-label="Imagery surface">
            <button type="button" data-iqai-image-surface="MAP" aria-pressed="true">MAP</button>
            <button type="button" data-iqai-image-surface="AERIAL" aria-pressed="false">AERIAL</button>
            <button type="button" data-iqai-image-surface="HISTORY" aria-pressed="false">HISTORY</button>
            <button type="button" data-iqai-library-toggle aria-pressed="false">LIBRARY</button>
            <button type="button" data-iqai-remote-sensing-toggle aria-pressed="false">REMOTE SENSING</button>
          </div>
          <p class="iqai-v2-imagery-command__aerial" data-iqai-aerial-badge hidden>NEARMAP CURRENT</p>
          <div class="iqai-v2-imagery-command__history" data-iqai-history-chrome hidden>
            <button type="button" class="iqai-v2-imagery-command__date" data-iqai-image-date aria-expanded="false">DATE UNKNOWN</button>
            <button type="button" class="iqai-v2-imagery-command__cal" data-iqai-history-calendar-toggle aria-label="Open calendar">CAL</button>
            <p class="iqai-v2-imagery-command__status" data-iqai-history-status hidden></p>
            <div class="iqai-v2-imagery-command__play">
              <button type="button" data-iqai-history-action="previous">PREVIOUS</button>
              <button type="button" data-iqai-history-action="play">PLAY</button>
              <button type="button" data-iqai-history-action="next">NEXT</button>
              <button type="button" data-iqai-history-action="compare">COMPARE</button>
            </div>
            <div class="iqai-v2-imagery-command__compare" data-iqai-history-compare hidden>
              <label>A
                <select data-iqai-compare-a></select>
              </label>
              <label>B
                <select data-iqai-compare-b></select>
              </label>
              <p data-iqai-compare-labels></p>
            </div>
            <button type="button" class="iqai-v2-imagery-command__source" data-iqai-source-details-toggle aria-expanded="false">SOURCE DETAILS</button>
            <dl class="iqai-v2-imagery-command__details" data-iqai-source-details hidden></dl>
            <button type="button" data-iqai-history-capture>CAPTURE</button>
            <p class="iqai-v2-imagery-command__export" data-iqai-export-status hidden></p>
          </div>
          <div class="iqai-v2-imagery-command__eo" data-iqai-eo-chrome hidden>
            <p data-iqai-eo-status>Default mixed-proof area is drawn. Press ANALYZE when you want a measurement.</p>
            <div class="iqai-v2-imagery-command__eo-aoi">
              <button type="button" data-iqai-eo-draw aria-pressed="false">DRAW BOX</button>
              <button type="button" data-iqai-eo-selection>USE SELECTION</button>
              <button type="button" data-iqai-eo-view>USE CURRENT VIEW</button>
              <button type="button" data-iqai-eo-clear>CLEAR</button>
            </div>
            <div class="iqai-v2-imagery-command__eo-products">
              <button type="button" data-iqai-eo-product="EO.NDVI" aria-pressed="true">NDVI</button>
              <button type="button" data-iqai-eo-product="EO.SURFACE_TEMPERATURE" aria-pressed="false">HEAT</button>
              <button type="button" data-iqai-eo-product="EO.SAR_CHANGE" aria-pressed="false">RADAR</button>
            </div>
            <button type="button" data-iqai-eo-run disabled>ANALYZE NDVI</button>
            <p data-iqai-eo-product-label>SELECTED · NDVI</p>
            <p data-iqai-eo-aoi-label>AOI NOT SET</p>
            <p data-iqai-eo-capture hidden></p>
            <button type="button" data-iqai-eo-brain hidden>ASK BRAIN</button>
          </div>
          <aside class="iqai-v2-eo-legend" data-iqai-eo-legend-panel hidden>
            <p class="iqai-v2-eo-legend__kicker" data-iqai-eo-legend-title>LEGEND</p>
            <div class="iqai-v2-eo-legend__labels">
              <span data-iqai-eo-legend-low>LOW</span>
              <span data-iqai-eo-legend-center></span>
              <span data-iqai-eo-legend-high>HIGH</span>
            </div>
            <div class="iqai-v2-eo-legend__ramp" data-iqai-eo-legend-ramp></div>
            <div class="iqai-v2-eo-legend__ticks" data-iqai-eo-legend-ticks></div>
            <dl data-iqai-eo-legend-stats></dl>
            <p class="iqai-v2-eo-legend__warn" data-iqai-eo-legend-warn></p>
            <p data-iqai-eo-meaning hidden></p>
            <p data-iqai-eo-limits hidden></p>
          </aside>
          <aside class="iqai-v2-eo-probe" data-iqai-eo-probe-panel hidden>
            <p class="iqai-v2-eo-probe__kicker">PROBE</p>
            <p data-iqai-eo-probe-hint>Click the heatmap to read this cell versus the area mean.</p>
            <p data-iqai-eo-probe-value hidden></p>
            <p data-iqai-eo-probe-versus hidden></p>
            <p data-iqai-eo-probe-qa hidden></p>
            <button type="button" data-iqai-eo-probe-brain hidden>ASK BRAIN ABOUT THIS POINT</button>
          </aside>
          <aside class="iqai-v2-eo-compare" data-iqai-eo-compare-panel hidden>
            <p class="iqai-v2-eo-compare__kicker">AREA COMPARE</p>
            <p data-iqai-eo-compare-summary></p>
          </aside>
          <aside class="iqai-v2-eo-brain" data-iqai-eo-brain-panel hidden>
            <p class="iqai-v2-eo-brain__kicker">ASK BRAIN</p>
            <p class="iqai-v2-eo-brain__question" data-iqai-eo-brain-question hidden></p>
            <p class="iqai-v2-eo-brain__kicker">ANSWER</p>
            <p data-iqai-eo-brain-answer>Ask a follow-up about this measurement.</p>
            <p class="iqai-v2-eo-brain__kicker">WHAT THAT MEANS</p>
            <p data-iqai-eo-brain-meaning hidden></p>
            <p class="iqai-v2-eo-brain__kicker">LIMIT</p>
            <p data-iqai-eo-brain-limit hidden></p>
            <p class="iqai-v2-eo-brain__kicker">FOLLOW-UP</p>
            <div class="iqai-v2-eo-brain__followups" data-iqai-eo-brain-followups></div>
            <details class="iqai-v2-eo-brain__details">
              <summary>DETAILS</summary>
              <pre data-iqai-eo-brain-details></pre>
            </details>
          </aside>
          <div class="iqai-v2-imagery-calendar" data-iqai-history-calendar hidden></div>
          <div class="iqai-v2-imagery-timeline" data-iqai-history-timeline hidden></div>
        </div>
        <div class="iqai-v2-view-switcher iqai-v2-view-switcher--stage" data-iqai-view-switcher-stage>
          <span>VIEW</span>
          <button type="button" data-iqai-view="MAP" aria-pressed="true">MAP</button>
          <button type="button" data-iqai-view="STREET 360" aria-pressed="false">STREET 360</button>
          <button type="button" data-iqai-view="3D VISUAL" aria-pressed="false">3D</button>
          <button type="button" data-iqai-view="3D ANALYZE" aria-pressed="false">3D ANALYZE</button>
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
