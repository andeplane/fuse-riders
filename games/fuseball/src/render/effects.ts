import type { WorldView } from "../engine/view.js";
import {
  BUBBLE_RADIUS,
  RIDER_RADIUS,
  VIEW_H,
  VIEW_W,
  isCircle,
  mapOf,
} from "../engine/view-kit.js";
import {
  BALL,
  BALL_HOT,
  CLOUD,
  TEAM,
  TEAM_LIGHT,
  teamLight,
  WHITE,
  hexA,
} from "./palette.js";
import {
  FRAMES,
  SPRITE_H,
  SPRITE_W,
  frameFor,
  inkOf,
  type Paint,
} from "./sprites.js";

/**
 * Everything that happened between two views that the presentation may want to show or sound: read off the
 * counters and flags changing, never stored in the simulation. A counter that went backwards (a rollback, or a new
 * match) says nothing; the next view is compared with it as it stands.
 */
export type Cue =
  /** A jump, an air-jump or a quick drop, where the rider was. */
  | { kind: "jump"; slot: 0 | 1; x: number; y: number; grounded: boolean }
  /** A new bubble. */
  | { kind: "bubble"; slot: 0 | 1; index: number; x: number; y: number }
  /** The bubble a new one replaced: the trail ring. */
  | { kind: "trail"; slot: 0 | 1; x: number; y: number }
  /** A bubble burst, by the ball or by the other rider. */
  | { kind: "pop"; slot: 0 | 1; x: number; y: number }
  | { kind: "harden"; slot: 0 | 1; x: number; y: number }
  /** The ball bounced, was kicked, lifted or bumped; `speed` in pixels a micro-step. */
  | { kind: "bounce"; x: number; y: number; speed: number; touch: -1 | 0 | 1 }
  /** A point for `team`, through the goal centred on (`x`, `y`). */
  | { kind: "goal"; team: 0 | 1; x: number; y: number; suddenDeath: boolean }
  /** `slot`'s rider disintegrates at (`x`, `y`), struck from the goal at (`fromX`, `fromY`). */
  | {
      kind: "zap";
      slot: 0 | 1;
      index: number;
      x: number;
      y: number;
      fromX: number;
      fromY: number;
    }
  /** The countdown shows a new number. */
  | { kind: "count"; count: number }
  /** The countdown ended. */
  | { kind: "go" }
  | { kind: "over"; winner: -1 | 0 | 1 };

const COUNTER = 0x10000;
/** How far a wrapping counter moved forwards, or 0 when it stood still or went back. */
const ahead = (was: number, now: number): number => {
  const moved = (now - was + COUNTER) % COUNTER;
  return moved < COUNTER / 2 ? moved : 0;
};
const SLOTS = [0, 1] as const;

/** The centre of `team`'s goal nearest (`x`, `y`), the short way round on an axis that wraps. */
export function goalNear(
  view: Pick<WorldView, "mapId" | "seed">,
  team: 0 | 1,
  x: number,
  y: number,
): { x: number; y: number } {
  const map = mapOf(view.mapId, view.seed);
  const gap = (a: number, b: number, size: number, wraps: boolean) => {
    const d = Math.abs(a - b);
    return wraps ? Math.min(d, size - d) : d;
  };
  let best = { x, y },
    nearest = Infinity;
  for (const goal of map.goals) {
    if (goal.team !== team) continue;
    const at = isCircle(goal)
      ? { x: goal.x, y: goal.y }
      : { x: goal.x + goal.w / 2, y: goal.y + goal.h / 2 };
    const far = gap(at.x, x, map.w, map.wrapX) + gap(at.y, y, map.h, map.wrapY);
    if (far < nearest) [best, nearest] = [at, far];
  }
  return best;
}

