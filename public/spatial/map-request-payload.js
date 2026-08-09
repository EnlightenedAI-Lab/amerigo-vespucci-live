/**
 * Compact POST body builder for /api/spatial/map.
 */

import { buildCompactWebMapLayerCatalog } from './webmap-layer-catalog.js';

export const MAP_API_BODY_LIMIT_BYTES = 16 * 1024;
export const MAP_API_BODY_TARGET_BYTES = 8 * 1024;

/**
 * @param {{
 *   prompt: string,
 *   catalog?: object | null,
 *   conversation?: object | null,
 *   previousLocationText?: string | null,
 *   previousMatchedAddress?: string | null
 * }} params
 */
export function buildMapApiRequestBody(params) {
  const conversation = params.conversation || null;
  const previousLocationText = params.previousLocationText
    || conversation?.lastLocationText
    || undefined;
  const previousMatchedAddress = params.previousMatchedAddress
    || conversation?.lastMatchedAddress
    || undefined;

  const body = {
    prompt: params.prompt
  };

  if (previousLocationText) body.previousLocationText = previousLocationText;
  if (previousMatchedAddress) body.previousMatchedAddress = previousMatchedAddress;

  const compactCatalog = buildCompactWebMapLayerCatalog(params.catalog);
  if (compactCatalog) body.webmapLayerCatalog = compactCatalog;

  return body;
}

/**
 * @param {object} body
 */
export function measureMapApiRequestBody(body) {
  const json = JSON.stringify(body);
  if (typeof Buffer !== 'undefined') {
    return Buffer.byteLength(json, 'utf8');
  }
  return new Blob([json]).size;
}

/**
 * @param {object} body
 */
export function assertMapApiRequestBodyWithinLimit(body, limitBytes = MAP_API_BODY_LIMIT_BYTES) {
  const bytes = measureMapApiRequestBody(body);
  if (bytes > limitBytes) {
    throw new Error(`MAP request body ${bytes} bytes exceeds ${limitBytes} byte limit`);
  }
  return bytes;
}
