/**
 * Schema guard for capability input/output contracts.
 * Unknown schema identities fail closed. ResultCommitter never sees invalid output.
 */

import { SCHEMA_IDS } from '../foundation/contracts/schema-ids.js';
import { createResult } from '../foundation/contracts/result.js';
import {
  cloneJson,
  failClosed,
  requirePlainObject
} from '../foundation/contracts/validate.js';

export function createSchemaGuard() {
  const validators = new Map();

  function register(schemaId, validate) {
    if (typeof schemaId !== 'string' || !schemaId.trim()) {
      failClosed('UNKNOWN_SCHEMA', 'Schema id is required.');
    }
    if (typeof validate !== 'function') {
      failClosed('INVALID_SCHEMA_VALIDATOR', 'Schema validator must be a function.', { schemaId });
    }
    validators.set(schemaId, validate);
    return true;
  }

  register(SCHEMA_IDS.ACTION_INPUT, (value, label = 'input') => {
    requirePlainObject(value, label);
    return cloneJson(value);
  });
  register(SCHEMA_IDS.RESULT, (value) => createResult(value));

  return Object.freeze({
    register,
    has(schemaId) {
      return validators.has(schemaId);
    },
    validate(schemaId, value, label = 'value') {
      const validate = validators.get(schemaId);
      if (!validate) {
        failClosed('UNKNOWN_SCHEMA', 'Capability schema is not registered.', { schemaId, label });
      }
      return validate(value, label);
    }
  });
}
