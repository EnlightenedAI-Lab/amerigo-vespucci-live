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
    historyDateCommitted: false,
    diagnosticsOpen: false,
    systemStatusOpen: false,
    inspectorPane: 'situation-slot',
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
      const next = String(activeCapability || 'map');
      state = {
        ...state,
        activeCapability: next,
        inspectorPane: next === 'imagery' ? 'situation-slot' : state.inspectorPane,
        diagnosticsOpen: next === 'imagery' ? state.diagnosticsOpen : false
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
        imageryView,
        inspectorPane: 'situation-slot',
        historyDateCommitted: imageryView === IMAGERY_VIEW.HISTORY
          && state.imageryView === IMAGERY_VIEW.HISTORY
          ? state.historyDateCommitted
          : false
      };
      return emit();
    },
    commitHistoryDate() {
      state = {
        ...state,
        historyDateCommitted: state.imageryView === IMAGERY_VIEW.HISTORY
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
    setSystemStatusOpen(systemStatusOpen) {
      state = {
        ...state,
        systemStatusOpen: Boolean(systemStatusOpen)
      };
      return emit();
    },
    setInspectorPane(inspectorPane) {
      state = {
        ...state,
        inspectorPane: String(inspectorPane || 'situation-slot')
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
  askReceipt,
  command,
  guided
} = {}) {
  const selected = time?.selected || ground?.receipt?.observation || null;
  return {
    mapState: map?.state || null,
    mapViewCreateCount: map?.mapViewCreateCount ?? null,
    groundMode: ground?.currentMode || null,
    groundState: ground?.applyState || null,
    groundDisplayConfirmed: ground?.displayConfirmed === true,
    imageryEngineState: time?.engineState || null,
    imageryRequestedDate: time?.requestedDate || null,
    imagerySelectedId: time?.selectedId || null,
    imageryActiveId: time?.activeId || null,
    displayConfirmed: time?.displayConfirmed === true,
    displayState: time?.displayState ?? null,
    imageryMatchKind: time?.matchKind || null,
    imageryDeltaDays: time?.deltaDays ?? null,
    imageryCaptureDate: selected?.acquisitionDate || null,
    imageryReleaseDate: selected?.releaseDate || null,
    imageryOnlineDate: selected?.firstPublicDate || null,
    imageryVintage: selected?.vintageLabel || selected?.vintageYear || null,
    askReceiptId: askReceipt?.receiptId || null,
    askState: askReceipt?.state || null,
    activeCapability: command?.activeCapability || null,
    imageryView: command?.imageryView || null,
    historyDateCommitted: Boolean(command?.historyDateCommitted),
    guidedWorkflowId: guided?.workflowId || null,
    guidedCurrentStep: guided?.currentStep || null,
    guidedRecommendedAction: guided?.recommendedAction || null,
    guidedCompletedSteps: guided?.completedSteps ? [...guided.completedSteps] : []
  };
}
