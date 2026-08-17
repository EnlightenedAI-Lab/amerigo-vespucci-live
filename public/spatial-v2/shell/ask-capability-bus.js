export const ASK_ROUTE_STATE = Object.freeze({
  ROUTED: 'ROUTED',
  UNROUTED: 'UNROUTED',
  UNAVAILABLE: 'UNAVAILABLE',
  FAILED: 'FAILED'
});

export const ASK_ROUTE_REASON = Object.freeze({
  ACCEPTED: 'ACCEPTED',
  EMPTY_INPUT: 'EMPTY_INPUT',
  NO_CAPABILITY_MATCH: 'NO_CAPABILITY_MATCH',
  CAPABILITY_UNAVAILABLE: 'CAPABILITY_UNAVAILABLE',
  AVAILABILITY_CHECK_FAILED: 'AVAILABILITY_CHECK_FAILED',
  CAPABILITY_FAILED: 'CAPABILITY_FAILED'
});

function normalize(value) {
  return String(value ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function cloneReceipt(receipt) {
  if (!receipt) return null;
  return {
    ...receipt,
    result: receipt.result && typeof receipt.result === 'object'
      ? { ...receipt.result }
      : receipt.result
  };
}

function normalizeCapability(capability) {
  if (!capability || typeof capability.id !== 'string' || !capability.id.trim()) {
    throw new Error('Ask capabilities require a stable id.');
  }
  if (typeof capability.handle !== 'function') {
    throw new Error(`Ask capability ${capability.id} requires a handler.`);
  }
  return Object.freeze({
    id: capability.id.trim(),
    label: String(capability.label || capability.id).trim(),
    aliases: Object.freeze((capability.aliases || []).map(normalize).filter(Boolean)),
    quickActionIds: Object.freeze((capability.quickActionIds || []).map(normalize).filter(Boolean)),
    isAvailable: capability.isAvailable ?? false,
    unavailableReason: String(
      capability.unavailableReason || 'The requested capability is not available.'
    ),
    handle: capability.handle
  });
}

function assertUnambiguous(capabilities) {
  const aliases = new Map();
  const quickActions = new Map();
  for (const capability of capabilities) {
    for (const alias of capability.aliases) {
      if (aliases.has(alias)) {
        throw new Error(`Ask alias "${alias}" is registered more than once.`);
      }
      aliases.set(alias, capability.id);
    }
    for (const quickAction of capability.quickActionIds) {
      if (quickActions.has(quickAction)) {
        throw new Error(`Ask quick action "${quickAction}" is registered more than once.`);
      }
      quickActions.set(quickAction, capability.id);
    }
  }
}

export function createAskCapabilityBus({
  capabilities = [],
  now = () => new Date(),
  maxHistory = 50
} = {}) {
  const registry = capabilities.map(normalizeCapability);
  assertUnambiguous(registry);

  const listeners = new Set();
  const history = [];
  let attempt = 0;
  let lastReceipt = null;

  const publish = (receipt) => {
    const frozen = Object.freeze(cloneReceipt(receipt));
    history.push(frozen);
    while (history.length > Math.max(1, maxHistory)) history.shift();
    if (!lastReceipt || frozen.attempt >= lastReceipt.attempt) {
      lastReceipt = frozen;
      for (const listener of listeners) {
        try {
          listener(cloneReceipt(lastReceipt));
        } catch (error) {
          console.warn('[IQAI V2] Ask receipt listener failed', error);
        }
      }
    }
    return cloneReceipt(frozen);
  };

  const beginReceipt = (request) => {
    attempt += 1;
    const submittedAt = now();
    return {
      receiptId: `ask-v2-${String(attempt).padStart(6, '0')}`,
      attempt,
      submittedAt: submittedAt instanceof Date
        ? submittedAt.toISOString()
        : new Date(submittedAt).toISOString(),
      input: String(request.text ?? '').trim(),
      quickActionId: normalize(request.quickActionId) || null,
      state: ASK_ROUTE_STATE.UNROUTED,
      reason: ASK_ROUTE_REASON.NO_CAPABILITY_MATCH,
      capabilityId: null,
      capabilityLabel: null,
      executed: false,
      result: null,
      error: null
    };
  };

  const matchCapability = ({ normalizedText, quickActionId }) => {
    if (quickActionId) {
      return registry.find((capability) => capability.quickActionIds.includes(quickActionId)) || null;
    }
    if (!normalizedText) return null;
    return registry.find((capability) => capability.aliases.includes(normalizedText)) || null;
  };

  const execute = async (request = {}) => {
    const normalizedText = normalize(request.text);
    const quickActionId = normalize(request.quickActionId);
    const pendingReceipt = beginReceipt(request);

    if (!normalizedText) {
      return publish({
        ...pendingReceipt,
        state: ASK_ROUTE_STATE.UNROUTED,
        reason: ASK_ROUTE_REASON.EMPTY_INPUT
      });
    }

    const capability = matchCapability({ normalizedText, quickActionId });
    if (!capability) {
      return publish({
        ...pendingReceipt,
        state: ASK_ROUTE_STATE.UNROUTED,
        reason: ASK_ROUTE_REASON.NO_CAPABILITY_MATCH
      });
    }

    let available;
    try {
      available = typeof capability.isAvailable === 'function'
        ? await capability.isAvailable({ text: request.text, quickActionId, request })
        : capability.isAvailable === true;
    } catch (error) {
      return publish({
        ...pendingReceipt,
        state: ASK_ROUTE_STATE.FAILED,
        reason: ASK_ROUTE_REASON.AVAILABILITY_CHECK_FAILED,
        capabilityId: capability.id,
        capabilityLabel: capability.label,
        error: String(error?.message || error)
      });
    }

    if (!available) {
      return publish({
        ...pendingReceipt,
        state: ASK_ROUTE_STATE.UNAVAILABLE,
        reason: ASK_ROUTE_REASON.CAPABILITY_UNAVAILABLE,
        capabilityId: capability.id,
        capabilityLabel: capability.label,
        result: { message: capability.unavailableReason }
      });
    }

    try {
      const result = await capability.handle({
        text: String(request.text ?? '').trim(),
        normalizedText,
        quickActionId: quickActionId || null,
        request
      });
      return publish({
        ...pendingReceipt,
        state: ASK_ROUTE_STATE.ROUTED,
        reason: ASK_ROUTE_REASON.ACCEPTED,
        capabilityId: capability.id,
        capabilityLabel: capability.label,
        executed: true,
        result: result ?? null
      });
    } catch (error) {
      return publish({
        ...pendingReceipt,
        state: ASK_ROUTE_STATE.FAILED,
        reason: ASK_ROUTE_REASON.CAPABILITY_FAILED,
        capabilityId: capability.id,
        capabilityLabel: capability.label,
        error: String(error?.message || error)
      });
    }
  };

  return Object.freeze({
    execute,
    getCapabilities: () => registry.map((capability) => ({
      id: capability.id,
      label: capability.label,
      aliases: [...capability.aliases],
      quickActionIds: [...capability.quickActionIds]
    })),
    getLastReceipt: () => cloneReceipt(lastReceipt),
    getHistory: () => history.map(cloneReceipt),
    subscribe(listener) {
      listeners.add(listener);
      if (lastReceipt) listener(cloneReceipt(lastReceipt));
      return () => listeners.delete(listener);
    }
  });
}
