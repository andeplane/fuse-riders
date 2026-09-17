import { hypot2, sin, cos, atan2 } from "./deterministic-math.js";
import {
  RIDER_RADIUS,
  sortedPlayers,
  sortedBombs,
  RIDER_SPEED,
  gravityBend,
  gravityCoreRadius,
  SPEED_RAMP_MAX,
  riderMotionStep,
  riderSpeedMultiplier,
  SELF_TRAIL_GRACE_TICKS,
  TRAIL_WIDTH,
  TICK_HZ,
  OVERTIME_START_TICK,
  OVERTIME_INSET_PER_TICK,
  segmentDistanceSquared,
  type GameState,
  type InputIntent,
  type PlayerState,
} from "./game.js";
import {
  BOMB_MAX_CHARGE_TICKS,
  BOMB_MIN_LAUNCH_DISTANCE,
  BOMB_MAX_LAUNCH_DISTANCE,
} from "./bomb-launch.js";
import { advanceRiderPose } from "./rider-motion.js";
import {
  edgesOpen,
  obstacleBlocksPath,
  obstacleDistanceSquared,
} from "./arena-map.js";
import { wrapCoordinate, wrapDelta, wrapImages } from "./wrap.js";
import { drunkHeadingOffset } from "./drunk.js";
import type { TrailSegment } from "./protocol.js";

export const BOT_ID_PREFIX = "bot:";
export const BOT_LOOKAHEAD_TICKS = 32;
export const BOT_MAX_NEARBY_TRAILS = 512;
/** Ticks a lapse of attention lasts. Keyed off the tick number, so it is replayed, never remembered. */
export const BOT_BLUNDER_WINDOW = 4;

export type BotDifficulty = "easy" | "medium" | "hard";
export const BOT_DIFFICULTIES = ["easy", "medium", "hard"] as const;
/**
 * lookaheadTicks is how far the rider plans, aimError how badly it throws a target bomb, and blunderRate how often it
 * stops steering well for a moment, the way a distracted human does. Every knob must be a pure function of folded
 * state: the controller runs inside the fold on every device, and a rollback replays it without restoring anything it
 * kept for itself, so a remembered decision would replay differently than it was first played and diverge the room.
 */
export interface BotTier {
  lookaheadTicks: number;
  aimError: number;
  blunderRate: number;
}
export const BOT_TIERS: Record<BotDifficulty, BotTier> = {
  easy: { lookaheadTicks: 8, aimError: 260, blunderRate: 0.35 },
  medium: { lookaheadTicks: 16, aimError: 110, blunderRate: 0.1 },
  hard: { lookaheadTicks: BOT_LOOKAHEAD_TICKS, aimError: 0, blunderRate: 0 },
};
const DIFFICULTY_LABELS: Record<BotDifficulty, string> = {
  easy: "Easy",
  medium: "Medium",
  hard: "Hard",
};
/** The log carries nothing per bot but its name, so the tier rides in the name: one writer, one reader, never out of step. */
export function botDisplayName(
  base: string,
  difficulty: BotDifficulty,
): string {
  return `AI ${base} · ${DIFFICULTY_LABELS[difficulty]}`;
}
/** A name with no tier is full strength: the tiers add weaker riders, they never quietly downgrade an existing one. */
export function botDifficulty(name: string): BotDifficulty {
  return (
    BOT_DIFFICULTIES.find((difficulty) =>
      name.endsWith(`· ${DIFFICULTY_LABELS[difficulty]}`),
    ) ?? "hard"
  );
}
export function rollBotDifficulty(roll: number): BotDifficulty {
  return BOT_DIFFICULTIES[
    Math.min(
      BOT_DIFFICULTIES.length - 1,
      Math.floor(Math.max(0, roll) * BOT_DIFFICULTIES.length),
    )
  ]!;
}
export interface BotDependencies {
  random: (seed: number, id: string, tick: number) => number;
}
/** Stateless separate random stream: AI decisions never consume pickup randomness. */
export function botRandom(seed: number, id: string, tick: number): number {
  let hash = (seed ^ tick) >>> 0;
  for (let i = 0; i < id.length; i++)
    hash = Math.imul(hash ^ id.charCodeAt(i), 0x45d9f3b) >>> 0;
  hash = Math.imul(hash ^ (hash >>> 16), 0x45d9f3b) >>> 0;
  return ((hash ^ (hash >>> 16)) >>> 0) / 0x100000000;
}
const NEUTRAL: InputIntent = { left: false, right: false, bomb: false };
const squared = (x: number) => x * x;
function distanceToSegmentSquared(
  x: number,
  y: number,
  segment: TrailSegment,
): number {
  const dx = segment.x2 - segment.x1,
    dy = segment.y2 - segment.y1,
    length = dx * dx + dy * dy;
  const fraction = length
    ? Math.max(
        0,
        Math.min(1, ((x - segment.x1) * dx + (y - segment.y1) * dy) / length),
      )
    : 0;
  return (
    squared(x - segment.x1 - fraction * dx) +
    squared(y - segment.y1 - fraction * dy)
  );
}
function angleDifference(a: number, b: number): number {
  return atan2(sin(a - b), cos(a - b));
}

