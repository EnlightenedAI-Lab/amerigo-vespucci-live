/**
 * Strip recognized leading conversational filler before layer verb matching.
 * Does not remove semantic command verbs (e.g. keeps "show me" intact).
 */

const LEADING_CONVERSATIONAL_PREFIXES = [
  'i want to',
  'could you',
  'can you',
  'for me',
  'please',
  'just',
  'now'
];

function escapeRegex(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Remove one leading conversational prefix from normalized prompt text.
 * @param {string} normalized
 */
export function stripLeadingConversationalFiller(normalized) {
  let text = String(normalized || '').trim();
  if (!text) return text;

  for (const prefix of LEADING_CONVERSATIONAL_PREFIXES) {
    const re = new RegExp(`^${escapeRegex(prefix)}\\s+`, 'i');
    if (re.test(text)) {
      return text.replace(re, '').trim();
    }
  }

  return text;
}
