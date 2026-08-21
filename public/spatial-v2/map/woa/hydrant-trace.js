/**
 * Bounded live trace for hydrant hit → selection → presentation.
 * Ring buffer only. Does not mint identity or grants.
 */

const MAX = 48;
const buffer = [];

export function hydrantTrace(step, extra = null) {
  const entry = Object.freeze({
    t: Date.now(),
    step: String(step || ''),
    extra: extra && typeof extra === 'object' ? { ...extra } : null
  });
  buffer.push(entry);
  if (buffer.length > MAX) buffer.shift();
  try {
    if (typeof globalThis !== 'undefined') globalThis.__iqaiHydrantTrace = buffer.slice();
  } catch {
    /* ignore */
  }
  try {
    console.info('[iqai-hydrant]', entry.step, extra || '');
  } catch {
    /* ignore */
  }
  return entry;
}

export function getHydrantTrace() {
  return buffer.slice();
}

export function clearHydrantTrace() {
  buffer.length = 0;
  try {
    if (typeof globalThis !== 'undefined') globalThis.__iqaiHydrantTrace = [];
  } catch {
    /* ignore */
  }
}
