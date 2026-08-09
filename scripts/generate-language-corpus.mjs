/**
 * Generate controlled English/French language examples and tests from verified grammar.
 * Run: node scripts/generate-language-corpus.mjs
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const langDir = join(__dirname, '..', 'src', 'spatial', 'language');

const LOCATIONS = [
  '997 de la Commune',
  '6939 Décarie Boulevard',
  'Old Montreal',
  'Place Jacques-Cartier',
  'McGill University',
  'Jean-Talon Market'
];

const DISTANCES = [1, 2, 3, 4, 5];

const DATASETS = {
  FIRE_STATIONS: {
    en: ['fire stations', 'fire halls', 'firehouses'],
    fr: ['casernes', 'casernes de pompiers', 'postes de pompiers']
  },
  POLICE_STATIONS: {
    en: ['police stations', 'cops', 'PDQ precincts'],
    fr: ['postes de police', 'postes de quartier', 'police']
  },
  HOSPITALS: {
    en: ['hospitals', 'emergency rooms'],
    fr: ['hôpitaux', 'urgences']
  },
  SCHOOLS: {
    en: ['schools', 'public schools'],
    fr: ['écoles', 'écoles publiques']
  },
  TRANSIT: {
    en: ['metro stations', 'transit stops', 'STM stops'],
    fr: ['stations de métro', 'arrêts STM', 'transport en commun']
  }
};

const FILLERS_EN = [
  'show me',
  'can you show me',
  'please show',
  'give me',
  'find me',
  'where are',
  'map',
  'display'
];

const FILLERS_FR = [
  'montre-moi',
  'montre moi',
  'peux-tu montrer',
  'affiche-moi',
  'trouve-moi',
  'où sont'
];

const examplesEn = [];
const examplesFr = [];
const tests = [];

function addExample(lang, text, expect) {
  if (lang === 'en') examplesEn.push({ text, expect });
  else examplesFr.push({ text, expect });
}

function addTest(id, text, expect) {
  tests.push({ id, text, expect });
}

// WITHIN English
for (const filler of FILLERS_EN) {
  for (const [datasetId, phrases] of Object.entries(DATASETS)) {
    for (const phrase of phrases.en) {
      for (const km of DISTANCES) {
        for (const loc of LOCATIONS.slice(0, 3)) {
          const text = `${filler} ${phrase} within ${km} km of ${loc}`;
          addExample('en', text, { action: 'WITHIN', dataset: datasetId, distanceKm: km });
        }
      }
    }
  }
}

// WITHIN French
for (const filler of FILLERS_FR) {
  for (const [datasetId, phrases] of Object.entries(DATASETS)) {
    for (const phrase of phrases.fr) {
      for (const km of DISTANCES) {
        for (const loc of LOCATIONS.slice(0, 2)) {
          const text = `${filler} les ${phrase} dans un rayon de ${km} km de ${loc}`;
          addExample('fr', text, { action: 'WITHIN', dataset: datasetId, distanceKm: km });
        }
      }
    }
  }
}

// NEAREST English
for (const limit of [1, 2, 3, 5]) {
  for (const phrase of DATASETS.POLICE_STATIONS.en) {
    for (const loc of LOCATIONS.slice(0, 4)) {
      addExample('en', `show the ${limit} nearest ${phrase} to ${loc}`, {
        action: 'NEAREST', dataset: 'POLICE_STATIONS', limit
      });
      addExample('en', `where are the ${limit} ${phrase} closest to ${loc}`, {
        action: 'NEAREST', dataset: 'POLICE_STATIONS', limit
      });
    }
  }
}

// NEAREST French
for (const limit of [1, 2, 3]) {
  for (const phrase of DATASETS.POLICE_STATIONS.fr) {
    for (const loc of LOCATIONS.slice(0, 3)) {
      addExample('fr', `montre les ${limit} ${phrase} les plus proches de ${loc}`, {
        action: 'NEAREST', dataset: 'POLICE_STATIONS', limit
      });
    }
  }
}

// LOCATE
for (const loc of LOCATIONS) {
  addExample('en', `put a point at ${loc}`, { action: 'LOCATE' });
  addExample('fr', `placer un point à ${loc}`, { action: 'LOCATE' });
}

// COUNT
for (const km of [3, 5]) {
  for (const loc of LOCATIONS.slice(0, 3)) {
    addExample('en', `how many fire stations are within ${km} km of ${loc}`, {
      action: 'COUNT', dataset: 'FIRE_STATIONS', distanceKm: km
    });
    addExample('fr', `combien de casernes dans un rayon de ${km} km de ${loc}`, {
      action: 'COUNT', dataset: 'FIRE_STATIONS', distanceKm: km
    });
  }
}

// CLEAR
['clear the results', 'clear the map', 'remove results', 'effacer', 'supprimer les résultats'].forEach((text) => {
  addExample(text.includes('effacer') || text.includes('supprimer') ? 'fr' : 'en', text, { action: 'CLEAR' });
});

// SHOW Montreal
for (const phrase of DATASETS.TRANSIT.en) {
  addExample('en', `show ${phrase} in montreal`, { action: 'SHOW', dataset: 'TRANSIT' });
}

// Compound examples
const compoundCases = [
  {
    text: 'map 3 nearest police stations and all fire stations within 4 km of 997 de la Commune',
    expect: { compound: true, commands: 2 }
  },
  {
    text: 'show the 3 nearest police stations and hospitals within 5 km of 997 de la Commune',
    expect: { compound: true, commands: 2 }
  },
  {
    text: 'map fire stations within 4 km and the 3 nearest police stations of 997 de la Commune',
    expect: { compound: true, commands: 2 }
  },
  {
    text: 'put a point at 997 de la Commune and show the nearest 3 police stations',
    expect: { compound: true, commands: 2 }
  },
  {
    text: 'montre les postes de police et les casernes dans un rayon de 3 km de 997 de la Commune',
    expect: { compound: true, commands: 2 }
  }
];

compoundCases.forEach((c) => {
  addExample('en', c.text, c.expect);
  addTest(`compound-${tests.length}`, c.text, c.expect);
});

// Clarification tests
addTest('clarify-show-me', 'show me', { clarification: true });
addTest('clarify-important', 'show me important places nearby', { clarification: true });
addTest('clarify-important-fr', 'montre des lieux importants', { clarification: true });

// Regression
addTest('regression-decarie-fire', 'Map fire stations within 3 km of 6939 Décarie Boulevard.', {
  action: 'WITHIN', dataset: 'FIRE_STATIONS', distanceKm: 3
});

// Dedupe examples
function dedupe(list) {
  const seen = new Set();
  return list.filter((item) => {
    const key = item.text.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

const finalEn = dedupe(examplesEn);
const finalFr = dedupe(examplesFr);

writeFileSync(join(langDir, 'examples.en.json'), JSON.stringify(finalEn, null, 2));
writeFileSync(join(langDir, 'examples.fr.json'), JSON.stringify(finalFr, null, 2));
writeFileSync(join(langDir, 'tests.json'), JSON.stringify(tests, null, 2));

console.log(`Generated ${finalEn.length} EN examples, ${finalFr.length} FR examples, ${tests.length} tests`);
