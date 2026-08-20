/**
 * Compact Esri MAP basemap picker. Does not own MapView.
 * AERIAL remains Nearmap; this only changes the MAP cartographic surface.
 */

import {
  getSessionEsriBasemapId,
  listSessionBasemaps,
  setSessionEsriBasemap
} from '../map/map-foundation.js';

function paintMenu(root) {
  const picker = root.querySelector('[data-iqai-basemap-picker]');
  const menu = picker?.querySelector('[data-iqai-basemap-menu]');
  const toggle = picker?.querySelector('[data-iqai-basemap-toggle]');
  if (!picker || !menu || !toggle) return;
  const active = getSessionEsriBasemapId();
  const specs = listSessionBasemaps();
  const groups = [
    { id: 'vector', label: 'VECTOR' },
    { id: 'imagery', label: 'ESRI IMAGERY' },
    { id: 'raster', label: 'RASTER' }
  ];
  menu.innerHTML = groups.map((group) => {
    const items = specs.filter((spec) => spec.group === group.id);
    if (!items.length) return '';
    return `
      <p class="iqai-v2-basemap-picker__group">${group.label}</p>
      ${items.map((spec) => `
        <button type="button" data-iqai-basemap="${spec.id}" aria-pressed="${spec.id === active ? 'true' : 'false'}">${spec.title}</button>
      `).join('')}
    `;
  }).join('');
  const current = specs.find((spec) => spec.id === active);
  toggle.textContent = current?.title ? current.title.toUpperCase() : 'BASEMAP';
  toggle.title = 'Esri basemap for the main map. Header AERIAL is still Nearmap.';
}

function closeMenu(root) {
  const menu = root.querySelector('[data-iqai-basemap-menu]');
  const toggle = root.querySelector('[data-iqai-basemap-toggle]');
  if (menu) menu.hidden = true;
  if (toggle) toggle.setAttribute('aria-expanded', 'false');
}

export function bindBasemapPicker(root, options = {}) {
  const picker = root?.querySelector('[data-iqai-basemap-picker]');
  if (!picker) return null;
  paintMenu(root);

  const onClick = (event) => {
    const toggle = event.target.closest('[data-iqai-basemap-toggle]');
    if (toggle && picker.contains(toggle)) {
      const menu = picker.querySelector('[data-iqai-basemap-menu]');
      const open = menu?.hidden !== false;
      if (menu) menu.hidden = !open;
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      if (open) paintMenu(root);
      return;
    }
    const choice = event.target.closest('[data-iqai-basemap]');
    if (choice && picker.contains(choice)) {
      const id = choice.getAttribute('data-iqai-basemap');
      closeMenu(root);
      void (async () => {
        await options.setMapSurface?.();
        await setSessionEsriBasemap(id);
        paintMenu(root);
      })();
      return;
    }
    if (!picker.contains(event.target)) closeMenu(root);
  };
  root.addEventListener('click', onClick);
  paintMenu(root);
  return Object.freeze({
    paint: () => paintMenu(root),
    close: () => closeMenu(root)
  });
}
