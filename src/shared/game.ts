import type {
  BlastRect,
  BombAction,
  GameEvent,
  GameSnapshot,
  PlayerId,
  TrailSegment,
  FlightPoint,
} from './protocol.js';
import {
  applyRoundScores,
  rankRound,
  sortedLeaderboard,
  type RoundParticipant,
  type RoundPlacement,
  type SessionLeaderboardEntry,
} from './leaderboard.js';
import {
  beginMatchParticipant,
  finalizeMatchStatsRound,
  recordBombExploded,
  recordBombPlaced,
  recordDeath,
  recordEarlyExit,
  recordPickup,
  recordSurvivalTick,
  snapshotMatchStats,
  type MatchStatsState,
} from './match-stats.js';
import { DRUNK_DURATION_TICKS, drunkAngularVelocity } from './drunk.js';
import {
  BOMB_FLIGHT_TICKS,
  bombLandingPoint,
  bombLaunchDistance,
} from './bomb-launch.js';
import {
  createHomingFlightPath,
  createVolleyFlightPaths,
  type LaunchBounds,
} from './launch-modifiers.js';

export type { BlastRect, BombAction, GameEvent, GameSnapshot, PlayerId, TrailSegment } from './protocol.js';

export const TICK_HZ = 20;
export const SNAPSHOT_HZ = 10;
export const MAX_CATCH_UP_STEPS = 5;
export const MAX_PLAYERS = 5;
export const MIN_PLAYERS = 2;

export const ARENA_WIDTH = 1600;
export const ARENA_HEIGHT = 900;
export const INITIAL_BOUNDARY_INSET = 20;
export const SLOT_COLORS = ['#22d3ee', '#ff4fa3', '#a3e635', '#fb923c', '#a78bfa'] as const;

export const RIDER_SPEED = 150;
export const RIDER_TURN_RATE = 2.8;
export const RIDER_RADIUS = 7;
export const TRAIL_WIDTH = 6;
export const TRAIL_LIFETIME_TICKS = 160;
export const SELF_TRAIL_GRACE_TICKS = 10;

export const BOMB_FUSE_TICKS = 40;
export const BOMB_COOLDOWN_TICKS = 80;
export const BOMB_BLAST_RANGE = 150;
export const BOMB_BLAST_HALF_WIDTH = 12;
export const BLAST_VISIBLE_TICKS = 8;
export const BLAST_LEVEL_RANGE = 75;

export const PICKUP_SPAWN_INTERVAL_TICKS = 120;
export const PICKUP_LIFETIME_TICKS = 300;
export const MAX_ACTIVE_PICKUPS = 3;
export const PICKUP_SPAWN_ATTEMPTS = 24;
export const PICKUP_RADIUS = 14;
export const PICKUP_SPAWN_MARGIN = 40;
export const PICKUP_RIDER_BOMB_CLEARANCE = 80;
export const PICKUP_TRAIL_CLEARANCE = 40;
export const PICKUP_SEPARATION = 28;
export const STAR_DURATION_TICKS = 50;
export const SHIELD_GRACE_TICKS = 10;

export const COUNTDOWN_TICKS = 60;
export const ROUND_OVER_TICKS = 60;
export const OVERTIME_START_TICK = 1200;
export const OVERTIME_INSET_PER_TICK = 0.5;
export const ROUND_DRAW_TICK = 1800;

export const INPUT_RESEND_TICKS = 2;
export const INPUT_STALE_TICKS = 10;
export const HEARTBEAT_INTERVAL_MS = 2000;
export const SOCKET_TIMEOUT_MS = 6000;

export type GamePhase = 'lobby' | 'countdown' | 'playing' | 'roundOver' | 'matchOver';
export type EliminationCause = 'wall' | 'trail' | 'explosion' | 'rider';
export type PickupType = 'blast' | 'star' | 'beer' | 'triple' | 'homing' | 'orbitShield';

export interface PlayerIdentity {
  id: PlayerId;
  name: string;
  slot: number;
  color: string;
  connected?: boolean;
}

export interface InputIntent {
  left: boolean;
  right: boolean;
  bomb: boolean;
  bombActions?: readonly BombAction[];
}

export interface PlayerState extends Required<PlayerIdentity> {
  x: number;
  y: number;
  angle: number;
  alive: boolean;
  roundWins: number;
  bombReadyAtTick: number;
  bombChargeStartedTick?: number;
  blastLevel: 0 | 1 | 2;
  invulnerableUntilTick: number;
  drunkUntilTick: number;
  tripleShotArmed: boolean;
  homingArmed: boolean;
  shielded: boolean;
  shieldGraceUntilTick: number;
  trail: TrailSegment[];
}

export interface BombState {
  id: number;
  ownerId: PlayerId;
  launchX: number;
  launchY: number;
  x: number;
  y: number;
  launchedTick: number;
  landsAtTick: number;
  flightPath: FlightPoint[];
  homingTargetId?: PlayerId;
  homingTargetX?: number;
  homingTargetY?: number;
  placedTick: number;
  explodeAtTick: number;
  blastRange: number;
}

export interface BlastState {
  bombId: number;
  ownerId: PlayerId;
  rects: BlastRect[];
  expiresAtTick: number;
}

export interface PickupState {
  id: number;
  type: PickupType;
  x: number;
  y: number;
  expiresAtTick: number;
}

