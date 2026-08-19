/**
 * Isolated Maps JS 3D document. No ArcGIS. No AppShell.
 * Parent WorldView calls this same-origin frame; the frame owns Map3DElement.
 */
import {
  closeGoogleMapsJs3d,
  flyGoogleMapsJs3dToSelectedPoint,
  getGoogleMapsJs3dSnapshot,
  nudgeGoogleMapsJs3dHeading,
  nudgeGoogleMapsJs3dTilt,
  openGoogleMapsJs3d,
  orbitGoogleMapsJs3d,
  resetGoogleMapsJs3dNorth,
  resetGoogleMapsJs3dView,
  setGoogleMapsJs3dObliqueView,
  setGoogleMapsJs3dTopView
} from './google-maps-js-3d.js';

const host = document.querySelector('[data-iqai-google-3d-host]');

function publish(snapshot) {
  window.parent.postMessage({
    source: 'iqai-google-3d-frame',
    snapshot
  }, window.location.origin);
  return snapshot;
}

async function handle(data) {
  const type = String(data?.type || '');
  window.__iqaiGoogle3dFrame.phase = type || window.__iqaiGoogle3dFrame.phase;
  if (type === 'ping') {
    return publish({ ready: true, ...getGoogleMapsJs3dSnapshot() });
  }
  if (type === 'open') {
    window.__iqaiGoogle3dFrame.phase = 'open';
    const observer = new MutationObserver(() => {
      if (!host?.querySelector('gmp-map-3d')) return;
      observer.disconnect();
      window.__iqaiGoogle3dFrame.phase = 'map3d-mounted';
      publish({ ready: true, ...getGoogleMapsJs3dSnapshot() });
    });
    observer.observe(host, { childList: true, subtree: true });
    try {
      const snap = await openGoogleMapsJs3d({
        container: host,
        longitude: Number(data.longitude),
        latitude: Number(data.latitude),
        source: data.source || 'drop-pin',
        hideDefaultUi: true,
        apiKey: String(data.apiKey || '').trim()
      });
      observer.disconnect();
      window.__iqaiGoogle3dFrame.phase = snap.error ? 'error' : 'open-done';
      return publish(snap);
    } catch (error) {
      observer.disconnect();
      window.__iqaiGoogle3dFrame.phase = 'error';
      throw error;
    }
  }
  if (type === 'close') {
    return publish(await closeGoogleMapsJs3d());
  }
  if (type === 'nav') {
    const action = String(data.action || '');
    if (action === 'tilt-minus') return publish(await nudgeGoogleMapsJs3dTilt(-12));
    if (action === 'tilt-plus') return publish(await nudgeGoogleMapsJs3dTilt(12));
    if (action === 'rotate-left') return publish(await nudgeGoogleMapsJs3dHeading(-30));
    if (action === 'rotate-right') return publish(await nudgeGoogleMapsJs3dHeading(30));
    if (action === 'top') return publish(await setGoogleMapsJs3dTopView());
    if (action === 'oblique') return publish(await setGoogleMapsJs3dObliqueView());
    if (action === 'north') return publish(await resetGoogleMapsJs3dNorth());
    if (action === 'fly') return publish(await flyGoogleMapsJs3dToSelectedPoint());
    if (action === 'orbit') return publish(await orbitGoogleMapsJs3d());
    if (action === 'reset') return publish(await resetGoogleMapsJs3dView());
    return publish(getGoogleMapsJs3dSnapshot());
  }
  return publish({ ready: true, ...getGoogleMapsJs3dSnapshot() });
}

window.__iqaiGoogle3dFrame = {
  phase: 'boot',
  handle,
  snapshot: () => ({ ready: true, ...getGoogleMapsJs3dSnapshot() })
};

window.addEventListener('message', (event) => {
  if (event.origin !== window.location.origin) return;
  if (!event.data || event.data.source !== 'iqai-worldview-3d') return;
  void handle(event.data).catch((error) => {
    publish({
      ...getGoogleMapsJs3dSnapshot(),
      error: String(error?.message || error)
    });
  });
});

publish({ ready: true, ...getGoogleMapsJs3dSnapshot() });
