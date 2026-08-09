import { resizeMapView } from '../spatial-arcgis-runtime.js';
import {
  WORKSPACE_GEOMETRY_DEFAULTS,
  WORKSPACE_GEOMETRY_MODES,
  activateWorkspaceGeometry,
  deactivateWorkspaceGeometry,
  computeWorkspaceLimits,
  patchWorkspaceGeometry,
  saveWorkspaceSession
} from '../workspace-geometry.js';

const LIMITS = {
  left: { min: 140, max: 320, default: 180 },
  right: { min: 220, max: 420, default: 320 },
  bottom: { min: 80, max: 280, default: 140 }
};

export class PanelLayout {
  /** @param {HTMLElement} shell */
  constructor(shell) {
    this.shell = shell;
    this.leftWidth = LIMITS.left.default;
    this.rightWidth = LIMITS.right.default;
    this.bottomHeight = LIMITS.bottom.default;
    this.leftCollapsed = false;
    this.rightCollapsed = false;
    this.bottomCollapsed = false;
    this.workspaceBottomMode = false;
    this.workspaceKey = null;
    this.workspaceMaximized = false;
    this.workspaceCollapsed = false;
    this.workspaceDockedHeight = WORKSPACE_GEOMETRY_DEFAULTS.defaultDockedPx;
    this.activeDrag = null;
    this._resizeListener = () => this.onWindowResize();
  }

  init() {
    if (!this.shell) return;
    this.applyLayout();
    this.bindSplitters();
    window.addEventListener('resize', this._resizeListener);
  }

  collapse(panel) {
    if (panel === 'left') this.leftCollapsed = true;
    if (panel === 'right') this.rightCollapsed = true;
    if (panel === 'bottom') {
      if (this.workspaceBottomMode) {
        this.collapseWorkspace();
        return;
      }
      this.bottomCollapsed = true;
    }
    this.applyLayout();
  }

  expand(panel) {
    if (panel === 'left') this.leftCollapsed = false;
    if (panel === 'right') this.rightCollapsed = false;
    if (panel === 'bottom') {
      if (this.workspaceBottomMode && this.workspaceCollapsed) {
        this.expandWorkspace();
        return;
      }
      this.bottomCollapsed = false;
    }
    this.applyLayout();
  }

  getBottomLimits() {
    if (this.workspaceBottomMode) {
      return computeWorkspaceLimits();
    }
    return { ...LIMITS.bottom };
  }

  /**
   * @param {boolean} enabled
   * @param {string} [workspaceKey]
   */
  setWorkspaceBottomMode(enabled, workspaceKey = 'SPVM_CRIME') {
    this.workspaceBottomMode = Boolean(enabled);
    if (enabled) {
      this.workspaceKey = workspaceKey;
      const session = activateWorkspaceGeometry(workspaceKey);
      this.workspaceMaximized = session.mode === WORKSPACE_GEOMETRY_MODES.MAXIMIZED;
      this.workspaceCollapsed = session.mode === WORKSPACE_GEOMETRY_MODES.COLLAPSED;
      this.workspaceDockedHeight = session.dockedHeight;
      const limits = this.getBottomLimits();
      if (this.workspaceMaximized) {
        this.bottomCollapsed = false;
      } else if (this.workspaceCollapsed) {
        this.bottomHeight = limits.collapsed;
        this.bottomCollapsed = false;
      } else {
        this.bottomHeight = clamp(this.workspaceDockedHeight, limits.min, limits.max);
        this.bottomCollapsed = false;
      }
    } else {
      if (this.workspaceKey) {
        this.persistWorkspaceGeometry();
        deactivateWorkspaceGeometry(this.workspaceKey);
      }
      this.workspaceKey = null;
      this.workspaceMaximized = false;
      this.workspaceCollapsed = false;
      if (this.bottomHeight > LIMITS.bottom.max) {
        this.bottomHeight = LIMITS.bottom.default;
      }
    }
    this.applyLayout();
  }