export interface GameState {
  matchId: string;
  round: number;
  tick: number;
  phase: GamePhase;
  phaseEndsAtTick?: number;
  roundStartedTick?: number;
  width: number;
  height: number;
  boundaryInset: number;
  players: Map<PlayerId, PlayerState>;
  bombs: Map<number, BombState>;
  blasts: BlastState[];
  pickups: PickupState[];
  nextBombId: number;
  nextPickupId: number;
  nextPickupSpawnTick: number;
  seed: number;
  randomState: number;
  leaderboard: Map<PlayerId, SessionLeaderboardEntry>;
  roundParticipants: Map<PlayerId, RoundParticipant>;
  roundPlacements: RoundPlacement[];
  roundScored: boolean;
  matchStats: MatchStatsState;
  roundWinnerId?: PlayerId;
  matchWinnerId?: PlayerId;
}

export interface TickResult {
  snapshot: GameSnapshot;
  events: GameEvent[];
}

interface Movement {
  player: PlayerState;
  oldX: number;
  oldY: number;
  x: number;
  y: number;
  angle: number;
}

const EPSILON = 1e-9;
const MOVE_PER_TICK = RIDER_SPEED / TICK_HZ;
const TURN_PER_TICK = RIDER_TURN_RATE / TICK_HZ;
const CAUSE_PRIORITY: Record<EliminationCause, number> = {
  rider: 0,
  trail: 1,
  wall: 2,
  explosion: 3,
};

export function createGame(matchId: string, seed = hashSeed(matchId)): GameState {
  if (!matchId) throw new Error('matchId is required');
  return {
    matchId,
    round: 1,
    tick: 0,
    phase: 'lobby',
    width: ARENA_WIDTH,
    height: ARENA_HEIGHT,
    boundaryInset: INITIAL_BOUNDARY_INSET,
    players: new Map(),
    bombs: new Map(),
    blasts: [],
    pickups: [],
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
  };
}

export function addPlayer(state: GameState, identity: PlayerIdentity): void {
  assertPhase(state, ['lobby', 'roundOver', 'matchOver'], 'addPlayer');
  if (state.players.size >= MAX_PLAYERS) throw new Error('game is full');
  if (state.players.has(identity.id)) throw new Error(`duplicate player id: ${identity.id}`);
  if (!Number.isInteger(identity.slot) || identity.slot < 0 || identity.slot >= MAX_PLAYERS) {
    throw new Error(`invalid slot: ${identity.slot}`);
  }
  for (const player of state.players.values()) {
    if (player.slot === identity.slot) throw new Error(`slot is occupied: ${identity.slot}`);
  }
  state.players.set(identity.id, {
    ...identity,
    connected: identity.connected ?? true,
    x: state.width / 2,
    y: state.height / 2,
    angle: 0,
    alive: false,
    roundWins: 0,
    bombReadyAtTick: 0,
    blastLevel: 0,
    invulnerableUntilTick: 0,
    drunkUntilTick: 0,
    tripleShotArmed: false,
    homingArmed: false,
    shielded: false,
    shieldGraceUntilTick: 0,
    trail: [],
  });
  const historical = state.leaderboard.get(identity.id);
  if (historical) historical.name = identity.name;
  else state.leaderboard.set(identity.id, {
    id: identity.id,
    name: identity.name,
    totalScoreUnits: 0,
    roundsPlayed: 0,
    roundWins: 0,
    matchWins: 0,
  });
}

export function removePlayer(state: GameState, playerId: PlayerId): void {
  assertPhase(state, ['lobby', 'roundOver', 'matchOver'], 'removePlayer');
  state.players.delete(playerId);
}

export function setPlayerConnected(state: GameState, playerId: PlayerId, connected: boolean): void {
  requirePlayer(state, playerId).connected = connected;
}

export function eliminatePlayer(state: GameState, playerId: PlayerId): void {
  const player = requirePlayer(state, playerId);
  if (state.phase !== 'countdown' && state.phase !== 'playing') return;
  if (!player.alive) return;
  player.alive = false;
  player.bombChargeStartedTick = undefined;
  recordElimination(state, playerId);
  if (state.roundParticipants.has(playerId)) recordEarlyExit(state.matchStats, playerId);
}

export function startMatch(state: GameState): void {
  assertPhase(state, ['lobby'], 'startMatch');
  requireEnoughPlayers(state);
  state.round = 1;
  for (const player of state.players.values()) player.roundWins = 0;
  prepareRound(state);
}

export function startNextRound(state: GameState): void {
  assertPhase(state, ['roundOver'], 'startNextRound');
  if (state.phaseEndsAtTick !== undefined && state.tick < state.phaseEndsAtTick) {
    throw new Error('round-over presentation has not finished');
  }
  requireEnoughPlayers(state);
  state.round += 1;
  prepareRound(state);
}

export function resetMatch(state: GameState, newMatchId: string): void {
  assertPhase(state, ['matchOver'], 'resetMatch');
  if (!newMatchId) throw new Error('newMatchId is required');
  requireEnoughPlayers(state);
  state.matchId = newMatchId;
  state.seed = hashSeed(newMatchId);
  state.randomState = state.seed;
  state.matchStats = new Map();
  state.round = 1;
  for (const player of state.players.values()) player.roundWins = 0;
  prepareRound(state);
}

