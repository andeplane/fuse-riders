import type {
  BlastRect,
  GameEvent,
  GameSnapshot,
  PlayerId,
  TrailSegment,
} from './protocol.js';

export type { BlastRect, GameEvent, GameSnapshot, PlayerId, TrailSegment } from './protocol.js';

export const TICK_HZ = 20;
export const SNAPSHOT_HZ = 10;
export const MAX_CATCH_UP_STEPS = 5;
export const MAX_PLAYERS = 5;
export const MIN_PLAYERS = 2;

export const ARENA_WIDTH = 1200;
export const ARENA_HEIGHT = 700;
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
}

export interface PlayerState extends Required<PlayerIdentity> {
  x: number;
  y: number;
  angle: number;
  alive: boolean;
  roundWins: number;
  bombReadyAtTick: number;
  previousBombInput: boolean;
  trail: TrailSegment[];
}

export interface BombState {
  id: number;
  ownerId: PlayerId;
  x: number;
  y: number;
  placedTick: number;
  explodeAtTick: number;
}

export interface BlastState {
  bombId: number;
  rects: BlastRect[];
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
  nextBombId: number;
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

export function createGame(matchId: string): GameState {
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
    nextBombId: 1,
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
    previousBombInput: false,
    trail: [],
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
  requirePlayer(state, playerId).alive = false;
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

  if (state.phase === 'countdown' && state.phaseEndsAtTick !== undefined && state.tick >= state.phaseEndsAtTick) {
    state.phase = 'playing';
    state.phaseEndsAtTick = undefined;
    state.roundStartedTick = state.tick;
  }

  if (state.phase !== 'playing') return { snapshot: toSnapshot(state), events };

  const elapsed = state.tick - (state.roundStartedTick ?? state.tick);
  state.boundaryInset = INITIAL_BOUNDARY_INSET +
    Math.max(0, elapsed - OVERTIME_START_TICK) * OVERTIME_INSET_PER_TICK;

  const movements = new Map<PlayerId, Movement>();
  for (const player of sortedPlayers(state).filter((candidate) => candidate.alive)) {
    const input = inputs.get(player.id) ?? NEUTRAL_INPUT;
    const direction = Number(input.right) - Number(input.left);
    const angle = normalizeAngle(player.angle + direction * TURN_PER_TICK);
    movements.set(player.id, {
      player,
      oldX: player.x,
      oldY: player.y,
      x: player.x + Math.cos(angle) * MOVE_PER_TICK,
      y: player.y + Math.sin(angle) * MOVE_PER_TICK,
      angle,
    });
  }

  for (const movement of movements.values()) {
    const input = inputs.get(movement.player.id) ?? NEUTRAL_INPUT;
    const risingBomb = input.bomb && !movement.player.previousBombInput;
    movement.player.previousBombInput = input.bomb;
    const ownsBomb = [...state.bombs.values()].some((bomb) => bomb.ownerId === movement.player.id);
    if (risingBomb && !ownsBomb && movement.player.bombReadyAtTick <= state.tick) {
      const bomb: BombState = {
        id: state.nextBombId++,
        ownerId: movement.player.id,
        x: movement.oldX,
        y: movement.oldY,
        placedTick: state.tick,
        explodeAtTick: state.tick + BOMB_FUSE_TICKS,
      };
      state.bombs.set(bomb.id, bomb);
      movement.player.bombReadyAtTick = state.tick + BOMB_COOLDOWN_TICKS;
      events.push({ type: 'bombPlaced', bombId: bomb.id, playerId: movement.player.id });
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
  for (const movement of movements.values()) {
    for (const blast of newBlasts) {
      if (blast.rects.some((rect) => sweptCircleIntersectsRect(movement, RIDER_RADIUS, rect))) {
        markCause(causes, movement.player.id, 'explosion');
        break;
      }
    }

    const left = state.boundaryInset + RIDER_RADIUS;
    const right = state.width - state.boundaryInset - RIDER_RADIUS;
    const top = state.boundaryInset + RIDER_RADIUS;
    const bottom = state.height - state.boundaryInset - RIDER_RADIUS;
    if (movement.x < left || movement.x > right || movement.y < top || movement.y > bottom) {
      markCause(causes, movement.player.id, 'wall');
    }

    trailCheck: for (const owner of state.players.values()) {
      for (const trail of owner.trail) {
        if (
          owner.id === movement.player.id &&
          trail.createdTick > state.tick - SELF_TRAIL_GRACE_TICKS
        ) continue;
        if (segmentDistanceSquared(
          movement.oldX, movement.oldY, movement.x, movement.y,
          trail.x1, trail.y1, trail.x2, trail.y2,
        ) <= square(RIDER_RADIUS + TRAIL_WIDTH / 2) + EPSILON) {
          markCause(causes, movement.player.id, 'trail');
          break trailCheck;
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
        markCause(causes, a.player.id, 'rider');
        markCause(causes, b.player.id, 'rider');
      }
    }
  }

  for (const movement of movementList) {
    const cause = causes.get(movement.player.id);
    if (cause) {
      movement.player.alive = false;
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
      trail: player.trail.map((segment) => ({ ...segment })),
    })),
    bombs: [...state.bombs.values()].sort((a, b) => a.id - b.id).map((bomb) => ({
      id: bomb.id,
      ownerId: bomb.ownerId,
      x: bomb.x,
      y: bomb.y,
      explodeAtTick: bomb.explodeAtTick,
    })),
    blasts: state.blasts.map((blast) => ({
      bombId: blast.bombId,
      rects: blast.rects.map((rect) => ({ ...rect })),
      expiresAtTick: blast.expiresAtTick,
    })),
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
  state.roundWinnerId = undefined;
  state.matchWinnerId = undefined;
  state.nextBombId = 1;

  for (const player of state.players.values()) {
    player.alive = false;
    player.trail = [];
    player.previousBombInput = false;
    player.bombReadyAtTick = state.tick;
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

function resolveExplosions(state: GameState, events: GameEvent[]): BlastState[] {
  const queue = [...state.bombs.values()]
    .filter((bomb) => bomb.explodeAtTick <= state.tick)
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
    result.push({ bombId: id, rects, expiresAtTick: state.tick + BLAST_VISIBLE_TICKS });
    events.push({ type: 'explosion', bombId: id });

    for (const candidate of [...state.bombs.values()].sort((a, b) => a.id - b.id)) {
      if (exploded.has(candidate.id) || queued.has(candidate.id)) continue;
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
  const horizontalLeft = Math.max(left, bomb.x - BOMB_BLAST_RANGE);
  const horizontalRight = Math.min(right, bomb.x + BOMB_BLAST_RANGE);
  const horizontalTop = Math.max(top, bomb.y - BOMB_BLAST_HALF_WIDTH);
  const horizontalBottom = Math.min(bottom, bomb.y + BOMB_BLAST_HALF_WIDTH);
  const verticalLeft = Math.max(left, bomb.x - BOMB_BLAST_HALF_WIDTH);
  const verticalRight = Math.min(right, bomb.x + BOMB_BLAST_HALF_WIDTH);
  const verticalTop = Math.max(top, bomb.y - BOMB_BLAST_RANGE);
  const verticalBottom = Math.min(bottom, bomb.y + BOMB_BLAST_RANGE);
  return [
    rectFromEdges(horizontalLeft, horizontalTop, horizontalRight, horizontalBottom),
    rectFromEdges(verticalLeft, verticalTop, verticalRight, verticalBottom),
  ];
}

function resolveRound(state: GameState, events: GameEvent[], elapsed: number): void {
  if (state.phase !== 'playing') return;
  const alive = sortedPlayers(state).filter((player) => player.alive);
  if (alive.length > 1 && elapsed < ROUND_DRAW_TICK) return;

  if (alive.length === 1) {
    const winner = alive[0]!;
    winner.roundWins += 1;
    state.roundWinnerId = winner.id;
    events.push({ type: 'roundEnded', winnerId: winner.id });
    if (winner.roundWins >= 5) {
      state.phase = 'matchOver';
      state.phaseEndsAtTick = undefined;
      state.matchWinnerId = winner.id;
      events.push({ type: 'matchEnded', winnerId: winner.id });
      return;
    }
  } else {
    state.roundWinnerId = undefined;
    events.push({ type: 'roundEnded' });
  }
  state.phase = 'roundOver';
  state.phaseEndsAtTick = state.tick + ROUND_OVER_TICKS;
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

function markCause(causes: Map<PlayerId, EliminationCause>, playerId: PlayerId, cause: EliminationCause): void {
  const current = causes.get(playerId);
  if (!current || CAUSE_PRIORITY[cause] > CAUSE_PRIORITY[current]) causes.set(playerId, cause);
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
