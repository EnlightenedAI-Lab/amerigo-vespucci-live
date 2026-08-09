#!/usr/bin/env node
/**
 * IQAI Spatial Language Conformance Lab runner.
 * Usage: node scripts/run-language-conformance.mjs
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runConformanceLab } from '../tests/spatial/language/run-conformance.js';
import { writeConformanceReport } from '../tests/spatial/language/report.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const outDir = path.join(root, 'artifacts', 'language-conformance');

const result = runConformanceLab({
  seed: 42,
  targetPrompts: 12000,
  targetSequences: 1200
});

const { jsonPath, mdPath } = writeConformanceReport(result, outDir);

console.log('IQAI SPATIAL LANGUAGE CONFORMANCE LAB V1');
console.log('Individual prompts generated:', result.individualPrompts);
console.log('Conversation sequences:', result.conversationSequences);
console.log('Total turns tested:', result.totalTurns);
console.log('Passed:', result.passed);
console.log('Failed:', result.failed);
console.log('Pass rate:', result.passRate + '%');
console.log('Runtime:', result.runtimeMs + 'ms');
console.log('Tests/sec:', result.testsPerSecond);
console.log('HIGH failures:', result.severity.high);
console.log('Report:', jsonPath);
console.log('Markdown:', mdPath);
