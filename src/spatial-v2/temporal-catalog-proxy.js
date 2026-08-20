/**
 * Same-origin /temporal/* and /temporal-catalog for Spatial :3047.
 * Forwards to the Temporal Catalogue service. Does not ingest imagery.
 * Injects the proven 1999 MRNF LOCAL orthophoto when the viewport covers it.
 */

import { Readable } from 'node:stream';
import {
  mergeMrnf1999Payload,
  registerMrnf1999History
} from './history-mrnf-1999.js';

const DEFAULT_ORIGIN = 'http://127.0.0.1:3071';

function catalogOrigin(env = process.env) {
  return String(env.TEMPORAL_CATALOG_ORIGIN || DEFAULT_ORIGIN).replace(/\/$/, '');
}

function imageryJsonPath(url) {
  const path = String(url || '').split('?')[0];
  return /\/imagery\/(timeline|search|best)$/.test(path);
}

export function registerTemporalCatalogProxy(app, options = {}) {
  const origin = catalogOrigin(options.env || process.env);
  const fetchImpl = options.fetchImpl || fetch;

  registerMrnf1999History(app);

  async function forward(prefix, req, res) {
    const upstream = `${origin}${prefix}${req.url}`;
    const isTile = prefix === '/temporal' && /\/tiles\//.test(req.url);
    const mergeJson = prefix === '/temporal' && imageryJsonPath(req.url);
    try {
      const response = await fetchImpl(upstream, {
        method: 'GET',
        headers: { accept: req.headers.accept || '*/*' }
      });
      const type = response.headers.get('content-type');
      if (type) res.set('Content-Type', type);
      res.set('Cache-Control', isTile
        ? (response.headers.get('cache-control') || 'public, max-age=86400')
        : (response.headers.get('cache-control') || 'no-store'));
      if (isTile && response.body) {
        res.status(response.status);
        Readable.fromWeb(response.body).pipe(res);
        return;
      }
      const buffer = Buffer.from(await response.arrayBuffer());
      if (mergeJson) {
        let payload = null;
        try {
          payload = JSON.parse(buffer.toString('utf8'));
        } catch {
          payload = { ok: false };
        }
        const merged = mergeMrnf1999Payload(req.url, req.query, payload);
        res.set('Content-Type', 'application/json; charset=utf-8');
        res.set('Cache-Control', 'no-store');
        return res.status(200).json(merged || payload);
      }
      return res.status(response.status).send(buffer);
    } catch {
      if (mergeJson) {
        const merged = mergeMrnf1999Payload(req.url, req.query, null);
        if (merged) {
          res.set('Cache-Control', 'no-store');
          return res.status(200).json(merged);
        }
      }
      res.set('Cache-Control', 'no-store');
      return res.status(502).json({
        ok: false,
        error: 'Temporal catalogue unavailable.'
      });
    }
  }

  app.use('/temporal', (req, res) => {
    void forward('/temporal', req, res);
  });
  app.use('/temporal-catalog', (req, res) => {
    void forward('/temporal-catalog', req, res);
  });
}
