/**
 * PLACE_POI_SEARCH V1 API route.
 */
import { executePlacePoiSearch, isPlacePoiV1Enabled } from './place-poi-search-service.js';

export const PLACE_POI_SEARCH_PATH = '/api/spatial/place-poi/search';

/**
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
export async function handlePlacePoiSearch(req, res) {
  res.type('application/json');
  res.set('Cache-Control', 'no-store');
  if (!isPlacePoiV1Enabled()) {
    return res.status(404).json({ ok: false, code: 'DISABLED', message: 'Place POI search is disabled.' });
  }
  try {
    const body = req.body || {};
    const result = await executePlacePoiSearch({
      prompt: body.prompt,
      intent: body.intent,
      originContext: body.originContext || null,
      sessionScope: body.sessionScope || null,
      graphId: body.graphId || null
    });
    return res.status(result.ok ? 200 : 400).json(result);
  } catch (error) {
    return res.status(500).json({
      ok: false,
      code: 'POI_SEARCH_FAILED',
      message: error?.message || 'Place POI search failed.'
    });
  }
}
