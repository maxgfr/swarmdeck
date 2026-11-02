/* The cloud services' API keys, apart from the rest of the settings.
 *
 * The settings are plain JSON in localStorage, which every page of the origin can read (on
 * maxgfr.github.io, every project page of the account). The keys are taken out of them before they
 * are written, and kept encrypted instead (lib/secret-box.js); these are the pure parts of that.
 */

/** The keys in a settings object: the selected service's, and every service's under `accounts`. */
export function keysOf(settings) {
  const cloud = settings?.cloud || {};
  const accounts = {};
  for (const [provider, account] of Object.entries(cloud.accounts || {})) {
    if (account?.apiKey) accounts[provider] = String(account.apiKey);
  }
  return { apiKey: cloud.apiKey ? String(cloud.apiKey) : '', accounts };
}

/** Whether any key is set. */
export function hasKeys(keys) {
  return Boolean(keys?.apiKey) || Object.values(keys?.accounts || {}).some(Boolean);
}

/** The same keys, compared. */
export function sameKeys(a, b) {
  const norm = (k) => JSON.stringify([k?.apiKey || '', Object.entries(k?.accounts || {}).filter(([, v]) => v).sort(([x], [y]) => (x < y ? -1 : 1))]);
  return norm(a) === norm(b);
}

/** The settings without a single key: what may be written in clear. */
export function withoutKeys(settings) {
  const cloud = settings?.cloud || {};
  const accounts = Object.fromEntries(Object.entries(cloud.accounts || {}).map(([provider, account]) => [provider, { ...account, apiKey: '' }]));
  return { ...settings, cloud: { ...cloud, apiKey: '', accounts } };
}

/** The settings with `keys` put back: every service's own, the selected one's on top. */
export function withKeys(settings, keys) {
  const cloud = settings?.cloud || {};
  const accounts = Object.fromEntries(Object.entries(cloud.accounts || {}).map(([provider, account]) => [provider, { ...account, apiKey: keys?.accounts?.[provider] || '' }]));
  for (const [provider, apiKey] of Object.entries(keys?.accounts || {})) {
    if (apiKey && !accounts[provider]) accounts[provider] = { apiKey, apiBase: '' };
  }
  return { ...settings, cloud: { ...cloud, apiKey: keys?.apiKey || '', accounts } };
}
