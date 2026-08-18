/**
 * Imagery tile network receipt from Resource Timing.
 * Do not install esriConfig.request interceptors here: a faulty after() hook
 * can stall Portal/WebMap load and leave the foundation INITIALIZING.
 */

export function observationTileUrlReceived(observation) {
  return observationTileReceipt(observation).resourceTimingEntryCount > 0;
}

function tileUrlMatchesObservation(url, observation) {
  if (!url || !observation) return false;
  const releaseNum = observation.sourceIdentity?.releaseNum;
  if (observation.providerId === 'esri-wayback') {
    if (Number.isFinite(Number(releaseNum))) {
      const needle = new RegExp(`/tile/${Number(releaseNum)}/`);
      return needle.test(url);
    }
    return /wayback\.maptiles\.arcgis\.com\/.*\/tile\//i.test(url);
  }
  if (observation.providerId === 'nearmap') {
    return /\/api\/spatial-v2\/imagery\/nearmap\/tiles\//i.test(url);
  }
  return false;
}

/**
 * Returns release-specific Resource Timing evidence. A resource entry proves
 * the browser completed a matching request, but it does not prove that the
 * response was composited. The Time Engine combines this receipt with an
 * isolated MapView layer screenshot before confirming display.
 */
export function observationTileReceipt(
  observation,
  { entries, sinceStartTime = 0 } = {}
) {
  const resources = entries
    || (typeof performance !== 'undefined'
      ? performance.getEntriesByType('resource')
      : []);
  const matched = (resources || []).filter((entry) => {
    const startTime = Number(entry?.startTime) || 0;
    return startTime >= sinceStartTime
      && tileUrlMatchesObservation(String(entry?.name || ''), observation);
  });
  const responseStatuses = {};
  let transferSize = 0;
  let encodedBodySize = 0;
  for (const entry of matched) {
    const status = Number(entry?.responseStatus);
    if (Number.isFinite(status) && status > 0) {
      responseStatuses[String(status)] = (responseStatuses[String(status)] || 0) + 1;
    }
    transferSize += Number(entry?.transferSize) || 0;
    encodedBodySize += Number(entry?.encodedBodySize) || 0;
  }
  return {
    providerId: observation?.providerId || null,
    observationId: observation?.id || null,
    releaseNum: observation?.sourceIdentity?.releaseNum ?? null,
    resourceTimingEntryCount: matched.length,
    responseStatuses,
    transferSize,
    encodedBodySize,
    sampleUrls: matched.slice(0, 3).map((entry) => String(entry?.name || ''))
  };
}

export async function ensureImageryTileReceiptInterceptor() {
  return;
}
