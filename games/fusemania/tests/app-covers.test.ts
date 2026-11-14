import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { COVERS, coverPath } from "../src/app/covers.js";
import { OWN_PACK, packsOf } from "../src/app/packs.js";
import { PACKS_DATA } from "../src/app/packs-data.js";
import { LIBRARY } from "../src/songs.js";
import { PACKS, SONGS } from "../../../scripts/lib/fusemania/songs.js";
import { packsDataModule } from "../../../scripts/lib/fusemania/ssc.js";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const PUBLIC = `${ROOT}public/`;

test("the packs and covers the game ships are the ones the song list and the cover folder give", () => {
  const covers = readdirSync(`${PUBLIC}music/covers`).map((name) =>
    name.replace(/\.jpg$/, ""),
  );
  assert.equal(
    readFileSync(`${ROOT}games/fusemania/src/app/packs-data.ts`, "utf8"),
    packsDataModule(PACKS, SONGS, covers),
    "run `pnpm exec tsx scripts/fusemania-charts.ts bundle`",
  );
});

test("every song is in exactly one pack, and the first pack is the Fuse soundtrack", () => {
  const ids = PACKS_DATA.flatMap((pack) => pack.songs);
  assert.deepEqual(
    [...ids].sort(),
    LIBRARY.songs.map((song) => song.id).sort(),
  );
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(PACKS_DATA[0]?.name, "FUSEMANIA");
  assert.ok(PACKS_DATA.every((pack) => pack.songs.length > 0));
  // The packs to come have their place in the order already.
  assert.deepEqual(
    PACKS.map((pack) => pack.id),
    ["fusemania", "ddr-jazz-mix", "itg-jazz-mix"],
  );
});

test("a pack file puts each pack's songs by title, leaves an empty pack out and refuses an unknown pack", () => {
  const spec = (id: string, title: string, pack: string) => ({
    id,
    title,
    artist: "Fuse",
    file: `public/music/${pack}/${id}.mp3`,
    audio: `music/${pack}/${id}.mp3`,
    pack,
  });
  const text = packsDataModule(
    PACKS,
    [
      spec("zebra", "Zebra", "fusemania"),
      spec("blue-note", "Blue Note", "ddr-jazz-mix"),
      spec("apple", "Apple", "fusemania"),
    ],
    ["zebra", "not-a-song"],
  );
  assert.ok(text.indexOf('"apple"') < text.indexOf('"zebra"'));
  assert.ok(text.indexOf('"FUSEMANIA"') < text.indexOf('"DDR JAZZ MIX"'));
  assert.equal(text.includes("ITG JAZZ MIX"), false);
  // A cover file without a song is not listed.
  assert.equal(text.includes("not-a-song"), false);
  assert.throws(
    () => packsDataModule(PACKS, [spec("a", "A", "nowhere")], []),
    /nowhere/,
  );
});

test("packsOf groups the songs on hand: an unlisted song joins the first pack, a loaded simfile gets its own", () => {
  const packs = [
    { id: "one", name: "ONE", songs: ["a", "b"] },
    { id: "two", name: "TWO", songs: ["c"] },
    { id: "three", name: "THREE", songs: ["gone"] },
  ];
  const songs = ["b", "x", "a", "c", "custom"].map((id) => ({ id }));
  assert.deepEqual(packsOf(songs, "custom", packs), [
    { id: "one", name: "ONE", songs: ["a", "b", "x"] },
    { id: "two", name: "TWO", songs: ["c"] },
    { ...OWN_PACK, songs: ["custom"] },
  ]);
  // No loaded simfile, no pack for it.
  assert.deepEqual(
    packsOf([{ id: "c" }], "custom", packs).map((pack) => pack.id),
    ["two"],
  );
  assert.deepEqual(packsOf([{ id: "x" }], undefined, []), [
    { id: "songs", name: "SONGS", songs: ["x"] },
  ]);
  assert.deepEqual(
    packsOf(LIBRARY.songs).map((pack) => pack.songs.length),
    PACKS_DATA.map((pack) => pack.songs.length),
  );
});

test("a listed cover is a small image in public/, and a song without one has no path", () => {
  for (const id of COVERS) {
    const path = coverPath(id);
    assert.equal(path, `music/covers/${id}.jpg`);
    assert.ok(existsSync(PUBLIC + path), `${path} is in public/`);
    // A carousel loads several at once: each stays a small file.
    assert.ok(statSync(PUBLIC + path).size < 120_000, `${path} is small`);
    assert.ok(LIBRARY.song(id), `${id} is a bundled song`);
  }
  // The whole Fuse soundtrack has its art.
  for (const id of PACKS_DATA[0]!.songs) assert.ok(COVERS.has(id), id);
  assert.equal(coverPath("custom"), undefined);
  assert.equal(coverPath(""), undefined);
});
