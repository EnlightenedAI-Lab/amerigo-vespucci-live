/**
 * Contextual LAYERS / Discover drawer.
 * Operational Layers presentation is promoted from the accepted :8793 donor.
 * WOA and session overlays remain Spatial V2 session mutations. No Portal writes.
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

const LEGEND = [
  ['lg-bus', 'Bus'],
  ['lg-air', 'Air'],
  ['lg-bike', 'Bike'],
  ['lg-camera', 'Camera'],
  ['lg-police', 'Police'],
  ['lg-firehouse', 'Fire station'],
  ['lg-hospital', 'Hospital'],
  ['lg-event', 'Event'],
  ['lg-territory', 'Territory'],
  ['lg-affected', 'Impact'],
  ['lg-env', 'Sensor'],
  ['lg-hist', 'History'],
  ['lg-wildfire', 'Wildfire'],
  ['lg-hotspot', 'Hotspot'],
  ['lg-perimeter', 'Perimeter est.'],
  ['lg-fwi', 'FWI'],
  ['lg-sun', 'Sun / night']
];

let paintingDrawer = false;

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

  for (const layer of liveLayers) {
    const session = layer.session === true || String(layer.id || '').startsWith('session-');
    if (!session) continue;
    const family = familyOfType(layer.type, true);
    if (!groups.has(family)) groups.set(family, []);
    const instance = instances[layer.id];
    groups.get(family).push({
      instanceId: layer.id,
      layerId: 'session-agol',
      title: layer.title,
      source: layer.source,
      visible: instance ? instance.visible !== false : layer.visible !== false,
      opacity: Number.isFinite(Number(instance?.opacity)) ? Number(instance.opacity) : (Number(layer.opacity) || 1),
      depth: layer.depth,
      group: layer.group,
      family,
      togglable: true,
      legend: layer.legend || [],
      session: true
    });
  }

  for (const layer of acquisitionLayers) {
    if (layer.layerId === 'woa-acquisition' || String(layer.instanceId || '').startsWith('woa-')) continue;
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
    if (definition.layerId === 'authored-operational-map') continue;
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
    <aside class="iqai-v2-layers-drawer iqai-mtl-ops panel" data-iqai-layers-drawer aria-label="Layers / Discover">
      <header class="iqai-v2-layers-drawer__chrome">
        <span class="iqai-v2-layers-drawer__session" title="Session overlay only. Does not save the authored WebMap or write Portal.">SESSION ONLY</span>
        <button type="button" class="iqai-v2-layers-drawer__add" data-iqai-add-data>+ ADD DATA</button>
        <button type="button" class="iqai-v2-layers-drawer__close" data-iqai-drawer-close="layers" aria-label="Collapse layers">‹</button>
      </header>
      <div class="iqai-v2-add-data" data-iqai-add-data-panel hidden>
        <form class="iqai-v2-add-data__form" data-iqai-add-data-form>
          <input type="search" name="agol" placeholder="Search ArcGIS Online items" data-iqai-add-data-query />
          <button type="submit">Search</button>
        </form>
        <p class="iqai-v2-add-data__note">SESSION ONLY. Does not save the authored WebMap or write Portal.</p>
        <div data-iqai-add-data-results></div>
      </div>
      <div class="iqai-v2-discover" data-iqai-discover hidden></div>
      <aside class="config-panel" data-iqai-ops-config hidden>
        <header>
          <div class="kicker">CONFIGURE</div>
          <h2>Operational scene</h2>
          <button type="button" data-iqai-config-close aria-label="Close">×</button>
        </header>
        <div class="config-body" data-iqai-ops-config-body></div>
      </aside>
      <aside class="inspect" data-iqai-ops-inspect hidden>
        <header>
          <div class="kicker" data-iqai-inspect-kicker>LAYER ANALYSIS</div>
          <h2 data-iqai-inspect-title>—</h2>
          <button type="button" data-iqai-inspect-close aria-label="Close">×</button>
        </header>
        <div data-iqai-inspect-body></div>
      </aside>
      <div class="iqai-v2-layers-drawer__body" data-iqai-layers-body></div>
    </aside>
  `;
}

function legendHtml(legend) {
  if (!Array.isArray(legend) || !legend.length) return '';
  return `<ul class="iqai-v2-layer-legend">${legend.slice(0, 8).map((item) => `<li>${item}</li>`).join('')}</ul>`;
}

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value == null || value === false) continue;
    if (key === 'text') node.textContent = value;
    else if (key === 'class') node.className = value;
    else if (key === 'checked' || key === 'hidden' || key === 'disabled') node[key] = Boolean(value);
    else node.setAttribute(key, value);
  }
  for (const child of [].concat(children)) {
    if (child) node.append(child);
  }
  return node;
}

function sceneStateText(discover) {
  if (!discover?.activeSceneId) return 'NONE';
  if (!discover.sceneExact) return 'CUSTOMIZED';
  const scene = (discover.scenes || []).find((item) => item.id === discover.activeSceneId);
  return scene?.title || 'SCENE';
}

function appendChart(root, chart) {
  if (!chart?.length) return;
  const bars = el('div', { class: 'snap-bars brief-bars' });
  for (const row of chart.slice(0, 6)) {
    const bar = el('div', { class: 'snap-bar' }, [
      el('span', {}, [
        el('em', { text: row.label }),
        el('b', { text: String(row.count) })
      ]),
      el('i', { style: `width:${Math.max(4, row.pct || 0)}%` })
    ]);
    bars.append(bar);
  }
  root.append(bars);
}

function paintSceneShot(host, discover) {
  const visible = discover?.visible || [];
  if (!visible.length || !discover?.brief) return;
  const scene = (discover.scenes || []).find((item) => item.id === discover.activeSceneId);
  const title = !scene
    ? (discover.brief.title || 'VISIBLE SET')
    : (discover.sceneExact ? scene.title : `${scene.title} · CUSTOMIZED`);
  const shot = el('div', { class: 'scene-shot', 'data-iqai-intelligence-brief': 'true' });
  shot.append(
    el('div', { class: 'scene-shot-kicker', text: 'INTELLIGENCE BRIEF' }),
    el('div', { class: 'scene-shot-title', text: title })
  );
  const meta = [discover.brief.view, discover.brief.time].filter(Boolean).join(' · ');
  if (meta) shot.append(el('div', { class: 'scene-shot-meta', text: meta }));
  if (discover.brief.truth) shot.append(el('div', { class: 'scene-shot-truth', text: discover.brief.truth }));
  shot.append(el('div', { class: 'scene-shot-kicker', text: 'WHAT MATTERS NOW' }));
  const grid = el('dl', { class: 'scene-shot-grid' });
  for (const row of discover.brief.facts || []) {
    grid.append(
      el('dt', { text: row.label }),
      el('dd', { text: row.truth ? `${row.value} · ${row.truth}` : row.value })
    );
  }
  shot.append(grid);
  appendChart(shot, discover.brief.chart);
  if (discover.brief.sentence) shot.append(el('p', { class: 'scene-shot-sentence', text: discover.brief.sentence }));
  if (discover.brief.warning) shot.append(el('p', { class: 'scene-shot-warn', text: discover.brief.warning }));
  host.append(shot);
}

function paintLayerRow(item) {
  const checkboxId = `ops-toggle-${item.objectClass}`;
  const checkbox = el('input', {
    type: 'checkbox',
    id: checkboxId,
    'data-iqai-layer-instance': item.instanceId,
    'data-iqai-ops-layer': item.objectClass,
    checked: item.visible === true
  });
  checkbox.setAttribute('aria-label', `${item.visible ? 'Hide' : 'Show'} ${item.title}`);
  const cls = item.visualClass || 'facility';
  const hue = item.color || '#9aa8b5';
  const note = item.runtimeNote || item.provider || item.source || '';
  const status = String(item.status || 'UNKNOWN');
  const title = el('label', { class: 'layer-title-btn', text: item.title });
  title.setAttribute('for', checkboxId);
  const row = el('div', { class: 'layer-row', 'data-row': item.objectClass }, [
    checkbox,
    el('span', { class: `dot ${cls}`, style: `--hue:${hue}` }),
    el('div', {}, [
      title,
      el('div', { class: 'layer-meta', 'data-note': item.objectClass, text: note })
    ]),
    el('span', { class: `status ${status}`, 'data-status': item.objectClass, text: status.replaceAll('_', ' ') }),
    el('button', { type: 'button', class: 'solo-btn', text: 'SOLO', 'data-iqai-solo-layer': item.objectClass }),
    el('button', { type: 'button', class: 'info-btn', text: 'INFO', 'data-iqai-layer-info-open': item.objectClass })
  ]);
  if (item.infoLayerId === item.objectClass) {
    row.querySelector('.info-btn')?.setAttribute('aria-pressed', 'true');
  }
  if (item.timeWindows) {
    const chips = el('div', { class: 'time-chips' });
    const selected = item.selectedWindow || item.timeWindows.default || '1d';
    for (const win of item.timeWindows.supported || []) {
      const id = typeof win === 'string' ? win : win.id;
      const label = typeof win === 'string' ? win.toUpperCase() : win.label;
      chips.append(el('button', {
        type: 'button',
        class: `time-chip${id === selected ? ' is-active' : ''}`,
        text: label,
        'data-iqai-window': id,
        'data-iqai-window-layer': item.objectClass
      }));
    }
    row.append(chips);
    const filters = el('div', { class: 'layer-filters' });
    const select = el('select', { class: 'filter-select', 'data-iqai-category-layer': item.objectClass });
    select.append(el('option', { value: 'all', text: 'All source categories' }));
    for (const cat of item.categories || []) {
      const value = cat.french || cat.value;
      const label = cat.english ? `${cat.french} (${cat.english}) · ${cat.count}` : `${cat.french} · ${cat.count}`;
      const option = el('option', { value, text: label });
      if ((item.selectedCategory || 'all') === value) option.selected = true;
      select.append(option);
    }
    select.value = item.selectedCategory || 'all';
    const countText = item.visible && item.featureCount != null ? `COUNT ${item.featureCount}` : 'COUNT —';
    filters.append(select, el('span', { class: 'count-chip', 'data-count': item.objectClass, text: countText }));
    row.append(filters);
  }
  if (item.objectClass === 'stm') {
    const filters = el('div', { class: 'layer-filters' });
    const select = el('select', { class: 'filter-select', 'data-iqai-route-layer': item.objectClass });
    select.append(el('option', { value: 'all', text: 'All routes' }));
    for (const route of item.routes || []) {
      const option = el('option', { value: route, text: String(route) });
      if ((item.selectedRoute || 'all') === String(route)) option.selected = true;
      select.append(option);
    }
    select.value = item.selectedRoute || 'all';
    filters.append(select);
    row.append(filters);
  }
  if (item.objectClass === 'traffic-cameras') {
    const filters = el('div', { class: 'layer-filters' });
    const box = el('input', { type: 'checkbox', 'data-iqai-cameras-in-view': '1' });
    box.checked = item.camerasInView === true;
    filters.append(box, el('span', { class: 'count-chip', text: 'CAMERAS IN VIEW' }));
    row.append(filters);
  }
  return row;
}

function discoverStructureKey(discover) {
  const ids = (discover?.groups || []).flatMap((group) => (group.items || []).map((item) => item.objectClass));
  const scenes = (discover?.scenes || []).map((scene) => scene.id);
  return `${ids.join(',')}|${scenes.join(',')}`;
}

function rowNeedsRebuild(row, item) {
  const hasTime = Boolean(row.querySelector('.time-chips'));
  const hasRoutes = Boolean(row.querySelector('[data-iqai-route-layer]'));
  const hasCameras = Boolean(row.querySelector('[data-iqai-cameras-in-view]'));
  return hasTime !== Boolean(item.timeWindows)
    || hasRoutes !== (item.objectClass === 'stm')
    || hasCameras !== (item.objectClass === 'traffic-cameras');
}

function syncDiscover(host, discover) {
  const state = host.querySelector('#scene-state');
  if (state) state.textContent = sceneStateText(discover);
  const restore = host.querySelector('[data-iqai-discover-action="restore"]');
  if (restore) restore.disabled = discover.restoreEnabled !== true;
  host.querySelectorAll('[data-iqai-scene]').forEach((btn) => {
    const id = btn.getAttribute('data-iqai-scene');
    btn.classList.toggle('is-active', discover.activeSceneId === id && discover.sceneExact === true);
    btn.classList.toggle('is-customized', discover.activeSceneId === id && discover.sceneExact !== true);
    if (discover.activeSceneId === id) btn.setAttribute('aria-pressed', 'true');
    else btn.removeAttribute('aria-pressed');
  });
  const shot = host.querySelector('[data-iqai-intelligence-brief]');
  if (shot) shot.remove();
  const legend = host.querySelector('.legend');
  if (legend) {
    const holder = el('div', {});
    paintSceneShot(holder, discover);
    if (holder.firstChild) legend.before(holder.firstChild);
  }
  const items = (discover.groups || []).flatMap((group) => group.items || []);
  for (const item of items) {
    const row = host.querySelector(`[data-row="${item.objectClass}"]`);
    if (!row) continue;
    if (rowNeedsRebuild(row, item)) {
      row.replaceWith(paintLayerRow({ ...item, infoLayerId: discover.infoLayerId, camerasInView: discover.camerasInView }));
      continue;
    }
    const box = row.querySelector('input[data-iqai-layer-instance]');
    if (box && document.activeElement !== box) {
      box.checked = item.visible === true;
      box.setAttribute('aria-label', `${item.visible ? 'Hide' : 'Show'} ${item.title}`);
    }
    const meta = row.querySelector('[data-note]');
    if (meta) meta.textContent = item.runtimeNote || item.provider || item.source || '';
    const status = row.querySelector('[data-status]');
    if (status) {
      const value = String(item.status || 'UNKNOWN');
      status.className = `status ${value}`;
      status.textContent = value.replaceAll('_', ' ');
    }
    const count = row.querySelector(`[data-count="${item.objectClass}"]`);
    if (count) count.textContent = item.visible && item.featureCount != null ? `COUNT ${item.featureCount}` : 'COUNT —';
    row.querySelector('.info-btn')?.setAttribute('aria-pressed', item.infoLayerId === item.objectClass ? 'true' : 'false');
  }
}

function paintDiscover(host, discover, open) {
  if (!host) return;
  if (!open || !discover?.loaded) {
    host.hidden = true;
    host.replaceChildren();
    delete host.dataset.iqaiDiscoverKey;
    return;
  }
  host.hidden = false;
  const key = discoverStructureKey(discover);
  if (host.dataset.iqaiDiscoverKey === key && host.querySelector('.layer-list')) {
    syncDiscover(host, discover);
    return;
  }
  host.replaceChildren();
  host.dataset.iqaiDiscoverKey = key;

  const head = el('header', { class: 'panel-head' });
  head.append(
    el('div', { class: 'kicker', text: 'LAYERS / DISCOVER' }),
    el('h1', { text: 'Montréal operational layers' }),
    el('p', { class: 'sub', text: 'Sandbox V1.7 · Solar Intelligence V4.1 · class-by-shape' })
  );
  const ops = el('div', { class: 'layer-ops' });
  ops.append(
    el('button', { type: 'button', class: 'ops-btn is-primary', text: 'ALL OFF', 'data-iqai-discover-action': 'all-off' })
  );
  const restore = el('button', {
    type: 'button',
    class: 'ops-btn',
    text: 'RESTORE',
    'data-iqai-discover-action': 'restore'
  });
  restore.disabled = discover.restoreEnabled !== true;
  ops.append(restore, el('span', { class: 'scene-state', id: 'scene-state', text: sceneStateText(discover) }));
  head.append(ops);

  const presets = el('div', { class: 'preset-bar', 'data-iqai-discover-scenes': '' });
  for (const scene of discover.scenes || []) {
    const btn = el('button', {
      type: 'button',
      class: 'preset-btn',
      text: scene.title,
      'data-iqai-scene': scene.id
    });
    if (discover.activeSceneId === scene.id) {
      btn.classList.add(discover.sceneExact ? 'is-active' : 'is-customized');
      btn.setAttribute('aria-pressed', 'true');
    }
    presets.append(btn);
  }
  presets.append(el('button', {
    type: 'button',
    class: 'preset-btn is-config',
    text: 'CONFIGURE',
    'data-iqai-discover-action': 'configure'
  }));
  head.append(presets);
  paintSceneShot(head, discover);
  const legend = el('div', { class: 'legend' });
  legend.setAttribute('aria-label', 'Operational symbology');
  for (const [cls, label] of LEGEND) {
    legend.append(el('span', {}, [el('i', { class: `lg ${cls}` }), document.createTextNode(` ${label}`)]));
  }
  head.append(legend);
  host.append(head);

  const list = el('div', { class: 'layer-list', id: 'layers' });
  for (const group of discover.groups || []) {
    const section = el('section', { class: 'layer-group' });
    section.dataset.iqaiDiscoverFamily = group.family;
    section.append(el('h2', { class: 'group-title', text: group.family }));
    for (const item of group.items || []) {
      section.append(paintLayerRow({ ...item, infoLayerId: discover.infoLayerId, camerasInView: discover.camerasInView }));
    }
    list.append(section);
  }
  host.append(list);
  host.append(el('footer', { class: 'panel-foot', text: 'Localhost review only. Session overlay only.' }));
}

function paintConfig(panel, discover) {
  if (!panel) return;
  const open = Boolean(discover?.configureOpen && discover?.loaded);
  panel.hidden = !open;
  const body = panel.querySelector('[data-iqai-ops-config-body]');
  if (!body || !open) {
    if (body && !open) body.replaceChildren();
    return;
  }
  body.replaceChildren();
  const label = el('label', { class: 'config-label', text: 'SCENE' });
  const select = el('select', { id: 'config-scene' });
  select.dataset.iqaiConfigScene = '';
  for (const scene of discover.scenes || []) {
    const option = el('option', { value: scene.id, text: scene.title });
    if (scene.id === (discover.configureSceneId || discover.activeSceneId)) option.selected = true;
    select.append(option);
  }
  label.append(select);
  body.append(label);
  body.append(el('div', { class: 'config-label', text: 'LAYERS' }));
  const list = el('div', { class: 'config-layers' });
  const selectedScene = (discover.scenes || []).find((scene) => scene.id === select.value);
  const selected = new Set(selectedScene?.layers || []);
  for (const group of discover.groups || []) {
    for (const item of group.items || []) {
      const row = el('label', { class: 'config-layer' });
      const input = el('input', { type: 'checkbox', value: item.objectClass });
      input.dataset.iqaiConfigLayer = item.objectClass;
      input.checked = selected.has(item.objectClass);
      row.append(input, el('span', { text: item.title }));
      list.append(row);
    }
  }
  body.append(list);
  const actions = el('div', { class: 'config-actions' });
  actions.append(
    el('button', { type: 'button', class: 'ops-btn is-primary', text: 'SAVE', 'data-iqai-discover-action': 'config-save' }),
    el('button', { type: 'button', class: 'ops-btn', text: 'RESET DEFAULT', 'data-iqai-discover-action': 'config-reset' }),
    el('button', { type: 'button', class: 'ops-btn', text: 'SAVE CURRENT', 'data-iqai-discover-action': 'config-save-current' })
  );
  const reset = actions.querySelector('[data-iqai-discover-action="config-reset"]');
  if (reset) reset.disabled = selectedScene?.builtin === false;
  body.append(actions);
}

function paintInspect(panel, discover) {
  if (!panel) return;
  const info = discover?.info;
  panel.hidden = !info;
  const kicker = panel.querySelector('[data-iqai-inspect-kicker]');
  const title = panel.querySelector('[data-iqai-inspect-title]');
  const body = panel.querySelector('[data-iqai-inspect-body]');
  if (!info || !body) {
    if (body && !info) body.replaceChildren();
    return;
  }
  if (kicker) kicker.textContent = 'LAYER ANALYSIS';
  if (title) title.textContent = info.title || '—';
  body.replaceChildren();
  const fields = [
    ['WHAT IS THIS?', info.what],
    ['CURRENT STATUS', info.status],
    ['IN VIEW', info.inView],
    ['LATEST OBSERVATION', info.latest],
    ['FRESHNESS', info.freshness],
    ['SOURCE', info.source],
    ['LIMITATION', info.limitation]
  ];
  const dl = el('dl', { class: 'snap-grid' });
  for (const [label, value] of fields) {
    if (value == null || value === '') continue;
    dl.append(el('dt', { text: label }), el('dd', { text: String(value) }));
  }
  body.append(dl);
  if (info.mini?.length) {
    const mini = el('dl', { class: 'snap-grid' });
    for (const row of info.mini) {
      mini.append(
        el('dt', { text: row.label }),
        el('dd', { text: row.truth ? `${row.value} · ${row.truth}` : row.value })
      );
    }
    body.append(mini);
  }
  appendChart(body, info.chart);
  const actions = el('div', { class: 'snap-actions' });
  const raw = el('details');
  raw.innerHTML = '<summary>SOURCE RECORD</summary>';
  const pre = document.createElement('pre');
  pre.textContent = JSON.stringify(info.sourceRecord || {}, null, 2);
  raw.append(pre);
  actions.append(raw);
  body.append(actions);
}

export function paintLayersDrawer(root, {
  open = false,
  groups = [],
  addDataOpen = false,
  addDataResults = [],
  addDataStatus = null,
  discover = null
} = {}) {
  const drawer = root.querySelector('[data-iqai-layers-drawer]');
  const body = root.querySelector('[data-iqai-layers-body]');
  const addPanel = root.querySelector('[data-iqai-add-data-panel]');
  const results = root.querySelector('[data-iqai-add-data-results]');
  const discoverHost = root.querySelector('[data-iqai-discover]');
  if (!drawer || !body) return;
  paintingDrawer = true;
  try {
  drawer.hidden = false;
  root.dataset.iqaiDrawer = 'layers';
  if (addPanel) addPanel.hidden = !addDataOpen;
  body.hidden = addDataOpen;
  if (discoverHost) discoverHost.hidden = addDataOpen;

  drawer.classList.toggle('is-add-data', addDataOpen === true);
  const addToggle = drawer.querySelector('[data-iqai-add-data]');
  if (addToggle) addToggle.setAttribute('aria-pressed', addDataOpen ? 'true' : 'false');
  body.replaceChildren();
  if (!open) {
    paintDiscover(discoverHost, null, false);
    paintConfig(drawer.querySelector('[data-iqai-ops-config]'), null);
    paintInspect(drawer.querySelector('[data-iqai-ops-inspect]'), null);
    return;
  }
  paintDiscover(discoverHost, addDataOpen ? null : discover, !addDataOpen);
  paintConfig(drawer.querySelector('[data-iqai-ops-config]'), addDataOpen ? null : discover);
  paintInspect(drawer.querySelector('[data-iqai-ops-inspect]'), addDataOpen ? null : discover);

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
    const woaish = group.items.some((item) => String(item.instanceId || '').startsWith('woa-'));
    section.className = woaish ? 'iqai-v2-layer-group is-open' : 'iqai-v2-layer-group';
    section.dataset.iqaiLayerFamily = group.family;
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'iqai-v2-layer-group__toggle';
    toggle.setAttribute('aria-expanded', woaish ? 'true' : 'false');
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
  } finally {
    paintingDrawer = false;
  }
}

export function bindLayersDrawer(root, handlers = {}) {
  const drawer = root.querySelector('[data-iqai-layers-drawer]');
  if (!drawer) return () => {};
  let lastToggle = { instanceId: '', visible: null, at: 0 };
  function emitVisibility(input) {
    if (!input || input.disabled) return;
    const instanceId = input.getAttribute('data-iqai-layer-instance');
    const visible = input.checked === true;
    const now = Date.now();
    if (lastToggle.instanceId === instanceId && lastToggle.visible === visible && now - lastToggle.at < 300) return;
    lastToggle = { instanceId, visible, at: now };
    handlers.onVisibility?.({ instanceId, visible });
  }
  const onClick = (event) => {
    const closer = event.target.closest('[data-iqai-drawer-close="layers"]');
    if (closer && drawer.contains(closer)) {
      handlers.onClose?.();
      return;
    }
    if (event.target.closest('[data-iqai-config-close]') && drawer.contains(event.target.closest('[data-iqai-config-close]'))) {
      handlers.onConfigureClose?.();
      return;
    }
    if (event.target.closest('[data-iqai-inspect-close]') && drawer.contains(event.target.closest('[data-iqai-inspect-close]'))) {
      handlers.onLayerInfo?.(null);
      return;
    }
    if (event.target.closest('[data-iqai-add-data]') && drawer.contains(event.target.closest('[data-iqai-add-data]'))) {
      handlers.onToggleAddData?.();
      return;
    }
    const opsToggle = event.target.closest('input[data-iqai-ops-layer]');
    if (opsToggle && drawer.contains(opsToggle) && !opsToggle.disabled) {
      emitVisibility(opsToggle);
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
    const scene = event.target.closest('[data-iqai-scene]');
    if (scene && drawer.contains(scene)) {
      handlers.onScene?.(scene.getAttribute('data-iqai-scene'));
      return;
    }
    const solo = event.target.closest('[data-iqai-solo-layer]');
    if (solo && drawer.contains(solo)) {
      event.preventDefault();
      handlers.onSoloLayer?.(solo.getAttribute('data-iqai-solo-layer'));
      return;
    }
    const windowChip = event.target.closest('[data-iqai-window]');
    if (windowChip && drawer.contains(windowChip)) {
      handlers.onTimeWindow?.({
        layerId: windowChip.getAttribute('data-iqai-window-layer'),
        window: windowChip.getAttribute('data-iqai-window')
      });
      return;
    }
    const info = event.target.closest('[data-iqai-layer-info-open]');
    if (info && drawer.contains(info)) {
      handlers.onLayerInfo?.(info.getAttribute('data-iqai-layer-info-open'));
      return;
    }
    const action = event.target.closest('[data-iqai-discover-action]');
    if (action && drawer.contains(action)) {
      const kind = action.getAttribute('data-iqai-discover-action');
      if (kind === 'all-off') handlers.onAllOff?.();
      else if (kind === 'restore') handlers.onRestore?.();
      else if (kind === 'solo') handlers.onSolo?.();
      else if (kind === 'configure') handlers.onConfigure?.();
      else if (kind === 'config-save') {
        const layers = [...drawer.querySelectorAll('[data-iqai-config-layer]:checked')].map((node) => node.value);
        const sceneId = drawer.querySelector('[data-iqai-config-scene]')?.value;
        handlers.onConfigureSave?.({ sceneId, layers });
      } else if (kind === 'config-reset') {
        handlers.onConfigureReset?.(drawer.querySelector('[data-iqai-config-scene]')?.value);
      } else if (kind === 'config-save-current') {
        handlers.onConfigureSaveCurrent?.();
      }
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
    if (paintingDrawer) return;
    const configScene = event.target.closest('[data-iqai-config-scene]');
    if (configScene && drawer.contains(configScene)) {
      handlers.onConfigureScene?.(configScene.value);
      return;
    }
    const category = event.target.closest('[data-iqai-category-layer]');
    if (category && drawer.contains(category)) {
      handlers.onCategory?.({
        layerId: category.getAttribute('data-iqai-category-layer'),
        category: category.value
      });
      return;
    }
    const route = event.target.closest('[data-iqai-route-layer]');
    if (route && drawer.contains(route)) {
      handlers.onRoute?.({
        layerId: route.getAttribute('data-iqai-route-layer'),
        route: route.value
      });
      return;
    }
    const cameras = event.target.closest('[data-iqai-cameras-in-view]');
    if (cameras && drawer.contains(cameras)) {
      handlers.onCamerasInView?.(cameras.checked === true);
      return;
    }
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
    if (input.type === 'checkbox') {
      emitVisibility(input);
      return;
    }
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
