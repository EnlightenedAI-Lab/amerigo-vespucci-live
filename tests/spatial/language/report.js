import fs from 'node:fs';
import path from 'node:path';

export function minimizePrompt(prompt) {
  let p = prompt.toLowerCase();
  p = p.replace(/^(please|can you|could you|i want to|just|for me|now)\s+/i, '');
  p = p.replace(/\s+(please|for me)$/i, '');
  return p.trim();
}

export function groupFailures(failures) {
  const groups = new Map();
  for (const f of failures) {
    const key = f.patternKey || f.category || 'unknown';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(f);
  }
  return [...groups.entries()]
    .map(([pattern, items]) => ({
      pattern,
      count: items.length,
      examples: items.slice(0, 3).map((x) => ({
        id: x.id,
        prompt: x.prompt,
        reduced: minimizePrompt(x.prompt),
        diff: x.diff,
        category: x.category
      }))
    }))
    .sort((a, b) => b.count - a.count);
}

export function inferPatternKey(failure) {
  const p = failure.prompt.toLowerCase();
  if (/turn (both|them|those)/.test(p)) return 'MULTI-LAYER PRONOUN RESOLUTION';
  if (/off$/.test(p) && /\band\b/.test(p) && !/turn off/.test(p)) return 'REVERSED VERB ORDER';
  if (/désactive|montre|cache/i.test(p)) return 'FRENCH PHRASES';
  if (/camras|witin|nerest|reslts|off off|to to/.test(p)) return 'TYPO NORMALIZATION';
  if (/,.*and|nearest.*within/.test(p)) return 'COMPOUND CLAUSE BINDING';
  if (failure.severity === 'high') return 'AMBIGUITY FAIL-CLOSED';
  if (failure.category === 'spatial-multi') return 'MULTI-LAYER WITHIN QUERIES';
  if (failure.category === 'noise' || failure.category === 'typo-noise') return 'NOISE INVARIANCE';
  return failure.category || 'OTHER';
}

export function writeConformanceReport(result, outDir) {
  fs.mkdirSync(outDir, { recursive: true });
  const jsonPath = path.join(outDir, 'latest.json');
  const mdPath = path.join(outDir, 'latest.md');

  fs.writeFileSync(jsonPath, JSON.stringify(result, null, 2));

  const lines = [
    '# IQAI Spatial Language Conformance Report',
    '',
    `Generated: ${result.timestamp}`,
    '',
    '## Summary',
    '',
    `- Individual prompts: ${result.individualPrompts}`,
    `- Conversation sequences: ${result.conversationSequences}`,
    `- Total turns: ${result.totalTurns}`,
    `- Passed: ${result.passed}`,
    `- Failed: ${result.failed}`,
    `- Pass rate: ${result.passRate}%`,
    `- Runtime: ${result.runtimeMs}ms (${result.testsPerSecond} tests/sec)`,
    '',
    '## Categories',
    '',
    ...Object.entries(result.byCategory).map(([k, v]) => `- ${k}: ${v.passed}/${v.total} passed`),
    '',
    '## Severity',
    '',
    `- HIGH failures: ${result.severity.high}`,
    `- MEDIUM failures: ${result.severity.medium}`,
    `- LOW failures: ${result.severity.low}`,
    '',
    '## Top Structural Failure Patterns',
    ''
  ];

  for (const [i, g] of result.topPatterns.entries()) {
    lines.push(`### ${i + 1}. ${g.pattern} (${g.count} failures)`);
    for (const ex of g.examples) {
      lines.push(`- \`${ex.reduced || ex.prompt}\` — ${ex.diff}`);
    }
    lines.push('');
  }

  lines.push('## Unexpected Confident Guesses', '');
  lines.push(`Count: ${result.confidentGuesses.length}`);
  for (const g of result.confidentGuesses.slice(0, 10)) {
    lines.push(`- ${g.prompt} → ${g.diff}`);
  }

  fs.writeFileSync(mdPath, lines.join('\n'));
  return { jsonPath, mdPath };
}
