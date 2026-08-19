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
    <aside class="iqai-v2-layers-drawer" data-iqai-layers-drawer hidden aria-label="Layers / Discover">
      <header class="iqai-v2-layers-drawer__head">
        <h2>LAYERS / DISCOVER</h2>
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
      <div class="iqai-v2-discover" data-iqai-discover hidden></div>
      <div class="iqai-v2-layers-drawer__body" data-iqai-layers-body></div>
    </aside>
  `;
}

function legendHtml(legend) {
  if (!Array.isArray(legend) || !legend.length) return '';
  return `<ul class="iqai-v2-layer-legend">${legend.slice(0, 8).map((item) => `<li>${item}</li>`).join('')}</ul>`;
}

function statusChip(status) {
  const text = String(status || '').replaceAll('_', ' ') || 'UNKNOWN';
  const cls = /AUTH|UNAVAILABLE|FAILED/.test(text) ? 'is-blocked' : (/LIVE|NEAR/.test(text) ? 'is-live' : 'is-static');
  const span = document.createElement('em');
  span.className = `iqai-v2-layer-status ${cls}`;
  span.textContent = text;
  return span;
}

function paintDiscover(host, discover, open) {
  if (!host) return;
  if (!open || !discover?.loaded) {
    host.hidden = true;
    host.replaceChildren();
    return;
  }
  host.hidden = false;
  host.replaceChildren();

  const scenes = document.createElement('div');
  scenes.className = 'iqai-v2-discover__scenes';
  scenes.setAttribute('data-iqai-discover-scenes', '');
  for (const scene of discover.scenes || []) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'iqai-v2-discover__scene';
    btn.dataset.iqaiScene = scene.id;
    btn.textContent = scene.title;
    if (discover.activeSceneId === scene.id) {
      btn.classList.add(discover.sceneExact ? 'is-active' : 'is-customized');
      btn.setAttribute('aria-pressed', 'true');
    }
    scenes.appendChild(btn);
  }
  host.appendChild(scenes);

  const actions = document.createElement('div');
  actions.className = 'iqai-v2-discover__actions';
  const allOff = document.createElement('button');
  allOff.type = 'button';
  allOff.dataset.iqaiDiscoverAction = 'all-off';
  allOff.textContent = 'ALL OFF';
  const restore = document.createElement('button');
  restore.type = 'button';
  restore.dataset.iqaiDiscoverAction = 'restore';
  restore.textContent = 'RESTORE';
  restore.disabled = discover.restoreEnabled !== true;
  const solo = document.createElement('button');
  solo.type = 'button';
  solo.dataset.iqaiDiscoverAction = 'solo';
  solo.textContent = 'SOLO';
  const configure = document.createElement('button');
  configure.type = 'button';
  configure.dataset.iqaiDiscoverAction = 'configure';
  configure.textContent = 'CONFIGURE';
  configure.setAttribute('aria-pressed', discover.configureOpen ? 'true' : 'false');
  actions.append(allOff, restore, solo, configure);
  host.appendChild(actions);

  if (discover.configureOpen) {
    const panel = document.createElement('div');
    panel.className = 'iqai-v2-discover__config';
    panel.dataset.iqaiDiscoverConfig = 'true';
    const select = document.createElement('select');
    select.dataset.iqaiConfigScene = '';
    for (const scene of (discover.scenes || []).filter((item) => item.builtin !== false || true)) {
      const option = document.createElement('option');
      option.value = scene.id;
      option.textContent = scene.title;
      if (scene.id === (discover.configureSceneId || discover.activeSceneId)) option.selected = true;
      select.appendChild(option);
    }
    const list = document.createElement('div');
    list.className = 'iqai-v2-discover__config-list';
    const selectedScene = (discover.scenes || []).find((scene) => scene.id === select.value);
    const selected = new Set(selectedScene?.layers || []);
    for (const group of discover.groups || []) {
      for (const item of group.items || []) {
        const label = document.createElement('label');
        const input = document.createElement('input');
        input.type = 'checkbox';
        input.value = item.objectClass;
        input.checked = selected.has(item.objectClass);
        input.dataset.iqaiConfigLayer = item.objectClass;
        label.append(input, document.createTextNode(item.title));
        list.appendChild(label);
      }
    }
    const save = document.createElement('button');
    save.type = 'button';
    save.dataset.iqaiDiscoverAction = 'config-save';
    save.textContent = 'SAVE MEMBERSHIP';
    const reset = document.createElement('button');
    reset.type = 'button';
    reset.dataset.iqaiDiscoverAction = 'config-reset';
    reset.textContent = 'RESET';
    panel.append(select, list, save, reset);
    host.appendChild(panel);
  }

  if (discover.brief) {
    const brief = document.createElement('details');
    brief.className = 'iqai-v2-discover__brief';
    brief.open = Boolean(discover.activeSceneId);
    brief.dataset.iqaiIntelligenceBrief = 'true';
    const summary = document.createElement('summary');
    summary.textContent = `INTELLIGENCE BRIEF${discover.brief.title ? ` · ${discover.brief.title}` : ''}`;
    brief.appendChild(summary);
    if (discover.brief.truth) {
      const truth = document.createElement('p');
      truth.className = 'iqai-v2-discover__truth';
      truth.textContent = discover.brief.truth;
      brief.appendChild(truth);
    }
    const dl = document.createElement('dl');
    for (const row of discover.brief.facts || []) {
      const dt = document.createElement('dt');
      dt.textContent = row.label;
      const dd = document.createElement('dd');
      dd.textContent = row.truth ? `${row.value} · ${row.truth}` : row.value;
      dl.append(dt, dd);
    }
    brief.appendChild(dl);
    if (discover.brief.sentence) {
      const p = document.createElement('p');
      p.className = 'iqai-v2-discover__sentence';
      p.textContent = discover.brief.sentence;
      brief.appendChild(p);
    }
    if (discover.brief.warning) {
      const p = document.createElement('p');
      p.className = 'iqai-v2-discover__warn';
      p.textContent = discover.brief.warning;
      brief.appendChild(p);
    }
    host.appendChild(brief);
  }

  if (discover.info) {
    const info = document.createElement('details');
    info.className = 'iqai-v2-discover__info';
    info.open = true;
    info.dataset.iqaiLayerInfo = discover.infoLayerId || '';
    const summary = document.createElement('summary');
    summary.textContent = `INFO · ${discover.info.title}`;
    info.appendChild(summary);
    const fields = [
      ['WHAT IS THIS?', discover.info.what],
      ['CURRENT STATUS', discover.info.status],
      ['IN VIEW', discover.info.inView],
      ['LATEST', discover.info.latest],
      ['FRESHNESS', discover.info.freshness],
      ['SOURCE', discover.info.source],
      ['LIMITATION', discover.info.limitation]
    ];
    const dl = document.createElement('dl');
    for (const [label, value] of fields) {
      if (value == null || value === '') continue;
      const dt = document.createElement('dt');
      dt.textContent = label;
      const dd = document.createElement('dd');
      dd.textContent = String(value);
      dl.append(dt, dd);
    }
    info.appendChild(dl);
    const raw = document.createElement('details');
    raw.className = 'iqai-v2-discover__raw';
    raw.innerHTML = '<summary>SOURCE RECORD</summary>';
    const pre = document.createElement('pre');
    pre.textContent = JSON.stringify(discover.info.sourceRecord || {}, null, 2);
    raw.appendChild(pre);
    info.appendChild(raw);
    host.appendChild(info);
  }
}

function appendDiscoverGroup(body, group, infoLayerId) {
  const section = document.createElement('section');
  section.className = 'iqai-v2-layer-group is-open';
  section.dataset.iqaiLayerFamily = group.family;
  section.dataset.iqaiDiscoverFamily = group.family;
  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'iqai-v2-layer-group__toggle';
  toggle.setAttribute('aria-expanded', 'true');
  toggle.innerHTML = `<span>${group.family}</span><span>${group.items.filter((item) => item.visible).length}/${group.count}</span>`;
  const list = document.createElement('div');
  list.className = 'iqai-v2-layer-group__list';
  for (const item of group.items) {
    const row = document.createElement('div');
    row.className = 'iqai-v2-layer-row iqai-v2-layer-row--discover';
    const label = document.createElement('label');
    label.className = 'iqai-v2-layer-row__identity';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = item.visible === true;
    input.dataset.iqaiLayerInstance = item.instanceId;
    input.setAttribute('aria-label', `${item.visible ? 'Hide' : 'Show'} ${item.title}`);
    const copy = document.createElement('span');
    copy.className = 'iqai-v2-layer-row__copy';
    const strong = document.createElement('strong');
    strong.textContent = item.title;
    copy.append(strong, statusChip(item.status));
    label.append(input, copy);
    const info = document.createElement('button');
    info.type = 'button';
    info.className = 'iqai-v2-layer-info';
    info.dataset.iqaiLayerInfoOpen = item.objectClass;
    info.textContent = 'INFO';
    info.setAttribute('aria-pressed', infoLayerId === item.objectClass ? 'true' : 'false');
    row.append(label, info);
    list.appendChild(row);
  }
  section.append(toggle, list);
  body.appendChild(section);
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
  drawer.hidden = !open;
  root.dataset.iqaiDrawer = open ? 'layers' : '';
  if (addPanel) addPanel.hidden = !addDataOpen;
  body.hidden = addDataOpen;
  if (discoverHost) discoverHost.hidden = addDataOpen || !open;
  drawer.classList.toggle('is-add-data', addDataOpen === true);
  const addToggle = drawer.querySelector('[data-iqai-add-data]');
  if (addToggle) addToggle.setAttribute('aria-pressed', addDataOpen ? 'true' : 'false');
  body.replaceChildren();
  if (!open) {
    paintDiscover(discoverHost, null, false);
    return;
  }
  paintDiscover(discoverHost, addDataOpen ? null : discover, true);

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

  if (!addDataOpen) {
    for (const group of discover?.groups || []) appendDiscoverGroup(body, group, discover?.infoLayerId);
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
    const scene = event.target.closest('[data-iqai-scene]');
    if (scene && drawer.contains(scene)) {
      handlers.onScene?.(scene.getAttribute('data-iqai-scene'));
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
    const configScene = event.target.closest('[data-iqai-config-scene]');
    if (configScene && drawer.contains(configScene)) {
      handlers.onConfigureScene?.(configScene.value);
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
