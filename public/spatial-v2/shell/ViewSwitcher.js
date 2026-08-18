import { getActiveSpatialFocus, isDropPinFocus } from '../map/spatial-focus.js';

const VIEWS = Object.freeze({
  MAP: 'map',
  STREET_360: 'street-360',
  VISUAL_3D: '3d-visual',
  ANALYZE_3D: '3d-analyze'
});

const NOTICE = Object.freeze({
  SELECT_STREET: 'SELECT A POINT FOR STREET 360',
  SELECT_3D: 'SELECT A POINT FOR 3D VISUAL',
  LOADING_STREET: 'LOADING STREET 360…',
  LOADING_3D: 'LOADING 3D VISUAL…',
  STREET_UNAVAILABLE: 'STREET 360 NOT AVAILABLE HERE',
  VISUAL_UNAVAILABLE: '3D VISUAL NOT AVAILABLE HERE'
});

function isOperatorPoint(point) {
  return isDropPinFocus(point);
}

export function bindViewSwitcher(root, options = {}) {
  const switcher = root?.querySelector('[data-iqai-view-switcher]');
  const notice = root?.querySelector('[data-iqai-view-notice]');
  const dateLabel = root?.querySelector('[data-iqai-street-360-date]');
  const google3d = options.google3d;
  const street360 = options.street360;

  let activeView = VIEWS.MAP;
  let pendingView = null;
  let busy = false;

  function selectedPoint() {
    const focus = getActiveSpatialFocus();
    if (isOperatorPoint(focus)) return focus;
    return null;
  }

  function paint() {
    if (!switcher) return;
    for (const button of switcher.querySelectorAll('[data-iqai-view]')) {
      const view = button.getAttribute('data-iqai-view');
      const reserved = view === VIEWS.ANALYZE_3D;
      button.disabled = reserved || (busy && view !== VIEWS.MAP);
      button.setAttribute('aria-pressed', view === activeView ? 'true' : 'false');
      button.classList.toggle('is-active', view === activeView);
    }
    const capture = street360?.snapshot?.().capture;
    const blocking = pendingView
      ? (pendingView === VIEWS.STREET_360 ? NOTICE.SELECT_STREET : NOTICE.SELECT_3D)
      : busy && activeView === VIEWS.STREET_360
        ? NOTICE.LOADING_STREET
        : busy && activeView === VIEWS.VISUAL_3D
          ? NOTICE.LOADING_3D
          : null;
    if (notice) {
      if (blocking) {
        notice.hidden = false;
        notice.textContent = blocking;
        notice.dataset.iqaiViewNoticeKind = pendingView ? 'instruction' : 'loading';
      } else if (activeView === VIEWS.MAP && notice.dataset.iqaiViewNoticeKind === 'unavailable') {
        notice.hidden = false;
      } else if (
        activeView === VIEWS.STREET_360
        && capture?.text
        && capture.precision !== 'UNKNOWN'
      ) {
        notice.hidden = false;
        notice.textContent = `CAPTURED ${capture.text}`;
        notice.dataset.iqaiViewNoticeKind = 'date';
      } else {
        notice.hidden = true;
        if (notice.dataset.iqaiViewNoticeKind !== 'unavailable') notice.textContent = '';
      }
    }
    if (dateLabel) {
      dateLabel.hidden = true;
      dateLabel.textContent = '';
    }
  }

  async function showUnavailable(message) {
    activeView = VIEWS.MAP;
    pendingView = null;
    busy = false;
    await closeSpecialists(VIEWS.MAP);
    if (notice) {
      notice.hidden = false;
      notice.textContent = message;
      notice.dataset.iqaiViewNoticeKind = 'unavailable';
    }
    paint();
  }

  async function closeSpecialists(except) {
    const restoreMap = except === VIEWS.MAP;
    if (except !== VIEWS.STREET_360) {
      const streetState = street360?.snapshot?.().stageState;
      if (streetState && streetState !== 'IDLE') {
        await street360.close({ restoreMap });
      }
    }
    if (except !== VIEWS.VISUAL_3D) {
      const snap = google3d?.snapshot?.() || {};
      if (snap.stageState && snap.stageState !== 'IDLE' && snap.stageState !== 'ERROR') {
        await google3d.close({ restoreMap });
      }
    }
  }

  async function openStreet360() {
    const point = selectedPoint();
    if (!point) {
      pendingView = VIEWS.STREET_360;
      activeView = VIEWS.MAP;
      options.armDropPin?.();
      paint();
      return street360?.snapshot?.() || null;
    }
    pendingView = null;
    activeView = VIEWS.STREET_360;
    busy = true;
    paint();
    await closeSpecialists(VIEWS.STREET_360);
    try {
      const opened = await street360.open();
      if (opened?.stageState === 'UNAVAILABLE' || opened?.available === false) {
        await showUnavailable(NOTICE.STREET_UNAVAILABLE);
        return opened;
      }
      activeView = VIEWS.STREET_360;
      busy = false;
      paint();
      return opened;
    } catch {
      await showUnavailable(NOTICE.STREET_UNAVAILABLE);
      return street360?.snapshot?.() || null;
    }
  }

  async function open3dVisual() {
    const point = selectedPoint();
    if (!point) {
      pendingView = VIEWS.VISUAL_3D;
      activeView = VIEWS.MAP;
      options.armDropPin?.();
      paint();
      return google3d?.snapshot?.() || null;
    }
    pendingView = null;
    activeView = VIEWS.VISUAL_3D;
    busy = true;
    paint();
    await closeSpecialists(VIEWS.VISUAL_3D);
    try {
      const opened = await google3d.open();
      if (opened?.stageState === 'ERROR' || opened?.open !== true) {
        await showUnavailable(NOTICE.VISUAL_UNAVAILABLE);
        return opened;
      }
      activeView = VIEWS.VISUAL_3D;
      busy = false;
      paint();
      return opened;
    } catch {
      await showUnavailable(NOTICE.VISUAL_UNAVAILABLE);
      return google3d?.snapshot?.() || null;
    }
  }

  async function openMap() {
    pendingView = null;
    busy = true;
    paint();
    await closeSpecialists(VIEWS.MAP);
    activeView = VIEWS.MAP;
    busy = false;
    if (notice) {
      notice.hidden = true;
      notice.textContent = '';
      delete notice.dataset.iqaiViewNoticeKind;
    }
    paint();
  }

  async function setView(view) {
    if (view === VIEWS.ANALYZE_3D) return snapshot();
    if (busy && view === activeView) return snapshot();
    if (view === VIEWS.MAP) {
      await openMap();
      return snapshot();
    }
    if (view === VIEWS.STREET_360) {
      if (activeView === VIEWS.STREET_360 && street360?.snapshot?.().open) return snapshot();
      await openStreet360();
      return snapshot();
    }
    if (view === VIEWS.VISUAL_3D) {
      if (activeView === VIEWS.VISUAL_3D && google3d?.snapshot?.().open) return snapshot();
      await open3dVisual();
      return snapshot();
    }
    return snapshot();
  }

  function onMapPointSelected(point) {
    if (!isOperatorPoint(point)) return;
    const pending = pendingView;
    if (pending === VIEWS.STREET_360) {
      pendingView = null;
      void openStreet360();
      return;
    }
    if (pending === VIEWS.VISUAL_3D) {
      pendingView = null;
      void open3dVisual();
    }
  }

  function snapshot() {
    return {
      activeView,
      pendingView,
      busy,
      notice: notice?.hidden ? null : notice?.textContent?.trim() || null,
      selectedPoint: selectedPoint(),
      street360: street360?.snapshot?.() || null,
      google3d: google3d?.snapshot?.() || null
    };
  }

  const onClick = (event) => {
    const button = event.target.closest('[data-iqai-view]');
    if (!button || !switcher?.contains(button)) return;
    const view = button.getAttribute('data-iqai-view');
    void setView(view);
  };
  switcher?.addEventListener('click', onClick);
  paint();

  return Object.freeze({
    setView,
    onMapPointSelected,
    snapshot,
    paint
  });
}
