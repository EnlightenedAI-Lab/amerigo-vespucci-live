import { MONTREAL_OPERATIONAL_WEBMAP_ID } from './montreal-operational-config.js';

export const MONTREAL_PORTAL_URL = 'https://www.arcgis.com';

function isLocalPreviewOrigin(origin = '') {
  try {
    const url = new URL(String(origin));
    return url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  } catch {
    return false;
  }
}

export function resolveMontrealOAuthAppId(config = {}) {
  return String(
    config.montrealArcgisOAuthAppId
    || process.env.MONTREAL_ARCGIS_OAUTH_APP_ID
    || process.env.ARCGIS_OAUTH_APP_ID
    || ''
  ).trim();
}

export function resolveLocalDemoArcGisApiKey() {
  return String(process.env.ARCGIS_API_KEY || '').trim();
}

export function getMontrealOAuthRegistrationHints(origin = 'http://localhost:3000') {
  const normalized = origin.replace(/\/$/, '');
  const popupCallbackUrl = `${normalized}/spatial/oauth-callback.html`;
  const extra = String(process.env.MONTREAL_OAUTH_REDIRECT_ORIGINS || '')
    .split(/[,\s]+/)
    .map((value) => value.trim().replace(/\/$/, ''))
    .filter(Boolean);
  const origins = new Set([normalized, ...extra]);
  const redirectUris = [];
  for (const base of origins) {
    redirectUris.push(`${base}/spatial/oauth-callback.html`, base, `${base}/spatial`);
  }
  return {
    popupCallbackUrl,
    redirectUris: [...new Set(redirectUris)]
  };
}

export function buildMontrealOAuthPublicConfig(config, requestOrigin = 'http://localhost:3000') {
  const oauthAppId = resolveMontrealOAuthAppId(config);
  const hints = getMontrealOAuthRegistrationHints(requestOrigin);
  const apiKey = resolveLocalDemoArcGisApiKey();
  const localApiKeyDemo = Boolean(apiKey) && isLocalPreviewOrigin(requestOrigin);
  const authMode = localApiKeyDemo ? 'local-api-key' : 'browser-oauth';
  return {
    portalUrl: config.arcgisPortalUrl || MONTREAL_PORTAL_URL,
    oauthAppId: oauthAppId || null,
    oauthAppIdConfigured: Boolean(oauthAppId),
    webmapItemId: config.montrealOperationalWebmapId || MONTREAL_OPERATIONAL_WEBMAP_ID,
    webmapName: 'Montreal 1',
    authMode,
    popup: authMode !== 'local-api-key',
    popupCallbackUrl: hints.popupCallbackUrl,
    redirectUris: hints.redirectUris,
    apiKeyConfigured: localApiKeyDemo,
    apiKey: localApiKeyDemo ? apiKey : null,
    oauthSetupRequired: !oauthAppId && !localApiKeyDemo
  };
}
