/**
 * Contextual LAYERS drawer. Authored WebMap tree plus session overlays.
 * Visibility and opacity are session mutations. No Portal writes.
 */

const FAMILY_ORDER = [
  'REFERENCE',
  'OPERATIONAL',
  'IMAGERY',
  'ENVIRONMENT',
  'ANALYSIS',
  'AI/DERIVED',
  'SESSION/INVESTIGATION',
  'SIMULATION'
];

function familyOfType(type, session) {
  if (session) return 'SESSION/INVESTIGATION';
  const value = String(type || '').toLowerCase();
  if (/(imagery|wms|wmts|web-tile|tile|image)/.test(value) && !/feature/.test(value)) return 'IMAGERY';
  if (value === 'group') return 'REFERENCE';
  return 'OPERATIONAL';
}

export function projectLayerDrawerGroups({ definitions = [], liveLayers = [], instances = {}, acquisitionLayers = [] } = {}) {
  const groups = new Map();
  for (const family of FAMILY_ORDER) groups.set(family, []);

  const authored = definitions.find((item) => item.layerId === 'authored-operational-map');
  if (liveLayers.length && authored) {
    for (const layer of liveLayers) {
      const session = layer.session === true || String(layer.id || '').startsWith('session-');
      const family = familyOfType(layer.type, session);
      if (!groups.has(family)) groups.set(family, []);
      const instance = instances[layer.id];
      groups.get(family).push({
        instanceId: layer.id,
        layerId: session ? 'session-agol' : authored.layerId,
        title: layer.title,
        source: layer.source,
        visible: instance ? instance.visible !== false : layer.visible !== false,
        opacity: Number.isFinite(Number(instance?.opacity)) ? Number(instance.opacity) : (Number(layer.opacity) || 1),
        depth: layer.depth,
        group: layer.group,
        family,
        togglable: true,
        legend: layer.legend || [],
        session
      });
    }
  }

  for (const layer of acquisitionLayers) {
    const family = layer.family || 'OPERATIONAL';
    if (!groups.has(family)) groups.set(family, []);
    const instance = instances[layer.instanceId];
    groups.get(family).push({
      instanceId: layer.instanceId,
      layerId: 'woa-acquisition',
      title: layer.title,
      source: layer.source || 'World Object Acquisition',
      visible: instance ? instance.visible !== false : layer.visible !== false,
      opacity: 1,
      depth: 0,
      group: 'ACQUISITION SOURCES',
      family,
      togglable: true,
      legend: layer.legend || [],
      session: true
    });
  }

  for (const definition of definitions) {
    if (definition.layerId === 'authored-operational-map' && liveLayers.length) continue;
    if (definition.layerId === 'chassis-session-workspace' && liveLayers.length) continue;
    if (definition.layerId === 'session-agol') continue;
    const family = definition.family || 'OPERATIONAL';
    if (!groups.has(family)) groups.set(family, []);
    groups.get(family).push({
      instanceId: definition.layerId,
      layerId: definition.layerId,
      title: definition.title,
      source: definition.source?.catalogOrigin || definition.authority || 'Registry',
      visible: definition.defaultVisibility === true,
      opacity: 1,
      depth: 0,
      group: null,
      family,
      togglable: false,
      legend: [],
      session: false
    });
  }

  return FAMILY_ORDER
    .map((family) => ({
      family,
      count: groups.get(family)?.length || 0,
      items: groups.get(family) || []
    }))
    .filter((group) => group.count > 0);
}

