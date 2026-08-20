/**
 * Present Brain answers over an existing EO receipt.
 * Follow-ups reuse the same receipt/Brain package. They do not re-read the overlay.
 */

export function formatCaptureStamp(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toISOString().slice(0, 10);
}

export function captureFromReceipt(receipt) {
  const scenes = Array.isArray(receipt?.scenes) ? receipt.scenes : [];
  const stamps = scenes.map((scene) => formatCaptureStamp(scene?.captureStart)).filter(Boolean);
  if (stamps.length >= 2) return `${stamps[0]} → ${stamps[1]}`;
  return stamps[0]
    || formatCaptureStamp(receipt?.explain?.observation)
    || formatCaptureStamp(receipt?.measurement?.captureStart)
    || formatCaptureStamp(receipt?.measurement?.captureStartA)
    || null;
}

export function shortAnswer(text) {
  const trimmed = String(text || '').replace(/\s+/g, ' ').trim();
  if (!trimmed) return '';
  const sentences = trimmed.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [trimmed];
  return sentences.slice(0, 2).join(' ').trim();
}

export function followUpQuestions(receipt) {
  const command = receipt?.command;
  const questions = [];
  if (command === 'EO.SURFACE_TEMPERATURE') {
    questions.push(
      'WHERE IS IT HOTTEST?',
      'COMPARE WITH ANOTHER AREA',
      'HAS THIS CHANGED OVER TIME?',
      'WHAT SHOULD I INSPECT NEXT?'
    );
    if (receipt?.measurement?.comparison) questions.push('WHAT DOES THE COMPARISON AREA SHOW?');
  } else if (command === 'EO.NDVI') {
    questions.push(
      'WHERE IS IT GREENEST?',
      'HAS GREENNESS CHANGED?',
      'COMPARE WITH ANOTHER AREA',
      'WHAT SHOULD I INSPECT NEXT?'
    );
  } else if (command === 'EO.SAR_CHANGE') {
    questions.push(
      'WHERE DID RADAR CHANGE MOST?',
      'HAS THIS CHANGED OVER TIME?',
      'COMPARE WITH ANOTHER AREA',
      'WHAT SHOULD I INSPECT NEXT?'
    );
  } else {
    questions.push(
      'WHAT AM I LOOKING AT?',
      'WHAT CHANGED?',
      'WHAT SHOULD I INSPECT NEXT?'
    );
  }
  const unique = [];
  for (const question of questions) {
    if (!unique.includes(question)) unique.push(question);
  }
  return unique.slice(0, 5);
}

export function overlayCaptionText(receipt) {
  const scene = receipt?.scenes?.[0] || {};
  const stamp = captureFromReceipt(receipt);
  const platform = [scene.platform, scene.sensor].filter(Boolean).join(' ')
    || scene.product
    || '';
  const product = receipt?.command === 'EO.SURFACE_TEMPERATURE'
    ? 'SURFACE TEMPERATURE'
    : receipt?.command === 'EO.NDVI'
      ? 'NDVI'
      : receipt?.command === 'EO.SAR_CHANGE'
        ? 'RADAR CHANGE'
        : '';
  return [platform, stamp, product].filter(Boolean).join(' · ');
}

export function formatProbeReadout(probe, receipt) {
  const here = Number(probe?.analysis?.value);
  const mean = Number(receipt?.measurement?.mean);
  const kind = probe?.analysis?.kind;
  const digits = kind === 'ndvi' ? 2 : 1;
  const unit = kind === 'lst' ? ' °C' : kind === 'sar' ? ' dB' : '';
  let versus = '';
  if (Number.isFinite(here) && Number.isFinite(mean)) {
    const delta = here - mean;
    if (Math.abs(delta) < 1e-9) versus = `Same as AOI mean (${mean.toFixed(digits)}${unit})`;
    else {
      const word = delta > 0
        ? (kind === 'lst' ? 'warmer' : 'higher')
        : (kind === 'lst' ? 'cooler' : 'lower');
      versus = `${Math.abs(delta).toFixed(digits)}${unit} ${word} than AOI mean (${mean.toFixed(digits)}${unit})`;
    }
  }
  return {
    label: probe?.analysis?.label || probe?.status || 'NO VALID OBSERVATION',
    versus,
    qa: probe?.status === 'VALID'
      ? 'VALID CELL'
      : probe?.status === 'MASKED'
        ? 'MASKED / NO VALID VALUE'
        : 'NO VALID OBSERVATION',
    lat: probe?.coordinate?.lat ?? null,
    lon: probe?.coordinate?.lon ?? null
  };
}

export function presentBrainResult(payload, receipt) {
  const full = String(
    payload?.answer
    || payload?.meaning
    || payload?.eoResult?.meaning
    || ''
  ).trim();
  const answer = shortAnswer(full) || 'NO BRAIN ANSWER';
  const meaning = String(
    payload?.eoResult?.meaning
    || receipt?.explain?.what
    || receipt?.meaning
    || ''
  ).trim();
  const limits = []
    .concat(payload?.limitations || [])
    .concat(receipt?.limitations || [])
    .concat(receipt?.explain?.limits || [])
    .map((item) => String(item || '').trim())
    .filter(Boolean);
  const limit = limits[0] || '';
  const details = payload ? { ...payload } : null;
  if (details?.input?.eoResult) {
    details.input = {
      ...details.input,
      eoResult: {
        receiptId: details.input.eoResult.receiptId,
        command: details.input.eoResult.command
      }
    };
  }
  return {
    question: payload?.question || '',
    answer,
    meaning: meaning && meaning !== answer ? meaning : (receipt?.explain?.measurement || meaning),
    limit,
    followUps: followUpQuestions(receipt),
    details
  };
}
