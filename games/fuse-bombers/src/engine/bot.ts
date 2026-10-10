// Bot players. A bot sees only the read-only view and presses the same single button as a human:
// it looks `reaction` ticks ahead with `futureAngle`, asks `predictTrajectory` (the aiming guide's
// physics) where that shot would go, scores it, and when it likes the shot it presses `reaction`
// ticks later, give or take a difficulty-dependent timing error.

import { exp, hypot, log2 } from "./det-math.js";
import { castleCenter } from "./geometry.js";
import {
  predictGhostBomb,
  predictTrajectory,
  type Trajectory,
} from "./predict.js";
import {
  damageScale,
  futureAngle,
  ghostOf,
  isGhostLoaded,
  isLoaded,
} from "./round.js";
import { hashSeed, int, random, type RngHolder } from "./rng.js";
import { TICK_HZ, type Card } from "./tuning.js";
import type { CastleView, RoundView } from "./types.js";

export type BotDifficulty = "easy" | "normal" | "hard";
export const BOT_DIFFICULTIES: readonly BotDifficulty[] = [
  "easy",
  "normal",
  "hard",
];

export interface BotConfig {
  difficulty: BotDifficulty;
  /** Castle id the bot plays. */
  playerId: number;
  /**
   * Seeds the bot's own RNG (timing errors, wasted shots); same seed + same views = same presses.
   * The RNG is reseeded at the start of every round from this and the round's `config.seed`, so each
   * round gets its own error stream and a bot reused across a match plays like a fresh one.
   */
  seed: number;
}

/**
 * Call once per tick with the view *before* `step`; true = press the button this tick. The view may
 * be the live state or a fresh copy every tick: a new round is recognised by the tick going
 * backwards or the round seed changing, never by object identity.
 */
export type Bot = (view: RoundView) => boolean;

interface Profile {
  /** Ticks between deciding and pressing (the bot aims at `futureAngle(view, id, reaction)`). */
  reaction: number;
  /** The press lands up to this many ticks early or late. */
  timingError: number;
  /** Evaluate one candidate shot every this many ticks (bounds the `predictTrajectory` cost). */
  thinkEvery: number;
  /** Fire when a shot scores at least this fraction of the best shot seen over the last sweep. */
  pickiness: number;
  /** Smallest score worth a volley while patient (1 = a plain hit on an ordinary target). */
  minScore: number;
  /** Ticks after loading over which the bot's standards relax. */
  patience: number;
  /** Chance per volley to fire at a random moment instead of aiming. */
  wasteChance: number;
  /** How much gate multipliers, crates, weak targets, the leader and revenge count. */
  gateLove: number;
  crateLove: number;
  focusWeak: number;
  focusLeader: number;
  grudge: number;
  /** A ghost drops when its bomb would land within this many px of a castle's centre. */
  ghostSlack: number;
}

const PROFILES: Readonly<Record<BotDifficulty, Profile>> = {
  easy: {
    reaction: 24,
    timingError: 10,
    thinkEvery: 4,
    pickiness: 0.3,
    minScore: 0.2,
    patience: 40,
    wasteChance: 0.45,
    gateLove: 0.15,
    crateLove: 0.1,
    focusWeak: 0,
    focusLeader: 0,
    grudge: 0.5,
    ghostSlack: 70,
  },
  normal: {
    reaction: 15,
    timingError: 3,
    thinkEvery: 2,
    pickiness: 0.65,
    minScore: 0.35,
    patience: 150,
    wasteChance: 0.05,
    gateLove: 0.6,
    crateLove: 0.5,
    focusWeak: 0.5,
    focusLeader: 0.3,
    grudge: 0.3,
    ghostSlack: 40,
  },
  hard: {
    reaction: 10,
    timingError: 1,
    thinkEvery: 1,
    pickiness: 0.75,
    minScore: 0.4,
    patience: 120,
    wasteChance: 0,
    gateLove: 1,
    crateLove: 1,
    focusWeak: 1.2,
    focusLeader: 0.4,
    grudge: 0.2,
    ghostSlack: 25,
  },
};

const CARD_VALUE: Readonly<Record<Card, number>> = {
  unit: 1,
  rapid: 0.8,
  mega: 0.7,
  shield: 0.5,
  repair: 0.3,
};

