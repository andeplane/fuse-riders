/** Balance constants and the pure functions of them that the simulation, the bots and the presentation all read. */
import { POWER_TUNING } from "./power-progression.js";
import { sortedPlayers, type GameState } from "./state.js";
import { type HasEffects, speedMultiplier } from "./effects.js";

export const TICK_HZ = 20;
export const MAX_PLAYERS = 5;
export const MIN_PLAYERS = 2;

export const ARENA_WIDTH = 1600;
export const ARENA_HEIGHT = 900;
export const INITIAL_BOUNDARY_INSET = 20;
/**
 * The ten colours a rider may wear, and the order a free one is handed out in. Colour is the rider's own, not its
 * seat's: the fold keeps it unique among the riders in the room (`freeColor`, `COLOR` entries), so two riders never
 * share a trail colour and nobody has to guess whose line they just crossed.
 *
 * The first five are the seat colours every earlier room wore, in the order seats are claimed, so a room nobody
 * recolours looks exactly as it did. The five after them fill the gaps around the wheel — amber above orange, red
 * between orange and pink, emerald between lime and cyan, blue between cyan and violet, fuchsia between violet and
 * pink — each at least 20° of hue from its neighbours, and checked as trails against the dark field and the desert
 * and forest grounds (`npx tsx scripts/rider-colors-sheet.ts`).
 */
export const RIDER_COLORS = [
  "#22d3ee", // cyan
  "#ff4fa3", // pink
  "#a3e635", // lime
  "#fb923c", // orange
  "#a78bfa", // violet
  "#facc15", // amber
  "#ef4444", // red
  "#34d399", // emerald
  "#60a5fa", // blue
  "#e879f9", // fuchsia
] as const;
export type RiderColor = (typeof RIDER_COLORS)[number];
export const isRiderColor = (value: unknown): value is RiderColor =>
  (RIDER_COLORS as readonly string[]).includes(value as string);

export const RIDER_SPEED = 150;
/** Ticks after launch during which a Shell ignores its shooter's trail and body. */
export const PROJECTILE_OWNER_GRACE_TICKS = 6;
export const RIDER_TURN_RATE = 2.8;
/** GRIP reduces the turn radius by about 43% at unchanged speed, lasting until the next round. */
export const GRIP_TURN_MULTIPLIER = 1.75;
export function riderTurnRate(player: { grip: boolean }): number {
  return RIDER_TURN_RATE * (player.grip ? GRIP_TURN_MULTIPLIER : 1);
}
export const RIDER_RADIUS = 7;
export const TRAIL_WIDTH = 6;
/** Trail heads collide at their visible width; portraits and heading arrows are cosmetic. */
export const RIDER_CONTACT_RADIUS = TRAIL_WIDTH / 2;
/**
 * Scenery is met at the head's visible width too, and against the obstacle's hitbox (`obstacleHitbox`) rather than
 * always its whole footprint: a portrait that overlapped a rock, or a rider that crossed the empty corner of a
 * crown's footprint, did not crash.
 */
export const RIDER_OBSTACLE_RADIUS = RIDER_CONTACT_RADIUS;
export const TRAIL_LIFETIME_TICKS = POWER_TUNING.baseTrailLifetimeTicks;
export const SELF_TRAIL_GRACE_TICKS = 10;

export const BOMB_FUSE_TICKS = 40;
/** Shorter Fuse stacks twice per round; capture the duration when a bomb launches. */
export function bombFuseTicks(level = 0): number {
  return BOMB_FUSE_TICKS - Math.min(2, Math.max(0, level)) * 10;
}
export const BOMB_COOLDOWN_TICKS = POWER_TUNING.baseReloadTicks;
export const BOMB_BLAST_RANGE = POWER_TUNING.baseBlastRadius;
export const BLAST_VISIBLE_TICKS = 8;
/**
 * Gravity opens one to three black holes of random size for eight seconds. Space curves inside one: every rider's
 * heading bends toward the centre, hardest at the middle and not at all at the rim, so nobody rides a straight line there.
 */
