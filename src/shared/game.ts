import { hypot2, sin, cos, atan2 } from "./deterministic-math.js";
import {
  EPSILON,
  firstContactTime,
  normalizeAngle,
  pointSegmentDistanceSquared,
  segmentDistanceSquared,
  square,
} from "./geometry.js";
export { segmentDistanceSquared } from "./geometry.js";
import { hashSeed, nextRandom, normalizeSeed } from "./rng.js";
import { type PickupType } from "./pickup-types.js";
export { PICKUP_TYPES, type PickupType } from "./pickup-types.js";
import {
  POWER_TUNING,
  MAX_POWER_PICKUPS,
  pickupPacing,
  powerBlastRadius,
  powerReloadTicks,
  powerTrailLifetimeTicks,
} from "./power-progression.js";
export { pickupPacing } from "./power-progression.js";
import { advanceRiderPose } from "./rider-motion.js";
import { roomPickup, type RoomSettings } from "./room-settings.js";
import {
  cutTrailHole,
  GUN_RADIUS,
  GUN_HOLE_RADIUS,
  GUN_HEADSHOT_RADIUS,
  GUN_TRACER_TICKS,
} from "./gun.js";
import {
  advanceShell,
  SHELL_SPEED,
  SHELL_RADIUS,
  type ShellPoint,
  type ShellTrail,
} from "./shell.js";
import { DEFAULT_AVATAR } from "./avatars.js";
import {
  advanceTrail,
  boundTrail,
  cutTrail,
  detachTrail,
} from "./trail-lifecycle.js";
import { clipTrailSegment } from "./trail-clipping.js";
import { pickupTypeForRoll } from "./pickup-weights.js";
import { segmentIntersectsDisk } from "./blast-geometry.js";
import {
  createPortalPair,
  findPortalTransit,
  fitPortalPair,
  MAX_PORTAL_PAIRS,
  PORTAL_WALL_HALF_WIDTH,
  type PortalPair,
  type PortalPoint,
  type PortalTransit,
} from "./portal.js";
import {
  chooseArenaMap,
  edgesOpen,
  initialBoundaryInset,
  generateObstacles,
  obstacleDistanceSquared,
  obstacleEdges,
  obstacleHitbox,
  hitboxBlocksPath,
  hitboxBounceNormal,
  obstacleInsideBounds,
  obstacleTouchesCircle,
  segmentObstacleDistanceSquared,
  OBSTACLE_WALL_MARGIN,
  type ArenaMapId,
  type ClearCapsule,
  type Obstacle,
  type ObstacleHitbox,
} from "./arena-map.js";
import {
  NO_WRAP,
  splitWrappedSegment,
  wrapCoordinate,
  wrapDelta,
  wrapImages,
  type WrapOffset,
} from "./wrap.js";
import {
  applyRoundScores,
  rankRound,
  sortedLeaderboard,
  type RoundParticipant,
  type RoundPlacement,
  type SessionLeaderboardEntry,
} from "./leaderboard.js";
import {
  beginMatchParticipant,
  compareMatchScores,
  finalizeMatchStatsRound,
  recordBombExploded,
  recordBombPlaced,
  recordDeath,
  recordEarlyExit,
  recordPickup,
  recordPortalTransit,
  recordSurvivalTick,
  snapshotMatchStats,
  type MatchStatsState,
} from "./match-stats.js";
import {
  decideRound,
  recordShot,
  recordShotKill,
  type DecidedRound,
  type RoundShot,
  type Weapon,
} from "./shot-log.js";
import { DRUNK_DURATION_TICKS, drunkHeadingOffset } from "./drunk.js";
import {
  BOMB_FLIGHT_TICKS,
  BOMB_MAX_CHARGE_TICKS,
  bombLandingPoint,
  bombLaunchDistance,
} from "./bomb-launch.js";
import {
  MAX_EXTRA_BOMBS,
  bombsPerShot,
  createVolleyFlightPaths,
  volleyAngles,
  type LaunchBounds,
} from "./launch-modifiers.js";
import {
  detectMoments,
  roundHasMoment,
  DODGE_LOOKBACK_TICKS,
  REPLAY_PAUSE_TICKS,
  type Moment,
  type TickObservations,
} from "./moments.js";

import {
  createTickContext,
  type Movement,
  type NewBlast,
} from "./sim/context.js";
import { PHASES, runPhases } from "./sim/pipeline.js";
export * from "./state.js";
export { toSnapshot } from "./view.js";
export * from "./tuning.js";
import {
  ARENA_HEIGHT,
  ARENA_WIDTH,
  BLAST_VISIBLE_TICKS,
  BOMB_COOLDOWN_TICKS,
  COUNTDOWN_TICKS,
  GRAVITY_BEND,
  GRAVITY_CORE_SPAWN_CLEARANCE,
  GRAVITY_FIELD_TICKS,
  GRAVITY_MAX_HOLES_PER_PICKUP,
  GRAVITY_MAX_RADIUS,
  GRAVITY_MIN_RADIUS,
  INITIAL_BOUNDARY_INSET,
  INK_DURATION_TICKS,
  MATCH_WINNER_TICKS,
  MAX_GRAVITY_FIELDS,
  MAX_PLAYERS,
  MAX_SPEED_EFFECT_STACK,
  MIN_PLAYERS,
  NITRO_DURATION_TICKS,
  OVERTIME_INSET_PER_TICK,
  OVERTIME_START_TICK,
  PICKUP_DESTRUCTION_RADIUS_RATIO,
  PICKUP_OBSTACLE_CLEARANCE,
  PICKUP_RADIUS,
  PICKUP_RIDER_BOMB_CLEARANCE,
  PICKUP_SEPARATION,
  PICKUP_SPAWN_ATTEMPTS,
  PICKUP_SPAWN_MARGIN,
  PICKUP_TRAIL_CLEARANCE,
  PROJECTILE_OWNER_GRACE_TICKS,
  RIDER_CONTACT_RADIUS,
  RIDER_OBSTACLE_RADIUS,
  RIDER_RADIUS,
  ROUND_DRAW_TICK,
  ROUND_OVER_TICKS,
  SELF_TRAIL_GRACE_TICKS,
  SHIELD_GRACE_TICKS,
  SNAIL_DURATION_TICKS,
  SPAWN_CORRIDOR_LENGTH,
  SPAWN_CORRIDOR_RADIUS,
  STAR_DURATION_TICKS,
  TICK_HZ,
  TRAIL_WIDTH,
  bombFuseTicks,
  gravityCoreRadius,
  riderMotionStep,
} from "./tuning.js";
import {
  type BlastState,
  type BombState,
  type EliminationCause,
  type GamePhase,
  type GameState,
  type GravityField,
  type InputIntent,
  type PlayerIdentity,
  type PlayerState,
  sortedBombs,
  sortedObstacles,
  sortedPlayers,
} from "./state.js";
import {
  type AimPoint,
  type BlastCircle,
  type BombActionCommand,
  type FlightPoint,
  type GameEvent,
  type GameSnapshot,
  type PlayerId,
  type TrailSegment,
} from "./state.js";
import { toSnapshot } from "./view.js";
import {
  layTrail,
  movementImages,
  nearestDelta,
  portalBounds,
  wallReach,
} from "./sim/field.js";

export interface TickResult {
  snapshot: GameSnapshot;
  events: GameEvent[];
}

const CAUSE_PRIORITY: Record<EliminationCause, number> = {
  rider: 0,
  trail: 1,
  wall: 2,
  explosion: 3,
};

export function createGame(
  matchId: string,
  seed = hashSeed(matchId),
): GameState {
  if (!matchId) throw new Error("matchId is required");
  return {
    matchId,
    round: 1,
    tick: 0,
    phase: "lobby",
    width: ARENA_WIDTH,
    height: ARENA_HEIGHT,
    boundaryInset: INITIAL_BOUNDARY_INSET,
    map: "classic",
    obstacles: [],
    players: new Map(),
    bombs: new Map(),
    blasts: [],
    pickups: [],
    portalPairs: [],
    gravityFields: [],
    nextTrailPieceId: 1,
    nextBombId: 1,
    nextPickupId: 1,
    nextPickupSpawnTick: 0,
    seed: normalizeSeed(seed),
    randomState: normalizeSeed(seed),
    leaderboard: new Map(),
    roundParticipants: new Map(),
    roundPlacements: [],
    roundScored: false,
    matchStats: new Map(),
    matchFinishers: [],
    moments: [],
    shots: [],
  };
}

export function addPlayer(state: GameState, identity: PlayerIdentity): void {
  if (state.players.size >= MAX_PLAYERS) throw new Error("game is full");
  if (state.players.has(identity.id))
    throw new Error(`duplicate player id: ${identity.id}`);
  if (
    !Number.isInteger(identity.slot) ||
    identity.slot < 0 ||
    identity.slot >= MAX_PLAYERS
  ) {
    throw new Error(`invalid slot: ${identity.slot}`);
  }
  for (const player of sortedPlayers(state)) {
    if (player.slot === identity.slot)
      throw new Error(`slot is occupied: ${identity.slot}`);
  }
  state.players.set(identity.id, {
    ...identity,
    connected: identity.connected ?? true,
    avatarId: identity.avatarId ?? DEFAULT_AVATAR,
    x: state.width / 2,
    y: state.height / 2,
    angle: 0,
    alive: false,
    roundWins: 0,
    bombReadyAtTick: 0,
    aimSlowTicks: 0,
    aimSlowSpentTicks: 0,
    extraBombs: 0,
    fuseLevel: 0,
    powerPickups: 0,
    reloadDurationTicks: BOMB_COOLDOWN_TICKS,
    invulnerableUntilTick: 0,
    nitroUntilTicks: [],
    snailUntilTicks: [],
    grip: false,
    drunkUntilTick: 0,
    inkUntilTick: 0,
    targetBombArmed: false,
    tripleShotArmed: false,
    fiveShotArmed: false,
    drunkStartedTick: 0,
    drunkHeadingOffset: 0,

    shielded: false,
    shieldGraceUntilTick: 0,
    portalCooldownUntilTick: 0,
    portalGraceUntilTick: 0,
    trail: [],
  });
  const historical = state.leaderboard.get(identity.id);
  if (historical) historical.name = identity.name;
  else
    state.leaderboard.set(identity.id, {
      id: identity.id,
      name: identity.name,
      totalScoreUnits: 0,
      roundsPlayed: 0,
      roundWins: 0,
      matchWins: 0,
    });
}

export function removePlayer(state: GameState, playerId: PlayerId): void {
  assertPhase(state, ["lobby", "roundOver", "matchOver"], "removePlayer");
  state.players.delete(playerId);
}

export function setPlayerConnected(
  state: GameState,
  playerId: PlayerId,
  connected: boolean,
): void {
  requirePlayer(state, playerId).connected = connected;
}

export function eliminatePlayer(state: GameState, playerId: PlayerId): void {
  const player = requirePlayer(state, playerId);
  if (state.phase !== "countdown" && state.phase !== "playing") return;
  if (!player.alive) return;
  player.alive = false;
  player.bombChargeStartedTick = undefined;
  player.bombTarget = undefined;
  recordElimination(state, playerId);
  if (state.roundParticipants.has(playerId))
    recordEarlyExit(state.matchStats, playerId);
}

export function startMatch(state: GameState): void {
  assertPhase(state, ["lobby"], "startMatch");
  requireEnoughPlayers(state);
  state.round = 1;
  for (const player of sortedPlayers(state)) player.roundWins = 0;
  prepareRound(state);
}

export function startNextRound(state: GameState): void {
  assertPhase(state, ["roundOver"], "startNextRound");
  if (
    state.phaseEndsAtTick !== undefined &&
    state.tick < state.phaseEndsAtTick
  ) {
    throw new Error("round-over presentation has not finished");
  }
  requireEnoughPlayers(state);
  state.round += 1;
  prepareRound(state);
}

