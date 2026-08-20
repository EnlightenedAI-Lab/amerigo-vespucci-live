/**
 * IMAGE DATE is capture/acquisition only.
 * Publication/release never becomes IMAGE DATE.
 * Year-only stays a year. Do not mint 01 JAN YYYY.
 */

import { CAPTURE_PRECISION } from '../imagery-contract.js';

const MONTHS = Object.freeze([
  'JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN',
  'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'
]);

export const IMAGE_DATE_UNKNOWN = 'DATE UNKNOWN';

function monthName(month) {
  const index = Number(month) - 1;
  return MONTHS[index] || null;
}

export function formatImageDate(observation) {
  if (!observation) return IMAGE_DATE_UNKNOWN;
  const precision = observation.capturePrecision || observation.precision || null;
  const capture = observation.captureDate || observation.acquisitionDate || null;
  const range = observation.captureDateRange || observation.vintageLabel || null;

  if (precision === CAPTURE_PRECISION.DAY || /^\d{4}-\d{2}-\d{2}$/.test(String(capture || ''))) {
    const iso = String(capture).slice(0, 10);
    const [year, month, day] = iso.split('-');
    const label = monthName(month);
    if (year && label && day) return `${Number(day)} ${label} ${year}`;
  }

  const monthText = String(range || capture || '');
  if (precision === CAPTURE_PRECISION.MONTH || /^\d{4}-\d{2}$/.test(monthText)) {
    const [year, month] = monthText.split('-');
    const label = monthName(month);
    if (year && label) return `${label} ${year}`;
  }

  const yearText = String(range || capture || observation.vintageYear || '');
  if (precision === CAPTURE_PRECISION.YEAR || /^\d{4}$/.test(yearText)) {
    return yearText.slice(0, 4);
  }

  return IMAGE_DATE_UNKNOWN;
}

export function imageDateFromObservation(observation) {
  return {
    imageDate: formatImageDate(observation),
    captureDate: observation?.captureDate || observation?.acquisitionDate || null,
    capturePrecision: observation?.capturePrecision || CAPTURE_PRECISION.UNKNOWN,
    publicationDate: observation?.publicationDate || observation?.releaseDate || null
  };
}

export function publicationBelongsInSourceDetails(observation) {
  return Boolean(observation?.publicationDate || observation?.releaseDate);
}
