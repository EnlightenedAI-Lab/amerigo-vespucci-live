/**
 * Product imagery command surface. One exclusive visual mode.
 * MAP / AERIAL share the long-lived MapView. HISTORY is a separate
 * non-Google canvas. They never mix pixels on one surface.
 */

export const IMAGE_SURFACE = Object.freeze({
  MAP: 'MAP',
  AERIAL: 'AERIAL',
  HISTORY: 'HISTORY'
});

/** Thin catalogue HISTORY is live. Held engine remains unused. */
export const HISTORY_SURFACE_HELD = false;

export const IMAGE_SURFACE_FAILURE = Object.freeze({
  LOOKING: 'LOOKING FOR HISTORICAL IMAGERY…',
  NONE: 'NO HISTORICAL IMAGES FOR THIS VIEW',
  ONLY_CURRENT: 'ONLY CURRENT AERIAL AVAILABLE',
  DATE_UNKNOWN: 'DATE UNKNOWN',
  SOURCE_UNAVAILABLE: 'SOURCE UNAVAILABLE',
  ENTITLEMENT: 'ENTITLEMENT REQUIRED',
  SELECTED_NOT_DISPLAYED: 'SELECTED — NOT YET DISPLAYED',
  EXPORT_NOT_PERMITTED: 'EXPORT NOT PERMITTED',
  NETWORK: 'NETWORK UNAVAILABLE'
});

export function canonicalizeImageSurface(value) {
  const raw = String(value || '').trim().toUpperCase();
  if (raw === IMAGE_SURFACE.AERIAL) return IMAGE_SURFACE.AERIAL;
  if (raw === IMAGE_SURFACE.HISTORY) return IMAGE_SURFACE.HISTORY;
  return IMAGE_SURFACE.MAP;
}

export function projectImageSurface(mode) {
  const current = canonicalizeImageSurface(mode);
  const history = current === IMAGE_SURFACE.HISTORY;
  return Object.freeze({
    mode: current,
    singleActive: true,
    mapViewVisible: !history,
    historicalSurfaceVisible: history,
    historyChromeVisible: history,
    googlePixelsAllowed: !history,
    historicalPixelsAllowed: history,
    street360Allowed: !history,
    visual3dAllowed: !history,
    pixelFamiliesMixed: false
  });
}

export function assertPixelSeparation(projection) {
  const mixed = projection.googlePixelsAllowed === true
    && projection.historicalPixelsAllowed === true;
  return mixed !== true && projection.pixelFamiliesMixed !== true;
}
