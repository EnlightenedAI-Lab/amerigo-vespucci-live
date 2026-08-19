/**
 * Resting urban-asset symbols on the long-lived MapView.
 * Acquisition truth stays on green/red paint. GraphicsLayer counts are not pixels (F-37).
 */

const NS = 'http://www.w3.org/2000/svg';
export const WOA_ASSET_OVERLAY_ID = 'iqai-v2-woa-assets';

const HYDRANT = `
  <g class="iqai-v2-woa-icon">
    <path d="M6 8.2h6v8.6H6z"/>
    <path d="M5.1 8.2h7.8v1.6H5.1z"/>
    <path d="M7.2 4.2h3.6v4H7.2z"/>
    <path d="M4.2 9.4h2.2v1.5H4.2zM11.6 9.4h2.2v1.5h-2.2z"/>
    <circle cx="9" cy="5.1" r="1.35"/>
  </g>
`;

const SIGNAL = `
  <g class="iqai-v2-woa-icon">
    <rect x="6.1" y="2.4" width="5.8" height="14.4" rx="1.3"/>
    <circle class="lamp lamp-a" cx="9" cy="5.6" r="1.35"/>
    <circle class="lamp lamp-b" cx="9" cy="9.4" r="1.35"/>
    <circle class="lamp lamp-c" cx="9" cy="13.2" r="1.35"/>
    <path d="M8.4 16.8h1.2v3.2H8.4z"/>
  </g>
`;

function iconMarkup(objectClass) {
  if (objectClass === 'hydrant') return HYDRANT;
  if (objectClass === 'traffic_signal') return SIGNAL;
  return '';
}

function assetId(feature) {
  const lab = feature?.properties?.lab || {};
  return lab.sourceId ? `${lab.objectClass}:${lab.sourceId}` : null;
}

function webMercator(longitude, latitude) {
  const lon = Number(longitude);
  const lat = Number(latitude);
  const x = (lon * 20037508.342789244) / 180;
  const y = (Math.log(Math.tan(((90 + lat) * Math.PI) / 360)) / (Math.PI / 180))
    * (20037508.342789244) / 180;
  return { x, y };
}

export function createWoaAssetOverlay(getView) {
  let features = [];
  let visibleClasses = new Set();
  let hoverId = null;
  let acquiredId = null;

  function ensureSvg() {
    const view = getView();
    const host = view?.container;
    if (!host) return null;
    let svg = host.querySelector(`#${WOA_ASSET_OVERLAY_ID}`);
    if (!svg) {
      svg = document.createElementNS(NS, 'svg');
      svg.id = WOA_ASSET_OVERLAY_ID;
      svg.setAttribute('data-iqai-woa-assets', 'true');
      svg.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:24;overflow:visible';
      host.appendChild(svg);
    }
    const width = Math.max(1, host.clientWidth || view.width || 1);
    const height = Math.max(1, host.clientHeight || view.height || 1);
    svg.setAttribute('width', String(width));
    svg.setAttribute('height', String(height));
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    return svg;
  }

  function toScreen(lng, lat) {
    const view = getView();
    if (!view || typeof view.toScreen !== 'function') return null;
    const attempts = [
      { type: 'point', longitude: Number(lng), latitude: Number(lat), spatialReference: { wkid: 4326 } },
      { type: 'point', ...webMercator(lng, lat), spatialReference: { wkid: 102100 } }
    ];
    for (const geometry of attempts) {
      try {
        const screen = view.toScreen(geometry);
        const x = Number(screen?.x);
        const y = Number(screen?.y);
        if (Number.isFinite(x) && Number.isFinite(y)) return { x, y };
      } catch {
        // next
      }
    }
    return null;
  }

  function paint() {
    const svg = ensureSvg();
    if (!svg) return;
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    for (const feature of features) {
      const lab = feature?.properties?.lab || {};
      if (!visibleClasses.has(lab.objectClass)) continue;
      const coords = feature?.geometry?.coordinates;
      if (!coords) continue;
      const screen = toScreen(coords[0], coords[1]);
      if (!screen) continue;
      const id = assetId(feature);
      const state = id === acquiredId ? 'acquired' : id === hoverId ? 'hover' : 'rest';
      const g = document.createElementNS(NS, 'g');
      g.setAttribute('class', `iqai-v2-woa-asset iqai-v2-woa-asset--${lab.objectClass} is-${state}`);
      g.setAttribute('data-iqai-woa-asset', id || '');
      g.setAttribute('transform', `translate(${(screen.x - 9).toFixed(1)} ${(screen.y - 20).toFixed(1)})`);
      g.innerHTML = iconMarkup(lab.objectClass);
      svg.appendChild(g);
    }
  }

  return {
    setFeatures(next) {
      features = next || [];
      paint();
    },
    setVisibleClasses(classes) {
      visibleClasses = new Set(classes || []);
      paint();
      return [...visibleClasses];
    },
    setStates({ hover = null, acquired = null } = {}) {
      hoverId = hover;
      acquiredId = acquired;
      const svg = getView()?.container?.querySelector?.(`#${WOA_ASSET_OVERLAY_ID}`);
      svg?.querySelectorAll?.('[data-iqai-woa-asset]')?.forEach((node) => {
        const id = node.getAttribute('data-iqai-woa-asset');
        node.classList.toggle('is-hover', id === hoverId && id !== acquiredId);
        node.classList.toggle('is-acquired', id === acquiredId);
        node.classList.toggle('is-rest', id !== hoverId && id !== acquiredId);
      });
    },
    visibleClasses() {
      return [...visibleClasses];
    },
    paint,
    detach() {
      getView()?.container?.querySelector?.(`#${WOA_ASSET_OVERLAY_ID}`)?.remove?.();
    }
  };
}
