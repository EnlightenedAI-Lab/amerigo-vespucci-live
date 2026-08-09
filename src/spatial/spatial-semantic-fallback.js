/**
 * Local semantic fallback using Xenova/multilingual-e5-small (MIT).
 *
 * Model weights are NOT stored in Git. On first use, @huggingface/transformers
 * downloads to the Hugging Face cache (default: ~/.cache/huggingface/hub).
 * Set HF_HOME or TRANSFORMERS_CACHE to override.
 *
 * The semantic model only proposes ACTION and DATASET candidates.
 * Numbers, distances, and locations remain deterministic.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { normalizeForMatch, CLARIFICATION } from './spatial-language-pack.js';
import { DATASET_IDS } from './dataset-registry.js';

const MODEL_ID = 'Xenova/multilingual-e5-small';
const __dirname = dirname(fileURLToPath(import.meta.url));

const ACTION_LABELS = {
  LOCATE: 'locate address on map',
  SHOW: 'show all features on map',
  WITHIN: 'features within distance radius',
  NEAREST: 'nearest closest features limit count',
  INSIDE: 'features inside boundary',
  COUNT: 'count how many features',
  FILTER: 'filter features',
  CLEAR: 'clear remove map results'
};

const DATASET_LABELS = {
  [DATASET_IDS.FIRE_STATIONS]: 'fire station firehouse caserne pompiers',
  [DATASET_IDS.POLICE_STATIONS]: 'police station cops precinct poste de police',
  [DATASET_IDS.SCHOOLS]: 'school école schools',
  [DATASET_IDS.HOSPITALS]: 'hospital emergency room hôpital urgence',
  [DATASET_IDS.TRANSIT]: 'metro subway transit STM station'
};

const MIN_SIMILARITY = 0.72;
const MIN_MARGIN = 0.04;

let _pipeline = null;
let _embeddingCache = null;
let _loadAttempted = false;
let _loadError = null;
let _firstLoadMs = null;
let _warmLoadMs = null;

function readActionsJson() {
  const actions = JSON.parse(readFileSync(join(__dirname, 'language', 'actions.json'), 'utf8'));
  return Object.entries(actions).flatMap(([action, meta]) =>
    (meta.labels || []).slice(0, 4).map((phrase) => ({
      action,
      text: `query: ${phrase}`
    }))
  );
}

async function loadPipeline() {
  if (_pipeline) return _pipeline;
  if (_loadAttempted && _loadError) return null;
  _loadAttempted = true;
  const start = Date.now();
  try {
    const { pipeline } = await import('@huggingface/transformers');
    _pipeline = await pipeline('feature-extraction', MODEL_ID, { quantized: true });
    const elapsed = Date.now() - start;
    if (_firstLoadMs == null) _firstLoadMs = elapsed;
    _warmLoadMs = elapsed;
    return _pipeline;
  } catch (error) {
    _loadError = error;
    return null;
  }
}

async function embedTexts(pipe, texts) {
  const outputs = await pipe(texts, { pooling: 'mean', normalize: true });
  return outputs.tolist();
}

function cosineSimilarity(a, b) {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot;
}

function rankCandidates(queryVec, labels) {
  const scored = labels.map((item) => ({
    ...item,
    score: cosineSimilarity(queryVec, item.vector)
  }));
  scored.sort((a, b) => b.score - a.score);
  return scored;
}

async function buildCanonicalEmbeddings(pipe) {
  if (_embeddingCache) return _embeddingCache;
  const actionEntries = readActionsJson();

  const datasetEntries = Object.entries(DATASET_LABELS).map(([id, text]) => ({
    datasetId: id,
    text: `query: ${text}`
  }));

  const allTexts = [...actionEntries.map((e) => e.text), ...datasetEntries.map((e) => e.text)];
  const vectors = await embedTexts(pipe, allTexts);

  let idx = 0;
  const actionLabels = actionEntries.map((entry) => ({
    action: entry.action,
    vector: vectors[idx++]
  }));
  const datasetLabels = datasetEntries.map((entry) => ({
    datasetId: entry.datasetId,
    vector: vectors[idx++]
  }));

  _embeddingCache = { actionLabels, datasetLabels };
  return _embeddingCache;
}

export async function isSemanticFallbackAvailable() {
  try {
    await import('@huggingface/transformers');
    return true;
  } catch {
    return false;
  }
}

export function getSemanticLatencyMetrics() {
  return {
    firstLoadMs: _firstLoadMs,
    warmLoadMs: _warmLoadMs
  };
}

/**
 * Propose action/dataset from text when rules fail.
 * @param {string} text
 */