/** Aborts unfinished play without scoring and retains the party's session totals. */
export function returnToLobby(state: GameState, newMatchId: string): void {
  const fresh = createGame(newMatchId);
  fresh.leaderboard = state.leaderboard;
  fresh.settings = state.settings;
  for (const player of sortedPlayers(state)) {
    if (player.connected)
      addPlayer(fresh, {
        id: player.id,
        name: player.name,
        avatarId: player.avatarId,
        slot: player.slot,
        color: player.color,
        connected: true,
      });
  }
  Object.assign(state, fresh, {
    phaseEndsAtTick: undefined,
    roundStartedTick: undefined,
    portalPairs: [],
    gravityFields: [],
    roundWinnerId: undefined,
    matchWinnerId: undefined,
    // Kept like the leaderboard: a host can leave the recap for the lobby before every device has reported it.
    decidedRound: state.decidedRound,
  });
}

export function resetMatch(state: GameState, newMatchId: string): void {
  assertPhase(state, ["matchOver"], "resetMatch");
  if (!newMatchId) throw new Error("newMatchId is required");
  requireEnoughPlayers(state);
  state.matchId = newMatchId;
  state.seed = hashSeed(newMatchId);
  state.randomState = state.seed;
  state.matchStats = new Map();
  state.matchFinishers = [];
  state.moments = [];
  state.round = 1;
  for (const player of sortedPlayers(state)) player.roundWins = 0;
  prepareRound(state);
}

