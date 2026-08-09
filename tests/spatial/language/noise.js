/** Human language noise transforms — deterministic typo/filler variants. */

const TYPO_MAP = {
  cameras: 'camras',
  within: 'witin',
  nearest: 'nerest',
  results: 'reslts',
  turn: 'tun',
  off: 'of',
  show: 'shw',
  police: 'polce',
  hospitals: 'hospitls'
};

const FILLERS = ['please', 'can you', 'could you', 'I want to', 'just', 'for me', 'now'];

export function applyCapitalization(text, mode, rng) {
  if (mode === 'lower') return text.toLowerCase();
  if (mode === 'upper') return text.toUpperCase();
  if (mode === 'title') return text.replace(/\b\w/g, (c) => c.toUpperCase());
  return text;
}

export function applyPunctuation(text, mode) {
  if (mode === 'none') return text.replace(/[.?!,]+$/g, '');
  if (mode === 'period') return text.replace(/[.?!]+$/g, '') + '.';
  if (mode === 'question') return text.replace(/[.?!]+$/g, '') + '?';
  if (mode === 'comma') return text.replace(/\s+and\s+/gi, ', ');
  return text;
}

export function applyFiller(text, filler) {
  if (!filler) return text;
  return `${filler} ${text}`;
}

export function applyDuplicateFiller(text) {
  return text
    .replace(/\bto\b/gi, 'to to')
    .replace(/\bthe\b/gi, 'the the')
    .replace(/\boff\b/gi, 'off off');
}

export function applyTypo(text, rng) {
  let out = text;
  for (const [word, typo] of Object.entries(TYPO_MAP)) {
    const re = new RegExp(`\\b${word}\\b`, 'gi');
    if (re.test(out) && rng() < 0.35) {
      out = out.replace(re, typo);
    }
  }
  return out;
}

export function applyWordOrderHide(text, layers) {
  if (layers.length < 2) return text;
  const joined = layers.join(' and ');
  return `${joined} off`;
}

export function generateNoiseVariants(basePrompt, rng, maxVariants = 8) {
  const variants = new Set([basePrompt]);
  const caps = ['original', 'lower', 'upper'];
  const punct = ['none', 'period', 'question'];
  for (const cap of caps) {
    for (const p of punct) {
      let v = applyCapitalization(basePrompt, cap, rng);
      v = applyPunctuation(v, p);
      variants.add(v);
      if (variants.size >= maxVariants) break;
    }
  }
  if (rng() < 0.5) variants.add(applyFiller(basePrompt, pickFiller(rng)));
  if (rng() < 0.3) variants.add(applyDuplicateFiller(basePrompt));
  if (rng() < 0.4) variants.add(applyTypo(basePrompt, rng));
  return [...variants].slice(0, maxVariants);
}

function pickFiller(rng) {
  return FILLERS[Math.floor(rng() * FILLERS.length)];
}
