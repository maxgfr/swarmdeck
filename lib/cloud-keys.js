/* The secrets in the settings, apart from the rest of them: the cloud services' API keys, and the
 * credentials of TURN servers in rtcConfig.
 *
 * The settings are plain JSON in localStorage, which every page of the origin can read (on
 * maxgfr.github.io, every project page of the account). The secrets are taken out of them before
 * they are written, and kept sealed instead (lib/secrets.js); these are the pure parts of that.
 */

/** An ICE server's identity, so its credential finds it again whatever the order of the list. */
const serverId = (server) => JSON.stringify([server?.urls ?? '', server?.username ?? '']);
const iceServers = (settings) => (Array.isArray(settings?.rtcConfig?.iceServers) ? settings.rtcConfig.iceServers : []);

/**
 * The keys in a settings object: the selected service's, every service's under `accounts`, and each
 * TURN server's credential under `turn`, by server.
 */
export function keysOf(settings) {
  const cloud = settings?.cloud || {};
  const accounts = {};
  for (const [provider, account] of Object.entries(cloud.accounts || {})) {
    if (account?.apiKey) accounts[provider] = String(account.apiKey);
  }
  const turn = {};
  for (const server of iceServers(settings)) {
    if (server?.credential) turn[serverId(server)] = server.credential;
  }
  return { apiKey: cloud.apiKey ? String(cloud.apiKey) : '', accounts, turn };
}

/** Whether any key is set. */
export function hasKeys(keys) {
  return Boolean(keys?.apiKey) || Object.values(keys?.accounts || {}).some(Boolean) || Object.values(keys?.turn || {}).some(Boolean);
}

/** The same keys, compared. */
export function sameKeys(a, b) {
  const sorted = (o) => Object.entries(o || {}).filter(([, v]) => v).sort(([x], [y]) => (x < y ? -1 : 1));
  const norm = (k) => JSON.stringify([k?.apiKey || '', sorted(k?.accounts), sorted(k?.turn)]);
  return norm(a) === norm(b);
}

/** Whether the settings name a TURN server whose credential is not in them (yet). */
export function wantsTurnCredential(settings) {
  return iceServers(settings).some((server) => server?.username && !server.credential);
}

/** The settings without a single key: what may be written in clear. */
export function withoutKeys(settings) {
  const cloud = settings?.cloud || {};
  const accounts = Object.fromEntries(Object.entries(cloud.accounts || {}).map(([provider, account]) => [provider, { ...account, apiKey: '' }]));
  const out = { ...settings, cloud: { ...cloud, apiKey: '', accounts } };
  if (iceServers(settings).some((server) => server && 'credential' in server)) {
    out.rtcConfig = { ...settings.rtcConfig, iceServers: iceServers(settings).map((server) => {
      if (!server || typeof server !== 'object' || !('credential' in server)) return server;
      const rest = { ...server };
      delete rest.credential;
      return rest;
    }) };
  }
  return out;
}

/** The settings with `keys` put back: every service's own, the selected one's on top. */
export function withKeys(settings, keys) {
  const cloud = settings?.cloud || {};
  const accounts = Object.fromEntries(Object.entries(cloud.accounts || {}).map(([provider, account]) => [provider, { ...account, apiKey: keys?.accounts?.[provider] || '' }]));
  for (const [provider, apiKey] of Object.entries(keys?.accounts || {})) {
    if (apiKey && !accounts[provider]) accounts[provider] = { apiKey, apiBase: '' };
  }
  const out = { ...settings, cloud: { ...cloud, apiKey: keys?.apiKey || '', accounts } };
  if (iceServers(settings).length) {
    out.rtcConfig = { ...settings.rtcConfig, iceServers: iceServers(settings).map((server) => {
      const credential = keys?.turn?.[serverId(server)];
      return credential && server && typeof server === 'object' && !server.credential ? { ...server, credential } : server;
    }) };
  }
  return out;
}
