import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { SONGS_DATA } from "../src/engine/songs-data.js";
import {
  parseSimfile,
  type ChartNote,
  type SimChart,
} from "../src/engine/simfile.js";
import { createTiming } from "../src/engine/timing.js";
import { parseAnalysis } from "../../../scripts/lib/fusemania/analysis.js";
import {
  jackRate,
  measureChart,
  pool,
  share,
  type Measures,
} from "../../../scripts/lib/fusemania/compare.js";
import { DIFFICULTIES } from "../../../scripts/lib/fusemania/generate.js";
import { referenceFor } from "../../../scripts/lib/fusemania/reference.js";
import { SONGS } from "../../../scripts/lib/fusemania/songs.js";
import { sscText } from "../../../scripts/lib/fusemania/ssc.js";

const repo = fileURLToPath(new URL("../../../", import.meta.url));
const read = (file: string): string => readFileSync(`${repo}${file}`, "utf8");

/** What each difficulty promises: its meter, how busy it may get and how fast two rows may follow each other. */
const BOUNDS = [
  {
    name: "Easy",
    meter: [2, 4],
    average: [0.9, 1.8],
    peak: [1.2, 2.3],
    gap: 0.3,
    jack: 1,
  },
  {
    name: "Medium",
    meter: [5, 7],
    average: [1.5, 2.8],
    peak: [2.2, 3.7],
    gap: 0.16,
    jack: 0.5,
  },
  {
    name: "Hard",
    meter: [8, 10],
    average: [2.2, 4.2],
    peak: [3.2, 5.6],
    gap: 0.095,
    jack: 0.5,
  },
  {
    name: "Challenge",
    meter: [10, 13],
    average: [3.2, 6],
    peak: [4.8, 8.6],
    gap: 0.07,
    jack: 0.5,
  },
] as const;

const stepsOf = (chart: SimChart): ChartNote[] =>
  chart.notes.filter((note) => note.kind !== "mine");
/** The beats that carry a step, in order: a jump is one row. */
const rowsOf = (chart: SimChart): number[] =>
  [...new Set(stepsOf(chart).map((note) => note.beat))].sort((a, b) => a - b);

const songs = SONGS_DATA.map((data) => ({ data, sim: parseSimfile(data.ssc) }));
/** Charts ChartNet wrote (`scripts/chartnet`): a learned model's, with conventions of their own (tested below). */
const isChartNet = (data: { ssc: string }): boolean =>
  data.ssc.includes("#CREDIT:ChartNet;");
/** Songs whose charts the rule generator wrote, which keep to its conventions. */
const ruleSongs = songs.filter(({ data }) => !isChartNet(data));

test("the bundle is every song of the portfolio, once, with audio that exists", () => {
  assert.equal(SONGS_DATA.length, SONGS.length);
  assert.equal(new Set(SONGS_DATA.map((song) => song.id)).size, SONGS.length);
  const titles = songs.map(({ sim }) => sim.title);
  assert.deepEqual(
    titles,
    [...titles].sort((a, b) => a.localeCompare(b, "en")),
    "sorted by title",
  );
  for (const { data, sim } of songs) {
    const spec = SONGS.find((song) => song.id === data.id);
    assert.ok(spec, `${data.id}: not a song of scripts/lib/fusemania/songs.ts`);
    assert.equal(data.audio, spec.audio);
    assert.ok(
      !data.audio.startsWith("/"),
      `${data.id}: audio is site-relative`,
    );
    assert.ok(existsSync(`${repo}${spec.file}`), `${spec.file} is missing`);
    assert.equal(sim.title, spec.title);
    assert.equal(sim.artist, spec.artist);
    assert.equal(sim.music, data.audio.slice(data.audio.lastIndexOf("/") + 1));
    assert.equal(
      data.ssc,
      read(`games/fusemania/charts/${data.id}.ssc`),
      `${data.id}: the bundle is stale; run scripts/fusemania-charts.ts bundle`,
    );
  }
});

