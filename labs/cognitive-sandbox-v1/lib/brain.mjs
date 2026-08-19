import { cloneReadonlySnapshot, validateCognitiveResponse } from './contracts.mjs';
import { groundingEnvelope } from './grounding.mjs';
import { DeterministicMockAdapter } from './model-adapters.mjs';

function selectionPrompt(snapshot, envelope) {
  const compactSnapshot = JSON.stringify(snapshot);
  const compactEnvelope = JSON.stringify({
    question: envelope.question,
    intent: envelope.intent,
    known: envelope.known,
    unknown: envelope.unknown,
    inferenceCandidates: envelope.inferenceCandidates,
    actionCandidates: envelope.actionCandidates.map(({ id, actionType, label, reason }) => ({
      id,
      actionType,
      label,
      reason
    }))
  });
  return [
    'You are the bounded IQAI Cognitive Sandbox candidate selector.',
    'The WorldStateSnapshot is read-only. You have no tools and execute nothing.',
    'Deterministic KNOWN facts and UNKNOWN gaps were computed outside the model.',
    'Select only IDs that appear in the supplied inferenceCandidates and actionCandidates.',
    'Never create facts, entities, places, objects, people, incidents, history, or action IDs.',
    'Visual media, if ever present, cannot override GIS identity, source authority, geometry, or time.',
    'Return exactly one JSON object: {"inferenceIds":["id"],"actionIds":["id"]}.',
    'Select zero to three action IDs. Use empty arrays when no candidate applies.',
    `WorldStateSnapshot=${compactSnapshot}`,
    `GroundingEnvelope=${compactEnvelope}`
  ].join('\n');
}

function parseSelection(text) {
  if (typeof text !== 'string') throw new TypeError('Model output must be text');
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const parsed = JSON.parse(cleaned);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new TypeError('Model selection must be an object');
  }
  if (!Array.isArray(parsed.inferenceIds) || !Array.isArray(parsed.actionIds)) {
    throw new TypeError('Model selection arrays are required');
  }
  if (
    !parsed.inferenceIds.every((id) => typeof id === 'string') ||
    !parsed.actionIds.every((id) => typeof id === 'string')
  ) {
    throw new TypeError('Model selection IDs must be strings');
  }
  return parsed;
}

function applySelection(envelope, selection) {
  const inferenceById = new Map(envelope.inferenceCandidates.map((candidate) => [candidate.id, candidate]));
  const actionById = new Map(envelope.actionCandidates.map((candidate) => [candidate.id, candidate]));
  const inferred = [...new Set(selection.inferenceIds)]
    .map((id) => inferenceById.get(id))
    .filter(Boolean)
    .map((candidate) => candidate.statement);
  const proposedActions = [...new Set(selection.actionIds)]
    .slice(0, 3)
    .map((id) => actionById.get(id))
    .filter(Boolean)
    .map(({ id: _id, ...action }) => action);
  return { inferred, proposedActions };
}

function deterministicSummary(envelope) {
  if (envelope.known.length > 0) {
    const first = envelope.known[0];
    const unresolved = envelope.unknown.length;
    return unresolved > 0
      ? `${first} ${unresolved} relevant gap${unresolved === 1 ? '' : 's'} ${unresolved === 1 ? 'remains' : 'remain'}.`
      : first;
  }
  if (envelope.unknown.length > 0) return envelope.unknown[0];
  return 'The supplied snapshot does not support a more specific answer.';
}

export class CognitiveBrain {
  constructor(adapter) {
    if (!adapter || typeof adapter.generate !== 'function' || typeof adapter.health !== 'function' || typeof adapter.metadata !== 'function') {
      throw new TypeError('A replaceable BrainModelAdapter is required');
    }
    this.adapter = adapter;
  }

  async reason(snapshotInput, question, { media = [] } = {}) {
    const snapshot = cloneReadonlySnapshot(snapshotInput);
    const normalizedQuestion = String(question ?? '').trim();
    if (!normalizedQuestion) throw new TypeError('question is required');
    if (normalizedQuestion.length > 1000) throw new TypeError('question must not exceed 1000 characters');
    if (!Array.isArray(media)) throw new TypeError('media must be an array');

    const envelope = groundingEnvelope(snapshot, normalizedQuestion);
    const startedAt = performance.now();
    let rawSelection;
    let status = 'READY';
    let warning = null;

    try {
      rawSelection = await this.adapter.generate({
        prompt: selectionPrompt(snapshot, envelope),
        media,
        selectionContext: envelope
      });
    } catch (error) {
      status = 'DEGRADED_SAFE_FALLBACK';
      warning = `Local model selection failed; deterministic safe fallback used: ${error.message}`;
      rawSelection = await new DeterministicMockAdapter().generate({ selectionContext: envelope });
    }

    let selection;
    try {
      selection = parseSelection(rawSelection);
    } catch (error) {
      status = 'DEGRADED_SAFE_FALLBACK';
      warning = `Model returned invalid structured selection; deterministic safe fallback used: ${error.message}`;
      const fallback = await new DeterministicMockAdapter().generate({ selectionContext: envelope });
      selection = parseSelection(fallback);
    }

    const latencyMs = Math.round((performance.now() - startedAt) * 10) / 10;
    const selected = applySelection(envelope, selection);
    const metadata = this.adapter.metadata();
    const warnings = [
      'Advisory response only. No action has been executed and no production write path exists.',
      'KNOWN and UNKNOWN are deterministic; the model may only select pre-grounded INFERRED statements and action proposals.'
    ];
    if (snapshot.snapshotId.startsWith('synthetic-test-')) {
      warnings.push('Input is an explicitly synthetic/test WorldStateSnapshot.');
    }
    if (media.length > 0) {
      warnings.push('Visual model input is advisory and cannot alter deterministic GIS identity, geometry, authority, or time.');
    }
    if (metadata.mode === 'MOCK') warnings.push('Deterministic mock adapter is active; this is not a live model inference.');
    if (warning) warnings.push(warning);

    const response = {
      summary: deterministicSummary(envelope),
      known: [...envelope.known],
      inferred: selected.inferred,
      unknown: [...envelope.unknown],
      proposedActions: selected.proposedActions,
      warnings,
      modelMetadata: {
        provider: metadata.provider,
        model: metadata.model,
        runtime: metadata.runtime,
        mode: metadata.mode,
        status,
        latencyMs,
        loadTimeMs: metadata.lastGenerationMetrics?.loadTimeMs ?? null,
        modelTotalTimeMs: metadata.lastGenerationMetrics?.totalTimeMs ?? null,
        inputSnapshotId: snapshot.snapshotId
      }
    };
    return validateCognitiveResponse(response);
  }
}
