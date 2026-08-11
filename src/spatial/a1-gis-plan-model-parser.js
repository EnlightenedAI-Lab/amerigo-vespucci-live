/**
 * Strict deterministic parser for live-model GIS plan response envelopes.
 * Treats all model output as hostile input.
 */

const ENVELOPE_TYPES = new Set(['PLAN', 'NEEDS_CLARIFICATION', 'UNSUPPORTED']);

/**
 * @param {string} raw
 */
function extractSingleJsonObject(raw) {
  const text = String(raw || '').trim();
  if (!text) {
    return { ok: false, code: 'MODEL_RESPONSE_EMPTY', message: 'Model response is empty.' };
  }

  const attempts = [text];
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenceMatch) attempts.unshift(fenceMatch[1].trim());

  const firstBrace = text.indexOf('{');
  const lastBrace = text.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    attempts.push(text.slice(firstBrace, lastBrace + 1));
  }

  /** @type {unknown} */
  let parsed = null;
  let lastError = null;
  for (const candidate of attempts) {
    if (!candidate) continue;
    try {
      parsed = JSON.parse(candidate);
      lastError = null;
      break;
    } catch (error) {
      lastError = error;
    }
  }

  if (lastError || parsed == null) {
    return { ok: false, code: 'MODEL_RESPONSE_INVALID', message: 'Model response is not valid JSON.' };
  }

  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, code: 'MODEL_RESPONSE_INVALID', message: 'Model envelope must be a JSON object.' };
  }

  const braceCount = (text.match(/\{/g) || []).length;
  const objectMatches = text.match(/\{[\s\S]*?\}/g) || [];
  if (objectMatches.length > 1 && braceCount > 2) {
    const types = objectMatches
      .map((fragment) => {
        try {
          const obj = JSON.parse(fragment);
          return obj?.type || null;
        } catch {
          return null;
        }
      })
      .filter(Boolean);
    if (new Set(types).size > 1) {
      return {
        ok: false,
        code: 'MODEL_RESPONSE_INVALID',
        message: 'Model returned multiple conflicting JSON objects.'
      };
    }
  }

  return { ok: true, envelope: parsed };
}

/**
 * @param {unknown} envelope
 */
export function parseModelResponseEnvelope(raw) {
  const extracted = extractSingleJsonObject(raw);
  if (!extracted.ok) return extracted;

  const envelope = extracted.envelope;
  const type = String(envelope.type || '').trim().toUpperCase();
  if (!ENVELOPE_TYPES.has(type)) {
    return {
      ok: false,
      code: 'MODEL_RESPONSE_INVALID',
      message: `Unknown envelope type "${envelope.type || ''}".`
    };
  }

  const allowedKeys = new Set(['type']);
  if (type === 'PLAN') allowedKeys.add('plan');
  if (type === 'NEEDS_CLARIFICATION') allowedKeys.add('question');
  if (type === 'UNSUPPORTED') allowedKeys.add('reason');

  const extraKeys = Object.keys(envelope).filter((key) => !allowedKeys.has(key));
  if (extraKeys.length) {
    return {
      ok: false,
      code: 'MODEL_RESPONSE_INVALID',
      message: `Envelope contains unexpected fields: ${extraKeys.join(', ')}.`
    };
  }

  if (type === 'PLAN') {
    if (!envelope.plan || typeof envelope.plan !== 'object' || Array.isArray(envelope.plan)) {
      return {
        ok: false,
        code: 'MODEL_RESPONSE_INVALID',
        message: 'PLAN envelope must include a plan object.'
      };
    }
    return { ok: true, type, plan: envelope.plan };
  }

  if (type === 'NEEDS_CLARIFICATION') {
    const question = String(envelope.question || '').trim();
    if (!question) {
      return {
        ok: false,
        code: 'MODEL_RESPONSE_INVALID',
        message: 'NEEDS_CLARIFICATION requires a question.'
      };
    }
    return { ok: true, type, question };
  }

  const reason = String(envelope.reason || '').trim();
  if (!reason) {
    return {
      ok: false,
      code: 'MODEL_RESPONSE_INVALID',
      message: 'UNSUPPORTED requires a reason.'
    };
  }
  return { ok: true, type, reason };
}
