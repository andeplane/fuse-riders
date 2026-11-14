import type { Library } from "./library.js";
import {
  addEffect,
  advance,
  createPlayer,
  finish,
  press,
  release,
  type Player,
  type PlayContext,
} from "./play.js";
import {
  ATTACK_LEAD_MS,
  BATTLE_MODE,
  BOT_ITEM_DELAY_MS,
  CAPACITY,
  COLUMNS,
  EARLY_MS,
  FULL_RATING,
  ITEM_EVERY_MS,
  ITEM_FIRST_MS,
  ITEM_MS,
  LATE_MS,
  NO_ITEM,
  SHIELD,
  TICK_MS,
  isAttack,
} from "./rules.js";
import { MINE, type Steps } from "./steps.js";

/**
 * One match: a song, a mode, and every rider's run through its chart. `stepWorld` folds one log tick: it moves the
 * song clock by `TICK_MS`, applies the tick's inputs at the song times they name, and settles what the clock has
 * passed. The clock starts before zero (the lead-in) and the match is over at the song's `endMs`.
 */
export type Phase = "playing" | "over";
export interface World {
  song: string;
  mode: number;
  /** From the match id: the seed of every chance outcome. */
  seed: number;
  /** Song time as of the newest folded tick. */
  ms: number;
  endMs: number;
  phase: Phase;
  players: Player[];
}
export interface Entrant {
  id: string;
  bot: boolean;
  chart: number;
}

/** Input codes: a column's key going down (0–3) or up (4–7), and the power-up button. */
export const RELEASE = COLUMNS,
  USE = COLUMNS * 2;
export const isCode = (value: unknown): value is number =>
  Number.isInteger(value) && (value as number) >= 0 && (value as number) <= USE;
export interface Input {
  slot: number;
  code: number;
  /** The song time the device heard when the key moved. */
  ms: number;
}

export function createWorld(
  library: Library,
  song: string,
  mode: number,
  seed: number,
  entrants: readonly Entrant[],
  leadIn: number,
): World | undefined {
  const info = library.song(song);
  if (!info || entrants.length < 1 || entrants.length > CAPACITY) return;
  const players: Player[] = [];
  for (const entrant of entrants) {
    const chart = Math.min(entrant.chart, info.charts.length - 1);
    const steps = library.steps(song, chart);
    if (!steps) return;
    players.push(createPlayer(entrant.id, entrant.bot, chart, steps));
  }
  return {
    song,
    mode,
    seed: seed >>> 0,
    ms: -leadIn,
    endMs: info.endMs,
    phase: "playing",
    players,
  };
}

const itemCache = new WeakMap<Steps, ReadonlySet<number>>();
/** The notes of a chart that carry a power-up in a battle: the first note at or after each item time. */
export function itemNotes(steps: Steps): ReadonlySet<number> {
  let set = itemCache.get(steps);
  if (!set) {
    const made = new Set<number>();
    let due = steps.firstMs + ITEM_FIRST_MS;
    for (const [id, note] of steps.notes.entries()) {
      if (note.kind === MINE || note.ms < due) continue;
      made.add(id);
      while (due <= note.ms) due += ITEM_EVERY_MS;
    }
    itemCache.set(steps, (set = made));
  }
  return set;
}

/** A score out of `FULL_RATING` for the chart it was earned on, so riders on different charts compare. */
export const rating = (steps: Steps, score: number): number =>
  Math.floor((score * FULL_RATING) / steps.full);

const stepsOf = (library: Library, world: World, player: Player): Steps =>
  // A world is only ever built or decoded against charts its library has.
  library.steps(world.song, player.chart)!;

/** Rider slots from the leader down: by rating, then by seat. */
export function ranking(library: Library, world: World): number[] {
  const ratings = world.players.map((player) =>
    rating(stepsOf(library, world, player), player.score),
  );
  return world.players
    .map((_, slot) => slot)
    .sort((a, b) => ratings[b]! - ratings[a]! || a - b);
}

function contexts(library: Library, world: World): PlayContext[] {
  const order = ranking(library, world);
  return world.players.map((player, slot) => {
    const steps = stepsOf(library, world, player);
    return {
      steps,
      seed: world.seed,
      slot,
      ...(world.mode === BATTLE_MODE ? { items: itemNotes(steps) } : {}),
      place: order.indexOf(slot),
      of: world.players.length,
    };
  });
}