test("every song has Easy, Medium, Hard and Challenge, each harder than the last", () => {
  for (const { data, sim } of songs) {
    assert.deepEqual(
      sim.charts.map((chart) => chart.difficulty),
      BOUNDS.map((bound) => bound.name),
      data.id,
    );
    let notes = 0,
      meter = 0;
    sim.charts.forEach((chart, index) => {
      const bound = BOUNDS[index]!;
      const where = `${data.id} ${chart.difficulty}`;
      assert.equal(chart.stepsType, "dance-single", where);
      assert.ok(
        chart.meter >= bound.meter[0] && chart.meter <= bound.meter[1],
        `${where}: meter ${chart.meter}`,
      );
      assert.ok(chart.meter >= meter, `${where}: meter falls`);
      const count = stepsOf(chart).length;
      assert.ok(count > notes, `${where}: ${count} notes after ${notes}`);
      notes = count;
      meter = chart.meter;
    });
  }
});

test("every chart is well formed: ordered, no doubled arrows, no hands, freezes that end", () => {
  for (const { data, sim } of songs)
    for (const chart of sim.charts) {
      const where = `${data.id} ${chart.difficulty}`;
      const seen = new Set<string>();
      let before = -Infinity;
      for (const note of chart.notes) {
        assert.ok(
          note.beat >= before,
          `${where}: out of order at ${note.beat}`,
        );
        before = note.beat;
        assert.ok(note.column >= 0 && note.column < 4, where);
        const key = `${note.beat}/${note.column}`;
        assert.ok(!seen.has(key), `${where}: two notes at ${key}`);
        seen.add(key);
        assert.notEqual(note.kind, "roll", where);
      }
      const holds = chart.notes.filter((note) => note.kind === "hold");
      for (const hold of holds) {
        assert.ok(hold.endBeat !== undefined, where);
        // ChartNet's freezes are half a beat or more and end on a sixteenth; the generator's a beat or more, ending
        // on a beat or an eighth (a triplet grid has no eighths: beats only).
        const chartnet = isChartNet(data);
        assert.ok(
          hold.endBeat - hold.beat >= (chartnet ? 0.5 : 1) - 1e-6,
          `${where}: a freeze of ${hold.endBeat - hold.beat} beats at ${hold.beat}`,
        );
        assert.ok(
          Number.isInteger(
            Math.round(hold.endBeat * 1e6) / (chartnet ? 2.5e5 : 5e5),
          ),
          `${where}: a freeze ends off the grid at ${hold.endBeat}`,
        );
        for (const other of chart.notes)
          assert.ok(
            other === hold ||
              other.column !== hold.column ||
              other.beat <= hold.beat ||
              other.beat > hold.endBeat,
            `${where}: a note inside the freeze at ${hold.beat}`,
          );
      }
      // Arrows down at once: the row's own plus any freeze still held. Never three (a hand).
      for (const beat of rowsOf(chart)) {
        const pressed =
          stepsOf(chart).filter((note) => note.beat === beat).length +
          holds.filter((hold) => hold.beat < beat && hold.endBeat! >= beat)
            .length;
        assert.ok(pressed <= 2, `${where}: ${pressed} arrows at beat ${beat}`);
      }
      if (chart.difficulty === "Easy" || chart.difficulty === "Medium")
        assert.equal(
          chart.notes.filter((note) => note.kind === "mine").length,
          0,
          `${where}: mines`,
        );
    }
});

