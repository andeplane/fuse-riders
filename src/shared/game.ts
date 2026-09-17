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
export { gravityBend } from "./gravity.js";
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
import { isClearOfPortalWalls, isSafePortalPosition } from "./sim/portals.js";
import {
  isHazardImmune,
  isInvulnerable,
  reflectAtBoundary,
  reflectAtObstacle,
} from "./sim/riders.js";
import { explodeInstant } from "./sim/phases/explode.js";
import { captureOrigins, markCause, markShot } from "./sim/marks.js";
import { logShot, logShotKill, recordElimination } from "./sim/recording.js";

export interface TickResult {
  snapshot: GameSnapshot;
  events: GameEvent[];
}

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

  const { bounced } = ctx;
  const { shellPaths } = ctx;
  const newBlasts = ctx.fuseBlasts;

  // Highlight observations (ADR 043): what the sweep learns about each death, and where every rider was before a blast.
  const { observations, landingHits, shellHits, trailHits } = ctx;
  const { causes, causeOwners, shotSources } = ctx;
  const {
    trailContactTimes,
    riderContactTimes,
    obstacleContactTimes,
    obstaclesReached,
  } = ctx;
  const movementList = [...movements.values()];
  const { sceneryReached } = ctx;
  const { transits } = ctx;
  const { instantBlasts } = ctx;
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