export function step(
  state: GameState,
  inputs: ReadonlyMap<PlayerId, InputIntent>,
): TickResult {
  const ctx = createTickContext(state, inputs);
  const { events } = ctx;
  // Migration scaffold: the phases lifted out so far run from PHASES; the rest of the tick is still inline below.
  runPhases(ctx, PHASES);
  if (state.phase !== "playing") return { snapshot: toSnapshot(state), events };
  const { pickupSchedule } = ctx;

  const { elapsed, open, trailBounds } = ctx;

  const { movements } = ctx;
  for (const player of sortedPlayers(state))
    expireSpeedEffects(player, state.tick);
  for (const player of sortedPlayers(state).filter(
    (candidate) => candidate.alive,
  )) {
    const input = inputs.get(player.id) ?? NEUTRAL_INPUT;
    const offset = drunkHeadingOffset(
      state.seed,
      player.id,
      state.tick,
      player.drunkStartedTick,
      player.drunkUntilTick,
    );
    const { distance, turn, aimSlowTicks, aimSlowSpentTicks } = riderMotionStep(
      player,
      state.tick,
      state.roundStartedTick,
    );
    player.aimSlowTicks = aimSlowTicks;
    player.aimSlowSpentTicks = aimSlowSpentTicks;
    // Curved space turns the rider before the kernel does, so steering and the hole add up inside one ordinary turn-then-move step.
    const pose = advanceRiderPose(
      {
        ...player,
        angle: player.angle + gravityBend(state.gravityFields, player, turn),
      },
      input,
      { distance, turn, drunkHeadingOffset: offset },
    );
    player.drunkHeadingOffset = pose.drunkHeadingOffset;
    movements.set(player.id, {
      player,
      oldX: player.x,
      oldY: player.y,
      x: pose.x,
      y: pose.y,
      angle: pose.angle,
    });
  }

  collectPickups(state, movements, events);

  const { bounced } = ctx;
  for (const movement of movements.values()) {
    if (
      isHazardImmune(movement.player, state.tick) &&
      reflectAtBoundary(state, movement)
    ) {
      bounced.add(movement.player.id);
    }
  }

  // One run per portal hop. The gap between runs is travel the shell never made, so the sweep below
  // must not read across it: a rider standing between two gates is not in the way of a teleport.
  const { shellPaths } = ctx;
  for (const bomb of sortedBombs(state)) {
    if (!bomb.shell) continue;
    // Gun damage was resolved on press; these are stationary, harmless tracers.
    if (bomb.shell.gun) {
      if (state.tick >= bomb.explodeAtTick) state.bombs.delete(bomb.id);
      continue;
    }
    // Open edges have nothing to bounce off: the bounds sit a whole board away, further than any tick can reach.
    const shellBounds = open
      ? {
          left: -state.width,
          right: 2 * state.width,
          top: -state.height,
          bottom: 2 * state.height,
        }
      : {
          left: state.boundaryInset + SHELL_RADIUS,
          right: state.width - state.boundaryInset - SHELL_RADIUS,
          top: state.boundaryInset + SHELL_RADIUS,
          bottom: state.height - state.boundaryInset - SHELL_RADIUS,
        };
    // Scenery reflects a shell exactly as a trail does; it is the one surface a shell meets that it cannot cut.
    // An edge reflects from either side, so a shell fired by an immune rider from inside an obstacle would rattle
    // between its walls for ever. The obstacle a shell is inside of lets it out, as it lets the rider out.
    const obstacleWalls = sortedObstacles(state)
      .filter(
        (obstacle) => obstacleDistanceSquared(obstacle, bomb.x, bomb.y) > 0,
      )
      .flatMap(obstacleEdges);
    const solid: ShellTrail[] = [
      ...obstacleWalls,
      ...sortedPlayers(state).flatMap((player) =>
        player.id === bomb.ownerId &&
        state.tick - bomb.launchedTick < PROJECTILE_OWNER_GRACE_TICKS
          ? []
          : player.trail,
      ),
    ];
    // A shell about to cross an edge also meets what stands just beyond it, which the state holds on the far side.
    const shellReach = SHELL_SPEED / TICK_HZ + SHELL_RADIUS + TRAIL_WIDTH / 2;
    const trails = open
      ? wrapImages(
          state.width,
          state.height,
          bomb.x - shellReach,
          bomb.y - shellReach,
          bomb.x + shellReach,
          bomb.y + shellReach,
        ).flatMap(({ dx, dy }) =>
          dx === 0 && dy === 0
            ? solid
            : solid.map((trail) => ({
                x1: trail.x1 - dx,
                y1: trail.y1 - dy,
                x2: trail.x2 - dx,
                y2: trail.y2 - dy,
              })),
        )
      : solid;
    const motion = {
      x: bomb.x,
      y: bomb.y,
      vx: bomb.shell.vx,
      vy: bomb.shell.vy,
      bounces: bomb.shell.bounces ?? 0,
    };
    // A bounce can fall on either side of a gate within one tick, so the tick is integrated twice
    // rather than rewound: this throwaway pass only says whether, and when, a gate is met.
    const provisional = advanceShell(
      { ...motion },
      shellBounds,
      trails,
      TRAIL_WIDTH,
    );
    const entry = findShellPortalEntry(state, bomb, provisional);
    if (entry) {
      const approach = advanceShell(
        motion,
        shellBounds,
        trails,
        TRAIL_WIDTH,
        0,
        entry.time,
      );
      motion.x = entry.transit.exitPoint.x;
      motion.y = entry.transit.exitPoint.y;
      shellPaths.set(bomb.id, [
        approach,
        advanceShell(motion, shellBounds, trails, TRAIL_WIDTH, entry.time),
      ]);
      bomb.portalCooldownUntilTick = entry.transit.cooldownUntilTick;
    } else {
      shellPaths.set(bomb.id, [
        advanceShell(motion, shellBounds, trails, TRAIL_WIDTH),
      ]);
    }
    // The swept path above stays unwrapped for this tick's hit test; only the resting place is folded back.
    bomb.x = open ? wrapCoordinate(motion.x, state.width) : motion.x;
    bomb.y = open ? wrapCoordinate(motion.y, state.height) : motion.y;
    bomb.shell = {
      vx: motion.vx,
      vy: motion.vy,
      ...(motion.bounces ? { bounces: motion.bounces } : {}),
    };
  }
  const newBlasts = (ctx.fuseBlasts = resolveExplosions(state, events));

  // Highlight observations (ADR 043): what the sweep learns about each death, and where every rider was before a blast.
  const { observations, landingHits, shellHits, trailHits } = ctx;
  /** Where each rider stood DODGE_LOOKBACK_TICKS ago, read from its own trail before this tick's blasts burn that segment away. */
  const captureOrigins = (): void => {
    if (ctx.origins) return;
    const origins = (ctx.origins = new Map());
    for (const player of sortedPlayers(state)) {
      const segment = player.trail.find(
        (candidate) =>
          candidate.createdTick === state.tick - DODGE_LOOKBACK_TICKS,
      );
      if (segment) origins.set(player.id, { x: segment.x2, y: segment.y2 });
    }
  };

  const { causes, causeOwners, shotSources } = ctx;
  const markShot = (
    victimId: PlayerId,
    bombId: number,
    shot?: number,
  ): void => {
    if (shot === undefined) return;
    const known = shotSources.get(victimId);
    if (!known || bombId < known.bombId)
      shotSources.set(victimId, { bombId, shot });
  };
  const {
    trailContactTimes,
    riderContactTimes,
    obstacleContactTimes,
    obstaclesReached,
  } = ctx;
  // Id order: each contact bisection starts from the one before it, and the last to shorten it is what a shield
  // turns away from, so the order obstacles are visited in is part of the outcome.
  const obstacleHitboxes = sortedObstacles(state).map(obstacleHitbox);
  // Bombs only hit on landing; shells sweep their path to avoid tunnelling.
  for (const bomb of sortedBombs(state)) {
    if (
      bomb.shell?.gun ||
      bomb.launchedTick >= state.tick ||
      (!bomb.shell && bomb.landsAtTick < state.tick)
    )
      continue;
    if (!bomb.shell) {
      if (bomb.landsAtTick !== state.tick) continue;
      for (const movement of movements.values()) {
        if (
          movement.player.id === bomb.ownerId ||
          isHazardImmune(movement.player, state.tick)
        )
          continue;
        if (
          square(nearestDelta(open, movement.x - bomb.x, state.width)) +
            square(nearestDelta(open, movement.y - bomb.y, state.height)) <=
          square(RIDER_RADIUS + SHELL_RADIUS)
        ) {
          markCause(
            causes,
            causeOwners,
            movement.player.id,
            "explosion",
            bomb.ownerId,
          );
          markShot(movement.player.id, bomb.id, bomb.shot);
          if (!landingHits.has(movement.player.id))
            landingHits.set(movement.player.id, bomb.ownerId);
        }
      }
      continue;
    }
    let hit: Movement | undefined;
    let hitTime = Infinity;
    for (const path of shellPaths.get(bomb.id) ?? [])
      for (let i = 1; i < path.length; i++) {
        const start = path[i - 1]!;
        const end = path[i]!;
        for (const movement of movements.values()) {
          if (
            (movement.player.id === bomb.ownerId &&
              state.tick - bomb.launchedTick < PROJECTILE_OWNER_GRACE_TICKS) ||
            isHazardImmune(movement.player, state.tick)
          )
            continue;
          const mx = movement.x - movement.oldX;
          const my = movement.y - movement.oldY;
          const px =
            nearestDelta(open, start.x - movement.oldX, state.width) -
            mx * start.t;
          const py =
            nearestDelta(open, start.y - movement.oldY, state.height) -
            my * start.t;
          const vx = end.x - start.x - mx * (end.t - start.t);
          const vy = end.y - start.y - my * (end.t - start.t);
          const radius = RIDER_RADIUS + SHELL_RADIUS;
          const c = px * px + py * py - radius * radius;
          const a = vx * vx + vy * vy;
          const b = 2 * (px * vx + py * vy);
          const discriminant = b * b - 4 * a * c;
          const contact =
            c <= 0
              ? 0
              : a > 0 && discriminant >= 0
                ? (-b - Math.sqrt(discriminant)) / (2 * a)
                : Infinity;
          const time = start.t + contact * (end.t - start.t);
          if (contact >= 0 && contact <= 1 && time < hitTime) {
            hit = movement;
            hitTime = time;
          }
        }
      }
    if (hit) {
      markCause(causes, causeOwners, hit.player.id, "explosion", bomb.ownerId);
      markShot(hit.player.id, bomb.id, bomb.shot);
      if (!shellHits.has(hit.player.id))
        shellHits.set(hit.player.id, {
          ownerId: bomb.ownerId,
          bounces: bomb.shell?.bounces ?? 0,
          age: state.tick - bomb.launchedTick,
        });
      state.bombs.delete(bomb.id);
    }
  }

  if (newBlasts.length > 0) {
    captureOrigins();
    for (const player of sortedPlayers(state)) {
      player.trail = cutTrail(
        player.trail,
        state.tick,
        (segment) =>
          newBlasts.some((blast) =>
            segmentIntersectsDisk(
              segment.x1,
              segment.y1,
              segment.x2,
              segment.y2,
              blast.circle,
              TRAIL_WIDTH / 2,
            ),
          )
            ? []
            : [segment],
        () => state.nextTrailPieceId++,
      );
    }
  }

  for (const movement of movements.values()) {
    // A rider overhanging an open edge, or whose step ends past it, is also in reach of a blast on the far side.
    for (const blast of newBlasts) {
      if (
        !isHazardImmune(movement.player, state.tick) &&
        (open ? movementImages(state, movement, RIDER_RADIUS) : NO_WRAP).some(
          ({ dx, dy }) =>
            segmentIntersectsDisk(
              movement.oldX + dx,
              movement.oldY + dy,
              movement.x + dx,
              movement.y + dy,
              blast.circle,
              RIDER_RADIUS,
            ),
        )
      ) {
        markCause(
          causes,
          causeOwners,
          movement.player.id,
          "explosion",
          blast.ownerId,
        );
        markShot(movement.player.id, blast.bombId, blast.shot);
      }
    }

    const reach = wallReach(state);
    const left = state.boundaryInset + reach;
    const right = state.width - state.boundaryInset - reach;
    const top = state.boundaryInset + reach;
    const bottom = state.height - state.boundaryInset - reach;
    if (
      !open &&
      !isHazardImmune(movement.player, state.tick) &&
      (movement.x < left ||
        movement.x > right ||
        movement.y < top ||
        movement.y > bottom)
    ) {
      markCause(causes, causeOwners, movement.player.id, "wall");
    }
    // Falling into a black hole's core is the arena's kill, like the wall: nobody owns it.
    if (
      !isHazardImmune(movement.player, state.tick) &&
      state.gravityFields.some((field) =>
        segmentIntersectsDisk(
          movement.oldX,
          movement.oldY,
          movement.x,
          movement.y,
          { x: field.x, y: field.y, radius: gravityCoreRadius(field.radius) },
        ),
      )
    ) {
      markCause(causes, causeOwners, movement.player.id, "wall");
    }

    // Obstacles are solid the way the boundary is, and kill under the same cause. A hazard-immune rider passes
    // through untouched rather than bouncing: there is a far side to arrive at, unlike the arena wall.
    // Only the contact time is recorded here; the cause is decided below, once the trail and rider contacts of
    // this tick are known and can be compared against it.
    for (const obstacle of obstacleHitboxes) {
      if (isHazardImmune(movement.player, state.tick)) break;
      const touches = (time: number): boolean =>
        hitboxBlocksPath(
          obstacle,
          movement.oldX,
          movement.oldY,
          movement.oldX + (movement.x - movement.oldX) * time,
          movement.oldY + (movement.y - movement.oldY) * time,
          RIDER_OBSTACLE_RADIUS,
        );
      const previous = obstacleContactTimes.get(movement.player.id) ?? 1;
      // Only immunity — a Star, shield grace, portal grace — can carry a rider into scenery, and it can lapse in
      // there. A rider that starts its step already overlapping an obstacle is let out of that one rather than
      // killed on the spot by a rock it had every right to be inside; any other obstacle is as solid as ever.
      if (!touches(previous) || touches(0)) continue;
      obstacleContactTimes.set(
        movement.player.id,
        firstContactTime(touches, previous),
      );
      obstaclesReached.set(movement.player.id, obstacle);
    }

    // A step that reaches past an open edge is also tested from the far side, where the trails it is about to meet are.
    const images = open
      ? movementImages(state, movement, RIDER_CONTACT_RADIUS + TRAIL_WIDTH / 2)
      : NO_WRAP;
    for (const owner of sortedPlayers(state)) {
      if (isHazardImmune(movement.player, state.tick)) break;
      for (const trail of owner.trail) {
        if (
          owner.id === movement.player.id &&
          trail.createdTick > state.tick - SELF_TRAIL_GRACE_TICKS
        )
          continue;
        for (const { dx, dy } of images) {
          const fromX = movement.oldX + dx,
            fromY = movement.oldY + dy,
            toX = movement.x + dx,
            toY = movement.y + dy;
          if (
            segmentDistanceSquared(
              fromX,
              fromY,
              toX,
              toY,
              trail.x1,
              trail.y1,
              trail.x2,
              trail.y2,
            ) >
            square(RIDER_CONTACT_RADIUS + TRAIL_WIDTH / 2) + EPSILON
          )
            continue;
          markCause(causes, causeOwners, movement.player.id, "trail", owner.id);
          const previous = trailContactTimes.get(movement.player.id) ?? 1;
          const time = firstContactTime(
            (time) =>
              segmentDistanceSquared(
                fromX,
                fromY,
                fromX + (toX - fromX) * time,
                fromY + (toY - fromY) * time,
                trail.x1,
                trail.y1,
                trail.x2,
                trail.y2,
              ) <=
              square(RIDER_CONTACT_RADIUS + TRAIL_WIDTH / 2) + EPSILON,
            previous,
          );
          trailContactTimes.set(movement.player.id, time);
          if (!trailHits.has(movement.player.id))
            trailHits.set(movement.player.id, {
              ownerId: owner.id,
              age: state.tick - trail.createdTick,
            });
        }
      }
    }
  }

  const movementList = [...movements.values()];
  for (let first = 0; first < movementList.length; first += 1) {
    for (let second = first + 1; second < movementList.length; second += 1) {
      const a = movementList[first]!;
      const b = movementList[second]!;
      // Sweep the relative position: both endpoints use the same instant in the tick.
      // Comparing the two paths directly also compares positions reached at different
      // times, killing riders that safely follow or pass behind one another (#186).
      // Across an open edge two riders are as close as the short way round says they are.
      const apartX = nearestDelta(open, a.oldX - b.oldX, state.width),
        apartY = nearestDelta(open, a.oldY - b.oldY, state.height);
      const closingX = a.x - a.oldX - (b.x - b.oldX),
        closingY = a.y - a.oldY - (b.y - b.oldY);
      if (
        pointSegmentDistanceSquared(
          0,
          0,
          apartX,
          apartY,
          apartX + closingX,
          apartY + closingY,
        ) <=
        square(2 * RIDER_CONTACT_RADIUS) + EPSILON
      ) {
        // Portal grace is defensive: neither rider is harmed by this contact.
        if (
          a.player.portalGraceUntilTick > state.tick ||
          b.player.portalGraceUntilTick > state.tick
        )
          continue;
        const aInvulnerable = isHazardImmune(a.player, state.tick);
        const bInvulnerable = isHazardImmune(b.player, state.tick);
        const time = firstContactTime(
          (time) =>
            pointSegmentDistanceSquared(
              0,
              0,
              apartX,
              apartY,
              apartX + closingX * time,
              apartY + closingY * time,
            ) <=
            square(2 * RIDER_CONTACT_RADIUS) + EPSILON,
        );
        if (!aInvulnerable)
          riderContactTimes.set(
            a.player.id,
            Math.min(riderContactTimes.get(a.player.id) ?? 1, time),
          );
        if (!bInvulnerable)
          riderContactTimes.set(
            b.player.id,
            Math.min(riderContactTimes.get(b.player.id) ?? 1, time),
          );
        if (!aInvulnerable)
          markCause(causes, causeOwners, a.player.id, "rider", b.player.id);
        if (!bInvulnerable)
          markCause(causes, causeOwners, b.player.id, "rider", a.player.id);
      }
    }
  }

  /**
   * Scenery kills under `wall`, which outranks `trail` and `rider`. Unlike the boundary, which a rider can only
   * reach at the end of its step, an obstacle can be met anywhere along it — so a rock a rider would have reached
   * later in the tick must not take a kill away from the trail or the rider that actually stopped it first.
   * A rider already dead by explosion still keeps its contact, which is what the shield below bounces off.
   */
  // What the shield below bounces off: every scenery contact of the tick, whichever cause ends up winning it.
  const sceneryReached = (ctx.sceneryReached = new Map(obstacleContactTimes));
  for (const movement of movementList) {
    const contact = obstacleContactTimes.get(movement.player.id);
    if (contact === undefined) continue;
    // No trail or rider contact is no contact at all, not one at the end of the step: a rock met exactly there still counts.
    const reachedFirst = Math.min(
      trailContactTimes.get(movement.player.id) ?? Infinity,
      riderContactTimes.get(movement.player.id) ?? Infinity,
    );
    if (reachedFirst <= contact) {
      obstacleContactTimes.delete(movement.player.id);
      continue;
    }
    markCause(causes, causeOwners, movement.player.id, "wall");
  }

  for (const movement of movementList) {
    if (!causes.has(movement.player.id) || !movement.player.shielded) continue;
    movement.player.shielded = false;
    movement.player.shieldGraceUntilTick = state.tick + SHIELD_GRACE_TICKS;
    // Whatever the winning cause was, a rider that reached scenery this tick is standing against it: an absorbed
    // blast must not leave it inside the rock, riding out its grace ticks in there.
    const obstacleTime = sceneryReached.get(movement.player.id);
    const obstacleHit = obstaclesReached.get(movement.player.id);
    if (
      obstacleTime !== undefined &&
      obstacleHit &&
      reflectAtObstacle(obstacleHit, movement, obstacleTime)
    )
      bounced.add(movement.player.id);
    if (reflectAtBoundary(state, movement)) bounced.add(movement.player.id);
    causes.delete(movement.player.id);
    causeOwners.delete(movement.player.id);
    // Together with the cause, or an absorbed hit would still be holding a shot for any later mark to credit.
    shotSources.delete(movement.player.id);
  }

  const { transits } = ctx;
  for (const movement of movementList) {
    if (causes.has(movement.player.id)) continue;
    const transit = findPortalTransit({
      pairs: state.portalPairs,
      tick: state.tick,
      from: { x: movement.oldX, y: movement.oldY },
      to: movement,
      heading: movement.angle,
      cooldownUntilTick: movement.player.portalCooldownUntilTick,
      bounds: portalBounds(state),
      riderRadius: RIDER_RADIUS,
      isSafeExit: (point, radius, pairId) =>
        isSafePortalPosition(
          state,
          point,
          radius,
          movements,
          movement.player.id,
          causes,
          transits,
        ) && isClearOfPortalWalls(state, point, radius, pairId),
    });
    if (transit) transits.set(movement.player.id, transit);
  }

  for (const movement of movementList) {
    const cause = causes.get(movement.player.id);
    const contactTime =
      cause === "trail"
        ? trailContactTimes.get(movement.player.id)
        : cause === "rider"
          ? riderContactTimes.get(movement.player.id)
          : cause === "wall"
            ? obstacleContactTimes.get(movement.player.id)
            : undefined;
    if (contactTime !== undefined) {
      movement.x = movement.oldX + (movement.x - movement.oldX) * contactTime;
      movement.y = movement.oldY + (movement.y - movement.oldY) * contactTime;
    }
    const travelledTo =
      transits.get(movement.player.id)?.entryPoint ?? movement;
    recordSurvivalTick(
      state.matchStats,
      movement.player.id,
      hypot2(travelledTo.x - movement.oldX, travelledTo.y - movement.oldY),
      isInvulnerable(movement.player, state.tick),
      bounced.has(movement.player.id),
    );
  }

  for (const movement of movementList) {
    const cause = causes.get(movement.player.id);
    if (cause) {
      // A wreck against scenery is left where it hit, with the trail it laid getting there; the boundary keeps
      // its own behaviour, where the rider has already been carried out of bounds.
      if (
        cause === "trail" ||
        cause === "rider" ||
        (cause === "wall" && obstacleContactTimes.has(movement.player.id))
      ) {
        movement.player.x = open
          ? wrapCoordinate(movement.x, state.width)
          : movement.x;
        movement.player.y = open
          ? wrapCoordinate(movement.y, state.height)
          : movement.y;
        movement.player.angle = movement.angle;
        const laid = layTrail(
          state,
          open,
          trailBounds,
          movement.player,
          movement.oldX,
          movement.oldY,
          movement.x,
          movement.y,
        ).filter((trail) => trail.x1 !== trail.x2 || trail.y1 !== trail.y2);
        if (laid.length)
          movement.player.trail = boundTrail([
            ...movement.player.trail,
            ...laid,
          ]);
      }
      movement.player.alive = false;
      movement.player.bombChargeStartedTick = undefined;
      movement.player.bombTarget = undefined;
      recordElimination(state, movement.player.id);
      const credited = soleCreditedOwner(
        causeOwners,
        movement.player.id,
        cause,
      );
      recordDeath(
        state.matchStats,
        movement.player.id,
        cause,
        causeOwners.get(movement.player.id)?.get(cause)?.size === 1
          ? causeOwners.get(movement.player.id)!.get(cause)!.values().next()
              .value
          : undefined,
        cause === "explosion"
          ? causeOwners.get(movement.player.id)?.get(cause)?.size === 1
            ? (state.shots.find(
                (s) => s.shot === shotSources.get(movement.player.id)?.shot,
              )?.weapon ?? "unknown")
            : "unknown"
          : cause,
      );
      if (cause === "explosion")
        logShotKill(
          state,
          movement.player.id,
          credited,
          shotSources.get(movement.player.id)?.shot,
        );
      events.push({
        type: "playerEliminated",
        playerId: movement.player.id,
        cause,
      });
      const trailHit =
        cause === "trail" ? trailHits.get(movement.player.id) : undefined;
      const landingHit = landingHits.get(movement.player.id),
        shellHit = shellHits.get(movement.player.id);
      observations.deaths.push({
        victimId: movement.player.id,
        cause,
        owners: [...(causeOwners.get(movement.player.id)?.get(cause) ?? [])],
        x: movement.x,
        y: movement.y,
        ...(trailHit ? { trailAge: trailHit.age } : {}),
        ...(landingHit ? { landingHit } : {}),
        ...(shellHit ? { shellHit } : {}),
      });
      continue;
    }
    const transit = transits.get(movement.player.id);
    movement.player.x =
      transit?.exitPoint.x ??
      (open ? wrapCoordinate(movement.x, state.width) : movement.x);
    movement.player.y =
      transit?.exitPoint.y ??
      (open ? wrapCoordinate(movement.y, state.height) : movement.y);
    if (transit) {
      movement.player.portalCooldownUntilTick = transit.cooldownUntilTick;
      movement.player.portalGraceUntilTick = transit.graceUntilTick;
      recordPortalTransit(state.matchStats, movement.player.id);
    }
    movement.player.angle = movement.angle;
    const laid = layTrail(
      state,
      open,
      trailBounds,
      movement.player,
      movement.oldX,
      movement.oldY,
      transit?.entryPoint.x ?? movement.x,
      transit?.entryPoint.y ?? movement.y,
    );
    if (laid.length)
      movement.player.trail = boundTrail([...movement.player.trail, ...laid]);
  }
  // Target every launch against the same committed tick, independent of player slot.
  for (const movement of movementList) {
    if (movement.player.alive) {
      const input = inputs.get(movement.player.id);
      applyBombActions(
        state,
        movement.player,
        input?.bombCommands ?? [],
        events,
      );
      if (
        movement.player.targetBombArmed &&
        !movement.player.shellArmed &&
        !movement.player.gunArmed &&
        movement.player.bombChargeStartedTick !== undefined
      )
        movement.player.bombTarget = targetPoint(
          state,
          movement.player,
          input?.aim,
          movement.player.bombTarget,
        );
    }
  }

  // Resolve every gun against the same committed board before applying cuts or deaths.
  const gunHits = (ctx.gunHits = resolveGunShots(state));

  /**
   * Resolve pressed Guns and released Target Bombs in this same tick, after every rider has launched — and so after
   * the sweep above. A rider that crashed into scenery earlier in this tick died against a board that was still
   * standing when it got there, and a Target Bomb landing afterwards then clears that same rock: chronological
   * within the tick, and the same order in which a pickup collected this tick survives a blast opened by it.
   * Ordinary fuses run before movement instead (`newBlasts`), so what they clear is gone before anyone rides into it.
   */
  const instantBlasts = (ctx.instantBlasts = resolveExplosions(state, events));
  if (instantBlasts.length || gunHits.size) {
    captureOrigins();
    for (const player of sortedPlayers(state)) {
      player.trail = cutTrail(
        player.trail,
        state.tick,
        (segment) =>
          instantBlasts.some((blast) =>
            segmentIntersectsDisk(
              segment.x1,
              segment.y1,
              segment.x2,
              segment.y2,
              blast.circle,
              TRAIL_WIDTH / 2,
            ),
          )
            ? []
            : [segment],
        () => state.nextTrailPieceId++,
      );
      if (!player.alive || isHazardImmune(player, state.tick)) continue;
      const hits = [
        ...instantBlasts.filter((blast) =>
          segmentIntersectsDisk(
            player.x,
            player.y,
            player.x,
            player.y,
            blast.circle,
            RIDER_RADIUS,
          ),
        ),
        ...(gunHits.get(player.id) ?? []),
      ];
      if (!hits.length) continue;
      if (player.shielded) {
        player.shielded = false;
        player.shieldGraceUntilTick = state.tick + SHIELD_GRACE_TICKS;
        continue;
      }
      player.alive = false;
      player.bombChargeStartedTick = undefined;
      player.bombTarget = undefined;
      recordElimination(state, player.id);
      const owners = new Set(hits.map((blast) => blast.ownerId));
      const credited = owners.size === 1 ? hits[0]!.ownerId : undefined;
      recordDeath(
        state.matchStats,
        player.id,
        "explosion",
        credited,
        owners.size === 1
          ? (state.shots.find(
              (s) =>
                s.shot ===
                hits.reduce((first, hit) =>
                  hit.bombId < first.bombId ? hit : first,
                ).shot,
            )?.weapon ?? "unknown")
          : "unknown",
      );
      logShotKill(
        state,
        player.id,
        credited,
        hits.reduce((first, blast) =>
          blast.bombId < first.bombId ? blast : first,
        ).shot,
      );
      events.push({
        type: "playerEliminated",
        playerId: player.id,
        cause: "explosion",
      });
      observations.deaths.push({
        victimId: player.id,
        cause: "explosion",
        owners: [...owners],
        x: player.x,
        y: player.y,
      });
    }
  }
  // A dodge is having been inside a blast's radius before it went off and being alive outside it now; the owner's
  // own retreat and any immune rider do not count. One per rider per tick, against the first such blast in id order.
  if (ctx.origins) {
    const blasts = [...newBlasts, ...instantBlasts];
    for (const player of sortedPlayers(state)) {
      const origin = ctx.origins.get(player.id);
      if (!origin || !player.alive || isHazardImmune(player, state.tick))
        continue;
      for (const blast of blasts) {
        if (
          blast.ownerId === player.id ||
          square(origin.x - blast.circle.x) +
            square(origin.y - blast.circle.y) >
            square(blast.circle.radius)
        )
          continue;
        observations.dodges.push({
          playerId: player.id,
          ownerId: blast.ownerId,
          clearance: Math.round(
            hypot2(player.x - blast.circle.x, player.y - blast.circle.y) -
              blast.circle.radius -
              RIDER_RADIUS,
          ),
        });
        break;
      }
    }
  }
  for (const moment of detectMoments(state, elapsed, observations))
    events.push({
      type: "moment",
      moment: { ...moment, targetIds: [...moment.targetIds] },
    });
  resolveRound(state, events, elapsed);
  return { snapshot: toSnapshot(state), events };
}

