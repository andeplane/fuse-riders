import { BOMB_MAX_CHARGE_TICKS } from "./bomb-launch.js";
import {
  type AvatarId,
  type GameState,
  type PlayerState,
  sortedBombs,
  sortedPlayers,
} from "./state.js";
import {
  BLAST_VISIBLE_TICKS,
  GRAVITY_FIELD_TICKS,
  TICK_HZ,
  TRAIL_WIDTH,
  gravityCoreRadius,
  riderMotionStep,
} from "./tuning.js";
import { edgesOpen } from "./arena-map.js";
import {
  MAX_VOLLEY_BOMBS,
  bombsPerShot,
  volleyAngles,
} from "./launch-modifiers.js";
import { snapshotMatchStats } from "./match-stats.js";
import { sortedLeaderboard } from "./leaderboard.js";
import type { PortalPair } from "./portal.js";
import type { ArenaMapId, Obstacle } from "./arena-map.js";
import type { RoundPlacement, SessionLeaderboardEntry } from "./leaderboard.js";
import type { MatchPlayerStats } from "./match-stats.js";
import type { FlightPoint } from "./launch-modifiers.js";
import type { PickupType } from "./pickup-types.js";
import type { Moment } from "./moments.js";
import type { DecidedRound } from "./shot-log.js";
import type {
  AimPoint,
  BlastCircle,
  PlayerId,
  TrailSegment,
} from "./primitives.js";

// The vocabulary the view is written in, so a screen needs no other engine module to name what it draws.
export type { ArenaMapId, Obstacle, ObstacleKind } from "./arena-map.js";
export type { FlightPoint } from "./launch-modifiers.js";
export type { PickupType } from "./pickup-types.js";
export type { PortalPair } from "./portal.js";
export type {
  AimPoint,
  BlastCircle,
  PlayerId,
  TrailSegment,
} from "./primitives.js";

/**
 * Rule values a screen needs, as data. A renderer never imports a balance constant: what it must know about the
 * rules is either here, or already worked out per rider, bomb or field below.
 */
export interface ViewRules {
  /** Simulation ticks per second. */
  tickHz: number;
  /** How long a blast stays in `blasts`: with `expiresAtTick` it gives a blast's age. */
  blastVisibleTicks: number;
  /** The width a trail collides at, which is the width it is drawn and burnt at. */
  trailWidth: number;
}

/** One rider as a screen sees it. */
export interface RiderView {
  id: PlayerId;
  name: string;
  slot: number;
  color: string;
  connected: boolean;
  avatarId: AvatarId;
  x: number;
  y: number;
  angle: number;
  alive: boolean;
  roundWins: number;
  matchScoreUnits: number;
  roundScoreUnits: number;
  waitingForNextRound?: boolean;
  bombReadyAtTick: number;
  bombChargeStartedTick?: number;
  aimSlowTicks: number;
  aimSlowSpentTicks: number;
  trail: ReadonlyArray<TrailSegment>;
  extraBombs: number;
  fuseLevel: number;
  powerPickups: number;
  reloadDurationTicks: number;
  invulnerableUntilTick: number;
  nitroUntilTicks: ReadonlyArray<number>;
  snailUntilTicks: ReadonlyArray<number>;
  grip: boolean;
  drunkUntilTick: number;
  inkUntilTick: number;
  gunArmed?: boolean;
  shellArmed?: boolean;
  targetBombArmed: boolean;
  bombTarget?: AimPoint;
  tripleShotArmed: boolean;
  fiveShotArmed: boolean;
  shielded: boolean;
  shieldGraceUntilTick: number;
  portalCooldownUntilTick: number;
  portalGraceUntilTick: number;
  /**
   * World units this rider covers on the next tick, with everything that changes pace already in it: the round's
   * ramp, every Nitro and Snail in force on that tick and the aiming slowdown. A screen bounds a trail tip or leads
   * the local rider with this instead of rebuilding it from constants.
   */
  speed: number;
  /** Radians this rider may turn on the next tick (the ramp and Grip included). */
  turn: number;
  /**
   * Where the next volley's bombs would go, as offsets from the rider's heading in radians (one entry per bomb).
   * Offsets rather than angles, so presentation can turn the rider between ticks and the fan turns with it.
   */
  nextVolleyAngles: ReadonlyArray<number>;
  /** Presentation only: the fractional tick this rider is drawn at when it is led ahead of the world. Never set by `toView`. */
  presentationTick?: number;
}

/**
 * THE contract between the simulation and whatever draws it: everything a screen, the HUD and the recap read of one
 * tick. Plain data derived locally from `GameState` by `toView`; it is never sent, stored in a checkpoint or hashed.
 */
