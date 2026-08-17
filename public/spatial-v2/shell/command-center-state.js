export const EXPERIENCE_MODE = Object.freeze({
  NORMAL: 'NORMAL',
  EXPERT: 'EXPERT'
});

export const IMAGERY_VIEW = Object.freeze({
  LATEST: 'LATEST',
  HISTORY: 'HISTORY',
  ALL: 'ALL'
});

function cloneReceipt(receipt) {
  return receipt
    ? {
        ...receipt,
        result: receipt.result && typeof receipt.result === 'object'
          ? { ...receipt.result }
          : receipt.result
      }
    : null;
}

export function createCommandCenterState() {
  const listeners = new Set();
  let state = {
    experience: EXPERIENCE_MODE.NORMAL,
    activeCapability: 'map',
    imageryView: IMAGERY_VIEW.LATEST,
    diagnosticsOpen: false,
    lastAskReceipt: null
  };

  const getSnapshot = () => ({
    ...state,
    lastAskReceipt: cloneReceipt(state.lastAskReceipt)
  });

  const emit = () => {
    const snapshot = getSnapshot();
    for (const listener of listeners) {
      try {
        listener(snapshot);
      } catch (error) {
        console.warn('[IQAI V2] command-center state listener failed', error);
      }
    }
    return snapshot;
  };

  return Object.freeze({
    getSnapshot,
    subscribe(listener) {
      listeners.add(listener);
      listener(getSnapshot());
      return () => listeners.delete(listener);
    },
    setExperience(experience) {
      if (!Object.values(EXPERIENCE_MODE).includes(experience)) {
        throw new Error(`Unknown experience mode: ${experience}`);
      }
      state = {
        ...state,
        experience,
        diagnosticsOpen: experience === EXPERIENCE_MODE.EXPERT
          ? state.diagnosticsOpen
          : false
      };
      return emit();
    },
    setActiveCapability(activeCapability) {
      state = {
        ...state,
        activeCapability: String(activeCapability || 'map'),
        diagnosticsOpen: activeCapability === 'imagery'
          ? state.diagnosticsOpen
          : false
      };
      return emit();
    },
    setImageryView(imageryView) {
      if (!Object.values(IMAGERY_VIEW).includes(imageryView)) {
        throw new Error(`Unknown imagery view: ${imageryView}`);
      }
      state = {
        ...state,
        activeCapability: 'imagery',
        imageryView
      };
      return emit();
    },
    setDiagnosticsOpen(diagnosticsOpen) {
      state = {
        ...state,
        diagnosticsOpen: state.experience === EXPERIENCE_MODE.EXPERT
          ? Boolean(diagnosticsOpen)
          : false
      };
      return emit();
    },
    setAskReceipt(lastAskReceipt) {
      state = {
        ...state,
        lastAskReceipt: cloneReceipt(lastAskReceipt)
      };
      return emit();
    }
  });
}

export function createCommandCenterTruthSnapshot({
  map,
  ground,
  time,
  askReceipt
} = {}) {
  const selected = time?.selected || ground?.receipt?.observation || null;
  return {
    mapState: map?.state || null,
    mapViewCreateCount: map?.mapViewCreateCount ?? null,
    groundMode: ground?.currentMode || null,
    groundState: ground?.applyState || null,
    imageryEngineState: time?.engineState || null,
    imageryRequestedDate: time?.requestedDate || null,
    imagerySelectedId: time?.selectedId || null,
    imageryActiveId: time?.activeId || null,
    imageryMatchKind: time?.matchKind || null,
    imageryDeltaDays: time?.deltaDays ?? null,
    imageryCaptureDate: selected?.acquisitionDate || null,
    imageryReleaseDate: selected?.releaseDate || null,
    imageryOnlineDate: selected?.firstPublicDate || null,
    imageryVintage: selected?.vintageLabel || selected?.vintageYear || null,
    askReceiptId: askReceipt?.receiptId || null,
    askState: askReceipt?.state || null
  };
}