export function step(state: GameState, inputs: ReadonlyMap<PlayerId, InputIntent>): TickResult {
  state.tick += 1;
  const events: GameEvent[] = [];

  for (const player of state.players.values()) {
    player.trail = player.trail.filter((segment) => segment.expiresAtTick > state.tick);
  }
  state.blasts = state.blasts.filter((blast) => blast.expiresAtTick > state.tick);
  state.pickups = state.pickups.filter((pickup) => pickup.expiresAtTick > state.tick);

  if (state.phase === 'countdown' && state.phaseEndsAtTick !== undefined && state.tick >= state.phaseEndsAtTick) {
    state.phase = 'playing';
    state.phaseEndsAtTick = undefined;
    state.roundStartedTick = state.tick;
    state.nextPickupSpawnTick = state.tick + PICKUP_SPAWN_INTERVAL_TICKS;
  }

  if (state.phase !== 'playing') return { snapshot: toSnapshot(state), events };

  const elapsed = state.tick - (state.roundStartedTick ?? state.tick);
  state.boundaryInset = INITIAL_BOUNDARY_INSET +
    Math.max(0, elapsed - OVERTIME_START_TICK) * OVERTIME_INSET_PER_TICK;

  if (state.tick >= state.nextPickupSpawnTick) {
    state.nextPickupSpawnTick += PICKUP_SPAWN_INTERVAL_TICKS;
    maybeSpawnPickup(state);
  }

  const movements = new Map<PlayerId, Movement>();
  for (const player of sortedPlayers(state).filter((candidate) => candidate.alive)) {
    const input = inputs.get(player.id) ?? NEUTRAL_INPUT;
    const direction = Number(input.right) - Number(input.left);
    const drunkTurn = player.drunkUntilTick > state.tick
      ? drunkAngularVelocity(state.seed, player.id, state.tick) / TICK_HZ
      : 0;
    const angle = normalizeAngle(player.angle + direction * TURN_PER_TICK + drunkTurn);
    movements.set(player.id, {
      player,
      oldX: player.x,
      oldY: player.y,
      x: player.x + Math.cos(angle) * MOVE_PER_TICK,
      y: player.y + Math.sin(angle) * MOVE_PER_TICK,
      angle,
    });
  }

  collectPickups(state, movements);

  const bounced = new Set<PlayerId>();
  for (const movement of movements.values()) {
    if (isHazardImmune(movement.player, state.tick) && reflectAtBoundary(state, movement)) {
      bounced.add(movement.player.id);
    }
  }

  const newBlasts = resolveExplosions(state, events);
  if (newBlasts.length > 0) {
    const rects = newBlasts.flatMap((blast) => blast.rects);
    for (const player of state.players.values()) {
      player.trail = player.trail.filter((segment) =>
        !rects.some((rect) => segmentIntersectsRect(segment.x1, segment.y1, segment.x2, segment.y2, rect)),
      );
    }
  }

  const causes = new Map<PlayerId, EliminationCause>();
  const causeOwners = new Map<PlayerId, Map<EliminationCause, Set<PlayerId>>>();
  for (const movement of movements.values()) {
    for (const blast of newBlasts) {
      if (!isHazardImmune(movement.player, state.tick) && blast.rects.some((rect) => sweptCircleIntersectsRect(movement, RIDER_RADIUS, rect))) {
        markCause(causes, causeOwners, movement.player.id, 'explosion', blast.ownerId);
      }
    }

    const left = state.boundaryInset + RIDER_RADIUS;
    const right = state.width - state.boundaryInset - RIDER_RADIUS;
    const top = state.boundaryInset + RIDER_RADIUS;
    const bottom = state.height - state.boundaryInset - RIDER_RADIUS;
    if (!isHazardImmune(movement.player, state.tick) && (movement.x < left || movement.x > right || movement.y < top || movement.y > bottom)) {
      markCause(causes, causeOwners, movement.player.id, 'wall');
    }

    for (const owner of state.players.values()) {
      if (isHazardImmune(movement.player, state.tick)) break;
      for (const trail of owner.trail) {
        if (
          owner.id === movement.player.id &&
          trail.createdTick > state.tick - SELF_TRAIL_GRACE_TICKS
        ) continue;
        if (segmentDistanceSquared(
          movement.oldX, movement.oldY, movement.x, movement.y,
          trail.x1, trail.y1, trail.x2, trail.y2,
        ) <= square(RIDER_RADIUS + TRAIL_WIDTH / 2) + EPSILON) {
          markCause(causes, causeOwners, movement.player.id, 'trail', owner.id);
          break;
        }
      }
    }
  }

  const movementList = [...movements.values()];
  for (let first = 0; first < movementList.length; first += 1) {
    for (let second = first + 1; second < movementList.length; second += 1) {
      const a = movementList[first]!;
      const b = movementList[second]!;
      if (segmentDistanceSquared(a.oldX, a.oldY, a.x, a.y, b.oldX, b.oldY, b.x, b.y) <= square(2 * RIDER_RADIUS) + EPSILON) {
        const aInvulnerable = isHazardImmune(a.player, state.tick);
        const bInvulnerable = isHazardImmune(b.player, state.tick);
        if (!aInvulnerable) markCause(causes, causeOwners, a.player.id, 'rider', b.player.id);
        if (!bInvulnerable) markCause(causes, causeOwners, b.player.id, 'rider', a.player.id);
      }
    }
  }

  for (const movement of movementList) {
    if (!causes.has(movement.player.id) || !movement.player.shielded) continue;
    movement.player.shielded = false;
    movement.player.shieldGraceUntilTick = state.tick + SHIELD_GRACE_TICKS;
    if (reflectAtBoundary(state, movement)) bounced.add(movement.player.id);
    causes.delete(movement.player.id);
    causeOwners.delete(movement.player.id);
  }

  for (const movement of movementList) {
    recordSurvivalTick(
      state.matchStats,
      movement.player.id,
      Math.hypot(movement.x - movement.oldX, movement.y - movement.oldY),
      isInvulnerable(movement.player, state.tick),
      bounced.has(movement.player.id),
    );
  }

  for (const movement of movementList) {
    const cause = causes.get(movement.player.id);
    if (cause) {
      movement.player.alive = false;
      movement.player.bombChargeStartedTick = undefined;
      recordElimination(state, movement.player.id);
      recordDeath(state.matchStats, movement.player.id, cause, soleCreditedOwner(causeOwners, movement.player.id, cause));
      events.push({ type: 'playerEliminated', playerId: movement.player.id, cause });
      continue;
    }
    movement.player.x = movement.x;
    movement.player.y = movement.y;
    movement.player.angle = movement.angle;
    movement.player.trail.push({
      x1: movement.oldX,
      y1: movement.oldY,
      x2: movement.x,
      y2: movement.y,
      createdTick: state.tick,
      expiresAtTick: state.tick + TRAIL_LIFETIME_TICKS,
    });
  }
  // Target every launch against the same committed tick, independent of player slot.
  for (const movement of movementList) {
    if (movement.player.alive) applyBombActions(state, movement.player, inputs.get(movement.player.id)?.bombActions ?? [], events);
  }

  resolveRound(state, events, elapsed);
  return { snapshot: toSnapshot(state), events };
}

