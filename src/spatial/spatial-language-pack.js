import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { VERIFIED_DATASETS, DATASET_IDS } from './dataset-registry.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const LANG_DIR = join(__dirname, 'language');

function readJson(name) {
  return JSON.parse(readFileSync(join(LANG_DIR, name), 'utf8'));
}

let _pack = null;

export function loadLanguagePack() {
  if (_pack) return _pack;
  const filler = readJson('filler.json');
  const actions = readJson('actions.json');
  const datasets = readJson('datasets.json');
  const relations = readJson('spatial-relations.json');
  let examplesEn = [];
  let examplesFr = [];
  let tests = [];
  try {
    examplesEn = readJson('examples.en.json');
  } catch { /* optional until generated */ }
  try {
    examplesFr = readJson('examples.fr.json');
  } catch { /* optional */ }
  try {
    tests = readJson('tests.json');
  } catch { /* optional */ }

  _pack = {
    filler,
    actions,
    datasets,
    relations,
    examplesEn,
    examplesFr,
    tests
  };
  return _pack;
}

export function getLanguageExampleCount() {
  const pack = loadLanguagePack();
  return (pack.examplesEn?.length || 0) + (pack.examplesFr?.length || 0);
}

/** Merge registry aliases with language pack aliases. */
export function getDatasetAliasMap() {
  const pack = loadLanguagePack();
  const map = new Map();

  for (const dataset of VERIFIED_DATASETS) {
    const packAliases = pack.datasets[dataset.id]?.aliases || [];
    const allAliases = [...dataset.aliases, ...packAliases];
    for (const alias of allAliases) {
      const norm = normalizeForMatch(alias);
      if (!map.has(norm)) map.set(norm, dataset.id);
    }
    map.set(normalizeForMatch(dataset.pluralLabel), dataset.id);
    map.set(normalizeForMatch(dataset.displayName), dataset.id);
  }
  return map;
}

export function normalizeForMatch(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function stripFillerWords(text) {
  const pack = loadLanguagePack();
  let result = normalizePrompt(text);
  const allFillers = [...(pack.filler.en || []), ...(pack.filler.fr || [])];
  for (const filler of allFillers.sort((a, b) => b.length - a.length)) {
    const escaped = escapeRegex(filler);
    result = result.replace(new RegExp(`^${escaped}\\s+`, 'i'), '');
    result = result.replace(new RegExp(`\\s+${escaped}$`, 'i'), '');
    result = result.replace(new RegExp(`^${escaped}$`, 'i'), '');
  }
  // Hyphenated fillers that may not match word-boundary loops above
  result = result.replace(/^montre-moi\s+/i, '').replace(/^affiche-moi\s+/i, '').trim();
  return result.trim();
}

export function normalizePrompt(text) {
  return String(text || '')
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[.?!]+$/g, '')
    .trim();
}

export function normalizeNumerals(text) {
  const pack = loadLanguagePack();
  const numerals = pack.filler.numerals || {};
  let result = text;
  for (const [word, num] of Object.entries(numerals)) {
    result = result.replace(new RegExp(`\\b${escapeRegex(word)}\\b`, 'gi'), String(num));
  }
  return result;
}

function escapeRegex(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export const CLARIFICATION = {
  specifyWhat: 'Please specify what you want to map.',
  specifyDataset: 'Please specify a verified dataset, for example police stations, fire stations, hospitals, schools, or transit.',
  specifyDistance: '"Near" requires a distance. Example: Show police stations within 3 km of 997 de la Commune.',
  noPreviousLocation: 'No previous location is available. Please specify an address or place.'
};

export { DATASET_IDS };
