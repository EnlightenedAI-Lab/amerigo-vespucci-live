import { interpretSpatialLanguage } from '../../../src/spatial/spatial-language-interpreter.js';
import { planCompoundPrompt } from '../../../src/spatial/spatial-compound-planner.js';
import { expandConversationInput } from '../../../public/spatial/spatial-conversation-resolve.js';
import { planLayerAwareClientCommand } from '../../../public/spatial/layer-aware-wiring.js';

/** Normalize canonical plan for semantic comparison. */
export function normalizeExpected(expected) {
  if (!expected) return { kind: 'clarification' };
  const out = { ...expected };
  if (out.layers) out.layers = [...out.layers].sort();
  if (out.datasets) out.datasets = [...out.datasets].sort();
  if (out.datasetIds) out.datasetIds = [...out.datasetIds].sort();
  return out;
}

export function normalizeGisPlan(result) {
  if (!result?.supported) {
    return {
      kind: 'clarification',
      message: result?.message || result?.clarification || 'unsupported'
    };
  }
  const commands = (result.plan?.commands || result.commands || []).map((cmd) => ({
    action: cmd.action,
    layerSource: cmd.layerSource || (cmd.webmapLayer || cmd.webmapCatalogId ? 'WEBMAP' : 'VERIFIED'),
    dataset: cmd.webmapLayer?.title || null,
    datasetIds: [...(cmd.datasetIds || [])].sort(),
    webmapCatalogId: cmd.webmapCatalogId || cmd.webmapLayer?.catalogId || null,
    radiusKm: cmd.distanceKm ?? (cmd.radiusMeters ? cmd.radiusMeters / 1000 : null),
    limit: cmd.limit ?? null,
    location: cmd.resolvedLocation || cmd.location || result.sharedLocation || null,
    activeOnly: cmd.activeOnly || false
  }));
  return {
    kind: 'gis',
    commands,
    sharedLocation: result.sharedLocation || result.plan?.sharedLocation || null
  };
}

export function normalizeConversationExpansion(expanded) {
  if (!expanded?.ok) {
    return { kind: 'clarification', message: expanded?.clarification || 'ambiguous' };
  }
  if (expanded.metaAction) {
    return {
      kind: 'meta',
      metaAction: expanded.metaAction,
      operation: expanded.operation || null,
      scope: expanded.scope || null,
      layers: (expanded.layers || []).map((l) => l.title).sort(),
      layerPhrase: expanded.layerPhrase || null
    };
  }
  return {
    kind: 'expansion',
    expansion: expanded.expansion || null,
    prompt: expanded.prompt || null
  };
}

export function normalizeLayerClientPlan(plan) {
  if (!plan?.handled) {
    return { kind: 'not_handled', reason: plan?.reason || null };
  }
  if (plan.error) {
    return { kind: 'clarification', message: plan.error };
  }
  const layers = (plan.layers || (plan.layer ? [plan.layer] : [])).map((l) => l.title).sort();
  return {
    kind: 'layer_client',
    action: plan.action,
    operation: plan.operation || plan.layerControl?.operation || null,
    layers
  };
}