export function toSnapshot(state: GameState): GameSnapshot {
  return {
    phase: state.phase,
    ...(state.phaseEndsAtTick === undefined ? {} : { phaseEndsAtTick: state.phaseEndsAtTick }),
    ...(state.roundStartedTick === undefined ? {} : { roundStartedTick: state.roundStartedTick }),
    width: state.width,
    height: state.height,
    boundaryInset: state.boundaryInset,
    players: sortedPlayers(state).map((player) => ({
      id: player.id,
      name: player.name,
      slot: player.slot,
      color: player.color,
      connected: player.connected,
      x: player.x,
      y: player.y,
      angle: player.angle,
      alive: player.alive,
      roundWins: player.roundWins,
      bombReadyAtTick: player.bombReadyAtTick,
      ...(player.bombChargeStartedTick === undefined ? {} : { bombChargeStartedTick: player.bombChargeStartedTick }),
      blastLevel: player.blastLevel,
      invulnerableUntilTick: player.invulnerableUntilTick,
      drunkUntilTick: player.drunkUntilTick,
      tripleShotArmed: player.tripleShotArmed,
      homingArmed: player.homingArmed,
      shielded: player.shielded,
      shieldGraceUntilTick: player.shieldGraceUntilTick,
      trail: player.trail.map((segment) => ({ ...segment })),
    })),
    bombs: [...state.bombs.values()].sort((a, b) => a.id - b.id).map((bomb) => ({
      id: bomb.id,
      ownerId: bomb.ownerId,
      launchX: bomb.launchX,
      launchY: bomb.launchY,
      x: bomb.x,
      y: bomb.y,
      launchedTick: bomb.launchedTick,
      landsAtTick: bomb.landsAtTick,
      flightPath: bomb.flightPath.map((point) => ({ ...point })),
      ...(bomb.homingTargetId === undefined ? {} : {
        homingTargetId: bomb.homingTargetId,
        homingTargetX: bomb.homingTargetX,
        homingTargetY: bomb.homingTargetY,
      }),
      explodeAtTick: bomb.explodeAtTick,
      blastRange: bomb.blastRange,
    })),
    blasts: state.blasts.map((blast) => ({
      bombId: blast.bombId,
      rects: blast.rects.map((rect) => ({ ...rect })),
      expiresAtTick: blast.expiresAtTick,
    })),
    pickups: state.pickups.map((pickup) => ({ ...pickup })),
    leaderboard: sortedLeaderboard(state.leaderboard),
    roundPlacements: state.roundPlacements.map((placement) => ({ ...placement })),
    matchStats: state.phase === 'matchOver' ? snapshotMatchStats(state.matchStats) : [],
    ...(state.roundWinnerId === undefined ? {} : { roundWinnerId: state.roundWinnerId }),
    ...(state.matchWinnerId === undefined ? {} : { matchWinnerId: state.matchWinnerId }),
  };
}