export function cues(older: WorldView | undefined, newer: WorldView): Cue[] {
  if (
    !older ||
    older.mapId !== newer.mapId ||
    older.seed !== newer.seed ||
    older.riders.length !== newer.riders.length
  )
    return [];
  const found: Cue[] = [];
  const reset = newer.phase === "countdown" && older.phase !== "countdown";
  for (const now of newer.riders) {
    const { index, slot } = now,
      was = older.riders[index],
      before = older.bubbles[index],
      bubble = newer.bubbles[index];
    if (!was || !before || !bubble) continue;
    if (ahead(was.jumps, now.jumps))
      found.push({
        kind: "jump",
        slot,
        x: was.x,
        y: was.y,
        grounded: was.grounded,
      });
    const placed = ahead(before.seq, bubble.seq) > 0;
    if (placed) {
      if (before.active)
        found.push({ kind: "trail", slot, x: before.x, y: before.y });
      if (bubble.active)
        found.push({ kind: "bubble", slot, index, x: bubble.x, y: bubble.y });
    } else if (before.seq === bubble.seq) {
      if (before.active && !bubble.active && !reset)
        found.push({ kind: "pop", slot, x: before.x, y: before.y });
    } else continue;
    // A bubble held from the press is hard by the first view that shows it.
    if (bubble.active && bubble.hard && (placed || !before.hard))
      found.push({ kind: "harden", slot, x: bubble.x, y: bubble.y });
  }
  const { ball } = newer;
  if (ahead(older.ball.bounces, ball.bounces))
    found.push({
      kind: "bounce",
      x: ball.x,
      y: ball.y,
      speed: Math.hypot(ball.vx, ball.vy),
      touch: ball.touch,
    });
  for (const team of SLOTS) {
    if (newer.score[team] <= older.score[team]) continue;
    const goal = goalNear(newer, team, ball.x, ball.y);
    found.push({ kind: "goal", team, ...goal, suddenDeath: newer.suddenDeath });
  }
  for (const rider of newer.riders) {
    const { index, slot } = rider;
    // The rider is struck when the freeze that follows the goal lets go.
    const struck = rider.zapped && !newer.frozen,
      was = older.riders[index]?.zapped === true && !older.frozen;
    if (!struck || was) continue;
    const from = goalNear(newer, slot === 0 ? 1 : 0, ball.x, ball.y);
    found.push({
      kind: "zap",
      slot,
      index,
      x: rider.x,
      y: rider.y,
      fromX: from.x,
      fromY: from.y,
    });
  }
  if (newer.count > 0 && newer.count !== older.count)
    found.push({ kind: "count", count: newer.count });
  if (older.phase === "countdown" && newer.phase === "play")
    found.push({ kind: "go" });
  if (older.phase !== "over" && newer.phase === "over")
    found.push({ kind: "over", winner: newer.winner });
  return found;
}

type Shape = "spark" | "shard" | "ring" | "puff";
interface Particle {
  live: boolean;
  shape: Shape;
  x: number;
  y: number;
  vx: number;
  vy: number;
  gravity: number;
  /** Seconds lived and seconds to live. */
  age: number;
  span: number;
  /** A spark's side or a ring's radius, and how fast it grows, in pixels and pixels a second. */
  size: number;
  grow: number;
  color: string;
}
interface Beam {
  team: 0 | 1;
  fromX: number;
  fromY: number;
  x: number;
  y: number;
  age: number;
}

/** The most particles alive at once; a spawn past it takes over the oldest slot. */
export const MAX_PARTICLES = 360;
/** How strong the slow-motion vignette is at `speed` (a fraction of full speed): 0 at full speed, 1 at 0.35 and below. */
export const vignetteFor = (speed: number): number =>
  Math.max(0, Math.min(1, (1 - speed) / 0.65));

const BEAM_S = 0.6,
  FLASH_S = 0.45,
  SHAKE_S = 0.35,
  /** Seconds between frames past which the effects stand still: a hidden tab does not fast-forward them. */
  MAX_FRAME_S = 0.05;

export interface Effects {
  /**
   * Takes the view about to be drawn: spawns what changed since the last one and moves every particle on to
   * `nowMs`. Returns the cues it acted on, for the app's sounds.
   */
  update(view: WorldView, nowMs: number): readonly Cue[];
  /** Rings and cloud puffs, under the riders. */
  drawBehind(g: Paint): void;
  /** Sparks, shards and the zap beam, over the riders. */
  drawFront(g: Paint): void;
  /** The goal flash and the slow-motion vignette, over the whole field. */
  drawOverlay(g: Paint): void;
  /** How far to shift the field this frame, in pixels: the shake after a goal. */
  shake(): { x: number; y: number };
  /** Milliseconds since the bubble of the rider at `index` appeared, or since that rider was zapped; huge when it was not seen. */
  bubbleAge(index: number, nowMs: number): number;
  zapAge(index: number, nowMs: number): number;
  /** Particles alive now. */
  count(): number;
  reset(): void;
}

