const GEOCODER_URL =
  'https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer';

const MONTREAL_QUALIFIER = 'Montréal, Québec, Canada';

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Request failed (${res.status}): ${url}`);
  const data = await res.json();
  if (data.error) throw new Error(data.error.message || 'ArcGIS error');
  return data;
}

function normalizeAscii(text) {
  return String(text || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

export function extractHouseNumber(text) {
  const match = String(text || '').match(/\b(\d{1,6})\b/);
  return match ? match[1] : null;
}

export function lacksMunicipalityQualifier(locationText) {
  const normalized = normalizeAscii(locationText);
  return !/\b(montreal|quebec|canada)\b/.test(normalized);
}

export function qualifyMontrealAddress(locationText) {
  const text = String(locationText || '').trim().replace(/[.?!]+$/g, '').trim();
  if (!text) return text;
  if (!lacksMunicipalityQualifier(text)) return text;
  return `${text}, ${MONTREAL_QUALIFIER}`;
}

/**
 * Validate ArcGIS candidate against expected Montréal street address components.
 * @param {object} candidate
 * @param {string} locationText
 */
export function validateMontrealCandidate(candidate, locationText) {
  if (!candidate) return false;

  const attrs = candidate.attributes || {};
  const expectedNum = extractHouseNumber(locationText);
  const addNum = String(attrs.AddNum || '').trim();
  const city = normalizeAscii(attrs.City || attrs.Subregion || '');
  const region = normalizeAscii(attrs.Region || attrs.RegionAbbr || '');
  const country = normalizeAscii(attrs.Country || attrs.CntryName || '');
  const stName = normalizeAscii(attrs.StName || '');
  const stAddr = normalizeAscii(attrs.StAddr || '');
  const resolved = normalizeAscii(candidate.resolvedAddress || attrs.Match_addr || '');
  const locationNorm = normalizeAscii(locationText);

  if (country && country !== 'can' && !resolved.includes('canada')) return false;
  if (!city.includes('montreal') && !resolved.includes('montreal')) return false;
  if (region && !region.includes('quebec') && !region.includes('qc') && !resolved.includes('quebec')) {
    return false;
  }

  if (expectedNum) {
    if (addNum && addNum !== expectedNum) return false;
    if (!addNum && !resolved.includes(expectedNum) && !stAddr.includes(expectedNum)) return false;
  }

  if (locationNorm.includes('commune')) {
    const hasCommune = stName.includes('commune')
      || stAddr.includes('commune')
      || resolved.includes('commune');
    if (!hasCommune) return false;
  }

  const addrType = normalizeAscii(attrs.Addr_type || candidate.matchType || '');
  if (expectedNum && addrType === 'locality') return false;

  return true;
}

function mapCandidate(candidate, requestedAddress) {
  return {
    geocoder: 'ArcGIS World GeocodeServer',
    geocoderUrl: GEOCODER_URL,
    requestedAddress,
    resolvedAddress: candidate.address || candidate.attributes?.Match_addr || requestedAddress,
    longitude: candidate.location?.x,
    latitude: candidate.location?.y,
    score: candidate.score ?? candidate.attributes?.Score ?? null,
    matchType: candidate.attributes?.Addr_type || candidate.attributes?.Type || null,
    extent: candidate.extent || null,
    attributes: candidate.attributes || {}
  };
}

/**
 * Geocode a single-line address via ArcGIS World GeocodeServer.
 */
export async function geocodeAddress(singleLine, { maxLocations = 1 } = {}) {
  const params = new URLSearchParams({
    f: 'json',
    singleLine,
    maxLocations: String(maxLocations),
    outFields: '*'
  });
  const data = await fetchJson(`${GEOCODER_URL}/findAddressCandidates?${params}`);
  const candidates = data.candidates || [];
  return candidates
    .map((candidate) => mapCandidate(candidate, singleLine))
    .filter((c) => Number.isFinite(c.longitude) && Number.isFinite(c.latitude));
}

/**
 * Geocode for IQAI Spatial V1 Montréal operational context with candidate validation.
 * @param {string} locationText
 * @param {{ minScore?: number, maxLocations?: number }} [options]
 */
export async function geocodeMontrealMapLocation(locationText, options = {}) {
  const extractedAddress = String(locationText || '').trim().replace(/[.?!]+$/g, '').trim();
  if (!extractedAddress) {
    return {
      ok: false,
      message: 'Location is required for this operation.',
      extractedAddress: '',
      normalizedQuery: '',
      validation: 'FAIL'
    };
  }

  const minScore = options.minScore ?? 80;
  const maxLocations = options.maxLocations ?? 6;
  const queries = [extractedAddress];
  const qualified = qualifyMontrealAddress(extractedAddress);
  if (qualified !== extractedAddress) queries.push(qualified);

  let chosen = null;
  let normalizedQuery = extractedAddress;

  for (const query of queries) {
    const candidates = await geocodeAddress(query, { maxLocations });
    const valid = candidates.find(
      (candidate) => candidate.score != null
        && candidate.score >= minScore
        && validateMontrealCandidate(candidate, extractedAddress)
    );
    if (valid) {
      chosen = valid;
      normalizedQuery = query;
      break;
    }
  }

  if (!chosen) {
    return {
      ok: false,
      message: `Location resolution failed for: ${extractedAddress}. No acceptable Montréal address match was found.`,
      extractedAddress,
      normalizedQuery: qualified,
      validation: 'FAIL'
    };
  }

  return {
    ok: true,
    extractedAddress,
    normalizedQuery,
    validation: 'PASS',
    candidate: chosen
  };
}

function formatReverseAddress(address) {
  if (!address || typeof address !== 'object') return null;
  const match = String(
    address.Match_addr
    || address.LongLabel
    || address.ShortLabel
    || address.Address
    || ''
  ).trim();
  if (match) return match;
  const parts = [
    address.PlaceName,
    address.Neighborhood,
    address.City,
    address.RegionAbbr || address.Region
  ].filter((part) => String(part || '').trim());
  const joined = parts.join(', ').trim();
  return joined || null;
}

/**
 * Reverse-geocode a WGS84 point via the same ArcGIS World GeocodeServer
 * used for Montréal address search. Missing results stay unresolved.
 */
export async function reverseGeocodeWorldLocation(longitude, latitude) {
  const lon = Number(longitude);
  const lat = Number(latitude);
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) {
    return { ok: false, resolvedAddress: null, geocoderUrl: GEOCODER_URL };
  }
  const params = new URLSearchParams({
    f: 'json',
    location: `${lon},${lat}`,
    langCode: 'en',
    featureTypes: 'PointAddress,StreetAddress,StreetName,POI'
  });
  try {
    const data = await fetchJson(`${GEOCODER_URL}/reverseGeocode?${params}`);
    const resolvedAddress = formatReverseAddress(data?.address);
    if (!resolvedAddress) {
      return {
        ok: false,
        resolvedAddress: null,
        geocoder: 'ArcGIS World GeocodeServer',
        geocoderUrl: GEOCODER_URL
      };
    }
    return {
      ok: true,
      resolvedAddress,
      geocoder: 'ArcGIS World GeocodeServer',
      geocoderUrl: GEOCODER_URL,
      address: data.address
    };
  } catch {
    return {
      ok: false,
      resolvedAddress: null,
      geocoder: 'ArcGIS World GeocodeServer',
      geocoderUrl: GEOCODER_URL
    };
  }
}