function prepareRound(state: GameState): void {
  const participants = sortedPlayers(state).filter((player) => player.connected);
  if (participants.length < MIN_PLAYERS || participants.length > MAX_PLAYERS) {
    throw new Error(`requires ${MIN_PLAYERS}-${MAX_PLAYERS} connected players`);
  }
  state.phase = 'countdown';
  state.phaseEndsAtTick = state.tick + COUNTDOWN_TICKS;
  state.roundStartedTick = undefined;
  state.boundaryInset = INITIAL_BOUNDARY_INSET;
  state.bombs.clear();
  state.blasts = [];
  state.pickups = [];
  state.roundWinnerId = undefined;
  state.matchWinnerId = undefined;
  state.nextBombId = 1;
  state.nextPickupId = 1;
  state.nextPickupSpawnTick = 0;
  state.roundParticipants = new Map(participants.map((player) => [player.id, {
    id: player.id,
    name: player.name,
  }]));
  state.roundPlacements = [];
  state.roundScored = false;
  for (const player of participants) beginMatchParticipant(state.matchStats, player);

  for (const player of state.players.values()) {
    player.alive = false;
    player.trail = [];
    player.bombChargeStartedTick = undefined;
    player.bombReadyAtTick = state.tick;
    player.blastLevel = 0;
    player.invulnerableUntilTick = 0;
    player.drunkUntilTick = 0;
    player.tripleShotArmed = false;
    player.homingArmed = false;
    player.shielded = false;
    player.shieldGraceUntilTick = 0;
  }
  const radius = 0.28 * Math.min(state.width, state.height);
  participants.forEach((player, index) => {
    const spawnAngle = -Math.PI / 2 + index * 2 * Math.PI / participants.length;
    player.x = state.width / 2 + Math.cos(spawnAngle) * radius;
    player.y = state.height / 2 + Math.sin(spawnAngle) * radius;
    player.angle = normalizeAngle(spawnAngle + Math.PI / 2);
    player.alive = true;
  });
}

function maybeSpawnPickup(state: GameState): void {
  if (state.pickups.length >= MAX_ACTIVE_PICKUPS) return;
  const typeRoll = nextRandom(state);
  const pickupTypes: readonly PickupType[] = ['blast', 'star', 'beer', 'triple', 'homing', 'orbitShield'];
  const type = pickupTypes[Math.min(pickupTypes.length - 1, Math.floor(typeRoll * pickupTypes.length))]!;
  const minimumX = state.boundaryInset + PICKUP_SPAWN_MARGIN;
  const maximumX = state.width - state.boundaryInset - PICKUP_SPAWN_MARGIN;
  const minimumY = state.boundaryInset + PICKUP_SPAWN_MARGIN;
  const maximumY = state.height - state.boundaryInset - PICKUP_SPAWN_MARGIN;
  if (minimumX >= maximumX || minimumY >= maximumY) return;

  for (let attempt = 0; attempt < PICKUP_SPAWN_ATTEMPTS; attempt += 1) {
    const x = minimumX + nextRandom(state) * (maximumX - minimumX);
    const y = minimumY + nextRandom(state) * (maximumY - minimumY);
    if (!isSafePickupPosition(state, x, y)) continue;
    state.pickups.push({
      id: state.nextPickupId++,
      type,
      x,
      y,
      expiresAtTick: state.tick + PICKUP_LIFETIME_TICKS,
    });
    return;
  }
}

function isSafePickupPosition(state: GameState, x: number, y: number): boolean {
  for (const player of state.players.values()) {
    if (player.alive && square(player.x - x) + square(player.y - y) < square(PICKUP_RIDER_BOMB_CLEARANCE)) return false;
    for (const trail of player.trail) {
      if (pointSegmentDistanceSquared(x, y, trail.x1, trail.y1, trail.x2, trail.y2) < square(PICKUP_TRAIL_CLEARANCE)) return false;
    }
  }
  for (const bomb of state.bombs.values()) {
    if (square(bomb.x - x) + square(bomb.y - y) < square(PICKUP_RIDER_BOMB_CLEARANCE)) return false;
  }
  return state.pickups.every((pickup) =>
    square(pickup.x - x) + square(pickup.y - y) >= square(PICKUP_SEPARATION),
  );
}

function collectPickups(state: GameState, movements: ReadonlyMap<PlayerId, Movement>): void {
  const consumed = new Set<number>();
  for (const pickup of [...state.pickups].sort((a, b) => a.id - b.id)) {
    const collectors = [...movements.values()]
      .map((movement) => ({
        movement,
        distance: pointSegmentDistanceSquared(pickup.x, pickup.y, movement.oldX, movement.oldY, movement.x, movement.y),
      }))
      .filter(({ distance }) => distance <= square(RIDER_RADIUS + PICKUP_RADIUS) + EPSILON)
      .sort((a, b) => a.distance - b.distance || a.movement.player.slot - b.movement.player.slot);
    const collector = collectors[0]?.movement.player;
    if (!collector) continue;
    consumed.add(pickup.id);
    recordPickup(state.matchStats, collector.id, pickup.type);
    if (pickup.type === 'blast') {
      collector.blastLevel = Math.min(2, collector.blastLevel + 1) as 0 | 1 | 2;
    } else if (pickup.type === 'star') {
      collector.invulnerableUntilTick = Math.max(collector.invulnerableUntilTick, state.tick + STAR_DURATION_TICKS);
    } else if (pickup.type === 'beer') {
      for (const player of state.players.values()) {
        if (player.alive && player.id !== collector.id) {
          player.drunkUntilTick = Math.max(player.drunkUntilTick, state.tick + DRUNK_DURATION_TICKS);
        }
      }
    } else if (pickup.type === 'triple') {
      collector.tripleShotArmed = true;
    } else if (pickup.type === 'homing') {
      collector.homingArmed = true;
    } else {
      collector.shielded = true;
    }
  }
  if (consumed.size > 0) state.pickups = state.pickups.filter((pickup) => !consumed.has(pickup.id));
}

function isInvulnerable(player: PlayerState, tick: number): boolean {
  return player.invulnerableUntilTick > tick;
}

