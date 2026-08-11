/**
 * Dev-only Esri map agent pilot surface — NOT a second IQAI front door.
 */
import { isEsriAgenticV1Enabled } from './esri-map-agent-config.js';
import { runEsriMapAgentPilot } from './esri-map-agent-adapter.js';

const PANEL_ID = 'iqai-esri-map-agent-pilot';

function ensurePanel() {
  let el = document.getElementById(PANEL_ID);
  if (el) return el;
  el = document.createElement('div');
  el.id = PANEL_ID;
  el.className = 'iqai-esri-map-agent-pilot';
  el.innerHTML = `
    <div class="iqai-esri-map-agent-pilot__header">IQAI Map Specialist (Phase 5 pilot)</div>
    <input class="iqai-esri-map-agent-pilot__input" type="text" placeholder="Map-local prompt only…" />
    <button type="button" class="iqai-esri-map-agent-pilot__run">Run</button>
    <pre class="iqai-esri-map-agent-pilot__out"></pre>
  `;
  document.body.appendChild(el);
  const input = el.querySelector('.iqai-esri-map-agent-pilot__input');
  const out = el.querySelector('.iqai-esri-map-agent-pilot__out');
  el.querySelector('.iqai-esri-map-agent-pilot__run').addEventListener('click', async () => {
    out.textContent = 'Running…';
    const result = await runEsriMapAgentPilot(input.value);
    out.textContent = JSON.stringify({
      ok: result.ok,
      intent: result.classification?.intent,
      approved: result.approved,
      statistics: result.statistics,
      mutatedMap: result.executionReceipt?.mutatedMap,
      validation: result.validation?.status,
      latencyMs: result.latencyMs
    }, null, 2);
  });
  return el;
}

export function mountEsriMapAgentPilot() {
  if (!isEsriAgenticV1Enabled()) return;
  ensurePanel();
}