export function renderLayersDrawer() {
  return `
    <aside class="iqai-v2-layers-drawer" data-iqai-layers-drawer hidden aria-label="Layers">
      <header class="iqai-v2-layers-drawer__head">
        <h2>LAYERS</h2>
        <button type="button" class="iqai-v2-layers-drawer__add" data-iqai-add-data>+ ADD DATA</button>
        <span class="iqai-v2-layers-drawer__session" title="Session overlay only. Does not save the authored WebMap or write Portal.">SESSION ONLY</span>
        <button type="button" class="iqai-v2-layers-drawer__close" data-iqai-drawer-close="layers" aria-label="Close layers">Close</button>
      </header>
      <div class="iqai-v2-add-data" data-iqai-add-data-panel hidden>
        <form class="iqai-v2-add-data__form" data-iqai-add-data-form>
          <input type="search" name="agol" placeholder="Search ArcGIS Online items" data-iqai-add-data-query />
          <button type="submit">Search</button>
        </form>
        <p class="iqai-v2-add-data__note">SESSION ONLY. Does not save the authored WebMap or write Portal.</p>
        <div data-iqai-add-data-results></div>
      </div>
      <div class="iqai-v2-layers-drawer__body" data-iqai-layers-body></div>
    </aside>
  `;
}

function legendHtml(legend) {
  if (!Array.isArray(legend) || !legend.length) return '';
  return `<ul class="iqai-v2-layer-legend">${legend.slice(0, 8).map((item) => `<li>${item}</li>`).join('')}</ul>`;
}

export function paintLayersDrawer(root, {
  open = false,
  groups = [],
  addDataOpen = false,
  addDataResults = [],
  addDataStatus = null
} = {}) {
  const drawer = root.querySelector('[data-iqai-layers-drawer]');
  const body = root.querySelector('[data-iqai-layers-body]');
  const addPanel = root.querySelector('[data-iqai-add-data-panel]');
  const results = root.querySelector('[data-iqai-add-data-results]');
  if (!drawer || !body) return;
  drawer.hidden = !open;
  root.dataset.iqaiDrawer = open ? 'layers' : '';
  if (addPanel) addPanel.hidden = !addDataOpen;
  body.hidden = addDataOpen;
  drawer.classList.toggle('is-add-data', addDataOpen === true);
  const addToggle = drawer.querySelector('[data-iqai-add-data]');
  if (addToggle) addToggle.setAttribute('aria-pressed', addDataOpen ? 'true' : 'false');
  body.replaceChildren();
  if (!open) return;

  if (results) {
    results.replaceChildren();
    if (addDataStatus) {
      const status = document.createElement('p');
      status.className = 'iqai-v2-add-data__status';
      status.textContent = addDataStatus;
      results.appendChild(status);
    }
    for (const item of addDataResults) {
      const row = document.createElement('div');
      row.className = 'iqai-v2-add-data__row';
      row.innerHTML = `<span class="iqai-v2-add-data__title">${item.title}</span><span class="iqai-v2-add-data__meta">${item.type || 'Item'}</span>`;
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = item.addable ? '+ ADD' : 'Not addable';
      button.disabled = !item.addable;
      button.dataset.iqaiAddItem = item.id;
      button.dataset.iqaiAddType = item.type;
      button.dataset.iqaiAddTitle = item.title;
      row.appendChild(button);
      results.appendChild(row);
    }
  }

  for (const group of groups) {
    const section = document.createElement('section');
    section.className = 'iqai-v2-layer-group is-open';
    section.dataset.iqaiLayerFamily = group.family;
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'iqai-v2-layer-group__toggle';
    toggle.setAttribute('aria-expanded', 'true');
    toggle.innerHTML = `<span>${group.family}</span><span>${group.items.filter((item) => item.visible).length}/${group.count}</span>`;
    const list = document.createElement('div');
    list.className = 'iqai-v2-layer-group__list';
    for (const item of group.items) {
      const row = document.createElement('div');
      row.className = 'iqai-v2-layer-row';
      row.style.paddingLeft = `${0.55 + (item.depth || 0) * 0.7}rem`;
      const label = document.createElement('label');
      label.className = 'iqai-v2-layer-row__identity';
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.checked = item.visible !== false;
      input.disabled = item.togglable !== true;
      input.dataset.iqaiLayerInstance = item.instanceId;
      input.setAttribute('aria-label', `${item.visible !== false ? 'Hide' : 'Show'} ${item.title}`);
      const copy = document.createElement('span');
      copy.className = 'iqai-v2-layer-row__copy';
      copy.innerHTML = `<strong>${item.title}</strong>${item.session ? '<em>Session</em>' : ''}`;
      label.append(input, copy);
      row.appendChild(label);
      if (item.togglable) {
        const opacity = document.createElement('input');
        opacity.type = 'range';
        opacity.className = 'iqai-v2-layer-row__opacity';
        opacity.min = '0';
        opacity.max = '100';
        opacity.value = String(Math.round((item.opacity ?? 1) * 100));
        opacity.dataset.iqaiLayerOpacity = item.instanceId;
        opacity.setAttribute('aria-label', `${item.title} opacity`);
        row.appendChild(opacity);
      }
      const legend = legendHtml(item.legend);
      if (legend) {
        const details = document.createElement('details');
        details.className = 'iqai-v2-layer-row__details';
        details.innerHTML = `<summary>Details</summary>${legend}`;
        row.appendChild(details);
      }
      list.appendChild(row);
    }
    section.append(toggle, list);
    body.appendChild(section);
  }
}