/** The rider in `slot` uses what it holds, at the room's song time `now`. */
function useItem(world: World, slot: number, now: number): void {
  const player = world.players[slot]!,
    item = player.item;
  if (item === NO_ITEM) return;
  player.item = NO_ITEM;
  player.used++;
  if (!isAttack(item)) {
    if (item === SHIELD) player.shield = now + ITEM_MS[SHIELD]!;
    else addEffect(player, item, now, now + ITEM_MS[item]!, slot);
    return;
  }
  for (const [other, target] of world.players.entries()) {
    if (other === slot) continue;
    if (target.shield > now) {
      target.shield = 0;
      target.blocked = now;
      continue;
    }
    const from = now + ATTACK_LEAD_MS;
    addEffect(target, item, from, from + ITEM_MS[item]!, slot);
  }
}

/**
 * One input, logged for the tick whose song time is `now`. Its own timestamp is kept within the tick's bounds and
 * never before the rider's last one.
 */
function applyInput(
  ctxs: readonly PlayContext[],
  world: World,
  input: Input,
  now: number,
): void {
  const player = world.players[input.slot],
    ctx = ctxs[input.slot];
  if (!player || !ctx || player.bot) return;
  const at = Math.max(
    player.last,
    Math.min(now + EARLY_MS, Math.max(now - TICK_MS - LATE_MS, input.ms)),
  );
  player.last = at;
  if (input.code < RELEASE) press(ctx, player, input.code, at);
  else if (input.code < USE) release(ctx, player, input.code - RELEASE, at);
  else {
    advance(ctx, player, at);
    useItem(world, input.slot, now);
  }
}

/** How long a spent effect is kept: the notes it covered are all settled well before. */
const EFFECT_KEEP_MS = 6000;

/** Folds one log tick. `inputs` are the tick's, each rider's in the order it logged them. */
export function stepWorld(
  library: Library,
  world: World,
  inputs: readonly Input[],
): void {
  if (world.phase === "over") return;
  world.ms += TICK_MS;
  const now = world.ms;
  const ctxs = contexts(library, world);
  for (const input of inputs) applyInput(ctxs, world, input, now);
  for (const [slot, player] of world.players.entries()) {
    // A bot plays on the room's clock; a rider's own clock may be `LATE_MS` behind what its device has yet to log.
    advance(ctxs[slot]!, player, player.bot ? now : now - LATE_MS);
    if (
      player.bot &&
      player.item !== NO_ITEM &&
      now >= player.itemAt + BOT_ITEM_DELAY_MS
    )
      useItem(world, slot, now);
  }
  for (const player of world.players)
    if (player.effects.some((effect) => effect[2] + EFFECT_KEEP_MS < now))
      player.effects = player.effects.filter(
        (effect) => effect[2] + EFFECT_KEEP_MS >= now,
      );
  if (now >= world.endMs) {
    for (const [slot, player] of world.players.entries())
      finish(ctxs[slot]!, player, now + LATE_MS);
    world.phase = "over";
  }
}

export function cloneWorld(world: World): World {
  return {
    ...world,
    players: world.players.map((player) => ({
      ...player,
      next: [...player.next],
      mine: [...player.mine],
      hold: [...player.hold],
      let: [...player.let],
      down: [...player.down],
      counts: [...player.counts],
      hits: [...player.hits],
      effects: player.effects.map((effect) => [...effect]),
    })),
  };
}

/** An input a device has logged that the room has not folded yet, with the song time of the tick it is logged for. */
export interface Pending {
  code: number;
  ms: number;
  /** The song time of its log tick. */
  at: number;
}

/**
 * The world as the rider in `slot` will see it folded: a copy with its own unfolded inputs applied and its own clock
 * run to `now`, the song time it hears. The rider's screen draws this, so a press shows the moment it is made and
 * the room's later fold changes nothing it showed.
 */
export function forecast(
  library: Library,
  world: World,
  slot: number,
  pending: readonly Pending[],
  now: number,
): World {
  const copy = cloneWorld(world);
  const player = copy.players[slot];
  if (copy.phase === "over" || !player || player.bot) return copy;
  const ctxs = contexts(library, copy);
  for (const input of pending)
    applyInput(ctxs, copy, { slot, code: input.code, ms: input.ms }, input.at);
  advance(ctxs[slot]!, player, Math.max(player.last, now));
  return copy;
}
