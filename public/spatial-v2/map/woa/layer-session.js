/**
 * Layer session consumed by World Object Acquisition.
 *
 * Layers / Discover owns visibility.
 * WOA owns targeting, acquisition, inspection, and Add to Set.
 *
 * Per registered source:
 *   REGISTERED  — present in the selectable registry
 *   VISIBLE     — Layers currently shows the class
 *   SELECTABLE  — WOA may acquire it (visible && registered && source.selectable)
 */

export const LAYER_SESSION_CONTRACT = 'iqai.spatial.layer-session/1.0.0';
export const VISIBILITY_OWNER = 'layers-discover';
export const ACQUISITION_OWNER = 'world-object-acquisition';

export function createLayerSession(sources = []) {
  const rows = new Map();
  for (const source of sources) {
    const visible = source.defaultVisible !== false && source.labSceneDefault !== false;
    rows.set(source.objectClass, {
      objectClass: source.objectClass,
      label: source.label || String(source.objectClass).toUpperCase(),
      registered: true,
      visibilityOwner: source.visibilityOwner || VISIBILITY_OWNER,
      visible,
      selectable: visible && source.selectable === true
    });
  }

  function row(objectClass) {
    return rows.get(objectClass) || null;
  }

  return {
    contract: LAYER_SESSION_CONTRACT,
    visibilityOwner: VISIBILITY_OWNER,
    acquisitionOwner: ACQUISITION_OWNER,
    instanceId(objectClass) {
      return `woa-${objectClass}`;
    },
    isVisible(objectClass) {
      return row(objectClass)?.visible === true;
    },
    isSelectable(objectClass) {
      return row(objectClass)?.selectable === true;
    },
    setVisible(objectClass, on) {
      const current = row(objectClass);
      if (!current) return null;
      current.visible = Boolean(on);
      current.selectable = current.visible && current.registered;
      return { ...current };
    },
    setVisibleByInstance(instanceId, on) {
      const objectClass = String(instanceId || '').replace(/^woa-/, '');
      return this.setVisible(objectClass, on);
    },
    allow(list) {
      return (list || []).filter((source) => this.isSelectable(source.objectClass));
    },
    drawerRows() {
      return [...rows.values()].map((item) => ({
        id: `woa-${item.objectClass}`,
        instanceId: `woa-${item.objectClass}`,
        objectClass: item.objectClass,
        title: item.label,
        source: 'World Object Acquisition',
        visible: item.visible === true,
        opacity: 1,
        type: 'feature',
        session: true,
        family: 'OPERATIONAL',
        togglable: true,
        depth: 0,
        group: 'ACQUISITION SOURCES',
        legend: []
      }));
    },
    snapshot() {
      return {
        contract: LAYER_SESSION_CONTRACT,
        visibilityOwner: VISIBILITY_OWNER,
        acquisitionOwner: ACQUISITION_OWNER,
        sources: [...rows.values()].map((item) => ({ ...item }))
      };
    }
  };
}