test("every generated chart starts after two seconds, ends inside the song and keeps to its difficulty's density", () => {
  for (const { data, sim } of ruleSongs) {
    const timing = createTiming(sim.timing);
    const analysis = parseAnalysis(
      read(`games/fusemania/charts/analysis/${data.id}.json`),
    );
    sim.charts.forEach((chart, index) => {
      const bound = BOUNDS[index]!;
      const where = `${data.id} ${chart.difficulty}`;
      const rows = rowsOf(chart);
      const times = rows.map((beat) => timing.timeAt(beat));
      assert.ok(times[0]! >= 2, `${where}: first note at ${times[0]} s`);
      assert.ok(
        times[times.length - 1]! < analysis.duration,
        `${where}: last note after the audio ends`,
      );
      for (let i = 1; i < times.length; i++)
        assert.ok(
          times[i]! - times[i - 1]! >= bound.gap - 1e-3,
          `${where}: rows ${(times[i]! - times[i - 1]!).toFixed(3)} s apart at beat ${rows[i]}`,
        );
      const average =
        (rows.length - 1) / (times[times.length - 1]! - times[0]!);
      let peak = 0;
      for (let from = 0, to = 0; from < rows.length; from++) {
        while (to < rows.length && rows[to]! < rows[from]! + 4) to++;
        peak = Math.max(
          peak,
          (to - from) / (timing.timeAt(rows[from]! + 4) - times[from]!),
        );
      }
      assert.ok(
        average >= bound.average[0] && average <= bound.average[1],
        `${where}: ${average.toFixed(2)} rows a second on average`,
      );
      assert.ok(
        peak >= bound.peak[0] && peak <= bound.peak[1],
        `${where}: ${peak.toFixed(2)} rows a second at its busiest`,
      );
    });
  }
});

test("the generated charts keep to their conventions: few jumps on Easy, no fast jacks, even arrows", () => {
  for (const { data, sim } of ruleSongs)
    sim.charts.forEach((chart, index) => {
      const where = `${data.id} ${chart.difficulty}`;
      const steps = stepsOf(chart);
      const rows = rowsOf(chart).map((beat) =>
        steps.filter((note) => note.beat === beat).map((note) => note.column),
      );
      const beats = rowsOf(chart);
      if (chart.difficulty === "Easy")
        assert.ok(
          rows.filter((columns) => columns.length === 2).length <=
            rows.length / 8,
          `${where}: too many jumps`,
        );
      // The same arrow twice running, only as slowly as the difficulty allows.
      const jack = BOUNDS[index]!.jack;
      for (let i = 1; i < rows.length; i++)
        if (
          rows[i]!.length === 1 &&
          rows[i - 1]!.length === 1 &&
          rows[i]![0] === rows[i - 1]![0]
        )
          assert.ok(
            beats[i]! - beats[i - 1]! >= jack - 1e-6,
            `${where}: a jack ${beats[i]! - beats[i - 1]!} beats apart at ${beats[i]}`,
          );
      const uses = [0, 1, 2, 3].map(
        (column) => steps.filter((note) => note.column === column).length,
      );
      for (const count of uses)
        assert.ok(
          count >= 0.15 * steps.length && count <= 0.36 * steps.length,
          `${where}: arrows used ${uses.join("/")}`,
        );
      // Left and right balance.
      assert.ok(
        Math.abs(uses[0]! - uses[3]!) <= 0.1 * steps.length,
        `${where}: left ${uses[0]} against right ${uses[3]}`,
      );
    });
});

test("each difficulty of the generated charts stays near what published charts of that difficulty do", () => {
  // The bundled charts, measured the way `reference-patterns.json` measures published ones.
  const measured = new Map<string, Measures[]>();
  for (const { data, sim } of ruleSongs) {
    const analysis = parseAnalysis(
      read(`games/fusemania/charts/analysis/${data.id}.json`),
    );
    const slot = (beat: number): number =>
      Math.round(beat * analysis.slotsPerBeat);
    for (const chart of sim.charts) {
      const notes = chart.notes.map((note) => ({
        slot: slot(note.beat),
        column: note.column,
        kind:
          note.kind === "mine"
            ? ("mine" as const)
            : note.kind === "hold"
              ? ("hold" as const)
              : ("tap" as const),
        ...(note.endBeat === undefined ? {} : { endSlot: slot(note.endBeat) }),
      }));
      const found = measured.get(chart.difficulty) ?? [];
      found.push(
        measureChart(analysis, {
          difficulty: DIFFICULTIES.find((name) => name === chart.difficulty)!,
          meter: chart.meter,
          notes,
        }),
      );
      measured.set(chart.difficulty, found);
    }
  }
  for (const difficulty of DIFFICULTIES) {
    const reference = referenceFor(difficulty);
    const charts = measured.get(difficulty);
    if (!charts) continue;
    const ours = pool(charts);
    const within = (
      what: string,
      value: number,
      low: number,
      high: number,
    ): void => {
      assert.ok(
        value >= low && value <= high,
        `${difficulty}: ${what} ${value.toFixed(3)}, outside ${low.toFixed(3)} to ${high.toFixed(3)}`,
      );
    };
    // Notes per second: the pack's median inside the published charts' middle half, no song far outside it.
    const nps = reference.scalars.nps!;
    within("median notes per second", ours.scalars.nps![1], nps.p25, nps.p75);
    for (const chart of charts)
      within(
        "notes per second",
        chart.scalars.nps!,
        0.75 * nps.p25,
        1.25 * nps.p75,
      );
    // How much of the chart is on the beat and how much on sixteenths.
    for (const [level, slack] of [
      ["4th", 0.08],
      ["16th", 0.06],
    ] as const) {
      const target = reference.tables.quant?.[level] ?? 0;
      within(
        `share of ${level}s`,
        share(ours, "quant", level),
        target - slack,
        target + slack,
      );
    }
    const jumps = reference.scalars.jump_share!;
    within(
      "median share of jumps",
      ours.scalars.jump_share![1],
      jumps.p25,
      jumps.p75,
    );
    // The same arrow twice: as often as published charts on quarters, and all but never on sixteenths.
    const jacks = reference.tables.jack_rate?.["4th"] ?? 0;
    within(
      "jacks on quarters",
      jackRate(ours, "4th"),
      jacks - 0.1,
      jacks + 0.1,
    );
    within("jacks on sixteenths", jackRate(ours, "16th"), 0, 0.02);
  }
});