function prepareRound(state: GameState): void {
  const participants = sortedPlayers(state).filter(
    (player) => player.connected,
  );
  if (participants.length < MIN_PLAYERS || participants.length > MAX_PLAYERS) {
    throw new Error(`requires ${MIN_PLAYERS}-${MAX_PLAYERS} connected players`);
  }
  state.phase = "countdown";
  state.phaseEndsAtTick = state.tick + COUNTDOWN_TICKS;
  state.roundStartedTick = undefined;
  state.boundaryInset = INITIAL_BOUNDARY_INSET;
  state.bombs.clear();
  state.blasts = [];
  state.pickups = [];
  state.portalPairs = [];
  state.gravityFields = [];
  state.roundWinnerId = undefined;
  state.matchWinnerId = undefined;
  state.nextTrailPieceId = 1;
  state.nextBombId = 1;
  // Shot ids are bomb ids, which restart here, so the log restarts with them.
  state.shots = [];
  state.nextPickupId = 1;
  state.nextPickupSpawnTick = 0;
  state.roundParticipants = new Map(
    participants.map((player) => [
      player.id,
      {
        id: player.id,
        name: player.name,
      },
    ]),
  );
  state.roundPlacements = [];
  state.roundScored = false;
  for (const player of participants)
    beginMatchParticipant(state.matchStats, player);

  for (const player of sortedPlayers(state)) {
    player.alive = false;
    player.trail = [];
    player.bombChargeStartedTick = undefined;
    player.bombTarget = undefined;
    player.aimSlowTicks = 0;
    player.aimSlowSpentTicks = 0;
    player.bombReadyAtTick = state.tick;
    player.extraBombs = 0;
    player.fuseLevel = 0;
    player.powerPickups = 0;
    player.reloadDurationTicks = BOMB_COOLDOWN_TICKS;
    player.invulnerableUntilTick = 0;
    player.nitroUntilTicks = [];
    player.snailUntilTicks = [];
    player.grip = false;
    player.drunkUntilTick = 0;
    player.drunkStartedTick = 0;
    player.drunkHeadingOffset = 0;
    player.inkUntilTick = 0;
    player.gunArmed = false;
    player.shellArmed = false;
    player.targetBombArmed = false;
    player.tripleShotArmed = false;
    player.fiveShotArmed = false;
    player.shielded = false;
    player.shieldGraceUntilTick = 0;
    player.portalCooldownUntilTick = 0;
    player.portalGraceUntilTick = 0;
  }
  const radius = 0.28 * Math.min(state.width, state.height);
  participants.forEach((player, index) => {
    const spawnAngle =
      -Math.PI / 2 + (index * 2 * Math.PI) / participants.length;
    player.x = state.width / 2 + cos(spawnAngle) * radius;
    player.y = state.height / 2 + sin(spawnAngle) * radius;
    player.angle = normalizeAngle(spawnAngle + Math.PI / 2);
    player.alive = true;
  });
  // The layout is laid around riders already standing on the board, so nobody starts inside a rock or facing one
  // with no room to turn. Drawn from the round's own stream, after every participant has a pose.
  // A game with no room settings — LAN play, which has no settings screen — keeps the arena it has always had, like
  // every other settings fallback. `rotate` is the default of a room that has settings, and so a way to turn it off.
  state.map = chooseArenaMap(
    state.settings?.map ?? "classic",
    state.seed,
    state.round,
  );
  state.boundaryInset = initialBoundaryInset(state.map, INITIAL_BOUNDARY_INSET);
  const keepClear: ClearCapsule[] = participants.map((player) => ({
    x1: player.x,
    y1: player.y,
    x2: player.x + cos(player.angle) * SPAWN_CORRIDOR_LENGTH,
    y2: player.y + sin(player.angle) * SPAWN_CORRIDOR_LENGTH,
    radius: SPAWN_CORRIDOR_RADIUS,
  }));
  state.obstacles = generateObstacles({
    map: state.map,
    bounds: {
      minX: state.boundaryInset + OBSTACLE_WALL_MARGIN,
      minY: state.boundaryInset + OBSTACLE_WALL_MARGIN,
      maxX: state.width - state.boundaryInset - OBSTACLE_WALL_MARGIN,
      maxY: state.height - state.boundaryInset - OBSTACLE_WALL_MARGIN,
    },
    random: () => nextRandom(state),
    keepClear,
  });
}