/** Rocket count beyond which more gate splits no longer add value (the swarm is plenty). */
const SWARM_CAP = 250;

export function createBot(config: BotConfig): Bot {
  const p = PROFILES[config.difficulty];
  const id = config.playerId;
  const rng: RngHolder = { rng: 0 };
  let roundSeed = NaN;
  let lastTick = -1;
  let facing = "";
  let alive = true;
  let pressAt = -1;
  let loadedAt = -1;
  let wasting = false;
  /** Scores of recently evaluated shots, as [tick, score] pairs, oldest first. */
  let seen: [number, number][] = [];
  /** The last three raw evaluations, one `thinkEvery` apart. */
  let raw: [number, number][] = [];

  /** An eliminated bot flies its ghost: drop when the bomb would land on or next to a castle. */
  const playGhost = (view: RoundView): boolean => {
    const g = ghostOf(view, id);
    if (!g) return false;
    const tick = view.tick;
    if (pressAt >= 0) {
      if (tick >= pressAt && isGhostLoaded(g)) {
        pressAt = -1;
        return true;
      }
      if (tick > pressAt + 10) pressAt = -1; // stale plan
      return false;
    }
    if (g.reloadTicks > p.reaction || (tick + id) % p.thinkEvery) return false;
    const drop = predictGhostBomb(view, id, p.reaction);
    if (!drop) return false;
    const { kind, x, y } = drop.impact;
    const near =
      kind === "castle" ||
      kind === "shield" ||
      (kind === "terrain" &&
        view.castles.some((c) => {
          if (!c.alive) return false;
          const center = castleCenter(c, view.tuning);
          return hypot(x - center.x, y - center.y) < p.ghostSlack;
        }));
    if (!near) return false;
    const err = int(rng, -p.timingError, p.timingError);
    pressAt = Math.max(tick + 1, tick + p.reaction + err);
    return false;
  };

  return (view) => {
    const me = view.castles[id];
    // A new round, or a death that changed our arc (plans and remembered angles are then stale).
    const newRound = view.tick < lastTick || view.config.seed !== roundSeed;
    lastTick = view.tick;
    if (newRound) {
      roundSeed = view.config.seed;
      rng.rng = hashSeed(hashSeed(config.seed, roundSeed), 7919 + id);
    }
    if (newRound || me?.facing !== facing || me.alive !== alive) {
      facing = me?.facing ?? "";
      alive = me?.alive ?? false;
      pressAt = loadedAt = -1;
      seen = [];
      raw = [];
    }
    if (!me || view.result) return false;
    const tick = view.tick;
    if (!me.alive) return playGhost(view);

    if (pressAt >= 0 && tick >= pressAt) {
      if (isLoaded(me)) {
        pressAt = loadedAt = -1;
        seen = [];
        raw = [];
        return true;
      }
      if (tick > pressAt + 10) pressAt = -1; // stale plan
      return false;
    }
    if (pressAt >= 0 || me.volleyLeft > 0) return false;

    const loaded = isLoaded(me);
    if (loaded && loadedAt < 0) {
      loadedAt = tick;
      wasting = random(rng) < p.wasteChance;
    }
    if (loaded && wasting) {
      wasting = false;
      pressAt = tick + int(rng, 1, 45); // a nervous shot, wherever the launcher points
      return false;
    }

    // Think while the reload finishes, so the bot knows the sweep's best shot by the time it is
    // loaded. Only one trajectory per `thinkEvery` ticks.
    if (
      me.reloadTicks > p.reaction + period(view, me) ||
      (tick + id) % p.thinkEvery
    )
      return false;
    const shot = predictTrajectory(
      view,
      id,
      futureAngle(view, id, p.reaction),
      { maxTicks: 300 },
    );
    // Timing is never exact, so judge each angle together with its neighbours: the candidate is the
    // previous evaluation, smoothed with the ones before and after it.
    if (raw.length > 0 && raw[raw.length - 1]?.[0] !== tick - p.thinkEvery)
      raw = [];
    raw.push([tick, scoreShot(view, me, shot, p)]);
    if (raw.length > 3) raw.shift();
    const [a, b, c] = raw;
    if (!a || !b || !c) return false;
    const at = b[0];
    const score = 0.25 * a[1] + 0.5 * b[1] + 0.25 * c[1];
    const horizon = tick - period(view, me);
    while (seen.length > 0 && (seen[0]?.[0] ?? 0) < horizon) seen.shift();
    seen.push([at, score]);
    if (me.reloadTicks > p.reaction - p.thinkEvery) return false;

    let best = 0;
    for (const [, s] of seen) best = Math.max(best, s);
    const waited = loadedAt < 0 ? 0 : tick - loadedAt;
    const relax = Math.max(0, 1 - waited / p.patience);
    const bar = Math.max(
      p.minScore * relax,
      p.pickiness * best * (0.5 + 0.5 * relax),
    );
    if (score <= 0 || score < bar) return false;
    const err = int(rng, -p.timingError, p.timingError);
    pressAt = Math.max(tick + 1, at + p.reaction + err);
    return false;
  };
}

