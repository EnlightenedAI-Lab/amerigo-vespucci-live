import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseStreamlitSecretsContent,
  auditReflectiveDiagnosticsSecrets
} from '../src/spatial/intelligence-layer-shared-env.js';

describe('reflective diagnostics secrets.toml loader', () => {
  it('parses streamlit secrets without exposing values in structure', () => {
    const parsed = parseStreamlitSecretsContent(`# comment
OPENAI_API_KEY = "secret-value"
GEMINI_API_KEY="another"
[providers]
DEEPSEEK_API_KEY = "third"
`);
    assert.equal(parsed.OPENAI_API_KEY, 'secret-value');
    assert.equal(parsed.GEMINI_API_KEY, 'another');
    assert.equal(parsed['providers.DEEPSEEK_API_KEY'], 'third');
    assert.equal(parsed.DEEPSEEK_API_KEY, 'third');
  });

  it('audits RD secrets with PRESENT/ABSENT only', () => {
    const audit = auditReflectiveDiagnosticsSecrets();
    assert.ok(['PRESENT', 'ABSENT'].includes(audit.keys.GEMINI_API_KEY));
    assert.ok(['PRESENT', 'ABSENT'].includes(audit.keys.GROK_API_KEY));
    assert.ok(['PRESENT', 'ABSENT'].includes(audit.keys.XAI_API_KEY));
    assert.ok(['PRESENT', 'ABSENT'].includes(audit.keys.DEEPSEEK_API_KEY));
    assert.ok(['PRESENT', 'ABSENT'].includes(audit.keys.OPENAI_API_KEY));
  });
});