function collectPickups(
  state: GameState,
  movements: ReadonlyMap<PlayerId, Movement>,
  events: GameEvent[],
): void {
  const consumed = new Set<number>();
  for (const pickup of [...state.pickups].sort((a, b) => a.id - b.id)) {
    const collectors = [...movements.values()]
      .filter(({ player }) => pickup.type !== "grip" || !player.grip)
      .map((movement) => ({
        movement,
        distance: pointSegmentDistanceSquared(
          pickup.x,
          pickup.y,
          movement.oldX,
          movement.oldY,
          movement.x,
          movement.y,
        ),
      }))
      .filter(
        ({ distance }) =>
          distance <= square(RIDER_RADIUS + PICKUP_RADIUS) + EPSILON,
      )
      .sort(
        (a, b) =>
          a.distance - b.distance ||
          a.movement.player.slot - b.movement.player.slot,
      );
    const collector = collectors[0]?.movement.player;
    if (!collector) continue;
    if (pickup.type === "portal") {
      // Safety disks conservatively cover the entire portal wall plus rider clearance.
      const pair = createPortalPair({
        id: `${state.round}:${pickup.id}:${state.tick}`,
        tick: state.tick,
        bounds: portalBounds(state),
        riderRadius: RIDER_RADIUS,
        random: () => nextRandom(state),
        isSafe: (point, radius) =>
          isSafePortalPosition(state, point, radius, movements) &&
          isClearOfPortalWalls(state, point, radius),
      });
      if (!pair) continue;
      // Pairs accumulate and expire on their own schedules; only the cap retires one early.
      state.portalPairs = [
        ...state.portalPairs.slice(
          Math.max(0, state.portalPairs.length + 1 - MAX_PORTAL_PAIRS),
        ),
        pair,
      ];
    }
    consumed.add(pickup.id);
    events.push({
      type: "pickupCollected",
      playerId: collector.id,
      pickupId: pickup.id,
    });
    recordPickup(state.matchStats, collector.id, pickup.type);
    if (pickup.type === "stopwatch") {
      collector.fuseLevel = Math.min(2, collector.fuseLevel + 1);
    } else if (pickup.type === "power") {
      const previousLifetime = powerTrailLifetimeTicks(collector.powerPickups);
      collector.powerPickups = Math.min(
        MAX_POWER_PICKUPS,
        collector.powerPickups + 1,
      );
      const extension =
        powerTrailLifetimeTicks(collector.powerPickups) - previousLifetime;
      // Retain the existing tail while the rider grows into the extra capacity.
      // Expired or destroyed trail is never recreated.
      for (const segment of collector.trail)
        if (!segment.detached) segment.expiresAtTick += extension;
    } else if (pickup.type === "gun") {
      collector.gunArmed = true;
    } else if (pickup.type === "gravity") {
      openBlackHoles(state, movements);
    } else if (pickup.type === "shell") {
      collector.shellArmed = true;
    } else if (pickup.type === "target") {
      collector.targetBombArmed = true;
    } else if (pickup.type === "star") {
      collector.invulnerableUntilTick = Math.max(
        collector.invulnerableUntilTick,
        state.tick + STAR_DURATION_TICKS,
      );
    } else if (pickup.type === "grip") {
      collector.grip = true;
    } else if (pickup.type === "nitro") {
      addSpeedEffect(
        collector.nitroUntilTicks,
        state.tick + NITRO_DURATION_TICKS,
      );
    } else if (pickup.type === "snail") {
      for (const player of sortedPlayers(state)) {
        if (player.alive && player.id !== collector.id)
          addSpeedEffect(
            player.snailUntilTicks,
            state.tick + SNAIL_DURATION_TICKS,
          );
      }
    } else if (pickup.type === "ink") {
      for (const player of sortedPlayers(state)) {
        if (player.alive && player.id !== collector.id)
          player.inkUntilTick = Math.max(
            player.inkUntilTick,
            state.tick + INK_DURATION_TICKS,
          );
      }
    } else if (pickup.type === "beer") {
      for (const player of sortedPlayers(state)) {
        if (player.alive && player.id !== collector.id) {
          if (player.drunkUntilTick <= state.tick)
            player.drunkStartedTick = state.tick;
          player.drunkUntilTick = Math.max(
            player.drunkUntilTick,
            state.tick + DRUNK_DURATION_TICKS,
          );
        }
      }
    } else if (pickup.type === "five") {
      collector.fiveShotArmed = true;
    } else if (pickup.type === "extraBomb") {
      collector.extraBombs = Math.min(
        MAX_EXTRA_BOMBS,
        collector.extraBombs + 1,
      );
    } else if (pickup.type === "triple") {
      collector.tripleShotArmed = true;
    } else if (pickup.type === "orbitShield") {
      collector.shielded = true;
    }
  }
  if (consumed.size > 0)
    state.pickups = state.pickups.filter((pickup) => !consumed.has(pickup.id));
}

/** Deadlines stay sorted, so the earliest to expire is always first and replicas hold identical lists. */
function addSpeedEffect(deadlines: number[], untilTick: number): void {
  if (deadlines.length >= MAX_SPEED_EFFECT_STACK) return;
  let index = deadlines.length;
  while (index > 0 && deadlines[index - 1]! > untilTick) index -= 1;
  deadlines.splice(index, 0, untilTick);
}
/** Drops spent deadlines before movement, so state carries only the effects still in force. */
function expireSpeedEffects(player: PlayerState, tick: number): void {
  const spent = (until: number) => until <= tick;
  if (player.nitroUntilTicks.some(spent))
    player.nitroUntilTicks = player.nitroUntilTicks.filter(
      (until) => !spent(until),
    );
  if (player.snailUntilTicks.some(spent))
    player.snailUntilTicks = player.snailUntilTicks.filter(
      (until) => !spent(until),
    );
}

/**
 * The first gate a shell's swept path meets this tick, as a fraction of the tick, or nothing.
 * Projectiles are held only to portal-wall clearance at the exit, not to the rider rule: a shell has
 * no problem appearing beside a rider or a trail, and resolves that contact on the ticks that follow.
 */
function findShellPortalEntry(
  state: GameState,
  bomb: BombState,
  path: readonly ShellPoint[],
): { transit: PortalTransit; time: number } | undefined {
  if (!bomb.shell) return undefined;
  for (let i = 1; i < path.length; i += 1) {
    const from = path[i - 1]!;
    const to = path[i]!;
    const transit = findPortalTransit({
      pairs: state.portalPairs,
      tick: state.tick,
      from,
      to,
      heading: 0, // Echoed back by findPortalTransit and read by no caller.
      cooldownUntilTick: bomb.portalCooldownUntilTick ?? 0,
      bounds: portalBounds(state),
      riderRadius: SHELL_RADIUS,
      isSafeExit: (point, radius, pairId) =>
        isClearOfPortalWalls(state, point, radius, pairId),
    });
    if (!transit) continue;
    const span = hypot2(to.x - from.x, to.y - from.y);
    const reached =
      span > 0
        ? hypot2(transit.entryPoint.x - from.x, transit.entryPoint.y - from.y) /
          span
        : 0;
    return {
      transit,
      time: from.t + (to.t - from.t) * Math.max(0, Math.min(1, reached)),
    };
  }
  return undefined;
}

/**
 * Clearance from live portal walls, for two callers with different exemptions. Placement passes no
 * exemption, so a new pair is never laid over a running one. A transit exempts the pair being used,
 * whose own gate the exit deliberately hugs at PORTAL_WALL_HALF_WIDTH + RIDER_RADIUS + 1, and so
 * covers the foreign walls that placement clearance alone does not put out of an exit's reach.
 */
function isClearOfPortalWalls(
  state: GameState,
  point: PortalPoint,
  radius: number,
  exemptPairId?: string,
): boolean {
  return state.portalPairs.every(
    (pair) =>
      pair.id === exemptPairId ||
      pair.gates.every(
        (gate) =>
          pointSegmentDistanceSquared(
            point.x,
            point.y,
            gate.x,
            gate.y - gate.halfLength,
            gate.x,
            gate.y + gate.halfLength,
          ) > square(radius + PORTAL_WALL_HALF_WIDTH),
      ),
  );
}

function isSafePortalPosition(
  state: GameState,
  point: PortalPoint,
  radius: number,
  movements: ReadonlyMap<PlayerId, Movement>,
  ignoredPlayerId?: PlayerId,
  deaths: ReadonlyMap<PlayerId, EliminationCause> = new Map(),
  transits: ReadonlyMap<PlayerId, PortalTransit> = new Map(),
): boolean {
  for (const player of sortedPlayers(state)) {
    const movement = movements.get(player.id);
    const transit = transits.get(player.id);
    if (
      player.id !== ignoredPlayerId &&
      player.alive &&
      !deaths.has(player.id)
    ) {
      const position = transit?.exitPoint ?? movement ?? player;
      if (
        hypot2(position.x - point.x, position.y - point.y) <=
        radius + RIDER_RADIUS
      )
        return false;
    }
    for (const trail of player.trail) {
      if (
        pointSegmentDistanceSquared(
          point.x,
          point.y,
          trail.x1,
          trail.y1,
          trail.x2,
          trail.y2,
        ) <= square(radius + TRAIL_WIDTH / 2)
      )
        return false;
    }
    // Include this tick's pending trail, which has not yet been committed.
    if (
      movement &&
      !deaths.has(player.id) &&
      pointSegmentDistanceSquared(
        point.x,
        point.y,
        movement.oldX,
        movement.oldY,
        transit?.entryPoint.x ?? movement.x,
        transit?.entryPoint.y ?? movement.y,
      ) <= square(radius + TRAIL_WIDTH / 2)
    )
      return false;
  }
  // A gate laid across scenery, or an exit inside it, would drop a rider straight into a lethal wall.
  if (
    state.obstacles.some((obstacle) =>
      obstacleTouchesCircle(obstacle, point.x, point.y, radius),
    )
  )
    return false;
  // Reserve both current flight location and landing site of live projectiles.
  for (const bomb of sortedBombs(state)) {
    if (bomb.shell?.gun) continue;
    const flight =
      bomb.flightPath[
        Math.max(
          0,
          Math.min(bomb.flightPath.length - 1, state.tick - bomb.launchedTick),
        )
      ];
    if (
      hypot2(point.x - bomb.x, point.y - bomb.y) <= radius + 14 ||
      (flight && hypot2(point.x - flight.x, point.y - flight.y) <= radius + 14)
    )
      return false;
  }
  return !state.blasts.some((blast) =>
    segmentIntersectsDisk(
      point.x,
      point.y,
      point.x,
      point.y,
      blast.circle,
      radius,
    ),
  );
}

function isInvulnerable(player: PlayerState, tick: number): boolean {
  return player.invulnerableUntilTick > tick;
}

