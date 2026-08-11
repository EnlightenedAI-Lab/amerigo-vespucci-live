/**
 * Browser latency trace — correlates with server via traceId header.
 */

let activeTrace = null;

function nowMs() {
  return performance.now();
}

function uuid() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `trace-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

/**
 * @param {object} [options]
 */
export function createClientLatencyTrace(options = {}) {
  const origin = nowMs();
  const traceId = options.traceId || uuid();
  const milestones = {};
  const spans = [];
  const openSpans = new Map();

  const trace = {
    traceId,
    strategy: options.strategy || null,
    origin,
    milestones,
    spans,

    mark(name, at = nowMs()) {
      if (milestones[name] == null) milestones[name] = at - origin;
    },

    startSpan(name, meta = {}) {
      const id = `${name}:${spans.length}`;
      openSpans.set(id, { name, startMs: nowMs() - origin, ...meta });
      return id;
    },

    endSpan(id, meta = {}) {
      const open = openSpans.get(id);
      if (!open) return null;
      openSpans.delete(id);
      spans.push({
        name: open.name,
        startMs: open.startMs,
        durationMs: nowMs() - origin - open.startMs,
        executionMode: meta.executionMode || open.executionMode || 'SERIAL',
        criticalPath: meta.criticalPath ?? open.criticalPath ?? false
      });
    },

    toPayload() {
      return { traceId, strategy: this.strategy, milestones, spans };
    },

    finalize(result = {}) {
      const serverTrace = result?.raw?.latencyTrace || result?.latencyTrace || null;
      const merged = {
        traceId,
        strategy: this.strategy,
        client: this.toPayload(),
        server: serverTrace,
        milestones: {
          userRun: milestones.userRun ?? 0,
          commandParsed: milestones.commandParsed ?? null,
          requestDispatched: milestones.requestDispatched ?? null,
          browserReceipt: milestones.browserReceipt ?? null,
          graphicsLayerInsert: milestones.graphicsLayerInsert ?? null,
          firstRenderedFeature: milestones.firstRenderedFeature ?? null,
          initialLayerReady: milestones.initialLayerReady ?? null
        },
        result: {
          eventCount: result?.normalized?.events?.length ?? result?.raw?.events?.length ?? 0,
          mappedCount: result?.normalized?.mappableEvents?.length ?? result?.raw?.combined?.mappable ?? 0,
          providersInvoked: summarizeProviders(result?.raw?.researchAudit)
        }
      };
      if (serverTrace) {
        merged.merged = mergeTraces(serverTrace, merged.milestones, merged.client.spans);
      }
      activeTrace = null;
      if (typeof window !== 'undefined') {
        window.__IQAI_LAST_LATENCY_TRACE__ = merged;
      }
      return merged;
    }
  };

  activeTrace = trace;
  if (typeof window !== 'undefined') {
    window.__IQAI_ACTIVE_LATENCY_TRACE__ = trace;
  }
  return trace;
}

export function getActiveClientLatencyTrace() {
  return activeTrace;
}

function summarizeProviders(audit = {}) {
  const invoked = [];
  if (audit.geminiInvoked) invoked.push('GEMINI');
  if (audit.grokInvoked) invoked.push('GROK_XAI');
  if (audit.openaiInvoked) invoked.push('OPENAI');
  if (audit.deepseekInvoked) invoked.push('DEEPSEEK');
  if (audit.iqaiCorpusInvoked) invoked.push('IQAI_CORPUS');
  return invoked;
}

function mergeTraces(serverTrace, clientMilestones, clientSpans) {
  const serverMilestones = serverTrace.milestones || {};
  const merged = {
    ...serverMilestones,
    timeToBrowserReceiptMs: clientMilestones.browserReceipt ?? null,
    timeToGraphicsLayerInsertMs: clientMilestones.graphicsLayerInsert ?? null,
    timeToFirstRenderedFeatureMs: clientMilestones.firstRenderedFeature ?? null,
    timeToInitialLayerReadyMs: clientMilestones.initialLayerReady ?? null
  };
  const firstPoint = merged.timeToFirstRenderedFeatureMs ?? merged.timeToFirstMappableEventMs;
  const agent2Total = serverTrace.agent2?.totalMs || 0;
  return {
    milestones: merged,
    firstMapPointMs: firstPoint,
    initialLayerMs: merged.timeToInitialLayerReadyMs,
    fullResearchMs: merged.totalResearchCompleteMs,
    agent2PercentOfFirstPointLatency: firstPoint
      ? Number(((agent2Total / firstPoint) * 100).toFixed(1))
      : null,
    clientSpans
  };
}