export function comparePlans(expected, actual) {
  const e = normalizeExpected(expected);
  const a = normalizeExpected(actual);

  if (e.kind !== a.kind) return { equal: false, diff: `kind ${e.kind} vs ${a.kind}` };

  if (e.kind === 'clarification') {
    const ok = Boolean(a.message);
    return { equal: ok, diff: ok ? null : 'expected clarification' };
  }

  if (e.kind === 'meta') {
    const fields = ['metaAction', 'operation', 'scope', 'layerPhrase'];
    for (const f of fields) {
      if (e[f] != null && e[f] !== a[f]) return { equal: false, diff: `${f}: ${e[f]} vs ${a[f]}` };
    }
    if (e.layers && JSON.stringify(e.layers) !== JSON.stringify(a.layers)) {
      return { equal: false, diff: `layers: ${e.layers} vs ${a.layers}` };
    }
    return { equal: true, diff: null };
  }

  if (e.kind === 'layer_client') {
    const normOp = (op) => (op || '').replace(/_LAYERS$/, '_LAYER');
    if (e.action && a.action) {
      const normAction = (act) => (act === 'LAYER_CONTROL' ? 'LAYER_CONTROLS' : act);
      if (normAction(e.action) !== normAction(a.action)) {
        return { equal: false, diff: `action ${e.action} vs ${a.action}` };
      }
    }
    if (e.operation && a.operation && normOp(e.operation) !== normOp(a.operation)) {
      return { equal: false, diff: `operation ${e.operation} vs ${a.operation}` };
    }
    if (e.layers && JSON.stringify(e.layers) !== JSON.stringify(a.layers)) {
      return { equal: false, diff: `layers ${e.layers} vs ${a.layers}` };
    }
    return { equal: true, diff: null };
  }

  if (e.kind === 'gis') {
    if (e.commands?.length !== a.commands?.length) {
      return { equal: false, diff: `command count ${e.commands?.length} vs ${a.commands?.length}` };
    }
    for (let i = 0; i < e.commands.length; i += 1) {
      const ec = e.commands[i];
      const ac = a.commands[i];
      const keys = ['action', 'dataset', 'radiusKm', 'limit', 'location', 'activeOnly', 'layerSource'];
      for (const k of keys) {
        if (ec[k] != null && ec[k] !== ac[k]) {
          if (k === 'location' && String(ec[k]).toLowerCase() === String(ac[k]).toLowerCase()) continue;
          return { equal: false, diff: `cmd[${i}].${k}: ${ec[k]} vs ${ac[k]}` };
        }
      }
      if (ec.datasetIds?.length && JSON.stringify(ec.datasetIds) !== JSON.stringify(ac.datasetIds)) {
        return { equal: false, diff: `cmd[${i}].datasetIds mismatch` };
      }
      if (ec.webmapCatalogId && ec.webmapCatalogId !== ac.webmapCatalogId) {
        return { equal: false, diff: `cmd[${i}].webmapCatalogId mismatch` };
      }
    }
    if (e.sharedLocation && a.sharedLocation) {
      if (String(e.sharedLocation).toLowerCase() !== String(a.sharedLocation).toLowerCase()) {
        return { equal: false, diff: `sharedLocation ${e.sharedLocation} vs ${a.sharedLocation}` };
      }
    } else if (e.sharedLocation && e.sharedLocation !== a.sharedLocation) {
      return { equal: false, diff: `sharedLocation ${e.sharedLocation} vs ${a.sharedLocation}` };
    }
    return { equal: true, diff: null };
  }

  if (e.kind === 'expansion') {
    if (e.expansion && e.expansion !== a.expansion) return { equal: false, diff: `expansion ${e.expansion} vs ${a.expansion}` };
    if (e.prompt && a.prompt && e.prompt.toLowerCase() !== a.prompt.toLowerCase()) {
      return { equal: false, diff: `prompt mismatch` };
    }
    return { equal: true, diff: null };
  }

  return { equal: true, diff: null };
}

export function executeCase(caseDef, catalog) {
  const ctx = caseDef.context || {};
  if (caseDef.path === 'conversation') {
    const expanded = expandConversationInput(caseDef.prompt, ctx);
    const actual = normalizeConversationExpansion(expanded);
    return { raw: expanded, actual };
  }
  if (caseDef.path === 'layer') {
    const plan = planLayerAwareClientCommand(caseDef.prompt, catalog);
    const actual = normalizeLayerClientPlan(plan);
    return { raw: plan, actual };
  }
  if (caseDef.path === 'gis') {
    const result = interpretSpatialLanguage(caseDef.prompt, {
      webmapLayerCatalog: catalog,
      previousLocationText: ctx.lastLocationText,
      previousMatchedAddress: ctx.lastMatchedAddress
    });
    const actual = normalizeGisPlan(result);
    return { raw: result, actual };
  }
  if (caseDef.path === 'planner') {
    const planned = planCompoundPrompt(caseDef.prompt, { webmapLayerCatalog: catalog });
    const actual = planned.supported
      ? normalizeGisPlan({ supported: true, commands: planned.commands, sharedLocation: planned.sharedLocation, plan: { commands: planned.commands } })
      : { kind: 'clarification', message: planned.message || planned.clarification };
    return { raw: planned, actual };
  }
  throw new Error(`Unknown path ${caseDef.path}`);
}