function isHazardImmune(player: PlayerState, tick: number): boolean {
  return (
    isInvulnerable(player, tick) ||
    player.shieldGraceUntilTick > tick ||
    player.portalGraceUntilTick > tick
  );
}

function reflectAtBoundary(state: GameState, movement: Movement): boolean {
  // An open edge is not a surface: the rider carries on through it.
  if (edgesOpen(state)) return false;
  const reach = wallReach(state);
  const left = state.boundaryInset + reach;
  const right = state.width - state.boundaryInset - reach;
  const top = state.boundaryInset + reach;
  const bottom = state.height - state.boundaryInset - reach;
  const hitX = movement.x < left || movement.x > right;
  const hitY = movement.y < top || movement.y > bottom;
  if (!hitX && !hitY) return false;
  movement.x = Math.max(left, Math.min(right, movement.x));
  movement.y = Math.max(top, Math.min(bottom, movement.y));
  if (hitX) {
    movement.angle = normalizeAngle(Math.PI - movement.angle);
    movement.player.drunkHeadingOffset *= -1;
  }
  if (hitY) {
    movement.angle = normalizeAngle(-movement.angle);
    movement.player.drunkHeadingOffset *= -1;
  }
  return true;
}

/**
 * An absorbed crash leaves the rider against the face it hit, turned away from it: the same deal the boundary gives a
 * shielded rider, and without it a shield would only buy the ticks of grace it takes to die inside the same obstacle.
 */
function reflectAtObstacle(
  hit: ObstacleHitbox,
  movement: Movement,
  contactTime: number,
): boolean {
  movement.x = movement.oldX + (movement.x - movement.oldX) * contactTime;
  movement.y = movement.oldY + (movement.y - movement.oldY) * contactTime;
  const { nx, ny } = hitboxBounceNormal(hit, movement.x, movement.y);
  const heading = { x: cos(movement.angle), y: sin(movement.angle) };
  const approach = heading.x * nx + heading.y * ny;
  if (approach >= 0) return false; // already turned away from the face by this tick's steering
  movement.angle = normalizeAngle(
    atan2(heading.y - 2 * approach * ny, heading.x - 2 * approach * nx),
  );
  movement.player.drunkHeadingOffset *= -1;
  return true;
}

function targetPoint(
  state: GameState,
  player: PlayerState,
  aim?: AimPoint,
  previous?: AimPoint,
): AimPoint {
  const x = aim
    ? aim.x * state.width
    : (previous?.x ?? player.x + cos(player.angle) * 100);
  const y = aim
    ? aim.y * state.height
    : (previous?.y ?? player.y + sin(player.angle) * 100);
  return {
    x: Math.max(
      state.boundaryInset + RIDER_RADIUS,
      Math.min(state.width - state.boundaryInset - RIDER_RADIUS, x),
    ),
    y: Math.max(
      state.boundaryInset + RIDER_RADIUS,
      Math.min(state.height - state.boundaryInset - RIDER_RADIUS, y),
    ),
  };
}

function applyBombActions(
  state: GameState,
  player: PlayerState,
  actions: readonly BombActionCommand[],
  events: GameEvent[],
): void {
  for (const command of actions) {
    const { action } = command;
    if (action === "cancel") {
      player.bombChargeStartedTick = undefined;
      player.bombTarget = undefined;
      continue;
    }
    if (action === "press") {
      const ownsBomb = sortedBombs(state).some(
        (bomb) => bomb.ownerId === player.id && !bomb.shell,
      );
      if (
        player.bombChargeStartedTick === undefined &&
        !ownsBomb &&
        player.bombReadyAtTick <= state.tick
      ) {
        player.bombChargeStartedTick = state.tick;
        if (player.targetBombArmed && !player.shellArmed && !player.gunArmed)
          player.bombTarget = targetPoint(state, player, command.aim);
      }
      // Guns consume the press immediately. Release/cancel cannot fire a second shot.
      if (!player.gunArmed) continue;
    }

    const target = player.targetBombArmed
      ? targetPoint(state, player, command.aim, player.bombTarget)
      : undefined;
    const chargeStartedTick = player.bombChargeStartedTick;
    player.bombChargeStartedTick = undefined;
    player.bombTarget = undefined;
    if (chargeStartedTick === undefined) continue;
    const ownsBomb = sortedBombs(state).some(
      (bomb) => bomb.ownerId === player.id && !bomb.shell,
    );
    if (ownsBomb || player.bombReadyAtTick > state.tick) continue;
    if (player.shellArmed || player.gunArmed) {
      const gun = player.gunArmed === true;
      const weapon: Weapon = gun ? "gun" : "shell";
      const deadline = gun
        ? state.tick + GUN_TRACER_TICKS
        : Number.MAX_SAFE_INTEGER;
      const speed = gun ? 1 : SHELL_SPEED;
      // Triple, Five and Extra Bomb fan the projectile out exactly as they fan a lob; the pull spends Triple and Five.
      const angles = volleyAngles(player.angle, bombsPerShot(player));
      const shot = state.nextBombId;
      logShot(state, player, shot, weapon, angles.length);
      for (const angle of angles) {
        const id = state.nextBombId++;
        state.bombs.set(id, {
          id,
          ownerId: player.id,
          launchX: player.x,
          launchY: player.y,
          x: player.x,
          y: player.y,
          launchedTick: state.tick,
          placedTick: state.tick,
          landsAtTick: deadline,
          explodeAtTick: deadline,
          blastRange: 0,
          flightPath: [],
          shot,
          shell: {
            vx: cos(angle) * speed,
            vy: sin(angle) * speed,
            ...(gun ? { gun: true } : {}),
          },
        });
        recordBombPlaced(state.matchStats, player.id);
        events.push({
          type: "bombPlaced",
          bombId: id,
          playerId: player.id,
          ...(gun ? { gun: true } : {}),
        });
      }
      if (gun) player.gunArmed = false;
      else player.shellArmed = false;
      player.tripleShotArmed = false;
      player.fiveShotArmed = false;
      player.reloadDurationTicks = powerReloadTicks(player.powerPickups);
      player.bombReadyAtTick = state.tick + player.reloadDurationTicks;
      continue;
    }
    const distance = bombLaunchDistance(
      state.tick - chargeStartedTick,
      state.settings?.bombChargeTicks,
      state.settings?.aimBounce ?? false,
    );
    // Over open edges a lob is never cut short: it flies on past the edge and comes down on the far side.
    const open = edgesOpen(state);
    const bounds: LaunchBounds = open
      ? {
          minX: -state.width,
          maxX: 2 * state.width,
          minY: -state.height,
          maxY: 2 * state.height,
        }
      : {
          minX: state.boundaryInset + RIDER_RADIUS,
          maxX: state.width - state.boundaryInset - RIDER_RADIUS,
          minY: state.boundaryInset + RIDER_RADIUS,
          maxY: state.height - state.boundaryInset - RIDER_RADIUS,
        };
    // Read before the release below disarms them, so the launch can still say which weapon it spent. Extra Bomb is
    // not one of them: it is a round-long upgrade that widens every shot, like Power, not a weapon a pull consumes.
    const volley: Weapon | undefined = player.fiveShotArmed
      ? "five"
      : player.tripleShotArmed
        ? "triple"
        : undefined;
    const paths = target
      ? [[{ ...target, angle: player.angle }]]
      : bombsPerShot(player) > 1
        ? createVolleyFlightPaths(
            player,
            player.angle,
            distance,
            bounds,
            bombsPerShot(player),
          )
        : [
            createStraightFlightPath(
              player.x,
              player.y,
              player.angle,
              distance,
              bounds,
            ),
          ];
    if (target) player.targetBombArmed = false;
    else {
      player.tripleShotArmed = false;
      player.fiveShotArmed = false;
    }
    /**
     * One label for the whole trigger pull. Gun and Shell never reach here — they launch in the branch above, which
     * is why they outrank everything (a Triple or Five they fan out is spent under their label), and why a rider
     * holding Target as well keeps it armed for the next pull.
     * Among the launches that do reach here, Target comes first, because it is the only one the others cannot combine with.
     */
    const weapon: Weapon = target ? "target" : (volley ?? "bomb");
    // Every bomb of the pull names the same shot: the id its first bomb is about to take.
    const shot = state.nextBombId;
    logShot(state, player, shot, weapon, paths.length);
    for (const flightPath of paths) {
      const landing = flightPath[flightPath.length - 1]!;
      const bomb: BombState = {
        id: state.nextBombId++,
        ownerId: player.id,
        launchX: player.x,
        launchY: player.y,
        // The flight path stays unwrapped, so it is still one straight throw to whoever draws it.
        x: open ? wrapCoordinate(landing.x, state.width) : landing.x,
        y: open ? wrapCoordinate(landing.y, state.height) : landing.y,
        placedTick: state.tick,
        launchedTick: state.tick,
        landsAtTick: target ? state.tick : state.tick + BOMB_FLIGHT_TICKS,
        explodeAtTick: target
          ? state.tick
          : state.tick + bombFuseTicks(player.fuseLevel),
        blastRange: powerBlastRadius(player.powerPickups) * (target ? 0.7 : 1),
        flightPath,
        shot,
      };
      state.bombs.set(bomb.id, bomb);
      recordBombPlaced(state.matchStats, player.id);
      events.push({ type: "bombPlaced", bombId: bomb.id, playerId: player.id });
    }
    player.reloadDurationTicks = powerReloadTicks(player.powerPickups);
    player.bombReadyAtTick = state.tick + player.reloadDurationTicks;
  }
}

function createStraightFlightPath(
  x: number,
  y: number,
  angle: number,
  distance: number,
  bounds: LaunchBounds,
): FlightPoint[] {
  const landing = bombLandingPoint(x, y, angle, distance, {
    left: bounds.minX,
    right: bounds.maxX,
    top: bounds.minY,
    bottom: bounds.maxY,
  });
  return Array.from({ length: BOMB_FLIGHT_TICKS + 1 }, (_, step) => ({
    x: x + ((landing.x - x) * step) / BOMB_FLIGHT_TICKS,
    y: y + ((landing.y - y) * step) / BOMB_FLIGHT_TICKS,
    angle,
  }));
}

/**
 * The first unspent gate a gun ray meets, as a fraction of the cast segment. A bullet is a point at
 * this scale, so only portal-wall clearance can refuse the exit — a rider or a trail waiting there is
 * exactly what the shooter aimed for.
 */
function findGunPortalEntry(
  state: GameState,
  from: PortalPoint,
  to: PortalPoint,
  spent: ReadonlySet<string>,
): { transit: PortalTransit; time: number } | undefined {
  const transit = findPortalTransit({
    pairs: state.portalPairs.filter((pair) => !spent.has(pair.id)),
    tick: state.tick,
    from,
    to,
    heading: 0,
    cooldownUntilTick: 0, // A ray lives for one tick, so it has no cooldown of its own.
    bounds: portalBounds(state),
    riderRadius: GUN_RADIUS,
    isSafeExit: (point, radius, pairId) =>
      isClearOfPortalWalls(state, point, radius, pairId),
  });
  if (!transit) return undefined;
  const span = hypot2(to.x - from.x, to.y - from.y);
  if (span === 0) return undefined;
  return {
    transit,
    time:
      hypot2(transit.entryPoint.x - from.x, transit.entryPoint.y - from.y) /
      span,
  };
}

/**
 * One more tracer for the stretch of a ray past a gate, so the renderer keeps drawing every segment as
 * the straight line it is. It records no placement: the trigger was pulled once, and this is still that bullet.
 */
function continueGunTracer(
  state: GameState,
  bomb: BombState,
  from: PortalPoint,
): BombState {
  const id = state.nextBombId++;
  const tracer: BombState = {
    ...bomb,
    id,
    launchX: from.x,
    launchY: from.y,
    x: from.x,
    y: from.y,
    flightPath: [],
    shell: { vx: bomb.shell!.vx, vy: bomb.shell!.vy, gun: true },
  };
  state.bombs.set(id, tracer);
  return tracer;
}

