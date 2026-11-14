import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chartLevel } from "../src/app/song-picker.js";
import { CHARTNET_DATA } from "../src/engine/chartnet-data.js";
import { createLibrary } from "../src/engine/library.js";
import { parseSimfile } from "../src/engine/simfile.js";
import { SONGS_DATA } from "../src/engine/songs-data.js";
import { LIBRARY } from "../src/songs.js";

const repo = fileURLToPath(new URL("../../../", import.meta.url));
const read = (file: string): string => readFileSync(`${repo}${file}`, "utf8");
const OWN = ["Easy", "Medium", "Hard", "Challenge"];

test("every song has ChartNet charts, bundled as they are on disk", () => {
  assert.deepEqual(
    Object.keys(CHARTNET_DATA).sort(),
    SONGS_DATA.map((song) => song.id).sort(),
  );
  for (const song of SONGS_DATA) {
    const file = read(`games/fusemania/charts/chartnet/${song.id}.ssc`);
    const own = song.ssc;
    const head = own.slice(0, own.indexOf("\n#NOTEDATA:"));
    assert.ok(
      file.startsWith(`${head}\n`),
      `${song.id}: same header and timing`,
    );
    assert.equal(
      `${head}\n${CHARTNET_DATA[song.id]}`,
      file,
      `${song.id}: the bundle is stale; run scripts/chartnet/bundle.ts`,
    );
  }
});

test("ChartNet charts are well formed: four difficulties, each busier, no hands, freezes that end", () => {
  for (const song of SONGS_DATA) {
    const sim = parseSimfile(
      read(`games/fusemania/charts/chartnet/${song.id}.ssc`),
    );
    assert.deepEqual(
      sim.charts.map((chart) => [chart.difficulty, chart.description]),
      OWN.map((difficulty) => [difficulty, "ChartNet"]),
      song.id,
    );
    let rows = 0,
      meter = 0;
    for (const chart of sim.charts) {
      const where = `${song.id} ${chart.difficulty}`;
      assert.equal(chart.stepsType, "dance-single", where);
      const byBeat = new Map<number, number>();
      for (const note of chart.notes) {
        if (note.kind === "mine") continue;
        byBeat.set(note.beat, (byBeat.get(note.beat) ?? 0) + 1);
        if (note.kind === "hold")
          assert.ok(
            note.endBeat !== undefined && note.endBeat > note.beat,
            `${where}: freeze at ${note.beat} has no tail`,
          );
      }
      for (const [beat, arrows] of byBeat)
        assert.ok(arrows <= 2, `${where}: ${arrows} arrows at beat ${beat}`);
      assert.ok(
        byBeat.size > rows,
        `${where}: ${byBeat.size} rows after ${rows}`,
      );
      assert.ok(chart.meter > meter, `${where}: meter ${chart.meter}`);
      rows = byBeat.size;
      meter = chart.meter;
    }
  }
});

test("the game offers ChartNet's charts after each song's own, so the default chart stays the same", () => {
  for (const song of LIBRARY.songs) {
    assert.deepEqual(
      song.charts.map((chart) => chart.name),
      [...OWN, ...OWN.map((name) => `${name} ChartNet`)],
      song.id,
    );
  }
  // The song's own charts are exactly what they are without ChartNet.
  const plain = createLibrary(SONGS_DATA);
  for (const song of plain.songs)
    assert.deepEqual(
      song.charts,
      LIBRARY.song(song.id)!.charts.slice(0, 4),
      song.id,
    );
});

test("an alternate chart is named after its description and takes its difficulty's colour", () => {
  assert.equal(chartLevel("Hard ChartNet"), "hard");
  assert.equal(chartLevel("Easy"), "easy");
  const ssc = SONGS_DATA[0]!.ssc;
  const extra = ssc
    .slice(ssc.indexOf("\n#NOTEDATA:"))
    .split("\n#NOTEDATA:")[1]!
    .replace("#DESCRIPTION:Easy;", "#DESCRIPTION:;");
  const library = createLibrary([
    { ...SONGS_DATA[0]!, ssc: `${ssc}\n#NOTEDATA:${extra}` },
  ]);
  assert.deepEqual(
    library.songs[0]!.charts.map((chart) => chart.name),
    [...OWN, "Easy Alt"],
  );
});
