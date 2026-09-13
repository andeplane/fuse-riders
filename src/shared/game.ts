import { gunVelocity, cutTrailHole, GUN_SPEED, GUN_RADIUS, GUN_HOLE_RADIUS, GUN_LIFETIME_TICKS } from './gun.js';
import { advanceShell, SHELL_LIFETIME_TICKS, SHELL_SPEED, SHELL_RADIUS, type ShellPoint } from './shell.js';
import { DEFAULT_AVATAR, type AvatarId } from './avatars.js';
import { clipTrailSegment } from './trail-clipping.js';
import { pickupTypeForRoll } from './pickup-weights.js';
import { segmentIntersectsDisk } from './blast-geometry.js';
import { createPortalPair, findPortalTransit, fitPortalPair, type PortalPair, type PortalPoint, type PortalTransit } from './portal.js';
import type {
  AimPoint,
  BombActionCommand,
  BlastCircle,
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
  recordPortalTransit,
  recordSurvivalTick,
  snapshotMatchStats,
  type MatchStatsState,
} from './match-stats.js';
import { DRUNK_DURATION_TICKS, drunkHeadingOffset } from './drunk.js';
import {
  BOMB_FLIGHT_TICKS,
  bombLandingPoint,
  bombLaunchDistance,
} from './bomb-launch.js';
import {
  createVolleyFlightPaths,
  type LaunchBounds,
} from './launch-modifiers.js';

export type { BlastCircle, BombAction, GameEvent, GameSnapshot, PlayerId, TrailSegment } from './protocol.js';

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
export function bombFuseTicks(level = 0): number { return BOMB_FUSE_TICKS - Math.min(2, Math.max(0, level)) * 10; }
export const BOMB_COOLDOWN_TICKS = 80;
export const BOMB_BLAST_RANGE = 90;
export const BLAST_VISIBLE_TICKS = 8;
export const BLAST_LEVEL_RANGE = 25;

export const PICKUP_SPAWN_INTERVAL_TICKS = 80;
export const PICKUP_LIFETIME_TICKS = 300;
export const MAX_ACTIVE_PICKUPS = 3;
export function pickupPacing(elapsedTicks: number): { interval: number; cap: number } {
  const stage = Math.min(3, Math.max(0, Math.floor(elapsedTicks / 400)));
  return { interval: [80, 53, 40, 27][stage]!, cap: MAX_ACTIVE_PICKUPS + stage };
}
export const PICKUP_SPAWN_ATTEMPTS = 24;
export const PICKUP_RADIUS = 14;
export const PICKUP_SPAWN_MARGIN = 40;
export const PICKUP_RIDER_BOMB_CLEARANCE = 80;
export const PICKUP_TRAIL_CLEARANCE = 40;
export const PICKUP_SEPARATION = 28;
export const STAR_DURATION_TICKS = 100;
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
export const INK_DURATION_TICKS = 60;

export type PickupType = 'stopwatch' | 'gun' | 'shell' | 'target' | 'blast' | 'star' | 'beer' | 'ink' | 'triple' | 'five' | 'orbitShield' | 'portal';

export interface PlayerIdentity {
  id: PlayerId;
  name: string;
  slot: number;
  color: string;
  connected?: boolean;
  avatarId?: AvatarId;
}

export interface InputIntent {
  left: boolean;
  right: boolean;
  bomb: boolean;
  bombActions?: readonly BombAction[];
  bombCommands?: readonly BombActionCommand[];
  aim?: AimPoint;
}

export interface PlayerState extends Required<PlayerIdentity> {
  x: number;
  y: number;
  angle: number;
  alive: boolean;
  roundWins: number;
  bombReadyAtTick: number;
  bombChargeStartedTick?: number;
  gunArmed?: boolean; shellArmed?: boolean; targetBombArmed: boolean;
  bombTarget?: AimPoint;
  fuseLevel?: number;
  blastLevel: 0 | 1 | 2;
  invulnerableUntilTick: number;
  drunkUntilTick: number; inkUntilTick: number;
  drunkStartedTick: number;
  drunkHeadingOffset: number;
  tripleShotArmed: boolean; fiveShotArmed: boolean;