  toggleMaximizeWorkspace() {
    if (!this.workspaceBottomMode) return;
    if (this.workspaceMaximized) {
      this.restoreWorkspace();
    } else {
      this.maximizeWorkspace();
    }
  }

  maximizeWorkspace() {
    if (!this.workspaceBottomMode || this.workspaceMaximized) return;
    if (!this.workspaceCollapsed) {
      this.workspaceDockedHeight = this.bottomHeight;
    }
    this.workspaceMaximized = true;
    this.workspaceCollapsed = false;
    this.bottomCollapsed = false;
    this.persistWorkspaceGeometry();
    this.applyLayout();
  }

  restoreWorkspace() {
    if (!this.workspaceBottomMode || !this.workspaceMaximized) return;
    this.workspaceMaximized = false;
    const limits = this.getBottomLimits();
    this.bottomHeight = clamp(this.workspaceDockedHeight, limits.min, limits.max);
    this.persistWorkspaceGeometry();
    this.applyLayout();
  }

  collapseWorkspace() {
    if (!this.workspaceBottomMode || this.workspaceCollapsed) return;
    if (this.workspaceMaximized) {
      this.workspaceMaximized = false;
    } else {
      this.workspaceDockedHeight = this.bottomHeight;
    }
    this.workspaceCollapsed = true;
    const limits = this.getBottomLimits();
    this.bottomHeight = limits.collapsed;
    this.bottomCollapsed = false;
    this.persistWorkspaceGeometry();
    this.applyLayout();
  }

  expandWorkspace() {
    if (!this.workspaceBottomMode || !this.workspaceCollapsed) return;
    this.workspaceCollapsed = false;
    const limits = this.getBottomLimits();
    this.bottomHeight = clamp(this.workspaceDockedHeight, limits.min, limits.max);
    this.persistWorkspaceGeometry();
    this.applyLayout();
  }

  persistWorkspaceGeometry() {
    if (!this.workspaceKey) return;
    let mode = WORKSPACE_GEOMETRY_MODES.DOCKED;
    if (this.workspaceMaximized) mode = WORKSPACE_GEOMETRY_MODES.MAXIMIZED;
    else if (this.workspaceCollapsed) mode = WORKSPACE_GEOMETRY_MODES.COLLAPSED;
    saveWorkspaceSession(this.workspaceKey, {
      mode,
      dockedHeight: this.workspaceDockedHeight
    });
    patchWorkspaceGeometry({
      workspaceKey: this.workspaceKey,
      mode,
      dockedHeight: this.workspaceDockedHeight
    });
  }

  onWindowResize() {
    if (!this.workspaceBottomMode) return;
    if (this.workspaceMaximized) {
      this.applyLayout();
      return;
    }
    if (this.workspaceCollapsed) return;
    const limits = this.getBottomLimits();
    this.bottomHeight = clamp(this.bottomHeight, limits.min, limits.max);
    this.workspaceDockedHeight = this.bottomHeight;
    this.persistWorkspaceGeometry();
    this.applyLayout();
  }

