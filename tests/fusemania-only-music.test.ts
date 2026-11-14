import test from "node:test";
import assert from "node:assert/strict";
import { ALL_SONGS } from "../packages/fuse-music/src/index.js";
import { FUSE_TRACKS } from "../packages/fuseos/src/winamp/fuseTracks.js";
import { SONGS } from "../scripts/lib/fusemania/songs.js";

// Fusemania's jazz-mix covers are Fusemania songs, and FuseOS plays them; the radio other games use never does.
const covers = SONGS.filter((song) => song.pack !== "fusemania");

test("Fusemania's covers are never radio music", () => {
  assert.ok(covers.length > 0, "no Fusemania covers found");
  const radio = new Set<string>(ALL_SONGS.map((song) => song.path));
  for (const song of covers)
    assert.ok(!radio.has(`/${song.audio}`), `${song.id} is in the radio`);
  for (const song of ALL_SONGS)
    assert.ok(
      !covers.some((cover) => song.path.endsWith(`/${cover.audio}`)),
      `${song.path} is a Fusemania cover in the radio`,
    );
});

test("FuseOS lists every Fusemania cover, credited to Fusemania alone", () => {
  for (const song of covers) {
    const track = FUSE_TRACKS.find((each) => each.path === song.audio);
    assert.ok(track, `${song.id} is missing from FuseOS`);
    assert.deepEqual(track.games, ["fusemania"], song.id);
  }
});
