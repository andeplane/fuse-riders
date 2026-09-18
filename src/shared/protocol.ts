import { isAvatarId, type AvatarId } from "./avatars.js";
import type { PortalPair } from "../engine/portal.js";
import type { ArenaMapId, Obstacle } from "../engine/arena-map.js";
import type {
  RoundPlacement,
  SessionLeaderboardEntry,
} from "../engine/leaderboard.js";
import type { MatchPlayerStats } from "../engine/match-stats.js";
import type { FlightPoint } from "../engine/launch-modifiers.js";
import type { PickupType } from "../engine/pickup-types.js";
import type { Moment } from "../engine/moments.js";
import type { DecidedRound } from "../engine/shot-log.js";

export type { AvatarId } from "./avatars.js";
export type {
  ArenaMapId,
  Obstacle,
  ObstacleKind,
} from "../engine/arena-map.js";
export type {
  RoundPlacement,
  SessionLeaderboardEntry,
} from "../engine/leaderboard.js";
export type {
  MatchDeathCause,
  MatchDeathCounts,
  MatchPlayerStats,
} from "../engine/match-stats.js";
export type { FlightPoint } from "../engine/launch-modifiers.js";
export type { Moment, MomentKind } from "../engine/moments.js";
export type {
  DecidedRound,
  RoundShot,
  ShotKill,
  Weapon,
} from "../engine/shot-log.js";

// The primitives the simulation itself is written in are the engine's; the wire vocabulary re-exports them.
import type {
  AimPoint,
  BlastCircle,
  BombAction,
  PlayerId,
  TrailSegment,
} from "../engine/primitives.js";
export type {
  AimPoint,
  BlastCircle,
  BombAction,
  BombActionCommand,
  PlayerId,
  TrailSegment,
} from "../engine/primitives.js";
export type PlayerToken = string;
export type ClientMessage =
  | {
      type: "join";
      name: string;
      playerToken?: PlayerToken;
      avatarId?: AvatarId;
    }
  | {
      type: "input";
      seq: number;
      left: boolean;
      right: boolean;
      bomb: boolean;
      bombAction?: BombAction;
      aim?: AimPoint;
    }
  | { type: "setAvatar"; avatarId: AvatarId }
  | { type: "heartbeat" }
  | { type: "ping"; id: number; sentAt: number }
  | { type: "leave" }
  | { type: "hostAuth"; token: string }
  | { type: "hostAction"; action: "start" | "nextRound" | "rematch" | "lobby" }
  | { type: "hostBot"; action: "add" | "remove"; id?: string };
export interface GameSnapshot {
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
  players: ReadonlyArray<{
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
    rangeLevel: number;
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
  }>;
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
export type ErrorCode =
  | "invalid_message"
  | "full"
  | "unauthorized"
  | "stale"
  | "invalid_phase"
  | "not_enough_players";
export type ServerMessage =
  | {
      type: "joined";
      playerId: PlayerId;
      playerToken: PlayerToken;
      slot: number;
      color: string;
      nextInputSeq: number;
    }
  | { type: "hostAuthenticated" }
  | { type: "pong"; id: number; sentAt: number }
  | { type: "inputAck"; seq: number; appliedTick: number }
  | {
      type: "snapshot";
      matchId: string;
      round: number;
      tick: number;
      state: GameSnapshot;
    }
  | {
      type: "event";
      matchId: string;
      round: number;
      tick: number;
      event: GameEvent;
    }
  | { type: "error"; code: ErrorCode };

// Reject extra fields as well as invalid values: a message is an intent, never game state.
export function parseClientMessage(raw: string): ClientMessage | null {
  if (raw.length > 2048) return null;
  let v: Record<string, unknown>;
  try {
    v = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const keys = (...allowed: string[]) =>
    Object.keys(v).every((k) => allowed.includes(k));
  const token = (x: unknown) =>
    typeof x === "string" && /^[a-f0-9]{32,64}$/.test(x);
  switch (v.type) {
    case "join":
      if (
        !keys("type", "name", "playerToken", "avatarId") ||
        typeof v.name !== "string" ||
        !v.name.trim() ||
        Array.from(v.name.trim()).length > 18 ||
        /[\u0000-\u001f\u007f]/.test(v.name) ||
        (v.playerToken !== undefined && !token(v.playerToken)) ||
        (v.avatarId !== undefined && !isAvatarId(v.avatarId))
      )
        return null;
      return {
        type: "join",
        name: v.name.trim(),
        ...(v.playerToken ? { playerToken: v.playerToken as string } : {}),
        ...(isAvatarId(v.avatarId) ? { avatarId: v.avatarId } : {}),
      };
    case "input":
      if (
        !keys("type", "seq", "left", "right", "bomb", "bombAction", "aim") ||
        !Number.isSafeInteger(v.seq) ||
        (v.seq as number) < 0 ||
        !["left", "right", "bomb"].every((k) => typeof v[k] === "boolean")
      )
        return null;
      if (v.aim !== undefined) {
        if (!v.aim || typeof v.aim !== "object" || Array.isArray(v.aim))
          return null;
        const aim = v.aim as Record<string, unknown>;
        if (
          Object.keys(aim).some((key) => key !== "x" && key !== "y") ||
          ![aim.x, aim.y].every(
            (value) =>
              typeof value === "number" &&
              Number.isFinite(value) &&
              value >= 0 &&
              value <= 1,
          )
        )
          return null;
      }
      if (
        v.bombAction !== undefined &&
        !["press", "release", "cancel"].includes(v.bombAction as string)
      )
        return null;
      if (
        (v.bombAction === "press" && v.bomb !== true) ||
        ((v.bombAction === "release" || v.bombAction === "cancel") &&
          v.bomb !== false)
      )
        return null;
      return v as Extract<ClientMessage, { type: "input" }>;
    case "setAvatar":
      return keys("type", "avatarId") && isAvatarId(v.avatarId)
        ? (v as ClientMessage)
        : null;
    case "heartbeat":
    case "leave":
      return keys("type") ? (v as ClientMessage) : null;
    case "ping":
      return keys("type", "id", "sentAt") &&
        Number.isSafeInteger(v.id) &&
        (v.id as number) >= 0 &&
        typeof v.sentAt === "number" &&
        Number.isFinite(v.sentAt) &&
        v.sentAt >= 0
        ? (v as ClientMessage)
        : null;
    case "hostAuth":
      return keys("type", "token") && token(v.token)
        ? (v as ClientMessage)
        : null;
    case "hostBot":
      return keys("type", "action", "id") &&
        (v.action === "add"
          ? v.id === undefined
          : v.action === "remove" &&
            typeof v.id === "string" &&
            /^bot:[0-9]+$/.test(v.id) &&
            v.id.length <= 128)
        ? (v as ClientMessage)
        : null;
    case "hostAction":
      return keys("type", "action") &&
        ["start", "nextRound", "rematch", "lobby"].includes(v.action as string)
        ? (v as ClientMessage)
        : null;
    default:
      return null;
  }
}