function isHazardImmune(player: PlayerState, tick: number): boolean {
  return isInvulnerable(player, tick) || player.shieldGraceUntilTick > tick;
}

function reflectAtBoundary(state: GameState, movement: Movement): boolean {
  const left = state.boundaryInset + RIDER_RADIUS;
  const right = state.width - state.boundaryInset - RIDER_RADIUS;
  const top = state.boundaryInset + RIDER_RADIUS;
  const bottom = state.height - state.boundaryInset - RIDER_RADIUS;
  const hitX = movement.x < left || movement.x > right;
  const hitY = movement.y < top || movement.y > bottom;
  if (!hitX && !hitY) return false;
  movement.x = Math.max(left, Math.min(right, movement.x));
  movement.y = Math.max(top, Math.min(bottom, movement.y));
  if (hitX) movement.angle = normalizeAngle(Math.PI - movement.angle);
  if (hitY) movement.angle = normalizeAngle(-movement.angle);
  return true;
}

function applyBombActions(state: GameState, player: PlayerState, actions: readonly BombAction[], events: GameEvent[]): void {
  for (const action of actions) {
    if (action === 'cancel') {
      player.bombChargeStartedTick = undefined;
      continue;
    }
    if (action === 'press') {
      const ownsBomb = [...state.bombs.values()].some((bomb) => bomb.ownerId === player.id);
      if (player.bombChargeStartedTick === undefined && !ownsBomb && player.bombReadyAtTick <= state.tick) {
        player.bombChargeStartedTick = state.tick;
      }
      continue;
    }

    const chargeStartedTick = player.bombChargeStartedTick;
    player.bombChargeStartedTick = undefined;
    if (chargeStartedTick === undefined) continue;
    const ownsBomb = [...state.bombs.values()].some((bomb) => bomb.ownerId === player.id);
    if (ownsBomb || player.bombReadyAtTick > state.tick) continue;
    const distance = bombLaunchDistance(state.tick - chargeStartedTick);
    const bounds: LaunchBounds = {
      minX: state.boundaryInset + RIDER_RADIUS,
      maxX: state.width - state.boundaryInset - RIDER_RADIUS,
      minY: state.boundaryInset + RIDER_RADIUS,
      maxY: state.height - state.boundaryInset - RIDER_RADIUS,
    };
    const target = player.homingArmed ? nearestHomingTarget(state, player) : undefined;
    const paths = player.tripleShotArmed
      ? createVolleyFlightPaths(player, player.angle, distance, bounds, target)
      : [target
          ? createHomingFlightPath({ x: player.x, y: player.y, angle: player.angle }, target, distance, bounds)
          : createStraightFlightPath(player.x, player.y, player.angle, distance, bounds)];
    player.tripleShotArmed = false;
    player.homingArmed = false;
    for (const flightPath of paths) {
      const landing = flightPath[flightPath.length - 1]!;
      const bomb: BombState = {
        id: state.nextBombId++,
        ownerId: player.id,
        launchX: player.x,
        launchY: player.y,
        x: landing.x,
        y: landing.y,
        placedTick: state.tick,
        launchedTick: state.tick,
        landsAtTick: state.tick + BOMB_FLIGHT_TICKS,
        explodeAtTick: state.tick + BOMB_FUSE_TICKS,
        blastRange: BOMB_BLAST_RANGE + player.blastLevel * BLAST_LEVEL_RANGE,
        flightPath,
        ...(target === undefined ? {} : {
          homingTargetId: target.id,
          homingTargetX: target.x,
          homingTargetY: target.y,
        }),
      };
      state.bombs.set(bomb.id, bomb);
      recordBombPlaced(state.matchStats, player.id);
      events.push({ type: 'bombPlaced', bombId: bomb.id, playerId: player.id });
    }
    player.bombReadyAtTick = state.tick + BOMB_COOLDOWN_TICKS;
  }
}

function nearestHomingTarget(state: GameState, player: PlayerState): PlayerState | undefined {
  return sortedPlayers(state)
    .filter((candidate) => candidate.alive && candidate.id !== player.id)
    .sort((a, b) => square(a.x - player.x) + square(a.y - player.y) - square(b.x - player.x) - square(b.y - player.y) || a.id.localeCompare(b.id))[0];
}

function createStraightFlightPath(x: number, y: number, angle: number, distance: number, bounds: LaunchBounds): FlightPoint[] {
  const landing = bombLandingPoint(x, y, angle, distance, {
    left: bounds.minX, right: bounds.maxX, top: bounds.minY, bottom: bounds.maxY,
  });
  return Array.from({ length: BOMB_FLIGHT_TICKS + 1 }, (_, step) => ({
    x: x + (landing.x - x) * step / BOMB_FLIGHT_TICKS,
    y: y + (landing.y - y) * step / BOMB_FLIGHT_TICKS,
    angle,
  }));
}

function hashSeed(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return normalizeSeed(hash);
}

function normalizeSeed(seed: number): number {
  const normalized = Number.isFinite(seed) ? seed >>> 0 : 0;
  return normalized || 0x6d2b79f5;
}

function nextRandom(state: GameState): number {
  state.randomState = (state.randomState + 0x6d2b79f5) >>> 0;
  let value = state.randomState;
  value = Math.imul(value ^ (value >>> 15), value | 1);
  value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
  return ((value ^ (value >>> 14)) >>> 0) / 0x1_0000_0000;
}