/** Edges one bullet can cross inside its range: a board's width of travel spans the board once across and twice down. */
const GUN_WRAP_LEGS = 4;

/** Raycast against heads, trails and walls. All shots see the same board, including simultaneous volleys. */
function resolveGunShots(
  state: GameState,
): Map<PlayerId, { bombId: number; ownerId: PlayerId; shot?: number }[]> {
  const hits = new Map<
    PlayerId,
    { bombId: number; ownerId: PlayerId; shot?: number }[]
  >();
  const impacts: { x: number; y: number }[] = [];
  // Snapshot first: a ray that crosses a gate adds tracers for the segments past it, and those are
  // already resolved — re-reading them here would cast the same bullet twice.
  for (const bomb of sortedBombs(state)) {
    if (!bomb.shell?.gun || bomb.launchedTick !== state.tick) continue;
    const { vx, vy } = bomb.shell;
    let segment = bomb;
    // Each pair carries a ray once, so two gates facing each other cannot hold a bullet in a loop.
    const spent = new Set<string>();
    // Over open edges a bullet flies on from the opposite side, for one board's width in all: far enough to shoot
    // through any edge at anything on screen, and an end to a ray that would otherwise circle an empty board for ever.
    const open = edgesOpen(state);
    let range = open ? state.width : Infinity;
    for (
      let hop = 0, leg = 0;
      hop <= MAX_PORTAL_PAIRS && leg <= MAX_PORTAL_PAIRS + GUN_WRAP_LEGS;
      leg += 1
    ) {
      const x = segment.launchX,
        y = segment.launchY;
      const inset = open ? 0 : state.boundaryInset + GUN_RADIUS;
      const wallX =
        vx > 0
          ? (state.width - inset - x) / vx
          : vx < 0
            ? (inset - x) / vx
            : Infinity;
      const wallY =
        vy > 0
          ? (state.height - inset - y) / vy
          : vy < 0
            ? (inset - y) / vy
            : Infinity;
      const distance = Math.max(0, Math.min(wallX, wallY, range));
      const dx = vx * distance,
        dy = vy * distance;
      let contact = 1;
      let hit: PlayerState | undefined;
      const gunReach = RIDER_RADIUS + GUN_RADIUS;
      const legImages = open
        ? wrapImages(
            state.width,
            state.height,
            Math.min(x, x + dx) - gunReach,
            Math.min(y, y + dy) - gunReach,
            Math.max(x, x + dx) + gunReach,
            Math.max(y, y + dy) + gunReach,
          )
        : NO_WRAP;
      // Slot order is stable even when a checkpoint was decoded with another Map insertion order.
      for (const player of sortedPlayers(state)) {
        if (player.id === bomb.ownerId) continue;
        const consider = (
          x1: number,
          y1: number,
          x2: number,
          y2: number,
          radius: number,
        ): void => {
          const touches = (t: number): boolean =>
            segmentDistanceSquared(
              x,
              y,
              x + dx * t,
              y + dy * t,
              x1,
              y1,
              x2,
              y2,
            ) <= square(radius);
          if (!touches(contact)) return;
          const time = firstContactTime(touches);
          if (time < contact || !hit) {
            contact = time;
            hit = player;
          }
        };
        // A leg along an open edge also meets what overhangs that edge from the far side.
        for (const image of legImages) {
          if (player.alive)
            consider(
              player.x - image.dx,
              player.y - image.dy,
              player.x - image.dx,
              player.y - image.dy,
              RIDER_RADIUS + GUN_RADIUS,
            );
          for (const trail of player.trail)
            consider(
              trail.x1 - image.dx,
              trail.y1 - image.dy,
              trail.x2 - image.dx,
              trail.y2 - image.dy,
              TRAIL_WIDTH / 2 + GUN_RADIUS,
            );
        }
      }
      // Scenery stops a bullet without taking damage from it: only a blast clears an obstacle. Whatever stood
      // behind it was never in this ray's line, so an earlier obstacle contact also drops the rider it found.
      // Id order: each bisection starts from the contact before it, so the order decides its low bits.
      for (const obstacle of sortedObstacles(state)) {
        const touches = (t: number): boolean =>
          segmentObstacleDistanceSquared(
            obstacle,
            x,
            y,
            x + dx * t,
            y + dy * t,
          ) <= square(GUN_RADIUS);
        if (!touches(contact)) continue;
        contact = firstContactTime(touches, contact);
        hit = undefined;
      }
      const gate = findGunPortalEntry(
        state,
        { x, y },
        { x: x + dx, y: y + dy },
        spent,
      );
      // A gate reached before anything solid takes the bullet; whatever stood beyond it never saw this ray.
      if (gate && gate.time < contact && hop < MAX_PORTAL_PAIRS) {
        segment.x = gate.transit.entryPoint.x;
        segment.y = gate.transit.entryPoint.y;
        spent.add(gate.transit.pairId);
        segment = continueGunTracer(state, bomb, gate.transit.exitPoint);
        range -= distance * gate.time;
        hop += 1;
        continue;
      }
      segment.x = x + dx * contact;
      segment.y = y + dy * contact;
      // Nothing in the way and range to spare: the ray reached an open edge, and carries on from the one opposite.
      // The edge it reached is set exactly rather than computed, so the next leg starts on the board.
      if (
        !hit &&
        contact === 1 &&
        open &&
        range > distance &&
        distance < Infinity
      ) {
        range -= distance;
        const throughX = wallX <= wallY,
          throughY = wallY <= wallX;
        if (throughX) segment.x = vx > 0 ? state.width : 0;
        if (throughY) segment.y = vy > 0 ? state.height : 0;
        segment = continueGunTracer(state, bomb, {
          x: throughX ? (vx > 0 ? 0 : state.width) : segment.x,
          y: throughY ? (vy > 0 ? 0 : state.height) : segment.y,
        });
        continue;
      }
      if (!hit) break;
      // The hole is cut wherever the impact reaches, which near an open edge includes the trail on the far side.
      for (const { dx: shiftX, dy: shiftY } of open
        ? wrapImages(
            state.width,
            state.height,
            segment.x - GUN_HOLE_RADIUS,
            segment.y - GUN_HOLE_RADIUS,
            segment.x + GUN_HOLE_RADIUS,
            segment.y + GUN_HOLE_RADIUS,
          )
        : NO_WRAP)
        impacts.push({ x: segment.x + shiftX, y: segment.y + shiftY });
      // A body hit is only lethal near that body's own living head, never through splash.
      if (
        hit.alive &&
        square(nearestDelta(open, hit.x - segment.x, state.width)) +
          square(nearestDelta(open, hit.y - segment.y, state.height)) <=
          square(GUN_HEADSHOT_RADIUS)
      ) {
        const previous = hits.get(hit.id) ?? [];
        previous.push({
          bombId: bomb.id,
          ownerId: bomb.ownerId,
          shot: bomb.shot,
        });
        hits.set(hit.id, previous);
      }
      break;
    }
  }
  for (const impact of impacts)
    for (const player of sortedPlayers(state)) {
      player.trail = cutTrail(
        player.trail,
        state.tick,
        (trail) => cutTrailHole(trail, impact.x, impact.y, GUN_HOLE_RADIUS),
        () => state.nextTrailPieceId++,
      );
    }
  return hits;
}

/**
 * How far curved space turns a heading this tick, in radians. Each hole bends by the part of its pull that lies across
 * the heading, as a sideways force would: a rider aimed at the centre or straight away from it rides on unbent, one
 * crossing the hole swings around it. `turn` is the tick's own steering, so the bend ramps and grips with the rider,
 * and the sum is capped below it. Bots plan with the same function.
 */
export function gravityBend(
  fields: ReadonlyArray<Pick<GravityField, "x" | "y" | "radius">>,
  pose: { x: number; y: number; angle: number },
  turn: number,
): number {
  if (fields.length === 0) return 0;
  const headingX = cos(pose.angle),
    headingY = sin(pose.angle);
  let bend = 0;
  for (const field of fields) {
    const toX = field.x - pose.x,
      toY = field.y - pose.y;
    const away = hypot2(toX, toY);
    if (away === 0 || away >= field.radius) continue;
    bend +=
      ((1 - away / field.radius) * (headingX * toY - headingY * toX)) / away;
  }
  return Math.max(-1, Math.min(1, bend)) * GRAVITY_BEND * turn;
}

/** One to three holes anywhere on the field. Every hole costs the same three draws, so replicas stay in step whatever the sizes. */
function openBlackHoles(
  state: GameState,
  movements: ReadonlyMap<PlayerId, Movement>,
): void {
  const bounds = portalBounds(state);
  const count =
    1 + Math.floor(nextRandom(state) * GRAVITY_MAX_HOLES_PER_PICKUP);
  for (let hole = 0; hole < count; hole += 1) {
    const radius =
      GRAVITY_MIN_RADIUS +
      nextRandom(state) * (GRAVITY_MAX_RADIUS - GRAVITY_MIN_RADIUS);
    let x = bounds.minX + nextRandom(state) * (bounds.maxX - bounds.minX);
    let y = bounds.minY + nextRandom(state) * (bounds.maxY - bounds.minY);
    // The core kills, so it never opens under a rider: slide the hole straight away from anyone too close, in seat order.
    for (const { id, alive, angle } of sortedPlayers(state)) {
      // Riders have moved this tick but not yet landed in the state: measure from where they are about to be.
      const player = movements.get(id);
      if (!alive || !player) continue;
      const awayX = x - player.x,
        awayY = y - player.y,
        distance = hypot2(awayX, awayY);
      if (distance >= GRAVITY_CORE_SPAWN_CLEARANCE) continue;
      const ux = distance === 0 ? cos(angle + Math.PI) : awayX / distance,
        uy = distance === 0 ? sin(angle + Math.PI) : awayY / distance;
      x = player.x + ux * GRAVITY_CORE_SPAWN_CLEARANCE;
      y = player.y + uy * GRAVITY_CORE_SPAWN_CLEARANCE;
      // Against a wall the slide goes the other way on that axis, which keeps the full clearance where a clamp would not.
      if (x < bounds.minX || x > bounds.maxX)
        x = player.x - ux * GRAVITY_CORE_SPAWN_CLEARANCE;
      if (y < bounds.minY || y > bounds.maxY)
        y = player.y - uy * GRAVITY_CORE_SPAWN_CLEARANCE;
    }
    x = Math.max(bounds.minX, Math.min(bounds.maxX, x));
    y = Math.max(bounds.minY, Math.min(bounds.maxY, y));
    state.gravityFields.push({
      x,
      y,
      radius,
      expiresAtTick: state.tick + GRAVITY_FIELD_TICKS,
    });
  }
  state.gravityFields = state.gravityFields.slice(
    Math.max(0, state.gravityFields.length - MAX_GRAVITY_FIELDS),
  );
}

