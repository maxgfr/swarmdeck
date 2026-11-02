/* The settings' secrets (lib/cloud-keys.js) kept at rest by llm-connect's sealedStore: AES-GCM under
 * a key the browser makes non-extractable and keeps in IndexedDB, a fresh IV on every write, the
 * name bound to the record. What localStorage, a backup of it or a look at the storage shows of a
 * secret is ciphertext.
 *
 * Plain ES module, nothing but IndexedDB and crypto.subtle, so it runs in Node for the tests too.
 */
import { sealedStore } from '../vendor/llm-connect-sealed-store.js';

export const SECRETS_DB = 'swarmdeck-sealed';
const NAME = 'keys';

/* Where earlier versions sealed the keys with their own code: { iv, data } under the AES-GCM key
 * beside it, in the store `box`. Read once to move them over, then deleted (the name is ours). */
const LEGACY_DB = 'swarmdeck-keys';

function request(r) {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

async function readLegacy() {
  let db;
  try {
    // An upgrade means there was no such database: aborted, so none is created.
    const open = indexedDB.open(LEGACY_DB);
    open.onupgradeneeded = () => open.transaction?.abort();
    db = await request(open);
    if (!db.objectStoreNames.contains('box')) return null;
    const get = (id) => request(db.transaction('box', 'readonly').objectStore('box').get(id));
    const [key, sealed] = [await get('aes-gcm-key'), await get('cloud')];
    if (!key || !sealed?.iv || !sealed?.data) return null;
    return JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: sealed.iv }, key, sealed.data)));
  } catch {
    return null;
  } finally {
    db?.close();
  }
}

function dropLegacy() {
  try { indexedDB.deleteDatabase(LEGACY_DB); } catch { /* nothing to clean up */ }
}

/**
 * read() → the keys, or null when there are none; throws when this browser cannot keep any.
 * write(keys) → whether they were stored; nothing is ever written in clear instead.
 */
export function openSecrets() {
  const sealed = sealedStore({ dbName: SECRETS_DB });
  return {
    async read() {
      if (!sealed.available) throw new Error('no IndexedDB or WebCrypto here');
      const text = await sealed.get(NAME);
      if (text !== null) {
        try { return JSON.parse(text); } catch { return null; }
      }
      // Keys sealed by an earlier version: moved over, the old copy dropped only once that is stored.
      const legacy = await readLegacy();
      if (legacy && (await sealed.set(NAME, JSON.stringify(legacy)))) dropLegacy();
      return legacy;
    },
    async write(keys) {
      if (!(await sealed.set(NAME, JSON.stringify(keys)))) return false;
      dropLegacy();
      return true;
    },
  };
}