function resolveExplosions(state: GameState, events: GameEvent[]): BlastState[] {
  const queue = [...state.bombs.values()]
    .filter((bomb) => bomb.landsAtTick <= state.tick && bomb.explodeAtTick <= state.tick)
    .sort((a, b) => a.id - b.id)
    .map((bomb) => bomb.id);
  const queued = new Set(queue);
  const exploded = new Set<number>();
  const result: BlastState[] = [];

  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const id = queue[cursor]!;
    if (exploded.has(id)) continue;
    const bomb = state.bombs.get(id);
    if (!bomb) continue;
    exploded.add(id);
    const rects = createBlastRects(state, bomb);
    result.push({ bombId: id, ownerId: bomb.ownerId, rects, expiresAtTick: state.tick + BLAST_VISIBLE_TICKS });
    recordBombExploded(state.matchStats, bomb.ownerId);
    events.push({ type: 'explosion', bombId: id });

    for (const candidate of [...state.bombs.values()].sort((a, b) => a.id - b.id)) {
      if (exploded.has(candidate.id) || queued.has(candidate.id)) continue;
      if (candidate.landsAtTick > state.tick) continue;
      if (rects.some((rect) => pointInRect(candidate.x, candidate.y, rect))) {
        queued.add(candidate.id);
        queue.push(candidate.id);
      }
    }
  }
  for (const id of exploded) state.bombs.delete(id);
  state.blasts.push(...result);
  return result;
}

function createBlastRects(state: GameState, bomb: BombState): BlastRect[] {
  const left = state.boundaryInset;
  const right = state.width - state.boundaryInset;
  const top = state.boundaryInset;
  const bottom = state.height - state.boundaryInset;
  const horizontalLeft = Math.max(left, bomb.x - bomb.blastRange);
  const horizontalRight = Math.min(right, bomb.x + bomb.blastRange);
  const horizontalTop = Math.max(top, bomb.y - BOMB_BLAST_HALF_WIDTH);
  const horizontalBottom = Math.min(bottom, bomb.y + BOMB_BLAST_HALF_WIDTH);
  const verticalLeft = Math.max(left, bomb.x - BOMB_BLAST_HALF_WIDTH);
  const verticalRight = Math.min(right, bomb.x + BOMB_BLAST_HALF_WIDTH);
  const verticalTop = Math.max(top, bomb.y - bomb.blastRange);
  const verticalBottom = Math.min(bottom, bomb.y + bomb.blastRange);
  return [
    rectFromEdges(horizontalLeft, horizontalTop, horizontalRight, horizontalBottom),
    rectFromEdges(verticalLeft, verticalTop, verticalRight, verticalBottom),
  ];
}

function resolveRound(state: GameState, events: GameEvent[], elapsed: number): void {
  if (state.phase !== 'playing') return;
  const alive = sortedPlayers(state).filter((player) => player.alive);
  if (alive.length > 1 && elapsed < ROUND_DRAW_TICK) return;

  let winnerId: PlayerId | undefined;
  let matchWinnerId: PlayerId | undefined;
  if (alive.length === 1) {
    const winner = alive[0]!;
    winner.roundWins += 1;
    winnerId = winner.id;
    state.roundWinnerId = winner.id;
    if (winner.roundWins >= 5) {
      matchWinnerId = winner.id;
      state.matchWinnerId = winner.id;
    }
  } else {
    state.roundWinnerId = undefined;
  }

  scoreRoundOnce(state, winnerId, matchWinnerId);
  events.push(winnerId === undefined ? { type: 'roundEnded' } : { type: 'roundEnded', winnerId });
  if (matchWinnerId !== undefined) {
    state.phase = 'matchOver';
    state.phaseEndsAtTick = undefined;
    events.push({ type: 'matchEnded', winnerId: matchWinnerId });
    return;
  }
  state.phase = 'roundOver';
  state.phaseEndsAtTick = state.tick + ROUND_OVER_TICKS;
}

function recordElimination(state: GameState, playerId: PlayerId): void {
  const participant = state.roundParticipants.get(playerId);
  if (participant && participant.eliminatedAtTick === undefined) participant.eliminatedAtTick = state.tick;
}

function scoreRoundOnce(state: GameState, winnerId?: PlayerId, matchWinnerId?: PlayerId): void {
  if (state.roundScored) return;
  const placements = rankRound([...state.roundParticipants.values()]);
  applyRoundScores(state.leaderboard, placements, winnerId, matchWinnerId);
  finalizeMatchStatsRound(state.matchStats, [...state.roundParticipants.keys()], winnerId);
  state.roundPlacements = placements;
  state.roundScored = true;
}

function requireEnoughPlayers(state: GameState): void {
  const connected = [...state.players.values()].filter((player) => player.connected).length;
  if (connected < MIN_PLAYERS || connected > MAX_PLAYERS) {
    throw new Error(`requires ${MIN_PLAYERS}-${MAX_PLAYERS} connected players`);
  }
}

function requirePlayer(state: GameState, playerId: PlayerId): PlayerState {
  const player = state.players.get(playerId);
  if (!player) throw new Error(`unknown player: ${playerId}`);
  return player;
}

function assertPhase(state: GameState, allowed: GamePhase[], command: string): void {
  if (!allowed.includes(state.phase)) throw new Error(`${command} is invalid during ${state.phase}`);
}

function sortedPlayers(state: GameState): PlayerState[] {
  return [...state.players.values()].sort((a, b) => a.slot - b.slot || a.id.localeCompare(b.id));
}