  applyLayout() {
    const limits = this.getBottomLimits();
    let bottomCssHeight = this.bottomCollapsed ? 0 : this.bottomHeight;

    if (this.workspaceBottomMode && this.workspaceCollapsed && !this.bottomCollapsed) {
      bottomCssHeight = limits.collapsed;
    }

    this.shell.style.setProperty('--spatial-left-width', `${this.leftCollapsed ? 0 : this.leftWidth}px`);
    this.shell.style.setProperty('--spatial-right-width', `${this.rightCollapsed ? 0 : this.rightWidth}px`);
    this.shell.style.setProperty('--spatial-bottom-height', `${bottomCssHeight}px`);

    this.shell.classList.toggle('is-left-collapsed', this.leftCollapsed);
    this.shell.classList.toggle('is-right-collapsed', this.rightCollapsed);
    this.shell.classList.toggle('is-bottom-collapsed', this.bottomCollapsed);
    this.shell.classList.toggle('is-workspace-bottom', this.workspaceBottomMode && !this.bottomCollapsed);
    this.shell.classList.toggle('is-workspace-maximized', this.workspaceBottomMode && this.workspaceMaximized);
    this.shell.classList.toggle('is-workspace-collapsed', this.workspaceBottomMode && this.workspaceCollapsed);

    const leftReopen = this.shell.querySelector('[data-reopen="left"]');
    const rightReopen = this.shell.querySelector('[data-reopen="right"]');
    const bottomReopen = this.shell.querySelector('[data-reopen="bottom"]');
    if (leftReopen) leftReopen.hidden = !this.leftCollapsed;
    if (rightReopen) rightReopen.hidden = !this.rightCollapsed;
    if (bottomReopen) {
      bottomReopen.hidden = !this.bottomCollapsed
        || (this.workspaceBottomMode && this.workspaceCollapsed);
    }

    resizeMapView();
  }

  bindSplitters() {
    this.shell.querySelectorAll('[data-resize]').forEach((splitter) => {
      splitter.addEventListener('pointerdown', (event) => this.startDrag(event, splitter.dataset.resize));
    });
  }

  /** @param {PointerEvent} event */
  startDrag(event, axis) {
    if (axis === 'left' && this.leftCollapsed) return;
    if (axis === 'right' && this.rightCollapsed) return;
    if (axis === 'bottom' && this.bottomCollapsed) return;

    event.preventDefault();
    event.stopPropagation();

    if (axis === 'bottom' && this.workspaceBottomMode) {
      if (this.workspaceMaximized) {
        this.workspaceMaximized = false;
        const limits = this.getBottomLimits();
        this.bottomHeight = clamp(this.workspaceDockedHeight, limits.min, limits.max);
      }
      if (this.workspaceCollapsed) {
        this.workspaceCollapsed = false;
        const limits = this.getBottomLimits();
        this.bottomHeight = clamp(this.workspaceDockedHeight, limits.min, limits.max);
      }
    }

    this.activeDrag = {
      axis,
      startX: event.clientX,
      startY: event.clientY,
      startLeft: this.leftWidth,
      startRight: this.rightWidth,
      startBottom: this.bottomHeight
    };

    const previousUserSelect = document.body.style.userSelect;
    document.body.style.userSelect = 'none';
    if (axis === 'bottom') this.shell.classList.add('is-bottom-dragging');

    const onMove = (moveEvent) => {
      moveEvent.preventDefault();
      this.onDrag(moveEvent);
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      document.body.style.userSelect = previousUserSelect;
      this.shell.classList.remove('is-bottom-dragging');
      if (this.activeDrag?.axis === 'bottom' && this.workspaceBottomMode) {
        this.workspaceDockedHeight = this.bottomHeight;
        this.persistWorkspaceGeometry();
      }
      this.activeDrag = null;
      resizeMapView();
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }

  /** @param {PointerEvent} event */
  onDrag(event) {
    if (!this.activeDrag) return;
    const { axis, startX, startY, startLeft, startRight, startBottom } = this.activeDrag;
    const bottomLimits = this.getBottomLimits();

    if (axis === 'left') {
      const delta = event.clientX - startX;
      this.leftWidth = clamp(startLeft + delta, LIMITS.left.min, LIMITS.left.max);
    } else if (axis === 'right') {
      const delta = event.clientX - startX;
      this.rightWidth = clamp(startRight - delta, LIMITS.right.min, LIMITS.right.max);
    } else if (axis === 'bottom') {
      const delta = event.clientY - startY;
      this.bottomHeight = clamp(startBottom - delta, bottomLimits.min, bottomLimits.max);
      this.workspaceDockedHeight = this.bottomHeight;
    }

    this.applyLayout();
  }
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
