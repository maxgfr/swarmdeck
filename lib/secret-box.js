/* Secrets kept at rest encrypted: AES-GCM, under a key the browser makes non-extractable and keeps in
 * IndexedDB. A page can use that key to encrypt and decrypt, never read it out; what localStorage,
 * a backup of it or a look at the storage shows of a secret is ciphertext.
 *
 * Plain ES module, nothing but IndexedDB and crypto.subtle, so it runs in Node for the tests too.
 */

const STORE = 'box';
const KEY_ID = 'aes-gcm-key';
const IV_BYTES = 12;

function request(r) {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

/** Resolves once the transaction is committed: what was written is on disk. */
function committed(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('transaction aborted'));
  });
}

/**
 * A box of named secrets in the IndexedDB database `name`.
 * read(id) → the value written under id, or null; write(id, value) resolves once it is committed;
 * remove(id). Each throws when storage or the key fails: nothing is ever written in clear instead.
 */
export function openSecretBox(name, { indexedDB = globalThis.indexedDB, subtle = globalThis.crypto?.subtle } = {}) {
  let db = null;
  let key = null;

  const open = () => {
    db ??= new Promise((resolve, reject) => {
      if (!indexedDB || !subtle) throw new Error('no IndexedDB or WebCrypto here');
      const r = indexedDB.open(name, 1);
      r.onupgradeneeded = () => r.result.createObjectStore(STORE);
      r.onsuccess = () => {
        const handle = r.result;
        handle.onversionchange = () => { handle.close(); db = null; };
        resolve(handle);
      };
      r.onerror = () => reject(r.error);
    }).catch((err) => { db = null; throw err; });
    return db;
  };

  const cryptoKey = () => {
    key ??= (async () => {
      const handle = await open();
      const found = await request(handle.transaction(STORE, 'readonly').objectStore(STORE).get(KEY_ID));
      if (found) return found;
      const made = await subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
      // Another tab may have made one meanwhile: add() refuses to replace it, and that one is used.
      const tx = handle.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).add(made, KEY_ID);
      try {
        await committed(tx);
        return made;
      } catch {
        const theirs = await request(handle.transaction(STORE, 'readonly').objectStore(STORE).get(KEY_ID));
        if (!theirs) throw new Error('the encryption key could not be stored');
        return theirs;
      }
    })().catch((err) => { key = null; throw err; });
    return key;
  };

  return {
    async read(id) {
      const handle = await open();
      const sealed = await request(handle.transaction(STORE, 'readonly').objectStore(STORE).get(id));
      if (!sealed) return null;
      const plain = await subtle.decrypt({ name: 'AES-GCM', iv: sealed.iv }, await cryptoKey(), sealed.data);
      return JSON.parse(new TextDecoder().decode(plain));
    },
    async write(id, value) {
      const k = await cryptoKey();
      // A fresh IV for every write: AES-GCM must never see one twice under the same key.
      const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
      const data = await subtle.encrypt({ name: 'AES-GCM', iv }, k, new TextEncoder().encode(JSON.stringify(value)));
      const tx = (await open()).transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put({ iv, data }, id);
      await committed(tx);
    },
    async remove(id) {
      const tx = (await open()).transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(id);
      await committed(tx);
    },
  };
}
