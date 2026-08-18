/**
 * ToolHost mounts tools whose controls dispatch capability IDs.
 * Direct adapter calls are forbidden.
 */

export function bindToolHost(root, { onDispatch } = {}) {
  const host = root.querySelector('[data-iqai-tool-host], [data-iqai-slot="capability-rail"], [data-iqai-slot="map-stage"]');
  if (!host && !root) return () => {};
  const onClick = (event) => {
    const button = event.target.closest('[data-iqai-capability-dispatch]');
    if (!button || !root.contains(button)) return;
    const capabilityId = button.getAttribute('data-iqai-capability-dispatch');
    const viewId = button.getAttribute('data-iqai-view');
    const systemId = button.getAttribute('data-iqai-system');
    if (typeof onDispatch === 'function') {
      onDispatch(capabilityId, {
        viewId: viewId || undefined,
        systemId: systemId || undefined
      });
    }
  };
  root.addEventListener('click', onClick);
  return () => root.removeEventListener('click', onClick);
}
