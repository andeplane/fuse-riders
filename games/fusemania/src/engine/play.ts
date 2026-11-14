import {
  BOO,
  BOT_SKILL,
  COLUMNS,
  COMBO_KEEPS,
  COUNTS,
  DOUBLE,
  DROPPED,
  GREAT,
  HELD,
  HOLD_GRACE_MS,
  HOLD_POINTS,
  ITEM_KINDS,
  ITEM_WEIGHTS,
  MARVELOUS,
  MAX_EFFECTS,
  MINED,
  MINES,
  MINE_PENALTY,
  MINE_SHARE,
  MINE_WINDOW,
  MIN_SONG_MS,
  MISS,
  NO_ITEM,
  POINTS,
  ROLL_GRACE_MS,
  STAR,
  WINDOWS,
  WORST_WINDOW,
  isAttack,
} from "./rules.js";
import { HOLD, ROLL, TAP, type StepNote, type Steps } from "./steps.js";

/**
 * One rider's run through a chart: where it is in each column, what it holds, its score, and the power-ups it is
 * under. Everything is decided from the song time of each press (`press`, `release`) and from how far the rider's
 * clock is known to have run (`advance`): a note nobody pressed in its window is a miss once the clock is past it.
 * The three are pure and order-insensitive in the way the fold needs: advancing to `a` and then `b` is advancing to
 * `b`, so the room (a little behind) and the rider's own screen (at the present) reach the same outcome.
 */

/** `down`: the key is up. */
export const UP = -1_000_000_000;
/** `hold`: no hold or roll is running in the column. */
export const NO_HOLD = -1;
/** `let`: the hold is being held; or, with `AUTO`, it holds itself (a bot's, a starred rider's). */
export const KEPT = -1,
  AUTO = -2;
/** `judged`: nothing judged yet. */
export const NO_JUDGMENT = -1;

/** A power-up a rider is under: notes (or the picture) from `from` until `until`, thrown by the rider in slot `by`. */
export type Effect = [kind: number, from: number, until: number, by: number];

export interface Player {
  id: string;
  bot: boolean;
  /** Which of the song's charts it plays. */
  chart: number;
  /** Per column: how many of the lane's notes are settled, hit or missed. */
  next: number[];
  /** Per column: how many of the lane's mines are behind it. */
  mine: number[];
  /** Per column: the hold or roll that is running, or `NO_HOLD`. */
  hold: number[];
  /** Per column, for the running hold: `KEPT`, `AUTO`, or when it was let go (a roll: when it was last tapped). */
  let: number[];
  /** Per column: when the key went down, or `UP`. */
  down: number[];
  /** The newest song time this rider's inputs have named: timestamps never go back. */
  last: number;
  score: number;
  combo: number;
  best: number;
  /** How many of each judgment (`MARVELOUS`…`MINED`). */
  counts: number[];
  /** A bit per note: it was hit (and is gone from the screen). */
  hits: number[];
  /** The newest judgment, when it was given and how far off the press was (negative: early). */
  judged: number;
  judgedAt: number;
  judgedOff: number;
  /** The power-up in hand and when it was picked up. */
  item: number;
  itemAt: number;
  effects: Effect[];
  /** A shield lasts until this song time; 0 when there is none. */
  shield: number;
  /** When a shield last swallowed an attack; 0 when it never did. */
  blocked: number;
  /** Power-ups used so far. */
  used: number;
}

/** What judging one rider needs beside the rider: its chart and the match's numbers. */
export interface PlayContext {
  steps: Steps;
  /** The match's seed: every "random" outcome is a hash of it and what it is about. */
  seed: number;
  slot: number;
  /** The notes that carry a power-up, in a battle. */
  items?: ReadonlySet<number>;
  /** This rider's place as the tick began (0 leads) of how many. */
  place: number;
  of: number;
}

