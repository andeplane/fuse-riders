import type { PlayerView, WorldView } from "../engine/view.js";
import {
  BOO,
  COLUMNS,
  ITEM_KINDS,
  MARVELOUS,
  MINED,
  MISS,
  TAP,
  isAttack,
  wasHit,
  type Steps,
} from "../engine/view-kit.js";
import { firstEndingAt } from "./chart.js";

/**
 * What the picture remembers between frames: the moments things happened, so a burst, a popping word or a sliding
 * leaderboard box can play out. Every moment is found by comparing the view with the one drawn before and is stamped
 * with the song time it was first seen at; the drawing then depends only on how long ago that was. Each one is
 * guarded by the newest thing already shown (the furthest a lane's cursor has been, the newest effect announced), so
 * drawing the same view again, or a rollback that arrives at the same outcome, shows nothing twice. The first view of
 * a match starts no animation.
 */

/** A moment that has not happened: far enough back that nothing is still playing, and still a finite number. */
export const NEVER = -1e12;
/** `hitKind` when what struck was a mine, and when it was an attack the shield swallowed. */
export const HIT_MINE = -1,
  HIT_BLOCKED = -2;
/** `banner`: nothing, "YOU LEAD!", "OVERTAKEN". */
export const NO_BANNER = 0,
  LEAD_BANNER = 1,
  OVERTAKEN_BANNER = 2;

/** How long a leaderboard box takes to slide to its new row. */
export const SLIDE_MS = 350;
/** At least this long between two lead banners. */
export const BANNER_GAP_MS = 2000;
/** No lead banners until somebody has this much rating: at the first notes the lead changes with every arrow. */
const BANNER_MIN_RATING = 20_000;
/** How quickly a shown score closes on the real one: the time to cover about two thirds of the gap. */
const SCORE_ROLL_MS = 110;

export interface RiderFeedback {
  seen: boolean;
  /** Per column: the furthest the lane's cursor has been, and the newest burst on its target. */
  next: number[];
  burstAt: number[];
  burstJudgment: number[];
  /** Per column: the hold running in the view before, and when one was last kept to its end. */
  hold: number[];
  heldAt: number[];
  /** The newest judgment seen, and the word popping for it. */
  judged: number;
  judgedAt: number;
  popAt: number;
  popJudgment: number;
  popOff: number;
  /** The newest tap judgment (Marvelous to Boo): a burst's colour when the newest judgment is a hold's. */
  tap: number;
  combo: number;
  comboAt: number;
  /** When the combo last passed a hundred. */
  comboFlashAt: number;
  /** The combo that was just lost, and when. */
  brokenCombo: number;
  brokenAt: number;
  misses: number;
  missAt: number;
  mined: number;
  mineAt: number;
  /** The column the mine went off in, or −1 when it cannot be told. */
  mineColumn: number;
  blocked: number;
  blockedAt: number;
  /** Per item kind: the newest attack announced (its `from`) and the newest that has taken hold. */
  zapped: number[];
  took: number[];
  /** The newest attack thrown at this rider: when it was seen, by whom, which. */
  zapAt: number;
  zapBy: number;
  zapKind: number;
  /** The newest thing to strike this rider: an attack taking hold (its kind), `HIT_MINE` or `HIT_BLOCKED`. */
  hitAt: number;
  hitKind: number;
  /** The leaderboard: the place last seen and the slide to its row. */
  place: number;
  rowFrom: number;
  rowTo: number;
  rowAt: number;
  roseAt: number;
  passedAt: number;
  /** The score as shown: it rolls up to the rating. */
  score: number;
}

function createRider(): RiderFeedback {
  const each = (value: number) => Array.from({ length: COLUMNS }, () => value);
  const kinds = (value: number) =>
    Array.from({ length: ITEM_KINDS }, () => value);
  return {
    seen: false,
    next: each(0),
    burstAt: each(NEVER),
    burstJudgment: each(MARVELOUS),
    hold: each(-1),
    heldAt: each(NEVER),
    judged: -1,
    judgedAt: NEVER,
    popAt: NEVER,
    popJudgment: -1,
    popOff: 0,
    tap: MARVELOUS,
    combo: 0,
    comboAt: NEVER,
    comboFlashAt: NEVER,
    brokenCombo: 0,
    brokenAt: NEVER,
    misses: 0,
    missAt: NEVER,
    mined: 0,
    mineAt: NEVER,
    mineColumn: -1,
    blocked: 0,
    blockedAt: NEVER,
    zapped: kinds(NEVER),
    took: kinds(NEVER),
    zapAt: NEVER,
    zapBy: -1,
    zapKind: 0,
    hitAt: NEVER,
    hitKind: 0,
    place: 1,
    rowFrom: 0,
    rowTo: 0,
    rowAt: NEVER,
    roseAt: NEVER,
    passedAt: NEVER,
    score: 0,
  };
}

