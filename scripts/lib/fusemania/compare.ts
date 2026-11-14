/**
 * The generated charts measured the way `reference-patterns.json` measures published ones, and the two side by side.
 *
 * Our grids are read by what a slot is in the song (`levels`: beat, off-beat eighth, sixteenth level), so a swung
 * off-beat counts as an eighth; gaps between rows are read by their length in beats (`gapClass`).
 */
import { beatSeconds, type Analysis } from "./analysis.js";
import type { Chart, Difficulty } from "./generate.js";
import { ARROWS, gapClass, referenceFor, speedOf } from "./reference.js";

type Counts = Record<string, number>;

export interface Measures {
  /** One number per chart, under the reference's names. */
  scalars: Record<string, number>;
  /** Counts to pool over charts, under the reference's table names. */
  counts: Record<string, Counts>;
}

const MIRROR = [3, 1, 2, 0] as const;
const QUANT: Readonly<Record<string, string>> = {
  Q: "4th",
  E: "8th",
  S: "16th",
};

export function measureChart(analysis: Analysis, chart: Chart): Measures {
  const { slotsPerBeat } = analysis,
    perMeasure = 4 * slotsPerBeat;
  const counts: Record<string, Counts> = {};
  const bump = (table: string, key: string, by = 1): void => {
    const found = (counts[table] ??= {});
    found[key] = (found[key] ?? 0) + by;
  };
  const bySlot = new Map<number, number[]>();
  let mines = 0,
    holds = 0;
  for (const note of chart.notes) {
    if (note.kind === "mine") {
      mines++;
      continue;
    }
    const columns = bySlot.get(note.slot) ?? [];
    columns.push(note.column);
    bySlot.set(note.slot, columns);
    bump("column", ARROWS[note.column]!);
    if (note.kind === "hold" && note.endSlot !== undefined) {
      holds++;
      const beats = (note.endSlot - note.slot) / slotsPerBeat;
      bump(
        "hold_beats",
        beats <= 1 ? "<=1" : beats <= 2 ? "<=2" : beats <= 4 ? "<=4" : ">4",
      );
    }
  }
  const rows = [...bySlot.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([slot, columns]) => ({
      slot,
      columns: columns.sort((a, b) => a - b),
    }));
  const seconds = rows.map((row) =>
    beatSeconds(analysis, row.slot / slotsPerBeat),
  );
  const notes = rows.reduce((sum, row) => sum + row.columns.length, 0);
  const name = (columns: readonly number[]): string =>
    columns.map((column) => ARROWS[column]!).join("");

  let jumps = 0,
    peak = 0,
    longest8 = 0,
    longest16 = 0,
    streamRows = 0,
    run8 = 1,
    run16 = 1,
    lastFifth = 0;
  const span = (seconds[seconds.length - 1] ?? 0) - (seconds[0] ?? 0);
  const measures = new Map<
    number,
    { rhythm: string; exact: string; mirror: string }
  >();
  for (let at = 0, from = 0, inWindow = 0; at < rows.length; at++) {
    const row = rows[at]!,
      level = analysis.levels[row.slot % slotsPerBeat] ?? "X",
      quant = QUANT[level] ?? "other",
      jump = row.columns.length > 1;
    bump("quant", quant);
    if (jump) {
      jumps++;
      bump("jump_quant", quant);
      bump("jump_pair", name(row.columns));
      bump(
        "jump_beat",
        level === "Q" ? String((row.slot % perMeasure) / slotsPerBeat) : "off",
      );
    }
    // The most notes in any one second.
    inWindow += row.columns.length;
    while (seconds[at]! - seconds[from]! >= 1)
      inWindow -= rows[from++]!.columns.length;
    peak = Math.max(peak, inWindow);
    if (seconds[at]! - seconds[0]! >= 0.8 * span)
      lastFifth += row.columns.length;

    const measure = Math.floor(row.slot / perMeasure),
      within = row.slot % perMeasure;
    const entry = measures.get(measure) ?? {
      rhythm: "",
      exact: "",
      mirror: "",
    };
    entry.rhythm += `${within},`;
    entry.exact += `${within}${name(row.columns)},`;
    entry.mirror += `${within}${name(row.columns.map((column) => MIRROR[column]!).sort((a, b) => a - b))},`;
    measures.set(measure, entry);

    const before = rows[at - 1];
    if (!before) continue;
    const gap = (row.slot - before.slot) / slotsPerBeat,
      kind = gapClass(gap),
      speed = speedOf(gap);
    bump("gap", kind);
    run8 = kind === "8th" ? run8 + 1 : 1;
    run16 = kind === "16th" ? run16 + 1 : 1;
    longest8 = Math.max(longest8, run8);
    longest16 = Math.max(longest16, run16);
    // A stream is four sixteenths or more: the fourth row brings the first three with it.
    if (run16 === 4) streamRows += 4;
    else if (run16 > 4) streamRows++;
    if (before.columns.length > 1 && !jump)
      bump(
        "after_jump",
        before.columns.includes(row.columns[0]!) ? "in" : "out",
      );
    if (jump || before.columns.length > 1) continue;
    bump(`bigram_${speed}`, name([before.columns[0]!, row.columns[0]!]));
    const first = rows[at - 2];
    if (
      first?.columns.length === 1 &&
      speedOf((before.slot - first.slot) / slotsPerBeat) === speed
    )
      bump(
        `trigram_${speed}`,
        name([first.columns[0]!, before.columns[0]!, row.columns[0]!]),
      );
  }
  for (const back of [1, 2, 4])
    for (const [measure, entry] of measures) {
      const earlier = measures.get(measure - back);
      const table = `repeat_${back}_measures_back`;
      bump(table, "measures");
      if (earlier?.rhythm !== entry.rhythm) continue;
      bump(table, "rhythm");
      if (earlier.exact === entry.exact) bump(table, "exact");
      else if (earlier.exact === entry.mirror) bump(table, "mirror");
    }
  return {
    scalars: {
      nps: span > 0 ? notes / span : 0,
      peak,
      jump_share: jumps / Math.max(1, rows.length),
      hold_share: holds / Math.max(1, notes),
      mines,
      longest8,
      longest16,
      stream16_share: streamRows / Math.max(1, rows.length),
      last_fifth: lastFifth / Math.max(1, 0.2 * notes),
    },
    counts,
  };
}