export interface WorldView {
  /** The simulated tick; presentation may hand a renderer a fractional one between two simulated ticks. */
  tick: number;
  round: number;
  /** Presentation only: optional fractional world time for cosmetics. Never set by `toView`. */
  presentationTick?: number;
  rules: ViewRules;
  matchLength: number;
  bombChargeTicks: number;
  aimBounce: boolean;
  phase: "lobby" | "countdown" | "playing" | "roundOver" | "matchOver";
  phaseEndsAtTick?: number;
  roundStartedTick?: number;
  width: number;
  height: number;
  boundaryInset: number;
  /** The round's ground, and the scenery standing on it: lethal to touch, and cleared by a blast. */
  map: ArenaMapId;
  obstacles: ReadonlyArray<Obstacle>;
  /** Whether the board's edges are open right now (a wrapping map whose overtime walls have not come in yet). */
  openEdges: boolean;
  players: ReadonlyArray<RiderView>;
  bombs: ReadonlyArray<{
    id: number;
    ownerId: PlayerId;
    launchX: number;
    launchY: number;
    x: number;
    y: number;
    launchedTick: number;
    landsAtTick: number;
    explodeAtTick: number;
    blastRange: number;
    shell?: { vx: number; vy: number; gun?: boolean; bounces?: number };
    flightPath: ReadonlyArray<FlightPoint>;
  }>;
  blasts: ReadonlyArray<{
    bombId: number;
    circle: Readonly<BlastCircle>;
    expiresAtTick: number;
  }>;
  portalPairs: ReadonlyArray<PortalPair>;
  gravityFields: ReadonlyArray<{
    x: number;
    y: number;
    radius: number;
    expiresAtTick: number;
    /** How long a hole lasts, so a screen can ease it in from `expiresAtTick`. */
    durationTicks: number;
    /** The black core: a rider whose centre crosses into it is gone. */
    coreRadius: number;
  }>;
  pickups: ReadonlyArray<{
    id: number;
    type: PickupType;
    x: number;
    y: number;
    expiresAtTick: number;
  }>;
  leaderboard: ReadonlyArray<SessionLeaderboardEntry>;
  roundPlacements: ReadonlyArray<RoundPlacement>;
  matchStats: ReadonlyArray<MatchPlayerStats>;
  matchFinishers?: readonly string[];
  /** Highlight moments of the match; like `matchStats`, present only once the match is over (ADR 043). */
  moments: ReadonlyArray<Moment>;
  /** The most recently decided round's trigger pulls and whom each killed, kept until the next round is decided. */
  decidedRound?: DecidedRound;
  roundWinnerId?: PlayerId;
  matchWinnerId?: PlayerId;
}

/** What a tick reports, in order. Cosmetics and sound key off these; nothing in the simulation reads them back. */
export type GameEvent =
  | { type: "pickupCollected"; playerId: PlayerId; pickupId: number }
  | { type: "bombPlaced"; bombId: number; playerId: PlayerId; gun?: boolean }
  | { type: "explosion"; bombId: number }
  | {
      type: "playerEliminated";
      playerId: PlayerId;
      cause: "wall" | "trail" | "explosion" | "rider";
    }
  | { type: "moment"; moment: Moment }
  | { type: "roundEnded"; winnerId?: PlayerId }
  | { type: "matchEnded"; winnerId?: PlayerId };

const RULES_VIEW: ViewRules = Object.freeze({
  tickHz: TICK_HZ,
  blastVisibleTicks: BLAST_VISIBLE_TICKS,
  trailWidth: TRAIL_WIDTH,
});