/** The row a rider's leaderboard box is at (0 on top), part way through a slide. */
export function rowOf(rider: RiderFeedback, songMs: number): number {
  const t = (songMs - rider.rowAt) / SLIDE_MS;
  if (!(t >= 0 && t < 1)) return rider.rowTo;
  const left = 1 - t;
  return (
    rider.rowFrom + (rider.rowTo - rider.rowFrom) * (1 - left * left * left)
  );
}

/** The column a mine just went off in: the one with a hit mine, or a hit tap, at the moment of the judgment. */
function minedColumn(player: PlayerView, steps: Steps | undefined): number {
  if (!steps) return -1;
  const at = player.judgedAt;
  for (let column = 0; column < COLUMNS; column++) {
    const mines = steps.mines[column];
    if (!mines) continue;
    for (
      let i = firstEndingAt(steps.notes, mines, at - 200);
      i < mines.length;
      i++
    ) {
      const id = mines[i]!;
      if (steps.notes[id]!.ms > at + 200) break;
      if (wasHit(player.hits, id)) return column;
    }
  }
  // A tap a mine attack turned: the lane's newest settled note, hit at that moment.
  for (let column = 0; column < COLUMNS; column++) {
    const id = steps.lanes[column]?.[(player.next[column] ?? 0) - 1];
    if (id === undefined) continue;
    const note = steps.notes[id]!;
    if (
      note.kind === TAP &&
      Math.abs(note.ms - at) <= 200 &&
      wasHit(player.hits, id)
    )
      return column;
  }
  return -1;
}

/** Takes a rider's state as it is, starting nothing: the first view of a match. */
function adopt(rider: RiderFeedback, player: PlayerView, songMs: number): void {
  rider.seen = true;
  for (let column = 0; column < COLUMNS; column++) {
    rider.next[column] = player.next[column] ?? 0;
    rider.hold[column] = player.hold[column] ?? -1;
  }
  rider.judged = player.judged;
  rider.judgedAt = player.judgedAt;
  // The word for a judgment already given is shown from when it was given.
  const named = player.judged >= MARVELOUS && player.judged <= MINED;
  rider.popAt = named ? player.judgedAt : NEVER;
  rider.popJudgment = named ? player.judged : -1;
  rider.popOff = player.judgedOff;
  if (player.judged >= MARVELOUS && player.judged <= BOO)
    rider.tap = player.judged;
  rider.combo = player.combo;
  rider.misses = player.counts[MISS] ?? 0;
  rider.mined = player.counts[MINED] ?? 0;
  rider.blocked = player.blocked;
  rider.blockedAt = player.blocked > 0 ? player.blocked : NEVER;
  for (const effect of player.effects) {
    const kind = effect[0];
    if (kind < 0 || kind >= ITEM_KINDS) continue;
    if (effect[1] > rider.zapped[kind]!) rider.zapped[kind] = effect[1];
    if (songMs >= effect[1] && effect[1] > rider.took[kind]!)
      rider.took[kind] = effect[1];
  }
  rider.place = player.place;
  rider.rowFrom = rider.rowTo = player.place - 1;
  rider.score = player.rating;
}

export interface Feedback {
  /** By rider slot. */
  readonly riders: readonly RiderFeedback[];
  /** The lead banner showing on the local rider's field, and since when. */
  readonly banner: number;
  readonly bannerAt: number;
  /** Compares `view` with the one before; call once per frame, before drawing. */
  observe(
    view: WorldView,
    steps: readonly Steps[],
    songMs: number,
    local: number,
  ): void;
}

