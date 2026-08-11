/**
 * Load Agent 2 intelligence routes from sibling connectors repository.
 */
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const INTELLIGENCE_CONNECTORS_ROOT = resolve(__dirname, '../../..', 'amerigo-vespucci-intelligence-connectors');

/**
 * @param {import('express').Express} app
 * @param {object} [options]
 */
export async function registerAgent2IntelligenceRoutes(app, options = {}) {
  const storeRoot = options.storeRoot
    || process.env.INTELLIGENCE_STORE_ROOT
    || resolve(INTELLIGENCE_CONNECTORS_ROOT, 'data/intelligence/store');

  const storeMod = await import(pathToFileURL(resolve(
    INTELLIGENCE_CONNECTORS_ROOT,
    'src/intelligence/storage/store-singleton.js'
  )).href);
  const routesMod = await import(pathToFileURL(resolve(
    INTELLIGENCE_CONNECTORS_ROOT,
    'src/intelligence/api/intelligence-routes.js'
  )).href);

  const store = storeMod.getIntelligenceStore(storeRoot);
  routesMod.registerIntelligenceRoutes(app, {
    store,
    skipStartupMaterialization: options.skipStartupMaterialization ?? true
  });

  return { storeRoot, service: 'iqai-intelligence-connectors' };
}