export interface EffectsOptions {
  /** Where the scatter comes from; cosmetic only, so `Math.random` unless a test wants it fixed. */
  random?: () => number;
  /** No shake and a gentler flash. */
  reducedMotion?: boolean;
}

export function createEffects(options: EffectsOptions = {}): Effects {
  const random = options.random ?? Math.random,
    calm = options.reducedMotion === true;
  const pool: Particle[] = Array.from({ length: MAX_PARTICLES }, () => ({
    live: false,
    shape: "spark" as Shape,
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    gravity: 0,
    age: 0,
    span: 1,
    size: 1,
    grow: 0,
    color: WHITE,
  }));
  let cursor = 0,
    last: WorldView | undefined,
    lastMs: number | undefined,
    beams: Beam[] = [],
    flash: { team: 0 | 1; age: number } | undefined,
    shaking = SHAKE_S,
    slow = 0,
    puffDebt = 0;
  /** When each rider's bubble appeared and when each was zapped, by the rider's place. */
  const born: number[] = [],
    zapped: number[] = [];

  const spawn = (
    shape: Shape,
    x: number,
    y: number,
    color: string,
    span: number,
    size: number,
    more: Partial<Pick<Particle, "vx" | "vy" | "gravity" | "grow">> = {},
  ) => {
    // Slots are handed out in turn, so past the cap a spawn takes over the oldest: the pool never grows.
    const p = pool[cursor]!;
    cursor = (cursor + 1) % MAX_PARTICLES;
    Object.assign(p, {
      live: true,
      shape,
      x,
      y,
      color,
      span,
      size,
      age: 0,
      vx: 0,
      vy: 0,
      gravity: 0,
      grow: 0,
      ...more,
    });
  };
  const burst = (
    x: number,
    y: number,
    color: string,
    amount: number,
    speed: number,
    from = 0,
  ) => {
    for (let i = 0; i < amount; i++) {
      const angle = random() * Math.PI * 2,
        v = speed * (0.35 + random() * 0.65);
      spawn(
        "spark",
        x + Math.cos(angle) * from,
        y + Math.sin(angle) * from,
        color,
        0.25 + random() * 0.35,
        1 + Math.round(random()),
        { vx: Math.cos(angle) * v, vy: Math.sin(angle) * v, gravity: 160 },
      );
    }
  };

  const act = (cue: Cue, view: WorldView, nowMs: number) => {
    switch (cue.kind) {
      case "jump": {
        const feet = cue.y + RIDER_RADIUS - 1;
        spawn("ring", cue.x, feet, TEAM[cue.slot], 0.28, 3, { grow: 38 });
        for (let i = 0; i < 3; i++)
          spawn(
            "spark",
            cue.x + (random() - 0.5) * 10,
            feet,
            TEAM_LIGHT[cue.slot],
            0.2 + random() * 0.2,
            1,
            { vx: (random() - 0.5) * 50, vy: 20 + random() * 40 },
          );
        break;
      }
      case "bubble":
        born[cue.index] = nowMs;
        break;
      case "trail":
        spawn("ring", cue.x, cue.y, TEAM[cue.slot], 0.5, BUBBLE_RADIUS, {
          grow: -14,
        });
        break;
      case "pop":
        spawn("ring", cue.x, cue.y, TEAM_LIGHT[cue.slot], 0.3, BUBBLE_RADIUS, {
          grow: 46,
        });
        burst(cue.x, cue.y, TEAM[cue.slot], 12, 110, BUBBLE_RADIUS);
        break;
      case "harden":
        spawn("ring", cue.x, cue.y, WHITE, 0.22, BUBBLE_RADIUS + 8, {
          grow: -24,
        });
        break;
      case "bounce": {
        const color = cue.touch < 0 ? BALL : teamLight(cue.touch);
        burst(
          cue.x,
          cue.y,
          color,
          Math.min(10, 3 + Math.round(cue.speed * 2)),
          50 + cue.speed * 30,
        );
        break;
      }
      case "goal":
        flash = { team: cue.team, age: 0 };
        shaking = 0;
        spawn("ring", cue.x, cue.y, TEAM[cue.team], 0.6, 6, { grow: 150 });
        spawn("ring", cue.x, cue.y, WHITE, 0.45, 4, { grow: 90 });
        burst(cue.x, cue.y, TEAM[cue.team], 22, 200);
        burst(cue.x, cue.y, BALL_HOT, 8, 140);
        break;
      case "zap": {
        zapped[cue.index] = nowMs;
        const team = cue.slot === 0 ? 1 : 0;
        beams.push({ ...cue, team, age: 0 });
        if (!view.riders[cue.index]) break;
        // The rider comes apart into the pixels it was drawn with.
        const rider = view.riders[cue.index]!,
          left = cue.x - SPRITE_W / 2,
          top = cue.y - SPRITE_H / 2;
        for (const run of FRAMES[frameFor(rider)]) {
          for (let x = run.x; x < run.x + run.w; x += 2) {
            const sx = rider.facing === 1 ? x : SPRITE_W - x - 2,
              px = left + sx + 1,
              py = top + run.y;
            spawn(
              "shard",
              px,
              py,
              inkOf(run.key, cue.slot),
              0.5 + random() * 0.7,
              2,
              {
                vx: (px - cue.x) * 9 + (random() - 0.5) * 60,
                vy: (py - cue.y) * 9 - 30 - random() * 60,
                gravity: 90,
                grow: -1.5,
              },
            );
          }
        }
        spawn("ring", cue.x, cue.y, WHITE, 0.35, 4, { grow: 110 });
        break;
      }
      default:
        break;
    }
  };

  const advance = (view: WorldView, seconds: number) => {
    // Sparks hang in the air with the arena in slow motion, though never quite still.
    const dt = seconds * Math.max(0.15, view.speed);
    for (const p of pool) {
      if (!p.live) continue;
      p.age += dt;
      if (p.age >= p.span) {
        p.live = false;
        continue;
      }
      p.vy += p.gravity * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.size = Math.max(0, p.size + p.grow * dt);
    }
    beams = beams.filter((beam) => (beam.age += seconds) < BEAM_S);
    if (flash && (flash.age += seconds) >= FLASH_S) flash = undefined;
    shaking = Math.min(SHAKE_S, shaking + seconds);
    // The vignette follows the arena's speed: clear at full speed, full at a cloud's core and below.
    slow += (vignetteFor(view.speed) - slow) * Math.min(1, seconds * 9);
    // Clouds breathe a little all the time and boil while they hold the ball.
    const clouds = mapOf(view.mapId, view.seed).clouds;
    puffDebt = Math.min(4, puffDebt + seconds * (view.slow ? 26 : 5));
    while (puffDebt >= 1 && clouds.length > 0) {
      puffDebt--;
      const cloud = clouds[Math.floor(random() * clouds.length)] ?? clouds[0]!;
      const angle = random() * Math.PI * 2,
        reach = cloud.r * (0.3 + random() * 0.7);
      spawn(
        "puff",
        cloud.x + Math.cos(angle) * reach,
        cloud.y + Math.sin(angle) * reach,
        CLOUD,
        0.9 + random() * 0.8,
        3 + random() * 4,
        {
          vx: Math.cos(angle) * 6,
          vy: -6 - random() * 8,
          grow: 5,
        },
      );
    }
  };

  const fade = (p: Particle) => 1 - p.age / p.span;

  return {
    update(view, nowMs) {
      const found = cues(last, view);
      for (const cue of found) act(cue, view, nowMs);
      const seconds =
        lastMs === undefined
          ? 0
          : Math.max(0, Math.min(MAX_FRAME_S, (nowMs - lastMs) / 1000));
      advance(view, seconds);
      last = view;
      lastMs = nowMs;
      return found;
    },
    drawBehind(g) {
      for (const p of pool) {
        if (!p.live || (p.shape !== "ring" && p.shape !== "puff")) continue;
        const a = fade(p);
        g.beginPath();
        g.arc(p.x, p.y, Math.max(0.5, p.size), 0, Math.PI * 2);
        if (p.shape === "puff") {
          g.fillStyle = hexA(p.color, 0.16 * a);
          g.fill();
        } else {
          g.lineWidth = 3;
          g.strokeStyle = hexA(p.color, 0.22 * a);
          g.stroke();
          g.lineWidth = 1;
          g.strokeStyle = hexA(p.color, 0.9 * a);
          g.stroke();
        }
      }
    },
    drawFront(g) {
      for (const p of pool) {
        if (!p.live || (p.shape !== "spark" && p.shape !== "shard")) continue;
        g.globalAlpha = Math.min(1, fade(p) * 1.6);
        g.fillStyle = p.color;
        g.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
      }
      g.globalAlpha = 1;
      for (const beam of beams) {
        const left = 1 - beam.age / BEAM_S,
          dx = beam.x - beam.fromX,
          dy = beam.y - beam.fromY,
          length = Math.hypot(dx, dy) || 1,
          nx = -dy / length,
          ny = dx / length,
          joints = Math.max(3, Math.round(length / 22));
        // A new jagged path every frame: lightning, not a ruler.
        g.beginPath();
        g.moveTo(beam.fromX, beam.fromY);
        for (let i = 1; i < joints; i++) {
          const along = i / joints,
            off = (random() - 0.5) * 16 * left;
          g.lineTo(
            beam.fromX + dx * along + nx * off,
            beam.fromY + dy * along + ny * off,
          );
        }
        g.lineTo(beam.x, beam.y);
        g.lineWidth = 9;
        g.strokeStyle = hexA(TEAM[beam.team], 0.2 * left);
        g.stroke();
        g.lineWidth = 4;
        g.strokeStyle = hexA(TEAM[beam.team], 0.75 * left);
        g.stroke();
        g.lineWidth = 1.5;
        g.strokeStyle = hexA(WHITE, Math.min(1, left * 1.5));
        g.stroke();
        for (const [x, y, r] of [
          [beam.fromX, beam.fromY, 10],
          [beam.x, beam.y, 14],
        ] as const) {
          g.beginPath();
          g.arc(x, y, r * left, 0, Math.PI * 2);
          g.fillStyle = hexA(TEAM_LIGHT[beam.team], 0.55 * left);
          g.fill();
        }
      }
    },
    drawOverlay(g) {
      if (flash) {
        const left = 1 - flash.age / FLASH_S;
        g.fillStyle = hexA(TEAM[flash.team], (calm ? 0.12 : 0.4) * left * left);
        g.fillRect(0, 0, VIEW_W, VIEW_H);
      }
      if (slow > 0.01) {
        const shade = g.createRadialGradient(
          VIEW_W / 2,
          VIEW_H / 2,
          VIEW_H * 0.24,
          VIEW_W / 2,
          VIEW_H / 2,
          VIEW_W * 0.62,
        );
        shade.addColorStop(0, hexA(CLOUD, 0));
        shade.addColorStop(0.6, hexA("#5a4fd0", 0.34 * slow));
        shade.addColorStop(1, hexA("#1a0f4a", 0.8 * slow));
        g.fillStyle = shade;
        g.fillRect(0, 0, VIEW_W, VIEW_H);
      }
    },
    shake() {
      if (calm || shaking >= SHAKE_S) return { x: 0, y: 0 };
      const reach = 5 * (1 - shaking / SHAKE_S);
      return { x: (random() - 0.5) * reach, y: (random() - 0.5) * reach };
    },
    bubbleAge: (index, nowMs) => nowMs - (born[index] ?? -Infinity),
    zapAge: (index, nowMs) => nowMs - (zapped[index] ?? -Infinity),
    count: () => pool.reduce((n, p) => n + (p.live ? 1 : 0), 0),
    reset() {
      for (const p of pool) p.live = false;
      last = undefined;
      lastMs = undefined;
      beams = [];
      flash = undefined;
      shaking = SHAKE_S;
      slow = 0;
      puffDebt = 0;
      born.length = 0;
      zapped.length = 0;
    },
  };
}
