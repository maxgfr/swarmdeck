/* Where the torrents' pieces go in the browser's private storage (OPFS).
 *
 * Every project page of maxgfr.github.io shares one origin, so one OPFS root: the pieces go in a
 * directory of the app's own, `swarmdeck/`, never among other sites' files. Earlier versions kept each
 * torrent's store at the root; those are moved in once, or dropped when no torrent of the list owns
 * them, and nothing else at the root is touched.
 */

export const OPFS_HOME = 'swarmdeck';

/** A torrent's store, as WebTorrent names it: "<torrent name> - <first 8 hex of info hash>". */
export const STORE_DIR_RE = / - ([a-f0-9]{8})$/;

/** Whether `dir` holds nothing but pieces (files named by their index), as one of WebTorrent's stores does. */
export async function isPieceStore(dir) {
  for await (const [name, handle] of dir.entries()) {
    if (handle.kind !== 'file' || !/^\d+$/.test(name)) return false;
  }
  return true;
}

async function exists(dir, name) {
  try {
    await dir.getDirectoryHandle(name);
    return true;
  } catch {
    return false;
  }
}

/** One store moved from the root into `home`: in place where the browser can, else copied piece by piece. */
async function moveStore(root, home, name, dir) {
  if (typeof dir.move === 'function') {
    try {
      await dir.move(home);
      return true;
    } catch { /* copied instead */ }
  }
  try {
    const target = await home.getDirectoryHandle(name, { create: true });
    for await (const [piece, handle] of dir.entries()) {
      const writable = await (await target.getFileHandle(piece, { create: true })).createWritable();
      await writable.write(await handle.getFile());
      await writable.close();
    }
  } catch {
    // Half a copy is no store: it goes, and the old one stays for the next start to try again.
    await home.removeEntry(name, { recursive: true }).catch(() => {});
    return false;
  }
  await root.removeEntry(name, { recursive: true }).catch(() => {});
  return true;
}

/**
 * The stores an earlier version left at the root. One of a torrent still in the list (`known`: the
 * first 8 hex of its info hash) is moved into `home`, unless one is there already; any other is an
 * orphan and goes. Only directories named and shaped like a store are touched: whatever else another
 * site keeps at the root stays as it is.
 */
export async function adoptRootStores(root, home, known) {
  const old = [];
  for await (const [name, handle] of root.entries()) {
    const m = handle.kind === 'directory' && name.match(STORE_DIR_RE);
    if (m) old.push({ name, hash: m[1], dir: handle });
  }
  for (const { name, hash, dir } of old) {
    if (!(await isPieceStore(dir).catch(() => false))) continue;
    if (known.has(hash) && !(await exists(home, name))) await moveStore(root, home, name, dir);
    else await root.removeEntry(name, { recursive: true }).catch(() => {});
  }
}