  shielded: boolean;
  shieldGraceUntilTick: number;
  portalCooldownUntilTick: number;
  portalGraceUntilTick: number;
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
  placedTick: number;
  explodeAtTick: number;
  blastRange: number; shell?: { vx: number; vy: number; gun?: boolean };
}

export interface BlastState {
  bombId: number;
  ownerId: PlayerId;
  circle: BlastCircle;
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
  portalPair?: PortalPair;
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
    avatarId: identity.avatarId ?? DEFAULT_AVATAR,
    x: state.width / 2,
    y: state.height / 2,
    angle: 0,
    alive: false,
    roundWins: 0,
    bombReadyAtTick: 0,
    blastLevel: 0,
    invulnerableUntilTick: 0,
    drunkUntilTick: 0, inkUntilTick: 0,
    targetBombArmed: false, tripleShotArmed: false, fiveShotArmed: false,
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
  player.bombChargeStartedTick = undefined; player.bombTarget = undefined;
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

/** Aborts unfinished play without scoring and retains the party's session totals. */
export function returnToLobby(state: GameState, newMatchId: string): void {
  const fresh = createGame(newMatchId);
  fresh.leaderboard = state.leaderboard;
  for (const player of sortedPlayers(state)) {
    if (player.connected) addPlayer(fresh, { id: player.id, name: player.name, avatarId: player.avatarId, slot: player.slot, color: player.color, connected: true });
  }
  Object.assign(state, fresh, {
    phaseEndsAtTick: undefined, roundStartedTick: undefined, portalPair: undefined,
    roundWinnerId: undefined, matchWinnerId: undefined,
  });
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
  if (state.portalPair && state.tick >= state.portalPair.expiresAtTick) state.portalPair = undefined;
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
  const trailBounds = portalBounds(state);
  if (state.portalPair) state.portalPair = fitPortalPair(state.portalPair, trailBounds, RIDER_RADIUS);
  for (const player of state.players.values()) {
    const clippedTrail: TrailSegment[] = [];
    for (const segment of player.trail) {
      const clipped = clipTrailSegment(segment, trailBounds);
      if (clipped) clippedTrail.push(clipped);
    }
    player.trail = clippedTrail;
  }

  if (state.tick >= state.nextPickupSpawnTick) {
    state.nextPickupSpawnTick = state.tick + pickupPacing(elapsed).interval;
    maybeSpawnPickup(state);
  }

  const movements = new Map<PlayerId, Movement>();
  for (const player of sortedPlayers(state).filter((candidate) => candidate.alive)) {
    const input = inputs.get(player.id) ?? NEUTRAL_INPUT;
    const direction = Number(input.right) - Number(input.left);
    const offset = drunkHeadingOffset(state.seed, player.id, state.tick, player.drunkStartedTick, player.drunkUntilTick);
    const angle = normalizeAngle(player.angle - player.drunkHeadingOffset + direction * TURN_PER_TICK + offset);
    player.drunkHeadingOffset = offset;
    movements.set(player.id, {
      player,
      oldX: player.x,
      oldY: player.y,
      x: player.x + Math.cos(angle) * MOVE_PER_TICK,
      y: player.y + Math.sin(angle) * MOVE_PER_TICK,
      angle,
    });
  }

  collectPickups(state, movements, events);

  const bounced = new Set<PlayerId>();
  for (const movement of movements.values()) {
    if (isHazardImmune(movement.player, state.tick) && reflectAtBoundary(state, movement)) {
      bounced.add(movement.player.id);
    }
  }

  const shellPaths = new Map<number, ShellPoint[]>();
  for (const bomb of state.bombs.values()) {
    if (!bomb.shell) continue;
    if (state.tick >= bomb.explodeAtTick) { state.bombs.delete(bomb.id); continue; }
    if (bomb.shell.gun) {
      const velocity = gunVelocity(bomb.x, bomb.y, bomb.shell.vx, bomb.shell.vy,
        [...state.players.values()].filter(player => player.alive && player.id !== bomb.ownerId));
      const from = { x: bomb.x, y: bomb.y, t: 0 };
      const to = { x: bomb.x + velocity.vx / TICK_HZ, y: bomb.y + velocity.vy / TICK_HZ, t: 1 };
      const wall = to.x < state.boundaryInset + GUN_RADIUS || to.x > state.width - state.boundaryInset - GUN_RADIUS ||
        to.y < state.boundaryInset + GUN_RADIUS || to.y > state.height - state.boundaryInset - GUN_RADIUS;
      if (wall) { state.bombs.delete(bomb.id); continue; }
      const trailHit = [...state.players.values()].some(player => player.trail.some(trail =>
        !(player.id === bomb.ownerId && state.tick - bomb.launchedTick < 6) &&
        segmentDistanceSquared(from.x, from.y, to.x, to.y, trail.x1, trail.y1, trail.x2, trail.y2) <= square(GUN_RADIUS + TRAIL_WIDTH / 2)));
      if (trailHit) {
        for (const player of state.players.values()) player.trail = player.trail.flatMap(trail => cutTrailHole(trail, to.x, to.y, GUN_HOLE_RADIUS));
        state.bombs.delete(bomb.id); continue;
      }
      shellPaths.set(bomb.id, [from, to]); bomb.x = to.x; bomb.y = to.y;
      bomb.shell = { ...velocity, gun: true }; continue;
    }
    const motion = { x: bomb.x, y: bomb.y, ...bomb.shell };
    shellPaths.set(bomb.id, advanceShell(motion, { left: state.boundaryInset + SHELL_RADIUS,
      right: state.width - state.boundaryInset - SHELL_RADIUS, top: state.boundaryInset + SHELL_RADIUS,
      bottom: state.height - state.boundaryInset - SHELL_RADIUS }));
    bomb.x = motion.x; bomb.y = motion.y; bomb.shell = { vx: motion.vx, vy: motion.vy };
  }
  const newBlasts = resolveExplosions(state, events);
  if (newBlasts.length > 0) {

    for (const player of state.players.values()) {
      player.trail = player.trail.filter((segment) =>
        !newBlasts.some((blast) => segmentIntersectsDisk(segment.x1, segment.y1, segment.x2, segment.y2, blast.circle, TRAIL_WIDTH / 2)),
      );
    }
  }

  const causes = new Map<PlayerId, EliminationCause>();
  const causeOwners = new Map<PlayerId, Map<EliminationCause, Set<PlayerId>>>();
  // Bombs only hit on landing; shells sweep their path to avoid tunnelling.
  for (const bomb of state.bombs.values()) {
    if (bomb.launchedTick >= state.tick || bomb.landsAtTick < state.tick) continue;
    if (!bomb.shell) {
      if (bomb.landsAtTick !== state.tick) continue;
      for (const movement of movements.values()) {
        if (movement.player.id === bomb.ownerId || isHazardImmune(movement.player, state.tick)) continue;
        if (square(movement.x - bomb.x) + square(movement.y - bomb.y) <= square(RIDER_RADIUS + SHELL_RADIUS)) {
          markCause(causes, causeOwners, movement.player.id, 'explosion', bomb.ownerId);
        }
      }
      continue;
    }
    const path = shellPaths.get(bomb.id) ?? [];
    let hit: Movement | undefined; let hitTime = Infinity;
    for (let i = 1; i < path.length; i++) {
      const start = path[i - 1]!; const end = path[i]!;
      for (const movement of movements.values()) {
        if ((movement.player.id === bomb.ownerId && (state.tick - bomb.launchedTick < 6)) || isHazardImmune(movement.player, state.tick)) continue;
        const mx = movement.x - movement.oldX; const my = movement.y - movement.oldY;
        const px = start.x - movement.oldX - mx * start.t; const py = start.y - movement.oldY - my * start.t;
        const vx = end.x - start.x - mx * (end.t - start.t); const vy = end.y - start.y - my * (end.t - start.t);
        const radius = RIDER_RADIUS + (bomb.shell.gun ? GUN_RADIUS : SHELL_RADIUS);
        const c = px * px + py * py - radius * radius;
        const a = vx * vx + vy * vy; const b = 2 * (px * vx + py * vy);
        const discriminant = b * b - 4 * a * c;
        const contact = c <= 0 ? 0 : a > 0 && discriminant >= 0 ? (-b - Math.sqrt(discriminant)) / (2 * a) : Infinity;
        const time = start.t + contact * (end.t - start.t);
        if (contact >= 0 && contact <= 1 && time < hitTime) {
          hit = movement; hitTime = time;
        }
      }
    }
    if (hit) {
      markCause(causes, causeOwners, hit.player.id, 'explosion', bomb.ownerId);
      state.bombs.delete(bomb.id);
    }
  }

  for (const movement of movements.values()) {
    for (const blast of newBlasts) {
      if (!isHazardImmune(movement.player, state.tick) && segmentIntersectsDisk(movement.oldX, movement.oldY, movement.x, movement.y, blast.circle, RIDER_RADIUS)) {
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
        // Portal grace is defensive: neither rider is harmed by this contact.
        if (a.player.portalGraceUntilTick > state.tick || b.player.portalGraceUntilTick > state.tick) continue;
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

  const transits = new Map<PlayerId, PortalTransit>();
  for (const movement of movementList) {
    if (causes.has(movement.player.id)) continue;
    const transit = findPortalTransit({
      pair: state.portalPair, tick: state.tick,
      from: { x: movement.oldX, y: movement.oldY }, to: movement,
      heading: movement.angle, cooldownUntilTick: movement.player.portalCooldownUntilTick,
      bounds: portalBounds(state), riderRadius: RIDER_RADIUS,
      isSafeExit: (point, radius) => isSafePortalPosition(state, point, radius, movements, movement.player.id, causes, transits),
    });
    if (transit) transits.set(movement.player.id, transit);
  }

  for (const movement of movementList) {
    const travelledTo = transits.get(movement.player.id)?.entryPoint ?? movement;
    recordSurvivalTick(
      state.matchStats,
      movement.player.id,
      Math.hypot(travelledTo.x - movement.oldX, travelledTo.y - movement.oldY),
      isInvulnerable(movement.player, state.tick),
      bounced.has(movement.player.id),
    );
  }

  for (const movement of movementList) {
    const cause = causes.get(movement.player.id);
    if (cause) {
      movement.player.alive = false;
      movement.player.bombChargeStartedTick = undefined; movement.player.bombTarget = undefined;
      recordElimination(state, movement.player.id);
      recordDeath(state.matchStats, movement.player.id, cause, soleCreditedOwner(causeOwners, movement.player.id, cause));
      events.push({ type: 'playerEliminated', playerId: movement.player.id, cause });
      continue;
    }
    const transit = transits.get(movement.player.id);
    movement.player.x = transit?.exitPoint.x ?? movement.x;
    movement.player.y = transit?.exitPoint.y ?? movement.y;
    if (transit) {
      movement.player.portalCooldownUntilTick = transit.cooldownUntilTick;
      movement.player.portalGraceUntilTick = transit.graceUntilTick;
      recordPortalTransit(state.matchStats, movement.player.id);
    }
    movement.player.angle = movement.angle;
    const trail = clipTrailSegment({
      x1: movement.oldX,
      y1: movement.oldY,
      x2: transit?.entryPoint.x ?? movement.x,
      y2: transit?.entryPoint.y ?? movement.y,
      createdTick: state.tick,
      expiresAtTick: state.tick + TRAIL_LIFETIME_TICKS,
    }, trailBounds);
    if (trail) movement.player.trail.push(trail);
  }
  // Target every launch against the same committed tick, independent of player slot.
  for (const movement of movementList) {
    if (movement.player.alive) {
      const input = inputs.get(movement.player.id);
      applyBombActions(state, movement.player, input?.bombCommands ?? input?.bombActions?.map(action => ({ action, aim: input.aim })) ?? [], events);
      if (movement.player.targetBombArmed && !movement.player.shellArmed && !movement.player.gunArmed && movement.player.bombChargeStartedTick !== undefined) movement.player.bombTarget = targetPoint(state, movement.player, input?.aim, movement.player.bombTarget);
    }
  }

  // Resolve released Target Bombs in this same tick, after every rider has launched.
  const instantBlasts = resolveExplosions(state, events);
  if (instantBlasts.length) {
    for (const player of state.players.values()) {
      player.trail = player.trail.filter(segment => !instantBlasts.some(blast =>
        segmentIntersectsDisk(segment.x1, segment.y1, segment.x2, segment.y2, blast.circle, TRAIL_WIDTH / 2)));
      if (!player.alive || isHazardImmune(player, state.tick)) continue;
      const hits = instantBlasts.filter(blast => segmentIntersectsDisk(player.x, player.y, player.x, player.y, blast.circle, RIDER_RADIUS));
      if (!hits.length) continue;
      if (player.shielded) { player.shielded = false; player.shieldGraceUntilTick = state.tick + SHIELD_GRACE_TICKS; continue; }
      player.alive = false; player.bombChargeStartedTick = undefined; player.bombTarget = undefined;
      recordElimination(state, player.id);
      const owners = new Set(hits.map(blast => blast.ownerId));
      recordDeath(state.matchStats, player.id, 'explosion', owners.size === 1 ? hits[0]!.ownerId : undefined);
      events.push({ type: 'playerEliminated', playerId: player.id, cause: 'explosion' });
    }
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
      avatarId: player.avatarId,
      slot: player.slot,
      color: player.color,
      connected: player.connected,
      x: player.x,
      y: player.y,
      angle: player.angle,
      alive: player.alive,
      waitingForNextRound: state.phase !== 'lobby' && !state.roundParticipants.has(player.id),
      roundWins: player.roundWins,
      bombReadyAtTick: player.bombReadyAtTick,
      ...(player.bombChargeStartedTick === undefined ? {} : { bombChargeStartedTick: player.bombChargeStartedTick }),
      fuseLevel: player.fuseLevel ?? 0, blastLevel: player.blastLevel,
      invulnerableUntilTick: player.invulnerableUntilTick,
      drunkUntilTick: player.drunkUntilTick,
      inkUntilTick: player.inkUntilTick,
      gunArmed: player.gunArmed, shellArmed: player.shellArmed, targetBombArmed: player.targetBombArmed, ...(player.bombTarget ? { bombTarget: { ...player.bombTarget } } : {}), tripleShotArmed: player.tripleShotArmed, fiveShotArmed: player.fiveShotArmed,
      shielded: player.shielded,
      shieldGraceUntilTick: player.shieldGraceUntilTick,
      portalCooldownUntilTick: player.portalCooldownUntilTick,
      portalGraceUntilTick: player.portalGraceUntilTick,
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
      explodeAtTick: bomb.explodeAtTick,
      blastRange: bomb.blastRange, ...(bomb.shell ? { shell: { ...bomb.shell } } : {}),
    })),
    blasts: state.blasts.map((blast) => ({
      bombId: blast.bombId,
      circle: { ...blast.circle },
      expiresAtTick: blast.expiresAtTick,
    })),
    ...(state.portalPair ? { portalPair: { ...state.portalPair, gates: [{ ...state.portalPair.gates[0] }, { ...state.portalPair.gates[1] }] as const } } : {}),
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
  state.portalPair = undefined;
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
    player.bombChargeStartedTick = undefined; player.bombTarget = undefined;
    player.bombReadyAtTick = state.tick;
    player.fuseLevel = 0; player.blastLevel = 0;
    player.invulnerableUntilTick = 0;
    player.drunkUntilTick = 0;
    player.drunkStartedTick = 0;
    player.drunkHeadingOffset = 0;
    player.inkUntilTick = 0;
    player.gunArmed = false; player.shellArmed = false; player.targetBombArmed = false;
    player.tripleShotArmed = false; player.fiveShotArmed = false;
    player.shielded = false;
    player.shieldGraceUntilTick = 0;
    player.portalCooldownUntilTick = 0;
    player.portalGraceUntilTick = 0;
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
  if (state.pickups.length >= pickupPacing(state.tick - (state.roundStartedTick ?? state.tick)).cap) return;
  const typeRoll = nextRandom(state);
  const type = pickupTypeForRoll(typeRoll);
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

function collectPickups(state: GameState, movements: ReadonlyMap<PlayerId, Movement>, events: GameEvent[]): void {
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
    if (pickup.type === 'portal') {
      // Safety disks conservatively cover the entire portal wall plus rider clearance.
      const pair = createPortalPair({ id: `${state.round}:${pickup.id}:${state.tick}`, tick: state.tick,
        bounds: portalBounds(state), riderRadius: RIDER_RADIUS, random: () => nextRandom(state),
        isSafe: (point, radius) => isSafePortalPosition(state, point, radius, movements),
      });
      if (!pair) continue;
      state.portalPair = pair;
    }
    consumed.add(pickup.id);
    events.push({ type: 'pickupCollected', playerId: collector.id, pickupId: pickup.id });
    recordPickup(state.matchStats, collector.id, pickup.type);
    if (pickup.type === 'stopwatch') {
      collector.fuseLevel = Math.min(2, (collector.fuseLevel ?? 0) + 1);
    } else if (pickup.type === 'gun') {
      collector.gunArmed = true;
    } else if (pickup.type === 'shell') {
      collector.shellArmed = true;
    } else if (pickup.type === 'target') {
      collector.targetBombArmed = true;
    } else if (pickup.type === 'blast') {
      collector.blastLevel = Math.min(2, collector.blastLevel + 1) as 0 | 1 | 2;
    } else if (pickup.type === 'star') {
      collector.invulnerableUntilTick = Math.max(collector.invulnerableUntilTick, state.tick + STAR_DURATION_TICKS);
    } else if (pickup.type === 'ink') {
      for (const player of state.players.values()) {
        if (player.alive && player.id !== collector.id) player.inkUntilTick = Math.max(player.inkUntilTick, state.tick + INK_DURATION_TICKS);
      }
    } else if (pickup.type === 'beer') {
      for (const player of state.players.values()) {
        if (player.alive && player.id !== collector.id) {
          if (player.drunkUntilTick <= state.tick) player.drunkStartedTick = state.tick;
          player.drunkUntilTick = Math.max(player.drunkUntilTick, state.tick + DRUNK_DURATION_TICKS);
        }
      }
    } else if (pickup.type === 'five') {
      collector.fiveShotArmed = true;
    } else if (pickup.type === 'triple') {
      collector.tripleShotArmed = true;
    } else if (pickup.type === 'orbitShield') {
      collector.shielded = true;
    }
  }
  if (consumed.size > 0) state.pickups = state.pickups.filter((pickup) => !consumed.has(pickup.id));
}

function portalBounds(state: GameState) {
  return { minX: state.boundaryInset, minY: state.boundaryInset,
    maxX: state.width - state.boundaryInset, maxY: state.height - state.boundaryInset };
}

function isSafePortalPosition(
  state: GameState, point: PortalPoint, radius: number,
  movements: ReadonlyMap<PlayerId, Movement>, ignoredPlayerId?: PlayerId,
  deaths: ReadonlyMap<PlayerId, EliminationCause> = new Map(),
  transits: ReadonlyMap<PlayerId, PortalTransit> = new Map(),
): boolean {
  for (const player of state.players.values()) {
    const movement = movements.get(player.id);
    const transit = transits.get(player.id);
    if (player.id !== ignoredPlayerId && player.alive && !deaths.has(player.id)) {
      const position = transit?.exitPoint ?? movement ?? player;
      if (Math.hypot(position.x - point.x, position.y - point.y) <= radius + RIDER_RADIUS) return false;
    }
    for (const trail of player.trail) {
      if (pointSegmentDistanceSquared(point.x, point.y, trail.x1, trail.y1, trail.x2, trail.y2) <= square(radius + TRAIL_WIDTH / 2)) return false;
    }
    // Include this tick's pending trail, which has not yet been committed.
    if (movement && !deaths.has(player.id) && pointSegmentDistanceSquared(point.x, point.y,
      movement.oldX, movement.oldY, transit?.entryPoint.x ?? movement.x, transit?.entryPoint.y ?? movement.y) <= square(radius + TRAIL_WIDTH / 2)) return false;
  }
  // Reserve both current flight location and landing site of every bomb.
  for (const bomb of state.bombs.values()) {
    const flight = bomb.flightPath[Math.max(0, Math.min(bomb.flightPath.length - 1, state.tick - bomb.launchedTick))];
    if (Math.hypot(point.x - bomb.x, point.y - bomb.y) <= radius + 14 ||
      (flight && Math.hypot(point.x - flight.x, point.y - flight.y) <= radius + 14)) return false;
  }
  return !state.blasts.some(blast => segmentIntersectsDisk(point.x, point.y, point.x, point.y, blast.circle, radius));
}

function isInvulnerable(player: PlayerState, tick: number): boolean {
  return player.invulnerableUntilTick > tick;
}

function isHazardImmune(player: PlayerState, tick: number): boolean {
  return isInvulnerable(player, tick) || player.shieldGraceUntilTick > tick || player.portalGraceUntilTick > tick;
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
  if (hitX) { movement.angle = normalizeAngle(Math.PI - movement.angle); movement.player.drunkHeadingOffset *= -1; }
  if (hitY) { movement.angle = normalizeAngle(-movement.angle); movement.player.drunkHeadingOffset *= -1; }
  return true;
}

function targetPoint(state: GameState, player: PlayerState, aim?: AimPoint, previous?: AimPoint): AimPoint {
  const x = aim ? aim.x * state.width : previous?.x ?? player.x + Math.cos(player.angle) * 100;
  const y = aim ? aim.y * state.height : previous?.y ?? player.y + Math.sin(player.angle) * 100;
  return { x: Math.max(state.boundaryInset + RIDER_RADIUS, Math.min(state.width - state.boundaryInset - RIDER_RADIUS, x)),
    y: Math.max(state.boundaryInset + RIDER_RADIUS, Math.min(state.height - state.boundaryInset - RIDER_RADIUS, y)) };
}

function applyBombActions(state: GameState, player: PlayerState, actions: readonly BombActionCommand[], events: GameEvent[]): void {
  for (const command of actions) {
    const { action } = command;
    if (action === 'cancel') {
      player.bombChargeStartedTick = undefined; player.bombTarget = undefined;
      continue;
    }
    if (action === 'press') {
      const ownsBomb = [...state.bombs.values()].some((bomb) => bomb.ownerId === player.id);
      if (player.bombChargeStartedTick === undefined && !ownsBomb && player.bombReadyAtTick <= state.tick) {
        player.bombChargeStartedTick = state.tick;
        if (player.targetBombArmed && !player.shellArmed && !player.gunArmed) player.bombTarget = targetPoint(state, player, command.aim);
      }
      continue;
    }

    const target = player.targetBombArmed ? targetPoint(state, player, command.aim, player.bombTarget) : undefined;
    const chargeStartedTick = player.bombChargeStartedTick;
    player.bombChargeStartedTick = undefined; player.bombTarget = undefined;
    if (chargeStartedTick === undefined) continue;
    const ownsBomb = [...state.bombs.values()].some((bomb) => bomb.ownerId === player.id);
    if (ownsBomb || player.bombReadyAtTick > state.tick) continue;
    if (player.shellArmed || player.gunArmed) {
      const gun = player.gunArmed === true;
      const lifetime = gun ? GUN_LIFETIME_TICKS : SHELL_LIFETIME_TICKS;
      const speed = gun ? GUN_SPEED : SHELL_SPEED;
      const id = state.nextBombId++;
      state.bombs.set(id, { id, ownerId: player.id, launchX: player.x, launchY: player.y,
        x: player.x, y: player.y, launchedTick: state.tick, placedTick: state.tick,
        landsAtTick: state.tick + lifetime, explodeAtTick: state.tick + lifetime,
        blastRange: 0, flightPath: [], shell: { vx: Math.cos(player.angle) * speed, vy: Math.sin(player.angle) * speed, ...(gun ? { gun: true } : {}) } });
      if (gun) player.gunArmed = false; else player.shellArmed = false;
      player.bombReadyAtTick = state.tick + BOMB_COOLDOWN_TICKS;
      recordBombPlaced(state.matchStats, player.id);
      events.push({ type: 'bombPlaced', bombId: id, playerId: player.id });
      continue;
    }
    const distance = bombLaunchDistance(state.tick - chargeStartedTick);
    const bounds: LaunchBounds = {
      minX: state.boundaryInset + RIDER_RADIUS,
      maxX: state.width - state.boundaryInset - RIDER_RADIUS,
      minY: state.boundaryInset + RIDER_RADIUS,
      maxY: state.height - state.boundaryInset - RIDER_RADIUS,
    };
    const paths = target ? [[{ ...target, angle: player.angle }]] : player.tripleShotArmed || player.fiveShotArmed
      ? createVolleyFlightPaths(player, player.angle, distance, bounds, player.fiveShotArmed ? 5 : 3)
      : [createStraightFlightPath(player.x, player.y, player.angle, distance, bounds)];
    if (target) player.targetBombArmed = false;
    else { player.tripleShotArmed = false; player.fiveShotArmed = false; }
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
        landsAtTick: target ? state.tick : state.tick + BOMB_FLIGHT_TICKS,
        explodeAtTick: target ? state.tick : state.tick + bombFuseTicks(player.fuseLevel),
        blastRange: (BOMB_BLAST_RANGE + player.blastLevel * BLAST_LEVEL_RANGE) * (target ? .7 : 1),
        flightPath,
      };
      state.bombs.set(bomb.id, bomb);
      recordBombPlaced(state.matchStats, player.id);
      events.push({ type: 'bombPlaced', bombId: bomb.id, playerId: player.id });
    }
    player.bombReadyAtTick = state.tick + BOMB_COOLDOWN_TICKS;
  }
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
    .filter((bomb) => !bomb.shell && bomb.landsAtTick <= state.tick && (bomb.explodeAtTick <= state.tick ||
      state.blasts.some(blast => segmentIntersectsDisk(bomb.x, bomb.y, bomb.x, bomb.y, blast.circle))))
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
    const circle = { x: bomb.x, y: bomb.y, radius: bomb.blastRange };
    result.push({ bombId: id, ownerId: bomb.ownerId, circle, expiresAtTick: state.tick + BLAST_VISIBLE_TICKS });
    recordBombExploded(state.matchStats, bomb.ownerId);
    events.push({ type: 'explosion', bombId: id });

    for (const candidate of [...state.bombs.values()].sort((a, b) => a.id - b.id)) {
      if (exploded.has(candidate.id) || queued.has(candidate.id)) continue;
      if (candidate.shell || candidate.landsAtTick > state.tick) continue;
      if (segmentIntersectsDisk(candidate.x, candidate.y, candidate.x, candidate.y, circle)) {
        queued.add(candidate.id);
        queue.push(candidate.id);
      }
    }
  }
  for (const id of exploded) state.bombs.delete(id);
  state.blasts.push(...result);
  return result;
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
    if (winner.roundWins >= 3) {
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
