import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSpatialAiProviderRegistry,
  SPATIAL_AI_PROVIDER,
  PROVIDER_CAPABILITY
} from '../src/spatial/intelligence-layer-provider-registry.js';
import { buildResearchControlBarModel } from '../public/spatial/intelligence-research-control-bar.js';
import { buildProviderReceipt } from '../src/spatial/intelligence-layer-provider-registry.js';

describe('spatial AI provider registry', () => {
  it('lists all supported providers with capability metadata', () => {
    const registry = buildSpatialAiProviderRegistry();
    const ids = registry.map((entry) => entry.provider);
    assert.ok(ids.includes(SPATIAL_AI_PROVIDER.OPENAI));
    assert.ok(ids.includes(SPATIAL_AI_PROVIDER.GEMINI));
    assert.ok(ids.includes(SPATIAL_AI_PROVIDER.GROK_XAI));
    assert.ok(ids.includes(SPATIAL_AI_PROVIDER.DEEPSEEK));
    assert.ok(ids.includes(SPATIAL_AI_PROVIDER.IQAI_CORPUS));
  });

  it('does not claim web search for DeepSeek', () => {
    const original = process.env.DEEPSEEK_API_KEY;
    process.env.DEEPSEEK_API_KEY = 'test-deepseek';
    const entry = buildSpatialAiProviderRegistry().find((p) => p.provider === SPATIAL_AI_PROVIDER.DEEPSEEK);
    assert.equal(entry.configured, true);
    assert.ok(entry.capabilities.includes(PROVIDER_CAPABILITY.REASONING));
    assert.ok(!entry.capabilities.includes(PROVIDER_CAPABILITY.WEB_SEARCH));
    process.env.DEEPSEEK_API_KEY = original;
  });

  it('builds machine-readable provider receipts', () => {
    const receipt = buildProviderReceipt({
      provider: 'GEMINI',
      model: 'gemini-flash-latest',
      role: 'FAST_SCOUT',
      invoked: true,
      toolsUsed: ['GOOGLE_SEARCH'],
      sourceCount: 4,
      latencyMs: 3200,
      status: 'SUCCESS'
    });
    assert.equal(receipt.provider, 'GEMINI');
    assert.equal(receipt.invoked, true);
    assert.deepEqual(receipt.toolsUsed, ['GOOGLE_SEARCH']);
  });
});

describe('research control bar multi-provider labels', () => {
  it('shows GROK when grok participated in DEEP research', () => {
    const model = buildResearchControlBarModel({
      layers: [{
        normalized: {
          totalEvents: 2,
          mappedCount: 2,
          unresolvedCount: 0,
          researchAudit: {
            geminiInvoked: true,
            openaiInvoked: true,
            grokInvoked: true,
            iqaiCorpusInvoked: true,
            googleSearchInvoked: true,
            webSearchInvoked: true,
            xSearchInvoked: true
          }
        },
        raw: { researchConsolidation: { rawSourceReports: 6 } }
      }]
    });
    assert.equal(model.research.providers, 'GEMINI · GPT · GROK · IQAI');
  });

  it('shows ANALYSIS when DeepSeek consolidation ran', () => {
    const model = buildResearchControlBarModel({
      layers: [{
        normalized: {
          totalEvents: 1,
          mappedCount: 1,
          unresolvedCount: 0,
          researchAudit: {
            geminiInvoked: true,
            deepseekInvoked: true,
            iqaiCorpusInvoked: true
          }
        },
        raw: {}
      }]
    });
    assert.equal(model.analysis, 'DEEPSEEK');
  });
});
