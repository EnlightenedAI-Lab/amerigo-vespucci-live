/**
 * Development-only bottom-right runtime version badge.
 * Proves which Spatial build the browser loaded.
 */

import { getRendererDisplayState } from './spatial-renderer-telemetry.js';

const BADGE_ID = 'iqai-spatial-dev-badge';
const POLL_MS = 2000;

/** @type {Record<string, unknown> | null} */
let serverInfo = null;

function formatBadgeText(info, local) {
  const dirty = info?.gitDirty ? 'DIRTY' : 'CLEAN';
  const head = info?.gitHead || '???????';
  const build = info?.runtimeBuildId || 'B??????';
  const fp = info?.spatialSourceFingerprint || '???????';
  let mode = local?.rendererMode || info?.rendererMode || 'IDLE';
  const shortReason = local?.authNativeShortReason
    || info?.authNativeShortReason
    || info?.authNativeDiagnostic?.shortCode
    || null;
  if (mode === 'RUNTIME-FALLBACK' && shortReason && shortReason !== 'SUCCESS') {
    mode = `${mode} · ${shortReason}`;
  }
  const agent = info?.agent || 'A1';
  return `DEV ${agent} · ${head}-${dirty} · ${build} · S:${fp} · ${mode}`;
}

function ensureBadgeElement() {
  let el = document.getElementById(BADGE_ID);
  if (el) return el;
  el = document.createElement('div');
  el.id = BADGE_ID;
  el.className = 'iqai-spatial-dev-badge';
  el.setAttribute('aria-label', 'IQAI Spatial development build indicator');
  el.title = 'IQAI Spatial development build — click to copy runtime info';
  el.addEventListener('click', async () => {
    const payload = {
      ...(serverInfo || {}),
      client: getRendererDisplayState(),
      authNativeDiagnostic: typeof window !== 'undefined' ? window.__IQAI_AUTH_NATIVE_DIAGNOSTIC__ : null,
      badgeText: el.textContent
    };
    try {
      await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
      el.dataset.copied = '1';
      setTimeout(() => { delete el.dataset.copied; }, 1200);
    } catch {
      console.log('[IQAI DEV BADGE]', payload);
    }
  });
  document.body.appendChild(el);
  return el;
}

function renderBadge() {
  const el = ensureBadgeElement();
  const local = getRendererDisplayState();
  el.textContent = formatBadgeText(serverInfo, local);
}

async function pollServerInfo() {
  try {
    const res = await fetch('/api/spatial/runtime-info', { cache: 'no-store' });
    if (!res.ok) return;
    serverInfo = await res.json();
    if (typeof window !== 'undefined') {
      window.__IQAI_SPATIAL_RUNTIME_INFO__ = serverInfo;
    }
    renderBadge();
  } catch {
    // keep last known server info
  }
}

export function mountSpatialDevBadge() {
  renderBadge();
  pollServerInfo();
  setInterval(pollServerInfo, POLL_MS);
  setInterval(renderBadge, 500);
}