interface SteeringPlan {
  direction: number;
  turnTicks: number;
}
const TURN_DURATIONS = [2, 4, 8, 12, 16, 24, BOT_LOOKAHEAD_TICKS] as const;
const SAFETY_MARGIN = 2;
const TRAIL_CLEARANCE = RIDER_RADIUS + TRAIL_WIDTH / 2 + SAFETY_MARGIN;

/** Replan every tick, but evaluate short turns followed by straight escape paths. */
function chooseSteering(
  game: Readonly<GameState>,
  player: PlayerState,
  enemies: PlayerState[],
  target: { x: number; y: number } | undefined,
  random: number,
  lookahead: number,
): number {
  // The fastest anyone here could go inside the lookahead: a Snail wearing off, or a rival's stacked Nitros, must not
  // put a trail past the horizon that is about to be reachable. The floor keeps a quarter of slack over base speed.
  let fastest = 1.25;
  for (const rider of [player, ...enemies])
    for (let future = 1; future <= lookahead; future++)
      fastest = Math.max(
        fastest,
        riderSpeedMultiplier(rider, game.tick + future),
      );
  const reach =
    (lookahead * RIDER_SPEED * fastest * SPEED_RAMP_MAX) / TICK_HZ +
    TRAIL_CLEARANCE;
  // Over open edges the board is a torus: a trail just past an edge is as near as one just short of it, a plan that
  // rides off one side carries on from the other, and the walls are not there to be afraid of.
  const open = edgesOpen(game);
  const near = (delta: number, size: number) =>
    open ? wrapDelta(delta, size) : delta;
  const vantage = open
    ? wrapImages(
        game.width,
        game.height,
        player.x - reach,
        player.y - reach,
        player.x + reach,
        player.y + reach,
      )
    : [{ dx: 0, dy: 0 }];
  const trails = sortedPlayers(game)
    .flatMap((owner) =>
      owner.trail.map((trail) => ({
        trail,
        own: owner.id === player.id,
        distance: Math.min(
          ...vantage.map(({ dx, dy }) =>
            distanceToSegmentSquared(player.x + dx, player.y + dy, trail),
          ),
        ),
      })),
    )
    .filter(
      (candidate) =>
        (candidate.trail.detached ||
          candidate.trail.expiresAtTick > game.tick) &&
        candidate.distance < reach * reach,
    )
    .sort((a, b) => a.distance - b.distance)
    .slice(0, BOT_MAX_NEARBY_TRAILS);
  // Assume visible opponents continue straight; never inspect their queued inputs.
  // Their predicted trail remains dangerous after their head has passed a crossing.
  // Holes that close inside the lookahead are planned as if they stayed: a bot expects the curve a moment too long, never too short.
  const fields = game.gravityFields;
  const enemyPaths = enemies
    .filter(
      (enemy) =>
        squared(near(enemy.x - player.x, game.width)) +
          squared(near(enemy.y - player.y, game.height)) <
        squared(reach * 2),
    )
    .map((enemy) => {
      let pose = {
        x: enemy.x,
        y: enemy.y,
        angle: enemy.angle,
        drunkHeadingOffset: enemy.drunkHeadingOffset,
      };
      const path = Array.from({ length: lookahead }, (_, index) => {
        const tick = game.tick + index + 1,
          previous = pose;
        const motion = riderMotionStep(enemy, tick, game.roundStartedTick);
        const next = advanceRiderPose(
          {
            ...previous,
            angle: previous.angle + gravityBend(fields, previous, motion.turn),
          },
          NEUTRAL,
          {
            ...motion,
            drunkHeadingOffset: drunkHeadingOffset(
              game.seed,
              enemy.id,
              tick,
              enemy.drunkStartedTick,
              enemy.drunkUntilTick,
            ),
          },
        );
        // Each predicted step is kept where it ends up on the board, as one unbroken segment.
        const shiftX = open ? wrapCoordinate(next.x, game.width) - next.x : 0,
          shiftY = open ? wrapCoordinate(next.y, game.height) - next.y : 0;
        pose = { ...next, x: next.x + shiftX, y: next.y + shiftY };
        return {
          x1: previous.x + shiftX,
          y1: previous.y + shiftY,
          x2: pose.x,
          y2: pose.y,
          createdTick: tick,
          expiresAtTick: tick + lookahead,
        };
      });
      // A black hole curves a coasting rider too, so its path is only one straight trail on a field without any.
      return {
        path,
        straight:
          enemy.drunkUntilTick <= game.tick &&
          enemy.drunkHeadingOffset === 0 &&
          fields.length === 0,
      };
    });
  const directions = random < 0.5 ? [-1, 1] : [1, -1];
  const plans: SteeringPlan[] = [
    { direction: 0, turnTicks: 0 },
    ...directions.flatMap((direction) =>
      TURN_DURATIONS.filter((turnTicks) => turnTicks <= lookahead).map(
        (turnTicks) => ({ direction, turnTicks }),
      ),
    ),
  ];
  const bombs = sortedBombs(game).filter((bomb) => !bomb.shell?.gun);
  // Scenery is lethal on contact like a trail, and unlike a trail it never expires: only the ones within reach
  // of this plan are worth testing each step.
  const obstacles = game.obstacles.filter(
    (obstacle) =>
      obstacleDistanceSquared(obstacle, player.x, player.y) < reach * reach,
  );
  // The sway ahead is the same whichever way the bot steers, so every plan reads one forecast of it.
  const sway = Array.from({ length: lookahead }, (_, future) =>
    drunkHeadingOffset(
      game.seed,
      player.id,
      game.tick + future + 1,
      player.drunkStartedTick,
      player.drunkUntilTick,
    ),
  );
  let chosen = 0,
    bestSurvived = -1,
    bestScore = -Infinity;
  for (const plan of plans) {
    let pose = {
        x: player.x,
        y: player.y,
        angle: player.angle,
        drunkHeadingOffset: player.drunkHeadingOffset,
      },
      score = 0,
      survived = 0;
    const ownPath: TrailSegment[] = [];
    for (let future = 1; future <= lookahead; future++) {
      const tick = game.tick + future;
      const { distance, turn } = riderMotionStep(
        player,
        tick,
        game.roundStartedTick,
      );
      const next = advanceRiderPose(
        { ...pose, angle: pose.angle + gravityBend(fields, pose, turn) },
        {
          left: plan.direction < 0 && future <= plan.turnTicks,
          right: plan.direction > 0 && future <= plan.turnTicks,
        },
        {
          distance,
          turn,
          drunkHeadingOffset: sway[future - 1]!,
        },
      );
      const shiftX = open ? wrapCoordinate(next.x, game.width) - next.x : 0,
        shiftY = open ? wrapCoordinate(next.y, game.height) - next.y : 0;
      const previous = { x: pose.x + shiftX, y: pose.y + shiftY };
      pose = { ...next, x: next.x + shiftX, y: next.y + shiftY };
      const { x, y } = pose;
      const elapsed = game.tick - (game.roundStartedTick ?? game.tick);
      const inset =
        game.boundaryInset +
        (Math.max(0, elapsed + future - OVERTIME_START_TICK) -
          Math.max(0, elapsed - OVERTIME_START_TICK)) *
          OVERTIME_INSET_PER_TICK;
      // Open edges stay open for as long as this plan looks: the walls only come in with overtime, and then from the
      // very edge, where the inset above already has them.
      let clearance =
        open && inset <= 0
          ? Infinity
          : Math.min(
              x - inset,
              game.width - inset - x,
              y - inset,
              game.height - inset - y,
            ) - RIDER_RADIUS;
      if (clearance < SAFETY_MARGIN) break;
      let trailDistanceSquared = Infinity;
      const hitsTrail = (trail: TrailSegment) => {
        const endpointDistance = distanceToSegmentSquared(x, y, trail);
        trailDistanceSquared = Math.min(trailDistanceSquared, endpointDistance);
        // Only nearby endpoints need the exact swept test. The extra step distance
        // prevents tunnelling past short segments between prediction samples.
        return (
          endpointDistance <= squared(TRAIL_CLEARANCE + distance) &&
          segmentDistanceSquared(
            previous.x,
            previous.y,
            x,
            y,
            trail.x1,
            trail.y1,
            trail.x2,
            trail.y2,
          ) <= squared(TRAIL_CLEARANCE)
        );
      };
      if (
        trails.some(
          ({ trail, own }) =>
            (trail.detached || trail.expiresAtTick > tick) &&
            !(own && trail.createdTick > tick - SELF_TRAIL_GRACE_TICKS) &&
            hitsTrail(trail),
        )
      )
        break;
      if (
        ownPath.some(
          (trail) =>
            trail.createdTick <= tick - SELF_TRAIL_GRACE_TICKS &&
            hitsTrail(trail),
        )
      )
        break;
      if (
        enemyPaths.some(({ path, straight }) => {
          const head = path[future - 1]!;
          if (
            distanceToSegmentSquared(x, y, head) <=
              squared(RIDER_RADIUS * 2 + SAFETY_MARGIN + distance) &&
            segmentDistanceSquared(
              previous.x,
              previous.y,
              x,
              y,
              head.x1,
              head.y1,
              head.x2,
              head.y2,
            ) <= squared(RIDER_RADIUS * 2 + SAFETY_MARGIN)
          )
            return true;
          // Collinear predicted segments form one exact trail, even across a Nitro expiring.
          if (straight)
            return (
              future > 1 &&
              hitsTrail({
                ...head,
                x1: path[0]!.x1,
                y1: path[0]!.y1,
                x2: head.x1,
                y2: head.y1,
              })
            );
          for (let index = 0; index < future - 1; index++)
            if (hitsTrail(path[index]!)) return true;
          return false;
        })
      )
        break;
      if (
        obstacles.some((obstacle) =>
          obstacleBlocksPath(
            obstacle,
            previous.x,
            previous.y,
            x,
            y,
            TRAIL_CLEARANCE,
          ),
        )
      )
        break;
      if (
        fields.some(
          (field) =>
            distanceToSegmentSquared(field.x, field.y, {
              x1: previous.x,
              y1: previous.y,
              x2: x,
              y2: y,
              createdTick: tick,
              expiresAtTick: tick,
            }) < squared(gravityCoreRadius(field.radius) + SAFETY_MARGIN),
        )
      )
        break;
      if (
        game.blasts.some(
          (blast) =>
            blast.expiresAtTick > tick &&
            distanceToSegmentSquared(blast.circle.x, blast.circle.y, {
              x1: previous.x,
              y1: previous.y,
              x2: x,
              y2: y,
              createdTick: tick,
              expiresAtTick: tick,
            }) < squared(blast.circle.radius + RIDER_RADIUS),
        )
      )
        break;
      if (
        bombs.some((bomb) =>
          bomb.shell
            ? segmentDistanceSquared(
                previous.x,
                previous.y,
                x,
                y,
                bomb.x + (bomb.shell.vx * (future - 1)) / TICK_HZ,
                bomb.y + (bomb.shell.vy * (future - 1)) / TICK_HZ,
                bomb.x + (bomb.shell.vx * future) / TICK_HZ,
                bomb.y + (bomb.shell.vy * future) / TICK_HZ,
              ) < squared(RIDER_RADIUS + 18)
            : bomb.explodeAtTick <= tick &&
              hypot2(x - bomb.x, y - bomb.y) < bomb.blastRange + RIDER_RADIUS,
        )
      )
        break;
      clearance = Math.min(
        clearance,
        Math.sqrt(trailDistanceSquared) - RIDER_RADIUS - TRAIL_WIDTH / 2,
      );
      score += Math.min(60, clearance) * 0.05;
      survived++;
      ownPath.push({
        x1: previous.x,
        y1: previous.y,
        x2: x,
        y2: y,
        createdTick: tick,
        expiresAtTick: tick + lookahead,
      });
    }
    if (target && survived === lookahead)
      score -=
        hypot2(
          near(target.x - pose.x, game.width),
          near(target.y - pose.y, game.height),
        ) * 0.025;
    if (plan.direction === 0 && survived === lookahead) score += 1;
    // Survival is lexicographic: a pickup or extra clearance can never buy a
    // shorter predicted life. Among equally safe paths, prefer breathing room.
    if (
      survived > bestSurvived ||
      (survived === bestSurvived && score > bestScore)
    ) {
      bestSurvived = survived;
      bestScore = score;
      chosen = plan.direction;
    }
  }
  return chosen;
}

