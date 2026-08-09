/**
 * Official SPVM crime categories — deterministic French → English UI labels.
 */

export const SPVM_ALL_SHIFTS = ['jour', 'soir', 'nuit'];

export const SPVM_SHIFT_UI = [
  { key: 'ALL', shifts: SPVM_ALL_SHIFTS, label: 'ALL' },
  { key: 'DAY', shifts: ['jour'], label: 'DAY' },
  { key: 'EVENING', shifts: ['soir'], label: 'EVENING' },
  { key: 'NIGHT', shifts: ['nuit'], label: 'NIGHT' }
];

export const SPVM_CATEGORY_DEFS = [
  {
    french: 'Vol de véhicule à moteur',
    english: 'Vehicle Theft',
    color: [47, 79, 132, 0.92],
    outline: [255, 255, 255, 0.9]
  },
  {
    french: 'Vol dans / sur véhicule à moteur',
    english: 'Theft From Vehicle',
    color: [0, 122, 194, 0.92],
    outline: [255, 255, 255, 0.9]
  },
  {
    french: 'Introduction',
    english: 'Break & Enter',
    color: [166, 97, 26, 0.92],
    outline: [255, 255, 255, 0.9]
  },
  {
    french: 'Méfait',
    english: 'Mischief',
    color: [117, 112, 179, 0.92],
    outline: [255, 255, 255, 0.9]
  },
  {
    french: 'Vols qualifiés',
    english: 'Robbery',
    color: [214, 39, 40, 0.92],
    outline: [255, 255, 255, 0.9]
  },
  {
    french: 'Infractions entrainant la mort',
    english: 'Death-Related Offence',
    color: [27, 27, 27, 0.95],
    outline: [255, 255, 255, 0.85],
    size: 7
  }
];

export const SPVM_ALL_CATEGORIES = SPVM_CATEGORY_DEFS.map((entry) => entry.french);

const englishByFrench = new Map(SPVM_CATEGORY_DEFS.map((entry) => [entry.french, entry.english]));
const defByFrench = new Map(SPVM_CATEGORY_DEFS.map((entry) => [entry.french, entry]));

export function englishLabelForCategory(french) {
  return englishByFrench.get(french) || String(french || '—');
}

export function categoryDefForFrench(french) {
  return defByFrench.get(french) || null;
}

export function shiftUiLabelForValue(shift) {
  const key = String(shift || '').trim().toLowerCase();
  if (key === 'jour') return 'Day';
  if (key === 'soir') return 'Evening';
  if (key === 'nuit') return 'Night';
  return String(shift || '—');
}

export function matchFrenchCategoryFromPhrase(text) {
  const normalized = String(text || '').trim().toLowerCase();
  if (!normalized) return null;
  if (/vehicle theft|vol de véhicule|vol de vehicule/i.test(normalized)) {
    return 'Vol de véhicule à moteur';
  }
  if (/theft from vehicle|vol dans|vol sur véhicule|vol sur vehicule/i.test(normalized)) {
    return 'Vol dans / sur véhicule à moteur';
  }
  if (/break\s*&?\s*enter|introduction/i.test(normalized)) {
    return 'Introduction';
  }
  if (/mischief|méfait|mefait/i.test(normalized)) {
    return 'Méfait';
  }
  if (/robbery|vols qualifiés|vols qualifies/i.test(normalized)) {
    return 'Vols qualifiés';
  }
  if (/death-related|infractions entrainant la mort/i.test(normalized)) {
    return 'Infractions entrainant la mort';
  }
  return null;
}