const SCALARS = [
  "nps",
  "peak",
  "jump_share",
  "hold_share",
  "mines",
  "longest8",
  "longest16",
  "stream16_share",
];
/** The tables shown, and which of their entries. */
const TABLES: readonly (readonly [string, readonly string[]])[] = [
  ["quant", ["4th", "8th", "16th"]],
  ["gap", ["4th", "8th", "16th", "dotted8th", "half", "long"]],
  ["jump_quant", ["4th", "8th", "16th"]],
  ["jump_beat", ["0", "1", "2", "3", "off"]],
  ["jump_pair", ["LR", "DU", "LD", "UR", "DR", "LU"]],
  ["hold_beats", ["<=1", "<=2", "<=4"]],
  ["after_jump", ["in"]],
  ["column", ["L", "D", "U", "R"]],
];
const SPEEDS = ["4th", "8th", "16th"] as const;

const total = (counts: Counts | undefined): number =>
  Object.values(counts ?? {}).reduce((sum, value) => sum + value, 0);
const number = (value: number): string =>
  value >= 100
    ? value.toFixed(0)
    : value >= 10
      ? value.toFixed(1)
      : value.toFixed(2);

/** A chart's measures pooled over a difficulty's charts. */
export interface Pooled {
  /** Each scalar's lowest, median and highest chart. */
  scalars: Record<string, readonly [number, number, number]>;
  counts: Record<string, Counts>;
}

export function pool(charts: readonly Measures[]): Pooled {
  const scalars: Record<string, readonly [number, number, number]> = {};
  for (const key of Object.keys(charts[0]?.scalars ?? {})) {
    const values = charts
      .map((chart) => chart.scalars[key] ?? 0)
      .sort((a, b) => a - b);
    scalars[key] = [
      values[0] ?? 0,
      values[Math.floor(values.length / 2)] ?? 0,
      values[values.length - 1] ?? 0,
    ];
  }
  const counts: Record<string, Counts> = {};
  for (const chart of charts)
    for (const [table, entries] of Object.entries(chart.counts)) {
      const found = (counts[table] ??= {});
      for (const [key, value] of Object.entries(entries))
        found[key] = (found[key] ?? 0) + value;
    }
  return { scalars, counts };
}

