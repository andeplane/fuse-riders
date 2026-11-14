import type { Library } from "./library.js";
import { UP, type Effect } from "./play.js";
import { ranking, rating, type Phase, type World } from "./world.js";

/**
 * What the presentation sees of a match. Times are milliseconds of song time. A rider's notes are not listed here:
 * the chart is static (`view-kit.ts` hands the renderer its `Steps`), and the view says how far the rider is through
 * it: the cursors, the bit set of notes hit and the hold that is running in each column.
 */
export interface PlayerView {
  id: string;
  slot: number;
  bot: boolean;
  /** Which of the song's charts it plays. */
  chart: number;
  score: number;
  /** The score out of 1,000,000 for its chart; a doubled stretch can take it past that. */
  rating: number;
  /** 1 for the leader. */
  place: number;
  combo: number;
  /** The worst judgment in the running combo (Marvelous, Perfect or Great), or −1 when there is no combo. */
  worst: number;
  best: number;
  /** How many of each judgment, by the judgment's number. */
  counts: readonly number[];
  /** Per column: how many of the lane's notes are settled. */
  next: readonly number[];
  /** Per column: the hold or roll that is running, or −1. */
  hold: readonly number[];
  /** Per column, for the running hold: −1 held, −2 holding itself, otherwise when it was let go or last tapped. */
  let: readonly number[];
  /** Per column: whether the key is down. */
  down: readonly boolean[];
  /** A bit per note: it was hit. */
  hits: readonly number[];
  /** The newest judgment (−1 before the first), when it was given and how far off the press was. */
  judged: number;
  judgedAt: number;
  judgedOff: number;
  /** The power-up in hand (0: none) and when it was picked up. */
  item: number;
  itemAt: number;
  effects: readonly Effect[];
  /** A shield lasts until this song time; 0 when there is none. */
  shield: number;
  /** When a shield last swallowed an attack; 0 when it never did. */
  blocked: number;
}
export interface WorldView {
  song: string;
  mode: number;
  seed: number;
  /** Song time as of the newest folded tick; negative during the lead-in. */
  ms: number;
  endMs: number;
  phase: Phase;
  players: PlayerView[];
}

export function toView(library: Library, world: World): WorldView {
  const order = ranking(library, world);
  return {
    song: world.song,
    mode: world.mode,
    seed: world.seed,
    ms: world.ms,
    endMs: world.endMs,
    phase: world.phase,
    players: world.players.map((player, slot) => ({
      id: player.id,
      slot,
      bot: player.bot,
      chart: player.chart,
      score: player.score,
      rating: rating(library.steps(world.song, player.chart)!, player.score),
      place: order.indexOf(slot) + 1,
      combo: player.combo,
      worst: player.worst,
      best: player.best,
      counts: [...player.counts],
      next: [...player.next],
      hold: [...player.hold],
      let: [...player.let],
      down: player.down.map((at) => at !== UP),
      hits: [...player.hits],
      judged: player.judged,
      judgedAt: player.judgedAt,
      judgedOff: player.judgedOff,
      item: player.item,
      itemAt: player.itemAt,
      effects: player.effects.map((effect) => [...effect] as Effect),
      shield: player.shield,
      blocked: player.blocked,
    })),
  };
}
