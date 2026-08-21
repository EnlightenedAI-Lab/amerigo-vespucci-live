import { isGreaterMontrealLongitudeLatitude } from '../../spatial/montreal-operational-config.js';
import { isDropPinFocus } from '../map/spatial-focus.js';
import {
  getMapView,
  getMapViewCreateCount
} from '../map/map-foundation.js';
import {
  checkGoogleStreetView,
  closeGoogleStreetView,
  getGoogleStreetViewSnapshot,
  hasKnownStreetPano,
  hasRetainedGoogleStreetView,
  lookGoogleStreetView,
  moveGoogleStreetViewAlongCoverage,
  openGoogleStreetView,
  parkGoogleStreetView,
  resizeGoogleStreetView,
  revealGoogleStreetView,
  setGoogleStreetViewPov,
  STREET_360_OPERATOR_UNAVAILABLE,
  applyWorldviewNavigationToStreetView,
  subscribeGoogleStreetViewNavigation,
  zoomGoogleStreetView,
  aimGoogleStreetViewAtHydrant,
  isStreetHydrantAimLocked
} from '../map/google-street-view.js';
import {
  WORLDVIEW_NAV_SOURCE,
  armStreetOperatingScale,
  beginWorldviewNavigationApply,
  disarmStreetOperatingScale,
  endWorldviewNavigationApply,
  getStreet360LiveCapability,
  getWorldviewNavigation,
  isWorldviewNavigationApplying,
  noteStreetOperatingScaleApplied,
  proposeWorldviewNavigation,
  streetOperatingScalePatch,
  subscribeWorldviewNavigation
} from '../map/worldview-navigation.js';
import { observeStreetTraversal } from '../map/worldview-traversal.js';

const STAGE_STATE = Object.freeze({
  IDLE: 'IDLE',
  OPENING: 'OPENING',
  OPEN: 'OPEN',
  CLOSING: 'CLOSING',
  UNAVAILABLE: 'UNAVAILABLE',
  ERROR: 'ERROR'
});

