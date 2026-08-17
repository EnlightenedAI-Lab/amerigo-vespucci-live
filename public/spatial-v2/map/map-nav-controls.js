/**
 * IQAI Spatial V2 — unobtrusive map navigation inside the map stage.
 * Custom shell controls. Not Esri Zoom/Home/Search widgets.
 */

export function mountMapNavControls(host, controller) {
  if (!host || host.dataset.mounted === 'true') return;
  host.dataset.mounted = 'true';
  host.innerHTML = `
    <button type="button" class="iqai-v2-map-nav__btn" data-iqai-map-nav="zoom-in" title="Zoom in" aria-label="Zoom in">+</button>
    <button type="button" class="iqai-v2-map-nav__btn" data-iqai-map-nav="zoom-out" title="Zoom out" aria-label="Zoom out">−</button>
    <button type="button" class="iqai-v2-map-nav__btn iqai-v2-map-nav__btn--home" data-iqai-map-nav="home" title="Reset view" aria-label="Reset view">HOME</button>
  `;
  host.addEventListener('click', (event) => {
    const button = event.target.closest('[data-iqai-map-nav]');
    if (!button) return;
    const action = button.getAttribute('data-iqai-map-nav');
    if (action === 'zoom-in') controller.zoomIn();
    if (action === 'zoom-out') controller.zoomOut();
    if (action === 'home') controller.goHome();
  });
}
