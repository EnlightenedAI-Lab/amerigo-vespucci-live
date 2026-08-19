import { URLS, USER_AGENT, MONTREAL_AREA_BBOX, inBbox } from './catalog.mjs';
import { fetchText } from './movement.mjs';

const VILLE_STILL = /^https:\/\/ville\.montreal\.qc\.ca\/Circulation-Cameras\/GEN\d+\.jpeg$/i;
const MAX_IN_VIEW = 12;
const LIVE_MS = 2 * 60 * 60 * 1000;

export { MAX_IN_VIEW };

export function isAllowedVilleStill(url) {
  if (!url || typeof url !== 'string') return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && VILLE_STILL.test(parsed.href.split('?')[0]);
  } catch {
    return false;
  }
}

export function classifyImageHeaders({ http, contentType, lastModified }) {
  if (http === 401 || http === 403) return 'RESTRICTED';
  if (http === 404) return 'UNAVAILABLE';
  if (!Number.isFinite(http) || http < 200 || http >= 300) return 'FAILED';
  if (!String(contentType || '').toLowerCase().includes('image')) return 'FAILED';
  const stamp = lastModified ? Date.parse(lastModified) : NaN;
  if (!Number.isFinite(stamp)) return 'STALE';
  if (Date.now() - stamp <= LIVE_MS) return 'LIVE IMAGE';
  return 'STALE';
}

function videoStatus(url) {
  if (!url) return 'UNAVAILABLE';
  if (/circulationhttps?:/i.test(url) || /qc\.ca\/circulationhttp/i.test(url)) return 'UNAVAILABLE';
  return 'UNPROVEN';
}

function directionStatus() {
  return 'UNAVAILABLE';
}