export function createPlayer(
  id: string,
  bot: boolean,
  chart: number,
  steps: Steps,
): Player {
  const each = <T>(value: T) => Array.from({ length: COLUMNS }, () => value);
  return {
    id,
    bot,
    chart,
    next: each(0),
    mine: each(0),
    hold: each(NO_HOLD),
    let: each(KEPT),
    down: each(UP),
    last: MIN_SONG_MS,
    score: 0,
    combo: 0,
    best: 0,
    counts: Array.from({ length: COUNTS }, () => 0),
    hits: Array.from({ length: Math.ceil(steps.notes.length / 32) }, () => 0),
    judged: NO_JUDGMENT,
    judgedAt: 0,
    judgedOff: 0,
    item: NO_ITEM,
    itemAt: 0,
    effects: [],
    shield: 0,
    blocked: 0,
    used: 0,
  };
}

/** A 32-bit hash of three numbers: the engine's only source of chance, so replay and rollback reproduce it. */
export function hash(a: number, b: number, c: number): number {
  let h = (a ^ 0x9e3779b9) >>> 0;
  h = Math.imul(h ^ b, 0x85ebca6b) >>> 0;
  h = (h ^ (h >>> 13)) >>> 0;
  h = Math.imul(h ^ c, 0xc2b2ae35) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  h = Math.imul(h, 0x27d4eb2f) >>> 0;
  return (h ^ (h >>> 15)) >>> 0;
}

/** Whether an effect of `kind` covers a note at `ms`. */
export const under = (
  effects: readonly Effect[],
  kind: number,
  ms: number,
): boolean =>
  effects.some(
    (effect) => effect[0] === kind && effect[1] <= ms && ms < effect[2],
  );

/** Whether a mine attack has turned this tap into a mine. Holds, rolls and item notes are never turned. */
export function turnedMine(
  effects: readonly Effect[],
  seed: number,
  id: number,
  note: StepNote,
  items?: ReadonlySet<number>,
): boolean {
  return (
    note.kind === TAP &&
    !items?.has(id) &&
    under(effects, MINES, note.ms) &&
    hash(seed, id, 0x4d1e) % 100 < MINE_SHARE
  );
}

export const wasHit = (hits: readonly number[], id: number): boolean =>
  ((hits[id >>> 5] ?? 0) & (1 << (id & 31))) !== 0;
const setHit = (player: Player, id: number, hit: boolean) => {
  const word = id >>> 5,
    bit = 1 << (id & 31);
  player.hits[word] =
    (hit ? player.hits[word]! | bit : player.hits[word]! & ~bit) >>> 0;
};

/** Adds an effect; one of the same kind it touches or overlaps is stretched instead. */
export function addEffect(
  player: Player,
  kind: number,
  from: number,
  until: number,
  by: number,
): void {
  for (const effect of player.effects)
    if (effect[0] === kind && effect[1] <= until && from <= effect[2]) {
      effect[1] = Math.min(effect[1], from);
      effect[2] = Math.max(effect[2], until);
      effect[3] = by;
      return;
    }
  if (player.effects.length < MAX_EFFECTS)
    player.effects.push([kind, from, until, by]);
}

/** The item a note gives: likelier strong the further behind the rider is; a rider alone gets only its own kind. */
function rollItem(ctx: PlayContext, id: number): number {
  const lead = ITEM_WEIGHTS[0]!,
    last = ITEM_WEIGHTS[1]!;
  const behind = ctx.of > 1 ? ctx.place : 1,
    ahead = ctx.of > 1 ? ctx.of - 1 - ctx.place : 1;
  const weights: number[] = [];
  let total = 0;
  for (let kind = 0; kind < ITEM_KINDS; kind++) {
    const weight =
      ctx.of <= 1 && isAttack(kind)
        ? 0
        : lead[kind]! * ahead + last[kind]! * behind;
    weights.push(weight);
    total += weight;
  }
  let pick = hash(ctx.seed, id, 0x17e0 + ctx.slot) % total;
  for (let kind = 0; kind < ITEM_KINDS; kind++) {
    if (pick < weights[kind]!) return kind;
    pick -= weights[kind]!;
  }
  return NO_ITEM;
}

function blow(player: Player, at: number): void {
  player.counts[MINED]!++;
  player.score = Math.max(0, player.score - MINE_PENALTY);
  player.combo = 0;
  player.judged = MINED;
  player.judgedAt = at;
  player.judgedOff = 0;
}