/** A bounded controller which can only ask the normal simulation to steer/fire. */
export class BotController {
  constructor(private dependencies: BotDependencies = { random: botRandom }) {}
  input(game: Readonly<GameState>, id: string): InputIntent {
    const player = game.players.get(id);
    if (game.phase !== "playing" || !player?.alive || !player.connected)
      return { ...NEUTRAL };
    const enemies = sortedPlayers(game).filter(
      (candidate) => candidate.id !== id && candidate.alive,
    );
    const nearest = enemies.reduce<PlayerState | undefined>(
      (best, candidate) =>
        !best ||
        hypot2(candidate.x - player.x, candidate.y - player.y) <
          hypot2(best.x - player.x, best.y - player.y)
          ? candidate
          : best,
      undefined,
    );
    const pickup = [...game.pickups]
      .sort((a, b) => a.id - b.id)
      .filter((candidate) => candidate.type !== "grip" || !player.grip)
      .reduce<GameState["pickups"][number] | undefined>(
        (best, candidate) =>
          !best ||
          hypot2(candidate.x - player.x, candidate.y - player.y) <
            hypot2(best.x - player.x, best.y - player.y)
            ? candidate
            : best,
        undefined,
      );
    const target = pickup ?? nearest;
    const tier = BOT_TIERS[botDifficulty(player.name)];
    let chosen = chooseSteering(
      game,
      player,
      enemies,
      target,
      this.dependencies.random(game.seed, id, game.tick),
      tier.lookaheadTicks,
    );
    // A lapse holds for a whole window so it costs something, and both draws come from the tick, not from memory.
    if (tier.blunderRate) {
      const window = Math.floor(game.tick / BOT_BLUNDER_WINDOW);
      if (
        this.dependencies.random(game.seed, id + ":lapse", window) <
        tier.blunderRate
      ) {
        const swerve = this.dependencies.random(
          game.seed,
          id + ":swerve",
          window,
        );
        chosen = swerve < 1 / 3 ? 0 : swerve < 2 / 3 ? -1 : 1;
      }
    }
    const intent: InputIntent = {
      left: chosen < 0,
      right: chosen > 0,
      bomb: false,
    };
    if (!nearest || game.tick < player.bombReadyAtTick) return intent;
    // Thrown across an open edge when that is the short way to the target.
    const open = edgesOpen(game);
    const towardX = open
        ? wrapDelta(nearest.x - player.x, game.width)
        : nearest.x - player.x,
      towardY = open
        ? wrapDelta(nearest.y - player.y, game.height)
        : nearest.y - player.y;
    const distance = hypot2(towardX, towardY);
    const bearing = atan2(towardY, towardX);
    const aimed =
      player.targetBombArmed && !player.gunArmed && !player.shellArmed;
    // One fixed miss per shot: the cooldown stamp is stable while charging, so a weak rider commits to its bad aim.
    const scatter = (axis: string) =>
      (Math.max(
        0,
        Math.min(
          1,
          this.dependencies.random(
            game.seed,
            id + axis,
            player.bombReadyAtTick,
          ),
        ),
      ) *
        2 -
        1) *
      tier.aimError;
    const aim = aimed
      ? {
          x: Math.max(
            0,
            Math.min(1, (nearest.x + scatter(":aimX")) / game.width),
          ),
          y: Math.max(
            0,
            Math.min(1, (nearest.y + scatter(":aimY")) / game.height),
          ),
        }
      : undefined;
    const maxChargeTicks =
      game.settings?.bombChargeTicks ?? BOMB_MAX_CHARGE_TICKS;
    const wantedCharge =
      aimed || player.gunArmed || player.shellArmed
        ? 1
        : Math.max(
            1,
            Math.min(
              maxChargeTicks,
              Math.round(
                ((distance - BOMB_MIN_LAUNCH_DISTANCE) /
                  (BOMB_MAX_LAUNCH_DISTANCE - BOMB_MIN_LAUNCH_DISTANCE)) *
                  maxChargeTicks,
              ),
            ),
          );
    if (player.bombChargeStartedTick !== undefined) {
      const release = game.tick - player.bombChargeStartedTick >= wantedCharge;
      return {
        ...intent,
        bomb: !release,
        ...(aim ? { aim } : {}),
        ...(release
          ? { bombCommands: [{ action: "release", ...(aim ? { aim } : {}) }] }
          : {}),
      };
    }
    if (
      aimed ||
      (distance < 500 && Math.abs(angleDifference(bearing, player.angle)) < 0.6)
    ) {
      return {
        ...intent,
        bomb: true,
        ...(aim ? { aim } : {}),
        bombCommands: [{ action: "press", ...(aim ? { aim } : {}) }],
      };
    }
    return intent;
  }
}
