#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import { runMixedTrailingConformance } from '../tests/spatial/language/run-mixed-trailing-conformance.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const outDir = path.join(root, 'artifacts', 'language-conformance');

const result = runMixedTrailingConformance({ seed: 42 });
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'mixed-trailing-latest.json'), JSON.stringify(result, null, 2));

console.log('IQAI MIXED TRAILING VISIBILITY SUPPLEMENTAL SUITE');
console.log('Cases:', result.totalCases);
console.log('Passed:', result.passed);
console.log('Failed:', result.failed);
console.log('Pass rate:', result.passRate + '%');
console.log('Opposite-action executions:', result.oppositeExecutions);
console.log('Dropped clauses:', result.droppedClauses);
console.log('Partial executions:', result.partialExecutions);
console.log('Runtime:', result.runtimeMs + 'ms');