/** Settles the column's running hold when its fate is known by `time` (always, when `force`). */
function settleHold(
  steps: Steps,
  player: Player,
  column: number,
  time: number,
  force = false,
): void {
  const id = player.hold[column]!;
  if (id < 0) return;
  const note = steps.notes[id]!,
    since = player.let[column]!;
  let kept: boolean | undefined;
  if (since < 0) {
    if (time >= note.endMs || force) kept = true;
  } else {
    const deadline =
      since + (note.kind === ROLL ? ROLL_GRACE_MS : HOLD_GRACE_MS);
    if (deadline >= note.endMs) kept = true;
    else if (time > deadline || force) kept = false;
  }
  if (kept === undefined) return;
  player.hold[column] = NO_HOLD;
  player.let[column] = KEPT;
  if (kept) {
    player.counts[HELD]!++;
    player.score +=
      HOLD_POINTS * (under(player.effects, DOUBLE, note.ms) ? 2 : 1);
  } else {
    player.counts[DROPPED]!++;
    // A dropped hold is drawn like a missed one: it scrolls on, dimmed.
    setHit(player, id, false);
  }
}

function award(
  ctx: PlayContext,
  player: Player,
  id: number,
  note: StepNote,
  judgment: number,
  off: number,
  at: number,
  auto: boolean,
): void {
  const column = note.column;
  player.next[column]!++;
  player.counts[judgment]!++;
  if (judgment <= COMBO_KEEPS) {
    player.combo++;
    if (player.combo > player.best) player.best = player.combo;
  } else player.combo = 0;
  player.score +=
    POINTS[judgment]! * (under(player.effects, DOUBLE, note.ms) ? 2 : 1);
  setHit(player, id, true);
  player.judged = judgment;
  player.judgedAt = at;
  player.judgedOff = off;
  if (note.kind !== TAP) {
    settleHold(ctx.steps, player, column, at, true);
    player.hold[column] = id;
    player.let[column] = auto ? AUTO : note.kind === ROLL ? at : KEPT;
  }
  if (ctx.items?.has(id) && judgment <= GREAT && player.item === NO_ITEM) {
    player.item = rollItem(ctx, id);
    player.itemAt = at;
  }
}

function miss(player: Player, note: StepNote): void {
  player.next[note.column]!++;
  player.counts[MISS]!++;
  if (note.kind !== TAP) player.counts[DROPPED]!++;
  player.combo = 0;
  player.judged = MISS;
  player.judgedAt = note.ms + WORST_WINDOW;
  player.judgedOff = 0;
}

/** A bot's judgment of a note, and how far off it "pressed". */
function botPlay(
  ctx: PlayContext,
  id: number,
): [judgment: number, off: number] {
  const roll = hash(ctx.seed, id, 0xb070 + ctx.slot);
  let pick = roll % 1000;
  for (let judgment = MARVELOUS; judgment <= BOO; judgment++) {
    if (pick < BOT_SKILL[judgment]!) {
      const inner = judgment === MARVELOUS ? 0 : WINDOWS[judgment - 1]!,
        span = WINDOWS[judgment]! - inner;
      const off = inner + ((roll >>> 10) % (span + 1));
      return [judgment, (roll >>> 20) & 1 ? off : -off];
    }
    pick -= BOT_SKILL[judgment]!;
  }
  return [MISS, 0];
}

/**
 * The rider's clock has reached `time`: every note whose last window is behind it is a miss, a hold let go too long
 * is dropped and one kept to its tail is banked, mines it held a key through go off, and a bot or a starred rider
 * hits the notes that have come due.
 */
