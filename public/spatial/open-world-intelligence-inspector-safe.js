/**
 * Agent 2 inspector safe projection — allowlist only.
 */
const SECRET_KEYS = /token|secret|password|cookie|authorization|apikey|api_key|bearer/i;

export function sanitizeOpenWorldInspectorRecord(record) {
  if (!record || typeof record !== 'object') return record;
  const out = Array.isArray(record) ? [] : {};
  for (const [key, value] of Object.entries(record)) {
    if (SECRET_KEYS.test(key)) {
      out[key] = '[REDACTED]';
      continue;
    }
    if (value && typeof value === 'object') {
      out[key] = sanitizeOpenWorldInspectorRecord(value);
    } else {
      out[key] = value;
    }
  }
  return out;
}

export function assertNoOpenWorldSecretsExposed(model) {
  function walk(node) {
    if (node == null || typeof node !== 'object') {
      if (typeof node === 'string' && node !== '[REDACTED]' && /(secret|token|bearer)/i.test(node)) {
        throw new Error('Open-world inspector exposed secret-like content');
      }
      return;
    }
    for (const [key, value] of Object.entries(node)) {
      if (SECRET_KEYS.test(key) && value !== '[REDACTED]') {
        throw new Error('Open-world inspector exposed secret-like content');
      }
      walk(value);
    }
  }
  walk(model);
  return true;
}