/** The share of a pooled table's entries that `key` has. */
export const share = (pooled: Pooled, table: string, key: string): number =>
  (pooled.counts[table]?.[key] ?? 0) / Math.max(1, total(pooled.counts[table]));

/** How often two single steps at a speed are the same arrow. */
export function jackRate(pooled: Pooled, speed: string): number {
  const counts = pooled.counts[`bigram_${speed}`] ?? {};
  let same = 0;
  for (const [key, value] of Object.entries(counts))
    if (key[0] === key[1]) same += value;
  return same / Math.max(1, total(counts));
}

/** The share of three-step patterns at a speed that go there and back (a drill). */
const drills = (counts: Counts): number => {
  let found = 0;
  for (const [key, value] of Object.entries(counts))
    if (key[0] === key[2] && key[0] !== key[1]) found += value;
  return found / Math.max(1e-9, total(counts));
};

/** Half the summed difference between two distributions: 0 the same, 1 nothing in common. */
function distance(ours: Counts, theirs: Counts): number {
  const a = Math.max(1e-9, total(ours)),
    b = Math.max(1e-9, total(theirs));
  let sum = 0;
  for (const key of new Set([...Object.keys(ours), ...Object.keys(theirs)]))
    sum += Math.abs((ours[key] ?? 0) / a - (theirs[key] ?? 0) / b);
  return sum / 2;
}

const top = (counts: Counts, size: number): string => {
  const sum = Math.max(1e-9, total(counts));
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, size)
    .map(([key, value]) => `${key} ${((100 * value) / sum).toFixed(0)}`)
    .join(" ");
};

/** One difficulty's charts beside the reference, as lines of text. */
export function compareText(
  difficulty: Difficulty,
  charts: readonly Measures[],
): string {
  const reference = referenceFor(difficulty),
    ours = pool(charts);
  const lines = [
    `${difficulty} (${charts.length} charts) against itg:${difficulty.toLowerCase()}`,
    `  ${"".padEnd(26)}${"reference p25 p50 p75".padEnd(38)}ours low median high`,
  ];
  const line = (label: string, theirs: string, mine: string): void => {
    lines.push(`  ${label.padEnd(26)}${theirs.padEnd(38)}${mine}`);
  };
  for (const key of SCALARS) {
    const theirs = reference.scalars[key],
      mine = ours.scalars[key];
    if (!theirs || !mine) continue;
    line(
      key,
      [theirs.p25, theirs.p50, theirs.p75].map(number).join(" "),
      mine.map(number).join(" "),
    );
  }
  const curve = reference.densityCurve;
  line(
    "last_fifth",
    number(((curve[8] ?? 1) + (curve[9] ?? 1)) / 2),
    (ours.scalars.last_fifth ?? [0, 0, 0]).map(number).join(" "),
  );
  for (const [table, keys] of TABLES)
    line(
      `${table} ${keys.join("/")}`.slice(0, 25),
      keys.map((key) => number(reference.tables[table]?.[key] ?? 0)).join(" "),
      keys.map((key) => number(share(ours, table, key))).join(" "),
    );
  line(
    "jack_rate 4th/8th/16th",
    SPEEDS.map((speed) =>
      number(reference.tables.jack_rate?.[speed] ?? 0),
    ).join(" "),
    SPEEDS.map((speed) => number(jackRate(ours, speed))).join(" "),
  );
  for (const back of [1, 2, 4]) {
    const table = `repeat_${back}_measures_back`,
      measures = Math.max(1, ours.counts[table]?.measures ?? 0);
    line(
      `repeat ${back} back r/exact/mir`,
      ["rhythm", "exact", "mirror"]
        .map((key) => number(reference.tables[table]?.[key] ?? 0))
        .join(" "),
      ["rhythm", "exact", "mirror"]
        .map((key) => number((ours.counts[table]?.[key] ?? 0) / measures))
        .join(" "),
    );
  }
  for (const speed of SPEEDS) {
    const table = `trigram_${speed}`,
      theirs = reference.tables[table],
      mine = ours.counts[table];
    if (!theirs || !mine || total(mine) < 40) continue;
    line(
      `${table} drills`,
      number(drills(theirs)),
      `${number(drills(mine))}   distance ${number(distance(mine, theirs))} over ${total(mine)}`,
    );
    line(`${table} top`, top(theirs, 6), top(mine, 6));
  }
  return lines.join("\n");
}
