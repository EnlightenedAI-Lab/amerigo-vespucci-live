import { importArc } from './spatial-arcgis-runtime.js';

let oauthRegistration = null;
let oauthBridgeWired = false;

function popupCallbackUrl() {
  return `${window.location.origin}/spatial/oauth-callback.html`;
}

function wireOAuthCallbackBridge(IdentityManager) {
  if (oauthBridgeWired) return;
  oauthBridgeWired = true;
  window.addEventListener('arcgis:auth:hash', (event) => {
    if (event.detail) IdentityManager.setOAuthResponseHash(event.detail);
  });
}

export async function fetchMontrealOAuthConfig() {
  const res = await fetch('/api/spatial/operational-map/oauth-config', { cache: 'no-store' });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(body.error || `OAuth configuration unavailable (${res.status})`);
  }
  return body;
}

export async function ensureMontrealOAuthRegistered(oauthConfig) {
  const callbackUrl = popupCallbackUrl();
  if (
    oauthRegistration?.appId === oauthConfig.oauthAppId
    && oauthRegistration?.popupCallbackUrl === callbackUrl
  ) {
    return oauthRegistration;
  }

  const [OAuthInfo, IdentityManager, esriConfig] = await Promise.all([
    importArc('@arcgis/core/identity/OAuthInfo.js'),
    importArc('@arcgis/core/identity/IdentityManager.js'),
    importArc('@arcgis/core/config.js')
  ]);

  const portalUrl = (oauthConfig.portalUrl || 'https://www.arcgis.com').replace(/\/$/, '');
  esriConfig.portalUrl = portalUrl;

  const info = new OAuthInfo({
    appId: oauthConfig.oauthAppId,
    portalUrl,
    popup: true,
    popupCallbackUrl: callbackUrl
  });
  IdentityManager.registerOAuthInfos([info]);
  wireOAuthCallbackBridge(IdentityManager);

  oauthRegistration = {
    appId: oauthConfig.oauthAppId,
    portalUrl,
    sharingUrl: `${portalUrl}/sharing`,
    popupCallbackUrl: callbackUrl,
    IdentityManager,
    OAuthInfo
  };
  return oauthRegistration;
}

export function registerMontrealPreauthTokenIfPresent(IdentityManager, sharingUrl) {
  const preauth = window.__MONTREAL_PREAUTH_TOKEN;
  if (!preauth?.token) return false;
  IdentityManager.registerToken({
    server: sharingUrl,
    token: preauth.token,
    expires: preauth.expires || Date.now() + 3600000,
    ssl: true
  });
  return true;
}

export async function getMontrealArcgisSession(IdentityManager, sharingUrl) {
  registerMontrealPreauthTokenIfPresent(IdentityManager, sharingUrl);
  try {
    const credential = await IdentityManager.checkSignInStatus(sharingUrl);
    return { authenticated: Boolean(credential), credential };
  } catch {
    return { authenticated: false, credential: null };
  }
}

export async function signInToMontrealArcgis(IdentityManager, sharingUrl, options = {}) {
  const timeoutMs = options.timeoutMs ?? 120000;
  const credentialPromise = IdentityManager.getCredential(sharingUrl, { oAuthPopupConfirmation: false });
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

export function buildMontrealUserDiagnostics(portal) {
  return {
    portal: portal.url,
    username: portal.user?.username || null,
    orgId: portal.user?.orgId || portal.id || null,
    authenticated: Boolean(portal.user?.username)
  };
}

export function isMontrealAccessDeniedError(error) {
  const message = String(error?.message || error || '').toLowerCase();
  const details = String(error?.details || '').toLowerCase();
  return /access|permission|denied|forbidden|403|gwm_0003/.test(`${message} ${details}`);
}

export function formatArcgisOAuthError(error) {
  const message = String(error?.message || error || 'ArcGIS sign-in failed');
  if (/^ABORTED$/i.test(message.trim())) {
    return `ArcGIS OAuth was blocked. Register redirect URI in your ArcGIS OAuth app: ${popupCallbackUrl()}`;
  }
  if (/redirect|callback|invalid redirect/i.test(message)) {
    return `${message} — register OAuth redirect URI: ${popupCallbackUrl()}`;
  }
  return message;
}