export function bindLayersDrawer(root, handlers = {}) {
  const drawer = root.querySelector('[data-iqai-layers-drawer]');
  if (!drawer) return () => {};
  const onClick = (event) => {
    const closer = event.target.closest('[data-iqai-drawer-close="layers"]');
    if (closer && drawer.contains(closer)) {
      handlers.onClose?.();
      return;
    }
    if (event.target.closest('[data-iqai-add-data]') && drawer.contains(event.target.closest('[data-iqai-add-data]'))) {
      handlers.onToggleAddData?.();
      return;
    }
    const add = event.target.closest('[data-iqai-add-item]');
    if (add && drawer.contains(add) && !add.disabled) {
      handlers.onAddItem?.({
        id: add.getAttribute('data-iqai-add-item'),
        type: add.getAttribute('data-iqai-add-type'),
        title: add.getAttribute('data-iqai-add-title')
      });
      return;
    }
    const toggle = event.target.closest('.iqai-v2-layer-group__toggle');
    if (toggle && drawer.contains(toggle)) {
      const group = toggle.closest('.iqai-v2-layer-group');
      const open = !group.classList.contains('is-open');
      group.classList.toggle('is-open', open);
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    }
  };
  const onChange = (event) => {
    const opacity = event.target.closest('[data-iqai-layer-opacity]');
    if (opacity && drawer.contains(opacity)) {
      handlers.onOpacity?.({
        instanceId: opacity.getAttribute('data-iqai-layer-opacity'),
        opacity: Number(opacity.value) / 100
      });
      return;
    }
    const input = event.target.closest('[data-iqai-layer-instance]');
    if (!input || !drawer.contains(input) || input.disabled) return;
    handlers.onVisibility?.({
      instanceId: input.getAttribute('data-iqai-layer-instance'),
      visible: input.checked === true
    });
  };
  const onSubmit = (event) => {
    const form = event.target.closest('[data-iqai-add-data-form]');
    if (!form || !drawer.contains(form)) return;
    event.preventDefault();
    const query = String(form.querySelector('[data-iqai-add-data-query]')?.value || '').trim();
    handlers.onSearchAddData?.(query);
  };
  drawer.addEventListener('click', onClick);
  drawer.addEventListener('change', onChange);
  drawer.addEventListener('input', onChange);
  drawer.addEventListener('submit', onSubmit);
  return () => {
    drawer.removeEventListener('click', onClick);
    drawer.removeEventListener('change', onChange);
    drawer.removeEventListener('input', onChange);
    drawer.removeEventListener('submit', onSubmit);
  };
}
