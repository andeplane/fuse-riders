/**
 * The songs' audio files, kept in the browser's cache storage: a song downloaded once is there the next time the
 * page opens, and the page can say which songs it has. The cache is named after the rules version, since a new
 * version may bring new audio under the same address; the caches of other versions are deleted.
 *
 * Everything here is best effort. Where there is no cache storage (an insecure origin, a private window that
 * refuses it) or it fails, the file is fetched as before and nothing is remembered.
 */
export interface SongCache {
  match(url: string): Promise<Response | undefined>;
  put(url: string, response: Response): Promise<void>;
  keys(): Promise<readonly { readonly url: string }[]>;
}
export interface SongCaches {
  open(name: string): Promise<SongCache>;
  keys(): Promise<readonly string[]>;
  delete(name: string): Promise<boolean>;
}
export interface SongStoreDeps {
  /** The browser's `caches`, or undefined where there is none. */
  caches: SongCaches | undefined;
  fetch(url: string): Promise<Response>;
  /** Every cache this game made starts with this; `version` completes the name of the one in use. */
  prefix: string;
  version: string;
  /** The absolute form of an address, as the cache names its entries. */
  absolute(url: string): string;
}
export interface SongStore {
  /** The bytes of an audio file: from the cache, else fetched and put there. Rejects when it cannot be fetched. */
  fetch(url: string): Promise<ArrayBuffer>;
  /** The absolute addresses of the files in the cache. Empty where there is no cache. */
  stored(): Promise<string[]>;
}

/** An address that is the page's own and lasts: not a file the player loaded. */
const lasting = (url: string) => !/^(blob:|data:)/.test(url);

export function createSongStore(deps: SongStoreDeps): SongStore {
  const name = deps.prefix + deps.version;
  let opened: Promise<SongCache | undefined> | undefined;
  const cache = () =>
    (opened ??= (async () => {
      const caches = deps.caches;
      if (!caches) return undefined;
      try {
        for (const other of await caches.keys())
          if (other.startsWith(deps.prefix) && other !== name)
            await caches.delete(other);
        return await caches.open(name);
      } catch {
        return undefined;
      }
    })());
  return {
    async fetch(url) {
      const store = lasting(url) ? await cache() : undefined;
      if (store) {
        try {
          const hit = await store.match(url);
          if (hit?.ok) return await hit.arrayBuffer();
        } catch {
          // A cache that cannot be read is no cache: the file is fetched.
        }
      }
      const response = await deps.fetch(url);
      if (!response.ok) throw new Error(`audio ${response.status}`);
      const copy = store ? response.clone() : undefined;
      const data = await response.arrayBuffer();
      // Kept only once the whole file arrived; a full disk or a refused write loses nothing but the copy.
      if (store && copy) void store.put(url, copy).catch(() => undefined);
      return data;
    },
    async stored() {
      try {
        const store = await cache();
        return store ? (await store.keys()).map((entry) => entry.url) : [];
      } catch {
        return [];
      }
    },
  };
}
