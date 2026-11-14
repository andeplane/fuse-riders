import test from "node:test";
import assert from "node:assert/strict";
import {
  createFakeAudioClock,
  createFakeClockedSong,
} from "fuse-ui/game-audio-fake";
import type { ClockedSong } from "fuse-ui/game-audio";
import {
  SONG_LOAD_TRIES,
  SONG_RETRY_MS,
  createSongLoader,
} from "../src/app/song-load.js";

/** A loader whose fetches the test settles by hand. */
function setup(extra: { enabled?: boolean; clock?: boolean } = {}) {
  const state = {
    now: 0,
    enabled: extra.enabled ?? true,
    clock: extra.clock ?? true,
  };
  const asked: {
    url: string;
    settle(song: ClockedSong | undefined): void;
    fail(): void;
  }[] = [];
  let changes = 0;
  const loader = createSongLoader({
    now: () => state.now,
    url: (id) => (id === "missing" ? undefined : `/music/${id}.mp3`),
    load: (url) =>
      new Promise((resolve, reject) => {
        asked.push({
          url,
          settle: resolve,
          fail: () => reject(new Error("offline")),
        });
      }),
    enabled: () => state.enabled,
    hasClock: () => state.clock,
    local: (id) => id === "custom",
    changed: () => changes++,
  });
  const song = () => createFakeClockedSong(120, createFakeAudioClock());
  /** Lets the promise chain of a settled fetch run. */
  const settle = () => new Promise<void>((resolve) => setImmediate(resolve));
  return { loader, asked, state, song, settle, changes: () => changes };
}

test("a song is not downloaded until its fetch came back, and the device says so", async () => {
  const { loader, asked, song, settle, changes } = setup();
  assert.equal(loader.status("a"), "none");
  assert.equal(loader.settled("a"), false);
  assert.equal(loader.song("a"), undefined);
  assert.equal(loader.status("a"), "loading");
  assert.equal(
    loader.settled("a"),
    false,
    "a fetch that can still bring it is waited for",
  );
  // Asked for every frame, fetched once.
  loader.song("a");
  loader.song("a");
  assert.deepEqual(
    asked.map((each) => each.url),
    ["/music/a.mp3"],
  );
  const decoded = song();
  asked[0]!.settle(decoded);
  await settle();
  assert.equal(loader.song("a"), decoded);
  assert.equal(loader.status("a"), "ready");
  assert.equal(loader.settled("a"), true);
  assert.ok(changes() >= 2, "the song select hears of both changes");
  // Another song is the one kept decoded; the first stays downloaded, but is not ready to play at once.
  loader.song("b");
  assert.equal(loader.status("a"), "ready");
  assert.equal(loader.settled("a"), false);
  assert.equal(loader.status("b"), "loading");
  assert.equal(loader.status("c"), "none");
});

test("a failed fetch is tried again after a pause, and given up after three", async () => {
  const { loader, asked, state, settle } = setup();
  for (let attempt = 1; attempt <= SONG_LOAD_TRIES; attempt++) {
    loader.song("a");
    assert.equal(asked.length, attempt);
    if (attempt % 2) asked.at(-1)!.fail();
    else asked.at(-1)!.settle(undefined);
    await settle();
    assert.equal(loader.failures(), attempt);
    // Not again before the pause is over.
    loader.song("a");
    assert.equal(asked.length, attempt);
    assert.equal(loader.settled("a"), attempt === SONG_LOAD_TRIES);
    assert.equal(
      loader.status("a"),
      attempt === SONG_LOAD_TRIES ? "failed" : "loading",
    );
    state.now += SONG_RETRY_MS;
  }
  // Given up: the device is done, so the room is not held for it, and nothing is fetched until the player asks.
  loader.song("a");
  assert.equal(asked.length, SONG_LOAD_TRIES);
  loader.retry();
  assert.equal(loader.settled("a"), false);
  loader.song("a");
  assert.equal(asked.length, SONG_LOAD_TRIES + 1);
});

test("a page that plays no songs waits for nothing and marks nothing", () => {
  const { loader, asked } = setup({ enabled: false });
  assert.equal(loader.song("a"), undefined);
  assert.equal(asked.length, 0);
  assert.equal(loader.settled("a"), true);
  assert.equal(loader.status("a"), "ready");
});

test("no audio clock is not the file's failure: the device is done, and asks again later", async () => {
  const { loader, asked, state, settle } = setup({ clock: false });
  loader.song("a");
  asked[0]!.settle(undefined);
  await settle();
  assert.equal(loader.failures(), 0);
  assert.equal(loader.settled("a"), true);
  assert.equal(loader.status("a"), "none");
  state.now += SONG_RETRY_MS;
  loader.song("a");
  assert.equal(asked.length, 2);
  assert.equal(loader.settled("a"), false, "a fetch is under way again");
});

test("songs stored on an earlier visit are downloaded, a player's own file needs no download, an unknown song fails", async () => {
  const { loader, asked, settle } = setup();
  loader.stored(["a", "b"]);
  assert.equal(loader.status("a"), "ready");
  assert.equal(loader.status("c"), "none");
  assert.equal(loader.status("custom"), "ready");
  // Downloaded is not decoded: the room still waits the moment it takes.
  loader.song("a");
  assert.equal(loader.status("a"), "ready");
  assert.equal(loader.settled("a"), false);
  loader.song("missing");
  await settle();
  assert.equal(asked.length, 1);
  assert.equal(loader.failures(), 1);
});