export function advance(ctx: PlayContext, player: Player, time: number): void {
  const { steps } = ctx;
  for (let column = 0; column < COLUMNS; column++) {
    settleHold(steps, player, column, time);
    const lane = steps.lanes[column]!;
    for (;;) {
      const id = lane[player.next[column]!];
      if (id === undefined) break;
      const note = steps.notes[id]!;
      const starred = under(player.effects, STAR, note.ms);
      const turned =
        !starred && turnedMine(player.effects, ctx.seed, id, note, ctx.items);
      if (note.ms <= time && starred) {
        award(ctx, player, id, note, MARVELOUS, 0, note.ms, true);
        continue;
      }
      if (note.ms <= time && player.bot) {
        if (turned) {
          // A bot walks into about a quarter of the mines thrown at it.
          player.next[column]!++;
          if (hash(ctx.seed, id, 0xb0b0 + ctx.slot) % 100 < 25) {
            blow(player, note.ms);
            setHit(player, id, true);
          }
          continue;
        }
        const [judgment, off] = botPlay(ctx, id);
        if (judgment === MISS) miss(player, note);
        else award(ctx, player, id, note, judgment, off, note.ms + off, true);
        continue;
      }
      if (turned) {
        if (note.ms + MINE_WINDOW >= time) break;
        // Left alone: no judgment and nothing lost but the points it would have been.
        player.next[column]!++;
        continue;
      }
      if (note.ms + WORST_WINDOW >= time) break;
      miss(player, note);
    }
    settleHold(steps, player, column, time);
    const mines = steps.mines[column]!;
    for (;;) {
      const id = mines[player.mine[column]!];
      if (id === undefined) break;
      const note = steps.notes[id]!;
      if (note.ms > time) break;
      const down = player.down[column]!;
      if (
        !player.bot &&
        down !== UP &&
        down <= note.ms &&
        !under(player.effects, STAR, note.ms)
      ) {
        blow(player, note.ms);
        setHit(player, id, true);
        player.mine[column]!++;
        continue;
      }
      if (note.ms + MINE_WINDOW >= time) break;
      player.mine[column]!++;
    }
  }
}

/** The key of `column` went down at song time `at`. */
export function press(
  ctx: PlayContext,
  player: Player,
  column: number,
  at: number,
): void {
  advance(ctx, player, at);
  const { steps } = ctx;
  player.down[column] = at;
  const running = player.hold[column]!;
  if (running >= 0 && player.let[column]! >= 0)
    player.let[column] = steps.notes[running]!.kind === ROLL ? at : KEPT;
  const mineId = steps.mines[column]![player.mine[column]!];
  if (mineId !== undefined) {
    const mine = steps.notes[mineId]!;
    if (mine.ms - at <= MINE_WINDOW && !under(player.effects, STAR, mine.ms)) {
      blow(player, at);
      setHit(player, mineId, true);
      player.mine[column]!++;
    }
  }
  const id = steps.lanes[column]![player.next[column]!];
  if (id === undefined) return;
  const note = steps.notes[id]!;
  if (note.ms - at > WORST_WINDOW) return;
  const off = at - note.ms;
  if (under(player.effects, STAR, note.ms)) {
    award(ctx, player, id, note, MARVELOUS, off, at, true);
    return;
  }
  if (turnedMine(player.effects, ctx.seed, id, note, ctx.items)) {
    if (Math.abs(off) > MINE_WINDOW) return;
    player.next[column]!++;
    blow(player, at);
    setHit(player, id, true);
    return;
  }
  const judgment = WINDOWS.findIndex((window) => Math.abs(off) <= window);
  // `advance` has already missed every note further behind than the last window.
  if (judgment < 0) return;
  award(ctx, player, id, note, judgment, off, at, false);
}

/** The key of `column` came up at song time `at`. */
export function release(
  ctx: PlayContext,
  player: Player,
  column: number,
  at: number,
): void {
  advance(ctx, player, at);
  player.down[column] = UP;
  const running = player.hold[column]!;
  if (
    running >= 0 &&
    ctx.steps.notes[running]!.kind === HOLD &&
    player.let[column] === KEPT
  )
    player.let[column] = at;
}

/** The end of the song: everything still open is settled. */
export function finish(ctx: PlayContext, player: Player, time: number): void {
  advance(ctx, player, time);
  for (let column = 0; column < COLUMNS; column++)
    settleHold(ctx.steps, player, column, time, true);
}
