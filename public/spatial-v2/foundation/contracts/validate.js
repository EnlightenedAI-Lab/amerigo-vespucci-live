/**
 * Fail-closed helpers for foundation contract validation.
 * Unknown fields, unknown schemas, and non-serializable values are rejected.
 */

export class ContractError extends Error {
  constructor(code, message, details = null) {
    super(message);
    this.name = 'ContractError';
    this.code = code;
    this.details = details;
  }
}

export function failClosed(code, message, details) {
  throw new ContractError(code, message, details || null);
}

export function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}

export function requirePlainObject(value, label) {
  if (!isPlainObject(value)) {
    failClosed('INVALID_OBJECT', `${label} must be a plain object.`, { label });
  }
  return value;
}

export function requireString(value, label) {
  if (typeof value !== 'string' || value.trim() === '') {
    failClosed('INVALID_STRING', `${label} must be a non-empty string.`, { label });
  }
  return value.trim();
}

export function optionalString(value, label) {
  if (value == null) return null;
  return requireString(value, label);
}

export function requireInteger(value, label, { min = 0 } = {}) {
  if (!Number.isInteger(value) || value < min) {
    failClosed('INVALID_INTEGER', `${label} must be an integer >= ${min}.`, { label, value });
  }
  return value;
}

export function optionalFiniteNumber(value, label) {
  if (value == null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    failClosed('INVALID_NUMBER', `${label} must be a finite number or null.`, { label, value });
  }
  return value;
}

export function requireEnum(value, label, allowed) {
  if (!allowed.includes(value)) {
    failClosed('UNKNOWN_ENUM', `${label} is not a known value.`, { label, value, allowed });
  }
  return value;
}

export function optionalEnum(value, label, allowed) {
  if (value == null) return null;
  return requireEnum(value, label, allowed);
}

export function rejectUnknownKeys(value, label, allowed) {
  const allowedSet = new Set(allowed);
  for (const key of Object.keys(value)) {
    if (!allowedSet.has(key)) {
      failClosed('UNKNOWN_FIELD', `${label} contains unknown field '${key}'.`, { label, key });
    }
  }
}

export function cloneJson(value) {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch (error) {
    failClosed('NON_SERIALIZABLE', 'Value cannot be JSON cloned.', { message: error.message });
  }
}

export function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

export function frozenClone(value) {
  return deepFreeze(cloneJson(value));
}

export function isoNow(clock) {
  if (typeof clock === 'function') return String(clock());
  if (typeof clock === 'string' && clock.trim()) return clock.trim();
  return new Date().toISOString();
}

export function createId(prefix, idFactory) {
  if (typeof idFactory === 'function') return String(idFactory(prefix));
  if (globalThis.crypto?.randomUUID) return `${prefix}-${globalThis.crypto.randomUUID()}`;
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function requireArray(value, label) {
  if (!Array.isArray(value)) {
    failClosed('INVALID_ARRAY', `${label} must be an array.`, { label });
  }
  return value;
}
