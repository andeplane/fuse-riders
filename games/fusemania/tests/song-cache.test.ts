import test from "node:test";
import assert from "node:assert/strict";
import {
  createSongStore,
  type SongCache,
  type SongCaches,
} from "../src/app/song-cache.js";

const bytes = (text: string) => new TextEncoder().encode(text);
const text = (data: ArrayBuffer) => new TextDecoder().decode(data);

/** Cache storage in memory, with the browser's rule that an entry is named by its absolute address. */
function fakeCaches(absolute: (url: string) => string) {
  const stores = new Map<string, Map<string, Response>>();
  const broken = { put: false, open: false };
  const caches: SongCaches = {
    async open(name) {
      if (broken.open) throw new Error("refused");
      const entries = stores.get(name) ?? new Map<string, Response>();
      stores.set(name, entries);
      const cache: SongCache = {
        match: async (url) => entries.get(absolute(url))?.clone(),
        async put(url, response) {
          if (broken.put) throw new Error("quota");
          entries.set(absolute(url), response);
        },
        keys: async () => [...entries.keys()].map((url) => ({ url })),
      };
      return cache;
    },
    keys: async () => [...stores.keys()],
    delete: async (name) => stores.delete(name),
  };
  return { caches, stores, broken };
}
const absolute = (url: string) =>
  new URL(url, "https://play.example/fusemania/").href;
function setup(withCaches = true) {
  const fake = fakeCaches(absolute);
  const fetched: string[] = [];
  const site = new Map([["/music/a.mp3", "song a"]]);
  const store = createSongStore({
    caches: withCaches ? fake.caches : undefined,
    fetch: async (url) => {
      fetched.push(url);
      const body = site.get(url);
      return body === undefined
        ? new Response("", { status: 404 })
        : new Response(bytes(body));
    },
    prefix: "fusemania-songs-",
    version: "v2",
    absolute,
  });
  const settle = () => new Promise<void>((resolve) => setImmediate(resolve));
  return { ...fake, store, fetched, site, settle };
}

test("a song is fetched once and read from the cache after that", async () => {
  const { store, fetched, settle, site } = setup();
  assert.deepEqual(await store.stored(), []);
  assert.equal(text(await store.fetch("/music/a.mp3")), "song a");
  await settle();
  assert.deepEqual(await store.stored(), ["https://play.example/music/a.mp3"]);
  site.delete("/music/a.mp3");
  assert.equal(text(await store.fetch("/music/a.mp3")), "song a");
  assert.deepEqual(fetched, ["/music/a.mp3"]);
});

test("a file that cannot be fetched rejects and is not kept", async () => {
  const { store, settle } = setup();
  await assert.rejects(store.fetch("/music/nope.mp3"), /audio 404/);
  await settle();
  assert.deepEqual(await store.stored(), []);
});

test("another version's songs are deleted, another game's cache is left alone", async () => {
  const { store, stores, caches } = setup();
  await (
    await caches.open("fusemania-songs-v1")
  ).put("/music/a.mp3", new Response("old"));
  await caches.open("someone-else");
  assert.equal(
    text(await store.fetch("/music/a.mp3")),
    "song a",
    "not the old version's file",
  );
  assert.deepEqual([...stores.keys()].sort(), [
    "fusemania-songs-v2",
    "someone-else",
  ]);
});

test("without cache storage, or with one that fails, the song still loads", async () => {
  const none = setup(false);
  assert.equal(text(await none.store.fetch("/music/a.mp3")), "song a");
  assert.deepEqual(await none.store.stored(), []);

  const full = setup();
  full.broken.put = true;
  assert.equal(text(await full.store.fetch("/music/a.mp3")), "song a");
  await full.settle();
  assert.deepEqual(await full.store.stored(), []);

  const refused = setup();
  refused.broken.open = true;
  assert.equal(text(await refused.store.fetch("/music/a.mp3")), "song a");
  assert.deepEqual(await refused.store.stored(), []);
});

test("a file the player loaded is never kept", async () => {
  const { store, site, settle } = setup();
  site.set("blob:https://play.example/1", "mine");
  assert.equal(text(await store.fetch("blob:https://play.example/1")), "mine");
  await settle();
  assert.deepEqual(await store.stored(), []);
});