export const GRAVITY_FIELD_TICKS = 160;
export const GRAVITY_MAX_HOLES_PER_PICKUP = 3;
/** Live holes at once; a pickup past the cap retires the oldest first, as portal pairs do. */
export const MAX_GRAVITY_FIELDS = 6;
export const GRAVITY_MIN_RADIUS = 110;
/** The largest hole curves almost the whole arena across its short side. */
export const GRAVITY_MAX_RADIUS = ARENA_HEIGHT * 0.47;
/** The black core at a hole's centre. A rider whose centre crosses into it is gone: an ownerless death, recorded as `wall`. */
export function gravityCoreRadius(radius: number): number {
  return Math.min(30, radius * 0.16);
}
/** A hole never opens with its core this close to a living rider's centre; the hole is slid away instead. */
export const GRAVITY_CORE_SPAWN_CLEARANCE = 140;
/** Peak bend at the centre, as a share of the tick's own steering. Under 1, so a rider can always steer out of an orbit. */
export const GRAVITY_BEND = 0.85;

/** Pickups are destroyed strictly inside the inner 60% of a new bomb blast. */
export const PICKUP_DESTRUCTION_RADIUS_RATIO = 0.6;
export const PICKUP_SPAWN_ATTEMPTS = 24;
export const PICKUP_RADIUS = 14;
export const PICKUP_SPAWN_MARGIN = 40;
export const PICKUP_RIDER_BOMB_CLEARANCE = 80;
export const PICKUP_TRAIL_CLEARANCE = 40;
export const PICKUP_SEPARATION = 28;
/**
 * Nitro doubles the collector's speed and Snail halves every rival's, each for five seconds. Every pickup is its own
 * deadline: two Nitros run at 4x until the first expires, and a Snail on a Nitro rider cancels to 1x.
 * Only distance changes, so a fast rider turns wide and a slowed one turns tight.
 */
export {
  MAX_SPEED_EFFECT_STACK,
  NITRO_DURATION_TICKS,
  NITRO_SPEED,
  SNAIL_DURATION_TICKS,
  SNAIL_SPEED,
} from "./effects.js";
export const STAR_DURATION_TICKS = 100;
export const SHIELD_GRACE_TICKS = 10;

/** Pickups never sit against an obstacle, where collecting one would mean crashing into it. */
export const PICKUP_OBSTACLE_CLEARANCE = 30;
/** Every rider starts clear of the scenery, with this much open road along its heading to pick a line. */
export const SPAWN_CORRIDOR_LENGTH = 220;
export const SPAWN_CORRIDOR_RADIUS = 56;

export const COUNTDOWN_TICKS = 60;
export const ROUND_OVER_TICKS = 60;
/**
 * The final round ends like any other (its own result, then the replay), and only then names the match winner for this
 * long before the recap. Without the second beat the match result covered the round's, and read as the round's.
 */
export const MATCH_WINNER_TICKS = 60;
export const OVERTIME_START_TICK = 1200;
export const OVERTIME_INSET_PER_TICK = 0.5;
export const ROUND_DRAW_TICK = 1800;
/**
 * Riders speed up through every round, from normal pace at the start to SPEED_RAMP_MAX when overtime begins, and hold it.
 * Steering speeds up with them, so turning circles keep their size: the round gets faster, not wider.
 */
export const SPEED_RAMP_TICKS = OVERTIME_START_TICK;
export const SPEED_RAMP_MAX = 1.5;
export function roundSpeedMultiplier(elapsedTicks: number): number {
  return (
    1 +
    ((SPEED_RAMP_MAX - 1) *
      Math.max(0, Math.min(SPEED_RAMP_TICKS, elapsedTicks))) /
      SPEED_RAMP_TICKS
  );
}
/**
 * Once every human rider is out, the rest of the round is bots racing each other, and each shared tick steps the
 * simulation this many times (`driveGameTick`) until the round ends. The clock keeps its rate; the game runs faster.
 */
export const BOTS_ONLY_STEPS_PER_TICK = 3;
/**
 * How many steps the next log tick runs, from the state before it: `BOTS_ONLY_STEPS_PER_TICK` while a round is
 * playing, at least one human rider is seated, none is alive and a bot is; otherwise one. A pure function of folded
 * state, so every replica takes the same count, and a rollback that changes it replays the ticks after it with theirs.
 */