function resolveExplosions(state: GameState, events: GameEvent[]): NewBlast[] {
  // #166: with chaining off a bomb only ever answers to its own fuse, neither to a blast already on the field nor to one opened this tick.
  const chain = state.settings?.chainReaction ?? true;
  const queue = sortedBombs(state)
    .filter(
      (bomb) =>
        !bomb.shell &&
        bomb.landsAtTick <= state.tick &&
        (bomb.explodeAtTick <= state.tick ||
          (chain &&
            state.blasts.some((blast) =>
              segmentIntersectsDisk(
                bomb.x,
                bomb.y,
                bomb.x,
                bomb.y,
                blast.circle,
              ),
            ))),
    )
    .sort((a, b) => a.id - b.id)
    .map((bomb) => bomb.id);
  const queued = new Set(queue);
  const exploded = new Set<number>();
  const result: NewBlast[] = [];

  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const id = queue[cursor]!;
    if (exploded.has(id)) continue;
    const bomb = state.bombs.get(id);
    if (!bomb) continue;
    exploded.add(id);
    // A blast that reaches past an open edge carries on from the opposite one; "reaches" is measured at a rider's
    // radius, the widest thing a blast is tested against, so a rider or trail overhanging the edge is covered too. Each part is a blast in its own right,
    // under the same bomb id, so everything downstream — kills, cuts, chains, the drawing — covers both without knowing.
    const circles: BlastCircle[] = (
      edgesOpen(state)
        ? wrapImages(
            state.width,
            state.height,
            bomb.x - bomb.blastRange - RIDER_RADIUS,
            bomb.y - bomb.blastRange - RIDER_RADIUS,
            bomb.x + bomb.blastRange + RIDER_RADIUS,
            bomb.y + bomb.blastRange + RIDER_RADIUS,
          )
        : NO_WRAP
    ).map(({ dx, dy }) => ({
      x: bomb.x + dx,
      y: bomb.y + dy,
      radius: bomb.blastRange,
    }));
    const circle = circles[0]!;
    state.pickups = state.pickups.filter((pickup) =>
      circles.every(
        (part) =>
          square(pickup.x - part.x) + square(pickup.y - part.y) >=
          square(part.radius * PICKUP_DESTRUCTION_RADIUS_RATIO),
      ),
    );
    // Scenery goes at the full radius rather than the pickups' inner disk: clearing a path is the point of the shot.
    state.obstacles = state.obstacles.filter(
      (obstacle) =>
        !circles.some((part) =>
          obstacleTouchesCircle(obstacle, part.x, part.y, part.radius),
        ),
    );
    // Stored and returned separately: `state.blasts` is checkpointed and validated field by field, so the
    // statistics-only shot stays in the returned copy this tick's kill attribution reads.
    for (const part of circles) {
      const blast: BlastState = {
        bombId: id,
        ownerId: bomb.ownerId,
        circle: part,
        expiresAtTick: state.tick + BLAST_VISIBLE_TICKS,
      };
      state.blasts.push(blast);
      result.push({
        ...blast,
        ...(bomb.shot === undefined ? {} : { shot: bomb.shot }),
      });
    }
    recordBombExploded(state.matchStats, bomb.ownerId);
    events.push({ type: "explosion", bombId: id });

    if (chain)
      for (const candidate of sortedBombs(state)) {
        if (exploded.has(candidate.id) || queued.has(candidate.id)) continue;
        if (candidate.shell || candidate.landsAtTick > state.tick) continue;
        if (
          circles.some((part) =>
            segmentIntersectsDisk(
              candidate.x,
              candidate.y,
              candidate.x,
              candidate.y,
              part,
            ),
          )
        ) {
          queued.add(candidate.id);
          queue.push(candidate.id);
        }
      }
  }
  for (const id of exploded) state.bombs.delete(id);
  return result;
}

function resolveRound(
  state: GameState,
  events: GameEvent[],
  elapsed: number,
): void {
  if (state.phase !== "playing") return;
  const alive = sortedPlayers(state).filter((player) => player.alive);
  if (alive.length > 1 && elapsed < ROUND_DRAW_TICK) return;

  // Everything that can throw is computed before any mutation, so a rejected round
  // cannot leave the state half-updated and re-throwing on every later step (#19).
  const winner = alive.length === 1 ? alive[0] : undefined;
  const winnerId = winner?.id;
  const placements = state.roundScored
    ? undefined
    : rankRound(seatedParticipants(state));
  const scores = new Map(
    placements?.map((placement) => [placement.playerId, placement.scoreUnits]),
  );
  const fixedEnd = state.round >= (state.settings?.length ?? 5);
  const ranking = [...state.matchStats.values()]
    .map((entry) => ({
      ...entry,
      matchScoreUnits:
        entry.matchScoreUnits + (scores.get(entry.playerId) ?? 0),
      roundWins: entry.roundWins + (entry.playerId === winnerId ? 1 : 0),
    }))
    .sort(compareMatchScores);
  const champions = fixedEnd
    ? ranking
        .filter((entry) => compareMatchScores(entry, ranking[0]!) === 0)
        .map((entry) => entry.playerId)
    : [];
  const matchWinnerId = champions.length === 1 ? champions[0] : undefined;

  if (winner) winner.roundWins += 1;
  state.roundWinnerId = winnerId;
  if (matchWinnerId !== undefined || fixedEnd)
    state.matchWinnerId = matchWinnerId;
  scoreRoundOnce(state, placements, winnerId, champions);
  events.push(
    winnerId === undefined
      ? { type: "roundEnded" }
      : { type: "roundEnded", winnerId },
  );
  // A round with a highlight pauses longer so every screen can replay it before the next countdown or the recap (ADR 044).
  const pause = roundHasMoment(state) ? REPLAY_PAUSE_TICKS : 0;
  // Nothing in this round can kill any more; bombs still in the air are cleared by the next round's start.
  const inFlight = new Set(
    sortedBombs(state).flatMap((bomb) =>
      bomb.shot === undefined || bomb.shell?.gun ? [] : [bomb.shot],
    ),
  );
  state.decidedRound = decideRound(
    state.matchId,
    state.round,
    state.tick,
    state.shots,
    inFlight,
  );
  state.decidedRound.rating = {
    finishers: [...state.roundParticipants.keys()]
      .filter(
        (id) => state.players.get(id)?.connected && !id.startsWith("bot:"),
      )
      .sort(),
    standings: state.roundPlacements.map((placement) => {
      const identity = state.matchStats.get(placement.playerId)!;
      return { ...placement, slot: identity.slot, color: identity.color };
    }),
  };
  if (matchWinnerId !== undefined || fixedEnd) {
    state.matchFinishers = [...state.players.values()]
      .filter((player) => player.connected && state.matchStats.has(player.id))
      .map((player) => player.id)
      .sort();
    state.phase = "matchOver";
    state.phaseEndsAtTick =
      state.tick + ROUND_OVER_TICKS + pause + MATCH_WINNER_TICKS;
    events.push({
      type: "matchEnded",
      ...(matchWinnerId ? { winnerId: matchWinnerId } : {}),
    });
    return;
  }
  state.phase = "roundOver";
  state.phaseEndsAtTick = state.tick + ROUND_OVER_TICKS + pause;
}

/**
 * The round's riders in seat order, the order `prepareRound` entered them in. `rankRound` lists riders that share a
 * place in the order it is given, and the placements are state peers compare, so that order cannot be left to how a
 * restored Map happened to be built. Nobody is unseated while a round is in play; the id keeps the sort total anyway.
 */
function seatedParticipants(state: GameState): RoundParticipant[] {
  const seats = new Map(
    sortedPlayers(state).map((player, seat) => [player.id, seat]),
  );
  return [...state.roundParticipants.values()].sort(
    (a, b) =>
      (seats.get(a.id) ?? MAX_PLAYERS) - (seats.get(b.id) ?? MAX_PLAYERS) ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
}

const roundElapsed = (state: GameState): number =>
  state.tick - (state.roundStartedTick ?? state.tick);

function logShot(
  state: GameState,
  shooter: PlayerState,
  shot: number,
  weapon: Weapon,
  bombs: number,
): void {
  const combat = state.matchStats.get(shooter.id)?.combat;
  if (combat) combat.uses[weapon] += 1;
  recordShot(state.shots, {
    shot,
    shooterId: shooter.id,
    weapon,
    elapsed: roundElapsed(state),
    bombs,
    power: shooter.powerPickups,
    extraBombs: shooter.extraBombs,
    fuseLevel: shooter.fuseLevel,
    grip: shooter.grip,
    kills: [],
  });
}

/**
 * Log a kill against a shot on exactly the deaths `recordDeath` credits as eliminations: one owner behind the
 * explosion, and not the victim itself, so blowing yourself up stays a death with no kill anywhere. The credited
 * owner is necessarily the shot's shooter — every explosion mark on the victim came from that one owner's bombs.
 */
function logShotKill(
  state: GameState,
  victimId: PlayerId,
  creditedId: PlayerId | undefined,
  shot: number | undefined,
): void {
  if (creditedId === undefined || creditedId === victimId || shot === undefined)
    return;
  recordShotKill(state.shots, shot, { victimId, elapsed: roundElapsed(state) });
}

function recordElimination(state: GameState, playerId: PlayerId): void {
  const player = requirePlayer(state, playerId);
  player.trail = detachTrail(
    player.trail,
    state.tick,
    () => state.nextTrailPieceId++,
  );
  const participant = state.roundParticipants.get(playerId);
  if (participant && participant.eliminatedAtTick === undefined)
    participant.eliminatedAtTick = state.tick;
}

function scoreRoundOnce(
  state: GameState,
  placements: RoundPlacement[] | undefined,
  winnerId?: PlayerId,
  champions: readonly PlayerId[] = [],
): void {
  if (state.roundScored || !placements) return;
  applyRoundScores(state.leaderboard, placements, winnerId);
  for (const champion of champions) creditMatchWin(state, champion);
  finalizeMatchStatsRound(
    state.matchStats,
    [...state.roundParticipants.keys()],
    winnerId,
    placements,
  );
  state.roundPlacements = placements;
  state.roundScored = true;
}

/** Credit a match win to a leaderboard entry, creating it when the winner sat out this round. */
function creditMatchWin(state: GameState, matchWinnerId: PlayerId): void {
  const entry = state.leaderboard.get(matchWinnerId) ?? {
    id: matchWinnerId,
    name: state.players.get(matchWinnerId)?.name ?? matchWinnerId,
    totalScoreUnits: 0,
    roundsPlayed: 0,
    roundWins: 0,
    matchWins: 0,
  };
  entry.matchWins += 1;
  state.leaderboard.set(entry.id, entry);
}

function requireEnoughPlayers(state: GameState): void {
  const connected = sortedPlayers(state).filter(
    (player) => player.connected,
  ).length;
  if (connected < MIN_PLAYERS || connected > MAX_PLAYERS) {
    throw new Error(`requires ${MIN_PLAYERS}-${MAX_PLAYERS} connected players`);
  }
}

function requirePlayer(state: GameState, playerId: PlayerId): PlayerState {
  const player = state.players.get(playerId);
  if (!player) throw new Error(`unknown player: ${playerId}`);
  return player;
}

function assertPhase(
  state: GameState,
  allowed: GamePhase[],
  command: string,
): void {
  if (!allowed.includes(state.phase))
    throw new Error(`${command} is invalid during ${state.phase}`);
}

function markCause(
  causes: Map<PlayerId, EliminationCause>,
  causeOwners: Map<PlayerId, Map<EliminationCause, Set<PlayerId>>>,
  playerId: PlayerId,
  cause: EliminationCause,
  ownerId?: PlayerId,
): void {
  const current = causes.get(playerId);
  if (!current || CAUSE_PRIORITY[cause] > CAUSE_PRIORITY[current])
    causes.set(playerId, cause);
  if (ownerId === undefined) return;
  let byCause = causeOwners.get(playerId);
  if (!byCause) causeOwners.set(playerId, (byCause = new Map()));
  let owners = byCause.get(cause);
  if (!owners) byCause.set(cause, (owners = new Set()));
  owners.add(ownerId);
}

function soleCreditedOwner(
  causeOwners: ReadonlyMap<
    PlayerId,
    ReadonlyMap<EliminationCause, ReadonlySet<PlayerId>>
  >,
  victimId: PlayerId,
  cause: EliminationCause,
): PlayerId | undefined {
  const owners = causeOwners.get(victimId)?.get(cause);
  if (!owners || owners.size !== 1) return undefined;
  const ownerId = owners.values().next().value as PlayerId | undefined;
  return ownerId === victimId ? undefined : ownerId;
}

const NEUTRAL_INPUT: InputIntent = Object.freeze({
  left: false,
  right: false,
  bomb: false,
});
