import assert from "node:assert/strict";
import test from "node:test";
import {
  MUSIC_TRACKS,
  RADIO_KEY,
  defaultRadio,
  followingTrack,
  formatTrackTime,
  loadRadio,
  parseRadio,
  precedingTrack,
  radioQueue,
  radioShortcut,
  saveRadio,
  togglePlaylistTrack,
  type RadioState,
} from "../src/client/radio.ts";
import { createMemoryStorage } from "../src/client/safe-storage.ts";

const ids = MUSIC_TRACKS.map((track) => track.id);
const radio = (changes: Partial<RadioState> = {}): RadioState => ({
  ...defaultRadio(),
  ...changes,
});
const key = (
  code: string,
  modifiers: {
    alt?: boolean;
    shift?: boolean;
    meta?: boolean;
    ctrl?: boolean;
  } = {},
) => ({
  code,
  ctrlKey: modifiers.ctrl ?? true,
  altKey: modifiers.alt ?? false,
  shiftKey: modifiers.shift ?? false,
  metaKey: modifiers.meta ?? false,
});

test("stored radio state round-trips and survives page loads", () => {
  const storage = createMemoryStorage();
  assert.deepEqual(loadRadio(storage), defaultRadio());
  const state = radio({
    track: "forest-job",
    position: 42.5,
    paused: true,
    loopSong: true,
    loopPlaylist: false,
    source: "playlist",
    playlist: ["final-chase", "forest-job"],
  });
  saveRadio(storage, state);
  assert.deepEqual(loadRadio(storage), state);
  assert.ok(storage.getItem(RADIO_KEY));
});

test("corrupt stored fields fall back individually without discarding valid ones", () => {
  for (const raw of [null, "", "{", "null", "[]", "7", '"radio"'])
    assert.deepEqual(parseRadio(raw), defaultRadio(), String(raw));
  const parsed = parseRadio(
    JSON.stringify({
      track: "forest-job",
      position: -1,
      paused: 1,
      loopSong: true,
      source: "radio",
      playlist: ["final-chase", "nope", "final-chase", 3, "coin-op-swing"],
    }),
  );
  assert.equal(parsed.track, "forest-job");
  assert.equal(parsed.position, 0);
  assert.equal(parsed.paused, false);
  assert.equal(parsed.loopSong, true);
  assert.equal(parsed.loopPlaylist, true);
  assert.equal(parsed.source, "all");
  assert.deepEqual(parsed.playlist, ["final-chase", "coin-op-swing"]);
  for (const position of [Number.MAX_VALUE, 3601])
    assert.equal(
      parseRadio(JSON.stringify({ track: "forest-job", position })).position,
      0,
    );
  assert.deepEqual(
    parseRadio(JSON.stringify({ track: "deleted-song", position: 30 })),
    defaultRadio(),
    "a position only applies to a known track",
  );
});

test("blocked storage loads defaults and silently skips saving", () => {
  const blocked = {
    getItem(): string {
      throw new Error("SecurityError");
    },
    setItem(): void {
      throw new Error("QuotaExceededError");
    },
    removeItem() {},
  };
  assert.deepEqual(loadRadio(blocked), defaultRadio());
  assert.doesNotThrow(() => saveRadio(blocked, defaultRadio()));
});

test("all tracks wrap; loop song repeats only an ended song", () => {
  assert.deepEqual(radioQueue(radio()), ids);
  assert.equal(followingTrack(radio(), "ended"), ids[1]);
  assert.equal(followingTrack(radio({ track: ids.at(-1)! }), "ended"), ids[0]);
  assert.equal(
    followingTrack(radio({ track: ids.at(-1)!, loopPlaylist: false }), "ended"),
    ids[0],
    "loop playlist does not apply to all tracks",
  );
  assert.equal(
    followingTrack(radio({ track: "forest-job", loopSong: true }), "ended"),
    "forest-job",
  );
  assert.equal(
    followingTrack(radio({ track: "forest-job", loopSong: true }), "next"),
    "neon-grid-chase",
    "next skips a looping song",
  );
  assert.equal(precedingTrack(radio()), ids.at(-1));
  assert.equal(
    precedingTrack(radio({ track: "forest-job" })),
    "arcade-adventure",
  );
});

test("playlist plays in order, stops at the end unless looped, and falls back to all tracks while empty", () => {
  const playlist = radio({
    source: "playlist",
    playlist: ["final-chase", "coin-op-swing"],
    loopPlaylist: false,
    track: "final-chase",
  });
  assert.deepEqual(radioQueue(playlist), ["final-chase", "coin-op-swing"]);
  assert.equal(followingTrack(playlist, "ended"), "coin-op-swing");
  assert.equal(
    followingTrack({ ...playlist, track: "coin-op-swing" }, "ended"),
    undefined,
  );
  assert.equal(
    followingTrack({ ...playlist, track: "coin-op-swing" }, "next"),
    "final-chase",
    "a listener can always skip forward",
  );
  assert.equal(
    followingTrack(
      { ...playlist, track: "coin-op-swing", loopPlaylist: true },
      "ended",
    ),
    "final-chase",
  );
  assert.equal(
    followingTrack({ ...playlist, track: "forest-job" }, "ended"),
    "final-chase",
    "a track outside the playlist hands over to its start",
  );
  assert.equal(
    precedingTrack({ ...playlist, track: "forest-job" }),
    "final-chase",
  );
  assert.equal(precedingTrack(playlist), "coin-op-swing");
  const empty = radio({
    source: "playlist",
    playlist: [],
    loopPlaylist: false,
    track: ids.at(-1)!,
  });
  assert.deepEqual(radioQueue(empty), ids);
  assert.equal(followingTrack(empty, "ended"), ids[0]);
});

test("playlist toggling appends and removes without reordering", () => {
  let playlist = togglePlaylistTrack([], "forest-job");
  playlist = togglePlaylistTrack(playlist, "coin-op-swing");
  playlist = togglePlaylistTrack(playlist, "final-chase");
  assert.deepEqual(playlist, ["forest-job", "coin-op-swing", "final-chase"]);
  assert.deepEqual(togglePlaylistTrack(playlist, "coin-op-swing"), [
    "forest-job",
    "final-chase",
  ]);
});

test("radio shortcuts need Ctrl alone or Ctrl+Alt and ignore other chords", () => {
  assert.equal(radioShortcut(key("KeyA")), "radio");
  assert.equal(radioShortcut(key("KeyM")), "muteAll");
  assert.equal(radioShortcut(key("KeyM", { alt: true })), "muteMusic");
  assert.equal(radioShortcut(key("KeyE", { alt: true })), "muteEffects");
  for (const ignored of [
    key("KeyA", { ctrl: false }),
    key("KeyM", { meta: true }),
    key("KeyM", { shift: true }),
    key("KeyA", { alt: true }),
    key("KeyE"),
    key("Space"),
    key("KeyP", { alt: true }),
  ]) {
    assert.equal(radioShortcut(ignored), undefined, JSON.stringify(ignored));
  }
  const altGraph = {
    ...key("KeyE", { alt: true }),
    getModifierState: (modifier: string) => modifier === "AltGraph",
  };
  assert.equal(
    radioShortcut(altGraph),
    undefined,
    "AltGr+E types € rather than muting effects",
  );
});

test("track times format as minutes and seconds", () => {
  assert.equal(formatTrackTime(0), "0:00");
  assert.equal(formatTrackTime(61.9), "1:01");
  assert.equal(formatTrackTime(600), "10:00");
  for (const unknown of [undefined, NaN, -1, Infinity])
    assert.equal(formatTrackTime(unknown), "-:--");
});