export async function proposeSemanticCandidates(text) {
  const normalized = normalizeForMatch(text);
  if (!normalized) {
    return { supported: false, clarification: CLARIFICATION.specifyWhat };
  }

  if (/important places|nearby$/i.test(text)) {
    return { supported: false, clarification: CLARIFICATION.specifyDataset };
  }

  const pipe = await loadPipeline();
  if (!pipe) {
    return { supported: false };
  }

  const start = Date.now();
  const cache = await buildCanonicalEmbeddings(pipe);
  const queryVecs = await embedTexts(pipe, [`query: ${text}`]);
  const queryVec = queryVecs[0];
  if (_warmLoadMs == null) _warmLoadMs = Date.now() - start;

  const actionRank = rankCandidates(queryVec, cache.actionLabels);
  const datasetRank = rankCandidates(queryVec, cache.datasetLabels);

  const topAction = actionRank[0];
  const topDataset = datasetRank[0];
  const actionMargin = topAction.score - (actionRank[1]?.score || 0);
  const datasetMargin = topDataset.score - (datasetRank[1]?.score || 0);

  if (
    topAction.score < MIN_SIMILARITY
    || topDataset.score < MIN_SIMILARITY
    || actionMargin < MIN_MARGIN
    || datasetMargin < MIN_MARGIN
  ) {
    if (/important places/i.test(text)) {
      return { supported: false, clarification: CLARIFICATION.specifyDataset };
    }
    return { supported: false, clarification: CLARIFICATION.specifyWhat };
  }

  // Only propose — reconstruct a simple SHOW template for replanning if distances present in text
  const within = text.match(/within\s+(\d+(?:\.\d+)?)\s*km/i)
    || text.match(/(\d+(?:\.\d+)?)\s*km/i);
  const nearest = text.match(/(\d+)\s+(?:nearest|closest)/i)
    || text.match(/nearest\s+(\d+)/i);

  let reconstructed = text;
  const datasetPhrase = topDataset.datasetId === DATASET_IDS.POLICE_STATIONS
    ? 'police stations'
    : topDataset.datasetId === DATASET_IDS.FIRE_STATIONS
      ? 'fire stations'
      : topDataset.datasetId === DATASET_IDS.HOSPITALS
        ? 'hospitals'
        : topDataset.datasetId === DATASET_IDS.SCHOOLS
          ? 'schools'
          : 'transit';

  if (topAction.action === 'WITHIN' && within) {
    reconstructed = `show ${datasetPhrase} within ${within[1]} km ${text.match(/(?:of|from|de)\s+(.+)$/i)?.[0] || ''}`.trim();
  } else if (topAction.action === 'NEAREST' && nearest) {
    reconstructed = `show ${nearest[1]} nearest ${datasetPhrase} ${text.match(/(?:to|of|de)\s+(.+)$/i)?.[0] || ''}`.trim();
  } else if (topAction.action === 'SHOW') {
    reconstructed = `show ${datasetPhrase}`;
  }

  return {
    supported: true,
    proposedAction: topAction.action,
    proposedDatasetId: topDataset.datasetId,
    actionScore: topAction.score,
    datasetScore: topDataset.score,
    reconstructedPrompt: reconstructed
  };
}
