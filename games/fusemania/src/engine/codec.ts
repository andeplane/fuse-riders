import type { Library } from "./library.js";
import {
  AUTO,
  NO_HOLD,
  NO_JUDGMENT,
  UP,
  type Effect,
  type Player,
} from "./play.js";
import {
  CAPACITY,
  COLUMNS,
  COMBO_KEEPS,
  COUNTS,
  ITEM_KINDS,
  MAX_EFFECTS,
  MAX_SONG_MS,
  MARVELOUS,
  MINED,
  MIN_SONG_MS,
  MODES,
  NO_ITEM,
  TICK_MS,
} from "./rules.js";
import { TAP, type Steps } from "./steps.js";
import type { World } from "./world.js";

/**
 * A match as plain data for a checkpoint, and back. `decodeWorld` checks every field on its own and against the
 * chart it describes, and builds the world only when all of them hold: a refused checkpoint leaves nothing behind.
 */
export function encodeWorld(world: World): unknown[] {
  return [
    world.song,
    world.mode,
    world.seed,
    world.ms,
    world.endMs,
    world.phase === "over",
    world.players.map((player) => [
      player.id,
      player.bot,
      player.chart,
      [...player.next],
      [...player.mine],
      [...player.hold],
      [...player.let],
      [...player.down],
      player.last,
      player.score,
      player.combo,
      player.worst,
      player.best,
      [...player.counts],
      [...player.hits],
      player.judged,
      player.judgedAt,
      player.judgedOff,
      player.item,
      player.itemAt,
      player.effects.map((effect) => [...effect]),
      player.shield,
      player.blocked,
      player.used,
    ]),
  ];
}

const int = (value: unknown, min: number, max: number): value is number =>
  Number.isInteger(value) &&
  (value as number) >= min &&
  (value as number) <= max;
const time = (value: unknown): value is number =>
  int(value, MIN_SONG_MS, MAX_SONG_MS);
const list = (
  value: unknown,
  length: number,
  each: (item: unknown, index: number) => boolean,
): value is number[] =>
  Array.isArray(value) && value.length === length && value.every(each);

const PLAYER_FIELDS = 24;
function decodePlayer(
  raw: unknown,
  steps: (chart: number) => Steps | undefined,
  charts: number,
  riders: number,
): Player | undefined {
  if (!Array.isArray(raw) || raw.length !== PLAYER_FIELDS) return;
  const [
    id,
    bot,
    chart,
    next,
    mine,
    hold,
    since,
    down,
    last,
    score,
    combo,
    worst,
    best,
    counts,
    hits,
    judged,
    judgedAt,
    judgedOff,
    item,
    itemAt,
    effects,
    shield,
    blocked,
    used,
  ] = raw as unknown[];
  if (
    typeof id !== "string" ||
    id.length === 0 ||
    id.length > 64 ||
    typeof bot !== "boolean" ||
    !int(chart, 0, charts - 1)
  )
    return;
  const chartSteps = steps(chart);
  if (!chartSteps) return;
  const notes = chartSteps.notes;
  if (
    !list(next, COLUMNS, (value, column) =>
      int(value, 0, chartSteps.lanes[column]!.length),
    ) ||
    !list(mine, COLUMNS, (value, column) =>
      int(value, 0, chartSteps.mines[column]!.length),
    ) ||
    !list(hold, COLUMNS, (value, column) => {
      if (value === NO_HOLD) return true;
      if (!int(value, 0, notes.length - 1)) return false;
      const note = notes[value]!;
      // A running hold is a hold or roll of this column that the cursor has passed.
      return (
        note.column === column &&
        note.kind !== TAP &&
        chartSteps.lanes[column]!.indexOf(value) < next[column]!
      );
    }) ||
    !list(
      since,
      COLUMNS,
      (value) => value === AUTO || time(value) || value === -1,
    ) ||
    !list(down, COLUMNS, (value) => value === UP || time(value)) ||
    !time(last) ||
    !int(score, 0, chartSteps.full * 2) ||
    !int(best, 0, chartSteps.steps) ||
    !int(combo, 0, best) ||
    // A running combo has a worst judgment that keeps it; no combo has none.
    !int(worst, NO_JUDGMENT, COMBO_KEEPS) ||
    (combo === 0) !== (worst === NO_JUDGMENT) ||
    !list(counts, COUNTS, (value) => int(value, 0, notes.length)) ||
    !list(hits, Math.ceil(notes.length / 32), (value) =>
      int(value, 0, 0xffff_ffff),
    ) ||
    !int(judged, NO_JUDGMENT, MINED) ||
    !time(judgedAt) ||
    !int(judgedOff, -1000, 1000) ||
    !int(item, NO_ITEM, ITEM_KINDS - 1) ||
    !time(itemAt) ||
    !Array.isArray(effects) ||
    effects.length > MAX_EFFECTS ||
    !int(shield, 0, MAX_SONG_MS) ||
    !int(blocked, 0, MAX_SONG_MS) ||
    !int(used, 0, notes.length)
  )
    return;
  const parsed: Effect[] = [];
  for (const effect of effects as unknown[]) {
    if (!Array.isArray(effect) || effect.length !== 4) return;
    const [kind, from, until, by] = effect as unknown[];
    if (
      !int(kind, 1, ITEM_KINDS - 1) ||
      !time(from) ||
      !time(until) ||
      until < from ||
      !int(by, 0, riders - 1)
    )
      return;
    parsed.push([kind, from, until, by]);
  }
  return {
    id,
    bot,
    chart,
    next: [...next],
    mine: [...mine],
    hold: [...hold],
    let: [...since],
    down: [...down],
    last,
    score,
    combo,
    worst,
    best,
    counts: [...counts],
    hits: [...hits],
    judged,
    judgedAt,
    judgedOff,
    item,
    itemAt,
    effects: parsed,
    shield,
    blocked,
    used,
  };
}

const WORLD_FIELDS = 7;
export function decodeWorld(library: Library, raw: unknown): World | undefined {
  if (!Array.isArray(raw) || raw.length !== WORLD_FIELDS) return;
  const [song, mode, seed, ms, endMs, over, rawPlayers] = raw as unknown[];
  if (typeof song !== "string") return;
  const info = library.song(song);
  if (
    !info ||
    !int(mode, 0, MODES - 1) ||
    !int(seed, 0, 0xffff_ffff) ||
    !int(ms, MIN_SONG_MS, MAX_SONG_MS) ||
    ms % TICK_MS !== 0 ||
    endMs !== info.endMs ||
    typeof over !== "boolean" ||
    // The match is over exactly when the clock has reached the song's end.
    over !== ms >= info.endMs ||
    !Array.isArray(rawPlayers) ||
    rawPlayers.length < 1 ||
    rawPlayers.length > CAPACITY
  )
    return;
  const players: Player[] = [];
  for (const item of rawPlayers as unknown[]) {
    const player = decodePlayer(
      item,
      (chart) => library.steps(song, chart),
      info.charts.length,
      rawPlayers.length,
    );
    if (!player || players.some((other) => other.id === player.id)) return;
    players.push(player);
  }
  return {
    song,
    mode,
    seed,
    ms,
    endMs: info.endMs,
    phase: over ? "over" : "playing",
    players,
  };
}
