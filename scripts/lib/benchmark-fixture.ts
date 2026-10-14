import {
  createGame,
  classicSettings,
  addPlayer,
  toView,
  RIDER_COLORS,
  TRAIL_LIFETIME_TICKS,
} from "../../games/fuse-riders/src/engine/game.js";
import { AVATARS } from "../../games/fuse-riders/src/shared/avatars.js";
import type {
  TrailSegment,
  WorldView,
} from "../../games/fuse-riders/src/engine/view.js";

/** A rider's lap, as a pure function of the tick so the same tick always lays the same segment. */
interface Ring {
  cx: number;
  cy: number;
  radius: number;
}
function ring(p: number): Ring {
  // Five laps that stay clear of each other and of the boundary, each rider on its own radius.
  return {
    cx: 260 + (p % 3) * 480,
    cy: 250 + Math.floor(p / 3) * 390,
    radius: 130 + p * 14,
  };
}
/** How far a lap's centre wanders, and the two rates it wanders at: enough that no lap retraces the one before. */
const DRIFT = 12,
  DRIFT_X = 0.013,
  DRIFT_Y = 0.019;
/**
 * Where rider `p` stands at the end of tick `c`. It depends on that tick alone, never on the tick being drawn:
 * that is what makes an established segment the same geometry every frame, as a laid trail is in the game.
 */
function riderPoint(
  p: number,
  c: number,
  speed: number,
): { x: number; y: number } {
  const { cx, cy, radius } = ring(p);
  // A shade under the rider's own `speed`, once the drifting centre has had its say, so a fractional tip stays
  // inside the step `trailTip` will allow it.
  const a = p + (c * (speed - 0.3)) / radius;
  return {
    x: cx + DRIFT * Math.sin(c * DRIFT_X + p) + Math.cos(a) * radius,
    y: cy + DRIFT * Math.sin(c * DRIFT_Y + p) + Math.sin(a) * radius,
  };
}
const shortest = (delta: number): number =>
  Math.atan2(Math.sin(delta), Math.cos(delta));

/**
 * Synthetic reproducible visual stress, not a physics or network benchmark.
 *
 * `tick` may be fractional, as presentation hands a renderer: the discrete world is the tick it floors to, and
 * the riders are interpolated on into the next one. Trails behave as the game's do — a segment is laid at the
 * tail each tick, drops off the head when its `expiresAtTick` comes round, and never moves once laid — so a
 * frame drawn between two ticks reuses the established history and extends only the moving tip.
 */
export function visualFixture(tick: number): WorldView {
  const simTick = Math.floor(tick),
    fraction = tick - simTick;
  // The classic board with a parked aim: what this fixture rendered before settings became required (#311).
  const game = createGame("renderer-fixture", classicSettings(), 42);
  // The fixture uses five of the available slot colors and avatars.
  for (let p = 0; p < 5; p++)
    addPlayer(game, {
      id: `p${p}`,
      name: `RIDER ${p + 1}`,
      slot: p,
      color: RIDER_COLORS[p]!,
      avatarId: AVATARS[p]!.id,
    });
  const state = toView(game);
  const phase = tick / 20;
  return {
    ...state,
    tick,
    round: 1,
    phase: "playing",
    boundaryInset: 35,
    players: state.players.map((player, p) => {
      // The window a base-power rider carries, plus the step it is about to take for the head to ride.
      const points = Array.from({ length: TRAIL_LIFETIME_TICKS + 2 }, (_, i) =>
        riderPoint(p, simTick - TRAIL_LIFETIME_TICKS + i, player.speed),
      );
      const trail: TrailSegment[] = [];
      for (let i = 1; i <= TRAIL_LIFETIME_TICKS; i++) {
        const from = points[i - 1]!,
          to = points[i]!,
          createdTick = simTick - TRAIL_LIFETIME_TICKS + i;
        trail.push({
          x1: from.x,
          y1: from.y,
          x2: to.x,
          y2: to.y,
          createdTick,
          expiresAtTick: createdTick + TRAIL_LIFETIME_TICKS,
        });
      }
      const behind = points[TRAIL_LIFETIME_TICKS - 1]!,
        here = points[TRAIL_LIFETIME_TICKS]!,
        next = points[TRAIL_LIFETIME_TICKS + 1]!;
      // Turn-then-move: the heading at the end of a tick is the step it just laid, swung on towards the next.
      const heading = Math.atan2(here.y - behind.y, here.x - behind.x);
      return {
        ...player,
        alive: true,
        x: here.x + (next.x - here.x) * fraction,
        y: here.y + (next.y - here.y) * fraction,
        angle:
          heading +
          shortest(Math.atan2(next.y - here.y, next.x - here.x) - heading) *
            fraction,
        shielded: p === 0,
        drunkUntilTick: p === 1 ? simTick + 60 : 0,
        inkUntilTick: 0,
        trail,
      };
    }),
    bombs: Array.from({ length: 24 }, (_, i) => ({
      id: i,
      ownerId: `p${i % 5}`,
      x: 100 + ((i * 163 + phase * 50) % 1400),
      y: 80 + ((i * 127) % 740),
      launchX: 100,
      launchY: 100,
      launchedTick: simTick - 15,
      landsAtTick: simTick - 5,
      explodeAtTick: simTick + 20,
      blastRange: 90,
      flightPath: [],
      ...(i % 3 === 0 ? { shell: { vx: 200, vy: 50, gun: i % 2 === 0 } } : {}),
    })),
    blasts: Array.from({ length: 5 }, (_, i) => ({
      bombId: 1000 + Math.floor(simTick / 12) * 5 + i,
      circle: { x: 220 + i * 270, y: 450, radius: 70 + i * 12 },
      expiresAtTick: simTick + 8 - (simTick % 12),
    })).filter((b) => b.expiresAtTick > simTick),
    pickups: ["power", "triple", "five", "beer", "star", "shell"].map(
      (type, i) => ({
        id: i,
        type: type as WorldView["pickups"][number]["type"],
        x: 180 + i * 240,
        y: 780,
        expiresAtTick: simTick + 100,
      }),
    ),
  };
}
