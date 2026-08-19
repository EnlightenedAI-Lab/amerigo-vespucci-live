/**
 * IQAI Spatial V2 — AGOL/Portal session for the map foundation.
 * Reuses the existing oauth-config API and /spatial/oauth-callback.html
 * registration. Does not import V1 MapView runtime.
 */

import { importArc } from './arcgis-sdk.js';

const OAUTH_CONFIG_PATH = '/api/spatial/operational-map/oauth-config';

let registration = null;
let hashBridgeWired = false;
let localDemoApiKey = null;

export function getLocalDemoApiKey() {
  return localDemoApiKey;
}

export async function fetchOperationalMapOAuthConfig() {
  const res = await fetch(OAUTH_CONFIG_PATH, { cache: 'no-store' });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(body.error || `OAuth configuration unavailable (${res.status})`);
  }
  return body;
}

function wireOAuthHashBridge(IdentityManager) {
  if (hashBridgeWired) return;
  hashBridgeWired = true;
  window.addEventListener('arcgis:auth:hash', (event) => {
    if (event.detail) IdentityManager.setOAuthResponseHash(event.detail);
  });
}

export async function registerAgolOAuth(oauthConfig) {
  const popupCallbackUrl = oauthConfig.popupCallbackUrl
    || `${window.location.origin}/spatial/oauth-callback.html`;
  const authMode = oauthConfig.authMode === 'local-api-key' ? 'local-api-key' : 'browser-oauth';
  const apiKey = typeof oauthConfig.apiKey === 'string' ? oauthConfig.apiKey.trim() : '';
  if (
    registration?.appId === oauthConfig.oauthAppId
    && registration?.popupCallbackUrl === popupCallbackUrl
    && registration?.authMode === authMode
    && registration?.hasApiKey === Boolean(apiKey)
  ) {
    return registration;
  }

  const [OAuthInfo, IdentityManager, esriConfig] = await Promise.all([
    importArc('@arcgis/core/identity/OAuthInfo.js'),
    importArc('@arcgis/core/identity/IdentityManager.js'),
    importArc('@arcgis/core/config.js')
  ]);

  const portalUrl = String(oauthConfig.portalUrl || 'https://www.arcgis.com').replace(/\/$/, '');
  esriConfig.portalUrl = portalUrl;
  if (apiKey) {
    esriConfig.apiKey = apiKey;
    localDemoApiKey = apiKey;
  }

  if (authMode !== 'local-api-key' && oauthConfig.oauthAppId) {
    IdentityManager.registerOAuthInfos([
      new OAuthInfo({
        appId: oauthConfig.oauthAppId,
        portalUrl,
        popup: true,
        popupCallbackUrl
      })
    ]);
    wireOAuthHashBridge(IdentityManager);
  }

  registration = {
    appId: oauthConfig.oauthAppId || null,
    portalUrl,
    sharingUrl: `${portalUrl}/sharing`,
    popupCallbackUrl,
    authMode,
    hasApiKey: Boolean(apiKey),
    IdentityManager
  };
  return registration;
}

export function registerPreauthTokenIfPresent(IdentityManager, sharingUrl) {
  const preauth = window.__MONTREAL_PREAUTH_TOKEN;
  if (!preauth?.token) return false;
  const expires = Number(preauth.expires);
  const normalizedExpires = Number.isFinite(expires)
    ? (expires > 1e12 ? expires : expires * 1000)
    : Date.now() + 3600000;
  const servers = [
    sharingUrl,
    sharingUrl.replace(/\/sharing\/?$/, ''),
    `${sharingUrl.replace(/\/$/, '')}/rest/services`
  ];
  for (const server of servers) {
    IdentityManager.registerToken({
      server,
      token: preauth.token,
      expires: normalizedExpires,
      ssl: true
    });
  }
  return true;
}

export async function getAgolSession(IdentityManager, sharingUrl, options = {}) {
  if (options.authMode === 'local-api-key' || localDemoApiKey) {
    return { authenticated: true, credential: null, authMode: 'local-api-key' };
  }
  registerPreauthTokenIfPresent(IdentityManager, sharingUrl);
  try {
    const credential = await IdentityManager.checkSignInStatus(sharingUrl);
    return { authenticated: Boolean(credential), credential };
  } catch {
    return { authenticated: false, credential: null };
  }
}

export async function signInToAgol(IdentityManager, sharingUrl, timeoutMs = 120000) {
  const credentialPromise = IdentityManager.getCredential(sharingUrl, {
    oAuthPopupConfirmation: false
  });
  let timer;
  const timeoutPromise = new Promise((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error('ArcGIS sign-in timed out. Close the sign-in window and try again.'));
    }, timeoutMs);
  });
  try {
    return await Promise.race([credentialPromise, timeoutPromise]);
  } finally {
    clearTimeout(timer);
  }
}

export function isAccessDeniedError(error) {
  const text = `${error?.message || error || ''} ${error?.details || ''}`.toLowerCase();
  return /access|permission|denied|forbidden|403|gwm_0003|sign-in required|not configured/i.test(text);
}