async function fetchVilleInventory() {
  const url = `${URLS.arcgisVilleCameras}&outFields=${encodeURIComponent(
    'nid,titre,id_camera,latitude,longitude,url,url_image_en_direct,url_video_en_direct,url_image_direction_nord,url_image_direction_est,url_image_direction_sud,url_image_direction_ouest,axe_routier_nord_sud,axe_routier_est_ouest,arrondissement'
  )}&returnGeometry=false&resultRecordCount=2000&f=json`;
  const res = await fetchText(url, { timeoutMs: 30000, accept: 'application/json' });
  if (!res.ok) throw new Error(`ArcGIS camera inventory HTTP ${res.status}`);
  const body = JSON.parse(res.buffer.toString('utf8'));
  if (body.error) throw new Error(body.error.message || 'ArcGIS camera query failed');
  const receivedAt = new Date().toISOString();
  const features = [];
  for (const row of body.features || []) {
    const a = row.attributes || {};
    const lat = Number(a.latitude);
    const lon = Number(a.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    if (!inBbox(lat, lon, MONTREAL_AREA_BBOX)) continue;
    const still = String(a.url_image_en_direct || '').split('?')[0];
    const allowed = isAllowedVilleStill(still);
    features.push({
      type: 'Feature',
      id: `ville-${a.id_camera || a.nid}`,
      geometry: { type: 'Point', coordinates: [lon, lat] },
      properties: {
        layerId: 'traffic-cameras',
        cameraFamily: 'ville-circulation',
        name: a.titre || `Camera ${a.id_camera}`,
        cameraId: a.id_camera != null ? String(a.id_camera) : null,
        nid: a.nid != null ? String(a.nid) : null,
        route: [a.axe_routier_nord_sud, a.axe_routier_est_ouest].filter(Boolean).join(' / ') || null,
        borough: a.arrondissement || null,
        provider: 'Ville de Montréal (pages branded Québec 511 Montréal)',
        stillUrl: allowed ? still : null,
        stillCandidate: still || null,
        stillAllowed: allowed,
        viewerUrl: a.url || 'https://ville.montreal.qc.ca/circulation/',
        videoUrl: a.url_video_en_direct || null,
        videoStatus: videoStatus(a.url_video_en_direct),
        directionStatus: directionStatus(),
        directions: {
          N: a.url_image_direction_nord || null,
          E: a.url_image_direction_est || null,
          S: a.url_image_direction_sud || null,
          W: a.url_image_direction_ouest || null
        },
        imageStatus: allowed ? 'UNPROBED' : 'UNAVAILABLE',
        source: 'ArcGIS Montréal TrafficCameras FeatureServer/0 (last edited 2022-11-30). Still identity is Ville Circulation-Cameras GEN jpeg.',
        inventoryVintage: '2022-11-30 lastEditDate on FeatureServer/0',
        retrievedAt: receivedAt,
        rightsNote: 'RIGHTS REVIEW REQUIRED FOR COMMERCIAL PRODUCT. Do not archive frames. No computer vision in this sandbox.',
        note: '2022 location index. A point existing does not prove the still is current. Last-Modified on the jpeg is the image clock; IQAI retrieval time is separate. Not live CAD.'
      }
    });
  }
  return { features, receivedAt, inventoryCount: (body.features || []).length };
}

async function fetchMtmdInventory() {
  const url = URLS.qc511CamerasWfs2;
  const res = await fetchText(url, { timeoutMs: 45000, accept: 'application/geo+json, application/json' });
  if (!res.ok) throw new Error(`MTMD cameras WFS HTTP ${res.status}`);
  const geojson = JSON.parse(res.buffer.toString('utf8'));
  const receivedAt = new Date().toISOString();
  const features = [];
  for (const feature of geojson.features || []) {
    const xy = feature.geometry?.coordinates;
    if (!xy || !inBbox(Number(xy[1]), Number(xy[0]), MONTREAL_AREA_BBOX)) continue;
    const props = feature.properties || {};
    const id = String(props.IDEcamera || feature.id || '');
    features.push({
      type: 'Feature',
      id: `mtmd-${id}`,
      geometry: feature.geometry,
      properties: {
        layerId: 'traffic-cameras',
        cameraFamily: 'mtmd-511',
        name: props.DescriptionLocalisationFr || props.DescriptionLocalisationEn || props.NumeroCamera || `Camera ${id}`,
        cameraId: id || null,
        cameraNumber: props.NumeroCamera || null,
        route: props.NumeroRoute || props.NomPontFrontalier || null,
        region: props.NomRegionDiffusion || null,
        provider: 'Québec 511 / MTMD',
        stillUrl: null,
        stillAllowed: false,
        viewerUrl: props.URL_FLUX_DONNEE || null,
        videoUrl: props.URL_FLUX_DONNEE || null,
        videoStatus: 'UNPROVEN',
        directionStatus: 'UNAVAILABLE',
        imageStatus: 'RESTRICTED',
        source: 'Official MTMD WFS ms:infos_cameras (current locations). URL_FLUX_DONNEE is FenetreVideo.html, not a still.',
        retrievedAt: receivedAt,
        rightsNote: 'RIGHTS REVIEW REQUIRED FOR COMMERCIAL PRODUCT. Québec 511 images are privacy-processed and destroyed per MTMD notice. Do not archive frames. No computer vision.',
        note: 'Current official location. Sandbox server receives Cloudflare 403 from quebec511.info. No reusable still-image URL is published on the WFS. Thumbnail is not fabricated. Do not scrape the 511 viewer.'
      }
    });
  }
  return { features, receivedAt, provincialCount: geojson.features?.length || 0 };
}

export async function fetchTrafficCameras() {
  const [ville, mtmd] = await Promise.all([fetchVilleInventory(), fetchMtmdInventory()]);
  return {
    features: [...ville.features, ...mtmd.features],
    receivedAt: new Date().toISOString(),
    villeCount: ville.features.length,
    mtmdCount: mtmd.features.length,
    villeInventory: ville.inventoryCount,
    mtmdProvincial: mtmd.provincialCount
  };
}

export async function probeStill(url) {
  if (!isAllowedVilleStill(url)) {
    return {
      ok: false,
      imageStatus: 'UNAVAILABLE',
      http: null,
      contentType: null,
      lastModified: null,
      retrievedAt: new Date().toISOString(),
      message: 'URL is not the allowlisted Ville Circulation-Cameras still.'
    };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'image/jpeg,image/*',
        Range: 'bytes=0-16'
      },
      redirect: 'follow',
      signal: controller.signal
    });
    const contentType = response.headers.get('content-type') || '';
    const lastModified = response.headers.get('last-modified') || null;
    const imageStatus = classifyImageHeaders({
      http: response.status,
      contentType,
      lastModified
    });
    return {
      ok: imageStatus === 'LIVE IMAGE' || imageStatus === 'STALE',
      imageStatus,
      http: response.status,
      contentType,
      lastModified,
      retrievedAt: new Date().toISOString()
    };
  } catch (error) {
    return {
      ok: false,
      imageStatus: 'FAILED',
      http: null,
      contentType: null,
      lastModified: null,
      retrievedAt: new Date().toISOString(),
      message: error?.message || 'probe failed'
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchStillBuffer(url) {
  if (!isAllowedVilleStill(url)) {
    const error = new Error('Still URL not allowlisted');
    error.status = 'UNAVAILABLE';
    throw error;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'image/jpeg,image/*' },
      redirect: 'follow',
      signal: controller.signal
    });
    const buffer = Buffer.from(await response.arrayBuffer());
    const contentType = response.headers.get('content-type') || '';
    const lastModified = response.headers.get('last-modified') || null;
    const imageStatus = classifyImageHeaders({
      http: response.status,
      contentType,
      lastModified
    });
    return {
      ok: response.ok && contentType.toLowerCase().includes('image'),
      status: response.status,
      contentType,
      lastModified,
      imageStatus,
      buffer,
      retrievedAt: new Date().toISOString()
    };
  } finally {
    clearTimeout(timer);
  }
}