export function bindStreet360Control(root, options = {}) {
  const well = root?.querySelector('.iqai-v2-stage__well');
  const mapHost = root?.querySelector('[data-iqai-map-host]');
  const streetPane = root?.querySelector('[data-iqai-pane="STREET 360"]');
  const stageHost = root?.querySelector('[data-iqai-view-anchor="STREET 360"]')
    || streetPane?.querySelector('[data-iqai-street-360-stage]')
    || root?.querySelector('[data-iqai-street-360-stage]');
  const dateLabel = root?.querySelector('[data-iqai-street-360-date]');

  let stageState = STAGE_STATE.IDLE;
  let mapReady = false;
  let selectedPoint = null;
  let selectedFeature = null;
  let mapViewIdentity = null;
  let transition = 0;
  let streetNavUnsub = null;
  let worldNavUnsub = null;
  let bindMode = 'operator';
  let cameraTarget = null;
  let inventoryLook = null;
  let concealed = false;

  const hasSelection = () => Boolean(
    selectedPoint
    && isGreaterMontrealLongitudeLatitude(
      selectedPoint.longitude,
      selectedPoint.latitude
    )
  );

  function peerPoint() {
    const point = options.getSpatialFocus?.() || options.getPeerSelectedPoint?.();
    if (!isDropPinFocus(point)) return null;
    if (!isGreaterMontrealLongitudeLatitude(point.longitude, point.latitude)) return null;
    return {
      longitude: Number(point.longitude),
      latitude: Number(point.latitude),
      spatialReferenceWkid: 4326,
      source: 'drop-pin'
    };
  }

  function applySpatialFocus() {
    const point = peerPoint();
    if (point) selectedPoint = point;
    return hasSelection();
  }

  function openTarget() {
    if (inventoryLook) return inventoryLook;
    if (bindMode === 'camera' && cameraTarget) {
      if (!isGreaterMontrealLongitudeLatitude(cameraTarget.longitude, cameraTarget.latitude)) {
        return null;
      }
      return {
        longitude: Number(cameraTarget.longitude),
        latitude: Number(cameraTarget.latitude),
        heading: Number(cameraTarget.heading),
        pitch: Number(cameraTarget.pitch),
        source: 'authored-camera',
        preferPosition: true
      };
    }
    const selectedHydrant = typeof options.getSelectedHydrant === 'function'
      ? options.getSelectedHydrant()
      : null;
    const hydrantLon = Number(selectedHydrant?.longitude);
    const hydrantLat = Number(selectedHydrant?.latitude);
    if (isGreaterMontrealLongitudeLatitude(hydrantLon, hydrantLat)) {
      return {
        longitude: hydrantLon,
        latitude: hydrantLat,
        source: 'hydrant-inventory',
        preferPosition: true
      };
    }
    const nav = getWorldviewNavigation();
    if (nav && isGreaterMontrealLongitudeLatitude(nav.longitude, nav.latitude)) {
      return {
        longitude: nav.longitude,
        latitude: nav.latitude,
        heading: nav.heading,
        source: 'worldview-navigation'
      };
    }
    return peerPoint();
  }

  function detachNavSync() {
    streetNavUnsub?.();
    worldNavUnsub?.();
    streetNavUnsub = null;
    worldNavUnsub = null;
    disarmStreetOperatingScale();
  }

  function attachNavSync() {
    detachNavSync();
    armStreetOperatingScale();
    const capability = getStreet360LiveCapability();
    if (capability.positionEvents) {
      const openingNavigation = getWorldviewNavigation();
      beginWorldviewNavigationApply(WORLDVIEW_NAV_SOURCE.STREET_360);
      try {
        streetNavUnsub = subscribeGoogleStreetViewNavigation((position) => {
          if (stageState !== STAGE_STATE.OPEN) return;
          if (isWorldviewNavigationApplying(WORLDVIEW_NAV_SOURCE.STREET_360)) return;
          const scalePatch = streetOperatingScalePatch(getWorldviewNavigation());
          const committed = proposeWorldviewNavigation(WORLDVIEW_NAV_SOURCE.STREET_360, {
            longitude: position.longitude,
            latitude: position.latitude,
            heading: capability.headingFromPov ? position.heading : undefined,
            ...scalePatch
          });
          if (committed?.accepted) noteStreetOperatingScaleApplied(committed.snapshot);
          observeStreetTraversal({
            ...position,
            programmatic: position.programmatic === true
          });
        });
      } finally {
        endWorldviewNavigationApply(
          WORLDVIEW_NAV_SOURCE.STREET_360,
          openingNavigation?.revision
        );
      }
    }
    worldNavUnsub = subscribeWorldviewNavigation((nav) => {
      if (!nav || stageState !== STAGE_STATE.OPEN) return;
      if (isStreetHydrantAimLocked()) return;
      if (nav.sourceView === WORLDVIEW_NAV_SOURCE.STREET_360) return;
      beginWorldviewNavigationApply(WORLDVIEW_NAV_SOURCE.STREET_360);
      try {
        applyWorldviewNavigationToStreetView(nav);
      } finally {
        endWorldviewNavigationApply(WORLDVIEW_NAV_SOURCE.STREET_360, nav.revision);
      }
    });
  }

  function specialistVisibleNow() {
    return [
      STAGE_STATE.OPENING,
      STAGE_STATE.OPEN,
      STAGE_STATE.CLOSING
    ].includes(stageState);
  }

  const keepMapVisible = options.keepMapVisible === true;

  function paint() {
    const specialistVisible = specialistVisibleNow();
    if (!keepMapVisible) {
      if (well) {
        if (specialistVisible) well.dataset.iqaiSpecialistView = 'street-360';
        else if (well.dataset.iqaiSpecialistView === 'street-360') well.dataset.iqaiSpecialistView = '2d';
      }
      if (root) {
        if (specialistVisible) root.dataset.iqaiSpatialView = 'street-360';
        else if (root.dataset.iqaiSpatialView === 'street-360') root.dataset.iqaiSpatialView = '2d';
      }
    }
    if (stageHost) {
      const paneShown = streetPane ? streetPane.hidden !== true : specialistVisible;
      stageHost.hidden = keepMapVisible ? !paneShown && !specialistVisible : !specialistVisible;
    }
    if (dateLabel) {
      dateLabel.hidden = true;
      dateLabel.textContent = '';
    }
  }

  function selectPoint(longitude, latitude, source = 'operator', feature = null) {
    const lon = Number(longitude);
    const lat = Number(latitude);
    if (!isGreaterMontrealLongitudeLatitude(lon, lat)) return false;
    selectedPoint = {
      longitude: lon,
      latitude: lat,
      spatialReferenceWkid: 4326,
      source: String(source || 'operator')
    };
    if (feature && typeof feature === 'object') {
      selectedFeature = { ...feature };
    }
    if (stageState === STAGE_STATE.ERROR || stageState === STAGE_STATE.UNAVAILABLE) {
      stageState = STAGE_STATE.IDLE;
    }
    options.onSelectPoint?.(selectedPoint);
    paint();
    return true;
  }

  function attachMapView(view) {
    if (!view) return false;
    if (!mapViewIdentity) mapViewIdentity = view;
    mapReady = true;
    applySpatialFocus();
    paint();
    return true;
  }

  function hostSize() {
    return {
      width: Number(stageHost?.offsetWidth) || 0,
      height: Number(stageHost?.offsetHeight) || 0
    };
  }

  function hostLaidOut() {
    const size = hostSize();
    const paneHidden = streetPane?.hidden === true;
    return !paneHidden && size.width > 8 && size.height > 8;
  }

  function presentationCanvasReady() {
    const canvas = stageHost?.querySelector?.('.gm-style canvas');
    const width = Number(canvas?.width) || Number(canvas?.offsetWidth) || 0;
    const height = Number(canvas?.height) || Number(canvas?.offsetHeight) || 0;
    return Boolean(canvas) && width > 8 && height > 8;
  }

  function operatorVisibleReady(engine = getGoogleStreetViewSnapshot()) {
    return stageState === STAGE_STATE.OPEN
      && concealed !== true
      && engine.open === true
      && hostLaidOut()
      && Boolean(engine.panoId || engine.panoPresent)
      && presentationCanvasReady();
  }

  function revealStreetHost() {
    if (streetPane) {
      streetPane.hidden = false;
      streetPane.removeAttribute('hidden');
    }
    if (stageHost) {
      stageHost.hidden = false;
      stageHost.removeAttribute('hidden');
      stageHost.style.display = 'block';
      stageHost.style.minWidth = '240px';
      stageHost.style.minHeight = '240px';
    }
  }

  function bindStageResize() {
    if (!stageHost || typeof ResizeObserver !== 'function' || stageHost.dataset.iqaiStreetResizeBound === '1') {
      return;
    }
    stageHost.dataset.iqaiStreetResizeBound = '1';
    const observer = new ResizeObserver(() => {
      if (hostLaidOut()) {
        resizeGoogleStreetView();
      }
    });
    observer.observe(stageHost);
  }

  function showSpecialistSurface() {
    if (!keepMapVisible && mapHost) {
      mapHost.style.visibility = 'hidden';
      mapHost.style.pointerEvents = 'none';
    }
    revealStreetHost();
    bindStageResize();
  }

  function restoreMapSurface() {
    if (stageHost) {
      stageHost.hidden = true;
      stageHost.innerHTML = '';
    }
    if (!keepMapVisible && mapHost) {
      mapHost.style.visibility = 'visible';
      mapHost.style.pointerEvents = '';
    }
    const view = getMapView();
    view?.resize?.();
    view?.requestRender?.();
  }

  function waitForLaidOutStage() {
    revealStreetHost();
    return new Promise((resolve) => {
      const started = Date.now();
      const tick = () => {
        if (hostLaidOut()) {
          resolve(true);
          return;
        }
        if (Date.now() - started > 2000) {
          resolve(false);
          return;
        }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
  }

  function snapshot() {
    const view = getMapView();
    const engine = getGoogleStreetViewSnapshot();
    const size = hostSize();
    return {
      ...engine,
      open: stageState === STAGE_STATE.OPEN && engine.open === true && concealed !== true,
      stageState,
      selectedPoint: selectedPoint ? { ...selectedPoint } : engine.selectedPoint,
      selectedFeature: selectedFeature ? { ...selectedFeature } : null,
      mapViewCreateCount: getMapViewCreateCount(),
      mapViewExists: Boolean(view),
      mapViewPreserved: Boolean(mapViewIdentity && view === mapViewIdentity),
      mapHostHidden: mapHost ? mapHost.style.visibility === 'hidden' : null,
      viewLabel: 'STREET 360',
      operatorStatus: stageState === STAGE_STATE.UNAVAILABLE || stageState === STAGE_STATE.ERROR
        ? STREET_360_OPERATOR_UNAVAILABLE
        : stageState === STAGE_STATE.OPENING
          ? 'LOADING STREET 360…'
          : null,
      mapCenter: {
        longitude: view?.center?.longitude ?? null,
        latitude: view?.center?.latitude ?? null
      },
      bindMode,
      cameraTarget: cameraTarget ? { ...cameraTarget } : null,
      providerPixels: presentationCanvasReady(),
      hostWidth: size.width,
      hostHeight: size.height,
      operatorVisible: operatorVisibleReady(engine),
      concealed,
      retained: hasKnownStreetPano()
    };
  }

  async function open() {
    const view = getMapView();
    attachMapView(view);
    applySpatialFocus();
    const target = openTarget();
    if (!mapReady || !target) {
      return snapshot();
    }
    if (!hasRetainedGoogleStreetView() && hasKnownStreetPano()
      && (concealed === true
        || stageState === STAGE_STATE.OPEN
        || stageState === STAGE_STATE.OPENING)) {
      return reveal();
    }
    if (hasRetainedGoogleStreetView() && hostLaidOut()) {
      concealed = false;
      showSpecialistSurface();
      await revealGoogleStreetView(stageHost);
      stageState = STAGE_STATE.OPEN;
      resizeGoogleStreetView();
      await applySelectedHydrant().catch(() => {});
      paint();
      return snapshot();
    }
    if ((stageState === STAGE_STATE.OPENING || stageState === STAGE_STATE.OPEN)
      && hasRetainedGoogleStreetView()
      && concealed !== true) {
      const engine = getGoogleStreetViewSnapshot();
      if (engine.panoId || engine.panoPresent || engine.open === true) {
        if (hostLaidOut()) {
          stageState = STAGE_STATE.OPEN;
          resizeGoogleStreetView();
        }
      }
      await applySelectedHydrant().catch(() => {});
      paint();
      return snapshot();
    }
    if (!keepMapVisible && options.isPeerSpecialistOpen?.() === true) {
      await options.closePeerSpecialist?.();
    }

    const token = ++transition;
    stageState = STAGE_STATE.OPENING;
    paint();

    try {
      const existing = getGoogleStreetViewSnapshot();
      const availability = existing.available && existing.panoId && (
        existing.hydrantAim?.panorama || existing.panoramaPosition
      )
        ? {
          available: true,
          panorama: existing.hydrantAim?.panorama || existing.panoramaPosition
        }
        : await Promise.race([
          checkGoogleStreetView({
            longitude: target.longitude,
            latitude: target.latitude,
            source: target.source
          }),
          new Promise((resolve) => setTimeout(() => resolve({
            available: true,
            panorama: existing.hydrantAim?.panorama || existing.panoramaPosition || {
              longitude: target.longitude,
              latitude: target.latitude
            }
          }), 4000))
        ]);
      if (token !== transition) return snapshot();
      if (!availability.available) {
        stageState = STAGE_STATE.UNAVAILABLE;
        paint();
        return snapshot();
      }

      showSpecialistSurface();
      paint();
      await waitForLaidOutStage();
      const engine = await openGoogleStreetView({
        container: stageHost,
        longitude: target.longitude,
        latitude: target.latitude,
        heading: Number.isFinite(Number(target.heading)) ? Number(target.heading) : undefined,
        pitch: Number.isFinite(Number(target.pitch)) ? Number(target.pitch) : undefined,
        source: target.source,
        preferPosition: target.preferPosition === true
          || target.source === 'worldview-navigation'
          || target.source === 'authored-camera'
          || target.source === 'hydrant-inventory',
        availability
      });
      if (token !== transition) return snapshot();
      const readyEnough = engine.open === true && (
        engine.available === true
        || Boolean(engine.panoId)
        || engine.panoPresent === true
      );
      if (!readyEnough) {
        throw new Error(engine.error || 'STREET 360 UNAVAILABLE');
      }
      stageState = STAGE_STATE.OPEN;
      resizeGoogleStreetView();
      if (bindMode === 'camera') {
        if (Number.isFinite(Number(target.heading)) || Number.isFinite(Number(target.pitch))) {
          setGoogleStreetViewPov({ heading: target.heading, pitch: target.pitch });
        }
      } else {
        attachNavSync();
        if (engine.panoramaPosition) {
          observeStreetTraversal({
            longitude: engine.panoramaPosition.longitude,
            latitude: engine.panoramaPosition.latitude,
            heading: engine.pov?.heading,
            pitch: engine.pov?.pitch,
            zoom: engine.zoom,
            panoId: engine.panoId || null
          });
        }
      }
      await applySelectedHydrant();
      paint();
      return snapshot();
    } catch (error) {
      if (token === transition) {
        detachNavSync();
        const engine = getGoogleStreetViewSnapshot();
        if (engine.open === true && (engine.panoId || engine.panoPresent)) {
          stageState = STAGE_STATE.OPEN;
          attachNavSync();
          await applySelectedHydrant().catch(() => {});
          paint();
          return snapshot();
        }
        await closeGoogleStreetView().catch(() => {});
        restoreMapSurface();
        stageState = STAGE_STATE.ERROR;
        paint();
      }
      throw error;
    }
  }

  async function conceal() {
    concealed = true;
    await parkGoogleStreetView();
    paint();
    return snapshot();
  }

  async function reveal() {
    concealed = false;
    showSpecialistSurface();
    paint();
    await waitForLaidOutStage();
    const engine = await revealGoogleStreetView(stageHost);
    if (engine.open === true) {
      stageState = STAGE_STATE.OPEN;
    }
    resizeGoogleStreetView();
    await applySelectedHydrant().catch(() => {});
    paint();
    return snapshot();
  }

  async function close(options = {}) {
    if (options.conceal === true) {
      return conceal();
    }
    const restoreMap = options.restoreMap !== false;
    const token = ++transition;
    stageState = STAGE_STATE.CLOSING;
    paint();
    detachNavSync();
    await closeGoogleStreetView();
    if (token !== transition) return snapshot();
    if (restoreMap) restoreMapSurface();
    else if (stageHost) {
      stageHost.hidden = true;
      stageHost.innerHTML = '';
    }
    bindMode = 'operator';
    cameraTarget = null;
    concealed = false;
    stageState = STAGE_STATE.IDLE;
    paint();
    return snapshot();
  }

  function beginCameraBind(pose) {
    bindMode = 'camera';
    cameraTarget = pose ? {
      cameraId: pose.cameraId || null,
      longitude: Number(pose.longitude),
      latitude: Number(pose.latitude),
      heading: Number(pose.heading),
      pitch: Number(pose.pitch)
    } : null;
    return snapshot();
  }

  async function openForCamera(pose) {
    beginCameraBind(pose);
    return open();
  }

  function applyCameraPov(pose) {
    if (bindMode !== 'camera' || !pose) return snapshot();
    cameraTarget = {
      ...(cameraTarget || {}),
      cameraId: pose.cameraId || cameraTarget?.cameraId || null,
      longitude: Number(pose.longitude),
      latitude: Number(pose.latitude),
      heading: Number(pose.heading),
      pitch: Number(pose.pitch)
    };
    setGoogleStreetViewPov({ heading: pose.heading, pitch: pose.pitch });
    return snapshot();
  }

  async function releaseCameraBind() {
    const wasCamera = bindMode === 'camera';
    bindMode = 'operator';
    cameraTarget = null;
    if (wasCamera && (stageState === STAGE_STATE.OPEN || stageState === STAGE_STATE.OPENING || stageState === STAGE_STATE.UNAVAILABLE)) {
      return close({ restoreMap: false });
    }
    return snapshot();
  }

  async function applySelectedHydrant() {
    const record = typeof options.getSelectedHydrant === 'function'
      ? options.getSelectedHydrant()
      : null;
    if (!record?.idBi && !record?.sourceId) return snapshot();
    try {
      return await aimGoogleStreetViewAtHydrant(record);
    } catch (error) {
      return {
        available: false,
        message: String(error?.message || error),
        physicalVisibility: 'NOT CONFIRMED'
      };
    }
  }

  async function lookAtHydrant(record, aimOptions = {}) {
    try {
      let aimed = await aimGoogleStreetViewAtHydrant(record);
      if (!aimed?.available) return aimed;
      const engine = getGoogleStreetViewSnapshot();
      const shouldOpen = aimOptions.openPane !== false
        && (aimed.needsOpen || concealed || stageState !== STAGE_STATE.OPEN || engine.open !== true);
      if (shouldOpen) {
        inventoryLook = {
          longitude: aimed.panorama.longitude,
          latitude: aimed.panorama.latitude,
          heading: aimed.heading,
          pitch: 0,
          source: 'hydrant-inventory',
          preferPosition: true
        };
        if (hasRetainedGoogleStreetView()) {
          const revealed = await reveal();
          inventoryLook = null;
          if (revealed?.open === true || hasRetainedGoogleStreetView()) {
            aimed = await aimGoogleStreetViewAtHydrant(record);
          }
        } else {
          showSpecialistSurface();
          paint();
          await waitForLaidOutStage();
          const presented = await openGoogleStreetView({
            container: stageHost,
            longitude: aimed.panorama.longitude,
            latitude: aimed.panorama.latitude,
            heading: aimed.heading,
            pitch: 0,
            source: 'hydrant-inventory',
            preferPosition: false,
            availability: {
              available: true,
              panorama: aimed.panorama
            }
          }).catch((error) => ({
            open: false,
            error: String(error?.message || error)
          }));
          inventoryLook = null;
          if (presented?.open === true || presented?.panoId) {
            stageState = STAGE_STATE.OPEN;
            concealed = false;
            resizeGoogleStreetView();
            attachNavSync();
            aimed = await aimGoogleStreetViewAtHydrant(record);
          } else if (stageState !== STAGE_STATE.OPEN) {
            const opened = await open().catch((error) => ({
              open: false,
              error: String(error?.message || error)
            }));
            if (opened?.open !== true && stageState !== STAGE_STATE.OPEN) {
              return {
                ...aimed,
                needsOpen: true,
                message: opened?.error || presented?.error || aimed.message || 'STREET 360 UNAVAILABLE'
              };
            }
            aimed = await aimGoogleStreetViewAtHydrant(record);
          }
        }
      }
      paint();
      return aimed;
    } catch (error) {
      paint();
      return {
        available: false,
        message: String(error?.message || error) || 'STREET 360 UNAVAILABLE',
        physicalVisibility: 'NOT CONFIRMED'
      };
    }
  }

  paint();
  return Object.freeze({
    attachMapView,
    setMapReady(ready) {
      mapReady = Boolean(ready);
      if (mapReady) attachMapView(getMapView());
      paint();
      return snapshot();
    },
    selectPoint,
    open,
    close,
    conceal,
    reveal,
    lookAtHydrant,
    beginCameraBind,
    openForCamera,
    applyCameraPov,
    releaseCameraBind,
    bindMode: () => bindMode,
    look: lookGoogleStreetView,
    zoom: zoomGoogleStreetView,
    moveAlongCoverage: moveGoogleStreetViewAlongCoverage,
    liveCapability: getStreet360LiveCapability,
    snapshot
  });
}