/** What a screen is given of the state. Read-only over `GameState`; callers ask for it when they need one. */
export function toView(state: GameState): WorldView {
  return {
    tick: state.tick,
    round: state.round,
    rules: RULES_VIEW,
    matchLength: state.settings?.length ?? 5,
    bombChargeTicks: state.settings?.bombChargeTicks ?? BOMB_MAX_CHARGE_TICKS,
    aimBounce: state.settings?.aimBounce ?? false,
    phase: state.phase,
    ...(state.phaseEndsAtTick === undefined
      ? {}
      : { phaseEndsAtTick: state.phaseEndsAtTick }),
    ...(state.roundStartedTick === undefined
      ? {}
      : { roundStartedTick: state.roundStartedTick }),
    width: state.width,
    height: state.height,
    boundaryInset: state.boundaryInset,
    map: state.map,
    obstacles: state.obstacles.map((obstacle) => ({ ...obstacle })),
    openEdges: edgesOpen(state),
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
      waitingForNextRound:
        state.phase !== "lobby" && !state.roundParticipants.has(player.id),
      roundWins: player.roundWins,
      matchScoreUnits: state.matchStats.get(player.id)?.matchScoreUnits ?? 0,
      roundScoreUnits:
        state.roundPlacements.find(
          (placement) => placement.playerId === player.id,
        )?.scoreUnits ?? 0,
      bombReadyAtTick: player.bombReadyAtTick,
      ...(player.bombChargeStartedTick === undefined
        ? {}
        : { bombChargeStartedTick: player.bombChargeStartedTick }),
      aimSlowTicks: player.aimSlowTicks,
      aimSlowSpentTicks: player.aimSlowSpentTicks,
      extraBombs: player.extraBombs,
      fuseLevel: player.fuseLevel,
      powerPickups: player.powerPickups,
      reloadDurationTicks: player.reloadDurationTicks,
      invulnerableUntilTick: player.invulnerableUntilTick,
      nitroUntilTicks: [...player.nitroUntilTicks],
      snailUntilTicks: [...player.snailUntilTicks],
      grip: player.grip,
      drunkUntilTick: player.drunkUntilTick,
      inkUntilTick: player.inkUntilTick,
      gunArmed: player.gunArmed,
      shellArmed: player.shellArmed,
      targetBombArmed: player.targetBombArmed,
      ...(player.bombTarget ? { bombTarget: { ...player.bombTarget } } : {}),
      tripleShotArmed: player.tripleShotArmed,
      fiveShotArmed: player.fiveShotArmed,
      shielded: player.shielded,
      shieldGraceUntilTick: player.shieldGraceUntilTick,
      portalCooldownUntilTick: player.portalCooldownUntilTick,
      portalGraceUntilTick: player.portalGraceUntilTick,
      trail: player.trail.map((segment) => ({ ...segment })),
      ...nextStep(player, state),
      nextVolleyAngles: volleyAngles(
        0,
        Math.max(1, Math.min(MAX_VOLLEY_BOMBS, bombsPerShot(player))),
      ),
    })),
    bombs: sortedBombs(state).map((bomb) => ({
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
      blastRange: bomb.blastRange,
      ...(bomb.shell ? { shell: { ...bomb.shell } } : {}),
    })),
    blasts: state.blasts.map((blast) => ({
      bombId: blast.bombId,
      circle: { ...blast.circle },
      expiresAtTick: blast.expiresAtTick,
    })),
    portalPairs: state.portalPairs.map((pair) => ({
      ...pair,
      gates: [{ ...pair.gates[0] }, { ...pair.gates[1] }] as const,
    })),
    gravityFields: state.gravityFields.map((field) => ({
      ...field,
      durationTicks: GRAVITY_FIELD_TICKS,
      coreRadius: gravityCoreRadius(field.radius),
    })),
    pickups: state.pickups.map((pickup) => ({ ...pickup })),
    leaderboard: sortedLeaderboard(state.leaderboard),
    roundPlacements: state.roundPlacements.map((placement) => ({
      ...placement,
    })),
    matchStats:
      state.phase === "matchOver" ? snapshotMatchStats(state.matchStats) : [],
    matchFinishers: [...state.matchFinishers],
    moments:
      state.phase === "matchOver"
        ? state.moments.map((moment) => ({
            ...moment,
            targetIds: [...moment.targetIds],
          }))
        : [],
    // Only a decided round is published: the round in play can still change.
    ...(state.decidedRound
      ? {
          decidedRound: {
            ...state.decidedRound,
            ...(state.decidedRound.rating
              ? { rating: structuredClone(state.decidedRound.rating) }
              : {}),
            shots: state.decidedRound.shots.map((shot) => ({
              ...shot,
              kills: shot.kills.map((kill) => ({ ...kill })),
            })),
          },
        }
      : {}),
    ...(state.roundWinnerId === undefined
      ? {}
      : { roundWinnerId: state.roundWinnerId }),
    ...(state.matchWinnerId === undefined
      ? {}
      : { matchWinnerId: state.matchWinnerId }),
  };
}

/** The step the simulation will give this rider on the next tick, from the state as it stands (`moveRiders` reads the same). */
function nextStep(
  player: PlayerState,
  state: GameState,
): Pick<RiderView, "speed" | "turn"> {
  const { distance, turn } = riderMotionStep(
    player,
    state.tick + 1,
    state.roundStartedTick,
  );
  return { speed: distance, turn };
}
