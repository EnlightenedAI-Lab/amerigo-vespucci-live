/**
 * Google Street View provider — metadata check + interactive panorama.
 * Does not mutate IQAI selected location. Imagery is visual context only.
 */
import {
  STREET_LEVEL_CONTEXT_PROVIDER_GOOGLE,
  STREET_VIEW_SEARCH_RADIUS_METERS
} from './street-level-context-config.js';
import { computeCoordinateOffsetMeters } from './street-level-context-geometry.js';

const MAPS_SCRIPT_ID = 'iqai-google-maps-js';

/**
 * @param {string} apiKey
 * @param {{ loadScript?: (src: string) => Promise<void>, getGoogle?: () => any }} [deps]
 */
async function ensureGoogleMapsApi(apiKey, deps = {}) {
  const getGoogle = deps.getGoogle || (() => globalThis.google);
  if (getGoogle()?.maps?.StreetViewService) return getGoogle();

  if (!apiKey) {
    throw new Error('Google Maps browser API key is not configured');
  }

  if (typeof deps.loadScript === 'function') {
    await deps.loadScript(
      `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&v=weekly`
    );
    const g = getGoogle();
    if (!g?.maps?.StreetViewService) {
      throw new Error('Google Maps JavaScript API failed to initialize');
    }
    return g;
  }

  if (document.getElementById(MAPS_SCRIPT_ID) && getGoogle()?.maps) {
    return getGoogle();
  }

  await new Promise((resolve, reject) => {
    const existing = document.getElementById(MAPS_SCRIPT_ID);
    if (existing) {
      existing.addEventListener('load', () => resolve(), { once: true });
      existing.addEventListener('error', () => reject(new Error('Google Maps script failed to load')), { once: true });
      return;
    }
    const script = document.createElement('script');
    script.id = MAPS_SCRIPT_ID;
    script.async = true;
    script.defer = true;
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&v=weekly`;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Google Maps script failed to load'));
    document.head.appendChild(script);
  });

  const google = getGoogle();
  if (!google?.maps?.StreetViewService) {
    throw new Error('Google Maps JavaScript API failed to initialize');
  }
  return google;
}

/**
 * @param {object} [options]
 * @param {string} [options.apiKey]
 * @param {number} [options.searchRadiusMeters]
 * @param {(location: {lat:number,lng:number}, radius: number) => Promise<object>} [options.getPanoramaMetadata]
 * @param {(container: HTMLElement, opts: object) => { setPosition?: Function, setVisible?: Function, getLocation?: Function }} [options.createPanorama]
 * @param {(src: string) => Promise<void>} [options.loadScript]
 * @param {() => any} [options.getGoogle]
 */
export function createGoogleStreetViewProvider(options = {}) {
  const searchRadiusMeters = Number(options.searchRadiusMeters) || STREET_VIEW_SEARCH_RADIUS_METERS;
  let apiKey = String(options.apiKey || '').trim();
  let activePanorama = null;

  return {
    id: STREET_LEVEL_CONTEXT_PROVIDER_GOOGLE,

    setApiKey(key) {
      apiKey = String(key || '').trim();
    },

    isConfigured() {
      return Boolean(apiKey);
    },

    /**
     * Availability / metadata only — does not create a panorama UI.
     * @param {{ latitude: number, longitude: number }} requested
     */
    async checkAvailability(requested) {
      const point = {
        latitude: Number(requested?.latitude),
        longitude: Number(requested?.longitude)
      };
      if (!Number.isFinite(point.latitude) || !Number.isFinite(point.longitude)) {
        return {
          available: false,
          requested: point,
          panorama: null,
          panoId: null,
          status: 'INVALID_LOCATION',
          offsetMeters: null,
          message: 'No selected location'
        };
      }

      if (!apiKey && !options.getPanoramaMetadata) {
        return {
          available: false,
          requested: point,
          panorama: null,
          panoId: null,
          status: 'CONFIG_DISABLED',
          offsetMeters: null,
          message: 'Street View is not configured'
        };
      }

      let data;
      if (typeof options.getPanoramaMetadata === 'function') {
        data = await options.getPanoramaMetadata(
          { lat: point.latitude, lng: point.longitude },
          searchRadiusMeters
        );
      } else {
        const google = await ensureGoogleMapsApi(apiKey, options);
        const service = new google.maps.StreetViewService();
        data = await new Promise((resolve) => {
          service.getPanorama(
            {
              location: { lat: point.latitude, lng: point.longitude },
              radius: searchRadiusMeters,
              source: google.maps.StreetViewSource?.OUTDOOR
            },
            (result, status) => resolve({ result, status })
          );
        });
      }

      const status = String(data?.status || '');
      const location = data?.result?.location?.latLng
        || data?.result?.location
        || data?.panorama
        || null;

      let panorama = null;
      if (location) {
        const lat = typeof location.lat === 'function' ? location.lat() : Number(location.lat ?? location.latitude);
        const lng = typeof location.lng === 'function' ? location.lng() : Number(location.lng ?? location.longitude);
        if (Number.isFinite(lat) && Number.isFinite(lng)) {
          panorama = { latitude: lat, longitude: lng };
        }
      }

      const available = status === 'OK' && Boolean(panorama);
      const offsetMeters = available ? computeCoordinateOffsetMeters(point, panorama) : null;

      return {
        available,
        requested: point,
        panorama: available ? panorama : null,
        panoId: data?.result?.location?.pano || data?.panoId || null,
        status: available ? 'OK' : (status || 'ZERO_RESULTS'),
        offsetMeters,
        message: available
          ? null
          : 'Street View unavailable near this location'
      };
    },

    /**
     * Mount interactive Street View panorama into container.
     * @param {HTMLElement} container
     * @param {{ requested: object, availability?: object }} input
     */
    async openPanorama(container, input) {
      if (!container) throw new Error('Street View container is required');
      const requested = input?.requested;
      const availability = input?.availability || await this.checkAvailability(requested);
      if (!availability.available || !availability.panorama) {
        return { ...availability, panoramaInstance: null };
      }

      this.closePanorama();

      if (typeof options.createPanorama === 'function') {
        activePanorama = options.createPanorama(container, {
          position: {
            lat: availability.panorama.latitude,
            lng: availability.panorama.longitude
          },
          panoId: availability.panoId
        });
      } else {
        const google = await ensureGoogleMapsApi(apiKey, options);
        activePanorama = new google.maps.StreetViewPanorama(container, {
          position: {
            lat: availability.panorama.latitude,
            lng: availability.panorama.longitude
          },
          pov: { heading: 0, pitch: 0 },
          zoom: 1,
          visible: true,
          addressControl: false,
          fullscreenControl: true,
          motionTracking: false,
          enableCloseButton: false
        });
      }

      return {
        ...availability,
        panoramaInstance: activePanorama
      };
    },

    closePanorama() {
      if (activePanorama) {
        try {
          if (typeof activePanorama.setVisible === 'function') {
            activePanorama.setVisible(false);
          }
        } catch {
          /* ignore */
        }
        activePanorama = null;
      }
    }
  };
}
