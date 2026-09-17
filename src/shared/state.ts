/**
 * The simulation's state: plain typed records, so rollback can clone them and the checkpoint guards can name every
 * field. Anything that reads a Map or an array where order decides an outcome goes through the `sorted*` readers.
 */
import type { ArenaMapId, Obstacle } from "./arena-map.js";
import type {
  RoundParticipant,
  RoundPlacement,
  SessionLeaderboardEntry,
} from "./leaderboard.js";
import type { MatchStatsState } from "./match-stats.js";
import type { Moment } from "./moments.js";
import type { PickupType } from "./pickup-types.js";
import type { PortalPair } from "./portal.js";
import type { FlightPoint } from "./launch-modifiers.js";
// The one engine module that names wire types: every other engine file reads them from here (issue #254 moves them).
import type {
  AimPoint,
  AvatarId,
  BlastCircle,
  BombActionCommand,
  PlayerId,
  TrailSegment,
} from "./protocol.js";
export type {
  AimPoint,
  BlastCircle,
  BombAction,
  BombActionCommand,
  GameEvent,
  GameSnapshot,
  PlayerId,
  TrailSegment,
} from "./protocol.js";
export type { FlightPoint } from "./launch-modifiers.js";
import type { RoomSettings } from "./room-settings.js";
import type { DecidedRound, RoundShot } from "./shot-log.js";

export type GamePhase =
  "lobby" | "countdown" | "playing" | "roundOver" | "matchOver";
export type EliminationCause = "wall" | "trail" | "explosion" | "rider";

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
  /** Eased aiming slowdown, 0 to AIM_SLOW_RAMP_TICKS, and the budget it has used, 0 to AIM_SLOW_MAX_TICKS: see `nextAimSlow`. */
  aimSlowTicks: number;
  aimSlowSpentTicks: number;
  gunArmed?: boolean;
  shellArmed?: boolean;
  targetBombArmed: boolean;
  bombTarget?: AimPoint;
  /** Permanent ordinary-shot bonus for this round, bounded by MAX_EXTRA_BOMBS. */
  extraBombs: number;
  fuseLevel: number;
  powerPickups: number;
  /** Captured at launch so collecting a level never distorts an active reload ring. */
  reloadDurationTicks: number;
  invulnerableUntilTick: number;
  /** One absolute deadline per Nitro collected, unexpired ones only: each doubles speed, so they stack (#240). */
  nitroUntilTicks: number[];
  /** One absolute deadline per rival Snail, unexpired ones only: each halves speed, cancelling a Nitro one for one (#240). */
  snailUntilTicks: number[];
  /** Once-per-round steering upgrade; also marks this rider ineligible for further GRIP drops. */
  grip: boolean;
  drunkUntilTick: number;
  inkUntilTick: number;
  drunkStartedTick: number;
  drunkHeadingOffset: number;
  tripleShotArmed: boolean;
  fiveShotArmed: boolean;

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
  /** `bounces` counts a shell's wall and trail reflections since launch; a gun bullet never bounces and never carries it. */
  blastRange: number;
  shell?: { vx: number; vy: number; gun?: boolean; bounces?: number };
  /** A shell's own portal re-entry cooldown, so a gate pair it is aimed down cannot hold it in a loop. */
  portalCooldownUntilTick?: number;
  /**
   * The trigger pull that put this bomb in the air — its entry in `GameState.shots` — so a kill can name the shot.
   * Statistics only: nothing in the simulation reads it, and it never reaches a public snapshot. Optional as defence
   * in depth at the checkpoint boundary: a bomb that arrives without one kills without being logged against a shot.
   */
  shot?: number;
}

/** A black hole: headings bend toward (x, y) anywhere inside `radius`. */
export interface GravityField {
  x: number;
  y: number;
  radius: number;
  expiresAtTick: number;
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
  /** Round-long: MAX_SAFE_INTEGER keeps snapshots finite and pickup sprites fully visible. */
  expiresAtTick: number;
}

export interface GameState {
  settings?: RoomSettings;
  matchId: string;
  round: number;
  tick: number;
  phase: GamePhase;
  phaseEndsAtTick?: number;
  roundStartedTick?: number;
  width: number;
  height: number;
  boundaryInset: number;
  /** The ground this round is played on, chosen once in `prepareRound` from the room's setting. */
  map: ArenaMapId;
  /** Solid scenery: lethal on contact, cleared by a blast, and gone once the overtime walls pass it. */
  obstacles: Obstacle[];
  players: Map<PlayerId, PlayerState>;
  bombs: Map<number, BombState>;
  blasts: BlastState[];
  pickups: PickupState[];
  portalPairs: PortalPair[];
  gravityFields: GravityField[];
  nextTrailPieceId: number;
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
  /** Connected participants frozen at match end; later recap joins/leaves cannot change agreement. */
  matchFinishers: string[];
  /** Highlight moments of the match, bounded per kind and cleared with `matchStats` (ADR 043). */
  moments: Moment[];
  /** Every trigger pull of the current round and whom it killed, for per-kill and per-miss analytics. Cleared each round. */
  shots: RoundShot[];
  /** The most recently decided round's log, kept until the next round is decided — through a rematch and the lobby too. */
  decidedRound?: DecidedRound;
  roundWinnerId?: PlayerId;
  matchWinnerId?: PlayerId;
}

export function sortedPlayers(
  state: Pick<GameState, "players">,
): PlayerState[] {
  return [...state.players.values()].sort(
    (a, b) => a.slot - b.slot || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
}

export function sortedBombs(state: Readonly<GameState>): BombState[] {
  return [...state.bombs.values()].sort((a, b) => a.id - b.id);
}

/** Scenery in id order, which is the order it was generated in: contact bisection and exact ties read it in order. */
export function sortedObstacles(
  state: Pick<GameState, "obstacles">,
): Obstacle[] {
  return [...state.obstacles].sort((a, b) => a.id - b.id);
}
