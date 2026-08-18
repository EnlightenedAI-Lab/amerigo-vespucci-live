/**
 * World State serialization gate. Runtime handles, DOM nodes, credentials,
 * and model objects cannot enter a snapshot.
 */

import { failClosed, isPlainObject } from '../foundation/contracts/validate.js';

const SECRET_KEY = /(token|password|secret|api_?key|credential|authorization|cookie|private_?key|access_key)/i;
const HANDLE_KEY = /^(mapView|sceneView|viewHandle|modelHandle|domNode|providerHandle|webmapHandle)$/i;
const HANDLE_CTOR = new Set([
  'MapView',
  'SceneView',
  'WebMap',
  'HTMLElement',
  'HTMLDivElement',
  'Window',
  'Map3DElement',
  'LayerView'
]);

function ctorName(value) {
  return value?.constructor?.name || '';
}

export function assertSerializableWorldState(value, path = '$') {
  if (value == null) return;
  const type = typeof value;
  if (type === 'function' || type === 'symbol' || type === 'bigint') {
    failClosed('NON_SERIALIZABLE', `Non-serializable ${type} at ${path}.`, { path, type });
  }
  if (type !== 'object') return;

  const name = ctorName(value);
  if (HANDLE_CTOR.has(name)) {
    failClosed('RUNTIME_HANDLE_PROHIBITED', `Runtime handle '${name}' cannot enter World State at ${path}.`, { path, name });
  }
  if (typeof value.nodeType === 'number' && value.nodeName) {
    failClosed('DOM_NODE_PROHIBITED', `DOM node cannot enter World State at ${path}.`, { path });
  }
  if (Object.prototype.hasOwnProperty.call(value, '__esri') || Object.prototype.hasOwnProperty.call(value, 'declaredClass')) {
    failClosed('RUNTIME_HANDLE_PROHIBITED', `Provider runtime object cannot enter World State at ${path}.`, { path });
  }

  if (Array.isArray(value)) {
    value.forEach((item, index) => assertSerializableWorldState(item, `${path}[${index}]`));
    return;
  }

  if (!isPlainObject(value) && name && name !== 'Object') {
    failClosed('NON_SERIALIZABLE', `Non-plain object '${name}' cannot enter World State at ${path}.`, { path, name });
  }

  for (const [key, child] of Object.entries(value)) {
    if (SECRET_KEY.test(key)) {
      failClosed('SECRET_MATERIAL_PROHIBITED', `Secret-like field '${key}' cannot enter World State at ${path}.`, { path, key });
    }
    if (HANDLE_KEY.test(key)) {
      failClosed('RUNTIME_HANDLE_PROHIBITED', `Runtime handle field '${key}' cannot enter World State at ${path}.`, { path, key });
    }
    assertSerializableWorldState(child, `${path}.${key}`);
  }

  try {
    JSON.stringify(value);
  } catch (error) {
    failClosed('NON_SERIALIZABLE', `JSON stringify failed at ${path}: ${error.message}`, { path });
  }
}

export function serializeWorldState(snapshot) {
  assertSerializableWorldState(snapshot);
  return JSON.stringify(snapshot);
}

export function deserializeWorldState(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    failClosed('INVALID_SNAPSHOT', `Snapshot JSON could not be parsed: ${error.message}`);
  }
  assertSerializableWorldState(parsed);
  return parsed;
}
