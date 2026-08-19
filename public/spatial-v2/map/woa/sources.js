/**
 * SelectableObjectSource contract for production Spatial V2.
 * Categories without loaded features are not sources and cannot mint an ObjectRef.
 * Visibility owner is Layers / Discover. WOA never decides layer ON/OFF.
 */

export const SELECTABLE_SOURCE_CONTRACT = 'iqai.spatial.selectable-object-source/1.0.0';

const OVERLAP_ROLES = new Set(['object', 'area', 'container', 'asset']);

export function defineSelectableSource(spec = {}) {
  if (spec.selectable !== true) return null;
  const objectClass = String(spec.objectClass || '').trim();
  const identityField = String(spec.identityField || '').trim();
  const kind = spec.kind === 'uev-fabric'
    ? 'uev-fabric'
    : spec.kind === 'urban-asset'
      ? 'urban-asset'
      : 'geojson';
  const baseUrl = String(spec.baseUrl || spec.fabric?.baseUrl || '').trim();
  const browserBaseUrl = String(spec.browserBaseUrl || spec.proxyUrl || '').trim();
  const dataUrl = String(spec.dataUrl || '').trim();
  if (!objectClass || !identityField) return null;
  if ((kind === 'geojson' || kind === 'urban-asset') && !dataUrl) return null;
  if (kind === 'uev-fabric' && !baseUrl && !dataUrl) return null;
  const nearMeters = Number(spec.nearMeters);
  const priority = Number(spec.priority);
  const overlap = OVERLAP_ROLES.has(spec.overlap) ? spec.overlap : 'object';
  return {
    contract: SELECTABLE_SOURCE_CONTRACT,
    objectClass,
    label: String(spec.label || objectClass).toUpperCase(),
    provider: spec.provider || null,
    dataset: spec.dataset || null,
    datasetId: spec.datasetId || null,
    identityField,
    selectable: true,
    kind,
    dataUrl: dataUrl || baseUrl,
    baseUrl: baseUrl || dataUrl,
    browserBaseUrl: browserBaseUrl || null,
    nearMeters: Number.isFinite(nearMeters) && nearMeters > 0 ? nearMeters : 12,
    visibilityOwner: String(spec.visibilityOwner || 'layers-discover'),
    defaultVisible: spec.labSceneDefault !== false && spec.defaultVisible !== false,
    priority: Number.isFinite(priority) ? priority : 100,
    overlap,
    placeholder: false
  };
}

export function createSelectableRegistry() {
  const byClass = new Map();
  return {
    register(spec) {
      const source = defineSelectableSource(spec);
      if (!source) return null;
      byClass.set(source.objectClass, source);
      return source;
    },
    get(objectClass) {
      return byClass.get(objectClass) || null;
    },
    list() {
      return [...byClass.values()].sort((a, b) => (
        a.priority - b.priority || a.objectClass.localeCompare(b.objectClass)
      ));
    },
    labels() {
      return Object.fromEntries(this.list().map((source) => [source.objectClass, source.label]));
    }
  };
}

export function registerManifest(registry, manifest) {
  const registered = [];
  for (const spec of manifest?.sources || []) {
    const source = registry.register(spec);
    if (source) registered.push(source);
  }
  return registered;
}
