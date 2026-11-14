import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { ALL_SONGS, MusicPlayer, type MusicMedia } from "../src/index.js";

function fixture() {
  let plays = 0,
    pauses = 0,
    creates = 0,
    paused = true,
    readyState = 0;
  const media: MusicMedia = {
    src: "",
    volume: 0,
    currentTime: 0,
    duration: 90,
    get readyState() {
      return readyState;
    },
    get paused() {
      return paused;
    },
    onended: null,
    onerror: null,
    onloadedmetadata: null,
    play: async () => {
      plays++;
      paused = false;
    },
    pause: () => {
      pauses++;
      paused = true;
    },
    load() {},
  };
  return {
    media,
    metadata: () => {
      readyState = 1;
    },
    createMedia: () => {
      creates++;
      return media;
    },
    get plays() {
      return plays;
    },
    get pauses() {
      return pauses;
    },
    get creates() {
      return creates;
    },
  };
}
function fire(
  media: MusicMedia,
  name: "onended" | "onerror" | "onloadedmetadata" | "onpause" | "onplay",
) {
  const handler = media[name];
  if (typeof handler === "function")
    Reflect.apply(handler, media, [new Event(name.slice(2))]);
}

test("the default catalogue contains every shipped music asset once", () => {
  const files = readdirSync(
    new URL("../../../public/music/", import.meta.url),
    { recursive: true },
  )
    .filter(
      (path): path is string =>
        typeof path === "string" && /\.(m4a|mp3|ogg)$/.test(path),
    )
    .map((path) => `/music/${path}`);
  assert.equal(
    new Set(ALL_SONGS.map((song) => song.id)).size,
    ALL_SONGS.length,
  );
  assert.deepEqual(ALL_SONGS.map((song) => song.path).sort(), files.sort());
});

test("a game's chosen catalogue is lazy, resolves deployment paths and wraps only its own songs", () => {
  const f = fixture();
  const songs = [ALL_SONGS[13], ALL_SONGS[17]] as const;
  const player = MusicPlayer(songs, {
    base: "/fuse-games/",
    createMedia: f.createMedia,
  });
  assert.equal(f.creates, 0);
  player.select(songs[1].id);
  assert.equal(f.creates, 0);
  player.play();
  assert.equal(f.media.src, `/fuse-games${songs[1].path}`);
  player.next();
  assert.equal(f.media.src, `/fuse-games${songs[0].path}`);
  player.previous();
  assert.equal(f.media.src, `/fuse-games${songs[1].path}`);
  player.play("unknown");
  assert.equal(player.song?.id, songs[1].id);
  player.destroy();
});

test("preview mute and an empty catalogue never create media, even after unmute and navigation", () => {
  for (const songs of [ALL_SONGS, []]) {
    const f = fixture();
    const player = MusicPlayer(songs, {
      muted: true,
      createMedia: f.createMedia,
    });
    player.play();
    player.next();
    player.previous();
    player.setMuted(false);
    player.unlock();
    assert.equal(f.creates, 0);
    player.destroy();
  }
  const f = fixture();
  MusicPlayer([], { createMedia: f.createMedia }).play();
  assert.equal(f.creates, 0);
});

test("mute pauses without losing intent or position and repeated refreshes do not restart playback", () => {
  const f = fixture();
  const player = MusicPlayer(ALL_SONGS, { createMedia: f.createMedia });
  player.play();
  f.media.currentTime = 23;
  player.setMuted(true);
  player.setMuted(true);
  assert.equal(player.position, 23);
  assert.equal(player.playing, true);
  assert.equal(f.pauses, 1);
  player.setMuted(false);
  player.unlock();
  assert.equal(f.plays, 2);
  player.pause();
  player.unlock();
  assert.equal(f.plays, 2);
  player.destroy();
});

test("stale play failures cannot overwrite a newer track, mute, or teardown", async () => {
  const f = fixture();
  const rejects: ((reason?: unknown) => void)[] = [];
  f.media.play = () => new Promise<void>((_, reject) => rejects.push(reject));
  const player = MusicPlayer(ALL_SONGS, { createMedia: f.createMedia });
  player.play();
  player.next();
  rejects[0]!(new Error("stale"));
  await Promise.resolve();
  assert.equal(player.error, "");
  rejects[1]!(new Error("blocked"));
  await Promise.resolve();
  assert.match(player.error, /retry/);
  player.play();
  player.setMuted(true);
  rejects[2]!(new Error("muted"));
  await Promise.resolve();
  assert.equal(player.error, "");
  player.setMuted(false);
  player.destroy();
  rejects[3]!(new Error("disposed"));
  await Promise.resolve();
  assert.equal(f.media.onended, null);
  assert.equal(f.media.src, "");
});

test("external media resume cannot bypass mute or a zero volume", () => {
  const f = fixture();
  const player = MusicPlayer(ALL_SONGS, { createMedia: f.createMedia });
  player.play();
  player.setMuted(true);
  assert.equal(f.media.volume, 0);
  const pauses = f.pauses;
  fire(f.media, "onplay");
  assert.equal(f.pauses, pauses + 1);
  assert.equal(player.audible, false);
  player.setVolume(0.7);
  assert.equal(f.media.volume, 0, "changing volume cannot bypass master mute");
  player.setMuted(false);
  assert.equal(f.media.volume, 0.7);
  player.setVolume(0);
  fire(f.media, "onplay");
  assert.equal(player.audible, false);
  player.destroy();
});

test("a host-owned queue retries a failed track on the next gesture", () => {
  const f = fixture();
  const player = MusicPlayer(ALL_SONGS, {
    createMedia: f.createMedia,
    retryOnGesture: true,
  });
  player.play();
  fire(f.media, "onerror");
  assert.equal(player.playing, true);
  player.unlock();
  assert.equal(f.plays, 2);
  assert.equal(f.media.src, ALL_SONGS[0].path);
  player.destroy();
});

test("metadata restores a bounded seek; ended advances or delegates to a richer radio", () => {
  const f = fixture();
  const player = MusicPlayer(ALL_SONGS, {
    base: "./",
    createMedia: f.createMedia,
  });
  player.play(ALL_SONGS[0].id, 300);
  assert.equal(f.media.src, `..${ALL_SONGS[0].path}`);
  f.metadata();
  fire(f.media, "onloadedmetadata");
  assert.equal(f.media.currentTime, 90);
  player.play(ALL_SONGS[0].id, -1);
  assert.equal(f.media.currentTime, 0);
  fire(f.media, "onended");
  assert.equal(player.song?.id, ALL_SONGS[1].id);
  player.destroy();
  let ended = 0;
  const custom = MusicPlayer(ALL_SONGS, {
    createMedia: f.createMedia,
    onEnded: () => ended++,
  });
  custom.play();
  fire(f.media, "onended");
  assert.equal(ended, 1);
  assert.equal(custom.song?.id, ALL_SONGS[0].id);
  custom.destroy();
});