/** Ticks for the launcher to sweep there and back again. */
function period(view: RoundView, me: CastleView): number {
  const t = view.tuning;
  const sweep = me.facing === "both" ? t.sweepTimeWide : t.sweepTimeNarrow;
  return Math.round(2 * sweep * TICK_HZ);
}

/** How much the bot wants to hit each castle (0 for itself and the dead). */
function targetWeights(view: RoundView, me: CastleView, p: Profile): number[] {
  const t = view.tuning;
  const volley = me.units * t.rocketDamage * damageScale(view);
  let leader = -1;
  let leaderHp = -1;
  for (const o of view.castles) {
    if (o.alive && o.id !== me.id && o.hp + o.shieldHp > leaderHp) {
      leader = o.id;
      leaderHp = o.hp + o.shieldHp;
    }
  }
  return view.castles.map((o) => {
    if (!o.alive || o.id === me.id) return 0;
    let w = 1 + p.focusWeak * (1 - o.hp / o.maxHp);
    if (o.hp + o.shieldHp <= volley) w += p.focusWeak; // one good volley finishes it
    if (o.id === leader) w += p.focusLeader;
    if (o.id === me.lastHitBy) w += p.grudge;
    return w;
  });
}

/**
 * Scores a predicted shot: 1 is a plain hit on an ordinary target. Near misses count partly (the
 * volley spreads and splashes), gate multipliers multiply the value, crates add to it, and a tiny
 * closeness term ranks otherwise useless shots so an impatient bot at least fires toward someone.
 */
function scoreShot(
  view: RoundView,
  me: CastleView,
  shot: Trajectory,
  p: Profile,
): number {
  const t = view.tuning;
  const weights = targetWeights(view, me, p);
  let mult = 1;
  for (const g of shot.gates) mult *= g.multiplier;
  const swarm = Math.min(mult, Math.max(1, SWARM_CAP / me.units));
  const { kind, x, y, castleId } = shot.impact;

  let hit = 0;
  let closest = Infinity;
  if ((kind === "castle" || kind === "shield") && castleId !== null) {
    hit = (weights[castleId] ?? 0) * (kind === "shield" ? 0.7 : 1);
    closest = 0;
  } else if (kind === "terrain") {
    const reach =
      (t.craterRadius + t.castleRadius + 20) * (1 + 0.35 * log2(swarm));
    for (const o of view.castles) {
      const w = weights[o.id] ?? 0;
      if (w === 0) continue;
      const c = castleCenter(o, t);
      const d = hypot(x - c.x, y - c.y);
      closest = Math.min(closest, d);
      hit = Math.max(hit, 0.7 * w * Math.max(0, 1 - d / reach));
    }
  }
  let crates = 0;
  for (const c of shot.crates) crates += CARD_VALUE[c.card];
  if (me.hp < me.maxHp * 0.5) crates += 0.5 * shot.crates.length; // any card helps a wreck
  const value =
    hit * (1 + p.gateLove * (swarm - 1)) +
    p.crateLove * crates +
    // Swarms that miss still chew terrain (and may clip someone); a small reward for spectacle.
    0.03 * p.gateLove * log2(swarm);
  return value + 0.02 * exp(-closest / 300);
}
