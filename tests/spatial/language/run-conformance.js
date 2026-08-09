import { generatePromptCases } from './prompt-generator.js';
import { generateConversationSequences } from './conversation-generator.js';
import { executeCase, comparePlans } from './canonical-plan.js';
import { FIXTURE_CATALOG } from './fixtures/catalog.js';
import { groupFailures, inferPatternKey, minimizePrompt, writeConformanceReport } from './report.js';

const XAI_CALLS = 0;
const GROK_CALLS = 0;
const LIVE_ARCGIS_CALLS = 0;

export function runConformanceLab(options = {}) {
  const start = Date.now();
  const catalog = options.catalog || FIXTURE_CATALOG;
  const promptCases = generatePromptCases({
    seed: options.seed ?? 42,
    targetPrompts: options.targetPrompts ?? 12000
  });
  const sequences = generateConversationSequences({
    seed: options.seed ?? 42,
    targetSequences: options.targetSequences ?? 1200
  });

  const failures = [];
  const confidentGuesses = [];
  const byCategory = {};
  let passed = 0;
  let failed = 0;
  let totalTurns = 0;

  const runOne = (caseDef) => {
    const cat = caseDef.category || 'unknown';
    if (!byCategory[cat]) byCategory[cat] = { passed: 0, total: 0 };
    byCategory[cat].total += 1;

    try {
      const { actual } = executeCase(caseDef, catalog);
      const cmp = comparePlans(caseDef.expected, actual);
      if (cmp.equal) {
        passed += 1;
        byCategory[cat].passed += 1;
      } else {
        failed += 1;
        const failure = {
          id: caseDef.id,
          seed: caseDef.seed,
          category: caseDef.category,
          language: caseDef.language,
          prompt: caseDef.prompt,
          context: caseDef.context,
          expected: caseDef.expected,
          actual,
          diff: cmp.diff,
          severity: caseDef.severity || 'medium',
          patternKey: inferPatternKey({ ...caseDef, diff: cmp.diff })
        };
        failures.push(failure);
        if (caseDef.severity === 'high' && actual.kind !== 'clarification') {
          confidentGuesses.push(failure);
        }
      }
    } catch (error) {
      failed += 1;
      failures.push({
        id: caseDef.id,
        category: caseDef.category,
        prompt: caseDef.prompt,
        diff: String(error.message || error),
        severity: caseDef.severity || 'medium',
        patternKey: 'RUNTIME ERROR'
      });
    }
  };

  for (const c of promptCases) runOne(c);

  for (const seq of sequences) {
    for (const turn of seq.turns) {
      totalTurns += 1;
      runOne({
        id: `${seq.id}-turn`,
        seed: seq.seed,
        category: `conversation-${seq.name}`,
        language: seq.language,
        path: turn.path,
        prompt: turn.prompt,
        context: turn.context,
        expected: turn.expected,
        severity: 'medium'
      });
    }
  }

  const runtimeMs = Date.now() - start;
  const total = passed + failed;
  const topPatterns = groupFailures(failures.map((f) => ({
    ...f,
    reduced: minimizePrompt(f.prompt)
  })));

  const result = {
    timestamp: new Date().toISOString(),
    individualPrompts: promptCases.length,
    conversationSequences: sequences.length,
    totalTurns: promptCases.length + totalTurns,
    passed,
    failed,
    passRate: total ? Number(((passed / total) * 100).toFixed(2)) : 0,
    runtimeMs,
    testsPerSecond: total ? Number((total / (runtimeMs / 1000)).toFixed(1)) : 0,
    byCategory,
    severity: {
      high: failures.filter((f) => f.severity === 'high').length,
      medium: failures.filter((f) => f.severity === 'medium').length,
      low: failures.filter((f) => f.severity === 'low').length
    },
    topPatterns: topPatterns.slice(0, 10),
    confidentGuesses,
    failuresSample: failures.slice(0, 200),
    xaiCalls: XAI_CALLS,
    grokCalls: GROK_CALLS,
    liveArcGisCalls: LIVE_ARCGIS_CALLS,
    productionParserChanged: false,
    productionRuntimeChanged: false,
    scopedZoomStatus: 'DEFERRED'
  };

  return result;
}
