import { cos, sin } from "./deterministic-math.js";
import { normalizeAngle } from "./geometry.js";
import { hashSeed, nextRandom, normalizeSeed } from "./rng.js";
import { DEFAULT_AVATAR } from "../shared/avatars.js";
import {
  type ClearCapsule,
  OBSTACLE_WALL_MARGIN,
  chooseArenaMap,
  generateObstacles,
  initialBoundaryInset,
} from "./arena-map.js";
import { beginMatchParticipant, recordEarlyExit } from "./match-stats.js";
import { createTickContext } from "./sim/context.js";
import { PHASES, TickFault, type Phase } from "./sim/pipeline.js";
export { PHASES, TickFault, type Phase } from "./sim/pipeline.js";
import {
  ARENA_HEIGHT,
  ARENA_WIDTH,
  BOMB_COOLDOWN_TICKS,
  COUNTDOWN_TICKS,
  INITIAL_BOUNDARY_INSET,
  MAX_PLAYERS,
  MIN_PLAYERS,
  SPAWN_CORRIDOR_LENGTH,
  SPAWN_CORRIDOR_RADIUS,
} from "./tuning.js";
import type { RoomSettings } from "./room-settings.js";
import {
  type GameEvent,
  type GamePhase,
  type GameState,
  type InputIntent,
  type PlayerId,
  type PlayerIdentity,
  type PlayerState,
  sortedPlayers,
} from "./state.js";
import { takeOutOfRound } from "./sim/riders.js";
export { segmentDistanceSquared } from "./geometry.js";
export { PICKUP_TYPES, type PickupType } from "./pickup-types.js";
export { pickupPacing } from "./power-progression.js";
// `createGame` takes them, so whoever can build a game can name what it is played under.
export { defaultRoomSettings, type RoomSettings } from "./room-settings.js";

export * from "./state.js";
export { toView } from "./view.js";
export { gravityBend } from "./gravity.js";
export * from "./tuning.js";

/** What a tick reports. A caller that wants the public snapshot asks `toView(state)` for it. */
export interface TickResult {
  events: GameEvent[];
}

/** A lobby under `settings`. There is no default: whoever builds a game says what it is played under. */
export function createGame(
  matchId: string,
  settings: RoomSettings,
  seed = hashSeed(matchId),
): GameState {
  if (!matchId) throw new Error("matchId is required");
  return {
    settings,
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
    rangeLevel: 0,
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
  takeOutOfRound(state, player);
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
  const fresh = createGame(newMatchId, state.settings);
  fresh.leaderboard = state.leaderboard;
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

/**
 * One tick: the early-out and a loop over PHASES, which is where the order of a tick is written down. `phases` is the
 * seam a test uses to put a failing phase into the tick; nothing else passes it. A phase that throws surfaces as a
 * `TickFault` naming it, and the state is left part-way through the tick exactly as a throw always left it.
 */
export function step(
  state: GameState,
  inputs: ReadonlyMap<PlayerId, InputIntent>,
  phases: readonly Phase[] = PHASES,
): TickResult {
  const ctx = createTickContext(state, inputs);
  for (const phase of phases) {
    // The early-out: with no round in play the tick ends once the clock, the expiries and the countdown have run.
    if (phase.when === "playing" && state.phase !== "playing") break;
    try {
      phase.run(ctx);
    } catch (error) {
      throw new TickFault(state.tick, phase.name, error);
    }
  }
  return { events: ctx.events };
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
    player.rangeLevel = 0;
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
  state.map = chooseArenaMap(state.settings.map, state.seed, state.round);
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