/** ChartNet's charts: busier than the generator's, up to its streams and 24th bursts. */
const CHARTNET_BOUNDS = {
  Easy: { average: [1.2, 2.4], peak: 4.5, gap: 0.3 },
  Medium: { average: [1.8, 3.4], peak: 6, gap: 0.16 },
  Hard: { average: [2.8, 5.2], peak: 10, gap: 0.09 },
  Challenge: { average: [4, 8.5], peak: 15, gap: 0.05 },
} as const;

test("ChartNet's charts end inside the song, keep a lead-in and keep to their difficulty's density", () => {
  for (const { data, sim } of songs.filter((song) => isChartNet(song.data))) {
    const timing = createTiming(sim.timing);
    const analysis = parseAnalysis(
      read(`games/fusemania/charts/analysis/${data.id}.json`),
    );
    for (const chart of sim.charts) {
      const bound =
        CHARTNET_BOUNDS[chart.difficulty as keyof typeof CHARTNET_BOUNDS];
      const where = `${data.id} ${chart.difficulty}`;
      const rows = rowsOf(chart);
      const times = rows.map((beat) => timing.timeAt(beat));
      assert.ok(times[0]! >= 1, `${where}: first note at ${times[0]} s`);
      assert.ok(
        times[times.length - 1]! < analysis.duration,
        `${where}: last note after the audio ends`,
      );
      let peak = 0;
      for (let i = 1; i < times.length; i++) {
        assert.ok(
          times[i]! - times[i - 1]! >= bound.gap - 1e-3,
          `${where}: rows ${(times[i]! - times[i - 1]!).toFixed(3)} s apart at beat ${rows[i]}`,
        );
        let from = i;
        while (from > 0 && times[i]! - times[from - 1]! <= 1) from--;
        peak = Math.max(peak, i - from + 1);
      }
      const average =
        (rows.length - 1) / (times[times.length - 1]! - times[0]!);
      assert.ok(
        average >= bound.average[0] && average <= bound.average[1],
        `${where}: ${average.toFixed(2)} rows a second on average`,
      );
      assert.ok(peak <= bound.peak, `${where}: ${peak} rows in one second`);
    }
  }
});

test("generation is deterministic: the same analysis gives the same file", () => {
  const song = SONGS.find(
    (candidate) => candidate.id === "jelly-beach-bounce",
  )!;
  const analysis = parseAnalysis(
    read(`games/fusemania/charts/analysis/${song.id}.json`),
  );
  const once = sscText(song, analysis);
  assert.equal(sscText(song, analysis), once);
  assert.equal(sscText(song, parseAnalysis(JSON.stringify(analysis))), once);
});