export function createFeedback(): Feedback {
  let riders: RiderFeedback[] = [];
  let seed = -1,
    song = "",
    lastMs = NEVER,
    banner = NO_BANNER,
    bannerAt = NEVER;

  function update(
    rider: RiderFeedback,
    player: PlayerView,
    steps: Steps | undefined,
    songMs: number,
    roll: number,
  ): void {
    // Lanes: a cursor that moved on over a note that was hit is a burst on that column's target.
    const mine = (player.counts[MINED] ?? 0) > rider.mined;
    if (player.judged >= MARVELOUS && player.judged <= BOO)
      rider.tap = player.judged;
    for (let column = 0; column < COLUMNS; column++) {
      const next = player.next[column] ?? 0,
        before = rider.next[column]!;
      if (next > before) {
        rider.next[column] = next;
        const lane = steps?.lanes[column];
        let hit = false;
        if (lane)
          for (let i = before; i < next && !hit; i++) {
            const id = lane[i];
            hit = id !== undefined && wasHit(player.hits, id);
          }
        // With a mine going off this frame, the hit tap is the mine.
        if (hit && !(mine && player.judged === MINED)) {
          rider.burstAt[column] = songMs;
          rider.burstJudgment[column] = rider.tap;
        }
      }
      const hold = player.hold[column] ?? -1,
        was = rider.hold[column]!;
      if (hold !== was) {
        if (was >= 0 && wasHit(player.hits, was)) rider.heldAt[column] = songMs;
        rider.hold[column] = hold;
      }
    }

    // The judgment word. A judgment further back than the one shown is a rollback's, not news.
    if (
      player.judged >= MARVELOUS &&
      player.judged <= MINED &&
      (player.judged !== rider.judged || player.judgedAt !== rider.judgedAt) &&
      player.judgedAt >= rider.judgedAt - 250
    ) {
      rider.popAt = songMs;
      rider.popJudgment = player.judged;
      rider.popOff = player.judgedOff;
    }
    rider.judged = player.judged;
    rider.judgedAt = player.judgedAt;

    if (player.combo !== rider.combo) {
      if (player.combo > rider.combo) {
        rider.comboAt = songMs;
        if (Math.floor(player.combo / 100) > Math.floor(rider.combo / 100))
          rider.comboFlashAt = songMs;
      } else if (rider.combo >= 4) {
        rider.brokenCombo = rider.combo;
        rider.brokenAt = songMs;
      }
      rider.combo = player.combo;
    }

    const misses = player.counts[MISS] ?? 0;
    if (misses > rider.misses) {
      rider.misses = misses;
      rider.missAt = songMs;
    }
    if (mine) {
      rider.mined = player.counts[MINED] ?? 0;
      rider.mineAt = songMs;
      rider.mineColumn = minedColumn(player, steps);
      rider.hitAt = songMs;
      rider.hitKind = HIT_MINE;
    }
    if (player.blocked !== rider.blocked) {
      if (player.blocked > rider.blocked) {
        rider.blockedAt = songMs;
        rider.hitAt = songMs;
        rider.hitKind = HIT_BLOCKED;
      }
      rider.blocked = player.blocked;
    }

    // Attacks: thrown (seen before it takes hold), then taking hold.
    for (let i = 0; i < player.effects.length; i++) {
      const effect = player.effects[i]!,
        kind = effect[0],
        from = effect[1];
      if (kind < 0 || kind >= ITEM_KINDS || !isAttack(kind)) continue;
      if (from > rider.zapped[kind]!) {
        rider.zapped[kind] = from;
        if (songMs < from + 300) {
          rider.zapAt = songMs;
          rider.zapBy = effect[3];
          rider.zapKind = kind;
        }
      }
      if (songMs >= from && from > rider.took[kind]!) {
        rider.took[kind] = from;
        if (songMs - from < 1500) {
          rider.hitAt = songMs;
          rider.hitKind = kind;
        }
      }
    }

    // The leaderboard: a new place starts a slide from wherever the box is.
    if (player.place !== rider.place) {
      rider.rowFrom = rowOf(rider, songMs);
      rider.rowTo = player.place - 1;
      rider.rowAt = songMs;
      if (player.place < rider.place) rider.roseAt = songMs;
      else rider.passedAt = songMs;
      rider.place = player.place;
    }
    const gap = player.rating - rider.score;
    rider.score = Math.abs(gap) < 2 ? player.rating : rider.score + gap * roll;
  }

  return {
    get riders() {
      return riders;
    },
    get banner() {
      return banner;
    },
    get bannerAt() {
      return bannerAt;
    },
    observe(view, steps, songMs, local) {
      // Another match, or the song wound back: start over.
      if (
        view.seed !== seed ||
        view.song !== song ||
        view.players.length !== riders.length ||
        songMs < lastMs - 2000
      ) {
        seed = view.seed;
        song = view.song;
        riders = view.players.map(createRider);
        banner = NO_BANNER;
        bannerAt = NEVER;
        lastMs = NEVER;
      }
      const passed = Math.max(0, Math.min(250, songMs - lastMs));
      const roll = 1 - Math.exp(-passed / SCORE_ROLL_MS);
      const led = riders[local]?.seen ? riders[local]!.place === 1 : undefined;
      let best = 0;
      for (let slot = 0; slot < view.players.length; slot++) {
        const player = view.players[slot]!,
          rider = riders[slot]!;
        if (player.rating > best) best = player.rating;
        if (!rider.seen) adopt(rider, player, songMs);
        else update(rider, player, steps[slot], songMs, roll);
      }
      const own = view.players[local];
      if (
        own &&
        led !== undefined &&
        view.players.length > 1 &&
        led !== (own.place === 1) &&
        best >= BANNER_MIN_RATING &&
        !(songMs >= bannerAt && songMs < bannerAt + BANNER_GAP_MS)
      ) {
        banner = led ? OVERTAKEN_BANNER : LEAD_BANNER;
        bannerAt = songMs;
      }
      lastMs = songMs;
    },
  };
}