function markCause(
  causes: Map<PlayerId, EliminationCause>,
  causeOwners: Map<PlayerId, Map<EliminationCause, Set<PlayerId>>>,
  playerId: PlayerId,
  cause: EliminationCause,
  ownerId?: PlayerId,
): void {
  const current = causes.get(playerId);
  if (!current || CAUSE_PRIORITY[cause] > CAUSE_PRIORITY[current]) causes.set(playerId, cause);
  if (ownerId === undefined) return;
  let byCause = causeOwners.get(playerId);
  if (!byCause) causeOwners.set(playerId, byCause = new Map());
  let owners = byCause.get(cause);
  if (!owners) byCause.set(cause, owners = new Set());
  owners.add(ownerId);
}

function soleCreditedOwner(
  causeOwners: ReadonlyMap<PlayerId, ReadonlyMap<EliminationCause, ReadonlySet<PlayerId>>>,
  victimId: PlayerId,
  cause: EliminationCause,
): PlayerId | undefined {
  const owners = causeOwners.get(victimId)?.get(cause);
  if (!owners || owners.size !== 1) return undefined;
  const ownerId = owners.values().next().value as PlayerId | undefined;
  return ownerId === victimId ? undefined : ownerId;
}

function normalizeAngle(angle: number): number {
  const tau = Math.PI * 2;
  return ((angle % tau) + tau) % tau;
}

function square(value: number): number {
  return value * value;
}

function rectFromEdges(left: number, top: number, right: number, bottom: number): BlastRect {
  return { x: left, y: top, width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
}

function pointInRect(x: number, y: number, rect: BlastRect): boolean {
  return x >= rect.x - EPSILON && x <= rect.x + rect.width + EPSILON &&
    y >= rect.y - EPSILON && y <= rect.y + rect.height + EPSILON;
}

function sweptCircleIntersectsRect(movement: Movement, radius: number, rect: BlastRect): boolean {
  return segmentIntersectsRect(
    movement.oldX,
    movement.oldY,
    movement.x,
    movement.y,
    { x: rect.x - radius, y: rect.y - radius, width: rect.width + 2 * radius, height: rect.height + 2 * radius },
  );
}

function segmentIntersectsRect(x1: number, y1: number, x2: number, y2: number, rect: BlastRect): boolean {
  if (pointInRect(x1, y1, rect) || pointInRect(x2, y2, rect)) return true;
  const left = rect.x;
  const right = rect.x + rect.width;
  const top = rect.y;
  const bottom = rect.y + rect.height;
  return segmentsIntersect(x1, y1, x2, y2, left, top, right, top) ||
    segmentsIntersect(x1, y1, x2, y2, right, top, right, bottom) ||
    segmentsIntersect(x1, y1, x2, y2, right, bottom, left, bottom) ||
    segmentsIntersect(x1, y1, x2, y2, left, bottom, left, top);
}

function segmentDistanceSquared(
  ax: number, ay: number, bx: number, by: number,
  cx: number, cy: number, dx: number, dy: number,
): number {
  if (segmentsIntersect(ax, ay, bx, by, cx, cy, dx, dy)) return 0;
  return Math.min(
    pointSegmentDistanceSquared(ax, ay, cx, cy, dx, dy),
    pointSegmentDistanceSquared(bx, by, cx, cy, dx, dy),
    pointSegmentDistanceSquared(cx, cy, ax, ay, bx, by),
    pointSegmentDistanceSquared(dx, dy, ax, ay, bx, by),
  );
}

function pointSegmentDistanceSquared(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared <= EPSILON) return square(px - ax) + square(py - ay);
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSquared));
  return square(px - (ax + t * dx)) + square(py - (ay + t * dy));
}

function segmentsIntersect(
  ax: number, ay: number, bx: number, by: number,
  cx: number, cy: number, dx: number, dy: number,
): boolean {
  const o1 = orientation(ax, ay, bx, by, cx, cy);
  const o2 = orientation(ax, ay, bx, by, dx, dy);
  const o3 = orientation(cx, cy, dx, dy, ax, ay);
  const o4 = orientation(cx, cy, dx, dy, bx, by);
  if (((o1 > EPSILON && o2 < -EPSILON) || (o1 < -EPSILON && o2 > EPSILON)) &&
      ((o3 > EPSILON && o4 < -EPSILON) || (o3 < -EPSILON && o4 > EPSILON))) return true;
  return (Math.abs(o1) <= EPSILON && onSegment(ax, ay, bx, by, cx, cy)) ||
    (Math.abs(o2) <= EPSILON && onSegment(ax, ay, bx, by, dx, dy)) ||
    (Math.abs(o3) <= EPSILON && onSegment(cx, cy, dx, dy, ax, ay)) ||
    (Math.abs(o4) <= EPSILON && onSegment(cx, cy, dx, dy, bx, by));
}

function orientation(ax: number, ay: number, bx: number, by: number, cx: number, cy: number): number {
  return (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
}

function onSegment(ax: number, ay: number, bx: number, by: number, px: number, py: number): boolean {
  return px >= Math.min(ax, bx) - EPSILON && px <= Math.max(ax, bx) + EPSILON &&
    py >= Math.min(ay, by) - EPSILON && py <= Math.max(ay, by) + EPSILON;
}

const NEUTRAL_INPUT: InputIntent = Object.freeze({ left: false, right: false, bomb: false });
