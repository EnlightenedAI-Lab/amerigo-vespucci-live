import { pointerMetrics } from './geodesy.js';

const CX = 60;
const CY = 60;
const ACTION_SEAM = [
  { id: 'inspect', label: 'INSPECT', angle: -90 },
  { id: 'street-360', label: '360', angle: -30 },
  { id: 'photoreal-3d', label: '3D', angle: 30 },
  { id: 'history', label: 'HISTORY', angle: 90 },
  { id: 'buffer', label: 'BUFFER', angle: 150 },
  { id: 'brain', label: 'BRAIN', angle: -150 }
];

function dualPath(d) {
  return `
    <path class="halo" d="${d}" />
    <path class="ink" d="${d}" />
  `;
}

function cornerBrackets(gap, arm) {
  const corners = [
    { hx: -1, hy: -1 },
    { hx: 1, hy: -1 },
    { hx: 1, hy: 1 },
    { hx: -1, hy: 1 }
  ];
  return corners.map(({ hx, hy }) => {
    const ix = CX + hx * gap;
    const iy = CY + hy * gap;
    const ox = ix + hx * arm;
    const oy = iy + hy * arm;
    return dualPath(
      `M${ox.toFixed(2)} ${iy.toFixed(2)} L${ix.toFixed(2)} ${iy.toFixed(2)} L${ix.toFixed(2)} ${oy.toFixed(2)}`
    );
  }).join('');
}

export function createReticleMarkup(zoom = 16, { seam = false } = {}) {
  const m = pointerMetrics(zoom);
  const pip = m.pip;
  const half = pip;
  return `
    <svg class="fi-reticle" viewBox="0 0 120 120" aria-hidden="true">
      <g class="fi-reticle__brackets">
        ${cornerBrackets(m.gap, m.arm)}
      </g>
      <g class="fi-reticle__center">
        <rect class="halo" x="${(CX - half - 0.7).toFixed(2)}" y="${(CY - half - 0.7).toFixed(2)}" width="${((half + 0.7) * 2).toFixed(2)}" height="${((half + 0.7) * 2).toFixed(2)}" />
        <rect class="ink fi-dot" x="${(CX - half).toFixed(2)}" y="${(CY - half).toFixed(2)}" width="${(half * 2).toFixed(2)}" height="${(half * 2).toFixed(2)}" />
      </g>
    </svg>
    ${seam ? '<div class="fi-hit" data-role="hit" data-action="inspect"></div>' : ''}
  `;
}

const POINTER_TEMPLATE = (zoom) => `
  <div class="fi-mark fi-pointer" data-state="hidden">
    ${createReticleMarkup(zoom, { seam: false })}
    <div class="fi-chip">
      <p class="fi-chip__sense" data-role="sense" hidden></p>
    </div>
  </div>
`;

const FOCUS_TEMPLATE = (zoom) => `
  <div class="fi-mark fi-focus" data-state="hidden" hidden>
    ${createReticleMarkup(zoom, { seam: true })}
    <div class="fi-plate">
      <p class="fi-plate__kicker" data-role="kicker">FOCUS</p>
      <p class="fi-plate__place" data-role="place"></p>
      <p class="fi-plate__coords" data-role="coords"></p>
      <p class="fi-plate__elev" data-role="elev" hidden></p>
    </div>
  </div>
`;

export function mountMarks(layer) {
  layer.insertAdjacentHTML('beforeend', POINTER_TEMPLATE(16));
  layer.insertAdjacentHTML('beforeend', FOCUS_TEMPLATE(16));
  return {
    pointer: layer.querySelector('.fi-pointer'),
    focus: layer.querySelector('.fi-focus')
  };
}

export function setMarkPosition(node, x, y) {
  node.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
}

export function setPointerState(node, state) {
  node.dataset.state = state;
  node.hidden = state === 'hidden';
}

export function paintChip(node, { sense, coords, place, meta, snap, object } = {}) {
  const senseNode = node.querySelector('[data-role="sense"]');
  const text = sense || object || '';
  if (senseNode) {
    senseNode.hidden = !text;
    senseNode.textContent = text;
  }
  void coords;
  void place;
  void meta;
  void snap;
}

export function paintFocusPlate(node, { kicker, place, coords, elev, object = false } = {}) {
  node.classList.toggle('is-object', Boolean(object));
  node.querySelector('.fi-plate')?.classList.toggle('is-object', Boolean(object));
  const kickerNode = node.querySelector('[data-role="kicker"]');
  const placeNode = node.querySelector('[data-role="place"]');
  const coordsNode = node.querySelector('[data-role="coords"]');
  const elevNode = node.querySelector('[data-role="elev"]');
  if (kickerNode) kickerNode.textContent = kicker || 'FOCUS';
  if (placeNode) placeNode.textContent = place || 'Unnamed location';
  if (coordsNode) coordsNode.textContent = coords || '';
  if (elevNode) {
    elevNode.hidden = !elev;
    elevNode.textContent = elev ? `EL  ${elev}` : '';
  }
}

export function rebuildReticle(node, zoom, { seam = false } = {}) {
  const wrap = document.createElement('div');
  wrap.innerHTML = createReticleMarkup(zoom, { seam });
  const nextSvg = wrap.querySelector('.fi-reticle');
  const current = node.querySelector('.fi-reticle');
  if (!current || !nextSvg) return;
  current.replaceWith(nextSvg);
  const existingHit = node.querySelector('[data-role="hit"]');
  const nextHit = wrap.querySelector('[data-role="hit"]');
  if (seam && nextHit && !existingHit) node.insertBefore(nextHit, node.firstChild);
  if (!seam && existingHit) existingHit.remove();
}

export { ACTION_SEAM };