export function stepsPerTick(
  state: Pick<GameState, "phase" | "players">,
  bots: ReadonlySet<string>,
): number {
  if (state.phase !== "playing") return 1;
  let humans = 0,
    botsAlive = 0;
  for (const player of sortedPlayers(state)) {
    if (!bots.has(player.id)) {
      if (player.alive) return 1;
      humans++;
    } else if (player.alive) botsAlive++;
  }
  // A room with no human rider at all is a showcase, not a wait: it keeps its pace.
  return humans > 0 && botsAlive > 0 ? BOTS_ONLY_STEPS_PER_TICK : 1;
}
/** Every speed pickup in force on `tick`, multiplied together: one factor per unexpired Nitro or Snail deadline. */
export function riderSpeedMultiplier(
  player: Readonly<HasEffects>,
  tick: number,
): number {
  return speedMultiplier(player, tick);
}
/**
 * Holding the bomb button slows the rider to steady the aim. The slowdown eases in over AIM_SLOW_RAMP_TICKS and eases
 * back out the same way on release, cancel or the cap: speed never jumps. The cap is a budget, not the age of a charge:
 * every slowed tick of aiming spends one of AIM_SLOW_MAX_TICKS, and they come back one per tick only while the button is
 * up, so a second of slowdown is all a hold buys however long it lasts, and cancelling into a fresh press buys nothing.
 * A held Gun charges like any other weapon, so sweeping its sight slows the rider the same way.
 */
export const AIM_SLOW_SPEED = 0.5;
export const AIM_SLOW_MAX_TICKS = TICK_HZ;
export const AIM_SLOW_RAMP_TICKS = 6;
/**
 * Aiming never takes a rider below this fraction of the round's pace. Self-trail immunity is counted in ticks, so a rider
 * much slower than this is still touching trail they laid after the grace ran out: three Snails are survivable, and
 * pressing the bomb button under them must stay so.
 */
export const AIM_SLOW_FLOOR = 0.125;
export interface AimSlow {
  /** How far into the slowdown the rider is, 0 (full speed) to AIM_SLOW_RAMP_TICKS (slowest). One step per tick. */
  aimSlowTicks: number;
  /** Ticks of the slowdown budget in use, 0 to AIM_SLOW_MAX_TICKS. */
  aimSlowSpentTicks: number;
  bombChargeStartedTick?: number;
}
/** The rider's slowdown once the next tick has moved them: a step toward slow while they aim within budget, a step back otherwise. */
export function nextAimSlow(
  player: AimSlow,
): Pick<AimSlow, "aimSlowTicks" | "aimSlowSpentTicks"> {
  const held = player.bombChargeStartedTick !== undefined;
  const aiming = held && player.aimSlowSpentTicks < AIM_SLOW_MAX_TICKS;
  return {
    aimSlowTicks: Math.max(
      0,
      Math.min(AIM_SLOW_RAMP_TICKS, player.aimSlowTicks + (aiming ? 1 : -1)),
    ),
    aimSlowSpentTicks: Math.max(
      0,
      player.aimSlowSpentTicks + (aiming ? 1 : held ? 0 : -1),
    ),
  };
}
/** Smoothstep from 1 down to AIM_SLOW_SPEED: basic arithmetic only, so every replica agrees to the bit. */
export function aimSlowMultiplier(aimSlowTicks: number): number {
  const t = aimSlowTicks / AIM_SLOW_RAMP_TICKS;
  return 1 - (1 - AIM_SLOW_SPEED) * t * t * (3 - 2 * t);
}
/**
 * How far a rider moves and may turn on `tick`, given their state after the tick before: the round's ramp on both, then
 * the speed pickups and the aiming slowdown on distance alone. The slowdown returned is the one this step moves at, for
 * the simulation to store. A caller looking further ahead than one tick holds the slowdown at that level, which is close
 * enough for a forecast: it is never more than AIM_SLOW_RAMP_TICKS steps from the truth.
 */
export function riderMotionStep(
  player: Readonly<HasEffects> & AimSlow & { grip: boolean },
  tick: number,
  roundStartedTick: number | undefined,
): {
  distance: number;
  turn: number;
  aimSlowTicks: number;
  aimSlowSpentTicks: number;
} {
  const ramp = roundSpeedMultiplier(tick - (roundStartedTick ?? tick));
  const distance = (RIDER_SPEED / TICK_HZ) * ramp;
  const aimSlow = nextAimSlow(player);
  const speed = riderSpeedMultiplier(player, tick);
  return {
    distance:
      distance *
      Math.max(
        speed * aimSlowMultiplier(aimSlow.aimSlowTicks),
        Math.min(speed, AIM_SLOW_FLOOR),
      ),
    turn: (riderTurnRate(player) / TICK_HZ) * ramp,
    ...aimSlow,
  };
}

export const INK_DURATION_TICKS = 60;
